import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type {
  AiRun, Capability, CreatedAiToken, EngineeringAsset, EngineeringAssetRevision, Feature, Module, Project, ProjectSource,
  SpecificationRevision, SpecificationSummary, Task,
} from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('EngineeringAsset revisions and Run design/source snapshots remain immutable and become stale explicitly', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-asset-revision-'));
  const app = createApp(join(directory, 'forgeflow.db'));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });

  const request = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, token?: string) => {
    const response = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : undefined });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${method} ${url}: ${response.statusCode} ${response.body}`);
    return response.json<T>();
  };
  const project = await request<Project>('POST', '/api/projects', { projectKey: 'REV_SNAPSHOT', name: '设计快照项目', workflowMode: 'AUTO' });
  const base = `/api/projects/${project.id}`;
  const module = await request<Module>('POST', `${base}/modules`, { code: 'CORE', name: '核心', description: '', sortOrder: 0 });
  const feature = await request<Feature>('POST', `${base}/features`, { moduleId: module.id, code: 'USER', name: '用户管理', summary: '', status: 'DESIGNING', sortOrder: 0 });
  const capability = await request<Capability>('POST', `${base}/features/${feature.id}/capabilities`, { code: 'U-02', name: '新增用户', summary: '', sortOrder: 0 });
  const specification = await request<SpecificationSummary>('POST', `${base}/specifications`, { kind: 'feature-design', title: '用户管理设计', featureId: feature.id });
  const specRevision = await request<SpecificationRevision>('POST', `${base}/specifications/${specification.id}/revisions`, {
    content: '# 用户管理\n创建用户完整闭环', source: 'owner:1', changeSummary: '形成设计', expectedHeadRevisionId: null,
  });

  const assetV1 = await request<EngineeringAsset>('POST', `${base}/features/${feature.id}/engineering-assets`, {
    capabilityId: capability.id, kind: 'INTERFACE', name: '创建用户接口', changeSummary: '创建接口设计',
    structuredData: { method: 'POST', path: '/api/users', request: [{ name: 'username', type: 'string' }] },
    contentMarkdown: '# 设计原因\n接口用于新增用户。', status: 'DESIGNED',
  });
  assert.equal(assetV1.currentRevisionNo, 1);
  const historyV1 = await request<EngineeringAssetRevision[]>('GET', `${base}/engineering-assets/${assetV1.id}/revisions`);
  assert.equal(historyV1.length, 1);

  const assetV2 = await request<EngineeringAsset>('POST', `${base}/engineering-assets/${assetV1.id}/revisions`, {
    expectedCurrentRevisionId: assetV1.currentRevisionId, changeSummary: '补充幂等键',
    structuredData: { method: 'POST', path: '/api/users', request: [{ name: 'username', type: 'string' }, { name: 'requestId', type: 'string' }] },
    contentMarkdown: '# 设计原因\n使用 requestId 防止重复创建。',
  });
  assert.equal(assetV2.currentRevisionNo, 2);
  assert.equal((await request<EngineeringAssetRevision>('GET', `${base}/engineering-assets/${assetV1.id}/revisions/${historyV1[0]!.id}`)).revisionNo, 1);

  const staleWrite = await app.inject({ method: 'POST', url: `${base}/engineering-assets/${assetV1.id}/revisions`, payload: {
    expectedCurrentRevisionId: assetV1.currentRevisionId, changeSummary: '过期写入', structuredData: { method: 'POST', path: '/api/users' },
  } });
  assert.equal(staleWrite.statusCode, 409);
  assert.equal(staleWrite.json<{ error: { code: string } }>().error.code, 'ENGINEERING_ASSET_VERSION_CONFLICT');
  const conflicting = await app.inject({ method: 'POST', url: `${base}/engineering-assets/${assetV1.id}/revisions`, payload: {
    expectedCurrentRevisionId: assetV2.currentRevisionId, changeSummary: '冲突定义',
    structuredData: { method: 'POST', path: '/api/users' }, contentMarkdown: '方法：GET\n路径：/api/users', status: 'READY',
  } });
  assert.equal(conflicting.statusCode, 409);
  assert.equal(conflicting.json<{ error: { code: string } }>().error.code, 'ENGINEERING_ASSET_CANONICAL_CONFLICT');

  const sourceInput = (alias: string, path: string, key: string) => ({ alias, displayName: alias, purpose: '', sourceKind: 'GIT',
    environmentKey: 'test', localRoot: path, remoteUrl: null, repoSubdir: null, scope: null, idempotencyKey: key });
  const backend = await request<ProjectSource>('POST', `${base}/sources`, sourceInput('backend', 'D:\\Code\\api', 'rev-backend'));
  const web = await request<ProjectSource>('POST', `${base}/sources`, sourceInput('web', 'D:\\Code\\web', 'rev-web'));
  const task = await request<Task>('POST', `${base}/features/${feature.id}/tasks`, { capabilityId: capability.id, code: 'T01', name: '实现新增用户', type: 'OTHER', category: 'IMPLEMENTATION', area: 'cross-source', status: 'PLANNED', objective: '完成闭环', sortOrder: 0 });
  const token = await request<CreatedAiToken>('POST', '/api/ai-tokens', { name: 'snapshot-ai', scopes: ['spec:write'] });
  const initialExecutions = [backend, web].map((source) => ({ sourceId: source.id,
    baseline: { kind: 'GIT', commit: source.id === backend.id ? 'backend-base' : 'web-base', dirty: false, manifestHash: null },
    result: { commit: null, workingTreeSummary: null }, read: true, modified: false, changedFiles: [], verification: [],
  }));
  const run = await request<AiRun>('POST', `${base}/features/${feature.id}/tasks/${task.id}/runs`, { baseCommit: null, sourceExecutions: initialExecutions }, token.token);
  assert.ok(run.designSnapshot.specifications.some((item) => item.revisionId === specRevision.id));
  assert.ok(run.designSnapshot.engineeringAssets.some((item) => item.revisionId === assetV2.currentRevisionId && item.revisionNo === 2));
  assert.equal(run.designSnapshotStatus, 'CURRENT');
  assert.equal(run.sourceExecutions.length, 2);

  const completedExecutions = initialExecutions.map((execution) => ({ ...execution, modified: true,
    result: { commit: execution.sourceId === backend.id ? 'backend-result' : 'web-result', workingTreeSummary: '1 file changed' },
    changedFiles: [{ sourceId: execution.sourceId, relativePath: 'src/index.ts' }],
    verification: [{ command: 'pnpm test', workdir: '.', reportedStatus: 'PASS', summary: 'AI 执行命令并报告通过' }],
  }));
  const submitted = await request<AiRun>('POST', `${base}/runs/${run.id}/submit`, {
    summary: '新增用户已实现', resultCommit: null,
    changedFiles: [{ sourceId: backend.id, relativePath: 'src/index.ts' }, { sourceId: web.id, relativePath: 'src/index.ts' }],
    verificationSummary: { reportedStatus: 'PASS', summary: '两个 Source 均由 AI 报告通过' }, issues: [], sourceExecutions: completedExecutions,
  }, token.token);
  assert.equal(submitted.verificationSummary?.origin, 'AI_REPORTED');
  assert.equal(submitted.verificationSummary?.evidenceStatus, 'REPORTED');
  assert.deepEqual(submitted.changedFiles.map((file) => typeof file === 'string' ? file : `${file.sourceId}:${file.relativePath}`),
    [`${backend.id}:src/index.ts`, `${web.id}:src/index.ts`]);

  const assetV3 = await request<EngineeringAsset>('POST', `${base}/engineering-assets/${assetV1.id}/revisions`, {
    expectedCurrentRevisionId: assetV2.currentRevisionId, changeSummary: '调整返回契约',
    structuredData: { method: 'POST', path: '/api/users', response: [{ name: 'userId', type: 'uuid' }] },
    contentMarkdown: '# 设计原因\n返回稳定 userId。',
  });
  assert.equal(assetV3.currentRevisionNo, 3);
  const historical = await request<AiRun>('GET', `${base}/runs/${run.id}`);
  assert.equal(historical.designSnapshotStatus, 'STALE');
  assert.ok(historical.designSnapshotWarnings.includes('EngineeringAsset 版本已变化'));
  assert.ok(historical.designSnapshot.engineeringAssets.some((item) => item.revisionId === assetV2.currentRevisionId));

  const nextTask = await request<Task>('POST', `${base}/features/${feature.id}/tasks`, { capabilityId: capability.id, code: 'T02', name: '适配新返回契约', type: 'OTHER', category: 'IMPLEMENTATION', area: 'backend', status: 'PLANNED', objective: '适配 REV 3', sortOrder: 1 });
  const nextRun = await request<AiRun>('POST', `${base}/features/${feature.id}/tasks/${nextTask.id}/runs`, { baseCommit: null }, token.token);
  assert.ok(nextRun.designSnapshot.engineeringAssets.some((item) => item.revisionId === assetV3.currentRevisionId && item.revisionNo === 3));
});
