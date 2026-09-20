import type { FastifyInstance } from 'fastify';
import type {
  CapabilityStatus, FeatureStatus, ProjectSourceKind, ProjectSourceScope, RequestSourceAnalysisInput, RunPhase,
  RunChangedFile, RunReportedStatus, RunSourceExecution, TaskCategory, TaskStatus, TaskType, UpsertProjectSourceInput, WorkflowMode,
} from '@forgeflow/contracts';
import { ApiError } from '../../shared/api-error.js';
import { AuthService } from '../security/auth.service.js';
import { WorkspaceService } from './workspace.service.js';

type ProjectParams = { projectId: string };
type SourceParams = ProjectParams & { sourceId: string };
type ModuleParams = ProjectParams & { moduleId: string };
type FeatureParams = ProjectParams & { featureId: string };
type CapabilityParams = FeatureParams & { capabilityId: string };
type AssetParams = ProjectParams & { assetId: string };
type AssetRevisionParams = AssetParams & { revisionId: string };
type TaskParams = FeatureParams & { taskId: string };
type AuthorizationParams = TaskParams & { authorizationId: string };
type RunParams = ProjectParams & { runId: string };
type SpecParams = ProjectParams & { specId: string };
type RevisionParams = SpecParams & { revisionId: string };
type ReviewParams = ProjectParams & { reviewId: string };
const FEATURE_STATUSES: readonly FeatureStatus[] = [
  'DRAFT', 'DESIGNING', 'READY', 'IMPLEMENTING', 'VERIFYING', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'DELIVERED',
];
const TASK_TYPES: readonly TaskType[] = ['DESIGN', 'BACKEND', 'FRONTEND', 'INTEGRATION', 'VERIFICATION', 'OTHER'];
const TASK_CATEGORIES: readonly TaskCategory[] = ['DESIGN', 'IMPLEMENTATION', 'INTEGRATION', 'VERIFICATION', 'MIGRATION', 'CONTENT', 'OTHER'];
const TASK_STATUSES: readonly TaskStatus[] = ['PLANNED', 'AUTHORIZED', 'RUNNING', 'SUBMITTED', 'CONFIRMED', 'DONE', 'BLOCKED'];
const CAPABILITY_STATUSES: readonly CapabilityStatus[] = ['DRAFT', 'DESIGNED', 'IMPLEMENTING', 'TESTING', 'DONE', 'BLOCKED'];
const RUN_PHASES: readonly RunPhase[] = ['PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING'];

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_INPUT', '请求内容必须是 JSON 对象');
  }
  return value as Record<string, unknown>;
}

function textField(body: Record<string, unknown>, key: string, label: string, maxLength: number, preserveWhitespace = false) {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ApiError(400, 'INVALID_INPUT', `${label}不能为空且不能超过 ${maxLength} 个字符`);
  }
  return preserveWhitespace ? value : value.trim();
}

function optionalTextField(body: Record<string, unknown>, key: string, label: string, maxLength: number, allowEmpty = false) {
  if (!Object.hasOwn(body, key)) return undefined;
  const value = body[key];
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new ApiError(400, 'INVALID_INPUT', `${label}${allowEmpty ? '' : '不能为空且'}不能超过 ${maxLength} 个字符`);
  }
  return value.trim();
}

function sortOrderField(body: Record<string, unknown>, required: boolean) {
  if (!Object.hasOwn(body, 'sortOrder')) {
    if (required) return 0;
    return undefined;
  }
  if (!Number.isInteger(body.sortOrder) || (body.sortOrder as number) < 0) {
    throw new ApiError(400, 'INVALID_INPUT', '排序值必须是非负整数');
  }
  return body.sortOrder as number;
}

function codeField(body: Record<string, unknown>, key: string, label: string, required: boolean) {
  const value = required ? textField(body, key, label, 40) : optionalTextField(body, key, label, 40);
  if (value === undefined) return undefined;
  const code = value.toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{0,39}$/.test(code)) {
    throw new ApiError(400, 'INVALID_INPUT', `${label}须以字母开头，只能包含字母、数字、_ 或 -`);
  }
  return code;
}

function statusField(body: Record<string, unknown>, required: boolean): FeatureStatus | undefined {
  if (!Object.hasOwn(body, 'status')) return required ? 'DRAFT' : undefined;
  if (typeof body.status !== 'string' || !FEATURE_STATUSES.includes(body.status as FeatureStatus)) {
    throw new ApiError(400, 'INVALID_INPUT', '功能状态不合法');
  }
  return body.status as FeatureStatus;
}

