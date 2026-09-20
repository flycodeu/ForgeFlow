import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ArchiveDocumentDetail, CreatedAiToken, EngineeringAssetRevision, Project, ProjectArchiveExport, WorkEventPage, WorkEventReceipt } from '@forgeflow/contracts';
import { createApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';

test('project archive preserves source text, revisions, idempotent events and project isolation across restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-archive-'));
  const path = join(directory, 'archive.db');
  let app = createApp(path);
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, token?: string) => {
    const response = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : undefined });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${method} ${url}: ${response.statusCode} ${response.body}`);
    return response.json<T>();
  };
  const project = await request<Project>('POST', '/api/projects', { projectKey: 'ARCHIVE', name: '档案', workflowMode: 'CONTROLLED' });
  const other = await request<Project>('POST', '/api/projects', { projectKey: 'OTHER', name: '另一项目' });
  const base = `/api/projects/${project.id}/archive`;
  const otherBase = `/api/projects/${other.id}/archive`;
  const original = { title: '自由设计', content: '\n# 自由设计\r\n\n不要求模板。  \n',
    originalFilename: '设计.md', sourcePath: 'D:\\workspace\\设计.md', contentType: 'text/markdown' };
  const document = await request<ArchiveDocumentDetail>('POST', `${base}/documents`, original);
  assert.equal(document.content, original.content);
  const duplicate = await request<ArchiveDocumentDetail>('POST', `${base}/documents`, original);
  assert.equal(duplicate.id, document.id);
  const changedImport = await app.inject({ method: 'POST', url: `${base}/documents`, payload: { ...original, content: 'changed' } });
  assert.equal(changedImport.statusCode, 409);
  assert.equal(changedImport.json().error.documentId, document.id);
  const current = await request<ArchiveDocumentDetail>('PATCH', `${base}/documents/${document.id}`,
    { ...original, title: '自由设计二', content: '第二次原文\n', expectedRevisionId: document.currentRevisionId, changeSummary: '补充内容' });
  assert.equal((await app.inject({ method: 'PATCH', url: `${base}/documents/${document.id}`, payload: {
    ...original, expectedRevisionId: document.currentRevisionId,
  } })).statusCode, 409);
  const history = await request<EngineeringAssetRevision[]>('GET', `${base}/documents/${document.id}/revisions`);
  assert.equal(history.length, 2);
  assert.equal(history.find((row) => row.id === document.currentRevisionId)?.contentMarkdown, original.content);
  assert.equal(history.find((row) => row.id === current.currentRevisionId)?.contentMarkdown, '第二次原文\n');
  assert.equal((await app.inject({ method: 'GET', url: `${otherBase}/documents/${document.id}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `${otherBase}/documents/${document.id}/revisions` })).statusCode, 404);
  const first = { operationId: 'plan-1', title: '调查现状', type: 'PLAN', content: '无需任务和审批即可记录。', documentRevisionIds: [document.currentRevisionId] };
  const receipt = await request<WorkEventReceipt>('POST', `${base}/events`, first);
  assert.equal(receipt.committed, true);
  assert.equal(receipt.event.workId, receipt.event.id);
  assert.equal(receipt.event.source.kind, 'local_web');
  assert.equal((await request<WorkEventReceipt>('POST', `${base}/events`, first)).event.id, receipt.event.id);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/events`, payload: { ...first, content: '不同内容' } })).statusCode, 409);
  const result = await request<WorkEventReceipt>('POST', `${base}/events`, { operationId: 'result', workId: receipt.event.workId,
    type: 'RESULT', title: 'AI自报完成', content: '仅记录，未执行额外验证。' });
  const late = await request<WorkEventReceipt>('POST', `${base}/events`, { operationId: 'late', workId: receipt.event.workId,
    type: 'PROGRESS', title: '补记早前进展', content: '', occurredAt: '2025-01-01T00:00:00Z' });
  assert.ok(late.event.sequence > result.event.sequence);
  const page = await request<WorkEventPage>('GET', `${base}/events?limit=2`);
  assert.equal(page.items.length, 2);
  assert.equal(page.nextCursor, result.event.sequence);
  assert.equal((await request<WorkEventPage>('GET', `${base}/events?before=${page.nextCursor}&limit=2`)).items[0]?.id, receipt.event.id);
  assert.equal((await app.inject({ method: 'GET', url: `${base}/events?limit=invalid` })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `${otherBase}/events`, payload: { ...first, workId: receipt.event.workId } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${otherBase}/events`, payload: first })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/events`, payload: { ...first, operationId: 'spoof', source: { kind: 'owner' } } })).statusCode, 400);
  const sourceBeforeRestart = receipt.event.source;
  await app.close();
  app = createApp(path);
  const retried = await request<WorkEventReceipt>('POST', `${base}/events`, first);
  assert.equal(retried.replayed, true);
  assert.equal(retried.event.id, receipt.event.id);
  assert.deepEqual(retried.event.source, sourceBeforeRestart);
  assert.equal((await request<ArchiveDocumentDetail>('GET', `${base}/documents/${document.id}`)).content, current.content);
  const snapshot = await request<ProjectArchiveExport>('GET', `${base}/export`);
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(snapshot.project.project.workflowMode, 'CONTROLLED');
  assert.equal(snapshot.project.tasks.length, 0);
  assert.equal(snapshot.project.runs.length, 0);
  assert.equal(snapshot.documents[0]?.revisions.length, 2);
  assert.equal(snapshot.events.length, 3);
  const deletion = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` });
  assert.equal(deletion.statusCode, 409);
  assert.equal(deletion.json().error.code, 'PROJECT_HAS_WORK_RECORDS');
  assert.equal((await request<ProjectArchiveExport>('GET', `${base}/export`)).documents.length, snapshot.documents.length);
  assert.ok(!JSON.stringify(snapshot).includes(other.id));
  const connection = openDatabase(path);
  try {
    assert.throws(() => connection.sqlite.prepare('UPDATE rd_work_event SET title = ? WHERE id = ?').run('rewrite', receipt.event.id), /append-only/);
    assert.throws(() => connection.sqlite.prepare('DELETE FROM rd_work_event WHERE id = ?').run(receipt.event.id), /append-only/);
  } finally { connection.sqlite.close(); }
});

