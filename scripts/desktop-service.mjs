import { fork } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFile, rename, rm, realpath, appendFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { readStorageChoice, validateStorageTarget, saveStorageChoice, copyStorage, secureDataDirectory } from './lib/desktop-storage.mjs';

export function desktopDataPath(env = process.env) {
  if (env.FORGEFLOW_DATA_DIR) return resolve(env.FORGEFLOW_DATA_DIR);
  if (!env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required; set FORGEFLOW_DATA_DIR explicitly for tests.');
  return join(env.LOCALAPPDATA, 'ForgeFlow');
}

export function lockName(dataPath, platform = process.platform) {
  const hash = createHash('sha256').update(platform === 'win32' ? dataPath.toLowerCase() : dataPath).digest('hex').slice(0, 32);
  return platform === 'win32' ? `\\\\.\\pipe\\forgeflow-${hash}` : join(dataPath, 'service.sock');
}

export async function acquireRuntimeLock(dataPath) {
  const server = createServer((socket) => socket.destroy());
  await new Promise((resolveLock, reject) => {
    server.once('error', reject);
    server.listen(lockName(dataPath), () => { server.off('error', reject); resolveLock(); });
  });
  return server;
}

export async function verifyIdentity(url, secret, instanceId) {
  const target = new URL(url);
  if (target.hostname !== '127.0.0.1' || target.protocol !== 'http:') throw new Error('Invalid local runtime URL');
  const response = await fetch(new URL('/api/runtime/identity', target), {
    headers: { 'X-ForgeFlow-Desktop': secret }, signal: AbortSignal.timeout(3000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Local runtime authentication failed');
  const identity = await response.json();
  if (identity.instanceId !== instanceId || identity.protocolVersion !== 1) throw new Error('Local runtime identity mismatch');
  return identity;
}

export async function startDesktopService({ runtimeRoot, dataPath, deferPublication = false, storageOverride = false, emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`) }) {
  dataPath = await secureDataDirectory(dataPath);
  const lock = await acquireRuntimeLock(dataPath);
  const descriptor = join(dataPath, 'runtime.json');
  const logPath = join(dataPath, 'desktop.log');
  let child; let ready; let stopping = false; let retries = 0; let restartTimer; let released = false; let stopResult; let stopPromise;
  let resolveReady; let rejectReady;
  const initialReady = new Promise((yes, no) => { resolveReady = yes; rejectReady = no; });
  initialReady.catch(() => {});
  const releaseLock = async () => { if (!released) { released = true; await new Promise((done) => lock.close(done)); } };
  const log = (line) => appendFile(logPath, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 }).catch(() => {});
  const writeDescriptor = async (value) => {
    const temporary = `${descriptor}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, descriptor);
  };
  const publishReady = async () => {
    deferPublication = false;
    if (!ready) throw new Error('Local service is not ready');
    if (child?.connected) child.send({ type: 'storage-committed' });
    await writeDescriptor(ready);
    emit({ type: 'ready', url: `${ready.url}/#desktop-token=${ready.secret}` });
  };
  const launch = () => {
    const secret = randomBytes(32).toString('hex');
    const instanceId = randomUUID();
    ready = undefined;
    const owned = fork(join(runtimeRoot, 'apps/server/dist/server.js'), [], {
      cwd: runtimeRoot, execPath: process.execPath, execArgv: [], windowsHide: true,
      env: { ...process.env, PORT: '0', FORGEFLOW_DB_PATH: join(dataPath, 'forgeflow.db'),
        FORGEFLOW_WEB_DIST: join(runtimeRoot, 'apps/web/dist'), FORGEFLOW_DESKTOP_SECRET: secret,
        FORGEFLOW_DESKTOP_INSTANCE: instanceId, FORGEFLOW_CURRENT_DATA_DIR: dataPath,
        FORGEFLOW_STORAGE_OVERRIDE: String(storageOverride), FORGEFLOW_STORAGE_PENDING: deferPublication ? '1' : '0' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child = owned;
    // Do not persist arbitrary server output: request logs can contain user content.
    owned.stderr.on('data', () => log('Server wrote diagnostic output; inspect a foreground server to investigate.'));
    const timeout = setTimeout(() => { if (!ready && !stopping) { log('Server readiness timed out'); owned.kill(); } }, 20000);
    owned.on('message', async (message) => {
      if (message?.type === 'open-storage' && child === owned && !stopping) { emit({ type: 'open-storage' }); return; }
      if (message?.type !== 'ready' || message.instanceId !== instanceId || stopping || child !== owned) return;
      try {
        if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) throw new Error('Invalid runtime port');
        const url = `http://127.0.0.1:${message.port}`;
        await verifyIdentity(url, secret, instanceId);
        if (stopping || child !== owned || owned.exitCode !== null) return;
        ready = { protocol: 1, url, instanceId, secret, pid: owned.pid, dataPath };
        clearTimeout(timeout);
        const notification = { type: 'ready', url: `${url}/#desktop-token=${secret}` };
        if (!deferPublication) await publishReady();
        resolveReady(notification);
        await log('Authenticated local service ready');
      } catch { await log('Runtime identity check failed'); owned.kill(); }
    });
    owned.once('error', () => log('Unable to launch packaged Node runtime'));
    owned.once('exit', (code) => {
      clearTimeout(timeout);
      if (child === owned) ready = undefined;
      if (stopping) return;
      // Graceful external stop must not be interpreted as a crash.
      if (code === 0) { rejectReady(new Error('service-stopped')); emit({ type: 'error', reason: 'service-stopped' }); return; }
      if (++retries > 3) { rejectReady(new Error('restart-limit')); emit({ type: 'error', reason: 'restart-limit' }); log('Restart limit reached'); return; }
      restartTimer = setTimeout(launch, 1000 * retries);
    });
  };
  launch();
  return {
    waitUntilReady() { return initialReady; },
    publishReady,
    releaseLock,
    stop({ timeoutMs = 5000, retainLock = false } = {}) {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
      stopping = true;
      clearTimeout(restartTimer);
      const owned = child;
      if (owned && owned.exitCode === null && owned.signalCode === null) {
        const exited = new Promise((resolveExit) => owned.once('exit', (code) => resolveExit(code === 0)));
        if (ready) {
          try {
            await verifyIdentity(ready.url, ready.secret, ready.instanceId);
            await fetch(`${ready.url}/api/runtime/shutdown`, { method: 'POST', headers: { 'X-ForgeFlow-Desktop': ready.secret }, signal: AbortSignal.timeout(3000) });
          } catch { await log('Graceful shutdown request failed'); }
        }
        const deadline = setTimeout(() => { if (owned.exitCode === null && owned.signalCode === null) owned.kill(); }, timeoutMs);
        stopResult = { graceful: await exited };
        clearTimeout(deadline);
      } else stopResult = { graceful: owned?.exitCode === 0 };
      await rm(descriptor, { force: true });
      if (!retainLock) await releaseLock();
      await log('Desktop service stopped');
      return stopResult;
      })();
      return stopPromise;
    },
  };
}

export async function createDesktopController({ runtimeRoot, env = process.env, emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`), startService = startDesktopService, persistChoice = saveStorageChoice }) {
  let choice = await readStorageChoice({ env });
  let service; let busy = false; let closed = false;
  const info = () => emit({ type: choice.dataPath ? 'storage-info' : 'setup-required', ...choice });
  const progress = (stage) => emit({ type: 'storage-progress', stage });
  async function launch(dataPath, holdReady = false) {
    let buffered;
    let holding = holdReady;
    const created = await startService({ runtimeRoot, dataPath, deferPublication: holdReady, storageOverride: choice.override, emit: (message) => {
      if (holding && message.type === 'ready') buffered = message;
      else if (!(holding && message.type === 'error')) emit(message);
    } });
    try {
      await Promise.race([created.waitUntilReady(), new Promise((_, no) => { const timer = setTimeout(() => no(new Error('服务启动超时。')), 30000); timer.unref(); })]);
    } catch (error) { await created.stop(); throw error; }
    return { created, publish: async () => { await created.publishReady?.(); holding = false; if (buffered) emit(buffered); } };
  }
  if (choice.dataPath) { const started = await launch(choice.dataPath); service = started.created; info(); }
  else emit({ type: 'setup-required', ...choice });
  return {
    async handle(message) {
      if (message?.type === 'storage-info') { info(); return; }
      if (!['choose-storage', 'migrate-storage'].includes(message?.type)) throw new Error('不支持的存储操作。');
      if (busy || closed) throw new Error('正在处理存储操作，请稍候。');
      if (choice.override) throw new Error('当前数据目录由环境变量指定，不能在应用中切换。');
      if ((message.type === 'choose-storage') !== !choice.dataPath) throw new Error('存储状态已变化，请重新打开设置。');
      busy = true;
      const previous = service; const previousPath = choice.dataPath;
      let next; let committed = false;
      try {
        const validated = await validateStorageTarget(message.path, { sourcePath: previousPath, runtimeRoot, env, allowLegacy: !previousPath && message.reuseExisting === true });
        if (previousPath) {
          progress('stopping');
          const result = await previous.stop({ timeoutMs: 30000, retainLock: true });
          service = undefined;
          if (!result.graceful) throw new Error('后台未能正常停止，已中止迁移。');
          await copyStorage({ sourcePath: previousPath, targetPath: validated.dataPath, runtimeRoot, env, progress });
        }
        progress('starting');
        next = await launch(validated.dataPath, true);
        progress('committing');
        await persistChoice(validated.dataPath, { env });
        committed = true;
        choice = { dataPath: validated.dataPath, configPath: choice.configPath, override: false, canMigrate: true };
        service = next.created;
        await previous?.releaseLock();
        await next.publish(); progress('complete'); info();
      } catch (error) {
        if (committed) {
          emit({ type: 'storage-error', message: '数据目录已保存，但窗口连接失败。请退出并重新启动，原目录仍已保留。', dataPath: choice.dataPath, recoverable: false });
          info(); return;
        }
        await next?.created.stop();
        if (previousPath && !service) {
          progress('rollback');
          await previous?.releaseLock();
          try { service = (await launch(previousPath)).created; }
          catch { emit({ type: 'storage-error', message: '原数据目录已保留，但后台恢复失败。请退出后重新启动。', dataPath: previousPath, recoverable: false }); throw error; }
        }
        emit({ type: 'storage-error', message: error.message, dataPath: previousPath, recoverable: true });
        info();
      } finally { busy = false; }
    },
    async stop() { closed = true; await service?.stop(); },
  };
}

if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  let runtime;
  let pending = Promise.resolve();
  const stop = async () => { await pending; await runtime?.stop(); process.exit(0); };
  try {
    runtime = await createDesktopController({ runtimeRoot: resolve(process.env.FORGEFLOW_RUNTIME_ROOT ?? '.') });
    const input = createInterface({ input: process.stdin });
    input.on('line', (line) => {
      pending = pending.then(async () => {
        try { const message = JSON.parse(line); if (message.type === 'shutdown') { void pending.finally(stop); } else await runtime.handle(message); }
        catch (error) { process.stdout.write(`${JSON.stringify({ type: 'storage-error', message: error.message, recoverable: true })}\n`); }
      });
    });
    input.on('close', () => void pending.finally(stop));
    process.on('SIGINT', () => void stop());
    process.on('SIGTERM', () => void stop());
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: error.code === 'EADDRINUSE' ? 'already-running' : 'startup-failed' })}\n`);
    process.exitCode = 1;
  }
}