function capabilityStatusField(body: Record<string, unknown>, required: boolean): CapabilityStatus | undefined {
  if (!Object.hasOwn(body, 'status')) return required ? 'DRAFT' : undefined;
  if (typeof body.status !== 'string' || !CAPABILITY_STATUSES.includes(body.status as CapabilityStatus)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Capability 状态不合法');
  }
  return body.status as CapabilityStatus;
}

function taskTypeField(body: Record<string, unknown>, required: boolean): TaskType | undefined {
  if (!Object.hasOwn(body, 'type')) return required ? 'OTHER' : undefined;
  if (typeof body.type !== 'string' || !TASK_TYPES.includes(body.type as TaskType)) {
    throw new ApiError(400, 'INVALID_INPUT', '任务类型不合法');
  }
  return body.type as TaskType;
}

function taskCategoryField(body: Record<string, unknown>, required: boolean): TaskCategory | undefined {
  if (!Object.hasOwn(body, 'category') && !required) return undefined;
  if (typeof body.category !== 'string' || !TASK_CATEGORIES.includes(body.category as TaskCategory)) {
    throw new ApiError(400, 'INVALID_INPUT', 'Task 类别不合法');
  }
  return body.category as TaskCategory;
}

function taskStatusField(body: Record<string, unknown>, required: boolean): TaskStatus | undefined {
  if (!Object.hasOwn(body, 'status')) return required ? 'PLANNED' : undefined;
  if (typeof body.status !== 'string' || !TASK_STATUSES.includes(body.status as TaskStatus)) {
    throw new ApiError(400, 'INVALID_INPUT', '任务状态不合法');
  }
  return body.status as TaskStatus;
}

function uuidField(body: Record<string, unknown>, key: string, label: string) {
  const value = textField(body, key, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, 'INVALID_INPUT', `${label}不合法`);
  }
  return value;
}

function optionalNullableUuidField(body: Record<string, unknown>, key: string, label: string) {
  if (!Object.hasOwn(body, key)) return undefined;
  if (body[key] === null || body[key] === '') return null;
  return uuidField(body, key, label);
}

function nullableTextField(body: Record<string, unknown>, key: string, label: string, maxLength: number) {
  if (!Object.hasOwn(body, key) || body[key] === null || body[key] === '') return null;
  return textField(body, key, label, maxLength);
}

function stringListField(body: Record<string, unknown>, key: string, label: string, maxItems: number) {
  const value = body[key];
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500)) {
    throw new ApiError(400, 'INVALID_INPUT', `${label}必须是最多 ${maxItems} 项的非空字符串数组`);
  }
  return value.map((item) => (item as string).trim());
}

function optionalObjectField(body: Record<string, unknown>, key: string) {
  if (!Object.hasOwn(body, key)) return undefined;
  if (body[key] === null) return null;
  const value = body[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_INPUT', `${key} 必须是 JSON 对象或 null`);
  }
  return value as Record<string, unknown>;
}

function optionalSourceScopeField(body: Record<string, unknown>): Partial<ProjectSourceScope> | null | undefined {
  if (!Object.hasOwn(body, 'scope')) return undefined;
  if (body.scope === null) return null;
  if (!body.scope || typeof body.scope !== 'object' || Array.isArray(body.scope)) {
    throw new ApiError(400, 'INVALID_SOURCE_SCOPE', 'scope 必须是 JSON 对象或 null');
  }
  const scope = body.scope as Record<string, unknown>;
  const list = (key: 'include' | 'exclude') => {
    if (!Object.hasOwn(scope, key)) return undefined;
    const value = scope[key];
    if (!Array.isArray(value) || value.length > 100
      || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500)) {
      throw new ApiError(400, 'INVALID_SOURCE_SCOPE', `${key} 必须是最多 100 项的非空字符串数组`);
    }
    return value.map((item) => (item as string).trim());
  };
  return { ...(list('include') !== undefined ? { include: list('include') } : {}),
    ...(list('exclude') !== undefined ? { exclude: list('exclude') } : {}) };
}

function projectSourceInput(body: Record<string, unknown>, projectId: string, sourceId?: string): UpsertProjectSourceInput {
  const sourceKind = textField(body, 'sourceKind', '源码类型', 40).toUpperCase() as ProjectSourceKind;
  if (!['GIT', 'DIRECTORY'].includes(sourceKind)) throw new ApiError(400, 'INVALID_SOURCE_KIND', 'sourceKind 首版只支持 GIT 或 DIRECTORY');
  return {
    projectId, sourceId: sourceId ?? null,
    alias: textField(body, 'alias', '源码别名', 40),
    displayName: textField(body, 'displayName', '显示名称', 120),
    purpose: optionalTextField(body, 'purpose', '用途', 500, true) ?? '',
    sourceKind,
    environmentKey: textField(body, 'environmentKey', '环境标识', 80),
    localRoot: textField(body, 'localRoot', '本地源码根目录', 1024, true),
    remoteUrl: nullableTextField(body, 'remoteUrl', 'Git Remote', 2048),
    repoSubdir: nullableTextField(body, 'repoSubdir', '仓库子目录', 500),
    scope: optionalSourceScopeField(body),
    expectedUpdatedAt: optionalTextField(body, 'expectedUpdatedAt', '期望更新时间', 80, true) ?? null,
    idempotencyKey: textField(body, 'idempotencyKey', '幂等键', 120),
  };
}