test('archive enforces authentication and derives event identity without exporting system credentials', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-archive-auth-'));
  const app = createApp(join(directory, 'archive.db'));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const projectResponse = await app.inject({ method: 'POST', url: '/api/projects', payload: { projectKey: 'AUTHARCHIVE', name: '档案鉴权' } });
  const project = projectResponse.json<Project>();
  const base = `/api/projects/${project.id}/archive`;
  const token = async (name: string, scopes: string[]) => {
    const response = await app.inject({ method: 'POST', url: '/api/ai-tokens', payload: { name, scopes } });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<CreatedAiToken>();
  };
  const reader = await token('只读连接', ['project:read', 'spec:read']);
  const exportReader = await token('档案导出连接', ['project:read', 'spec:read', 'task:read']);
  const writer = await token('设计连接', ['spec:write']);
  const writer2 = await token('另一个设计连接', ['spec:write']);
  const payload = { operationId: 'AI-1', type: 'PLAN', title: '自由规划', content: '没有指定模板。' };
  assert.equal((await app.inject({ method: 'GET', url: `${base}/documents`, remoteAddress: '192.0.2.1' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/events`, payload, headers: { authorization: `Bearer ${reader.token}` } })).statusCode, 403);
  const saved = await app.inject({ method: 'POST', url: `${base}/events`, payload, headers: { authorization: `Bearer ${writer.token}` } });
  assert.equal(saved.statusCode, 201, saved.body);
  const event = saved.json<WorkEventReceipt>().event;
  assert.deepEqual(event.source, { kind: 'ai_token', name: '设计连接' });
  assert.equal((await app.inject({ method: 'POST', url: `${base}/events`, payload: { ...payload, workId: event.workId },
    headers: { authorization: `Bearer ${writer2.token}` } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: `${base}/export`, headers: { authorization: `Bearer ${reader.token}` } })).statusCode, 403);
  const exported = await app.inject({ method: 'GET', url: `${base}/export`, headers: { authorization: `Bearer ${exportReader.token}` } });
  assert.equal(exported.statusCode, 200);
  for (const forbidden of [writer.token, reader.token, writer2.token, 'tokenHash', 'passwordHash', 'sessionHash']) assert.ok(!exported.body.includes(forbidden));
  const invalid = await app.inject({ method: 'POST', url: `${base}/documents`, payload: { title: 'binary', content: 'data', contentType: 'application/pdf' } });
  assert.equal(invalid.statusCode, 400);
});
