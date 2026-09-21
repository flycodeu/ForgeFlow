import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { configureCapture, captureStatus, enqueueWork, enqueueDocument, documentQueueHead, adoptDocumentBaseline, flushCapture } from './lib/session-capture.mjs';
import { discoverArchiveRuntime } from './lib/runtime-discovery.mjs';

const [command, ...args] = process.argv.slice(2);
const values = new Map();
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (!key?.startsWith('--')) throw new Error('参数格式无效');
  const value = args[index + 1]?.startsWith('--') || !args[index + 1] ? true : args[++index];
  values.set(key, [...(values.get(key) ?? []), value]);
}
const option = (name) => values.get(name)?.[0];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
async function main() {
  if (!['sync', 'record', 'export', 'status', 'flush'].includes(command)) {
    console.log('用法：pnpm archive sync --project 项目标识 --file 文档.md [--file 另一文档.md] [--watch]');
    console.log('      pnpm archive record --project-id UUID --title 标题 --file 记录.md [--type NOTE] [--operation-id 标识]');
    console.log('      pnpm archive export --project 项目标识 --out 项目存档.json');
    console.log('      pnpm archive status|flush --state 状态目录 [--force]');
    console.log('离线入队需要 --project-id UUID。--state 可指定持久队列目录。同步冲突人工合并后，可用 --adopt-current 接受远端当前版本作为基线。');
    process.exitCode = 1; return;
  }
  if (command === 'status') {
    if (typeof option('--state') !== 'string') throw new Error('需要 --state 状态目录');
    const state = resolve(option('--state'));
    const result = captureStatus(state);
    console.log(JSON.stringify(result, null, 2)); if (result.pending) process.exitCode = 2; return;
  }
  let runtime = null;
  let discoveryError = null;
  async function refreshRuntime(fallbackUrl) {
    try { runtime = await discoverArchiveRuntime({ fallbackUrl }); discoveryError = null; }
    catch (error) { runtime = null; discoveryError = error; }
  }
  if (command !== 'flush') await refreshRuntime();
  if (command === 'flush') {
    if (typeof option('--state') !== 'string') throw new Error('需要 --state 状态目录');
    const state = resolve(option('--state'));
    const saved = captureStatus(state);
    await refreshRuntime(saved.config?.serverUrl);
    if (!runtime) throw discoveryError;
    if (saved.config && saved.config.serverUrl !== runtime.url) configureCapture(state, { ...saved.config, serverUrl: runtime.url });
    const result = await flushCapture(state, { headers: runtime.getHeaders(), token: process.env.FORGEFLOW_TOKEN, force: values.has('--force') });
    console.log(JSON.stringify(result, null, 2)); if (result.pending) process.exitCode = 2; return;
  }
  async function api(path) {
    if (!runtime) throw discoveryError;
    const headers = { 'Content-Type': 'application/json', ...runtime.getHeaders(),
      ...(process.env.FORGEFLOW_TOKEN ? { Authorization: `Bearer ${process.env.FORGEFLOW_TOKEN}` } : {}) };
    const response = await fetch(new URL(path, runtime.url), { headers, signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP_${response.status}`); return response.json();
  }
  let project;
  if (typeof option('--project-id') === 'string' && uuid.test(option('--project-id'))) project = { id: option('--project-id'), name: option('--project-id') };
  else {
    if (typeof option('--project') !== 'string') throw new Error('需要 --project 项目标识，或离线可用的 --project-id UUID');
    const projects = await api('/api/projects');
    project = projects.find((item) => item.projectKey === option('--project').toUpperCase() || item.id === option('--project'));
    if (!project) throw new Error('项目不存在；不会自动创建或导入其他项目');
  }
  const route = `/api/projects/${project.id}/archive`;
  if (command === 'export') {
    if (typeof option('--out') !== 'string') throw new Error('导出需要 --out 文件路径');
    const snapshot = await api(`${route}/export`);
    await writeFile(resolve(option('--out')), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    console.log(`已导出 ${project.name}（不会覆盖已有文件）`); return;
  }
  const stateDir = resolve(typeof option('--state') === 'string' ? option('--state') : `data/archive-cli/${project.id}`);
  const previousConfig = captureStatus(stateDir).config;
  configureCapture(stateDir, { version: 1, enabled: false, projectId: project.id,
    workspaceRoot: previousConfig?.workspaceRoot ?? process.cwd(), serverUrl: runtime?.url ?? previousConfig?.serverUrl ?? 'http://127.0.0.1:8787', sources: [] });
  const fileArgs = values.get('--file') ?? [];
  if (!fileArgs.length || fileArgs.some((item) => typeof item !== 'string')) throw new Error('需要明确指定 --file 文档路径');
  const files = [...new Set(fileArgs.map((item) => resolve(item)))];
  async function readText(file) {
    if (!['.md', '.markdown', '.txt'].includes(extname(file).toLowerCase())) throw new Error('仅支持 Markdown 和 UTF-8 文本');
    const info = await stat(file);
    if (!info.isFile() || info.size > 2_000_000) throw new Error('文本文件超过 2 MB 或不是普通文件');
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(file));
    if (content.includes('\0') || content.length > 500000) throw new Error('文本包含二进制数据或超过 50 万字符');
    return content;
  }
  const flush = async () => {
    if (!runtime) {
      console.error(discoveryError.message);
      return captureStatus(stateDir);
    }
    const saved = captureStatus(stateDir);
    if (saved.config.serverUrl !== runtime.url) configureCapture(stateDir, { ...saved.config, serverUrl: runtime.url });
    const result = await flushCapture(stateDir, { headers: runtime.getHeaders(), token: process.env.FORGEFLOW_TOKEN, force: values.has('--force'), maxItems: 50 });
    console.log(JSON.stringify({ stateDir, pending: result.pending, blocked: result.blocked, delivered: result.delivered, failures: result.failures }));
    return result;
  };
  if (command === 'record') {
    if (files.length !== 1 || typeof option('--title') !== 'string') throw new Error('记录需要一个文件和 --title');
    const receipt = enqueueWork(stateDir, { operationId: option('--operation-id') ?? randomUUID(), type: option('--type') ?? 'NOTE',
      title: option('--title'), content: await readText(files[0]), ...(option('--work-id') ? { workId: option('--work-id') } : {}) });
    console.log(JSON.stringify(receipt)); if ((await flush()).pending) process.exitCode = 2; return;
  }
  let stopped = false;
  process.once('SIGINT', () => { stopped = true; }); process.once('SIGTERM', () => { stopped = true; });
  const watching = values.has('--watch');
  if (watching && values.has('--adopt-current')) throw new Error('--adopt-current 仅允许单次同步，请核对冲突后单次接受基线');
  if (watching) console.log('每 5 秒读取指定文件，先保存当前快照到持久队列，再发送；未观察到的保存间版本无法捕获。Ctrl+C 停止，队列仍保留。');
  do {
    await refreshRuntime();
    let failed = false;
    for (const file of files) {
      try {
        const content = await readText(file);
        let baseline = null;
        const head = documentQueueHead(stateDir, file);
        if (!head || values.has('--adopt-current')) {
          try {
            const docs = await api(`${route}/documents`);
            const current = docs.find((item) => item.sourcePath === file);
            if (current) baseline = { documentId: current.id, revisionId: current.currentRevisionId };
          } catch { if (values.has('--adopt-current')) throw new Error('无法读取远端基线；未接受新基线'); }
        }
        const receipt = enqueueDocument(stateDir, { title: content.replace(/^\uFEFF/, '').match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 200) || basename(file),
          content, sourcePath: file, originalFilename: basename(file), contentType: extname(file).toLowerCase() === '.txt' ? 'text/plain' : 'text/markdown' }, baseline);
        if (baseline && values.has('--adopt-current')) adoptDocumentBaseline(stateDir, file, baseline);
        if (receipt.queued) console.log(`已保存待同步快照：${basename(file)}`);
      } catch (error) { failed = true; console.error(`${basename(file)}：${error.message}`); }
    }
    const result = await flush();
    if (!watching) { if (failed || result.pending) process.exitCode = 2; break; }
    if (!stopped) await delay(5000);
  } while (!stopped);
}
main().catch((error) => { console.error(error instanceof SyntaxError ? '响应或参数不是有效 JSON，未输出正文。' : error.message); process.exitCode = 1; });
