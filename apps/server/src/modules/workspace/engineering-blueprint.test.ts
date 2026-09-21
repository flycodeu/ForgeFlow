import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Capability, CreatedAiToken, EngineeringAsset, EngineeringBlueprintPlan, Feature, FeatureEngineeringBlueprint, Module, Project, TraceLink } from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('Engineering Blueprint adapts asset kinds, supports custom assets and keeps traceability lightweight', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-blueprint-'));
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
    }, payload: { jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } },
  });
  const value = <T>(response: Awaited<ReturnType<typeof mcp>>) => {
    const body = response.json<{ result: { isError?: boolean; content: { text: string }[] } }>();
    assert.equal(body.result.isError, undefined, response.body);
    return JSON.parse(body.result.content[0]!.text) as T;
  };

  const project = await rest<Project>('POST', '/api/projects', { projectKey: 'MIXED', name: '混合视频平台', projectType: 'Web C++ Video AI', designProfile: 'web,video-pipeline,ai' });
  const base = `/api/projects/${project.id}`;
  const module = await rest<Module>('POST', `${base}/modules`, { code: 'RT', name: '实时推理', description: '', sortOrder: 1 });
  const feature = await rest<Feature>('POST', `${base}/features`, { moduleId: module.id, code: 'PIPE', name: '实时推理任务', summary: 'Web 管理、Pipeline 与 AI 联合系统', status: 'DESIGNING', sortOrder: 1 });
  const capability = await rest<Capability>('POST', `${base}/features/${feature.id}/capabilities`, { code: 'RT-03', name: '解码抽帧', summary: 'FFmpeg 解码与抽帧', sortOrder: 1 });
  const plan = await rest<EngineeringBlueprintPlan>('POST', `${base}/features/${feature.id}/engineering-blueprint/plan`, { createAssets: true });
  const kinds = plan.recommendedKinds.map((item) => item.kind);
  for (const expected of ['DATA_MODEL', 'UI_DESIGN', 'PIPELINE', 'ALGORITHM', 'INTEGRATION', 'TEST_DESIGN']) assert.ok(kinds.includes(expected));
  assert.equal(plan.createdAssets.length, new Set(kinds).size);

  const custom = await rest<EngineeringAsset>('POST', `${base}/features/${feature.id}/engineering-assets`, {
    capabilityId: capability.id, kind: 'CUDA_KERNEL', name: 'NV12 预处理 Kernel', summary: '自定义扩展 kind',
    structuredData: { inputs: [{ name: 'NV12 frame', type: 'CUdeviceptr' }], outputs: [{ name: 'NCHW FP16', type: 'tensor' }] },
  });
  assert.equal(custom.kind, 'CUDA_KERNEL');
  const link = await rest<TraceLink>('POST', `${base}/trace-links`, { sourceType: 'CAPABILITY', sourceId: capability.id, targetType: 'ENGINEERING_ASSET', targetId: custom.id, relation: 'DEPENDS_ON' });
  assert.equal(link.relation, 'DEPENDS_ON');
  const otherProject = await rest<Project>('POST', '/api/projects', { projectKey: 'TRACE_OTHER', name: '另一个项目' });
  const otherModule = await rest<Module>('POST', `/api/projects/${otherProject.id}/modules`, {
    code: 'OTHER', name: '其他模块', description: '', sortOrder: 0,
  });
  for (const target of [
    { targetType: 'MODULE', targetId: otherModule.id },
    { targetType: 'CAPABILITY', targetId: '00000000-0000-4000-8000-000000000000' },
    { targetType: 'UNSUPPORTED', targetId: custom.id },
  ]) {
    const response = await app.inject({ method: 'POST', url: `${base}/trace-links`, payload: {
      sourceType: 'CAPABILITY', sourceId: capability.id, ...target, relation: 'DEPENDS_ON',
    } });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'TRACE_NODE_INVALID');
  }
  const blueprint = await rest<FeatureEngineeringBlueprint>('GET', `${base}/features/${feature.id}/engineering-blueprint`);
  assert.ok(blueprint.assets.some((item) => item.kind === 'CUDA_KERNEL'));
  assert.ok(blueprint.completeness.every((item) => item.exists));

  const token = await rest<CreatedAiToken>('POST', '/api/ai-tokens', { name: 'blueprint-ai', scopes: ['project:read', 'spec:read', 'task:read', 'planning:write'] });
  const initialized = await app.inject({ method: 'POST', url: '/mcp', headers: {
    host: '127.0.0.1:8787', accept: 'application/json, text/event-stream', 'content-type': 'application/json',
    'mcp-protocol-version': '2025-11-25', authorization: `Bearer ${token.token}`,
  }, payload: { jsonrpc: '2.0', id: ++requestId, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } } });
  assert.equal(initialized.statusCode, 200);
  assert.equal(value<FeatureEngineeringBlueprint>(await mcp(token.token, 'get_engineering_blueprint', { projectId: project.id, featureId: feature.id })).feature.id, feature.id);
  const mcpPlan = value<EngineeringBlueprintPlan>(await mcp(token.token, 'plan_engineering_blueprint', { featureId: feature.id, createAssets: true }));
  assert.equal(mcpPlan.createdAssets.length, 0, 'replanning must not duplicate assets');

  for (const sample of [
    { key: 'GAME-BP', type: 'Godot 4.4', profile: 'game', expected: ['CODE_MODEL', 'UI_DESIGN', 'INTEGRATION'], forbidden: ['DATA_MODEL', 'ALGORITHM', 'PIPELINE'] },
    { key: 'AI-BP', type: 'Python AI', profile: 'ai', expected: ['DATA_MODEL', 'ALGORITHM', 'DEPLOYMENT'], forbidden: ['UI_DESIGN', 'PIPELINE'] },
  ]) {
    const adaptiveProject = await rest<Project>('POST', '/api/projects', { projectKey: sample.key, name: sample.key, projectType: sample.type, designProfile: sample.profile });
    const adaptiveModule = await rest<Module>('POST', `/api/projects/${adaptiveProject.id}/modules`, { code: 'CORE', name: '核心', description: '', sortOrder: 0 });
    const adaptiveFeature = await rest<Feature>('POST', `/api/projects/${adaptiveProject.id}/features`, { moduleId: adaptiveModule.id, code: 'MAIN', name: '核心功能', summary: '', status: 'DRAFT', sortOrder: 0 });
    const adaptive = await rest<EngineeringBlueprintPlan>('POST', `/api/projects/${adaptiveProject.id}/features/${adaptiveFeature.id}/engineering-blueprint/plan`, { createAssets: false });
    const adaptiveKinds = adaptive.recommendedKinds.map((item) => item.kind);
    for (const expected of sample.expected) assert.ok(adaptiveKinds.includes(expected), `${sample.key} missing ${expected}`);
    for (const forbidden of sample.forbidden) assert.ok(!adaptiveKinds.includes(forbidden), `${sample.key} should not force ${forbidden}`);
  }
});