function newProjectSourcesField(body: Record<string, unknown>) {
  if (!Object.hasOwn(body, 'sources')) return [];
  if (!Array.isArray(body.sources) || body.sources.length > 20) {
    throw new ApiError(400, 'INVALID_PROJECT_SOURCES', '新建项目最多登记 20 个源码位置');
  }
  return body.sources.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiError(400, 'INVALID_PROJECT_SOURCES', `第 ${index + 1} 个源码位置必须是 JSON 对象`);
    }
    const parsed = projectSourceInput(value as Record<string, unknown>, 'pending-project');
    const { projectId: _projectId, sourceId: _sourceId, expectedUpdatedAt: _expectedUpdatedAt, ...source } = parsed;
    return source;
  });
}

function verificationSummaryField(body: Record<string, unknown>): { reportedStatus: RunReportedStatus; summary: string } {
  const value = body.verificationSummary;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_INPUT', '验证摘要必须是 JSON 对象');
  }
  const record = value as Record<string, unknown>;
  const status = (record.reportedStatus ?? record.status) as unknown;
  if (typeof status !== 'string' || !['PASS', 'FAIL', 'NOT_RUN', 'SKIPPED', 'ERROR'].includes(status)) {
    throw new ApiError(400, 'INVALID_INPUT', '验证状态必须是 PASS、FAIL、NOT_RUN、SKIPPED 或 ERROR');
  }
  return {
    reportedStatus: status as RunReportedStatus,
    summary: textField(record, 'summary', '验证说明', 2000, true),
  };
}

function changedFilesField(body: Record<string, unknown>): RunChangedFile[] {
  const value = body.changedFiles;
  if (!Array.isArray(value) || value.length > 500) {
    throw new ApiError(400, 'INVALID_INPUT', '修改文件必须是最多 500 项的数组');
  }
  return value.map((item) => {
    if (typeof item === 'string' && item.trim() && item.length <= 500) return item.trim();
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ApiError(400, 'INVALID_INPUT', '修改文件项必须是旧版路径字符串或带 sourceId 的文件引用');
    }
    const record = item as Record<string, unknown>;
    return {
      sourceId: uuidField(record, 'sourceId', 'Source ID'),
      relativePath: textField(record, 'relativePath', '相对路径', 1000, true),
    };
  });
}

function sourceExecutionsField(body: Record<string, unknown>): RunSourceExecution[] | undefined {
  if (!Object.hasOwn(body, 'sourceExecutions')) return undefined;
  const value = body.sourceExecutions;
  if (!Array.isArray(value) || value.length > 50) {
    throw new ApiError(400, 'INVALID_INPUT', '源码执行快照必须是最多 50 项的数组');
  }
  return value as RunSourceExecution[];
}

