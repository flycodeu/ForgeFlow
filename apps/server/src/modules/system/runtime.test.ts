import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../../app.js';

test('desktop serves built UI, authenticates bootstrap and rejects foreign origins', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forgeflow-runtime-'));
  const webDist = join(root, 'web'); mkdirSync(join(webDist, 'assets'), { recursive: true });
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>ForgeFlow production</title>');
  writeFileSync(join(webDist, 'assets', 'app.js'), 'console.log("built")');
  const desktopSecret = randomBytes(32).toString('base64url'); const instanceId = randomUUID();
  const app = createApp(join(root, 'runtime.db'), { desktopSecret, instanceId, webDist });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  assert.equal((await app.inject('/')).statusCode, 200);
  assert.match((await app.inject('/assets/app.js')).headers['content-type']!, /javascript/);
  assert.equal((await app.inject('/api/projects')).statusCode, 401);
  for (const path of ['/api/auth/initialize', '/api/system/select-directory', '/api/projects']) {
    assert.equal((await app.inject({ method: 'POST', url: path, headers: { authorization: 'Bearer ffai_forged' }, payload: {} })).statusCode, 401);
  }
  assert.equal((await app.inject('/assets/../../runtime.db')).statusCode, 404);
  const bootstrap = await app.inject({ method: 'POST', url: '/api/runtime/session', headers: { 'x-forgeflow-desktop': desktopSecret } });
  assert.equal(bootstrap.statusCode, 200, bootstrap.body);
  const cookie = bootstrap.cookies.find(item => item.name === 'forgeflow_desktop'); assert.ok(cookie);
  const cookieHeader = `${cookie.name}=${cookie.value}`;
  assert.equal((await app.inject({ url: '/api/projects', headers: { cookie: cookieHeader } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/runtime/shutdown', headers: { cookie: cookieHeader } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/runtime/identity', headers: { 'x-forgeflow-desktop': desktopSecret } })).json().instanceId, instanceId);
  for (const headers of [{ host: 'attacker.example' }, { origin: 'https://attacker.example' }, { origin: 'http://localhost:5173' }]) {
    assert.equal((await app.inject({ url: '/api/projects', headers: { cookie: cookieHeader, ...headers } })).statusCode, 403);
  }
  const created = await app.inject({ method: 'POST', url: '/api/ai-tokens', headers: { cookie: cookieHeader }, payload: { name: 'read-only', scopes: ['project:read'] } });
  assert.equal(created.statusCode, 201, created.body);
  const authorization = `Bearer ${created.json().token}`;
  assert.equal((await app.inject({ url: '/api/projects', headers: { authorization } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', headers: { authorization }, payload: { projectKey: 'DENY', name: 'deny' } })).statusCode, 403);
});

test('project session collector is owner-only, opt-in and persists across app restart', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forgeflow-capture-routes-'));
  const database = join(root, 'runtime.db'); let app = createApp(database);
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { projectKey: 'CAPTURE', name: 'Capture' } })).json();
  const base = `/api/projects/${project.id}/capture`;
  assert.equal((await app.inject(base)).json().configured, false);
  assert.equal((await app.inject({ method: 'PUT', url: base, payload: { enabled: true, workspaceRoot: root, sources: [] } })).statusCode, 400);
  const result = await app.inject({ method: 'PUT', url: base, payload: { enabled: false, workspaceRoot: root, sources: [] } });
  assert.equal(result.statusCode, 200, result.body);
  const token = (await app.inject({ method: 'POST', url: '/api/ai-tokens', payload: { name: 'ai', scopes: ['project:read', 'project:write', 'spec:write'] } })).json().token;
  assert.equal((await app.inject({ url: base, headers: { authorization: `Bearer ${token}` } })).statusCode, 403);
  assert.equal((await app.inject('/api/projects/not-a-uuid/capture')).statusCode, 400);
  await app.close(); app = createApp(database);
  const restored = (await app.inject(base)).json();
  assert.equal(restored.config.enabled, false); assert.equal(restored.pendingCount, 0);
});

test('session file reaches project work records through a real local HTTP listener without duplicating on retry', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'forgeflow-capture-http-'));
  const sessions = join(root, 'sessions'); mkdirSync(sessions);
  const app = createApp(join(root, 'runtime.db'));
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const project = (await app.inject({ method: 'POST', url: '/api/projects', payload: { projectKey: 'LIVE_CAPTURE', name: '隔离采集验证' } })).json();
  writeFileSync(join(sessions, 'fixture.jsonl'), [
    { type: 'session_meta', timestamp: new Date().toISOString(), payload: { id: randomUUID(), cwd: root } },
    { type: 'response_item', timestamp: new Date().toISOString(), payload: { type: 'message', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: '隔离会话：完成设计记录' }] } },
    { type: 'response_item', timestamp: new Date().toISOString(), payload: { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'DO_NOT_CAPTURE_REASONING' }] } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  const capture = `/api/projects/${project.id}/capture`;
  const config = await app.inject({ method: 'PUT', url: capture, payload: { enabled: true, workspaceRoot: root, sources: [{ kind: 'codex', directory: sessions }], includeHistory: true } });
  assert.equal(config.statusCode, 200, config.body);
  for (let attempt = 0; attempt < 2; attempt++) {
    const sync = await app.inject({ method: 'POST', url: `${capture}/sync` });
    assert.equal(sync.statusCode, 200, sync.body);
    assert.equal(sync.json().pendingCount, 0);
  }
  const records = (await app.inject(`/api/projects/${project.id}/archive/events`)).json();
  assert.equal(records.items.filter((item: { content: string }) => item.content.includes('隔离会话：完成设计记录')).length, 1);
  assert.equal(JSON.stringify(records).includes('DO_NOT_CAPTURE_REASONING'), false);
});
