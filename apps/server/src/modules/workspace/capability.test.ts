import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type {
  AiRun, Capability, CapabilityDesignGuidance, CapabilityDetail, CreatedAiToken, Feature, Module,
  Project, ProjectLifecycle, ProjectSource, Task,
} from '@forgeflow/contracts';
import { createApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import { WorkspaceRepository } from './workspace.repository.js';
import { WorkspaceService } from './workspace.service.js';

test('AUTO Capability flow adapts design, executes without authorization, and rolls up real progress', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-capability-'));
  const app = createApp(join(directory, 'forgeflow.db'));
  let connection: ReturnType<typeof openDatabase> | null = null;
  t.after(async () => { await app.close(); connection?.sqlite.close(); rmSync(directory, { recursive: true, force: true }); });

  const rest = async <T>(method: 'GET' | 'POST', url: string, payload?: object) => {
    const response = await app.inject({ method, url, payload });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${method} ${url}: ${response.statusCode} ${response.body}`);
    return response.json<T>();
  };
  let requestId = 0;
  const mcp = (token: string, name: string, args: object) => app.inject({
    method: 'POST', url: '/mcp', headers: {
      host: '127.0.0.1:8787', accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25', authorization: `Bearer ${token}`,
    },
    payload: { jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } },
  });
  const value = <T>(response: Awaited<ReturnType<typeof mcp>>) => {
    const body = response.json<{ result: { isError?: boolean; content: { text: string }[] } }>();
    assert.equal(body.result.isError, undefined, response.body);
    return JSON.parse(body.result.content[0]!.text) as T;
  };

  const project = await rest<Project>('POST', '/api/projects', {
    projectKey: 'AUTO_CAP', name: 'AUTO Capability', projectType: 'Vue Fastify Web', designProfile: 'web',
  });
  assert.equal(project.workflowMode, 'AUTO');
  assert.equal(project.designProfile, 'web');
  const base = `/api/projects/${project.id}`;
  const module = await rest<Module>('POST', `${base}/modules`, { code: 'IAM', name: '用户权限', description: '', sortOrder: 0 });
  const feature = await rest<Feature>('POST', `${base}/features`, { moduleId: module.id, code: 'USR', name: '用户管理', summary: '', status: 'DRAFT', sortOrder: 0 });
  const token = await rest<CreatedAiToken>('POST', '/api/ai-tokens', { name: 'codex-capability', scopes: ['project:read', 'spec:read', 'planning:write', 'task:read', 'run:write'] });
  const initialized = await app.inject({ method: 'POST', url: '/mcp', headers: {
    host: '127.0.0.1:8787', accept: 'application/json, text/event-stream', 'content-type': 'application/json',
    'mcp-protocol-version': '2025-11-25', authorization: `Bearer ${token.token}`,
  }, payload: { jsonrpc: '2.0', id: ++requestId, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } } });
  assert.equal(initialized.statusCode, 200);

  const capability = value<Capability>(await mcp(token.token, 'create_capability', {
    projectId: project.id, featureId: feature.id, code: 'U-02', name: '新增用户', summary: '完整创建用户闭环', sortOrder: 10,
  }));
  const forgedCapability = await app.inject({ method: 'POST', url: `${base}/features/${feature.id}/capabilities`, payload: {
    code: 'FAKE_DONE', name: '未实施能力', summary: '', status: 'DONE', sortOrder: 11,
  } });
  assert.equal(forgedCapability.statusCode, 409);
  assert.equal(forgedCapability.json<{ error: { code: string } }>().error.code, 'CAPABILITY_STATUS_MANAGED');
  const forgedStatus = await app.inject({ method: 'PATCH', url: `${base}/features/${feature.id}/capabilities/${capability.id}`,
    payload: { status: 'DONE' } });
  assert.equal(forgedStatus.statusCode, 409);
  const guidance = value<CapabilityDesignGuidance>(await mcp(token.token, 'get_capability_design_guidance', { capabilityId: capability.id }));
  assert.equal(guidance.profile, 'WEB');
  assert.match(guidance.markdownTemplate, /API \/ 协议/);
  assert.match(guidance.markdownTemplate, /### 输入字段/);
  assert.match(guidance.markdownTemplate, /### 处理与异常/);
  assert.doesNotMatch(guidance.markdownTemplate, /当前实现状态/);
  const placeholder = await mcp(token.token, 'create_capability_design', {
    capabilityId: capability.id, changeSummary: '未填写模板', content: guidance.markdownTemplate,
  });
  assert.equal(placeholder.json<{ result: { isError: boolean } }>().result.isError, true);
  value(await mcp(token.token, 'create_capability_design', { capabilityId: capability.id, changeSummary: '初版',
    content: '# U-02 新增用户\n\n管理员建立账号。\n\n### 输入字段\n\n账号和昵称必填。\n\n### 输出与状态\n\n新账号启用。\n\n### 处理与异常\n\n重复账号拒绝。\n\n### 接口与数据\n\n写用户记录。\n\n### 验收要点\n\n并发同名只创建一次。',
  }));
  const context = value<CapabilityDetail>(await mcp(token.token, 'get_capability_context', { projectId: project.id, featureId: feature.id, capabilityId: capability.id }));
  assert.equal(context.design?.latestRevision?.revisionNo, 1);
  assert.equal(context.implementationRevision?.id, context.design?.latestRevision?.id);
  assert.equal((await rest<Feature>('GET', `${base}/features/${feature.id}`)).status, 'DESIGNING',
    'a saved but unreviewed design does not make a feature ready for implementation');

  const task = value<Task>(await mcp(token.token, 'create_task_plan', {
    featureId: feature.id, capabilityId: capability.id, code: 'T-U02', name: '实现新增用户', type: 'OTHER',
    category: 'IMPLEMENTATION', area: 'user', objective: '按 Capability Design 完成代码与测试', sortOrder: 10,
  }));
  const source = await rest<ProjectSource>('POST', `${base}/sources`, {
    alias: 'user-service', displayName: '用户服务源码', purpose: '用户创建实现与测试', sourceKind: 'GIT',
    environmentKey: 'local', localRoot: '/workspace/user-service', remoteUrl: null, repoSubdir: null,
    idempotencyKey: 'user-service-source',
  });
  const sourceBaseline = {
    sourceId: source.id, baseline: { kind: 'GIT', commit: 'base123', dirty: false, manifestHash: null },
    result: { commit: null, workingTreeSummary: null }, read: true, modified: false,
    changedFiles: [], verification: [],
  };
  const passingSource = {
    ...sourceBaseline, result: { commit: 'done123', workingTreeSummary: null }, modified: true,
    changedFiles: [{ sourceId: source.id, relativePath: 'UserService.ts' }],
    verification: [{ command: 'pnpm test', workdir: '/workspace/user-service', reportedStatus: 'PASS', summary: 'UserServiceTest 通过' }],
  };
  const malformedSource = await app.inject({ method: 'POST', url: `${base}/features/${feature.id}/tasks/${task.id}/runs`,
    payload: { baseCommit: 'base123', sourceExecutions: [{ sourceId: source.id }] } });
  assert.equal(malformedSource.statusCode, 400);
  assert.equal(malformedSource.json<{ error: { code: string } }>().error.code, 'INVALID_SOURCE_EXECUTIONS');
  const run = value<AiRun>(await mcp(token.token, 'start_run', {
    taskId: task.id, baseCommit: 'base123', sourceExecutions: [sourceBaseline],
  }));
  assert.equal(run.authorizationId, null);
  const rewrittenTask = await app.inject({ method: 'PATCH', url: `${base}/features/${feature.id}/tasks/${task.id}`,
    payload: { objective: '执行中悄悄改掉目标' } });
  assert.equal(rewrittenTask.statusCode, 409);
  assert.equal(rewrittenTask.json<{ error: { code: string } }>().error.code, 'TASK_RUN_HISTORY_IMMUTABLE');
  const unsupportedPass = await mcp(token.token, 'submit_run_result', {
    runId: run.id, resultCommit: 'done123', summary: '只填 PASS，没有可追溯执行证据', changedFiles: [],
    verificationSummary: { status: 'PASS', summary: '自报通过' }, issues: [],
  });
  assert.equal(unsupportedPass.json<{ result: { isError?: boolean; content: { text: string }[] } }>().result.isError, true);
  assert.equal(JSON.parse(unsupportedPass.json<{ result: { content: { text: string }[] } }>().result.content[0]!.text).code,
    'RUN_PASS_EVIDENCE_REQUIRED');
  value<AiRun>(await mcp(token.token, 'submit_run_result', {
    runId: run.id, resultCommit: 'done123', summary: '实现完成',
    changedFiles: [{ sourceId: source.id, relativePath: 'UserService.ts' }],
    verificationSummary: { status: 'PASS', summary: 'UserServiceTest PASS' }, issues: [], sourceExecutions: [passingSource],
  }));
  const finished = await rest<CapabilityDetail>('GET', `${base}/features/${feature.id}/capabilities/${capability.id}`);
  assert.equal(finished.capability.status, 'DONE');
  assert.equal(finished.tasks[0]?.status, 'DONE');
  assert.equal(finished.runs[0]?.verificationSummary?.status, 'PASS');
  const lifecycle = await rest<ProjectLifecycle>('GET', `${base}/lifecycle`);
  assert.equal(lifecycle.stages.find((stage) => stage.key === 'implementation')?.summary, '1 / 1 标记已实施，需核验');
  assert.equal(lifecycle.stages.find((stage) => stage.key === 'verification')?.summary, '0 / 1 有当前记录 · 本机复核 0 · 独立 CI 0');
  assert.equal(lifecycle.stages.find((stage) => stage.key === 'complete')?.summary, '0 / 1 已标记验收');
  assert.equal((await rest<Feature>('GET', `${base}/features/${feature.id}`)).status, 'VERIFYING');
  const projectContext = value<{ featureEvidence: Array<{
    featureId: string; currentVerification: string; acceptance: string;
    latestReport: { origin: string; reportedStatus: string } | null;
  }> }>(await mcp(token.token, 'get_project_context', { projectId: project.id }));
  assert.deepEqual(projectContext.featureEvidence.find((item) => item.featureId === feature.id), {
    featureId: feature.id, status: 'VERIFYING',
    design: null,
    capabilityDesigns: [{ capabilityId: capability.id, specificationId: context.design!.specification.id,
      latestRevisionId: context.design!.latestRevision!.id, approvedRevisionId: null }],
    latestReport: { runId: run.id, submittedAt: finished.runs[0]!.submittedAt, reportedStatus: 'PASS',
      origin: 'AI_REPORTED', evidenceStatus: 'REPORTED', trustStatus: 'REPORTED', manualReview: null,
      designSnapshotStatus: 'CURRENT', designSnapshotWarnings: [] },
    verificationCoverage: { passed: 0, total: 1 },
    verificationSources: { manualPassed: 0, independentPassed: 0 },
    currentVerification: 'UNVERIFIED', acceptance: 'NOT_RECORDED',
  });
  const aiAcceptance = await app.inject({ method: 'PATCH', url: `${base}/features/${feature.id}`,
    headers: { authorization: `Bearer ${token.token}` }, payload: { status: 'ACCEPTED' } });
  assert.equal(aiAcceptance.statusCode, 403);

  const verificationTask = async (code: string) => {
    const item = await rest<Task>('POST', `${base}/features/${feature.id}/tasks`, {
      code, name: code, type: 'VERIFICATION', category: 'VERIFICATION', capabilityId: capability.id,
      objective: '核对当前能力', status: 'PLANNED', sortOrder: 20,
    });
    const execution = await rest<AiRun>('POST', `${base}/features/${feature.id}/tasks/${item.id}/runs`, {
      baseCommit: null, sourceExecutions: [sourceBaseline],
    });
    return execution;
  };
  const humanRun = await verificationTask('HUMAN_CHECK');
  await rest<AiRun>('POST', `${base}/runs/${humanRun.id}/submit`, { summary: '人工报告测试通过', resultCommit: null,
    changedFiles: [], verificationSummary: { status: 'PASS', summary: '人工报告' }, issues: [],
    sourceExecutions: [{ ...sourceBaseline, verification: passingSource.verification }],
  });
  assert.equal((await rest<ProjectLifecycle>('GET', `${base}/lifecycle`)).stages.find((stage) => stage.key === 'verification')?.summary,
    '0 / 1 有当前记录 · 本机复核 0 · 独立 CI 0');

  connection = openDatabase(join(directory, 'forgeflow.db'));
  const workspace = new WorkspaceService(new WorkspaceRepository(connection));
  const ciRun = await verificationTask('CI_CHECK');
  assert.throws(() => workspace.submitRun(project.id, ciRun.id, {
    summary: '自称 CI 校验', resultCommit: null, changedFiles: [],
    verificationSummary: { reportedStatus: 'PASS', summary: 'CI PASS', origin: 'CI' }, issues: [],
  }), { code: 'VERIFICATION_ORIGIN_RESERVED' });
  await rest<AiRun>('POST', `${base}/runs/${ciRun.id}/submit`, {
    summary: '本地人工核对', resultCommit: null, changedFiles: [],
    verificationSummary: { status: 'PASS', summary: '本地记录' }, issues: [],
    sourceExecutions: [{ ...sourceBaseline, verification: passingSource.verification }],
  });
  const reviewPayload = { decision: 'PASS', summary: '本机复核：检查测试报告与关联源码', evidenceRefs: [
    { kind: 'SOURCE_FILE', sourceId: source.id, relativePath: 'UserService.ts' },
    { kind: 'HTTPS_URL', url: 'https://example.com/checks/user-service/123' },
  ] };
  const aiReview = await app.inject({ method: 'POST', url: `${base}/runs/${ciRun.id}/manual-review`,
    headers: { authorization: `Bearer ${token.token}` }, payload: reviewPayload });
  assert.equal(aiReview.statusCode, 403);
  const insecureEvidence = await app.inject({ method: 'POST', url: `${base}/runs/${ciRun.id}/manual-review`,
    payload: { ...reviewPayload, evidenceRefs: [{ kind: 'HTTPS_URL', url: 'http://example.com/test' }] } });
  assert.equal(insecureEvidence.statusCode, 400);
  const reviewed = await rest<AiRun>('POST', `${base}/runs/${ciRun.id}/manual-review`, reviewPayload);
  assert.equal(reviewed.verificationSummary?.origin, 'HUMAN');
  assert.equal(reviewed.verificationSummary?.evidenceStatus, 'REPORTED');
  assert.equal(reviewed.verificationSummary?.manualReview?.recordedBy, 'LOCAL_WEB');
  assert.equal(reviewed.verificationSummary?.manualReview?.evidenceRefs.length, 2);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/runs/${ciRun.id}/manual-review`, payload: reviewPayload })).statusCode, 409);
  assert.deepEqual((await rest<ProjectLifecycle>('GET', `${base}/lifecycle`)).manualReview, { passed: 1, failed: 0 });
  assert.equal((await rest<ProjectLifecycle>('GET', `${base}/lifecycle`)).stages.find((stage) => stage.key === 'verification')?.summary,
    '1 / 1 有当前记录 · 本机复核 1 · 独立 CI 0');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const supersedingRun = await verificationTask('SUPERSEDING_CHECK');
  assert.deepEqual((await rest<ProjectLifecycle>('GET', `${base}/lifecycle`)).manualReview, { passed: 0, failed: 0 },
    '较新的 RUNNING Run 使旧本机复核不再代表当前状态');
  const pendingContext = value<{ featureEvidence: Array<{ verificationCoverage: { passed: number; total: number } }> }>(
    await mcp(token.token, 'get_project_context', { projectId: project.id }));
  assert.deepEqual(pendingContext.featureEvidence.find((item) => item.verificationCoverage.total === 1)?.verificationCoverage,
    { passed: 0, total: 1 });
  await rest<AiRun>('POST', `${base}/runs/${supersedingRun.id}/submit`, {
    summary: '再次核对', resultCommit: null, changedFiles: [],
    verificationSummary: { status: 'PASS', summary: '再次通过' }, issues: [],
    sourceExecutions: [{ ...sourceBaseline, verification: passingSource.verification }],
  });
  await rest<AiRun>('POST', `${base}/runs/${supersedingRun.id}/manual-review`, {
    decision: 'PASS', summary: '复核最新报告', evidenceRefs: [{ kind: 'HTTPS_URL', url: 'https://example.com/checks/user-service/124' }],
  });
  assert.deepEqual((await rest<ProjectLifecycle>('GET', `${base}/lifecycle`)).manualReview, { passed: 1, failed: 0 });
  const planning = value<{ featureEvidence: Array<{ featureId: string; currentVerification: string;
    verificationCoverage: { passed: number; total: number } }> }>(
    await mcp(token.token, 'get_project_planning_context', { projectId: project.id }));
  assert.equal(planning.featureEvidence.find((item) => item.featureId === feature.id)?.currentVerification, 'PASS');
  assert.deepEqual(planning.featureEvidence.find((item) => item.featureId === feature.id)?.verificationCoverage,
    { passed: 1, total: 1 });
  await rest<Capability>('POST', `${base}/features/${feature.id}/capabilities`, {
    code: 'U-03', name: '停用用户', summary: '停用时撤销访问', sortOrder: 20,
  });
  const partial = value<{ featureEvidence: Array<{ featureId: string; currentVerification: string;
    verificationCoverage: { passed: number; total: number } }> }>(
    await mcp(token.token, 'get_project_context', { projectId: project.id }));
  assert.deepEqual(partial.featureEvidence.find((item) => item.featureId === feature.id)?.verificationCoverage,
    { passed: 1, total: 2 });
  assert.equal(partial.featureEvidence.find((item) => item.featureId === feature.id)?.currentVerification, 'UNVERIFIED');
  await rest('POST', `${base}/specifications/${context.design!.specification.id}/revisions`, {
    content: '# 功能目标\n修订新增用户行为和验收条件。', changeSummary: '更新设计后需重新核验',
    expectedHeadRevisionId: context.design!.latestRevision!.id,
  });
  assert.equal((await rest<ProjectLifecycle>('GET', `${base}/lifecycle`)).stages.find((stage) => stage.key === 'verification')?.summary,
    '0 / 2 有当前记录 · 本机复核 0 · 独立 CI 0');
  const staleReview = await app.inject({ method: 'POST', url: `${base}/runs/${humanRun.id}/manual-review`,
    payload: { decision: 'PASS', summary: '旧设计复核', evidenceRefs: [{ kind: 'HTTPS_URL', url: 'https://example.com/old-run' }] } });
  assert.equal(staleReview.statusCode, 409);
  assert.equal(staleReview.json<{ error: { code: string } }>().error.code, 'RUN_DESIGN_STALE');

  const retryTask = await rest<Task>('POST', `${base}/features/${feature.id}/tasks`, {
    code: 'RETRY-CHECK', name: '按新设计重试', type: 'OTHER', category: 'IMPLEMENTATION', capabilityId: capability.id,
    objective: '验证设计更新后的执行快照及复核失败后的重跑', status: 'PLANNED', sortOrder: 30,
    designRevisionId: context.design!.latestRevision!.id,
  });
  const retryPath = `${base}/features/${feature.id}/tasks/${retryTask.id}`;
  const firstRetryRun = await rest<AiRun>('POST', `${retryPath}/runs`, {
    baseCommit: 'base123', sourceExecutions: [sourceBaseline],
  });
  assert.equal(firstRetryRun.designSnapshotStatus, 'CURRENT', 'AUTO 新 Run 不应冻结 Task 旧设计修订');
  await rest<AiRun>('POST', `${base}/runs/${firstRetryRun.id}/submit`, {
    summary: '发现问题', resultCommit: null, changedFiles: [],
    verificationSummary: { status: 'FAIL', summary: '需要修复' }, issues: ['未覆盖异常路径'],
  });
  const head = (await rest<CapabilityDetail>('GET', `${base}/features/${feature.id}/capabilities/${capability.id}`)).design!.latestRevision!;
  await rest('POST', `${base}/specifications/${context.design!.specification.id}/revisions`, {
    content: '# 功能目标\n按新设计修复异常路径，并验证重试执行。', changeSummary: '明确重跑要求',
    expectedHeadRevisionId: head.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const secondRetryRun = await rest<AiRun>('POST', `${retryPath}/runs`, {
    baseCommit: 'base123', sourceExecutions: [sourceBaseline],
  });
  assert.equal(secondRetryRun.designSnapshotStatus, 'CURRENT', 'AUTO 重跑须按当前设计冻结快照');
  assert.equal((await rest<Task>('GET', retryPath)).designRevisionId, head.id,
    '已有 Run 的 Task 保留最初绑定设计，实际重跑设计由 Run 快照记录');
  await rest<AiRun>('POST', `${base}/runs/${secondRetryRun.id}/submit`, {
    summary: '已修复但仍有待查项', resultCommit: 'retry123',
    changedFiles: [{ sourceId: source.id, relativePath: 'UserService.ts' }],
    verificationSummary: { status: 'PASS', summary: '测试命令自报通过' }, issues: ['人工仍需核查一项'],
    sourceExecutions: [passingSource],
  });
  const evidence = [{ kind: 'HTTPS_URL', url: 'https://example.com/checks/retry' }];
  const oldReview = await app.inject({ method: 'POST', url: `${base}/runs/${firstRetryRun.id}/manual-review`,
    payload: { decision: 'FAIL', summary: '旧 Run 不能复核', evidenceRefs: evidence } });
  assert.equal(oldReview.statusCode, 409);
  assert.equal(oldReview.json<{ error: { code: string } }>().error.code, 'RUN_NOT_LATEST');
  const issuesReview = await app.inject({ method: 'POST', url: `${base}/runs/${secondRetryRun.id}/manual-review`,
    payload: { decision: 'PASS', summary: '不能忽略问题', evidenceRefs: evidence } });
  assert.equal(issuesReview.statusCode, 409);
  assert.equal(issuesReview.json<{ error: { code: string } }>().error.code, 'MANUAL_REVIEW_RUN_ISSUES');
  await rest<AiRun>('POST', `${base}/runs/${secondRetryRun.id}/manual-review`, {
    decision: 'FAIL', summary: '问题尚未解决', evidenceRefs: evidence,
  });
  assert.equal((await rest<Task>('GET', retryPath)).status, 'BLOCKED');
  assert.equal((await rest<CapabilityDetail>('GET', `${base}/features/${feature.id}/capabilities/${capability.id}`)).capability.status, 'BLOCKED');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await rest<AiRun>('POST', `${retryPath}/runs`, {
    baseCommit: 'base123', sourceExecutions: [sourceBaseline],
  })).designSnapshotStatus, 'CURRENT', '本机复核 FAIL 后允许 AUTO Task 重新执行');

  for (const sample of [
    { key: 'GODOT', type: 'Godot 4.4 2D', profile: 'game', name: '使用物品', include: /Scene \/ Node/, exclude: /API \/ 协议|Controller|数据库表/ },
    { key: 'RTSP', type: 'C++20 RTSP FFmpeg', profile: 'pipeline', name: 'Decode', include: /Codec \/ FFmpeg/, exclude: /Frontend|DTO|Controller/ },
  ]) {
    const adaptiveProject = await rest<Project>('POST', '/api/projects', { projectKey: sample.key, name: sample.key, projectType: sample.type, designProfile: sample.profile });
    const adaptiveModule = await rest<Module>('POST', `/api/projects/${adaptiveProject.id}/modules`, { code: 'CORE', name: 'Core', description: '', sortOrder: 0 });
    const adaptiveFeature = await rest<Feature>('POST', `/api/projects/${adaptiveProject.id}/features`, { moduleId: adaptiveModule.id, code: 'MAIN', name: sample.name, summary: '', status: 'DRAFT', sortOrder: 0 });
    const adaptiveCapability = await rest<Capability>('POST', `/api/projects/${adaptiveProject.id}/features/${adaptiveFeature.id}/capabilities`, { code: 'CAP-01', name: sample.name, summary: '', sortOrder: 0 });
    const adaptiveGuidance = await rest<CapabilityDesignGuidance>('GET', `/api/projects/${adaptiveProject.id}/features/${adaptiveFeature.id}/capabilities/${adaptiveCapability.id}/design-guidance`);
    assert.match(adaptiveGuidance.markdownTemplate, sample.include);
    assert.doesNotMatch(adaptiveGuidance.markdownTemplate, sample.exclude);
  }

  const designProject = await rest<Project>('POST', '/api/projects', {
    projectKey: 'DESIGN_ONLY', name: '设计与内容任务', projectType: 'Web', designProfile: 'web',
  });
  const designBase = `/api/projects/${designProject.id}`;
  const designModule = await rest<Module>('POST', `${designBase}/modules`, {
    code: 'DOC', name: '文档', description: '', sortOrder: 0,
  });
  const designFeature = await rest<Feature>('POST', `${designBase}/features`, {
    moduleId: designModule.id, code: 'PLAN', name: '方案', summary: '', status: 'DRAFT', sortOrder: 0,
  });
  const designCapability = await rest<Capability>('POST', `${designBase}/features/${designFeature.id}/capabilities`, {
    code: 'PLAN-01', name: '设计方案', summary: '', sortOrder: 0,
  });
  const designTaskPath = `${designBase}/features/${designFeature.id}/tasks`;
  const pureDesignTask = await rest<Task>('POST', designTaskPath, {
    code: 'D-01', name: '起草设计', type: 'DESIGN', category: 'DESIGN', capabilityId: designCapability.id,
    objective: '写出设计方案', status: 'PLANNED', sortOrder: 0,
  });
  const pureDesignRun = await rest<AiRun>('POST', `${designTaskPath}/${pureDesignTask.id}/runs`, { baseCommit: null });
  const designDetail = () => rest<CapabilityDetail>('GET', `${designBase}/features/${designFeature.id}/capabilities/${designCapability.id}`);
  assert.equal((await designDetail()).capability.status, 'DRAFT', '设计任务执行中不应显示实施中');
  const designReport = await rest<AiRun>('POST', `${designBase}/runs/${pureDesignRun.id}/submit`, {
    summary: '已起草方案', resultCommit: null, changedFiles: [],
    verificationSummary: { status: 'PASS', summary: '设计任务自报完成' }, issues: [],
  });
  assert.equal(designReport.verificationSummary?.evidenceStatus, 'REPORTED');
  assert.equal((await designDetail()).capability.status, 'DRAFT', '只有设计任务完成不能视为能力已实现');
  await rest('POST', `${designBase}/features/${designFeature.id}/capabilities/${designCapability.id}/design`, {
    changeSummary: '设计初版',
    content: '# PLAN-01 设计方案\n\n### 输入字段\n\n输入计划名称。\n\n### 输出与状态\n\n返回方案。\n\n### 处理与异常\n\n缺少输入时拒绝。\n\n### 接口与数据\n\n记录设计版本。\n\n### 验收要点\n\n核对版本。',
  });
  const contentTask = await rest<Task>('POST', designTaskPath, {
    code: 'C-01', name: '补充说明', type: 'OTHER', category: 'CONTENT', capabilityId: designCapability.id,
    objective: '补充学习说明', status: 'PLANNED', sortOrder: 1,
  });
  const contentRun = await rest<AiRun>('POST', `${designTaskPath}/${contentTask.id}/runs`, { baseCommit: null });
  await rest<AiRun>('POST', `${designBase}/runs/${contentRun.id}/submit`, {
    summary: '内容说明已整理', resultCommit: null, changedFiles: [],
    verificationSummary: { status: 'PASS', summary: '内容任务自报完成' }, issues: [],
  });
  assert.equal((await designDetail()).capability.status, 'DESIGNED', '只有非实施任务完成须保持设计状态');
  const backendTask = await rest<Task>('POST', designTaskPath, {
    code: 'B-01', name: '实现接口', type: 'BACKEND', category: 'CONTENT', capabilityId: designCapability.id,
    objective: '实现后端接口', status: 'PLANNED', sortOrder: 2,
  });
  const backendRun = await rest<AiRun>('POST', `${designTaskPath}/${backendTask.id}/runs`, { baseCommit: null });
  const unsupportedBackendPass = await app.inject({ method: 'POST', url: `${designBase}/runs/${backendRun.id}/submit`,
    payload: { summary: '没有源码证据', resultCommit: null, changedFiles: [],
      verificationSummary: { status: 'PASS', summary: '自报通过' }, issues: [] } });
  assert.equal(unsupportedBackendPass.statusCode, 422, '实施类型不能借 CONTENT 类别跳过源码证据');
  assert.equal(unsupportedBackendPass.json<{ error: { code: string } }>().error.code, 'RUN_PASS_EVIDENCE_REQUIRED');
});
