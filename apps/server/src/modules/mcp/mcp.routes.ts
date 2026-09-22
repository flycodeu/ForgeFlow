import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  AiScope, CapabilityStatus, ProjectSourceKind, RequestSourceAnalysisInput, ResolveProjectSourcesInput, RunPhase, SubmitSourceAnalysisInput,
  RunChangedFile, RunReportedStatus, RunSourceExecution, TaskCategory, TaskType, UpsertProjectSourceInput, WorkflowMode,
} from '@forgeflow/contracts';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { ApiError } from '../../shared/api-error.js';
import type { AiTokenPrincipal, AuthService } from '../security/auth.service.js';
import type { WorkspaceService } from '../workspace/workspace.service.js';
import type { ArchiveService } from '../archive/archive.service.js';

const TOOL_SCOPES: Record<string, AiScope[]> = {
  list_project_archive: ['project:read', 'spec:read'],
  get_project_document: ['project:read', 'spec:read'],
  archive_project_document: ['spec:write'],
  record_project_work: ['spec:write'],
  list_project_work: ['project:read', 'spec:read'],
  list_projects: ['project:read'],
  resolve_project_and_sources: ['project:read'],
  get_project_context: ['project:read', 'spec:read', 'task:read'],
  get_feature_context: ['project:read', 'spec:read', 'task:read'],
  get_feature_design_guidance: ['project:read', 'spec:read', 'task:read'],
  get_capability_context: ['project:read', 'spec:read', 'task:read'],
  get_capability_design_guidance: ['project:read', 'spec:read'],
  get_engineering_blueprint: ['project:read', 'spec:read', 'task:read'],
  get_engineering_asset: ['project:read', 'spec:read'],
  get_engineering_asset_history: ['project:read', 'spec:read'],
  get_feature_delivery_context: ['project:read', 'spec:read', 'task:read'],
  get_current_authorized_task: ['spec:read', 'task:read'],
  get_project_planning_context: ['project:read', 'spec:read', 'task:read'],
  get_pending_reviews: ['project:read', 'spec:read'],
  create_project_draft: ['project:write'],
  upsert_project_source: ['planning:write'],
  request_source_analysis: ['planning:write'],
  claim_source_analysis: ['planning:write'],
  submit_source_analysis: ['planning:write'],
  create_project_spec: ['planning:write'],
  create_spec_revision: ['planning:write'],
  create_module: ['planning:write'],
  create_feature: ['planning:write'],
  create_capability: ['planning:write'],
  create_feature_design: ['planning:write'],
  create_capability_design: ['planning:write'],
  plan_engineering_blueprint: ['planning:write'],
  create_engineering_asset: ['planning:write'],
  create_engineering_asset_revision: ['planning:write'],
  create_trace_link: ['planning:write'],
  create_task_plan: ['planning:write'],
  submit_design_review: ['planning:write'],
  start_run: ['run:write'],
  update_run_phase: ['run:write'],
  submit_run_result: ['run:write'],
  report_run_failure: ['run:write'],
};

function toolNames(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object' || !('method' in message) || message.method !== 'tools/call') return [];
    const params = 'params' in message && message.params && typeof message.params === 'object' ? message.params : null;
    return params && 'name' in params && typeof params.name === 'string' ? [params.name] : [];
  });
}

function requiredScopes(body: unknown): AiScope[] {
  return [...new Set(toolNames(body).flatMap((name) => TOOL_SCOPES[name] ?? []))];
}

function assertLocalMcpRequest(request: FastifyRequest) {
  const hostHeader = request.headers.host?.toLowerCase();
  const host = hostHeader?.startsWith('[')
    ? hostHeader.slice(1, hostHeader.indexOf(']'))
    : hostHeader?.split(':')[0];
  if (!host || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new ApiError(403, 'FORBIDDEN_HOST', 'MCP 仅接受本机 Host');
  }
  const origin = request.headers.origin;
  if (origin) {
    let hostname: string;
    try { hostname = new URL(origin).hostname.toLowerCase(); } catch { throw new ApiError(403, 'FORBIDDEN_ORIGIN', 'MCP Origin 无效'); }
    if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
      throw new ApiError(403, 'FORBIDDEN_ORIGIN', 'MCP 仅接受本机 Origin');
    }
  }
}

