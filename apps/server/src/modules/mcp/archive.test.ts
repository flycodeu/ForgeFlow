import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArchiveDocumentDetail, CreatedAiToken, Project, WorkEventReceipt } from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('MCP archive accepts original documents and free work records without task authorization', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-mcp-archive-'));
  const app = createApp(join(directory, 'test.db'));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const projectResponse = await app.inject({ method: 'POST', url: '/api/projects', payload: {
    projectKey: 'SELF_ARCHIVE', name: '项目档案验证', workflowMode: 'CONTROLLED',
  } });
  assert.equal(projectResponse.statusCode, 201);
  const project = projectResponse.json<Project>();
  const tokenResponse = await app.inject({ method: 'POST', url: '/api/ai-tokens', payload: {
    name: 'archive-integration-test', scopes: ['project:read', 'spec:read', 'spec:write'],
  } });
  const token = tokenResponse.json<CreatedAiToken>().token;
  const reader = (await app.inject({ method: 'POST', url: '/api/ai-tokens', payload: {
    name: 'archive-readonly-test', scopes: ['project:read', 'spec:read'],
  } })).json<CreatedAiToken>().token;
  let requestId = 0;
  const call = (name: string, args: object, secret = token) => app.inject({
    method: 'POST', url: '/mcp', headers: { host: '127.0.0.1:8787', authorization: `Bearer ${secret}`,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' },
    payload: { jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } },
  });
  const result = <T>(response: Awaited<ReturnType<typeof call>>) => {
    assert.equal(response.statusCode, 200, response.body);
    const data = response.json<{ result: { isError?: boolean; content: Array<{ text: string }> } }>().result;
    assert.equal(data.isError, undefined, response.body);
    return JSON.parse(data.content[0]!.text) as T;
  };
  const original = '\uFEFF# 自由格式\r\n\r\n无需十四节模板。\r\n';
  const document = result<ArchiveDocumentDetail>(await call('archive_project_document', {
    projectId: project.id, title: '自由文档', content: original, sourcePath: 'D:/project/design.md',
  }));
  assert.equal(document.content, original);
  const record = { projectId: project.id, operationId: 'plan-without-task', type: 'PLAN', title: '先探索再实现',
    content: '保留原方案格式，根据代码补充设计。未运行测试。', documentRevisionIds: [document.currentRevisionId] };
  const first = result<WorkEventReceipt>(await call('record_project_work', record));
  const again = result<WorkEventReceipt>(await call('record_project_work', record));
  assert.equal(first.committed, true);
  assert.equal(again.replayed, true);
  assert.equal(first.event.id, again.event.id);
  assert.equal(first.event.source.kind, 'ai_token');
  assert.equal(first.event.source.name, 'archive-integration-test');
  const continuation = result<WorkEventReceipt>(await call('record_project_work', {
    ...record, operationId: 'continue-design', type: 'DESIGN', workId: first.event.workId,
  }));
  assert.equal(continuation.event.workId, first.event.workId);
  const updated = result<ArchiveDocumentDetail>(await call('archive_project_document', {
    projectId: project.id, documentId: document.id, expectedRevisionId: document.currentRevisionId,
    title: '自由文档', content: `${original}\n新增取舍。`,
  }));
  assert.notEqual(updated.currentRevisionId, document.currentRevisionId);
  const history = result<unknown[]>(await call('get_project_document', { projectId: project.id, documentId: document.id, history: true }));
  assert.equal(history.length, 2);
  assert.equal((await call('record_project_work', { ...record, operationId: 'denied' }, reader)).statusCode, 403);
  const context = (await app.inject({ method: 'GET', url: `/api/projects/${project.id}` })).json<{ tasks: unknown[]; runs: unknown[] }>();
  assert.deepEqual(context.tasks, []);
  assert.deepEqual(context.runs, []);
  assert.match(result<{ planningProcess: string }>(await call('get_project_planning_context', { projectId: project.id },
    (await app.inject({ method: 'POST', url: '/api/ai-tokens', payload: { name: 'context-reader', scopes: ['project:read', 'spec:read', 'task:read'] } })).json<CreatedAiToken>().token)).planningProcess, /调研比较外部类似产品或方案的优缺点/);
});
