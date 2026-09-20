import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type {
  CreatedAiToken, DesignReview, Feature, Module, Project, ProjectDetail, SpecificationDetail,
  SpecificationRevision, SpecificationRevisionSummary, SpecificationSummary, Task, TaskAuthorization,
} from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('design review separates latest draft from approved baseline and gates task authorization', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-review-'));
  const app = createApp(join(directory, 'forgeflow.db'));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });

  const rest = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, token?: string) => {
    const response = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : undefined });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${method} ${url}: ${response.statusCode} ${response.body}`);
    return response.json<T>();
  };
  let requestId = 0;
  const call = (token: string, name: string, args: object) => app.inject({
    method: 'POST', url: '/mcp', headers: {
      host: '127.0.0.1:8787', accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25', authorization: `Bearer ${token}`,
    },
    payload: { jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } },
  });
  const toolValue = <T>(response: Awaited<ReturnType<typeof call>>) => {
    const body = response.json<{ result: { isError?: boolean; content: { text: string }[] } }>();
    assert.equal(body.result.isError, undefined, response.body);
    return JSON.parse(body.result.content[0]!.text) as T;
  };

  const project = await rest<Project>('POST', '/api/projects', { projectKey: 'REVIEW', name: '设计评审验证', workflowMode: 'CONTROLLED' });
  const base = `/api/projects/${project.id}`;
  const module = await rest<Module>('POST', `${base}/modules`, { code: 'IAM', name: '用户与权限', description: '', sortOrder: 0 });
  const feature = await rest<Feature>('POST', `${base}/features`, {
    moduleId: module.id, code: 'DEPARTMENT', name: '部门管理', summary: '维护部门树', status: 'DESIGNING', sortOrder: 0,
  });
  const specification = await rest<SpecificationSummary>('POST', `${base}/specifications`, {
    kind: 'feature-design', title: '部门管理功能设计', featureId: feature.id,
  });
  const specPath = `${base}/specifications/${specification.id}`;
  const revision1 = await rest<SpecificationRevision>('POST', `${specPath}/revisions`, {
    content: '# 功能目标\n维护部门树', changeSummary: '部门管理功能设计第一版', expectedHeadRevisionId: null,
  });
  let detail = await rest<SpecificationDetail>('GET', specPath);
  assert.equal(detail.latestRevision?.id, revision1.id);
  assert.equal(detail.approvedRevision, null);

  const planner = await rest<CreatedAiToken>('POST', '/api/ai-tokens', {
    name: 'codex-review', scopes: ['project:read', 'spec:read', 'planning:write', 'task:read'],
  });
  const review1 = toolValue<DesignReview>(await call(planner.token, 'submit_design_review', {
    specId: specification.id, revisionId: revision1.id,
  }));
  assert.equal(review1.status, 'PENDING');
  assert.equal((await rest<ProjectDetail>('GET', base)).reviews.filter((item) => item.status === 'PENDING').length, 1);

  const aiApproval = await app.inject({
    method: 'POST', url: `${base}/reviews/${review1.id}/decision`,
    headers: { authorization: `Bearer ${planner.token}` }, payload: { decision: 'APPROVED' },
  });
  assert.equal(aiApproval.statusCode, 403);
  const requested = await rest<DesignReview>('POST', `${base}/reviews/${review1.id}/decision`, {
    decision: 'CHANGES_REQUESTED', comment: '补充移动部门的边界规则',
  });
  assert.equal(requested.status, 'CHANGES_REQUESTED');
  assert.equal((await call(planner.token, 'submit_design_review', {
    specId: specification.id, revisionId: revision1.id,
  })).json<{ result: { isError: boolean } }>().result.isError, true);

  const revision2 = await rest<SpecificationRevision>('POST', `${specPath}/revisions`, {
    content: '# 功能目标\n维护部门树\n\n# 业务规则\n移动后不得形成循环层级',
    changeSummary: '补充部门移动边界', expectedHeadRevisionId: revision1.id,
  });
  const review2 = toolValue<DesignReview>(await call(planner.token, 'submit_design_review', {
    specId: specification.id, revisionId: revision2.id,
  }));
  await rest<DesignReview>('POST', `${base}/reviews/${review2.id}/decision`, {
    decision: 'APPROVED', comment: '边界完整，批准为实施基线',
  });
  detail = await rest<SpecificationDetail>('GET', specPath);
  assert.equal(detail.latestRevision?.id, revision2.id);
  assert.equal(detail.approvedRevision?.id, revision2.id);

  const revision3 = await rest<SpecificationRevision>('POST', `${specPath}/revisions`, {
    content: `${revision2.content}\n\n# 未决问题\n是否支持批量移动`, changeSummary: '记录批量移动未决问题',
    expectedHeadRevisionId: revision2.id,
  });
  detail = await rest<SpecificationDetail>('GET', specPath);
  assert.equal(detail.latestRevision?.id, revision3.id);
  assert.equal(detail.approvedRevision?.id, revision2.id);

  const task = await rest<Task>('POST', `${base}/features/${feature.id}/tasks`, {
    code: 'T01', name: '后端业务实现', type: 'BACKEND', status: 'PLANNED', objective: '实现部门增删改移动', sortOrder: 0,
  });
  const taskPath = `${base}/features/${feature.id}/tasks/${task.id}`;
  const draftBinding = await app.inject({ method: 'PATCH', url: taskPath, payload: {
    status: 'AUTHORIZED', designRevisionId: revision3.id,
  } });
  assert.equal(draftBinding.statusCode, 409);
  assert.equal(draftBinding.json().error.code, 'DESIGN_BASELINE_NOT_APPROVED');
  const authorizedTask = await rest<Task>('PATCH', taskPath, { status: 'AUTHORIZED', designRevisionId: revision2.id });
  assert.equal(authorizedTask.designRevisionId, revision2.id);
  const authorization = await rest<TaskAuthorization>('POST', `${taskPath}/authorizations`);
  assert.equal(authorization.status, 'ACTIVE');

  const history = await rest<SpecificationRevisionSummary[]>('GET', `${specPath}/revisions`);
  assert.deepEqual(history.map((item) => item.revisionNo), [3, 2, 1]);
  const featureContext = toolValue<{
    latestDesignRevision: SpecificationRevision; approvedDesignRevision: SpecificationRevision; reviewStatus: string | null;
  }>(await call(planner.token, 'get_feature_context', { featureId: feature.id }));
  assert.equal(featureContext.latestDesignRevision.id, revision3.id);
  assert.equal(featureContext.approvedDesignRevision.id, revision2.id);
  assert.equal(featureContext.reviewStatus, null);
  assert.deepEqual(toolValue<DesignReview[]>(await call(planner.token, 'get_pending_reviews', { projectId: project.id })), []);
});
