import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { configureCapture, captureStatus, pollCapture, flushCapture } from './lib/session-capture.mjs';

const [command, ...args] = process.argv.slice(2);
const value = (key) => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
async function main() {
  if (!['configure', 'status', 'poll', 'watch', 'flush'].includes(command) || !value('--state')) {
    throw new Error('用法：node scripts/session-capture.mjs configure --state 绝对状态目录 --config 配置.json；status / poll / watch / flush --state 状态目录 [--force]');
  }
  const stateDir = resolve(value('--state'));
  if (command === 'configure') {
    if (!value('--config')) throw new Error('需要 --config，默认不会扫描任何会话目录');
    console.log(JSON.stringify(configureCapture(stateDir, JSON.parse(await readFile(resolve(value('--config')), 'utf8'))), null, 2)); return;
  }
  if (command === 'status') { console.log(JSON.stringify(captureStatus(stateDir), null, 2)); return; }
  let stopped = false;
  process.once('SIGINT', () => { stopped = true; }); process.once('SIGTERM', () => { stopped = true; });
  do {
    const afterPoll = command !== 'flush' ? await pollCapture(stateDir) : null;
    const status = command !== 'flush' && !afterPoll.config?.enabled ? afterPoll
      : await flushCapture(stateDir, { token: process.env.FORGEFLOW_TOKEN, force: args.includes('--force') });
    console.log(JSON.stringify({ pending: status.pending, blocked: status.blocked, delivered: status.delivered,
      failures: status.failures, sources: status.sources.filter((source) => source.issue), diagnostics: status.diagnostics }));
    if (command !== 'watch') { if (status.pending || status.diagnostics.length || status.sources.some((source) => source.issue)) process.exitCode = 2; break; }
    if (!stopped) await delay(5000);
  } while (!stopped);
}
main().catch((error) => { console.error(error instanceof SyntaxError ? '配置文件不是有效 JSON；未输出文件内容。' : error.message); process.exitCode = 1; });
