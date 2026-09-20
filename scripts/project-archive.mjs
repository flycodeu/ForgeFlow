import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const [command, ...args] = process.argv.slice(2);
const values = new Map();
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (!key?.startsWith('--')) throw new Error(`参数无效：${key}`);
  const value = args[index + 1]?.startsWith('--') || !args[index + 1] ? true : args[++index];
  values.set(key, [...(values.get(key) ?? []), value]);
}
const option = (name) => values.get(name)?.[0];
const digest = (value) => createHash('sha256').update(value).digest('hex');

async function main() {
  if (!['sync', 'record', 'export'].includes(command) || typeof option('--project') !== 'string') {
    console.log('用法：pnpm archive sync --project 项目标识 --file 文档.md [--file 另一文档.md] [--watch]');
    console.log('      pnpm archive record --project 项目标识 --title 标题 --file 记录.md [--type PLAN|PROGRESS|DESIGN|RESULT|NOTE] [--operation-id 标识] [--work-id 标识]');
    console.log('      pnpm archive export --project 项目标识 --out 项目存档.json');
    process.exitCode = 1;
    return;
  }
  const base = new URL(process.env.FORGEFLOW_URL ?? 'http://127.0.0.1:8787');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol)
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('FORGEFLOW_URL 仅支持不含凭证和路径的本机 HTTP 地址');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.FORGEFLOW_TOKEN) headers.Authorization = `Bearer ${process.env.FORGEFLOW_TOKEN}`;
  async function api(path, method = 'GET', body) {
    const response = await fetch(new URL(path, base), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? `HTTP ${response.status}`);
    return result;
  }
  const projects = await api('/api/projects');
  const project = projects.find((item) => item.projectKey === option('--project').toUpperCase() || item.id === option('--project'));
  if (!project) throw new Error('项目不存在，请先在 ForgeFlow 创建项目；不会自动导入到其他项目');
  const route = `/api/projects/${project.id}/archive`;
  if (command === 'export') {
    if (typeof option('--out') !== 'string') throw new Error('导出需要 --out 文件路径');
    const snapshot = await api(`${route}/export`);
    await writeFile(resolve(option('--out')), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    console.log(`已导出 ${project.name}（不会覆盖已有文件）`);
    return;
  }
  const fileArgs = values.get('--file') ?? [];
  if (!fileArgs.length || fileArgs.some((item) => typeof item !== 'string')) throw new Error('需要明确指定 --file 文档路径');
  const files = [...new Set(fileArgs.map((item) => resolve(item)))];
  for (const file of files) {
    if (!['.md', '.markdown', '.txt'].includes(extname(file).toLowerCase())) throw new Error('仅支持 Markdown 和 UTF-8 文本；不会扫描其他文件');
  }
  async function readText(file) {
    const info = await stat(file);
    if (!info.isFile() || info.size > 2_000_000) throw new Error(`${basename(file)} 不是支持的文本文件或超过 2 MB`);
    const bytes = await readFile(file);
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (content.includes('\0') || content.length > 500_000) throw new Error(`${basename(file)} 含二进制数据或超过 50 万字符`);
    return content;
  }
  if (command === 'record') {
    if (files.length !== 1 || typeof option('--title') !== 'string') throw new Error('记录需要一个文件和 --title');
    const content = await readText(files[0]);
    const type = option('--type') ?? 'NOTE';
    if (!['PLAN', 'PROGRESS', 'DESIGN', 'RESULT', 'NOTE'].includes(type)) throw new Error('记录类型无效');
    const operationId = option('--operation-id') ?? randomUUID();
    console.log(`提交标识：${operationId}（失败后重试请保留此标识）`);
    const receipt = await api(`${route}/events`, 'POST', {
      operationId, type, title: option('--title'), content,
      ...(option('--work-id') ? { workId: option('--work-id') } : {}),
    });
    console.log(JSON.stringify({ committed: receipt.committed, replayed: receipt.replayed, workId: receipt.event.workId, eventId: receipt.event.id }));
    return;
  }
  let stopped = false;
  process.once('SIGINT', () => { stopped = true; });
  process.once('SIGTERM', () => { stopped = true; });
  const acknowledged = new Map();
  const pendingEvents = new Map();
  async function syncFile(file) {
    if (pendingEvents.has(file)) {
      await api(`${route}/events`, 'POST', pendingEvents.get(file));
      pendingEvents.delete(file);
    }
    const content = await readText(file);
    const contentHash = digest(content);
    if (acknowledged.get(file) === contentHash) return;
    const documents = await api(`${route}/documents`);
    const previous = documents.find((item) => item.sourcePath?.replaceAll('\\', '/').toLowerCase() === file.replaceAll('\\', '/').toLowerCase());
    const current = previous ? await api(`${route}/documents/${previous.id}`) : null;
    let saved = current;
    if (!current || current.content !== content) {
      const title = content.replace(/^\uFEFF/, '').match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 200) || basename(file);
      const input = { title, content, originalFilename: basename(file), sourcePath: file,
        contentType: extname(file).toLowerCase() === '.txt' ? 'text/plain' : 'text/markdown', changeSummary: '同步源文档快照' };
      saved = await api(`${route}/documents${current ? `/${current.id}` : ''}`, current ? 'PATCH' : 'POST', {
        ...input, ...(current ? { expectedRevisionId: current.currentRevisionId } : {}),
      });
    }
    // Retry a lost event receipt against the same saved revision, including after a process restart.
    const operationId = `sync-${saved.currentRevisionId}`;
    const event = pendingEvents.get(file) ?? { operationId, type: 'DESIGN', title: `存档：${saved.title}`,
      content: `已保存 ${basename(file)} 的原文快照。来源：文档同步工具；仅记录文档变化，不推断代码实现或测试结果。`, documentRevisionIds: [saved.currentRevisionId] };
    pendingEvents.set(file, event);
    await api(`${route}/events`, 'POST', event);
    pendingEvents.delete(file);
    acknowledged.set(file, contentHash);
    console.log(`已存档：${basename(file)}`);
  }
  const watching = values.has('--watch');
  if (watching) console.log('正在观察指定文件，每 5 秒检查当前内容；不会捕获保存间的临时版本，服务中断期间的中间版本不保证保留。Ctrl+C 停止。');
  do {
    let failed = false;
    for (const file of files) {
      try { await syncFile(file); }
      catch (error) { failed = true; console.error(`${basename(file)}：未同步，${error.message}`); }
    }
    if (!watching) { if (failed) process.exitCode = 1; break; }
    if (!stopped) await delay(5000);
  } while (!stopped);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
