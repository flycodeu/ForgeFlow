import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AiRun, CreatedAiToken, EngineeringAsset, EngineeringAssetRevision, Feature, Module, Project, SpecificationRevision, SpecificationSummary, Task, TaskAuthorization } from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('MCP exposes scoped context tools and reuses the authorized Run state machine', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-mcp-'));
  const app = createApp(join(directory, 'forgeflow.db'));
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const rest = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, token?: string) => {
    const response = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : undefined });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${method} ${url}: ${response.statusCode} ${response.body}`);
    return response.json<T>();
  };
  let requestId = 0;
  const mcp = (token: string | undefined, method: string, params?: object) => app.inject({
    method: 'POST', url: '/mcp',
    headers: {
      host: '127.0.0.1:8787',
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    payload: { jsonrpc: '2.0', id: ++requestId, method, ...(params ? { params } : {}) },
  });
  const call = (token: string | undefined, name: string, args: object = {}) => mcp(token, 'tools/call', { name, arguments: args });
  const resultText = <T>(response: Awaited<ReturnType<typeof call>>) => {
    const json = response.json<{ result: { isError?: boolean; content: { text: string }[] } }>();
    assert.equal(json.result.isError, undefined, response.body);
    return JSON.parse(json.result.content[0]!.text) as T;
  };

  const project = await rest<Project>('POST', '/api/projects', { projectKey: 'MCP', name: 'MCP 联调项目', workflowMode: 'CONTROLLED' });
  const projectPath = `/api/projects/${project.id}`;
  const module = await rest<Module>('POST', `${projectPath}/modules`, {
    code: 'IAM', name: '用户与权限', description: 'MCP 联调', sortOrder: 1,
  });
  const feature = await rest<Feature>('POST', `${projectPath}/features`, {
    moduleId: module.id, code: 'P2-W03', name: '部门管理', summary: '部门管理闭环', status: 'DESIGNING', sortOrder: 1,
  });
  const designSpec = await rest<SpecificationSummary>('POST', `${projectPath}/specifications`, {
    kind: 'feature-design', title: '部门管理功能设计', featureId: feature.id,
  });
  const designRevision = await rest<SpecificationRevision>('POST', `${projectPath}/specifications/${designSpec.id}/revisions`, {
    content: '# 功能目标\n维护部门', changeSummary: '建立批准基线', expectedHeadRevisionId: null,
  });
  const designReview = await rest<{ id: string }>('POST', `${projectPath}/specifications/${designSpec.id}/revisions/${designRevision.id}/reviews`);
  await rest('POST', `${projectPath}/reviews/${designReview.id}/decision`, { decision: 'APPROVED', comment: 'MCP Run 测试基线' });
  const taskPath = `${projectPath}/features/${feature.id}/tasks`;
  const task = await rest<Task>('POST', taskPath, {
    code: 'T01', name: 'Backend Service', type: 'BACKEND', status: 'PLANNED', objective: '完成受控演示 Run', sortOrder: 1,
  });
  const authorizedTask = await rest<Task>('PATCH', `${taskPath}/${task.id}`, { status: 'AUTHORIZED', designRevisionId: designRevision.id });
  assert.equal(authorizedTask.status, 'AUTHORIZED');
  const authorization = await rest<TaskAuthorization>('POST', `${taskPath}/${task.id}/authorizations`);

  const token = await rest<CreatedAiToken>('POST', '/api/ai-tokens', {
    name: 'codex-local', scopes: ['project:read', 'spec:read', 'task:read', 'run:write'],
  });
  const noToken = await call(undefined, 'list_projects');
  assert.equal(noToken.statusCode, 401);

  const initialized = await mcp(token.token, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'forgeflow-test', version: '1.0.0' },
  });
  assert.equal(initialized.statusCode, 200, initialized.body);

  const listed = await mcp(token.token, 'tools/list');
  assert.equal(listed.statusCode, 200, listed.body);
  const toolNames = listed.json<{ result: { tools: { name: string }[] } }>().result.tools.map((item) => item.name);
  assert.deepEqual(toolNames.sort(), [
    'list_project_archive', 'get_project_document', 'archive_project_document', 'record_project_work', 'list_project_work',
    'create_capability', 'create_capability_design', 'create_feature', 'create_feature_design', 'create_module', 'create_project_draft',
    'create_project_spec', 'create_spec_revision', 'create_task_plan', 'create_engineering_asset', 'create_engineering_asset_revision', 'create_trace_link',
    'resolve_project_and_sources', 'upsert_project_source', 'request_source_analysis', 'claim_source_analysis', 'submit_source_analysis',
    'get_capability_context', 'get_capability_design_guidance', 'get_current_authorized_task', 'get_engineering_asset', 'get_engineering_asset_history', 'get_engineering_blueprint', 'get_feature_context', 'get_feature_delivery_context', 'get_feature_design_guidance', 'get_project_context', 'list_projects',
    'get_pending_reviews', 'get_project_planning_context', 'submit_design_review',
    'plan_engineering_blueprint', 'report_run_failure', 'start_run', 'submit_run_result', 'update_run_phase',
  ].sort());
  assert.deepEqual(toolNames.filter((name) => [
    'set_task_status', 'approve_task', 'authorize_task', 'confirm_task', 'set_feature_status',
    'approve_review', 'reject_review', 'set_approved_revision',
    'delete_project', 'execute_shell', 'read_arbitrary_file', 'write_arbitrary_file', 'git_commit', 'git_push', 'deploy',
  ].includes(name)), []);

  const projects = resultText<{ projectId: string }[]>(await call(token.token, 'list_projects'));
  assert.equal(projects[0]?.projectId, project.id);
  const context = resultText<{ project: Project; unfinishedTasks: Task[] }>(await call(token.token, 'get_project_context', { projectId: project.id }));
  assert.equal(context.project.id, project.id);
  assert.equal(context.unfinishedTasks[0]?.id, task.id);
  const featureContext = resultText<{ feature: Feature; module: Module; tasks: Task[] }>(await call(token.token, 'get_feature_context', { featureId: feature.id }));
  assert.equal(featureContext.module.id, module.id);
  assert.equal(featureContext.tasks[0]?.id, task.id);
  const guidance = resultText<{ coreSections: string[]; markdownTemplate: string; guardrails: string[] }>(
    await call(token.token, 'get_feature_design_guidance', { featureId: feature.id }),
  );
  assert.ok(guidance.coreSections.includes('范围与操作入口'));
  assert.match(guidance.markdownTemplate, /## 范围与操作入口/);
  assert.ok(guidance.guardrails.some((item) => item.includes('不得虚构')));
  const planner = await rest<CreatedAiToken>('POST', '/api/ai-tokens', {
    name: 'design-planner', scopes: ['project:read', 'spec:read', 'task:read', 'planning:write'],
  });
  const engineeringAsset = resultText<EngineeringAsset>(await call(planner.token, 'create_engineering_asset', {
    projectId: project.id, featureId: feature.id, kind: 'INTERFACE', name: '部门接口', changeSummary: '创建接口契约',
    structuredData: { method: 'GET', path: '/departments' }, contentMarkdown: '# 说明\n读取部门列表。',
  }));
  assert.equal(engineeringAsset.currentRevisionNo, 1);
  const engineeringAssetV2 = resultText<EngineeringAsset>(await call(planner.token, 'create_engineering_asset_revision', {
    projectId: project.id, assetId: engineeringAsset.id, expectedCurrentRevisionId: engineeringAsset.currentRevisionId,
    changeSummary: '补充分页参数', structuredData: { method: 'GET', path: '/departments', request: [{ name: 'page', type: 'integer' }] },
    contentMarkdown: '# 说明\n分页读取部门列表。',
  }));
  assert.equal(engineeringAssetV2.currentRevisionNo, 2);
  assert.equal(resultText<EngineeringAssetRevision[]>(await call(planner.token, 'get_engineering_asset_history', {
    projectId: project.id, assetId: engineeringAsset.id,
  })).length, 2);
  assert.equal(resultText<{ engineeringAssets: Array<{ currentRevisionNo: number }> }>(await call(planner.token, 'get_feature_delivery_context', {
    projectId: project.id, featureId: feature.id,
  })).engineeringAssets[0]?.currentRevisionNo, 2);
  const current = resultText<{ authorization: TaskAuthorization; executionBoundary: string }>(await call(token.token, 'get_current_authorized_task', { featureId: feature.id }));
  assert.equal(current.authorization.id, authorization.id);
  assert.match(current.executionBoundary, /不能自行进入后续 Task/);

  const readOnly = await rest<CreatedAiToken>('POST', '/api/ai-tokens', { name: 'read-only', scopes: ['project:read'] });
  assert.equal((await call(readOnly.token, 'start_run', { taskId: task.id, baseCommit: 'base123' })).statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: `${taskPath}/${task.id}/authorizations`, headers: {
    authorization: `Bearer ${token.token}`,
  } })).statusCode, 403);

  const started = resultText<AiRun>(await call(token.token, 'start_run', { taskId: task.id, baseCommit: 'base123' }));
  assert.equal(started.status, 'RUNNING');
  assert.equal(started.actorType, 'AI_TOKEN');
  assert.equal(started.actorName, 'codex-local');
  const duplicate = await call(token.token, 'start_run', { taskId: task.id, baseCommit: 'base456' });
  assert.equal(duplicate.statusCode, 200);
  assert.equal(duplicate.json<{ result: { isError: boolean } }>().result.isError, true);
  assert.equal(resultText<AiRun>(await call(token.token, 'update_run_phase', { runId: started.id, phase: 'IMPLEMENTING' })).phase, 'IMPLEMENTING');
  assert.equal(resultText<AiRun>(await call(token.token, 'update_run_phase', { runId: started.id, phase: 'TESTING' })).phase, 'TESTING');
  const backwards = await call(token.token, 'update_run_phase', { runId: started.id, phase: 'PREPARING' });
  assert.equal(backwards.json<{ result: { isError: boolean } }>().result.isError, true);
  const submitted = resultText<AiRun>(await call(token.token, 'submit_run_result', {
    runId: started.id, resultCommit: null, summary: '完成 MCP 受控演示 Run', changedFiles: [],
    verificationSummary: { status: 'PASS', summary: 'MCP protocol test passed' }, issues: [],
  }));
  assert.equal(submitted.status, 'SUBMITTED');
  assert.equal((await rest<Task>('GET', `${taskPath}/${task.id}`)).status, 'SUBMITTED');
  assert.equal((await rest<TaskAuthorization[]>('GET', `${taskPath}/${task.id}/authorizations`))[0]?.status, 'CONSUMED');
  assert.equal((await call(token.token, 'start_run', { taskId: task.id, baseCommit: null })).json<{ result: { isError: boolean } }>().result.isError, true);
  assert.equal((await app.inject({ method: 'POST', url: `${taskPath}/${task.id}/confirm`, headers: {
    authorization: `Bearer ${token.token}`,
  } })).statusCode, 403);
  assert.equal((await rest<Task>('POST', `${taskPath}/${task.id}/confirm`)).status, 'CONFIRMED');

  const failureTask = await rest<Task>('POST', taskPath, {
    code: 'T02', name: 'Failure history', type: 'BACKEND', status: 'PLANNED', objective: '验证失败 Run 历史', sortOrder: 2,
  });
  await rest<Task>('PATCH', `${taskPath}/${failureTask.id}`, { status: 'AUTHORIZED', designRevisionId: designRevision.id });
  const failureAuthorization = await rest<TaskAuthorization>('POST', `${taskPath}/${failureTask.id}/authorizations`);
  const failureRun = resultText<AiRun>(await call(token.token, 'start_run', { taskId: failureTask.id, baseCommit: null }));
  const failed = resultText<AiRun>(await call(token.token, 'report_run_failure', {
    runId: failureRun.id, status: 'FAILED', summary: '受控失败验证', issues: ['expected test failure'],
  }));
  assert.equal(failed.status, 'FAILED');
  assert.equal((await rest<Task>('GET', `${taskPath}/${failureTask.id}`)).status, 'AUTHORIZED');
  assert.equal((await rest<TaskAuthorization[]>('GET', `${taskPath}/${failureTask.id}/authorizations`))
    .find((item) => item.id === failureAuthorization.id)?.status, 'CONSUMED');

  const revoked = await rest<CreatedAiToken>('POST', '/api/ai-tokens', { name: 'revoked', scopes: ['project:read'] });
  await rest('POST', `/api/ai-tokens/${revoked.id}/revoke`);
  assert.equal((await call(revoked.token, 'list_projects')).statusCode, 401);
});
