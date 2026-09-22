import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { CreatedAiToken, Project, ProjectDetail, ProjectSource, ResolvedProjectSources, SourceAnalysis } from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('multi-source bindings stay project-scoped and analysis results round-trip through MCP', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-source-binding-'));
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
  const call = (token: string, name: string, args: object = {}) => app.inject({
    method: 'POST', url: '/mcp',
    headers: {
      host: '127.0.0.1:8787', authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25',
    },
    payload: { jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } },
  });
  const success = <T>(response: Awaited<ReturnType<typeof call>>) => {
    assert.equal(response.statusCode, 200, response.body);
    const json = response.json<{ result: { isError?: boolean; content: { text: string }[] } }>();
    assert.equal(json.result.isError, undefined, response.body);
    return JSON.parse(json.result.content[0]!.text) as T;
  };
  const toolError = (response: Awaited<ReturnType<typeof call>>) => {
    assert.equal(response.statusCode, 200, response.body);
    const json = response.json<{ result: { isError?: boolean; content: { text: string }[] } }>();
    assert.equal(json.result.isError, true, response.body);
    return JSON.parse(json.result.content[0]!.text) as { code: string; candidates?: unknown[] };
  };

  const project = await rest<Project>('POST', '/api/projects', {
    projectKey: 'VIDEO_AI', name: '视频智能分析平台', projectType: 'video-pipeline+ai+web', workflowMode: 'AUTO',
  });
  const controlled = await rest<Project>('POST', '/api/projects', {
    projectKey: 'VIDEO_AI_CONTROLLED', name: '视频智能分析平台', workflowMode: 'CONTROLLED',
  });
  assert.equal(project.workflowMode, 'AUTO');
  assert.equal(controlled.workflowMode, 'CONTROLLED');

  const sourcePayload = (alias: string, displayName: string, purpose: string, localRoot: string, idempotencyKey: string) => ({
    alias, displayName, purpose, sourceKind: 'GIT', environmentKey: 'flycode-pc', localRoot,
    remoteUrl: null, repoSubdir: null,
    scope: { include: ['src/**', 'README.md', 'package.json'], exclude: ['custom-cache/**'] }, idempotencyKey,
  });
  const sources = await Promise.all([
    rest<ProjectSource>('POST', `/api/projects/${project.id}/sources`, sourcePayload('web', 'Web 管理端', '任务表单与结果展示', 'D:\\Projects\\video-web', 'create-web')),
    rest<ProjectSource>('POST', `/api/projects/${project.id}/sources`, sourcePayload('backend', '业务后端', '任务 API 与数据处理', 'E:\\Services\\video-api', 'create-backend')),
    rest<ProjectSource>('POST', `/api/projects/${project.id}/sources`, sourcePayload('inference', '推理服务', '视频解码与算法推理', 'D:\\Algorithms\\video-inference', 'create-inference')),
  ]);
  assert.equal(new Set(sources.map((source) => source.id)).size, 3);
  assert.ok(sources.every((source) => /^[0-9a-f-]{36}$/i.test(source.id)));
  assert.ok(sources.every((source) => source.status === 'REGISTERED' && source.locations[0]?.accessibility === 'UNKNOWN'));
  assert.ok(sources.every((source) => source.scope.exclude.includes('node_modules/**') && source.scope.exclude.includes('.env')));

  const backend = sources.find((source) => source.alias === 'backend')!;
  const backendWithServer = await rest<ProjectSource>('PATCH', `/api/projects/${project.id}/sources/${backend.id}`, {
    ...sourcePayload('backend', '业务后端', '任务 API 与数据处理', '/home/fly/video-api', 'backend-server-location'),
    environmentKey: 'server-dev', expectedUpdatedAt: backend.updatedAt,
  });
  assert.deepEqual(backendWithServer.locations.map((location) => location.environmentKey).sort(), ['flycode-pc', 'server-dev']);

  const duplicateAlias = await app.inject({ method: 'POST', url: `/api/projects/${project.id}/sources`,
    payload: sourcePayload('web', '重复 Web', '', 'D:\\Other', 'duplicate-web') });
  assert.equal(duplicateAlias.statusCode, 409);
  assert.equal(duplicateAlias.json<{ error: { code: string } }>().error.code, 'SOURCE_ALIAS_EXISTS');

  const staleUpdate = await app.inject({ method: 'PATCH', url: `/api/projects/${project.id}/sources/${backend.id}`, payload: {
    ...sourcePayload('backend', '业务后端', '任务 API 与数据处理', 'E:\\Services\\video-api-v2', 'backend-stale-update'),
    expectedUpdatedAt: backend.updatedAt,
  } });
  assert.equal(staleUpdate.statusCode, 409);
  assert.equal(staleUpdate.json<{ error: { code: string } }>().error.code, 'SOURCE_UPDATE_CONFLICT');

  const planner = await rest<CreatedAiToken>('POST', '/api/ai-tokens', {
    name: 'source-planner', scopes: ['project:read', 'planning:write'],
  });
  const readOnly = await rest<CreatedAiToken>('POST', '/api/ai-tokens', { name: 'source-reader', scopes: ['project:read'] });
  const mcpSourceInput = {
    projectId: controlled.id,
    ...sourcePayload('docs', '项目文档', '设计与使用说明', 'D:\\Docs\\video-platform', 'mcp-create-docs'),
    sourceKind: 'DIRECTORY',
  };
  const mcpSource = success<ProjectSource>(await call(planner.token, 'upsert_project_source', mcpSourceInput));
  const mcpSourceRetry = success<ProjectSource>(await call(planner.token, 'upsert_project_source', mcpSourceInput));
  assert.equal(mcpSource.id, mcpSourceRetry.id);
  assert.equal(mcpSource.status, 'REGISTERED');
  assert.equal(mcpSource.locations[0]?.accessibility, 'UNKNOWN');
  const resolved = success<ResolvedProjectSources>(await call(readOnly.token, 'resolve_project_and_sources', { projectCode: 'VIDEO_AI' }));
  assert.equal(resolved.project.id, project.id);
  assert.equal(resolved.sources.length, 3);
  assert.equal((await call(readOnly.token, 'upsert_project_source', {
    projectId: project.id, ...sourcePayload('docs', '文档', '', 'D:\\Docs', 'read-only-denied'), sourceKind: 'DIRECTORY',
  })).statusCode, 403);

  const ambiguous = toolError(await call(readOnly.token, 'resolve_project_and_sources', { projectName: '视频智能分析平台' }));
  assert.equal(ambiguous.code, 'AMBIGUOUS_PROJECT');
  assert.equal(ambiguous.candidates?.length, 2);

  const crossProject = toolError(await call(planner.token, 'request_source_analysis', {
    projectId: controlled.id, sourceIds: [sources[0]!.id], environmentKey: 'flycode-pc',
  }));
  assert.equal(crossProject.code, 'SOURCE_PROJECT_MISMATCH');

  const analysis = success<SourceAnalysis>(await call(planner.token, 'request_source_analysis', {
    projectId: project.id, sourceIds: sources.map((source) => source.id), environmentKey: 'flycode-pc',
    analysisScope: { description: '当前项目架构和代码组织' }, prompt: '只读识别工程入口',
  }));
  assert.equal(analysis.status, 'WAITING_AI');
  assert.equal(analysis.startedAt, null);
  assert.equal(analysis.completedAt, null);
  assert.equal(analysis.sourceSnapshots, null);
  assert.match(analysis.prompts.codex, /submit_source_analysis/);
  assert.match(analysis.prompts.claude, /不要修改业务源码/);

  const claimed = success<SourceAnalysis>(await call(planner.token, 'claim_source_analysis', {
    projectId: project.id, analysisId: analysis.id,
  }));
  assert.equal(claimed.status, 'READING');
  assert.ok(claimed.startedAt);

  const submitted = success<SourceAnalysis>(await call(planner.token, 'submit_source_analysis', {
    projectId: project.id,
    analysisId: analysis.id,
    status: 'SYNCED',
    sourceSnapshots: Object.fromEntries(sources.map((source) => [source.id, {
      root: source.locations[0]!.localRoot,
      entries: [{ path: 'README.md', kind: 'documentation' }],
      codeReferences: [{ path: 'src/main.ts', symbol: 'main' }],
    }])),
    checkpoint: { filesRead: 6 },
    summary: '已识别三个源码入口与主要代码引用。',
    errors: null,
  }));
  assert.equal(submitted.status, 'SYNCED');
  assert.equal(submitted.summary, '已识别三个源码入口与主要代码引用。');
  assert.equal(Object.keys(submitted.sourceSnapshots ?? {}).length, 3);
  assert.ok(submitted.completedAt);

  const detail = await rest<ProjectDetail>('GET', `/api/projects/${project.id}`);
  assert.equal(detail.sources.length, 3);
  assert.equal(detail.sourceAnalyses.length, 1);
  assert.equal(detail.sourceAnalyses[0]?.status, 'SYNCED');
  assert.deepEqual(detail.modules, []);
  assert.deepEqual(detail.features, []);
  assert.deepEqual(detail.capabilities, []);
  assert.deepEqual(detail.engineeringAssets, []);
  assert.deepEqual(detail.tasks, []);
  assert.deepEqual(detail.runs, []);

  const metadataOnly = await rest<ProjectSource>('PATCH', `/api/projects/${project.id}/sources/${backend.id}`, {
    ...sourcePayload('backend', '业务后端（更新名称）', '任务 API 与数据处理', '/home/fly/video-api', 'backend-rename'),
    environmentKey: 'server-dev', expectedUpdatedAt: detail.sources.find((item) => item.id === backend.id)!.updatedAt,
  });
  assert.equal((await rest<ProjectDetail>('GET', `/api/projects/${project.id}`)).sourceAnalyses[0]?.status, 'SYNCED');
  const moved = await rest<ProjectSource>('PATCH', `/api/projects/${project.id}/sources/${backend.id}`, {
    ...sourcePayload('backend', '业务后端（更新名称）', '任务 API 与数据处理', 'E:\\Services\\video-api-next', 'backend-move'),
    environmentKey: 'flycode-pc', expectedUpdatedAt: metadataOnly.updatedAt,
  });
  assert.equal(moved.locations.find((item) => item.environmentKey === 'flycode-pc')?.analysisStatus, 'STALE');
  assert.equal(moved.locations.find((item) => item.environmentKey === 'server-dev')?.analysisStatus, 'NOT_REQUESTED');
  const staleDetail = await rest<ProjectDetail>('GET', `/api/projects/${project.id}`);
  assert.equal(staleDetail.sourceAnalyses[0]?.status, 'STALE');
  assert.equal(staleDetail.sourceAnalyses[0]?.summary, submitted.summary);
  assert.deepEqual(staleDetail.sourceAnalyses[0]?.sourceSnapshots, submitted.sourceSnapshots);

  const pending = success<SourceAnalysis>(await call(planner.token, 'request_source_analysis', {
    projectId: project.id, sourceIds: [backend.id], environmentKey: 'server-dev',
  }));
  success<SourceAnalysis>(await call(planner.token, 'claim_source_analysis', {
    projectId: project.id, analysisId: pending.id,
  }));
  const scoped = await rest<ProjectSource>('PATCH', `/api/projects/${project.id}/sources/${backend.id}`, {
    ...sourcePayload('backend', '业务后端（更新名称）', '任务 API 与数据处理', '/home/fly/video-api', 'backend-scope'),
    environmentKey: 'server-dev', expectedUpdatedAt: (await rest<ProjectDetail>('GET', `/api/projects/${project.id}`))
      .sources.find((item) => item.id === backend.id)!.updatedAt,
    scope: { include: ['src/**'], exclude: ['custom-cache/**'] },
  });
  assert.equal(scoped.locations.find((item) => item.environmentKey === 'server-dev')?.analysisStatus, 'STALE');
  assert.equal((await rest<ProjectDetail>('GET', `/api/projects/${project.id}`)).sourceAnalyses.find((item) => item.id === pending.id)?.status, 'STALE');
  const rejected = toolError(await call(planner.token, 'submit_source_analysis', {
    projectId: project.id, analysisId: pending.id, status: 'SYNCED', summary: '旧范围的结果',
    sourceSnapshots: { [backend.id]: { root: '/home/fly/video-api' } },
  }));
  assert.equal(rejected.code, 'SOURCE_ANALYSIS_NOT_ACTIVE');
});
