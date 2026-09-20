import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import type { AiTokenSummary, CreatedAiToken, Project, SpecificationRevision, SpecificationSummary } from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('Owner session and scoped AI Token persist and revoke without storing secrets', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-auth-'));
  const path = join(directory, 'forgeflow.db');
  let app = createApp(path);
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });

  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/auth/status' })).json(), { initialized: false });
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', payload: {
    projectKey: 'LOCAL', name: 'Local workspace',
  } })).statusCode, 201);

  const password = 'test-only-password-123';
  const initial = await app.inject({ method: 'POST', url: '/api/auth/initialize', payload: { username: 'owner', password } });
  assert.equal(initial.statusCode, 201);
  const initialCookie = initial.headers['set-cookie']?.toString();
  assert.match(initialCookie ?? '', /HttpOnly/i);
  assert.match(initialCookie ?? '', /SameSite=Strict/i);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/initialize', payload: { username: 'second', password } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password: 'wrong' } })).statusCode, 401);

  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password } });
  assert.equal(login.statusCode, 200);
  const cookie = login.headers['set-cookie']!.toString().split(';')[0]!;
  const ownerHeaders = { cookie };
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/auth/me', headers: ownerHeaders })).json(),
    { identity: { kind: 'owner', id: 1, username: 'owner' } });

  const projectResponse = await app.inject({ method: 'POST', url: '/api/projects', headers: ownerHeaders,
    payload: { projectKey: 'PA', name: 'Project A' } });
  assert.equal(projectResponse.statusCode, 201);
  const project = projectResponse.json<Project>();
  const specResponse = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/specifications`, headers: ownerHeaders,
    payload: { kind: 'requirements', title: 'Scope' } });
  assert.equal(specResponse.statusCode, 201);
  const spec = specResponse.json<SpecificationSummary>();
  const specPath = `/api/projects/${project.id}/specifications/${spec.id}`;
  const revisionResponse = await app.inject({ method: 'POST', url: `${specPath}/revisions`, headers: ownerHeaders,
    payload: { content: '# Owner content', changeSummary: 'Initial', expectedHeadRevisionId: null, source: 'ai-token:forged' } });
  assert.equal(revisionResponse.statusCode, 201);
  const revision = revisionResponse.json<SpecificationRevision>();
  assert.equal(revision.source, 'owner:1');

  const readOnlyResponse = await app.inject({ method: 'POST', url: '/api/ai-tokens', headers: ownerHeaders,
    payload: { name: 'Reader', scopes: ['project:read'] } });
  assert.equal(readOnlyResponse.statusCode, 201);
  const readOnly = readOnlyResponse.json<CreatedAiToken>();
  const readHeaders = { authorization: `Bearer ${readOnly.token}` };
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects', headers: readHeaders })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: specPath, headers: readHeaders })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', headers: readHeaders,
    payload: { projectKey: 'PB', name: 'No' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/ai-tokens', headers: readHeaders })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: specPath, headers: { ...readHeaders, ...ownerHeaders } })).statusCode, 403);

  const writerResponse = await app.inject({ method: 'POST', url: '/api/ai-tokens', headers: ownerHeaders,
    payload: { name: 'Writer', scopes: ['spec:write'] } });
  assert.equal(writerResponse.statusCode, 201);
  const writer = writerResponse.json<CreatedAiToken>();
  const writeHeaders = { authorization: `Bearer ${writer.token}` };
  const aiRevision = await app.inject({ method: 'POST', url: `${specPath}/revisions`, headers: writeHeaders,
    payload: { content: '# AI content', changeSummary: 'Updated', expectedHeadRevisionId: revision.id, source: 'owner:1' } });
  assert.equal(aiRevision.statusCode, 201);
  assert.equal(aiRevision.json<SpecificationRevision>().source, `ai-token:${writer.id}`);
  assert.equal((await app.inject({ method: 'GET', url: specPath, headers: writeHeaders })).statusCode, 403);

  const listed = (await app.inject({ method: 'GET', url: '/api/ai-tokens', headers: ownerHeaders })).json<Record<string, unknown>[]>();
  assert.equal(listed.length, 2);
  assert.equal(listed.some((item) => 'token' in item || 'tokenHash' in item), false);
  assert.ok(listed.find((item) => item.id === readOnly.id)?.lastUsedAt);
  assert.ok(listed.find((item) => item.id === writer.id)?.lastUsedAt);

  const rotatedResponse = await app.inject({
    method: 'POST', url: `/api/ai-tokens/${writer.id}/rotate`, headers: ownerHeaders,
  });
  assert.equal(rotatedResponse.statusCode, 200);
  const rotated = rotatedResponse.json<CreatedAiToken>();
  assert.match(rotated.token, /^ffai_/);
  assert.notEqual(rotated.token, writer.token);
  assert.equal(rotated.name, writer.name);
  assert.deepEqual(rotated.scopes, writer.scopes);
  assert.equal((await app.inject({ method: 'GET', url: specPath, headers: writeHeaders })).statusCode, 401);
  const rotatedHeaders = { authorization: `Bearer ${rotated.token}` };
  assert.equal((await app.inject({ method: 'POST', url: `${specPath}/revisions`, headers: rotatedHeaders,
    payload: { content: '# Rotated AI content', changeSummary: 'Rotated', expectedHeadRevisionId: aiRevision.json<SpecificationRevision>().id } })).statusCode, 201);
  const sqlite = new Database(path, { readonly: true });
  try {
    const ownerRow = sqlite.prepare('SELECT password_hash AS hash, password_salt AS salt FROM rd_owner').get() as { hash: string; salt: string };
    assert.notEqual(ownerRow.hash, password);
    assert.equal(ownerRow.salt.length, 32);
    const tokenRows = sqlite.prepare('SELECT token_hash AS hash FROM rd_ai_token').all() as { hash: string }[];
    assert.equal(tokenRows.every((row) => row.hash !== readOnly.token && row.hash !== writer.token && row.hash !== rotated.token), true);
    assert.ok(tokenRows.some((row) => row.hash === createHash('sha256').update(readOnly.token).digest('hex')));
    const sessionRows = sqlite.prepare('SELECT session_hash AS hash FROM rd_owner_session').all() as { hash: string }[];
    const rawSession = cookie.slice(cookie.indexOf('=') + 1);
    assert.equal(sessionRows.some((row) => row.hash === rawSession), false);
    assert.ok(sessionRows.some((row) => row.hash === createHash('sha256').update(rawSession).digest('hex')));
  } finally { sqlite.close(); }

  assert.equal((await app.inject({ method: 'POST', url: `/api/ai-tokens/${readOnly.id}/revoke`, headers: ownerHeaders })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects', headers: readHeaders })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: ownerHeaders })).statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: ownerHeaders })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects', headers: ownerHeaders })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/ai-tokens', headers: ownerHeaders })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/ai-tokens', payload: {
    name: 'Local writer', scopes: ['spec:write'],
  } })).statusCode, 201);

  await app.close();
  app = createApp(path);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/auth/status' })).json(), { initialized: true });
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects', headers: rotatedHeaders })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password } })).statusCode, 200);
});

test('local Web can manage AI Tokens without initializing or logging in as Owner', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-local-web-'));
  const app = createApp(join(directory, 'forgeflow.db'));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });

  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/auth/status' })).json(), { initialized: false });
  const created = await app.inject({ method: 'POST', url: '/api/ai-tokens', payload: {
    name: 'Local agent', scopes: ['project:read'],
  } });
  assert.equal(created.statusCode, 201);
  assert.match(created.json<CreatedAiToken>().token, /^ffai_/);
  assert.equal((await app.inject({ method: 'GET', url: '/api/ai-tokens' })).json<AiTokenSummary[]>().length, 1);
});
