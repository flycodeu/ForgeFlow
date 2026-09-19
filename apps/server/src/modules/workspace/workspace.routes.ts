import type { FastifyInstance } from 'fastify';
import type { FeatureStatus } from '@forgeflow/contracts';
import { ApiError } from '../../shared/api-error.js';
import { AuthService } from '../security/auth.service.js';
import { WorkspaceService } from './workspace.service.js';

type ProjectParams = { projectId: string };
type ModuleParams = ProjectParams & { moduleId: string };
type FeatureParams = ProjectParams & { featureId: string };
type SpecParams = ProjectParams & { specId: string };
type RevisionParams = SpecParams & { revisionId: string };
const FEATURE_STATUSES: readonly FeatureStatus[] = [
  'DRAFT', 'DESIGNING', 'READY', 'IMPLEMENTING', 'VERIFYING', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'DELIVERED',
];

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

export function registerWorkspaceRoutes(app: FastifyInstance, service: WorkspaceService, auth: AuthService) {
  app.post('/api/projects', async (request, reply) => {
    await auth.require(request, 'owner', true);
    const body = bodyObject(request.body);
    const projectKey = textField(body, 'projectKey', '项目标识', 32).toUpperCase();
    if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(projectKey)) {
      throw new ApiError(400, 'INVALID_INPUT', '项目标识须以字母开头，并包含 2–32 个字母、数字、_ 或 -');
    }
    const name = textField(body, 'name', '项目名称', 120);
    return reply.code(201).send(service.createProject({ projectKey, name }));
  });

  app.get('/api/projects', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.listProjects();
  });

  app.get<{ Params: ProjectParams }>('/api/projects/:projectId', async (request) => {
    await auth.require(request, 'project:read', true);
    return service.getProject(request.params.projectId);
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
    return reply.code(201).send(service.createSpecification(request.params.projectId, { kind, title, featureId }));
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
}
