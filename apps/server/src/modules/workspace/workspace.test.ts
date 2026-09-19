import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AiRun, CreatedAiToken, Feature, Module, Project, ProjectDetail, SpecificationDetail, SpecificationRevision, SpecificationRevisionSummary, SpecificationSummary, Task, TaskAuthorization } from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('Project and Specification revisions form a persistent, conflict-safe API flow', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-s1t03-'));
  let app = createApp(join(directory, 'forgeflow.db'));
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const initialized = await app.inject({ method: 'POST', url: '/api/auth/initialize', payload: {
    username: 'owner', password: 'test-only-password-123',
  } });
  assert.equal(initialized.statusCode, 201);
  const cookie = initialized.headers['set-cookie']?.toString().split(';')[0];
  assert.ok(cookie);
  const send = (options: { method: 'GET' | 'POST' | 'PATCH'; url: string; payload?: object }) =>
    app.inject({ ...options, headers: { cookie } });

  const invalidProject = await send({ method: 'POST', url: '/api/projects', payload: { projectKey: '!', name: '' } });
  assert.equal(invalidProject.statusCode, 400);
  const missingProject = await send({ method: 'GET', url: '/api/projects/missing' });
  assert.equal(missingProject.statusCode, 404);

  const createdProject = await send({ method: 'POST', url: '/api/projects', payload: { projectKey: 'pa', name: '项目 A' } });
  assert.equal(createdProject.statusCode, 201);
  const project = createdProject.json<Project>();
  assert.equal(project.projectKey, 'PA');
  assert.equal((await send({ method: 'POST', url: '/api/projects', payload: { projectKey: 'PA', name: '重复' } })).statusCode, 409);
  const projectList = (await send({ method: 'GET', url: '/api/projects' })).json<Project[]>();
  assert.deepEqual(projectList.map((item) => item.id), [project.id]);
  const projectPath = `/api/projects/${project.id}`;
  assert.equal((await send({ method: 'GET', url: projectPath })).json<ProjectDetail>().project.name, '项目 A');

  const createdModule = await send({ method: 'POST', url: `${projectPath}/modules`, payload: {
    code: 'iam', name: '用户与权限', description: '管理用户与访问入口', sortOrder: 1,
  } });
  assert.equal(createdModule.statusCode, 201);
  const module = createdModule.json<Module>();
  assert.equal(module.code, 'IAM');
  assert.equal((await send({ method: 'POST', url: `${projectPath}/modules`, payload: {
    code: 'IAM', name: '重复模块', sortOrder: 2,
  } })).statusCode, 409);
  const updatedModule = (await send({ method: 'PATCH', url: `${projectPath}/modules/${module.id}`, payload: {
    description: '用户、角色与菜单能力', sortOrder: 0,
  } })).json<Module>();
  assert.equal(updatedModule.description, '用户、角色与菜单能力');

  const createdUserFeature = await send({ method: 'POST', url: `${projectPath}/features`, payload: {
    moduleId: module.id, code: 'P2-W01', name: '用户管理', summary: '维护用户', status: 'READY', sortOrder: 1,
  } });
  assert.equal(createdUserFeature.statusCode, 201);
  const userFeature = createdUserFeature.json<Feature>();
  const createdDepartmentFeature = await send({ method: 'POST', url: `${projectPath}/features`, payload: {
    moduleId: module.id, code: 'P2-W03', name: '部门管理', summary: '维护部门树', status: 'DRAFT', sortOrder: 2,
  } });
  assert.equal(createdDepartmentFeature.statusCode, 201);
  const departmentFeature = createdDepartmentFeature.json<Feature>();
  const updatedDepartment = (await send({ method: 'PATCH', url: `${projectPath}/features/${departmentFeature.id}`, payload: {
    status: 'DESIGNING', summary: '维护部门层级与移动规则',
  } })).json<Feature>();
  assert.equal(updatedDepartment.status, 'DESIGNING');
  assert.equal((await send({ method: 'PATCH', url: `${projectPath}/features/${departmentFeature.id}`, payload: {
    status: 'BLOCKED',
  } })).statusCode, 400);
  const features = (await send({ method: 'GET', url: `${projectPath}/features?moduleId=${module.id}` })).json<Feature[]>();
  assert.deepEqual(features.map((item) => item.id), [userFeature.id, departmentFeature.id]);
  assert.equal((await send({ method: 'GET', url: `${projectPath}/features/${departmentFeature.id}` })).json<Feature>().name, '部门管理');

  const tasksPath = `${projectPath}/features/${departmentFeature.id}/tasks`;
  const taskInputs = [
    { code: 'T01', name: '数据基础', type: 'OTHER', status: 'PLANNED', objective: '建立最小数据结构', sortOrder: 1 },
    { code: 'T02', name: 'Backend', type: 'BACKEND', status: 'PLANNED', objective: '完成服务端接口', sortOrder: 2 },
    { code: 'T03', name: 'Frontend', type: 'FRONTEND', status: 'PLANNED', objective: '完成工作台交互', sortOrder: 3 },
    { code: 'T04', name: '集成验证', type: 'INTEGRATION', status: 'PLANNED', objective: '验证前后端闭环', sortOrder: 4 },
  ] as const;
  const createdTasks: Task[] = [];
  for (const input of taskInputs) {
    const response = await send({ method: 'POST', url: tasksPath, payload: input });
    assert.equal(response.statusCode, 201);
    createdTasks.push(response.json<Task>());
  }
  assert.equal((await send({ method: 'POST', url: tasksPath, payload: taskInputs[0] })).statusCode, 409);
  assert.equal((await send({ method: 'POST', url: tasksPath, payload: {
    ...taskInputs[0], code: 'T05', type: 'TEST',
  } })).statusCode, 400);
  assert.equal((await send({ method: 'PATCH', url: `${tasksPath}/${createdTasks[1]!.id}`, payload: {
    status: 'BLOCKED',
  } })).statusCode, 400);
  assert.equal((await send({ method: 'PATCH', url: `${tasksPath}/${createdTasks[0]!.id}`, payload: {
    status: 'CONFIRMED',
  } })).statusCode, 409);
  const confirmedBackend = (await send({ method: 'PATCH', url: `${tasksPath}/${createdTasks[1]!.id}`, payload: {
    status: 'AUTHORIZED', sortOrder: 0, objective: '服务端接口已准备执行',
  } })).json<Task>();
  assert.equal(confirmedBackend.status, 'AUTHORIZED');
  assert.equal((await send({ method: 'GET', url: `${tasksPath}/${confirmedBackend.id}` })).json<Task>().objective, '服务端接口已准备执行');

  const backendTaskPath = `${tasksPath}/${confirmedBackend.id}`;
  const authorizationPath = `${backendTaskPath}/authorizations`;
  const authorizationResponse = await send({ method: 'POST', url: authorizationPath });
  assert.equal(authorizationResponse.statusCode, 201);
  const authorization = authorizationResponse.json<TaskAuthorization>();
  assert.equal(authorization.status, 'ACTIVE');
  assert.equal((await send({ method: 'POST', url: authorizationPath })).statusCode, 409);
  assert.equal((await send({ method: 'GET', url: authorizationPath })).json<TaskAuthorization[]>()[0]?.id, authorization.id);

  const tokenResponse = await send({ method: 'POST', url: '/api/ai-tokens', payload: { name: 'workflow-test', scopes: ['spec:write'] } });
  const aiToken = tokenResponse.json<CreatedAiToken>();
  const aiApproval = await app.inject({ method: 'POST', url: authorizationPath, headers: { authorization: `Bearer ${aiToken.token}` } });
  assert.equal(aiApproval.statusCode, 403);

  const runResponse = await send({ method: 'POST', url: `${backendTaskPath}/runs`, payload: {
    authorizationId: authorization.id, actorName: 'manual-test', baseCommit: '8cba8df',
  } });
  assert.equal(runResponse.statusCode, 201);
  const run = runResponse.json<AiRun>();
  assert.equal(run.status, 'RUNNING');
  assert.equal(run.phase, 'PREPARING');
  assert.equal(run.actorType, 'MANUAL');
  assert.equal((await send({ method: 'GET', url: backendTaskPath })).json<Task>().status, 'RUNNING');
  assert.equal((await send({ method: 'POST', url: `${backendTaskPath}/runs`, payload: {
    authorizationId: authorization.id, actorName: 'manual-test', baseCommit: null,
  } })).statusCode, 409);
  assert.equal((await send({ method: 'PATCH', url: `${projectPath}/runs/${run.id}/phase`, payload: { phase: 'IMPLEMENTING' } })).json<AiRun>().phase, 'IMPLEMENTING');
  assert.equal((await send({ method: 'PATCH', url: `${projectPath}/runs/${run.id}/phase`, payload: { phase: 'TESTING' } })).json<AiRun>().phase, 'TESTING');
  assert.equal((await send({ method: 'PATCH', url: `${projectPath}/runs/${run.id}/phase`, payload: { phase: 'PREPARING' } })).statusCode, 409);
  const submittedRun = (await send({ method: 'POST', url: `${projectPath}/runs/${run.id}/submit`, payload: {
    summary: '完成 Backend 实现', resultCommit: 'abc123', changedFiles: ['src/backend.ts', 'src/backend.test.ts'],
    verificationSummary: { status: 'PASS', summary: 'typecheck and tests passed' }, issues: [],
  } })).json<AiRun>();
  assert.equal(submittedRun.status, 'SUBMITTED');
  assert.equal(submittedRun.changedFiles.length, 2);
  assert.equal((await send({ method: 'GET', url: backendTaskPath })).json<Task>().status, 'SUBMITTED');
  assert.equal((await send({ method: 'GET', url: authorizationPath })).json<TaskAuthorization[]>()[0]?.status, 'CONSUMED');
  assert.equal((await send({ method: 'POST', url: `${backendTaskPath}/runs`, payload: {
    authorizationId: authorization.id, actorName: 'manual-test', baseCommit: null,
  } })).statusCode, 409);
  const completedBackend = (await send({ method: 'POST', url: `${backendTaskPath}/confirm` })).json<Task>();
  assert.equal(completedBackend.status, 'CONFIRMED');

  const failureTaskPath = `${tasksPath}/${createdTasks[2]!.id}`;
  assert.equal((await send({ method: 'PATCH', url: failureTaskPath, payload: { status: 'AUTHORIZED' } })).json<Task>().status, 'AUTHORIZED');
  const failedAuthorization = (await send({ method: 'POST', url: `${failureTaskPath}/authorizations` })).json<TaskAuthorization>();
  const failedRun = (await send({ method: 'POST', url: `${failureTaskPath}/runs`, payload: {
    authorizationId: failedAuthorization.id, actorName: 'manual-test', baseCommit: null,
  } })).json<AiRun>();
  const failure = (await send({ method: 'POST', url: `${projectPath}/runs/${failedRun.id}/fail`, payload: {
    summary: '实现失败', issues: ['build failed'],
  } })).json<AiRun>();
  assert.equal(failure.status, 'FAILED');
  assert.equal((await send({ method: 'GET', url: failureTaskPath })).json<Task>().status, 'AUTHORIZED');
  const retryAuthorization = (await send({ method: 'POST', url: `${failureTaskPath}/authorizations` })).json<TaskAuthorization>();
  assert.notEqual(retryAuthorization.id, failedAuthorization.id);
  const retryRunResponse = await app.inject({ method: 'POST', url: `${failureTaskPath}/runs`, headers: {
    authorization: `Bearer ${aiToken.token}`,
  }, payload: {
    authorizationId: retryAuthorization.id, baseCommit: null,
  } });
  assert.equal(retryRunResponse.statusCode, 201);
  const retryRun = retryRunResponse.json<AiRun>();
  assert.equal(retryRun.actorType, 'AI_TOKEN');
  assert.equal(retryRun.actorName, 'workflow-test');
  assert.equal((await send({ method: 'POST', url: `${projectPath}/runs/${retryRun.id}/abort`, payload: {
    summary: '人工中断', issues: [],
  } })).json<AiRun>().status, 'ABORTED');
  const runHistory = (await send({ method: 'GET', url: `${projectPath}/runs` })).json<AiRun[]>();
  assert.deepEqual(runHistory.filter((item) => item.taskId === createdTasks[2]!.id).map((item) => item.status), ['ABORTED', 'FAILED']);

  const returnTaskPath = `${tasksPath}/${createdTasks[3]!.id}`;
  assert.equal((await send({ method: 'PATCH', url: returnTaskPath, payload: { status: 'AUTHORIZED' } })).json<Task>().status, 'AUTHORIZED');
  const returnAuthorization = (await send({ method: 'POST', url: `${returnTaskPath}/authorizations` })).json<TaskAuthorization>();
  const returnRun = (await send({ method: 'POST', url: `${returnTaskPath}/runs`, payload: {
    authorizationId: returnAuthorization.id, actorName: 'manual-test', baseCommit: null,
  } })).json<AiRun>();
  assert.equal((await send({ method: 'POST', url: `${projectPath}/runs/${returnRun.id}/submit`, payload: {
    summary: '等待人工确认', resultCommit: null, changedFiles: [],
    verificationSummary: { status: 'NOT_RUN', summary: '未执行验证' }, issues: [],
  } })).statusCode, 200);
  assert.equal((await send({ method: 'POST', url: `${returnTaskPath}/return` })).json<Task>().status, 'AUTHORIZED');
  const revokedAuthorization = (await send({ method: 'POST', url: `${returnTaskPath}/authorizations` })).json<TaskAuthorization>();
  assert.equal((await send({ method: 'POST', url: `${returnTaskPath}/authorizations/${revokedAuthorization.id}/revoke` })).json<TaskAuthorization>().status, 'REVOKED');
  assert.equal((await send({ method: 'POST', url: `${returnTaskPath}/runs`, payload: {
    authorizationId: revokedAuthorization.id, actorName: 'manual-test', baseCommit: null,
  } })).statusCode, 409);

  const featureTasks = (await send({ method: 'GET', url: tasksPath })).json<Task[]>();
  assert.deepEqual(featureTasks.map((item) => item.code), ['T02', 'T01', 'T03', 'T04']);
  assert.equal(featureTasks.filter((item) => item.status === 'CONFIRMED').length, 1);
  assert.deepEqual((await send({ method: 'GET', url: `${projectPath}/features/${userFeature.id}/tasks` })).json<Task[]>(), []);

  const missingSpec = await send({ method: 'GET', url: `${projectPath}/specifications/missing` });
  assert.equal(missingSpec.statusCode, 404);
  const createdSpec = await send({ method: 'POST', url: `${projectPath}/specifications`, payload: {
    kind: 'requirements', title: '项目需求与范围',
  } });
  assert.equal(createdSpec.statusCode, 201);
  const spec = createdSpec.json<SpecificationSummary>();
  assert.equal(spec.latestRevisionId, null);
  assert.equal(spec.featureId, null);
  assert.equal((await send({ method: 'GET', url: projectPath })).json<ProjectDetail>().specifications.length, 1);
  const specPath = `${projectPath}/specifications/${spec.id}`;

  const first = await send({ method: 'POST', url: `${specPath}/revisions`, payload: {
    content: '# 初版\n目标 A\n', changeSummary: '建立范围', expectedHeadRevisionId: null,
  } });
  assert.equal(first.statusCode, 201);
  const revision1 = first.json<SpecificationRevision>();
  assert.equal(revision1.revisionNo, 1);
  assert.equal(revision1.source, 'owner:1');
  assert.equal(revision1.changeSummary, '建立范围');

  const second = await send({ method: 'POST', url: `${specPath}/revisions`, payload: {
    content: '# 第二版\n目标 B', changeSummary: '调整目标', expectedHeadRevisionId: revision1.id,
  } });
  assert.equal(second.statusCode, 201);
  const revision2 = second.json<SpecificationRevision>();
  assert.equal(revision2.revisionNo, 2);

  const stale = await send({ method: 'POST', url: `${specPath}/revisions`, payload: {
    content: '# 过期修改', changeSummary: '旧窗口提交', expectedHeadRevisionId: revision1.id,
  } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.currentRevisionId, revision2.id);
  const history = (await send({ method: 'GET', url: `${specPath}/revisions` })).json<SpecificationRevisionSummary[]>();
  assert.deepEqual(history.map((item) => item.revisionNo), [2, 1]);
  assert.equal('content' in history[0]!, false);
  const old = (await send({ method: 'GET', url: `${specPath}/revisions/${revision1.id}` })).json<SpecificationRevision>();
  assert.equal(old.content, '# 初版\n目标 A\n');
  assert.equal((await send({ method: 'GET', url: `${specPath}/revisions/missing` })).statusCode, 404);
  const detail = (await send({ method: 'GET', url: specPath })).json<SpecificationDetail>();
  assert.equal(detail.specification.latestRevisionId, revision2.id);
  assert.equal(detail.latestRevision?.content, '# 第二版\n目标 B');

  const featureSpecResponse = await send({ method: 'POST', url: `${projectPath}/specifications`, payload: {
    kind: 'feature-design', title: '部门管理功能设计', featureId: departmentFeature.id,
  } });
  assert.equal(featureSpecResponse.statusCode, 201);
  const featureSpec = featureSpecResponse.json<SpecificationSummary>();
  assert.equal(featureSpec.featureId, departmentFeature.id);
  assert.equal((await send({ method: 'POST', url: `${projectPath}/specifications`, payload: {
    kind: 'feature-design', title: '重复功能设计', featureId: departmentFeature.id,
  } })).statusCode, 409);
  const featureSpecPath = `${projectPath}/specifications/${featureSpec.id}`;
  const featureRevision1 = (await send({ method: 'POST', url: `${featureSpecPath}/revisions`, payload: {
    content: '# 功能目标\n维护部门', changeSummary: '创建功能设计', expectedHeadRevisionId: null,
  } })).json<SpecificationRevision>();
  const featureRevision2 = (await send({ method: 'POST', url: `${featureSpecPath}/revisions`, payload: {
    content: '# 功能目标\n维护部门层级\n\n## D-01 查看部门', changeSummary: '补充功能明细', expectedHeadRevisionId: featureRevision1.id,
  } })).json<SpecificationRevision>();
  assert.equal(featureRevision2.revisionNo, 2);
  assert.equal((await send({ method: 'GET', url: `${featureSpecPath}/revisions/${featureRevision1.id}` })).json<SpecificationRevision>().content, '# 功能目标\n维护部门');
  assert.equal((await send({ method: 'GET', url: featureSpecPath })).json<SpecificationDetail>().latestRevision?.id, featureRevision2.id);
  const projectDetail = (await send({ method: 'GET', url: projectPath })).json<ProjectDetail>();
  assert.equal(projectDetail.modules.length, 1);
  assert.equal(projectDetail.features.length, 2);
  assert.equal(projectDetail.tasks.length, 4);
  assert.equal(projectDetail.authorizations.length, 5);
  assert.equal(projectDetail.runs.length, 4);
  assert.equal(projectDetail.specifications.filter((item) => item.featureId === null).length, 1);

  await app.close();
  app = createApp(join(directory, 'forgeflow.db'));
  const persisted = (await send({ method: 'GET', url: specPath })).json<SpecificationDetail>();
  assert.equal(persisted.latestRevision?.id, revision2.id);
  assert.equal((await send({ method: 'GET', url: `${specPath}/revisions/${revision1.id}` })).json<SpecificationRevision>().content, old.content);
  assert.equal((await send({ method: 'GET', url: `${projectPath}/features/${departmentFeature.id}` })).json<Feature>().status, 'DESIGNING');
  assert.equal((await send({ method: 'GET', url: featureSpecPath })).json<SpecificationDetail>().latestRevision?.id, featureRevision2.id);
  const persistedTasks = (await send({ method: 'GET', url: tasksPath })).json<Task[]>();
  assert.equal(persistedTasks.length, 4);
  assert.equal(persistedTasks.find((item) => item.code === 'T02')?.status, 'CONFIRMED');
  assert.equal((await send({ method: 'GET', url: `${projectPath}/runs` })).json<AiRun[]>().length, 4);
  assert.equal((await send({ method: 'GET', url: `${projectPath}/runs/${submittedRun.id}` })).json<AiRun>().summary, '完成 Backend 实现');
  assert.equal((await send({ method: 'GET', url: `${returnTaskPath}/authorizations` })).json<TaskAuthorization[]>()[0]?.status, 'REVOKED');
});
