import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type {
  AiRun, Capability, CapabilityDesignGuidance, CapabilityDetail, CreatedAiToken, Feature, Module,
  Project, ProjectLifecycle, Task,
} from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('AUTO Capability flow adapts design, executes without authorization, and rolls up real progress', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-capability-'));
  const app = createApp(join(directory, 'forgeflow.db'));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });

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
  const guidance = value<CapabilityDesignGuidance>(await mcp(token.token, 'get_capability_design_guidance', { capabilityId: capability.id }));
  assert.equal(guidance.profile, 'WEB');
  assert.match(guidance.markdownTemplate, /API \/ 协议/);
  value(await mcp(token.token, 'create_capability_design', { capabilityId: capability.id, changeSummary: '初版', content: guidance.markdownTemplate }));
  const context = value<CapabilityDetail>(await mcp(token.token, 'get_capability_context', { projectId: project.id, featureId: feature.id, capabilityId: capability.id }));
  assert.equal(context.design?.latestRevision?.revisionNo, 1);
  assert.equal(context.implementationRevision?.id, context.design?.latestRevision?.id);

  const task = value<Task>(await mcp(token.token, 'create_task_plan', {
    featureId: feature.id, capabilityId: capability.id, code: 'T-U02', name: '实现新增用户', type: 'OTHER',
    category: 'IMPLEMENTATION', area: 'user', objective: '按 Capability Design 完成代码与测试', sortOrder: 10,
  }));
  const run = value<AiRun>(await mcp(token.token, 'start_run', { taskId: task.id, baseCommit: 'base123' }));
  assert.equal(run.authorizationId, null);
  value<AiRun>(await mcp(token.token, 'submit_run_result', {
    runId: run.id, resultCommit: 'done123', summary: '实现完成', changedFiles: ['UserService.ts'],
    verificationSummary: { status: 'PASS', summary: 'UserServiceTest PASS' }, issues: [],
  }));
  const finished = await rest<CapabilityDetail>('GET', `${base}/features/${feature.id}/capabilities/${capability.id}`);
  assert.equal(finished.capability.status, 'DONE');
  assert.equal(finished.tasks[0]?.status, 'DONE');
  assert.equal(finished.runs[0]?.verificationSummary?.status, 'PASS');
  const lifecycle = await rest<ProjectLifecycle>('GET', `${base}/lifecycle`);
  assert.equal(lifecycle.stages.find((stage) => stage.key === 'implementation')?.summary, '1 / 1 已完成');
  assert.equal(lifecycle.stages.find((stage) => stage.key === 'verification')?.summary, '1 / 1 通过');

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
});
