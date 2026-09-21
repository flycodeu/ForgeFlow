import { fork, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm, realpath, appendFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

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

export async function startDesktopService({ runtimeRoot, dataPath, emit = (message) => process.stdout.write(`${JSON.stringify(message)}\n`) }) {
  await mkdir(dataPath, { recursive: true, mode: 0o700 });
  dataPath = await realpath(dataPath);
  if (process.platform === 'win32') {
    const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = identity.stdout?.match(/S-1-5-[\d-]+/)?.[0];
    if (!sid) throw new Error('Cannot determine current user for runtime directory ACL');
    const acl = spawnSync('icacls.exe', [dataPath, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
    if (acl.status !== 0) throw new Error('Cannot secure desktop runtime directory');
  }
  const lock = await acquireRuntimeLock(dataPath);
  const descriptor = join(dataPath, 'runtime.json');
  const logPath = join(dataPath, 'desktop.log');
  let child; let ready; let stopping = false; let retries = 0; let restartTimer;
  const log = (line) => appendFile(logPath, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 }).catch(() => {});
  const writeDescriptor = async (value) => {
    const temporary = `${descriptor}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, descriptor);
  };
  const launch = () => {
    const secret = randomBytes(32).toString('hex');
    const instanceId = randomUUID();
    ready = undefined;
    const owned = fork(join(runtimeRoot, 'apps/server/dist/server.js'), [], {
      cwd: runtimeRoot, execPath: process.execPath, execArgv: [], windowsHide: true,
      env: { ...process.env, PORT: '0', FORGEFLOW_DB_PATH: join(dataPath, 'forgeflow.db'),
        FORGEFLOW_WEB_DIST: join(runtimeRoot, 'apps/web/dist'), FORGEFLOW_DESKTOP_SECRET: secret,
        FORGEFLOW_DESKTOP_INSTANCE: instanceId },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child = owned;
    // Do not persist arbitrary server output: request logs can contain user content.
    owned.stderr.on('data', () => log('Server wrote diagnostic output; inspect a foreground server to investigate.'));
    const timeout = setTimeout(() => { if (!ready && !stopping) { log('Server readiness timed out'); owned.kill(); } }, 20000);
    owned.on('message', async (message) => {
      if (message?.type !== 'ready' || message.instanceId !== instanceId || stopping || child !== owned) return;
      try {
        if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) throw new Error('Invalid runtime port');
        const url = `http://127.0.0.1:${message.port}`;
        await verifyIdentity(url, secret, instanceId);
        if (stopping || child !== owned || owned.exitCode !== null) return;
        ready = { protocol: 1, url, instanceId, secret, pid: owned.pid, dataPath };
        await writeDescriptor(ready);
        clearTimeout(timeout);
        emit({ type: 'ready', url: `${url}/#desktop-token=${secret}` });
        await log('Authenticated local service ready');
      } catch { await log('Runtime identity check failed'); owned.kill(); }
    });
    owned.once('error', () => log('Unable to launch packaged Node runtime'));
    owned.once('exit', (code) => {
      clearTimeout(timeout);
      if (child === owned) ready = undefined;
      if (stopping) return;
      // Graceful external stop must not be interpreted as a crash.
      if (code === 0) { emit({ type: 'error', reason: 'service-stopped' }); return; }
      if (++retries > 3) { emit({ type: 'error', reason: 'restart-limit' }); log('Restart limit reached'); return; }
      restartTimer = setTimeout(launch, 1000 * retries);
    });
  };
  launch();
  return {
    async stop() {
      if (stopping) return;
      stopping = true;
      clearTimeout(restartTimer);
      const owned = child;
      if (owned && owned.exitCode === null && owned.signalCode === null) {
        const exited = new Promise((resolveExit) => owned.once('exit', resolveExit));
        if (ready) {
          try {
            await verifyIdentity(ready.url, ready.secret, ready.instanceId);
            await fetch(`${ready.url}/api/runtime/shutdown`, { method: 'POST', headers: { 'X-ForgeFlow-Desktop': ready.secret }, signal: AbortSignal.timeout(3000) });
          } catch { await log('Graceful shutdown request failed'); }
        }
        const deadline = setTimeout(() => { if (owned.exitCode === null && owned.signalCode === null) owned.kill(); }, 5000);
        await exited;
        clearTimeout(deadline);
      }
      await rm(descriptor, { force: true });
      await new Promise((resolveClose) => lock.close(resolveClose));
      await log('Desktop service stopped');
    },
  };
}

if (process.argv[1] && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  let runtime;
  const stop = async () => { await runtime?.stop(); process.exit(0); };
  try {
    runtime = await startDesktopService({ runtimeRoot: resolve(process.env.FORGEFLOW_RUNTIME_ROOT ?? '.'), dataPath: desktopDataPath() });
    const input = createInterface({ input: process.stdin });
    input.on('line', (line) => { if (line === '{"type":"shutdown"}') void stop(); });
    input.on('close', () => void stop());
    process.on('SIGINT', () => void stop());
    process.on('SIGTERM', () => void stop());
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ type: 'error', reason: error.code === 'EADDRINUSE' ? 'already-running' : 'startup-failed' })}\n`);
    process.exitCode = 1;
  }
}
