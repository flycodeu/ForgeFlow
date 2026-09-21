import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { discoverArchiveRuntime } from './runtime-discovery.mjs';
import { captureStatus } from './session-capture.mjs';

const instanceId = '0a7214a9-f67d-41ee-91dc-e72405c4df99';
const projectId = '0666417d-f47e-4a55-9328-14ffa5166c5b';
const secret = 'a'.repeat(64);
const descriptor = (overrides = {}) => ({ protocol: 1, url: 'http://127.0.0.1:45555', instanceId, secret, pid: 1234, ...overrides });
async function fixture(value = descriptor()) {
  const dir = await mkdtemp(join(tmpdir(), 'forgeflow-discovery-'));
  if (value !== null) await writeFile(join(dir, 'runtime.json'), typeof value === 'string' ? value : JSON.stringify(value));
  return dir;
}
const identityResponse = () => new Response(JSON.stringify({ instanceId, protocolVersion: 1 }));

test('explicit URL wins over malformed descriptor and does not read/send descriptor secret', async () => {
  const dir = await fixture('{bad'); let calls = 0;
  const found = await discoverArchiveRuntime({ env: { FORGEFLOW_URL: 'http://127.0.0.1:9999', FORGEFLOW_DATA_DIR: dir }, fetch: async () => { calls++; return identityResponse(); } });
  assert.equal(found.url, 'http://127.0.0.1:9999'); assert.equal(found.source, 'explicit'); assert.equal(calls, 0); assert.deepEqual(found.getHeaders(), {});
  await assert.rejects(discoverArchiveRuntime({ env: { FORGEFLOW_URL: 'https://external.test', FORGEFLOW_DATA_DIR: dir } }), /回环地址/);
});

test('absent descriptor falls back to development or validated saved queue URL', async () => {
  const dir = await fixture(null);
  assert.equal((await discoverArchiveRuntime({ env: { FORGEFLOW_DATA_DIR: dir } })).url, 'http://127.0.0.1:8787');
  assert.equal((await discoverArchiveRuntime({ env: {}, fallbackUrl: 'http://127.0.0.1:9876' })).url, 'http://127.0.0.1:9876');
  await assert.rejects(discoverArchiveRuntime({ env: {}, fallbackUrl: 'https://external.test' }), /回环地址/);
});

test('descriptor discovery authenticates identity and keeps secret out of serializable metadata', async () => {
  const dir = await fixture(); let calls = 0;
  const found = await discoverArchiveRuntime({ env: { FORGEFLOW_DATA_DIR: dir }, fetch: async (url, request) => {
    calls++; assert.equal(url, 'http://127.0.0.1:45555/api/runtime/identity'); assert.equal(request.headers['X-ForgeFlow-Desktop'], secret);
    assert.equal(request.redirect, 'error'); return identityResponse();
  } });
  assert.equal(calls, 1); assert.equal(found.source, 'desktop'); assert.equal(found.instanceId, instanceId);
  assert.equal(found.getHeaders()['X-ForgeFlow-Desktop'], secret); assert.equal(JSON.stringify(found).includes(secret), false);
});

test('forged remote/credential/path descriptors are rejected before credentials leave memory', async () => {
  for (const url of ['https://external.test', 'http://localhost:1234', 'http://127.0.0.1:1234/path', 'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1:1234/#secret']) {
    const dir = await fixture(descriptor({ url })); let calls = 0;
    await assert.rejects(discoverArchiveRuntime({ env: { FORGEFLOW_DATA_DIR: dir }, fetch: async () => { calls++; return identityResponse(); } }));
    assert.equal(calls, 0);
  }
});

test('stale auth or mismatched instance never falls back to stored/development endpoint', async () => {
  const dir = await fixture();
  for (const fetcher of [async () => { throw new Error('secret=' + secret); }, async () => new Response('SECRET_RESPONSE', { status: 401 }),
    async () => new Response(JSON.stringify({ instanceId: 'wrong', protocolVersion: 1 }))]) {
    await assert.rejects(discoverArchiveRuntime({ env: { FORGEFLOW_DATA_DIR: dir }, fallbackUrl: 'http://127.0.0.1:8787', fetch: fetcher }), (error) => {
      assert.doesNotMatch(error.message, new RegExp(secret)); assert.doesNotMatch(error.message, /SECRET_RESPONSE/); return /队列仍保留/.test(error.message);
    });
  }
  const malformed = await fixture('{"secret":"' + secret + '"');
  await assert.rejects(discoverArchiveRuntime({ env: { FORGEFLOW_DATA_DIR: malformed } }), /格式无效/);
});

test('each discovery re-reads rotated port and secret; LOCALAPPDATA path is supported', async () => {
  const root = await fixture(null); const dir = join(root, 'ForgeFlow'); await mkdir(dir);
  await writeFile(join(dir, 'runtime.json'), JSON.stringify(descriptor()));
  const env = { LOCALAPPDATA: root };
  const first = await discoverArchiveRuntime({ env, fetch: async () => identityResponse() });
  const nextSecret = 'b'.repeat(64); const nextId = '99631998-534f-4d30-a18f-40b64251065a';
  await writeFile(join(dir, 'runtime.json'), JSON.stringify(descriptor({ url: 'http://127.0.0.1:46666', secret: nextSecret, instanceId: nextId })));
  const second = await discoverArchiveRuntime({ env, fetch: async (url, request) => {
    assert.equal(url, 'http://127.0.0.1:46666/api/runtime/identity'); assert.equal(request.headers['X-ForgeFlow-Desktop'], nextSecret);
    return new Response(JSON.stringify({ instanceId: nextId, protocolVersion: 1 }));
  } });
  assert.notEqual(first.url, second.url); assert.notEqual(first.instanceId, second.instanceId);
});