export function registerWorkspaceRoutes(app: FastifyInstance, service: WorkspaceService, auth: AuthService) {
  app.post('/api/projects', async (request, reply) => {
    await auth.require(request, 'owner', true);
    const body = bodyObject(request.body);
    const projectKey = textField(body, 'projectKey', '项目标识', 32).toUpperCase();
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(projectKey)) {
      throw new ApiError(400, 'INVALID_INPUT', '项目标识须以字母开头，并包含 2–32 个字母、数字、_ 或 -');
    }
    const name = textField(body, 'name', '项目名称', 120);
    const description = optionalTextField(body, 'description', '项目描述', 1000, true) ?? '';
    const projectType = optionalTextField(body, 'projectType', '项目类型', 80) ?? 'GENERAL';
    const workflowMode = (optionalTextField(body, 'workflowMode', '工作流模式', 20) ?? 'AUTO').toUpperCase() as WorkflowMode;
    if (!['AUTO', 'CONTROLLED'].includes(workflowMode)) throw new ApiError(400, 'INVALID_INPUT', 'workflowMode 只能是 AUTO 或 CONTROLLED');
    const designProfile = optionalTextField(body, 'designProfile', '设计画像', 40) ?? 'generic';
    const sources = newProjectSourcesField(body);
    return reply.code(201).send(service.createProjectWithSources({ projectKey, name, description, projectType, workflowMode, designProfile,
      sources: sources.map(({ idempotencyKey, ...source }) => ({ ...source, idempotencyKey })) }));
  });

  app.get('/api/projects', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listProjects();
  });

  app.get<{ Params: ProjectParams }>('/api/projects/:projectId', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getProject(request.params.projectId);
  });

  app.get<{ Params: ProjectParams }>('/api/projects/:projectId/sources', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listProjectSources(request.params.projectId);
  });

  app.post<{ Params: ProjectParams }>('/api/projects/:projectId/sources', async (request, reply) => {
    await auth.require(request, 'planning:write', true);
    return reply.code(201).send(service.upsertProjectSource(projectSourceInput(bodyObject(request.body), request.params.projectId)));
  });

  app.patch<{ Params: SourceParams }>('/api/projects/:projectId/sources/:sourceId', async (request) => {
    await auth.require(request, 'planning:write', true);
    return service.upsertProjectSource(projectSourceInput(bodyObject(request.body), request.params.projectId, request.params.sourceId));
  });

  app.get<{ Params: ProjectParams }>('/api/projects/:projectId/source-analyses', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listSourceAnalyses(request.params.projectId);
  });

  app.post<{ Params: ProjectParams }>('/api/projects/:projectId/source-analyses', async (request, reply) => {
    await auth.require(request, 'planning:write', true);
    const body = bodyObject(request.body);
    const sourceIds = stringListField(body, 'sourceIds', '源码列表', 100);
    if (sourceIds.some((sourceId) => !/^[0-9a-f-]{36}$/i.test(sourceId))) throw new ApiError(400, 'INVALID_SOURCE_SELECTION', 'Source ID 不合法');
    const input: RequestSourceAnalysisInput = {
      projectId: request.params.projectId, sourceIds,
      environmentKey: textField(body, 'environmentKey', '环境标识', 80),
      featureId: optionalNullableUuidField(body, 'featureId', '功能 ID') ?? null,
      capabilityId: optionalNullableUuidField(body, 'capabilityId', '能力项 ID') ?? null,
      analysisScope: optionalObjectField(body, 'analysisScope'),
      prompt: nullableTextField(body, 'prompt', '分析说明', 4000),
    };
    return reply.code(201).send(service.requestSourceAnalysis(input));
  });

  app.get<{ Params: ProjectParams }>('/api/projects/:projectId/lifecycle', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getProjectLifecycle(request.params.projectId);
  });

  app.get<{ Params: ProjectParams }>('/api/projects/:projectId/modules', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listModules(request.params.projectId);
  });

  app.post<{ Params: ProjectParams }>('/api/projects/:projectId/modules', async (request, reply) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return reply.code(201).send(service.createModule(request.params.projectId, {
      code: codeField(body, 'code', '模块编号', true)!,
      name: textField(body, 'name', '模块名称', 120),
      description: optionalTextField(body, 'description', '模块说明', 500, true) ?? '',
      sortOrder: sortOrderField(body, true)!,
    }));
  });

  app.patch<{ Params: ModuleParams }>('/api/projects/:projectId/modules/:moduleId', async (request) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return service.updateModule(request.params.projectId, request.params.moduleId, {
      code: codeField(body, 'code', '模块编号', false),
      name: optionalTextField(body, 'name', '模块名称', 120),
      description: optionalTextField(body, 'description', '模块说明', 500, true),
      sortOrder: sortOrderField(body, false),
    });
  });

  app.get<{ Params: ProjectParams; Querystring: { moduleId?: string } }>('/api/projects/:projectId/features', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listFeatures(request.params.projectId, request.query.moduleId);
  });

  app.post<{ Params: ProjectParams }>('/api/projects/:projectId/features', async (request, reply) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return reply.code(201).send(service.createFeature(request.params.projectId, {
      moduleId: textField(body, 'moduleId', '所属模块', 64),
      code: codeField(body, 'code', '功能编号', true)!,
      name: textField(body, 'name', '功能名称', 120),
      summary: optionalTextField(body, 'summary', '功能摘要', 1000, true) ?? '',
      status: statusField(body, true)!,
      sortOrder: sortOrderField(body, true)!,
    }));
  });

  app.get<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getFeature(request.params.projectId, request.params.featureId);
  });

  app.get<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId/design-guidance', async (request) => {
    await auth.require(request, 'spec:read', true);
    service.getFeature(request.params.projectId, request.params.featureId);
    return service.getFeatureDesignGuidance(request.params.featureId);
  });

  app.patch<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId', async (request) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return service.updateFeature(request.params.projectId, request.params.featureId, {
      moduleId: optionalTextField(body, 'moduleId', '所属模块', 64),
      code: codeField(body, 'code', '功能编号', false),
      name: optionalTextField(body, 'name', '功能名称', 120),
      summary: optionalTextField(body, 'summary', '功能摘要', 1000, true),
      status: statusField(body, false),
      sortOrder: sortOrderField(body, false),
    });
  });

  app.get<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId/capabilities', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listCapabilities(request.params.projectId, request.params.featureId);
  });

  app.post<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId/capabilities', async (request, reply) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return reply.code(201).send(service.createCapability(request.params.projectId, request.params.featureId, {
      code: codeField(body, 'code', 'Capability 编号', true)!,
      name: textField(body, 'name', 'Capability 名称', 120),
      summary: optionalTextField(body, 'summary', 'Capability 摘要', 1000, true) ?? '',
      status: capabilityStatusField(body, false),
      sortOrder: sortOrderField(body, true)!,
    }));
  });

  app.get<{ Params: CapabilityParams }>('/api/projects/:projectId/features/:featureId/capabilities/:capabilityId', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getCapabilityDetail(request.params.projectId, request.params.featureId, request.params.capabilityId);
  });

  app.patch<{ Params: CapabilityParams }>('/api/projects/:projectId/features/:featureId/capabilities/:capabilityId', async (request) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return service.updateCapability(request.params.projectId, request.params.featureId, request.params.capabilityId, {
      code: codeField(body, 'code', 'Capability 编号', false),
      name: optionalTextField(body, 'name', 'Capability 名称', 120),
      summary: optionalTextField(body, 'summary', 'Capability 摘要', 1000, true),
      status: capabilityStatusField(body, false),
      sortOrder: sortOrderField(body, false),
    });
  });

  app.get<{ Params: CapabilityParams }>('/api/projects/:projectId/features/:featureId/capabilities/:capabilityId/design-guidance', async (request) => {
    await auth.require(request, 'spec:read', true);
    service.getCapabilityDetail(request.params.projectId, request.params.featureId, request.params.capabilityId);
    return service.getCapabilityDesignGuidance(request.params.capabilityId);
  });

  app.get<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId/engineering-blueprint', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getFeatureEngineeringBlueprint(request.params.projectId, request.params.featureId);
  });

  app.post<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId/engineering-blueprint/plan', async (request) => {
    await auth.require(request, 'planning:write', true);
    const body = request.body === undefined ? {} : bodyObject(request.body);
    const createAssets = !Object.hasOwn(body, 'createAssets') || body.createAssets !== false;
    service.getFeature(request.params.projectId, request.params.featureId);
    return service.planEngineeringBlueprint(request.params.featureId, createAssets);
  });

  app.get<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId/engineering-assets', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listEngineeringAssets(request.params.projectId, request.params.featureId);
  });

  app.post<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId/engineering-assets', async (request, reply) => {
    const principal = await auth.require(request, 'planning:write', true);
    const body = bodyObject(request.body);
    return reply.code(201).send(service.createEngineeringAsset(request.params.projectId, request.params.featureId, {
      moduleId: optionalNullableUuidField(body, 'moduleId', '模块 ID'),
      capabilityId: optionalNullableUuidField(body, 'capabilityId', '能力项 ID'),
      kind: textField(body, 'kind', '工程设计类型', 80),
      name: textField(body, 'name', '工程设计名称', 160),
      code: nullableTextField(body, 'code', '工程设计编号', 100),
      summary: optionalTextField(body, 'summary', '工程设计摘要', 2000, true) ?? '',
      structuredData: optionalObjectField(body, 'structuredData'),
      contentMarkdown: nullableTextField(body, 'contentMarkdown', '详细说明', 200_000),
      status: optionalTextField(body, 'status', '状态', 40) ?? 'DESIGNED',
      source: principal.kind === 'ai_token' ? `ai-token:${principal.id}` : 'owner:1',
      changeSummary: optionalTextField(body, 'changeSummary', '变更摘要', 500, true) ?? '创建工程设计',
    }));
  });

  app.get<{ Params: AssetParams }>('/api/projects/:projectId/engineering-assets/:assetId', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getEngineeringAsset(request.params.projectId, request.params.assetId);
  });

  app.patch<{ Params: AssetParams }>('/api/projects/:projectId/engineering-assets/:assetId', async (request) => {
    const principal = await auth.require(request, 'planning:write', true);
    const body = bodyObject(request.body);
    return service.updateEngineeringAsset(request.params.projectId, request.params.assetId, {
      expectedCurrentRevisionId: uuidField(body, 'expectedCurrentRevisionId', '期望当前版本 ID'),
      changeSummary: textField(body, 'changeSummary', '变更摘要', 500, true),
      source: principal.kind === 'ai_token' ? `ai-token:${principal.id}` : 'owner:1',
      capabilityId: optionalNullableUuidField(body, 'capabilityId', '能力项 ID'),
      kind: optionalTextField(body, 'kind', '工程设计类型', 80),
      name: optionalTextField(body, 'name', '工程设计名称', 160),
      code: Object.hasOwn(body, 'code') ? nullableTextField(body, 'code', '工程设计编号', 100) : undefined,
      summary: optionalTextField(body, 'summary', '工程设计摘要', 2000, true),
      structuredData: optionalObjectField(body, 'structuredData'),
      contentMarkdown: Object.hasOwn(body, 'contentMarkdown') ? nullableTextField(body, 'contentMarkdown', '详细说明', 200_000) : undefined,
      status: optionalTextField(body, 'status', '状态', 40),
    });
  });

  app.get<{ Params: AssetParams }>('/api/projects/:projectId/engineering-assets/:assetId/revisions', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getEngineeringAssetHistory(request.params.projectId, request.params.assetId);
  });

  app.get<{ Params: AssetRevisionParams }>('/api/projects/:projectId/engineering-assets/:assetId/revisions/:revisionId', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getEngineeringAssetRevision(request.params.projectId, request.params.assetId, request.params.revisionId);
  });

  app.post<{ Params: AssetParams }>('/api/projects/:projectId/engineering-assets/:assetId/revisions', async (request, reply) => {
    const principal = await auth.require(request, 'planning:write', true);
    const body = bodyObject(request.body);
    return reply.code(201).send(service.createEngineeringAssetRevision(request.params.projectId, request.params.assetId, {
      expectedCurrentRevisionId: uuidField(body, 'expectedCurrentRevisionId', '期望当前版本 ID'),
      changeSummary: textField(body, 'changeSummary', '变更摘要', 500, true),
      source: principal.kind === 'ai_token' ? `ai-token:${principal.id}` : 'owner:1',
      capabilityId: optionalNullableUuidField(body, 'capabilityId', '能力项 ID'),
      kind: optionalTextField(body, 'kind', '工程设计类型', 80),
      name: optionalTextField(body, 'name', '工程设计名称', 160),
      code: Object.hasOwn(body, 'code') ? nullableTextField(body, 'code', '工程设计编号', 100) : undefined,
      summary: optionalTextField(body, 'summary', '工程设计摘要', 2000, true),
      structuredData: optionalObjectField(body, 'structuredData'),
      contentMarkdown: Object.hasOwn(body, 'contentMarkdown') ? nullableTextField(body, 'contentMarkdown', '详细说明', 200_000) : undefined,
      status: optionalTextField(body, 'status', '状态', 40),
    }));
  });

  app.post<{ Params: ProjectParams }>('/api/projects/:projectId/trace-links', async (request, reply) => {
    await auth.require(request, 'planning:write', true);
    const body = bodyObject(request.body);
    return reply.code(201).send(service.createTraceLink(request.params.projectId, {
      sourceType: textField(body, 'sourceType', '来源类型', 80), sourceId: textField(body, 'sourceId', '来源 ID', 100),
      targetType: textField(body, 'targetType', '目标类型', 80), targetId: textField(body, 'targetId', '目标 ID', 100),
      relation: textField(body, 'relation', '关系', 80),
    }));
  });

  app.post<{ Params: CapabilityParams }>('/api/projects/:projectId/features/:featureId/capabilities/:capabilityId/design', async (request, reply) => {
    const principal = await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    service.getCapabilityDetail(request.params.projectId, request.params.featureId, request.params.capabilityId);
    return reply.code(201).send(service.createCapabilityDesign(request.params.capabilityId, {
      content: textField(body, 'content', 'Capability 设计正文', 200_000, true),
      changeSummary: textField(body, 'changeSummary', '变更摘要', 500),
      source: principal.kind === 'ai_token' ? `ai-token:${principal.id}` : 'owner:1',
    }));
  });

  app.get<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId/tasks', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listTasks(request.params.projectId, request.params.featureId);
  });

  app.post<{ Params: FeatureParams }>('/api/projects/:projectId/features/:featureId/tasks', async (request, reply) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return reply.code(201).send(service.createTask(request.params.projectId, request.params.featureId, {
      code: codeField(body, 'code', '任务编号', true)!,
      name: textField(body, 'name', '任务名称', 120),
      type: taskTypeField(body, true)!,
      category: taskCategoryField(body, false),
      area: optionalTextField(body, 'area', 'Task 区域', 80, true) ?? '',
      capabilityId: optionalNullableUuidField(body, 'capabilityId', 'Capability ID'),
      status: taskStatusField(body, true)!,
      designRevisionId: optionalNullableUuidField(body, 'designRevisionId', 'Design Revision ID'),
      objective: optionalTextField(body, 'objective', '任务目标', 2000, true) ?? '',
      sortOrder: sortOrderField(body, true)!,
    }));
  });

  app.get<{ Params: TaskParams }>('/api/projects/:projectId/features/:featureId/tasks/:taskId', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getTask(request.params.projectId, request.params.featureId, request.params.taskId);
  });

  app.patch<{ Params: TaskParams }>('/api/projects/:projectId/features/:featureId/tasks/:taskId', async (request) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return service.updateTask(request.params.projectId, request.params.featureId, request.params.taskId, {
      code: codeField(body, 'code', '任务编号', false),
      name: optionalTextField(body, 'name', '任务名称', 120),
      type: taskTypeField(body, false),
      category: taskCategoryField(body, false),
      area: optionalTextField(body, 'area', 'Task 区域', 80, true),
      capabilityId: optionalNullableUuidField(body, 'capabilityId', 'Capability ID'),
      status: taskStatusField(body, false),
      designRevisionId: optionalNullableUuidField(body, 'designRevisionId', 'Design Revision ID'),
      objective: optionalTextField(body, 'objective', '任务目标', 2000, true),
      sortOrder: sortOrderField(body, false),
    });
  });

  app.get<{ Params: TaskParams }>('/api/projects/:projectId/features/:featureId/tasks/:taskId/authorizations', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listAuthorizations(request.params.projectId, request.params.featureId, request.params.taskId);
  });

  app.post<{ Params: TaskParams }>('/api/projects/:projectId/features/:featureId/tasks/:taskId/authorizations', async (request, reply) => {
    await auth.require(request, 'owner', true);
    return reply.code(201).send(service.authorizeTask(request.params.projectId, request.params.featureId, request.params.taskId));
  });

  app.post<{ Params: AuthorizationParams }>('/api/projects/:projectId/features/:featureId/tasks/:taskId/authorizations/:authorizationId/revoke', async (request) => {
    await auth.require(request, 'owner', true);
    return service.revokeAuthorization(request.params.projectId, request.params.featureId, request.params.taskId, request.params.authorizationId);
  });

  app.post<{ Params: TaskParams }>('/api/projects/:projectId/features/:featureId/tasks/:taskId/runs', async (request, reply) => {
    const principal = await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    const actorName = principal.kind === 'ai_token' ? principal.name
      : optionalTextField(body, 'actorName', '执行者名称', 80) ?? (principal.kind === 'owner' ? principal.username : 'manual-test');
    return reply.code(201).send(service.startRun(request.params.projectId, request.params.featureId, request.params.taskId, {
      authorizationId: Object.hasOwn(body, 'authorizationId') ? optionalNullableUuidField(body, 'authorizationId', 'Authorization ID') ?? null : null,
      actorType: principal.kind === 'ai_token' ? 'AI_TOKEN' : 'MANUAL',
      actorName,
      baseCommit: nullableTextField(body, 'baseCommit', '基础 Commit', 100),
      sourceExecutions: sourceExecutionsField(body),
    }));
  });

  app.post<{ Params: TaskParams }>('/api/projects/:projectId/features/:featureId/tasks/:taskId/confirm', async (request) => {
    await auth.require(request, 'owner', true);
    return service.confirmTask(request.params.projectId, request.params.featureId, request.params.taskId);
  });

  app.post<{ Params: TaskParams }>('/api/projects/:projectId/features/:featureId/tasks/:taskId/return', async (request) => {
    await auth.require(request, 'owner', true);
    return service.returnTask(request.params.projectId, request.params.featureId, request.params.taskId);
  });

  app.get<{ Params: ProjectParams }>('/api/projects/:projectId/runs', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listRuns(request.params.projectId);
  });

  app.get<{ Params: RunParams }>('/api/projects/:projectId/runs/:runId', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getRun(request.params.projectId, request.params.runId);
  });

  app.patch<{ Params: RunParams }>('/api/projects/:projectId/runs/:runId/phase', async (request) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    if (typeof body.phase !== 'string' || !RUN_PHASES.includes(body.phase as RunPhase)) {
      throw new ApiError(400, 'INVALID_INPUT', 'Run 阶段不合法');
    }
    return service.updateRunPhase(request.params.projectId, request.params.runId, body.phase as RunPhase);
  });

  app.post<{ Params: RunParams }>('/api/projects/:projectId/runs/:runId/submit', async (request) => {
    const principal = await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    const verification = verificationSummaryField(body);
    return service.submitRun(request.params.projectId, request.params.runId, {
      summary: textField(body, 'summary', '执行摘要', 4000, true),
      resultCommit: nullableTextField(body, 'resultCommit', '结果 Commit', 100),
      changedFiles: changedFilesField(body),
      verificationSummary: {
        ...verification,
        origin: principal.kind === 'ai_token' ? 'AI_REPORTED' : 'HUMAN',
      },
      issues: stringListField(body, 'issues', '问题列表', 100),
      sourceExecutions: sourceExecutionsField(body),
    });
  });

  app.post<{ Params: RunParams }>('/api/projects/:projectId/runs/:runId/fail', async (request) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return service.finishRun(request.params.projectId, request.params.runId, 'FAILED', {
      summary: textField(body, 'summary', '失败摘要', 4000, true),
      issues: stringListField(body, 'issues', '问题列表', 100),
    });
  });

  app.post<{ Params: RunParams }>('/api/projects/:projectId/runs/:runId/abort', async (request) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    return service.finishRun(request.params.projectId, request.params.runId, 'ABORTED', {
      summary: textField(body, 'summary', '中断摘要', 4000, true),
      issues: stringListField(body, 'issues', '问题列表', 100),
    });
  });

  app.post<{ Params: ProjectParams }>('/api/projects/:projectId/specifications', async (request, reply) => {
    await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    const kind = textField(body, 'kind', '规格类型', 40);
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(kind)) {
      throw new ApiError(400, 'INVALID_INPUT', '规格类型只支持小写字母、数字、_ 或 -');
    }
    const title = textField(body, 'title', '规格标题', 120);
    const featureId = Object.hasOwn(body, 'featureId')
      ? body.featureId === null ? null : textField(body, 'featureId', '关联功能', 64)
      : null;
    const capabilityId = Object.hasOwn(body, 'capabilityId')
      ? body.capabilityId === null ? null : textField(body, 'capabilityId', '关联 Capability', 64)
      : null;
    return reply.code(201).send(service.createSpecification(request.params.projectId, { kind, title, featureId, capabilityId }));
  });

  app.get<{ Params: SpecParams }>('/api/projects/:projectId/specifications/:specId', async (request) => {
    await auth.require(request, 'spec:read', true);
    return service.getSpecification(request.params.projectId, request.params.specId);
  });

  app.post<{ Params: SpecParams }>('/api/projects/:projectId/specifications/:specId/revisions', async (request, reply) => {
    const principal = await auth.require(request, 'spec:write', true);
    const body = bodyObject(request.body);
    const content = textField(body, 'content', '规格正文', 200_000, true);
    const changeSummary = textField(body, 'changeSummary', '变更摘要', 500);
    if (!Object.hasOwn(body, 'expectedHeadRevisionId') ||
      (body.expectedHeadRevisionId !== null &&
        (typeof body.expectedHeadRevisionId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.expectedHeadRevisionId)))) {
      throw new ApiError(400, 'INVALID_INPUT', '必须提供 expectedHeadRevisionId；初版为 null');
    }
    return reply.code(201).send(service.createRevision(request.params.projectId, request.params.specId, {
      content, changeSummary, expectedHeadRevisionId: body.expectedHeadRevisionId as string | null,
      source: principal.kind === 'ai_token' ? `ai-token:${principal.id}`
        : principal.kind === 'owner' ? 'owner:1' : 'local-web',
    }));
  });

  app.get<{ Params: SpecParams }>('/api/projects/:projectId/specifications/:specId/revisions', async (request) => {
    await auth.require(request, 'spec:read', true);
    return service.listRevisions(request.params.projectId, request.params.specId);
  });

  app.get<{ Params: RevisionParams }>(
    '/api/projects/:projectId/specifications/:specId/revisions/:revisionId',
    async (request) => {
      await auth.require(request, 'spec:read', true);
      return service.getRevision(request.params.projectId, request.params.specId, request.params.revisionId);
    },
  );

  app.get<{ Params: ProjectParams }>('/api/projects/:projectId/reviews', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listReviews(request.params.projectId);
  });

  app.post<{ Params: RevisionParams }>(
    '/api/projects/:projectId/specifications/:specId/revisions/:revisionId/reviews',
    async (request, reply) => {
      await auth.require(request, 'spec:write', true);
      return reply.code(201).send(service.submitDesignReview(
        request.params.projectId,
        request.params.specId,
        request.params.revisionId,
      ));
    },
  );

  app.post<{ Params: ReviewParams }>('/api/projects/:projectId/reviews/:reviewId/decision', async (request) => {
    await auth.require(request, 'owner', true);
    const body = bodyObject(request.body);
    if (body.decision !== 'APPROVED' && body.decision !== 'CHANGES_REQUESTED') {
      throw new ApiError(400, 'INVALID_INPUT', '评审决定必须是 APPROVED 或 CHANGES_REQUESTED');
    }
    const comment = Object.hasOwn(body, 'comment')
      ? optionalTextField(body, 'comment', '评审意见', 1000, true) ?? null
      : null;
    return service.decideDesignReview(request.params.projectId, request.params.reviewId, body.decision, comment);
  });
}
