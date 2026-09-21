import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDesktopService, verifyIdentity } from './desktop-service.mjs';

test('packaged runtime serves built UI, authenticates, persists isolated SQLite and shuts down its owned child', { skip: !process.env.FORGEFLOW_RUNTIME_ROOT, timeout: 45000 }, async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'forgeflow-desktop-integration-'));
  let service;
  try {
    let received;
    const ready = new Promise((resolveReady, reject) => {
      received = (message) => message.type === 'ready' ? resolveReady(message) : reject(new Error(message.reason));
    });
    service = await startDesktopService({ runtimeRoot: process.env.FORGEFLOW_RUNTIME_ROOT, dataPath, emit: received });
    const { url } = await ready;
    const endpoint = new URL(url);
    const secret = new URLSearchParams(endpoint.hash.slice(1)).get('desktop-token');
    const descriptor = JSON.parse(await readFile(join(dataPath, 'runtime.json'), 'utf8'));
    assert.equal(descriptor.secret, secret);
    assert.notEqual(endpoint.port, '8787');
    await verifyIdentity(endpoint.origin, secret, descriptor.instanceId);
    await assert.rejects(verifyIdentity(endpoint.origin, 'wrong', descriptor.instanceId));
    assert.equal((await fetch(`${endpoint.origin}/api/projects`)).status, 401);
    const page = await fetch(endpoint.origin);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /assets\/index-/);
    const session = await fetch(`${endpoint.origin}/api/runtime/session`, { method: 'POST', headers: { 'X-ForgeFlow-Desktop': secret } });
    assert.equal(session.status, 200);
    const cookie = session.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
    const projects = await fetch(`${endpoint.origin}/api/projects`, { headers: { cookie } });
    assert.equal(projects.status, 200);
    assert.deepEqual(await projects.json(), []);
    await access(join(dataPath, 'forgeflow.db'));
    await service.stop(); service = undefined;
    await assert.rejects(access(join(dataPath, 'runtime.json')));
    await assert.rejects(fetch(endpoint.origin, { signal: AbortSignal.timeout(1000) }));
  } finally {
    await service?.stop();
    await rm(dataPath, { recursive: true, force: true });
  }
});

test('owned server crashes recover at most three times and never loop forever', { skip: !process.env.FORGEFLOW_RUNTIME_ROOT, timeout: 45000 }, async () => {
  const dataPath = await mkdtemp(join(tmpdir(), 'forgeflow-desktop-retry-'));
  const messages = []; const waiting = [];
  const emit = (message) => waiting.length ? waiting.shift()(message) : messages.push(message);
  const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolveNext) => waiting.push(resolveNext));
  const service = await startDesktopService({ runtimeRoot: process.env.FORGEFLOW_RUNTIME_ROOT, dataPath, emit });
  const instances = new Set();
  try {
    for (let crash = 0; crash < 4; crash += 1) {
      assert.equal((await next()).type, 'ready');
      const descriptor = JSON.parse(await readFile(join(dataPath, 'runtime.json'), 'utf8'));
      await verifyIdentity(descriptor.url, descriptor.secret, descriptor.instanceId);
      assert.ok(!instances.has(descriptor.instanceId));
      instances.add(descriptor.instanceId);
      // Every PID here was authenticated from this isolated test's own runtime.
      process.kill(descriptor.pid, 'SIGKILL');
    }
    assert.deepEqual(await next(), { type: 'error', reason: 'restart-limit' });
  } finally {
    await service.stop();
    await rm(dataPath, { recursive: true, force: true });
  }
});