test('CLI offline known-project enqueue survives invalid desktop descriptor; status performs no discovery', async () => {
  const dir = await fixture('{malformed'); const state = join(dir, 'queue'); const file = join(dir, 'result.txt'); await writeFile(file, 'Visible result');
  const run = promisify(execFile); const cli = fileURLToPath(new URL('../project-archive.mjs', import.meta.url));
  const env = { ...process.env, FORGEFLOW_DATA_DIR: dir }; delete env.FORGEFLOW_URL;
  await assert.rejects(run(process.execPath, [cli, 'record', '--project-id', projectId, '--state', state, '--file', file, '--title', 'Offline', '--operation-id', 'offline-desktop'], { env, timeout: 10000 }), (error) => {
    assert.equal(error.code, 2); assert.match(error.stderr, /格式无效/); return true;
  });
  assert.equal(captureStatus(state).pending, 1);
  await assert.rejects(run(process.execPath, [cli, 'status', '--state', state], { env, timeout: 10000 }), (error) => {
    assert.equal(error.code, 2); assert.equal(JSON.parse(error.stdout).pending, 1); assert.doesNotMatch(error.stderr, /格式无效/); return true;
  });
});

test('CLI flush discovers rotated desktop endpoint and never persists runtime secret', async (t) => {
  const dir = await fixture('{malformed'); const state = join(dir, 'queue'); const file = join(dir, 'result.txt'); await writeFile(file, 'Visible result');
  const run = promisify(execFile); const cli = fileURLToPath(new URL('../project-archive.mjs', import.meta.url));
  const env = { ...process.env, FORGEFLOW_DATA_DIR: dir }; delete env.FORGEFLOW_URL;
  await assert.rejects(run(process.execPath, [cli, 'record', '--project-id', projectId, '--state', state, '--file', file, '--title', 'Offline', '--operation-id', 'desktop-retry'], { env, timeout: 10000 }));
  let delivered = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers['x-forgeflow-desktop'], secret);
    if (request.url === '/api/runtime/identity') { response.end(JSON.stringify({ instanceId, protocolVersion: 1 })); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); assert.equal(body.operationId, 'desktop-retry'); delivered++;
    response.writeHead(201, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ committed: true, event: { id: 'event1', projectId } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  await writeFile(join(dir, 'runtime.json'), JSON.stringify(descriptor({ url })));
  const result = await run(process.execPath, [cli, 'flush', '--state', state, '--force'], { env, timeout: 10000 });
  assert.equal(delivered, 1); assert.equal(captureStatus(state).pending, 0); assert.equal(captureStatus(state).config.serverUrl, url);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
  assert.equal((await readFile(join(state, 'collector.sqlite'))).includes(Buffer.from(secret)), false);
});

test('watch reconnects after desktop port and secret rotation without restarting CLI', { timeout: 20000 }, async (t) => {
  const dir = await fixture(null); const state = join(dir, 'queue'); const file = join(dir, 'design.md'); await writeFile(file, '# 第一版\n');
  let current = null; let revision = 0; const delivered = new Set(); const waiters = [];
  const waitFor = (count) => delivered.size >= count ? Promise.resolve() : new Promise((resolve) => waiters.push({ count, resolve }));
  const startServer = async (key, id) => {
    const server = createServer(async (request, response) => {
      if (request.headers['x-forgeflow-desktop'] !== key) { response.writeHead(401); response.end('{}'); return; }
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/runtime/identity') { response.end(JSON.stringify({ instanceId: id, protocolVersion: 1 })); return; }
      if (request.method === 'GET') { response.end(JSON.stringify(request.url.endsWith('/documents') ? (current ? [current] : []) : current)); return; }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (request.url.endsWith('/events')) {
        delivered.add(body.operationId); response.end(JSON.stringify({ committed: true, event: { id: `event-${delivered.size}`, projectId } }));
        for (const waiter of waiters) if (delivered.size >= waiter.count) waiter.resolve(); return;
      }
      if (request.method === 'PATCH' && body.expectedRevisionId !== current?.currentRevisionId) { response.writeHead(409); response.end('{}'); return; }
      current = { ...body, id: 'doc1', currentRevisionId: `revision-${++revision}` }; response.end(JSON.stringify(current));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
    return { server, url: `http://127.0.0.1:${server.address().port}` };
  };
  const first = await startServer(secret, instanceId);
  await writeFile(join(dir, 'runtime.json'), JSON.stringify(descriptor({ url: first.url })));
  const env = { ...process.env, FORGEFLOW_DATA_DIR: dir }; delete env.FORGEFLOW_URL;
  const cli = fileURLToPath(new URL('../project-archive.mjs', import.meta.url));
  const child = spawn(process.execPath, [cli, 'sync', '--project-id', projectId, '--state', state, '--file', file, '--watch'], { env, windowsHide: true });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(() => child.kill());
  await waitFor(1);
  const nextSecret = 'c'.repeat(64); const nextId = '71f169e3-bbbf-49aa-b540-d977b8311aab';
  const second = await startServer(nextSecret, nextId);
  await writeFile(join(dir, 'runtime.json'), JSON.stringify(descriptor({ url: second.url, instanceId: nextId, secret: nextSecret })));
  await new Promise((resolve) => first.server.close(resolve));
  await writeFile(file, '# 第二版\n');
  await waitFor(2);
  assert.equal(revision, 2); assert.equal(current.content, '# 第二版\n');
  assert.equal(captureStatus(state).config.serverUrl, second.url);
  assert.equal(output.includes(secret), false); assert.equal(output.includes(nextSecret), false);
});