const changedFileSchema = z.union([
  z.string().trim().min(1).max(500),
  z.object({ sourceId: z.string().uuid(), relativePath: z.string().trim().min(1).max(1000) }).strict(),
]);

const sourceExecutionSchema = z.object({
  sourceId: z.string().uuid(),
  baseline: z.object({
    kind: z.string().trim().min(1).max(40), commit: z.string().trim().max(100).nullable(),
    dirty: z.boolean().nullable(), manifestHash: z.string().trim().max(200).nullable(),
  }).strict(),
  result: z.object({
    commit: z.string().trim().max(100).nullable(), workingTreeSummary: z.string().trim().max(4000).nullable(),
  }).strict(),
  read: z.boolean(), modified: z.boolean(),
  changedFiles: z.array(z.object({ sourceId: z.string().uuid(), relativePath: z.string().trim().min(1).max(1000) }).strict()).max(500),
  verification: z.array(z.object({
    command: z.string().trim().min(1).max(1000), workdir: z.string().trim().min(1).max(1000),
    reportedStatus: z.enum(['PASS', 'FAIL', 'NOT_RUN', 'SKIPPED', 'ERROR']), summary: z.string().trim().max(2000),
  }).strict()).max(100),
}).strict();

function toolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function toolError(error: unknown) {
  const payload = error instanceof ApiError
    ? { code: error.code, message: error.message, ...error.details }
    : { code: 'INTERNAL_ERROR', message: 'ForgeFlow MCP Tool 执行失败' };
  return { isError: true as const, content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

function safely<TArgs>(work: (args: TArgs) => unknown | Promise<unknown>) {
  return async (args: TArgs) => {
    try { return toolResult(await work(args)); } catch (error) { return toolError(error); }
  };
}

function createForgeFlowMcpServer(workspace: WorkspaceService, principal: AiTokenPrincipal, archive: ArchiveService) {
  const server = new McpServer({ name: 'forgeflow', version: '0.1.0' });

  server.registerTool('list_projects', {
    title: '列出 ForgeFlow 项目',
    description: '列出当前 AI Token 可读取的本地 ForgeFlow 项目。',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
  }, safely(() => workspace.listProjectsForMcp()));

  server.registerTool('resolve_project_and_sources', {
    title: '精确解析项目与源码绑定',
    description: '优先按 projectId 或 projectCode 精确解析项目，并读取其 Source、环境位置、Scope 与登记状态。辅助条件存在歧义时返回候选，不会自动选择第一项。',
    inputSchema: z.object({
      projectId: z.string().uuid().optional(),
      projectCode: z.string().trim().min(1).max(32).optional(),
      cwd: z.string().trim().min(1).max(1024).optional(),
      remoteUrl: z.string().trim().min(1).max(2048).optional(),
      projectName: z.string().trim().min(1).max(120).optional(),
    }).strict(),
    annotations: { readOnlyHint: true },
  }, safely((input: ResolveProjectSourcesInput) => workspace.resolveProjectAndSources(input)));

  server.registerTool('upsert_project_source', {
    title: '登记或更新项目源码位置',
    description: '保存用户明确指定的源码绑定和某个工作环境位置。只登记字符串，不检查目录、不读取文件、不 clone 仓库。新位置默认 REGISTERED / UNKNOWN。',
    inputSchema: z.object({
      projectId: z.string().uuid(), sourceId: z.string().uuid().nullable().optional(),
      alias: z.string().trim().min(1).max(40), displayName: z.string().trim().min(1).max(120),
      purpose: z.string().trim().max(500), sourceKind: z.enum(['GIT', 'DIRECTORY']),
      environmentKey: z.string().trim().min(1).max(80), localRoot: z.string().trim().min(1).max(1024),
      remoteUrl: z.string().trim().max(2048).nullable().optional(), repoSubdir: z.string().trim().max(500).nullable().optional(),
      scope: z.object({
        include: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
        exclude: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
      }).strict().nullable().optional(),
      expectedUpdatedAt: z.string().datetime().nullable().optional(),
      idempotencyKey: z.string().trim().min(1).max(120),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: UpsertProjectSourceInput & { sourceKind: ProjectSourceKind }) => workspace.upsertProjectSource(input)));

  server.registerTool('request_source_analysis', {
    title: '创建源码分析请求',
    description: '为明确的 Source 和环境创建 WAITING_AI 请求。不会启动模型、读取目录、生成工程设计或修改功能与执行状态。',
    inputSchema: z.object({
      projectId: z.string().uuid(), sourceIds: z.array(z.string().uuid()).min(1).max(100),
      environmentKey: z.string().trim().min(1).max(80), featureId: z.string().uuid().nullable().optional(),
      capabilityId: z.string().uuid().nullable().optional(),
      analysisScope: z.record(z.string(), z.unknown()).nullable().optional(), prompt: z.string().trim().max(4000).nullable().optional(),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: RequestSourceAnalysisInput) => workspace.requestSourceAnalysis(input)));

  server.registerTool('claim_source_analysis', {
    title: '领取源码分析请求',
    description: '把 WAITING_AI 请求置为 READING，并返回已登记 Source、环境位置、范围和排除规则。只领取，不读取文件。',
    inputSchema: z.object({ projectId: z.string().uuid(), analysisId: z.string().uuid() }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely(({ projectId, analysisId }: { projectId: string; analysisId: string }) =>
    workspace.claimSourceAnalysis(projectId, analysisId)));

  server.registerTool('submit_source_analysis', {
    title: '提交源码分析结果',
    description: '写回只读源码分析的快照、代码引用、摘要、检查点与错误；不会修改业务源码或自动创建功能。',
    inputSchema: z.object({
      projectId: z.string().uuid(), analysisId: z.string().uuid(), status: z.enum(['PARTIAL', 'SYNCED', 'FAILED']),
      sourceSnapshots: z.record(z.string().uuid(), z.unknown()).nullable().optional(),
      checkpoint: z.record(z.string(), z.unknown()).nullable().optional(),
      summary: z.string().trim().min(1).max(4000),
      errors: z.record(z.string(), z.unknown()).nullable().optional(),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: SubmitSourceAnalysisInput) => workspace.submitSourceAnalysis(input)));

  server.registerTool('get_project_context', {
    title: '读取项目上下文',
    description: '读取项目当前需求、架构、技术栈、模块、功能与未完成 Task 摘要，不返回历史 Revision。',
    inputSchema: z.object({ projectId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId }: { projectId: string }) => workspace.getProjectContext(projectId)));

  server.registerTool('get_feature_context', {
    title: '读取 Feature 上下文',
    description: '读取 Feature、Module、当前设计 Revision、Task 和最近 Run 摘要。',
    inputSchema: z.object({ featureId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, safely(({ featureId }: { featureId: string }) => workspace.getFeatureContext(featureId)));

  server.registerTool('get_feature_design_guidance', {
    title: '生成自适应 Feature 设计指导',
    description: '返回可选的项目适配章节、Markdown 模板和任务建议；不要求调用此工具或遵循模板，可保留原有文档并自主扩展设计。',
    inputSchema: z.object({ featureId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ featureId }: { featureId: string }) => workspace.getFeatureDesignGuidance(featureId)));

  server.registerTool('get_capability_context', {
    title: '读取 Capability 上下文',
    description: '读取 Capability、当前设计 Revision、实施所用 Revision、Task、Run、代码改动和验证结果。',
    inputSchema: z.object({ projectId: z.string().uuid(), featureId: z.string().uuid(), capabilityId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId, featureId, capabilityId }: { projectId: string; featureId: string; capabilityId: string }) =>
    workspace.getCapabilityDetail(projectId, featureId, capabilityId)));

  server.registerTool('get_capability_design_guidance', {
    title: '生成自适应 Capability 设计指导',
    description: '根据 designProfile、项目上下文和 Capability 语义返回通用章节与技术适配章节；不得为非 Web 项目虚构 Web 结构。',
    inputSchema: z.object({ capabilityId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ capabilityId }: { capabilityId: string }) => workspace.getCapabilityDesignGuidance(capabilityId)));

  server.registerTool('get_engineering_blueprint', {
    title: '读取功能工程蓝图',
    description: '读取功能的能力项、工程设计对象、完整度和追踪关系。结构化核心信息用于实施，Markdown 只承载补充说明。',
    inputSchema: z.object({ projectId: z.string().uuid(), featureId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId, featureId }: { projectId: string; featureId: string }) =>
    workspace.getFeatureEngineeringBlueprint(projectId, featureId)));

  server.registerTool('get_engineering_asset', {
    title: '读取工程设计当前版本',
    description: '读取稳定 EngineeringAsset 身份及其当前不可变 Revision；structuredData 是核心事实，Markdown 是补充说明。',
    inputSchema: z.object({ projectId: z.string().uuid(), assetId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId, assetId }: { projectId: string; assetId: string }) =>
    workspace.getEngineeringAsset(projectId, assetId)));

  server.registerTool('get_engineering_asset_history', {
    title: '读取工程设计版本历史',
    description: '返回 EngineeringAsset 的全部只读 Revision，旧版本不会随当前设计更新。',
    inputSchema: z.object({ projectId: z.string().uuid(), assetId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId, assetId }: { projectId: string; assetId: string }) =>
    workspace.getEngineeringAssetHistory(projectId, assetId)));

  server.registerTool('get_feature_delivery_context', {
    title: '读取功能交付上下文',
    description: '返回当前工程设计 Revision、Run 的服务端设计快照、源码执行快照和 CURRENT/STALE 判断。',
    inputSchema: z.object({ projectId: z.string().uuid(), featureId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId, featureId }: { projectId: string; featureId: string }) =>
    workspace.getFeatureDeliveryContext(projectId, featureId)));

  server.registerTool('get_current_authorized_task', {
    title: '获取下一项可执行任务',
    description: 'AUTO 项目返回可直接执行的 PLANNED/BLOCKED Task；CONTROLLED 项目仍要求 ACTIVE Authorization。',
    inputSchema: z.object({ featureId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, safely(({ featureId }: { featureId: string }) => workspace.getCurrentAuthorizedTask(featureId)));

  server.registerTool('get_project_planning_context', {
    title: '读取项目规划上下文',
    description: '读取当前五类项目资料、功能与任务；历史/候选资料仅提供索引，必要时按需读取，勿将原文和状态摘要复制为设计。',
    inputSchema: z.object({ projectId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId }: { projectId: string }) => workspace.getProjectPlanningContext(projectId)));

  server.registerTool('get_pending_reviews', {
    title: '读取待处理设计评审',
    description: '读取项目中真实存在的 PENDING 设计评审；AI 只能读取和提交，不能批准或要求修改。',
    inputSchema: z.object({ projectId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId }: { projectId: string }) => workspace.getPendingReviews(projectId)));

  server.registerTool('create_project_draft', {
    title: '创建项目草稿',
    description: '仅在用户明确要求创建新项目时使用。项目 code 不可重复。',
    inputSchema: z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{1,31}$/),
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000),
      projectType: z.string().trim().min(1).max(80).optional(),
      workflowMode: z.enum(['AUTO', 'CONTROLLED']).optional(),
      designProfile: z.string().trim().min(1).max(40).optional(),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { code: string; name: string; description: string; projectType?: string; workflowMode?: WorkflowMode; designProfile?: string }) => workspace.createProjectDraft(input)));

  server.registerTool('create_project_spec', {
    title: '创建项目级设计资料',
    description: '创建唯一的项目背景、调研、需求、架构或技术选型 Specification。若同类型已存在，必须改用 create_spec_revision。',
    inputSchema: z.object({
      projectId: z.string().uuid(),
      type: z.enum(['BACKGROUND', 'RESEARCH', 'REQUIREMENT', 'ARCHITECTURE', 'TECHNOLOGY']),
      title: z.string().trim().min(1).max(120),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { projectId: string; type: 'BACKGROUND' | 'RESEARCH' | 'REQUIREMENT' | 'ARCHITECTURE' | 'TECHNOLOGY'; title: string }) =>
    workspace.createProjectSpecification(input.projectId, input)));

  server.registerTool('create_spec_revision', {
    title: '创建设计资料 Revision',
    description: '按当前需求和真实来源提炼有变化的设计；必须提交刚读取到的 expectedHeadRevisionId。无变化和未填写模板会拒绝。',
    inputSchema: z.object({
      specId: z.string().uuid(),
      expectedHeadRevisionId: z.string().uuid().nullable(),
      changeSummary: z.string().trim().min(1).max(500),
      content: z.string().min(1).max(200_000),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { specId: string; expectedHeadRevisionId: string | null; changeSummary: string; content: string }) =>
    workspace.createRevisionBySpecId(input.specId, { ...input, source: `ai-token:${principal.id}` })));

  server.registerTool('create_module', {
    title: '创建项目 Module',
    description: '在读取规划上下文后创建 Module；同 code 或同名 Module 不会重复创建。',
    inputSchema: z.object({
      projectId: z.string().uuid(),
      code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{0,39}$/),
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(500),
      sortOrder: z.number().int().nonnegative(),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { projectId: string; code: string; name: string; description: string; sortOrder: number }) =>
    workspace.createModuleForPlanning(input.projectId, input)));

  server.registerTool('create_feature', {
    title: '创建 Feature 草稿',
    description: '创建初始状态固定为 DRAFT 的 Feature；同 Module 下同 code 或同名 Feature 不会重复创建。',
    inputSchema: z.object({
      moduleId: z.string().uuid(),
      code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{0,39}$/),
      name: z.string().trim().min(1).max(120),
      summary: z.string().trim().max(1000),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { moduleId: string; code: string; name: string; summary: string }) =>
    workspace.createFeatureDraft(input.moduleId, input)));

  server.registerTool('create_capability', {
    title: '创建 Capability',
    description: '在 Feature 下创建用户可理解的独立能力。Capability 表达做什么，Task 只表达下一步如何实施。',
    inputSchema: z.object({
      projectId: z.string().uuid(), featureId: z.string().uuid(),
      code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{0,39}$/),
      name: z.string().trim().min(1).max(120), summary: z.string().trim().max(1000),
      status: z.enum(['DRAFT', 'DESIGNED', 'IMPLEMENTING', 'TESTING', 'DONE', 'BLOCKED']).optional(),
      sortOrder: z.number().int().nonnegative(),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { projectId: string; featureId: string; code: string; name: string; summary: string; status?: CapabilityStatus; sortOrder: number }) =>
    workspace.createCapability(input.projectId, input.featureId, input)));

  server.registerTool('create_feature_design', {
    title: '创建 Feature Design 初版',
    description: 'Feature 初版只写目标、操作入口、共同规则和未决；逐项字段、状态、异常、接口与表关系进入 Capability。不要复制原文、DDL、哈希或工程状态。',
    inputSchema: z.object({
      featureId: z.string().uuid(),
      changeSummary: z.string().trim().min(1).max(500),
      content: z.string().min(1).max(200_000),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { featureId: string; changeSummary: string; content: string }) =>
    workspace.createFeatureDesign(input.featureId, { ...input, source: `ai-token:${principal.id}` })));

  server.registerTool('create_capability_design', {
    title: '创建 Capability Design 初版',
    description: '一项操作一张设计卡：具体字段、输入输出、状态、失败、实际契约与数据关系、可验收结果；未定内容标待定，不提交模板占位。AUTO 最新 Revision 即实施设计，CONTROLLED 仍用批准版。',
    inputSchema: z.object({ capabilityId: z.string().uuid(), changeSummary: z.string().trim().min(1).max(500), content: z.string().min(1).max(200_000) }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { capabilityId: string; changeSummary: string; content: string }) =>
    workspace.createCapabilityDesign(input.capabilityId, { ...input, source: `ai-token:${principal.id}` })));

  server.registerTool('plan_engineering_blueprint', {
    title: '规划功能工程蓝图',
    description: '读取项目背景、调研、需求、架构、技术、功能和能力项，按可组合 designProfile 建议并创建缺失的工程设计骨架。不适用的 Web、数据库、UI 或部署内容不得生成。',
    inputSchema: z.object({ featureId: z.string().uuid(), createAssets: z.boolean().optional().default(true) }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely(({ featureId, createAssets }: { featureId: string; createAssets: boolean }) =>
    workspace.planEngineeringBlueprint(featureId, createAssets)));

  server.registerTool('create_engineering_asset', {
    title: '创建工程设计对象',
    description: '创建通用 Engineering Asset。kind 可扩展；structuredData 保存字段、方法、协议或 Stage 等核心信息，Markdown 保存原因和约束。',
    inputSchema: z.object({
      projectId: z.string().uuid(), featureId: z.string().uuid(), capabilityId: z.string().uuid().nullable().optional(),
      kind: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(160), code: z.string().trim().max(100).nullable().optional(),
      summary: z.string().trim().max(2000).optional(), structuredData: z.record(z.string(), z.unknown()).nullable().optional(),
      contentMarkdown: z.string().max(200_000).nullable().optional(), status: z.string().trim().max(40).optional(),
      changeSummary: z.string().trim().min(1).max(500).optional(),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { projectId: string; featureId: string; capabilityId?: string | null; kind: string; name: string; code?: string | null; summary?: string; structuredData?: Record<string, unknown> | null; contentMarkdown?: string | null; status?: string; changeSummary?: string }) =>
    workspace.createEngineeringAsset(input.projectId, input.featureId, {
      ...input, source: `ai-token:${principal.id}`, changeSummary: input.changeSummary ?? 'AI 创建工程设计',
    })));

  server.registerTool('create_engineering_asset_revision', {
    title: '创建工程设计新版本',
    description: '以 expectedCurrentRevisionId 乐观锁创建不可变 Revision；禁止直接覆盖当前内容。核心事实与 Markdown 冲突时拒绝发布。',
    inputSchema: z.object({
      projectId: z.string().uuid(), assetId: z.string().uuid(), expectedCurrentRevisionId: z.string().uuid(),
      changeSummary: z.string().trim().min(1).max(500),
      capabilityId: z.string().uuid().nullable().optional(), kind: z.string().trim().min(1).max(80).optional(),
      name: z.string().trim().min(1).max(160).optional(), code: z.string().trim().max(100).nullable().optional(),
      summary: z.string().trim().max(2000).optional(), structuredData: z.record(z.string(), z.unknown()).nullable().optional(),
      contentMarkdown: z.string().max(200_000).nullable().optional(), status: z.string().trim().max(40).optional(),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: {
    projectId: string; assetId: string; expectedCurrentRevisionId: string; changeSummary: string;
    capabilityId?: string | null; kind?: string; name?: string; code?: string | null; summary?: string;
    structuredData?: Record<string, unknown> | null; contentMarkdown?: string | null; status?: string;
  }) => workspace.createEngineeringAssetRevision(input.projectId, input.assetId, {
    ...input, source: `ai-token:${principal.id}`,
  })));

  server.registerTool('create_trace_link', {
    title: '创建研发追踪关系',
    description: '建立轻量来源、实现、依赖、验证或集成关系，不创建知识图谱。',
    inputSchema: z.object({ projectId: z.string().uuid(), sourceType: z.string().trim().min(1).max(80), sourceId: z.string().trim().min(1).max(100), targetType: z.string().trim().min(1).max(80), targetId: z.string().trim().min(1).max(100), relation: z.string().trim().min(1).max(80) }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { projectId: string; sourceType: string; sourceId: string; targetType: string; targetId: string; relation: string }) =>
    workspace.createTraceLink(input.projectId, input)));

  server.registerTool('create_task_plan', {
    title: '创建实施 Task 计划',
    description: '只为独立授权、验证或交付边界创建 Task。初始状态固定为 PLANNED；使用通用 category 和自由 area，禁止默认按 Frontend/Backend 或 Entity/DTO/Controller 机械拆分。',
    inputSchema: z.object({
      featureId: z.string().uuid(),
      code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{0,39}$/),
      name: z.string().trim().min(1).max(120),
      type: z.enum(['DESIGN', 'BACKEND', 'FRONTEND', 'INTEGRATION', 'VERIFICATION', 'OTHER']),
      category: z.enum(['DESIGN', 'IMPLEMENTATION', 'INTEGRATION', 'VERIFICATION', 'MIGRATION', 'CONTENT', 'OTHER']).optional(),
      area: z.string().trim().max(80).optional(),
      capabilityId: z.string().uuid().nullable().optional(),
      objective: z.string().trim().min(1).max(2000),
      sortOrder: z.number().int().nonnegative().optional(),
    }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely((input: { featureId: string; code: string; name: string; type: TaskType; category?: TaskCategory; area?: string; capabilityId?: string | null; objective: string; sortOrder?: number }) =>
    workspace.createTaskPlan(input.featureId, input)));

  server.registerTool('submit_design_review', {
    title: '提交设计评审',
    description: '将一个不可变 Revision 提交给本地人工评审。提交不等于批准，AI 无法批准自己的设计。',
    inputSchema: z.object({ specId: z.string().uuid(), revisionId: z.string().uuid() }).strict(),
    annotations: { destructiveHint: false, openWorldHint: false },
  }, safely(({ specId, revisionId }: { specId: string; revisionId: string }) =>
    workspace.submitDesignReviewBySpecId(specId, revisionId)));

  server.registerTool('start_run', {
    title: '开始 AI Run',
    description: 'AUTO 项目可直接启动 PLANNED/BLOCKED Task；服务端冻结当前 Specification/EngineeringAsset Revision。可携带外部 AI 实际观察到的多源码基线。',
    inputSchema: z.object({
      taskId: z.string().uuid(), baseCommit: z.string().trim().min(1).max(100).nullable(),
      sourceExecutions: z.array(sourceExecutionSchema).max(50).optional(),
    }).strict(),
  }, safely(({ taskId, baseCommit, sourceExecutions }: { taskId: string; baseCommit: string | null; sourceExecutions?: RunSourceExecution[] }) =>
    workspace.startAuthorizedRunByTaskId(taskId, { baseCommit, actorName: principal.name, sourceExecutions })));

  server.registerTool('update_run_phase', {
    title: '更新 Run 阶段',
    description: '按 PREPARING、IMPLEMENTING、TESTING、SUBMITTING 顺序推进 Run，禁止回退。',
    inputSchema: z.object({ runId: z.string().uuid(), phase: z.enum(['PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING']) }),
  }, safely(({ runId, phase }: { runId: string; phase: RunPhase }) => workspace.updateRunPhaseById(runId, phase)));

  server.registerTool('submit_run_result', {
    title: '提交 Run 结果',
    description: '提交 AI 报告的变更与验证结果。origin 固定为 AI_REPORTED；AUTO 仍可按 reportedStatus 流转，但页面不会显示为独立验证。',
    inputSchema: z.object({
      runId: z.string().uuid(),
      resultCommit: z.string().trim().min(1).max(100).nullable(),
      summary: z.string().trim().min(1).max(4000),
      changedFiles: z.array(changedFileSchema).max(500),
      verificationSummary: z.union([
        z.object({ reportedStatus: z.enum(['PASS', 'FAIL', 'NOT_RUN', 'SKIPPED', 'ERROR']), summary: z.string().trim().min(1).max(2000) }).strict(),
        z.object({ status: z.enum(['PASS', 'FAIL', 'NOT_RUN', 'SKIPPED', 'ERROR']), summary: z.string().trim().min(1).max(2000) }).strict(),
      ]),
      issues: z.array(z.string().trim().min(1).max(500)).max(100),
      sourceExecutions: z.array(sourceExecutionSchema).max(50).optional(),
    }).strict(),
  }, safely((input: {
    runId: string; resultCommit: string | null; summary: string; changedFiles: RunChangedFile[];
    verificationSummary: { reportedStatus: RunReportedStatus; summary: string } | { status: RunReportedStatus; summary: string };
    issues: string[]; sourceExecutions?: RunSourceExecution[];
  }) => workspace.submitRunById(input.runId, {
    ...input, verificationSummary: {
      reportedStatus: 'reportedStatus' in input.verificationSummary ? input.verificationSummary.reportedStatus : input.verificationSummary.status,
      summary: input.verificationSummary.summary, origin: 'AI_REPORTED',
    },
  })));

  server.registerTool('report_run_failure', {
    title: '报告 Run 失败或中断',
    description: '保留 FAILED/ABORTED Run 历史，不自动重新授权。',
    inputSchema: z.object({
      runId: z.string().uuid(), status: z.enum(['FAILED', 'ABORTED']),
      summary: z.string().trim().min(1).max(4000), issues: z.array(z.string().trim().min(1).max(500)).max(100),
    }),
  }, safely(({ runId, status, summary, issues }: {
    runId: string; status: 'FAILED' | 'ABORTED'; summary: string; issues: string[];
  }) => workspace.finishRunById(runId, status, { summary, issues })));

  server.registerTool('list_project_archive', {
    title: '读取项目档案目录',
    description: '读取已存档文档的目录与来源，不要求特定模板或研发阶段。文档正文用 get_project_document 按需读取。',
    inputSchema: z.object({ projectId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId }) => archive.listDocuments(projectId)));

  server.registerTool('get_project_document', {
    title: '读取存档原文与历史',
    description: '读取文档原始正文，或不可变的历史版本；存档是项目参考，不限制新的方案。',
    inputSchema: z.object({ projectId: z.string().uuid(), documentId: z.string().uuid(), history: z.boolean().optional() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId, documentId, history }) => history
    ? archive.getDocumentHistory(projectId, documentId) : archive.getDocument(projectId, documentId)));

  server.registerTool('archive_project_document', {
    title: '存档项目文档',
    description: '保存原格式 Markdown 或文本全文，不替外部 AI 生成文档、不强制模板。新文档省略 documentId；更新必须同时提供 documentId 和刚读取的 expectedRevisionId，保留历史，不读取 sourcePath 指向的文件。',
    inputSchema: z.object({
      projectId: z.string().uuid(), documentId: z.string().uuid().optional(), expectedRevisionId: z.string().uuid().optional(),
      title: z.string().trim().min(1).max(200), content: z.string().max(500_000),
      originalFilename: z.string().max(255).nullable().optional(), sourcePath: z.string().max(2000).nullable().optional(),
      contentType: z.enum(['text/markdown', 'text/plain']).optional(), changeSummary: z.string().max(2000).optional(),
    }).strict(),
  }, safely(({ projectId, documentId, expectedRevisionId, ...input }) => {
    if (Boolean(documentId) !== Boolean(expectedRevisionId)) throw new ApiError(400, 'INVALID_INPUT', '更新文档需要文档 ID 与当前版本 ID');
    return documentId ? archive.updateDocument(projectId, documentId, { ...input, expectedRevisionId: expectedRevisionId! }, principal)
      : archive.createDocument(projectId, input, principal);
  }));

  server.registerTool('record_project_work', {
    title: '记录计划、变化或结果',
    description: '记录可分享的工作摘要、原因和实际验证范围，不要求先创建任务或遵循流程；不能以此授权执行或确认旧任务。相同操作重试使用原 operationId，后续记录可沿用回执中的 workId。来源由服务端凭证确定，未验证内容请注明。',
    inputSchema: z.object({
      projectId: z.string().uuid(), operationId: z.string().min(1).max(128), workId: z.string().uuid().optional(),
      type: z.enum(['PLAN', 'PROGRESS', 'DESIGN', 'RESULT', 'NOTE']), title: z.string().trim().min(1).max(200),
      content: z.string().max(100_000), occurredAt: z.string().datetime({ offset: true }).optional(),
      documentRevisionIds: z.array(z.string().uuid()).max(100).optional(),
    }).strict(),
  }, safely(({ projectId, ...input }) => archive.appendEvent(projectId, input, principal)));

  server.registerTool('list_project_work', {
    title: '读取持续工作记录',
    description: '按游标读取项目已提交的工作记录。记录不等于外部 AI 的实时状态；未上报的过程不会自动出现。',
    inputSchema: z.object({ projectId: z.string().uuid(), workId: z.string().uuid().optional(), before: z.number().int().positive().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
    annotations: { readOnlyHint: true },
  }, safely(({ projectId, ...query }) => archive.listEvents(projectId, query)));

  return server;
}

export function registerMcpRoutes(app: FastifyInstance, workspace: WorkspaceService, auth: AuthService, archive: ArchiveService) {
  app.post('/mcp', async (request, reply) => {
    assertLocalMcpRequest(request);
    const principal = auth.requireAiToken(request, requiredScopes(request.body));
    const server = createForgeFlowMcpServer(workspace, principal, archive);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    reply.hijack();
    try {
      const socket = request.raw.socket as typeof request.raw.socket & { destroySoon?: () => void };
      if (typeof socket.destroySoon !== 'function') socket.destroySoon = () => socket.destroy();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.route({ method: ['GET', 'DELETE'], url: '/mcp', handler: async (request, reply) => {
    assertLocalMcpRequest(request);
    auth.requireAiToken(request);
    return reply.code(405).send({ error: { code: 'METHOD_NOT_ALLOWED', message: 'ForgeFlow MCP 使用无状态 Streamable HTTP POST' } });
  } });
}
