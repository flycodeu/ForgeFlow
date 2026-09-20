import { createHash, randomUUID } from 'node:crypto';
import type {
  AiRun, AuthorizationStatus, Capability, CapabilityDesignGuidance, CapabilityDetail, CapabilityStatus, DesignReview, DesignReviewStatus, EngineeringAsset, EngineeringAssetRevision, EngineeringBlueprintPlan, Feature, FeatureDesignGuidance, FeatureEngineeringBlueprint, FeatureStatus, Module, Project, ProjectDetail, ProjectLifecycle, RunActorType, RunChangedFile, RunDesignSnapshot, RunPhase, RunReportedStatus, RunSourceExecution, RunVerificationOrigin,
  ProjectSource, ProjectSourceLocation, ProjectSourceScope, RequestSourceAnalysisInput, ResolvedProjectSources, ResolveProjectSourcesInput,
  RunStatus, RunVerificationSummary, SourceAnalysis, SourceAnalysisTargetScope, SpecificationDetail, SpecificationRevision, SpecificationRevisionSummary,
  SpecificationSummary, Task, TaskAuthorization, TaskCategory, TaskStatus, TaskType, TraceLink, UpsertProjectSourceInput, WorkflowMode,
} from '@forgeflow/contracts';
import { ApiError } from '../../shared/api-error.js';
import { buildCapabilityDesignGuidance } from './capability-guidance.js';
import { buildFeatureDesignGuidance } from './design-guidance.js';
import { engineeringKindLabel, planBlueprint } from './engineering-blueprint.js';
import { WorkspaceRepository } from './workspace.repository.js';

function projectView(project: { id: string; projectKey: string; name: string; description: string; projectType: string; workflowMode: string; designProfile: string; createdAt: Date }): Project {
  return { ...project, workflowMode: project.workflowMode as WorkflowMode, createdAt: project.createdAt.toISOString() };
}

const DEFAULT_SOURCE_EXCLUDES = [
  'node_modules/**', 'dist/**', 'build/**', 'out/**', 'target/**', '.git/**', '.cache/**', 'coverage/**',
  'logs/**', '*.log', '.env', '.env.*', 'models/**', 'data/**', 'datasets/**', '*.pt', '*.onnx', '*.engine',
];

const DEFAULT_SOURCE_INCLUDES = [
  'README*', 'package.json', 'pnpm-workspace.yaml', 'pom.xml', 'build.gradle*', 'Cargo.toml', 'pyproject.toml',
  'requirements*.txt', 'project.godot', 'src/**', 'apps/**', 'packages/**', 'tests/**', 'test/**', 'migrations/**', 'config/**',
];

type StoredSourceLocation = ProjectSourceLocation & { normalizedLocalRoot: string };

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function engineeringContentHash(structuredData: Record<string, unknown> | null, contentMarkdown: string | null) {
  return createHash('sha256').update(`${stableJson(structuredData)}\n${contentMarkdown ?? ''}`, 'utf8').digest('hex');
}

const CANONICAL_LABELS: Record<string, string> = {
  method: 'method', '方法': 'method', path: 'path', '路径': 'path', route: 'route', '路由': 'route',
  protocol: 'protocol', '协议': 'protocol', version: 'version', '版本': 'version', type: 'type', '类型': 'type',
};

function canonicalConflicts(structuredData: Record<string, unknown> | null, contentMarkdown: string | null): string[] {
  if (!structuredData || !contentMarkdown) return [];
  const declared = new Map<string, string>();
  for (const line of contentMarkdown.split(/\r?\n/)) {
    const match = /^\s*(?:[-*]\s*)?([A-Za-z][\w.-]*|[\u4e00-\u9fff]+)\s*[:：]\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const key = CANONICAL_LABELS[match[1]!.toLowerCase()] ?? CANONICAL_LABELS[match[1]!];
    if (key) declared.set(key, match[2]!.replaceAll('`', '').trim());
  }
  const conflicts: string[] = [];
  for (const [key, markdownValue] of declared) {
    const structuredValue = structuredData[key];
    if (structuredValue === undefined || structuredValue === null || typeof structuredValue === 'object') continue;
    if (String(structuredValue).trim().toLowerCase() !== markdownValue.toLowerCase()) {
      conflicts.push(`${key}: structuredData=${String(structuredValue)}，Markdown=${markdownValue}`);
    }
  }
  return conflicts;
}

function normalizeLocalRoot(value: string) {
  const slashed = value.trim().replaceAll('\\', '/');
  const prefix = slashed.startsWith('//') ? '//' : slashed.startsWith('/') ? '/' : '';
  const normalized = `${prefix}${slashed.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  const withoutTrailing = normalized.length > 3 ? normalized.replace(/\/+$/, '') : normalized;
  return /^[a-z]:\//i.test(withoutTrailing) || withoutTrailing.startsWith('//') ? withoutTrailing.toLowerCase() : withoutTrailing;
}

function normalizeRemote(value: string) {
  return value.trim().replace(/\/$/, '').toLowerCase();
}

function normalizeAlias(value: string) {
  const alias = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(alias)) {
    throw new ApiError(400, 'INVALID_SOURCE_ALIAS', '源码别名须以字母开头，只能包含字母、数字、_ 或 -，且不超过 40 个字符');
  }
  return alias;
}

function safeRepoSubdir(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)
    || normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new ApiError(400, 'INVALID_REPO_SUBDIR', '仓库子目录必须是仓库内相对路径，不能包含 .. 或绝对路径');
  }
  return normalized;
}

function safeRunRelativePath(value: string) {
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/{2,}/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)
    || normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new ApiError(400, 'INVALID_RUN_FILE_PATH', 'Run 文件引用必须是 Source 内相对路径，不能包含 .. 或绝对路径');
  }
  return normalized;
}

function sourceScope(input?: Partial<ProjectSourceScope> | null): ProjectSourceScope {
  const validate = (items: unknown, label: string) => {
    if (!Array.isArray(items) || items.length > 100
      || items.some((item) => typeof item !== 'string' || !item.trim() || item.length > 500)) {
      throw new ApiError(400, 'INVALID_SOURCE_SCOPE', `${label} 必须是最多 100 项的非空字符串数组`);
    }
    return [...new Set(items.map((item) => (item as string).trim()))];
  };
  const include = input?.include === undefined ? DEFAULT_SOURCE_INCLUDES : validate(input.include, 'include');
  const customExclude = input?.exclude === undefined ? [] : validate(input.exclude, 'exclude');
  return { include, exclude: [...new Set([...DEFAULT_SOURCE_EXCLUDES, ...customExclude])] };
}

function projectSourceView(source: {
  id: string; projectId: string; alias: string; displayName: string; purpose: string; sourceKind: string; remoteUrl: string | null;
  repoSubdir: string | null; scopeJson: string | null; locationsJson: string; status: string; createdAt: Date; updatedAt: Date;
}): ProjectSource {
  const locations = parseJson<StoredSourceLocation[]>(source.locationsJson, []).map(({ normalizedLocalRoot: _normalized, ...location }) => location);
  return {
    id: source.id, projectId: source.projectId, alias: source.alias, displayName: source.displayName, purpose: source.purpose,
    sourceKind: source.sourceKind as ProjectSource['sourceKind'], remoteUrl: source.remoteUrl, repoSubdir: source.repoSubdir,
    scope: parseJson<ProjectSourceScope>(source.scopeJson, sourceScope()), locations, status: 'REGISTERED',
    createdAt: source.createdAt.toISOString(), updatedAt: source.updatedAt.toISOString(),
  };
}

function analysisPrompt(analysisId: string, environmentKey: string, sources: ProjectSource[], client: 'Codex' | 'Claude Code') {
  const sourceList = sources.map((source) => `- ${source.alias}: ${source.locations.find((item) => item.environmentKey === environmentKey)?.localRoot ?? '未登记位置'}`).join('\n');
  return `使用 ForgeFlow MCP 读取 analysisId ${analysisId}，确认当前环境 ${environmentKey} 能够访问哪些 Source。\n\n${sourceList}\n\n本轮只读取代码和工程结构，不要修改业务源码。先读取 README、依赖配置、构建配置、主要源码目录、启动入口、测试目录、迁移与配置样例；严格遵守每个 Source 的 include/exclude，不得越过登记范围。当前 ForgeFlow 尚未提供 submit_source_analysis，请完成本地只读检查后停下并保留结果，不要假装已经写回发现。客户端：${client}。`;
}

function sourceAnalysisView(analysis: {
  id: string; projectId: string; requestedSourceIdsJson: string; targetScopeJson: string; environmentKey: string; status: string;
  sourceSnapshotsJson: string | null; checkpointJson: string | null; summary: string | null; errorsJson: string | null;
  requestedAt: Date; startedAt: Date | null; completedAt: Date | null; updatedAt: Date;
}, allSources: ProjectSource[]): SourceAnalysis {
  const requestedSourceIds = parseJson<string[]>(analysis.requestedSourceIdsJson, []);
  const sources = requestedSourceIds.flatMap((id) => allSources.find((source) => source.id === id) ?? []);
  return {
    id: analysis.id, displayId: `AN-${analysis.id.slice(0, 8).toUpperCase()}`, projectId: analysis.projectId,
    requestedSourceIds, targetScope: parseJson<SourceAnalysisTargetScope>(analysis.targetScopeJson, {}),
    environmentKey: analysis.environmentKey, status: analysis.status as SourceAnalysis['status'],
    sourceSnapshots: parseJson<Record<string, unknown> | null>(analysis.sourceSnapshotsJson, null),
    checkpoint: parseJson<Record<string, unknown> | null>(analysis.checkpointJson, null), summary: analysis.summary,
    errors: parseJson<Record<string, unknown> | null>(analysis.errorsJson, null),
    requestedAt: analysis.requestedAt.toISOString(), startedAt: analysis.startedAt?.toISOString() ?? null,
    completedAt: analysis.completedAt?.toISOString() ?? null, updatedAt: analysis.updatedAt.toISOString(), sources,
    recommendedFlow: ['确认当前环境可访问的 Source', '先检查目录结构与工程入口', '按目标功能读取必要代码', '等待后续分析提交接口'],
    exclusions: DEFAULT_SOURCE_EXCLUDES,
    prompts: { codex: analysisPrompt(analysis.id, analysis.environmentKey, sources, 'Codex'), claude: analysisPrompt(analysis.id, analysis.environmentKey, sources, 'Claude Code') },
  };
}

function specificationView(
  specification: { id: string; projectId: string; featureId: string | null; capabilityId: string | null; kind: string; title: string; latestRevisionId: string | null; approvedRevisionId: string | null; createdAt: Date },
  latestRevisionNumber: number | null,
  approvedRevisionNumber: number | null,
): SpecificationSummary {
  return { ...specification, latestRevisionNumber, approvedRevisionNumber, createdAt: specification.createdAt.toISOString() };
}

function capabilityView(capability: {
  id: string; projectId: string; moduleId: string; featureId: string; code: string; name: string; summary: string; status: string;
  sortOrder: number; createdAt: Date; updatedAt: Date;
}): Capability {
  return { ...capability, status: capability.status as CapabilityStatus,
    createdAt: capability.createdAt.toISOString(), updatedAt: capability.updatedAt.toISOString() };
}

function engineeringAssetRevisionView(revision: {
  id: string; assetId: string; revisionNo: number; structuredData: string | null; contentMarkdown: string | null;
  contentHash: string; source: string; changeSummary: string; createdAt: Date;
}): EngineeringAssetRevision {
  return {
    ...revision,
    structuredData: parseJson<Record<string, unknown> | null>(revision.structuredData, null),
    createdAt: revision.createdAt.toISOString(),
  };
}

function engineeringAssetView(asset: {
  id: string; projectId: string; moduleId: string | null; featureId: string | null; capabilityId: string | null;
  kind: string; name: string; code: string | null; summary: string; structuredData: string | null;
  contentMarkdown: string | null; status: string; currentRevisionId: string | null; createdAt: Date; updatedAt: Date;
}, revision?: { revisionNo: number; structuredData: string | null; contentMarkdown: string | null }): EngineeringAsset {
  let structuredData: Record<string, unknown> | null = null;
  const structuredText = revision?.structuredData ?? asset.structuredData;
  const contentMarkdown = revision?.contentMarkdown ?? asset.contentMarkdown;
  if (structuredText) {
    try { structuredData = JSON.parse(structuredText) as Record<string, unknown>; } catch { structuredData = { invalidJson: true }; }
  }
  const conflicts = canonicalConflicts(structuredData, contentMarkdown);
  return { ...asset, structuredData, contentMarkdown, currentRevisionId: asset.currentRevisionId ?? '', currentRevisionNo: revision?.revisionNo ?? 0,
    canonicalStatus: conflicts.length ? 'CONFLICT' : 'CONSISTENT', canonicalConflicts: conflicts,
    createdAt: asset.createdAt.toISOString(), updatedAt: asset.updatedAt.toISOString() };
}

function traceLinkView(link: {
  id: string; projectId: string; sourceType: string; sourceId: string; targetType: string; targetId: string; relation: string; createdAt: Date;
}): TraceLink {
  return { ...link, createdAt: link.createdAt.toISOString() };
}

function moduleView(module: {
  id: string; projectId: string; code: string; name: string; description: string; sortOrder: number; createdAt: Date; updatedAt: Date;
}): Module {
  return { ...module, createdAt: module.createdAt.toISOString(), updatedAt: module.updatedAt.toISOString() };
}

function featureView(feature: {
  id: string; projectId: string; moduleId: string; code: string; name: string; summary: string; status: string;
  sortOrder: number; createdAt: Date; updatedAt: Date;
}): Feature {
  return {
    ...feature,
    status: feature.status as FeatureStatus,
    createdAt: feature.createdAt.toISOString(),
    updatedAt: feature.updatedAt.toISOString(),
  };
}

function taskView(task: {
  id: string; projectId: string; featureId: string; capabilityId: string | null; code: string; name: string; type: string; status: string;
  category: string; area: string; objective: string; designRevisionId: string | null; sortOrder: number; createdAt: Date; updatedAt: Date;
}): Task {
  return {
    ...task,
    type: task.type as TaskType,
    category: task.category as TaskCategory,
    status: task.status as TaskStatus,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function reviewView(review: {
  id: string; projectId: string; specId: string; revisionId: string; status: string;
  submittedAt: Date; decidedAt: Date | null; decisionComment: string | null; createdAt: Date;
}): DesignReview {
  return {
    ...review,
    status: review.status as DesignReviewStatus,
    submittedAt: review.submittedAt.toISOString(),
    decidedAt: review.decidedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
  };
}

function authorizationView(authorization: {
  id: string; taskId: string; projectId: string; featureId: string; status: string;
  authorizedAt: Date; revokedAt: Date | null; createdAt: Date;
}): TaskAuthorization {
  return {
    ...authorization,
    status: authorization.status as AuthorizationStatus,
    authorizedAt: authorization.authorizedAt.toISOString(),
    revokedAt: authorization.revokedAt?.toISOString() ?? null,
    createdAt: authorization.createdAt.toISOString(),
  };
}

function runView(run: {
  id: string; projectId: string; featureId: string; taskId: string; authorizationId: string | null;
  actorType: string; actorName: string; status: string; phase: string; baseCommit: string | null;
  resultCommit: string | null; summary: string; changedFiles: string; verificationSummary: string | null;
  designSnapshotJson: string; sourceExecutionsJson: string;
  issues: string; startedAt: Date; submittedAt: Date | null; finishedAt: Date | null; createdAt: Date; updatedAt: Date;
}, freshness: { status: AiRun['designSnapshotStatus']; warnings: string[] } = { status: 'UNKNOWN', warnings: [] }): AiRun {
  const storedVerification = parseJson<Partial<RunVerificationSummary> & { status?: string } | null>(run.verificationSummary, null);
  const reportedStatus = (storedVerification?.reportedStatus ?? storedVerification?.status ?? 'NOT_RUN').toUpperCase() as RunReportedStatus;
  const verificationSummary = storedVerification ? {
    status: reportedStatus,
    reportedStatus,
    evidenceStatus: storedVerification.evidenceStatus ?? 'UNVERIFIED',
    origin: storedVerification.origin ?? 'AI_REPORTED',
    summary: storedVerification.summary ?? '',
  } satisfies RunVerificationSummary : null;
  return {
    ...run,
    actorType: run.actorType as RunActorType,
    status: run.status as RunStatus,
    phase: run.phase as RunPhase,
    changedFiles: parseJson<RunChangedFile[]>(run.changedFiles, []),
    verificationSummary,
    designSnapshot: parseJson<RunDesignSnapshot>(run.designSnapshotJson, { specifications: [], engineeringAssets: [] }),
    sourceExecutions: parseJson<RunSourceExecution[]>(run.sourceExecutionsJson, []),
    designSnapshotStatus: freshness.status,
    designSnapshotWarnings: freshness.warnings,
    issues: JSON.parse(run.issues) as string[],
    startedAt: run.startedAt.toISOString(),
    submittedAt: run.submittedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function revisionView(revision: {
  id: string; specId: string; revisionNo: number; markdown: string; contentHash: string;
  source: string; changeSummary: string; createdAt: Date;
}): SpecificationRevision {
  return {
    id: revision.id,
    specId: revision.specId,
    revisionNo: revision.revisionNo,
    content: revision.markdown,
    contentHash: revision.contentHash,
    source: revision.source,
    changeSummary: revision.changeSummary,
    createdAt: revision.createdAt.toISOString(),
  };
}

function revisionSummaryView(revision: {
  id: string; specId: string; revisionNo: number; contentHash: string;
  source: string; changeSummary: string; createdAt: Date;
}): SpecificationRevisionSummary {
  return { ...revision, createdAt: revision.createdAt.toISOString() };
}

function isUniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export class WorkspaceService {
  constructor(private readonly repository: WorkspaceRepository) {}

  private assetView(asset: NonNullable<ReturnType<WorkspaceRepository['findEngineeringAsset']>>): EngineeringAsset {
    const revision = asset.currentRevisionId
      ? this.repository.findEngineeringAssetRevision(asset.id, asset.currentRevisionId)
      : undefined;
    return engineeringAssetView(asset, revision);
  }

  private buildDesignSnapshot(projectId: string, featureId: string, task?: NonNullable<ReturnType<WorkspaceRepository['findTaskById']>>): RunDesignSnapshot {
    const project = this.requireProject(projectId);
    const specifications = this.repository.listSpecifications(projectId).map(({ specification }) => specification)
      .filter((specification) => specification.featureId === null || (specification.featureId === featureId
        && (specification.capabilityId === null || specification.capabilityId === task?.capabilityId)))
      .flatMap((specification) => {
        const taskRevision = task?.designRevisionId
          ? this.repository.findRevision(specification.id, task.designRevisionId)
          : undefined;
        const revisionId = taskRevision?.id
          ?? (project.workflowMode === 'CONTROLLED' ? specification.approvedRevisionId : specification.latestRevisionId);
        if (!revisionId) return [];
        const revision = this.repository.findRevision(specification.id, revisionId);
        return revision ? [{ specId: specification.id, revisionId: revision.id, revisionNo: revision.revisionNo }] : [];
      });
    const engineeringAssets = this.repository.listEngineeringAssets(projectId, featureId).flatMap((asset) => {
      if (!asset.currentRevisionId) return [];
      const revision = this.repository.findEngineeringAssetRevision(asset.id, asset.currentRevisionId);
      return revision ? [{ assetId: asset.id, revisionId: revision.id, revisionNo: revision.revisionNo }] : [];
    });
    return { specifications, engineeringAssets };
  }

  private runFreshness(run: NonNullable<ReturnType<WorkspaceRepository['findRunById']>>) {
    const snapshot = parseJson<RunDesignSnapshot>(run.designSnapshotJson, { specifications: [], engineeringAssets: [] });
    if (!snapshot.specifications.length && !snapshot.engineeringAssets.length) {
      return { status: 'UNKNOWN' as const, warnings: ['历史 Run 未冻结设计快照'] };
    }
    const task = this.repository.findTaskById(run.taskId);
    const current = this.buildDesignSnapshot(run.projectId, run.featureId, task);
    const warnings: string[] = [];
    const snapshotSpecs = new Map(snapshot.specifications.map((item) => [item.specId, item.revisionId]));
    const currentSpecs = new Map(current.specifications.map((item) => [item.specId, item.revisionId]));
    const snapshotAssets = new Map(snapshot.engineeringAssets.map((item) => [item.assetId, item.revisionId]));
    const currentAssets = new Map(current.engineeringAssets.map((item) => [item.assetId, item.revisionId]));
    if (stableJson([...snapshotSpecs]) !== stableJson([...currentSpecs])) warnings.push('Specification 版本已变化');
    if (stableJson([...snapshotAssets]) !== stableJson([...currentAssets])) warnings.push('EngineeringAsset 版本已变化');
    return { status: warnings.length ? 'STALE' as const : 'CURRENT' as const, warnings };
  }

  private runView(run: NonNullable<ReturnType<WorkspaceRepository['findRunById']>>): AiRun {
    return runView(run, this.runFreshness(run));
  }

  createProject(input: { projectKey: string; name: string; description?: string; projectType?: string; workflowMode?: WorkflowMode; designProfile?: string }): Project {
    const project = { id: randomUUID(), projectKey: input.projectKey, name: input.name,
      description: input.description ?? '', projectType: input.projectType?.trim() || 'GENERAL',
      workflowMode: input.workflowMode ?? 'AUTO', designProfile: input.designProfile?.trim().toLowerCase() || 'generic', createdAt: new Date() };
    try {
      this.repository.insertProject(project);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ApiError(409, 'PROJECT_KEY_EXISTS', '项目标识已存在');
      }
      throw error;
    }
    return projectView(project);
  }

  createProjectWithSources(input: {
    projectKey: string; name: string; description?: string; projectType?: string; workflowMode?: WorkflowMode; designProfile?: string;
    sources?: Array<Omit<UpsertProjectSourceInput, 'projectId' | 'sourceId' | 'expectedUpdatedAt'>>;
  }): Project {
    return this.repository.transaction(() => {
      const project = this.createProject(input);
      for (const source of input.sources ?? []) this.upsertProjectSource({ ...source, projectId: project.id });
      return project;
    });
  }

  createProjectDraft(input: { code: string; name: string; description: string; projectType?: string; workflowMode?: WorkflowMode; designProfile?: string }): Project {
    return this.createProject({ projectKey: input.code, name: input.name, description: input.description,
      projectType: input.projectType, workflowMode: input.workflowMode, designProfile: input.designProfile });
  }

  listProjects(): Project[] {
    return this.repository.listProjects().map(projectView);
  }

  listProjectSources(projectId: string): ProjectSource[] {
    this.requireProject(projectId);
    return this.repository.listProjectSources(projectId).map(projectSourceView);
  }

  listSourceAnalyses(projectId: string): SourceAnalysis[] {
    this.requireProject(projectId);
    const sources = this.listProjectSources(projectId);
    return this.repository.listSourceAnalyses(projectId).map((analysis) => sourceAnalysisView(analysis, sources));
  }

  resolveProjectAndSources(input: ResolveProjectSourcesInput): ResolvedProjectSources {
    const directId = input.projectId?.trim();
    if (directId) {
      const project = this.requireProject(directId);
      return { project: projectView(project), sources: this.listProjectSources(project.id) };
    }
    const directCode = input.projectCode?.trim().toUpperCase();
    if (directCode) {
      const project = this.repository.listProjects().find((item) => item.projectKey.toUpperCase() === directCode);
      if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', '未找到匹配的项目');
      return { project: projectView(project), sources: this.listProjectSources(project.id) };
    }

    if (!input.cwd?.trim() && !input.remoteUrl?.trim() && !input.projectName?.trim()) {
      throw new ApiError(400, 'PROJECT_SELECTOR_REQUIRED', '请提供 projectId、projectCode 或至少一个辅助搜索条件');
    }
    let candidates = this.repository.listProjects();
    if (input.projectName?.trim()) {
      const name = input.projectName.trim().toLocaleLowerCase();
      candidates = candidates.filter((project) => project.name.toLocaleLowerCase() === name);
    }
    if (input.cwd?.trim()) {
      const cwd = normalizeLocalRoot(input.cwd);
      const projectIds = new Set(this.repository.listAllProjectSources().filter((source) => {
        const locations = parseJson<StoredSourceLocation[]>(source.locationsJson, []);
        return locations.some((location) => cwd === location.normalizedLocalRoot || cwd.startsWith(`${location.normalizedLocalRoot}/`));
      }).map((source) => source.projectId));
      candidates = candidates.filter((project) => projectIds.has(project.id));
    }
    if (input.remoteUrl?.trim()) {
      const remote = normalizeRemote(input.remoteUrl);
      const projectIds = new Set(this.repository.listAllProjectSources()
        .filter((source) => source.remoteUrl && normalizeRemote(source.remoteUrl) === remote).map((source) => source.projectId));
      candidates = candidates.filter((project) => projectIds.has(project.id));
    }
    if (candidates.length === 0) throw new ApiError(404, 'PROJECT_NOT_FOUND', '未找到匹配的项目');
    if (candidates.length > 1) {
      throw new ApiError(409, 'AMBIGUOUS_PROJECT', '项目匹配不唯一，请改用 projectId 或 projectCode', {
        candidates: candidates.map((project) => ({ projectId: project.id, projectCode: project.projectKey, name: project.name })),
      });
    }
    const project = candidates[0]!;
    return { project: projectView(project), sources: this.listProjectSources(project.id) };
  }

  upsertProjectSource(input: UpsertProjectSourceInput): ProjectSource {
    this.requireProject(input.projectId);
    const alias = normalizeAlias(input.alias);
    const displayName = input.displayName.trim();
    const purpose = input.purpose.trim();
    const environmentKey = input.environmentKey.trim().toLowerCase();
    const localRoot = input.localRoot.trim();
    const idempotencyKey = input.idempotencyKey.trim();
    if (!displayName || displayName.length > 120) throw new ApiError(400, 'INVALID_INPUT', '源码显示名称不能为空且不能超过 120 个字符');
    if (purpose.length > 500) throw new ApiError(400, 'INVALID_INPUT', '源码用途不能超过 500 个字符');
    if (!['GIT', 'DIRECTORY'].includes(input.sourceKind)) throw new ApiError(400, 'INVALID_SOURCE_KIND', 'sourceKind 首版只支持 GIT 或 DIRECTORY');
    if (!environmentKey || environmentKey.length > 80) throw new ApiError(400, 'INVALID_ENVIRONMENT_KEY', '环境标识不能为空且不能超过 80 个字符');
    if (!localRoot || localRoot.length > 1024) throw new ApiError(400, 'INVALID_LOCAL_ROOT', '本地源码根目录不能为空且不能超过 1024 个字符');
    if (!idempotencyKey || idempotencyKey.length > 120) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'idempotencyKey 不能为空且不能超过 120 个字符');
    const remoteUrl = input.remoteUrl?.trim() || null;
    if (remoteUrl && remoteUrl.length > 2048) throw new ApiError(400, 'INVALID_INPUT', 'Git Remote 不能超过 2048 个字符');
    const repoSubdir = safeRepoSubdir(input.repoSubdir);
    const scope = sourceScope(input.scope);

    const idempotent = this.repository.findProjectSourceByIdempotencyKey(input.projectId, idempotencyKey);
    if (idempotent && (!input.sourceId || idempotent.id === input.sourceId)) return projectSourceView(idempotent);
    if (idempotent) throw new ApiError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'idempotencyKey 已用于另一个 Source');

    const now = new Date();
    if (!input.sourceId) {
      const location: StoredSourceLocation = { environmentKey, localRoot, normalizedLocalRoot: normalizeLocalRoot(localRoot),
        accessibility: 'UNKNOWN', analysisStatus: 'NOT_REQUESTED', lastCheckedAt: null };
      const source = { id: randomUUID(), projectId: input.projectId, alias, displayName, purpose, sourceKind: input.sourceKind,
        remoteUrl, repoSubdir, scopeJson: JSON.stringify(scope), locationsJson: JSON.stringify([location]), status: 'REGISTERED',
        lastIdempotencyKey: idempotencyKey, createdAt: now, updatedAt: now };
      try { this.repository.insertProjectSource(source); }
      catch (error) {
        if (isUniqueConstraint(error)) throw new ApiError(409, 'SOURCE_ALIAS_EXISTS', '同一项目中的源码别名不能重复');
        throw error;
      }
      return projectSourceView(source);
    }

    const current = this.repository.findProjectSource(input.projectId, input.sourceId);
    if (!current) throw new ApiError(404, 'PROJECT_SOURCE_NOT_FOUND', '源码位置不存在');
    if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new ApiError(409, 'SOURCE_UPDATE_CONFLICT', '源码位置已被更新，请刷新后重试', { currentUpdatedAt: current.updatedAt.toISOString() });
    }
    const locations = parseJson<StoredSourceLocation[]>(current.locationsJson, []);
    const existingIndex = locations.findIndex((location) => location.environmentKey.toLowerCase() === environmentKey);
    const normalizedLocalRoot = normalizeLocalRoot(localRoot);
    const existing = existingIndex >= 0 ? locations[existingIndex]! : null;
    const location: StoredSourceLocation = {
      environmentKey, localRoot, normalizedLocalRoot,
      accessibility: existing?.normalizedLocalRoot === normalizedLocalRoot ? existing.accessibility : 'UNKNOWN',
      analysisStatus: existing?.normalizedLocalRoot === normalizedLocalRoot ? existing.analysisStatus : 'NOT_REQUESTED',
      lastCheckedAt: existing?.normalizedLocalRoot === normalizedLocalRoot ? existing.lastCheckedAt : null,
    };
    if (existingIndex >= 0) locations.splice(existingIndex, 1, location); else locations.push(location);
    const values = { alias, displayName, purpose, sourceKind: input.sourceKind, remoteUrl, repoSubdir,
      scopeJson: JSON.stringify(scope), locationsJson: JSON.stringify(locations), status: 'REGISTERED',
      lastIdempotencyKey: idempotencyKey, updatedAt: now };
    try { this.repository.updateProjectSource(input.projectId, current.id, values); }
    catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'SOURCE_ALIAS_EXISTS', '同一项目中的源码别名不能重复');
      throw error;
    }
    return projectSourceView({ ...current, ...values });
  }

  requestSourceAnalysis(input: RequestSourceAnalysisInput): SourceAnalysis {
    this.requireProject(input.projectId);
    const environmentKey = input.environmentKey.trim().toLowerCase();
    if (!environmentKey || environmentKey.length > 80) throw new ApiError(400, 'INVALID_ENVIRONMENT_KEY', '环境标识不能为空且不能超过 80 个字符');
    const sourceIds = [...new Set(input.sourceIds)];
    if (!sourceIds.length || sourceIds.length > 100) throw new ApiError(400, 'INVALID_SOURCE_SELECTION', '至少选择一个且最多选择 100 个 Source');
    const rawSources = sourceIds.map((sourceId) => {
      const source = this.repository.findProjectSource(input.projectId, sourceId);
      if (!source) throw new ApiError(400, 'SOURCE_PROJECT_MISMATCH', 'Source 不存在或不属于当前项目', { sourceId });
      return source;
    });
    const missingSourceIds = rawSources.filter((source) => !parseJson<StoredSourceLocation[]>(source.locationsJson, [])
      .some((location) => location.environmentKey.toLowerCase() === environmentKey)).map((source) => source.id);
    if (missingSourceIds.length) {
      throw new ApiError(409, 'WAITING_LOCATION', '部分 Source 在目标环境中没有登记位置', { environmentKey, missingSourceIds });
    }
    let featureId = input.featureId ?? undefined;
    if (featureId) this.requireFeature(input.projectId, featureId);
    if (input.capabilityId) {
      const capability = this.repository.findCapability(input.projectId, input.capabilityId);
      if (!capability) throw new ApiError(400, 'CAPABILITY_PROJECT_MISMATCH', 'Capability 不存在或不属于当前项目');
      if (featureId && capability.featureId !== featureId) throw new ApiError(400, 'CAPABILITY_FEATURE_MISMATCH', 'Capability 不属于指定 Feature');
      featureId ??= capability.featureId;
    }
    const targetScope: SourceAnalysisTargetScope = {
      ...(featureId ? { featureId } : {}), ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
      analysisScope: input.analysisScope ?? null, prompt: input.prompt?.trim() || null,
    };
    const now = new Date();
    const analysis = { id: randomUUID(), projectId: input.projectId, requestedSourceIdsJson: JSON.stringify(sourceIds),
      targetScopeJson: JSON.stringify(targetScope), environmentKey, status: 'WAITING_AI', sourceSnapshotsJson: null,
      checkpointJson: null, summary: null, errorsJson: null, requestedAt: now, startedAt: null, completedAt: null, updatedAt: now };
    this.repository.transaction(() => {
      this.repository.insertSourceAnalysis(analysis);
      for (const source of rawSources) {
        const locations = parseJson<StoredSourceLocation[]>(source.locationsJson, []).map((location) =>
          location.environmentKey.toLowerCase() === environmentKey ? { ...location, analysisStatus: 'WAITING_AI' as const } : location);
        this.repository.updateProjectSource(input.projectId, source.id, { locationsJson: JSON.stringify(locations), updatedAt: now });
      }
    });
    return sourceAnalysisView(analysis, this.listProjectSources(input.projectId));
  }

  listProjectsForMcp() {
    return this.repository.listProjects().map((project) => {
      const detail = this.getProject(project.id);
      const timestamps = [project.createdAt.getTime(), ...detail.modules.map((item) => Date.parse(item.updatedAt)),
        ...detail.features.map((item) => Date.parse(item.updatedAt)), ...detail.tasks.map((item) => Date.parse(item.updatedAt)),
        ...detail.runs.map((item) => Date.parse(item.updatedAt)), ...detail.specifications.map((item) => Date.parse(item.createdAt)),
        ...detail.specifications.map((item) => this.getSpecification(project.id, item.id).latestRevision)
          .filter((item) => item !== null).map((item) => Date.parse(item.createdAt))];
      return {
        projectId: project.id,
        code: project.projectKey,
        name: project.name,
        description: project.description,
        workflowMode: project.workflowMode,
        designProfile: project.designProfile,
        updatedAt: new Date(Math.max(...timestamps)).toISOString(),
      };
    });
  }

  getProjectContext(projectId: string) {
    const detail = this.getProject(projectId);
    const currentDocuments = Object.fromEntries(['background', 'research', 'requirements', 'architecture', 'technology'].map((kind) => {
      const specification = detail.specifications.find((item) => item.featureId === null && item.kind === kind);
      return [kind, specification ? this.getSpecification(projectId, specification.id) : null];
    }));
    return {
      project: detail.project,
      currentDocuments,
      modules: detail.modules,
      features: detail.features,
      capabilities: detail.capabilities,
      unfinishedTasks: detail.tasks.filter((task) => task.status !== 'CONFIRMED').map((task) => ({
        id: task.id, featureId: task.featureId, code: task.code, name: task.name, type: task.type,
        category: task.category, area: task.area,
        status: task.status, objective: task.objective, updatedAt: task.updatedAt,
      })),
    };
  }

  getProjectPlanningContext(projectId: string) {
    const detail = this.getProject(projectId);
    const projectSpecifications = detail.specifications.filter((item) => item.featureId === null).map((specification) => ({
      type: specification.kind,
      specification: this.getSpecification(projectId, specification.id),
    }));
    const featureDesigns = detail.features.map((feature) => {
      const specification = detail.specifications.find((item) => item.featureId === feature.id && item.capabilityId === null);
      const design = specification ? this.getSpecification(projectId, specification.id) : null;
      return {
        featureId: feature.id,
        moduleId: feature.moduleId,
        code: feature.code,
        name: feature.name,
        status: feature.status,
        summary: feature.summary,
        currentDesign: design ? {
          specificationId: design.specification.id,
          title: design.specification.title,
          latestRevisionId: design.latestRevision?.id ?? null,
          latestRevisionNo: design.latestRevision?.revisionNo ?? null,
          approvedRevisionId: design.approvedRevision?.id ?? null,
          approvedRevisionNo: design.approvedRevision?.revisionNo ?? null,
          reviewStatus: design.reviews.find((review) => review.revisionId === design.latestRevision?.id)?.status ?? null,
          changeSummary: design.latestRevision?.changeSummary ?? null,
          contentSummary: design.latestRevision?.content.slice(0, 1200) ?? null,
        } : null,
      };
    });
    return {
      project: detail.project,
      projectSpecifications,
      modules: detail.modules,
      features: featureDesigns,
      capabilities: detail.capabilities,
      tasks: detail.tasks.map((task) => ({
        id: task.id, featureId: task.featureId, code: task.code, name: task.name, type: task.type,
        category: task.category, area: task.area,
        status: task.status, objective: task.objective, sortOrder: task.sortOrder,
      })),
      planningProcess: '按 项目背景 → Research → Requirement → Architecture → Technology → Feature Design → Task Plan 顺序读取；阶段可标记 N/A，但必须在正文记录原因。',
      planningBoundary: detail.project.workflowMode === 'AUTO'
        ? 'AUTO：AI 可创建 Revision、Capability、Task 并直接执行；PASS 自动完成。不得假设存在数据库、HTTP API、UI、Frontend 或 Backend。'
        : 'CONTROLLED：保留 Design Review、Approved Baseline、Authorization 和人工确认。不得假设存在数据库、HTTP API、UI、Frontend 或 Backend。',
    };
  }

  getFeatureContext(featureId: string) {
    const rawFeature = this.repository.findFeatureById(featureId);
    if (!rawFeature) throw new ApiError(404, 'FEATURE_NOT_FOUND', '功能不存在');
    const feature = featureView(rawFeature);
    const module = moduleView(this.requireModule(feature.projectId, feature.moduleId));
    const specification = this.repository.findFeatureSpecification(feature.projectId, featureId);
    const design = specification ? this.getSpecification(feature.projectId, specification.id) : null;
    const tasks = this.repository.listTasks(feature.projectId, featureId).map(taskView);
    const recentRuns = this.repository.listRuns(feature.projectId).filter((run) => run.featureId === featureId)
      .slice(0, 10).map((run) => this.runView(run)).map((run) => ({
        id: run.id, taskId: run.taskId, actorType: run.actorType, actorName: run.actorName,
        status: run.status, phase: run.phase, summary: run.summary, startedAt: run.startedAt, finishedAt: run.finishedAt,
      }));
    const latestReview = design?.reviews.find((review) => review.revisionId === design.latestRevision?.id) ?? null;
    return {
      feature,
      module,
      currentDesign: design,
      latestDesignRevision: design?.latestRevision ?? null,
      approvedDesignRevision: design?.approvedRevision ?? null,
      reviewStatus: latestReview?.status ?? (design?.latestRevision?.id === design?.approvedRevision?.id ? 'APPROVED' : null),
      tasks,
      capabilities: this.repository.listCapabilities(feature.projectId, featureId).map(capabilityView),
      engineeringBlueprint: this.getFeatureEngineeringBlueprint(feature.projectId, featureId),
      recentRuns,
      designGuidance: this.getFeatureDesignGuidance(featureId),
    };
  }

  getFeatureDesignGuidance(featureId: string): FeatureDesignGuidance {
    const rawFeature = this.repository.findFeatureById(featureId);
    if (!rawFeature) throw new ApiError(404, 'FEATURE_NOT_FOUND', '功能不存在');
    const project = this.requireProject(rawFeature.projectId);
    const documents = this.repository.listSpecifications(rawFeature.projectId)
      .filter(({ specification }) => specification.featureId === null
        && ['background', 'research', 'requirements', 'architecture', 'technology'].includes(specification.kind))
      .map(({ specification, latestRevisionNumber }) => ({
        kind: specification.kind,
        revisionNo: latestRevisionNumber,
        content: specification.latestRevisionId
          ? this.repository.findRevision(specification.id, specification.latestRevisionId)?.markdown ?? ''
          : '',
      }));
    return buildFeatureDesignGuidance({
      projectType: project.projectType,
      projectName: project.name,
      projectDescription: project.description,
      featureName: rawFeature.name,
      featureSummary: rawFeature.summary,
      documents,
    });
  }

  getCurrentAuthorizedTask(featureId: string) {
    const context = this.getFeatureContext(featureId);
    const project = this.requireProject(context.feature.projectId);
    if (project.workflowMode === 'AUTO') {
      const task = context.tasks.find((item) => ['PLANNED', 'BLOCKED'].includes(item.status));
      if (!task) throw new ApiError(409, 'EXECUTABLE_TASK_NOT_FOUND', '该 Feature 当前没有可直接执行的 Task');
      const revisionId = this.resolveImplementationRevisionId(task);
      const specification = task.capabilityId
        ? this.repository.findCapabilitySpecification(task.projectId, task.capabilityId)
        : this.repository.findFeatureSpecification(task.projectId, task.featureId);
      const currentDesignRevision = specification && revisionId ? this.repository.findRevision(specification.id, revisionId) : null;
      return { task, feature: context.feature, currentDesignRevision: currentDesignRevision ? revisionView(currentDesignRevision) : null,
        authorization: null, objective: task.objective, taskType: task.type, status: task.status,
        executionBoundary: 'AUTO 模式：AI 可直接启动此 Task；PASS 自动完成，FAIL 写回 BLOCKED。' };
    }
    const candidates = context.tasks.map((task) => ({
      task,
      authorization: this.repository.findActiveAuthorization(task.projectId, task.id),
    })).filter((item) => item.authorization);
    if (candidates.length === 0) {
      throw new ApiError(409, 'AUTHORIZED_TASK_NOT_FOUND', '该 Feature 当前没有 ACTIVE Authorization');
    }
    if (candidates.length > 1) {
      throw new ApiError(409, 'AUTHORIZED_TASK_AMBIGUOUS', '该 Feature 存在多个已授权 Task，无法唯一确定当前任务');
    }
    const current = candidates[0]!;
    if (current.task.status !== 'AUTHORIZED') {
      throw new ApiError(409, 'TASK_NOT_AUTHORIZED', 'ACTIVE Authorization 对应的 Task 状态不允许执行');
    }
    return {
      task: current.task,
      feature: context.feature,
      currentDesignRevision: context.currentDesign?.approvedRevision ?? null,
      authorization: authorizationView(current.authorization!),
      objective: current.task.objective,
      taskType: current.task.type,
      status: current.task.status,
      executionBoundary: 'AI 可以执行当前 Task，但不能自行进入后续 Task。',
    };
  }

  startAuthorizedRunByTaskId(taskId: string, input: { baseCommit: string | null; actorName: string; sourceExecutions?: RunSourceExecution[] }): AiRun {
    const task = this.repository.findTaskById(taskId);
    if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在');
    const project = this.requireProject(task.projectId);
    if (project.workflowMode === 'AUTO') {
      return this.startRun(task.projectId, task.featureId, taskId, {
        authorizationId: null, actorType: 'AI_TOKEN', actorName: input.actorName, baseCommit: input.baseCommit,
        sourceExecutions: input.sourceExecutions,
      });
    }
    const authorization = this.repository.findActiveAuthorization(task.projectId, taskId);
    if (!authorization) throw new ApiError(409, 'AUTHORIZATION_NOT_ACTIVE', 'Task 当前没有 ACTIVE Authorization');
    return this.startRun(task.projectId, task.featureId, taskId, {
      authorizationId: authorization.id, actorType: 'AI_TOKEN', actorName: input.actorName, baseCommit: input.baseCommit,
      sourceExecutions: input.sourceExecutions,
    });
  }

  updateRunPhaseById(runId: string, phase: RunPhase): AiRun {
    const run = this.repository.findRunById(runId);
    if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', 'Run 不存在');
    return this.updateRunPhase(run.projectId, runId, phase);
  }

  submitRunById(runId: string, input: {
    summary: string; resultCommit: string | null; changedFiles: RunChangedFile[];
    verificationSummary: { reportedStatus: RunReportedStatus; summary: string; origin: RunVerificationOrigin };
    issues: string[]; sourceExecutions?: RunSourceExecution[];
  }): AiRun {
    const run = this.repository.findRunById(runId);
    if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', 'Run 不存在');
    return this.submitRun(run.projectId, runId, input);
  }

  finishRunById(runId: string, status: 'FAILED' | 'ABORTED', input: { summary: string; issues: string[] }): AiRun {
    const run = this.repository.findRunById(runId);
    if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', 'Run 不存在');
    return this.finishRun(run.projectId, runId, status, input);
  }

  getProject(projectId: string): ProjectDetail {
    const project = this.repository.findProject(projectId);
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在');
    const sources = this.repository.listProjectSources(projectId).map(projectSourceView);
    return {
      project: projectView(project),
      sources,
      sourceAnalyses: this.repository.listSourceAnalyses(projectId).map((analysis) => sourceAnalysisView(analysis, sources)),
      modules: this.repository.listModules(projectId).map(moduleView),
      features: this.repository.listFeatures(projectId).map(featureView),
      capabilities: this.repository.listCapabilities(projectId).map(capabilityView),
      engineeringAssets: this.repository.listEngineeringAssets(projectId).map((asset) => this.assetView(asset)),
      traceLinks: this.repository.listTraceLinks(projectId).map(traceLinkView),
      tasks: this.repository.listTasks(projectId).map(taskView),
      authorizations: this.repository.listAuthorizations(projectId).map(authorizationView),
      runs: this.repository.listRuns(projectId).map((run) => this.runView(run)),
      specifications: this.repository.listSpecifications(projectId)
        .map(({ specification, latestRevisionNumber }) => specificationView(
          specification,
          latestRevisionNumber,
          specification.approvedRevisionId
            ? this.repository.findRevision(specification.id, specification.approvedRevisionId)?.revisionNo ?? null
            : null,
        )),
      reviews: this.repository.listReviews(projectId).map(reviewView),
    };
  }

  getProjectLifecycle(projectId: string): ProjectLifecycle {
    const detail = this.getProject(projectId);
    const documentStage = (kind: 'research' | 'requirements' | 'architecture' | 'technology', target: ProjectLifecycle['stages'][number]['target']) => {
      const specification = detail.specifications.find((item) => item.featureId === null && item.capabilityId === null && item.kind === kind);
      const hasIssue = specification && detail.reviews.some((review) => review.specId === specification.id && review.status === 'CHANGES_REQUESTED');
      return { status: hasIssue ? 'ISSUE' as const : specification?.latestRevisionId ? 'FORMED' as const : 'NOT_STARTED' as const,
        summary: specification?.latestRevisionNumber ? `REV ${specification.latestRevisionNumber}` : '未开始', target };
    };
    const total = detail.capabilities.length;
    const designed = detail.capabilities.filter((item) => item.status !== 'DRAFT').length;
    const done = detail.capabilities.filter((item) => item.status === 'DONE').length;
    const blocked = detail.capabilities.filter((item) => item.status === 'BLOCKED').length;
    const passedCapabilityIds = new Set(detail.tasks.filter((task) => task.capabilityId).filter((task) =>
      detail.runs.some((run) => run.taskId === task.id && run.verificationSummary?.status.toUpperCase() === 'PASS'))
      .map((task) => task.capabilityId!));
    const engineeringCount = detail.engineeringAssets.length;
    const research = documentStage('research', 'research');
    const requirements = documentStage('requirements', 'requirements');
    const architecture = detail.specifications.find((item) => item.featureId === null && item.capabilityId === null && item.kind === 'architecture');
    const technology = detail.specifications.find((item) => item.featureId === null && item.capabilityId === null && item.kind === 'technology');
    const stages: ProjectLifecycle['stages'] = [
      { ...research, key: 'discovery', label: '发现 / 调研' },
      { ...requirements, key: 'requirements', label: '需求定义' },
      { key: 'decisions', label: '架构与技术决策', status: architecture?.latestRevisionId && technology?.latestRevisionId ? 'FORMED' : architecture?.latestRevisionId || technology?.latestRevisionId ? 'IN_PROGRESS' : 'NOT_STARTED', summary: `${architecture?.latestRevisionId ? '架构 ✓' : '架构 —'} · ${technology?.latestRevisionId ? '技术 ✓' : '技术 —'}`, target: 'architecture' },
      { key: 'breakdown', label: '功能分解', status: blocked ? 'ISSUE' : total === 0 ? 'NOT_STARTED' : designed ? 'FORMED' : 'IN_PROGRESS', summary: `${total} 个能力项`, target: 'features' },
      { key: 'engineering', label: '工程详细设计', status: blocked ? 'ISSUE' : engineeringCount === 0 ? 'NOT_STARTED' : detail.features.every((feature) => detail.engineeringAssets.some((asset) => asset.featureId === feature.id)) ? 'FORMED' : 'IN_PROGRESS', summary: `${engineeringCount} 个工程设计`, target: 'features' },
      { key: 'implementation', label: '实施', status: blocked ? 'ISSUE' : total === 0 ? 'NOT_STARTED' : done === total ? 'FORMED' : detail.capabilities.some((item) => ['IMPLEMENTING', 'TESTING', 'DONE'].includes(item.status)) ? 'IN_PROGRESS' : 'NOT_STARTED', summary: `${done} / ${total} 已完成`, target: 'development' },
      { key: 'verification', label: '验证', status: blocked ? 'ISSUE' : total === 0 ? 'NOT_STARTED' : passedCapabilityIds.size === total ? 'FORMED' : passedCapabilityIds.size ? 'IN_PROGRESS' : 'NOT_STARTED', summary: `${passedCapabilityIds.size} / ${total} 通过`, target: 'testing' },
      { key: 'complete', label: '完成', status: total > 0 && done === total && passedCapabilityIds.size === total ? 'FORMED' : blocked ? 'ISSUE' : 'NOT_STARTED', summary: total > 0 && done === total ? '能力已完成' : '尚未完成', target: 'overview' },
    ];
    const currentStage = (stages.find((stage) => stage.status === 'ISSUE')
      ?? stages.find((stage) => stage.status === 'IN_PROGRESS')
      ?? stages.find((stage) => stage.status === 'NOT_STARTED')
      ?? stages.at(-1)!).key;
    return { currentStage, stages };
  }

  listModules(projectId: string): Module[] {
    this.requireProject(projectId);
    return this.repository.listModules(projectId).map(moduleView);
  }

  createModule(projectId: string, input: { code: string; name: string; description: string; sortOrder: number }): Module {
    this.requireProject(projectId);
    const now = new Date();
    const module = { id: randomUUID(), projectId, ...input, createdAt: now, updatedAt: now };
    try {
      this.repository.insertModule(module);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'MODULE_CODE_EXISTS', '模块编号已存在');
      throw error;
    }
    return moduleView(module);
  }

  createModuleForPlanning(projectId: string, input: {
    code: string; name: string; description: string; sortOrder: number;
  }): Module {
    this.requireProject(projectId);
    const duplicate = this.repository.listModules(projectId).find((item) =>
      item.code.toLocaleLowerCase() === input.code.toLocaleLowerCase()
      || item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase());
    if (duplicate) {
      throw new ApiError(409, 'MODULE_EXISTS', `项目中已存在模块 ${duplicate.name}（${duplicate.code}）`);
    }
    return this.createModule(projectId, input);
  }

  updateModule(projectId: string, moduleId: string, input: Partial<Pick<Module, 'code' | 'name' | 'description' | 'sortOrder'>>): Module {
    const current = this.requireModule(projectId, moduleId);
    const values = { ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), updatedAt: new Date() };
    try {
      this.repository.updateModule(projectId, moduleId, values);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'MODULE_CODE_EXISTS', '模块编号已存在');
      throw error;
    }
    return moduleView({ ...current, ...values });
  }

  listFeatures(projectId: string, moduleId?: string): Feature[] {
    this.requireProject(projectId);
    if (moduleId) this.requireModule(projectId, moduleId);
    return this.repository.listFeatures(projectId, moduleId).map(featureView);
  }

  createFeature(projectId: string, input: {
    moduleId: string; code: string; name: string; summary: string; status: FeatureStatus; sortOrder: number;
  }): Feature {
    this.requireProject(projectId);
    this.requireModule(projectId, input.moduleId);
    const now = new Date();
    const feature = { id: randomUUID(), projectId, ...input, createdAt: now, updatedAt: now };
    try {
      this.repository.insertFeature(feature);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'FEATURE_CODE_EXISTS', '功能编号已存在');
      throw error;
    }
    return featureView(feature);
  }

  createFeatureDraft(moduleId: string, input: {
    code: string; name: string; summary: string;
  }): Feature {
    const module = this.repository.findModuleById(moduleId);
    if (!module) throw new ApiError(404, 'MODULE_NOT_FOUND', '模块不存在');
    const allFeatures = this.repository.listFeatures(module.projectId);
    const duplicate = allFeatures.find((item) =>
      item.code.toLocaleLowerCase() === input.code.toLocaleLowerCase()
      || item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase());
    if (duplicate) {
      throw new ApiError(409, 'FEATURE_EXISTS', `项目中已存在功能 ${duplicate.name}（${duplicate.code}）`);
    }
    const features = allFeatures.filter((item) => item.moduleId === moduleId);
    const sortOrder = features.reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1) + 1;
    return this.createFeature(module.projectId, { moduleId, ...input, status: 'DRAFT', sortOrder });
  }

  getFeature(projectId: string, featureId: string): Feature {
    return featureView(this.requireFeature(projectId, featureId));
  }

  updateFeature(projectId: string, featureId: string, input: Partial<Pick<Feature, 'moduleId' | 'code' | 'name' | 'summary' | 'status' | 'sortOrder'>>): Feature {
    const current = this.requireFeature(projectId, featureId);
    if (input.moduleId) this.requireModule(projectId, input.moduleId);
    const values = { ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), updatedAt: new Date() };
    try {
      this.repository.updateFeature(projectId, featureId, values);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'FEATURE_CODE_EXISTS', '功能编号已存在');
      throw error;
    }
    return featureView({ ...current, ...values });
  }

  listCapabilities(projectId: string, featureId: string): Capability[] {
    this.requireFeature(projectId, featureId);
    return this.repository.listCapabilities(projectId, featureId).map(capabilityView);
  }

  createCapability(projectId: string, featureId: string, input: {
    code: string; name: string; summary: string; status?: CapabilityStatus; sortOrder: number;
  }): Capability {
    const feature = this.requireFeature(projectId, featureId);
    const now = new Date();
    const capability = { id: randomUUID(), projectId, moduleId: feature.moduleId, featureId,
      code: input.code, name: input.name, summary: input.summary, status: input.status ?? 'DRAFT',
      sortOrder: input.sortOrder, createdAt: now, updatedAt: now };
    try {
      this.repository.insertCapability(capability);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'CAPABILITY_CODE_EXISTS', '该 Feature 下的 Capability 编号已存在');
      throw error;
    }
    this.syncFeatureStatus(featureId);
    return capabilityView(capability);
  }

  updateCapability(projectId: string, featureId: string, capabilityId: string, input: Partial<Pick<Capability, 'code' | 'name' | 'summary' | 'status' | 'sortOrder'>>): Capability {
    const current = this.requireCapability(projectId, featureId, capabilityId);
    const values = { ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), updatedAt: new Date() };
    try {
      this.repository.updateCapability(projectId, capabilityId, values);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'CAPABILITY_CODE_EXISTS', '该 Feature 下的 Capability 编号已存在');
      throw error;
    }
    this.syncFeatureStatus(featureId);
    return capabilityView({ ...current, ...values });
  }

  listEngineeringAssets(projectId: string, featureId: string): EngineeringAsset[] {
    this.requireFeature(projectId, featureId);
    return this.repository.listEngineeringAssets(projectId, featureId).map((asset) => this.assetView(asset));
  }

  getEngineeringAsset(projectId: string, assetId: string): EngineeringAsset {
    const asset = this.repository.findEngineeringAsset(projectId, assetId);
    if (!asset) throw new ApiError(404, 'ENGINEERING_ASSET_NOT_FOUND', '工程设计不存在');
    return this.assetView(asset);
  }

  getEngineeringAssetHistory(projectId: string, assetId: string): EngineeringAssetRevision[] {
    const asset = this.repository.findEngineeringAsset(projectId, assetId);
    if (!asset) throw new ApiError(404, 'ENGINEERING_ASSET_NOT_FOUND', '工程设计不存在');
    return this.repository.listEngineeringAssetRevisions(assetId).map(engineeringAssetRevisionView);
  }

  getEngineeringAssetRevision(projectId: string, assetId: string, revisionId: string): EngineeringAssetRevision {
    const asset = this.repository.findEngineeringAsset(projectId, assetId);
    if (!asset) throw new ApiError(404, 'ENGINEERING_ASSET_NOT_FOUND', '工程设计不存在');
    const revision = this.repository.findEngineeringAssetRevision(assetId, revisionId);
    if (!revision) throw new ApiError(404, 'ENGINEERING_ASSET_REVISION_NOT_FOUND', '工程设计版本不存在');
    return engineeringAssetRevisionView(revision);
  }

  createEngineeringAsset(projectId: string, featureId: string, input: {
    moduleId?: string | null; capabilityId?: string | null; kind: string; name: string; code?: string | null;
    summary?: string; structuredData?: Record<string, unknown> | null; contentMarkdown?: string | null; status?: string;
    source?: string; changeSummary?: string;
  }): EngineeringAsset {
    const feature = this.requireFeature(projectId, featureId);
    if (input.moduleId && input.moduleId !== feature.moduleId) throw new ApiError(400, 'ASSET_MODULE_MISMATCH', '工程设计模块与功能不一致');
    if (input.capabilityId) this.requireCapability(projectId, featureId, input.capabilityId);
    const now = new Date();
    const structuredData = input.structuredData ?? null;
    const contentMarkdown = input.contentMarkdown?.trim() || null;
    const conflicts = canonicalConflicts(structuredData, contentMarkdown);
    if (conflicts.length) throw new ApiError(409, 'ENGINEERING_ASSET_CANONICAL_CONFLICT', 'structuredData 与 Markdown 中声明的核心事实冲突', { conflicts });
    const asset = {
      id: randomUUID(), projectId, moduleId: input.moduleId ?? feature.moduleId, featureId,
      capabilityId: input.capabilityId ?? null, kind: input.kind.trim().toUpperCase(), name: input.name.trim(),
      code: input.code?.trim() || null, summary: input.summary?.trim() ?? '',
      structuredData: structuredData ? JSON.stringify(structuredData) : null,
      contentMarkdown, status: input.status?.trim().toUpperCase() || 'DESIGNED', currentRevisionId: null,
      createdAt: now, updatedAt: now,
    };
    const revision = {
      id: randomUUID(), assetId: asset.id, revisionNo: 1, structuredData: asset.structuredData, contentMarkdown,
      contentHash: engineeringContentHash(structuredData, contentMarkdown), source: input.source?.trim() || 'unknown',
      changeSummary: input.changeSummary?.trim() || '创建工程设计', createdAt: now,
    };
    try {
      this.repository.transaction(() => {
        this.repository.insertEngineeringAsset(asset);
        this.repository.insertEngineeringAssetRevision(revision);
        if (this.repository.advanceEngineeringAssetRevision(projectId, asset.id, null, { currentRevisionId: revision.id }) !== 1) {
          throw new ApiError(409, 'ENGINEERING_ASSET_VERSION_CONFLICT', '工程设计版本已变化');
        }
      });
    }
    catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'ENGINEERING_ASSET_EXISTS', '同类同名工程设计已存在');
      throw error;
    }
    return this.getEngineeringAsset(projectId, asset.id);
  }

  createEngineeringAssetRevision(projectId: string, assetId: string, input: {
    expectedCurrentRevisionId: string; changeSummary: string; source?: string;
    structuredData?: Record<string, unknown> | null; contentMarkdown?: string | null;
  } & Partial<Pick<EngineeringAsset, 'capabilityId' | 'kind' | 'name' | 'code' | 'summary' | 'status'>>): EngineeringAsset {
    const current = this.repository.findEngineeringAsset(projectId, assetId);
    if (!current) throw new ApiError(404, 'ENGINEERING_ASSET_NOT_FOUND', '工程设计不存在');
    if (!current.currentRevisionId || current.currentRevisionId !== input.expectedCurrentRevisionId) {
      throw new ApiError(409, 'ENGINEERING_ASSET_VERSION_CONFLICT', '工程设计当前版本已变化，请刷新后重试', { currentRevisionId: current.currentRevisionId });
    }
    if (input.capabilityId && current.featureId) this.requireCapability(projectId, current.featureId, input.capabilityId);
    const currentRevision = this.repository.findEngineeringAssetRevision(assetId, current.currentRevisionId);
    if (!currentRevision) throw new ApiError(409, 'ENGINEERING_ASSET_REVISION_MISSING', '工程设计当前版本不存在');
    const structuredData = Object.hasOwn(input, 'structuredData') ? input.structuredData ?? null
      : parseJson<Record<string, unknown> | null>(currentRevision.structuredData, null);
    const contentMarkdown = Object.hasOwn(input, 'contentMarkdown') ? input.contentMarkdown?.trim() || null : currentRevision.contentMarkdown;
    const conflicts = canonicalConflicts(structuredData, contentMarkdown);
    if (conflicts.length) throw new ApiError(409, 'ENGINEERING_ASSET_CANONICAL_CONFLICT', 'structuredData 与 Markdown 中声明的核心事实冲突', { conflicts });
    if (!input.changeSummary.trim()) throw new ApiError(400, 'INVALID_INPUT', '版本变更摘要不能为空');
    const revision = {
      id: randomUUID(), assetId, revisionNo: currentRevision.revisionNo + 1,
      structuredData: structuredData ? JSON.stringify(structuredData) : null, contentMarkdown,
      contentHash: engineeringContentHash(structuredData, contentMarkdown), source: input.source?.trim() || 'unknown',
      changeSummary: input.changeSummary.trim(), createdAt: new Date(),
    };
    const values = {
      ...Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined
        && !['expectedCurrentRevisionId', 'changeSummary', 'source', 'structuredData', 'contentMarkdown'].includes(key))),
      structuredData: revision.structuredData,
      kind: input.kind?.trim().toUpperCase(), name: input.name?.trim(), code: input.code?.trim() || input.code,
      contentMarkdown, status: input.status?.trim().toUpperCase(), currentRevisionId: revision.id, updatedAt: revision.createdAt,
    };
    try {
      this.repository.transaction(() => {
        this.repository.insertEngineeringAssetRevision(revision);
        if (this.repository.advanceEngineeringAssetRevision(projectId, assetId, input.expectedCurrentRevisionId,
          Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))) !== 1) {
          throw new ApiError(409, 'ENGINEERING_ASSET_VERSION_CONFLICT', '工程设计当前版本已变化，请刷新后重试');
        }
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'ENGINEERING_ASSET_VERSION_CONFLICT', '工程设计版本已变化，请刷新后重试');
      throw error;
    }
    return this.getEngineeringAsset(projectId, assetId);
  }

  updateEngineeringAsset(projectId: string, assetId: string, input: Parameters<WorkspaceService['createEngineeringAssetRevision']>[2]): EngineeringAsset {
    return this.createEngineeringAssetRevision(projectId, assetId, input);
  }

  createTraceLink(projectId: string, input: { sourceType: string; sourceId: string; targetType: string; targetId: string; relation: string }): TraceLink {
    this.requireProject(projectId);
    const link = { id: randomUUID(), projectId, sourceType: input.sourceType.trim().toUpperCase(), sourceId: input.sourceId,
      targetType: input.targetType.trim().toUpperCase(), targetId: input.targetId, relation: input.relation.trim().toUpperCase(), createdAt: new Date() };
    try { this.repository.insertTraceLink(link); }
    catch (error) {
      if (isUniqueConstraint(error)) {
        const existing = this.repository.listTraceLinks(projectId).find((item) => item.sourceType === link.sourceType && item.sourceId === link.sourceId
          && item.targetType === link.targetType && item.targetId === link.targetId && item.relation === link.relation);
        if (existing) return traceLinkView(existing);
      }
      throw error;
    }
    return traceLinkView(link);
  }

  getFeatureEngineeringBlueprint(projectId: string, featureId: string): FeatureEngineeringBlueprint {
    const feature = this.getFeature(projectId, featureId);
    const project = this.requireProject(projectId);
    const capabilities = this.listCapabilities(projectId, featureId);
    const planned = planBlueprint({ designProfile: project.designProfile, projectType: project.projectType,
      featureName: feature.name, featureSummary: feature.summary, capabilities });
    const assets = this.listEngineeringAssets(projectId, featureId);
    return {
      feature, capabilities, assets, traceLinks: this.repository.listTraceLinks(projectId).map(traceLinkView),
      requiredKinds: planned.recommendations.map((item) => item.kind),
      completeness: planned.recommendations.map((item) => ({
        kind: item.kind, label: item.label, exists: assets.some((asset) => asset.kind === item.kind),
        count: assets.filter((asset) => asset.kind === item.kind).length,
      })),
    };
  }

  getFeatureDeliveryContext(projectId: string, featureId: string) {
    const blueprint = this.getFeatureEngineeringBlueprint(projectId, featureId);
    const runs = this.repository.listRuns(projectId).filter((run) => run.featureId === featureId).map((run) => this.runView(run));
    return {
      feature: blueprint.feature,
      engineeringAssets: blueprint.assets.map((asset) => ({
        assetId: asset.id, name: asset.name, kind: asset.kind,
        currentRevisionId: asset.currentRevisionId, currentRevisionNo: asset.currentRevisionNo,
      })),
      runs: runs.map((run) => ({
        runId: run.id, taskId: run.taskId, designSnapshot: run.designSnapshot,
        sourceExecutions: run.sourceExecutions, designSnapshotStatus: run.designSnapshotStatus,
        designSnapshotWarnings: run.designSnapshotWarnings, verificationSummary: run.verificationSummary,
      })),
    };
  }

  planEngineeringBlueprint(featureId: string, createAssets = true): EngineeringBlueprintPlan {
    const rawFeature = this.repository.findFeatureById(featureId);
    if (!rawFeature) throw new ApiError(404, 'FEATURE_NOT_FOUND', '功能不存在');
    const project = this.requireProject(rawFeature.projectId);
    const capabilities = this.listCapabilities(project.id, featureId);
    const planned = planBlueprint({ designProfile: project.designProfile, projectType: project.projectType,
      featureName: rawFeature.name, featureSummary: rawFeature.summary, capabilities });
    const createdAssets: EngineeringAsset[] = [];
    if (createAssets) {
      for (const recommendation of planned.recommendations) {
        const name = recommendation.suggestedAssets[0] ?? engineeringKindLabel(recommendation.kind);
        if (this.repository.findEngineeringAssetByFeatureKindName(featureId, recommendation.kind, name)) continue;
        createdAssets.push(this.createEngineeringAsset(project.id, featureId, {
          kind: recommendation.kind, name, summary: recommendation.reason,
          structuredData: planned.initialStructuredData(recommendation.kind),
          contentMarkdown: `# ${name}\n\n> 由工程蓝图规划生成。AI 应依据项目资料、能力项和现有代码补全，不适用的内容不得虚构。`,
          status: 'DRAFT',
        }));
      }
    }
    const evidence = this.repository.listSpecifications(project.id)
      .filter(({ specification }) => specification.featureId === null && ['research', 'requirements', 'architecture', 'technology'].includes(specification.kind))
      .map(({ specification, latestRevisionNumber }) => ({ kind: specification.kind, revisionNo: latestRevisionNumber }));
    return { featureId, profiles: planned.profiles, evidence, recommendedKinds: planned.recommendations, createdAssets,
      guardrails: ['结构化数据用于快速浏览，Markdown 用于原因、约束和迁移说明。', '不适用的 UI、数据库、HTTP 或容器设计不得生成。', 'Capability 表达行为，工程设计表达实现对象，Task 只表达下一次实施工作。'] };
  }

  getCapabilityDetail(projectId: string, featureId: string, capabilityId: string): CapabilityDetail {
    const capability = capabilityView(this.requireCapability(projectId, featureId, capabilityId));
    const project = this.requireProject(projectId);
    const specification = this.repository.findCapabilitySpecification(projectId, capabilityId);
    const design = specification ? this.getSpecification(projectId, specification.id) : null;
    const tasks = this.repository.listTasks(projectId, featureId).filter((task) => task.capabilityId === capabilityId).map(taskView);
    const taskIds = new Set(tasks.map((task) => task.id));
    const runs = this.repository.listRuns(projectId).filter((run) => taskIds.has(run.taskId)).map((run) => this.runView(run));
    return {
      capability,
      design,
      implementationRevision: project.workflowMode === 'AUTO' ? design?.latestRevision ?? null : design?.approvedRevision ?? null,
      tasks,
      runs,
      engineeringAssets: this.repository.listEngineeringAssets(projectId, featureId).map((asset) => this.assetView(asset)),
      traceLinks: this.repository.listTraceLinks(projectId).map(traceLinkView).filter((link) =>
        link.sourceId === capabilityId || link.targetId === capabilityId
        || tasks.some((task) => link.sourceId === task.id || link.targetId === task.id)
        || runs.some((run) => link.sourceId === run.id || link.targetId === run.id)),
    };
  }

  getCapabilityDesignGuidance(capabilityId: string): CapabilityDesignGuidance {
    const capability = this.repository.findCapabilityById(capabilityId);
    if (!capability) throw new ApiError(404, 'CAPABILITY_NOT_FOUND', 'Capability 不存在');
    const project = this.requireProject(capability.projectId);
    const feature = this.requireFeature(capability.projectId, capability.featureId);
    const documents = this.repository.listSpecifications(capability.projectId)
      .filter(({ specification }) => specification.featureId === null && specification.capabilityId === null
        && ['research', 'requirements', 'architecture', 'technology'].includes(specification.kind))
      .map(({ specification, latestRevisionNumber }) => ({
        kind: specification.kind,
        revisionNo: latestRevisionNumber,
        content: specification.latestRevisionId
          ? this.repository.findRevision(specification.id, specification.latestRevisionId)?.markdown ?? '' : '',
      }));
    return buildCapabilityDesignGuidance({
      designProfile: project.designProfile, projectType: project.projectType, projectName: project.name,
      projectDescription: project.description, featureName: feature.name, capabilityCode: capability.code,
      capabilityName: capability.name, capabilitySummary: capability.summary, documents,
    });
  }

  createCapabilityDesign(capabilityId: string, input: { changeSummary: string; content: string; source: string }) {
    const capability = this.repository.findCapabilityById(capabilityId);
    if (!capability) throw new ApiError(404, 'CAPABILITY_NOT_FOUND', 'Capability 不存在');
    try {
      return this.repository.transaction(() => {
        if (this.repository.findCapabilitySpecification(capability.projectId, capabilityId)) {
          throw new ApiError(409, 'CAPABILITY_SPEC_EXISTS', '该 Capability 已有设计，请创建新 Revision');
        }
        const now = new Date();
        const specification = { id: randomUUID(), projectId: capability.projectId, featureId: capability.featureId,
          capabilityId, kind: 'capability-design', title: `${capability.code} ${capability.name}`,
          latestRevisionId: null, approvedRevisionId: null, createdAt: now };
        const revision = { id: randomUUID(), specId: specification.id, revisionNo: 1, markdown: input.content,
          contentHash: createHash('sha256').update(input.content).digest('hex'), source: input.source,
          changeSummary: input.changeSummary, createdAt: now };
        this.repository.insertSpecification(specification);
        this.repository.insertRevision(revision);
        if (this.repository.pointToRevision(specification.id, null, revision.id) !== 1) {
          throw new ApiError(409, 'REVISION_CONFLICT', 'Capability Design 初版创建冲突');
        }
        this.repository.updateCapability(capability.projectId, capabilityId, { status: 'DESIGNED', updatedAt: now });
        this.syncFeatureStatus(capability.featureId);
        return { specification: specificationView({ ...specification, latestRevisionId: revision.id }, 1, null), revision: revisionView(revision) };
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'CAPABILITY_SPEC_EXISTS', '该 Capability 已有设计，请创建新 Revision');
      throw error;
    }
  }

  listTasks(projectId: string, featureId: string): Task[] {
    this.requireFeature(projectId, featureId);
    return this.repository.listTasks(projectId, featureId).map(taskView);
  }

  createTask(projectId: string, featureId: string, input: {
    code: string; name: string; type: TaskType; status: TaskStatus; objective: string; sortOrder: number;
    category?: TaskCategory; area?: string;
    capabilityId?: string | null;
    designRevisionId?: string | null;
  }): Task {
    this.requireFeature(projectId, featureId);
    if (input.capabilityId) this.requireCapability(projectId, featureId, input.capabilityId);
    if (input.status !== 'PLANNED') {
      throw new ApiError(409, 'INVALID_TASK_TRANSITION', '新建 Task 必须从 PLANNED 开始');
    }
    const now = new Date();
    const task = { id: randomUUID(), projectId, featureId, ...input,
      category: input.category ?? (input.type === 'DESIGN' ? 'DESIGN' : input.type === 'INTEGRATION' ? 'INTEGRATION' : input.type === 'VERIFICATION' ? 'VERIFICATION' : 'IMPLEMENTATION'),
      area: input.area ?? '',
      capabilityId: input.capabilityId ?? null,
      designRevisionId: input.designRevisionId ?? null, createdAt: now, updatedAt: now };
    try {
      this.repository.insertTask(task);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'TASK_CODE_EXISTS', '该功能下的任务编号已存在');
      throw error;
    }
    return taskView(task);
  }

  createTaskPlan(featureId: string, input: {
    code: string; name: string; type: TaskType; category?: TaskCategory; area?: string; capabilityId?: string | null; objective: string; sortOrder?: number;
  }): Task {
    const feature = this.repository.findFeatureById(featureId);
    if (!feature) throw new ApiError(404, 'FEATURE_NOT_FOUND', '功能不存在');
    const tasks = this.repository.listTasks(feature.projectId, featureId);
    const duplicate = tasks.find((item) =>
      item.code.toLocaleLowerCase() === input.code.toLocaleLowerCase()
      || item.name.toLocaleLowerCase() === input.name.toLocaleLowerCase());
    if (duplicate) {
      throw new ApiError(409, 'TASK_PLAN_EXISTS', `功能中已存在 Task ${duplicate.name}（${duplicate.code}）`);
    }
    const sortOrder = input.sortOrder ?? tasks.reduce((maximum, item) => Math.max(maximum, item.sortOrder), -1) + 1;
    return this.createTask(feature.projectId, featureId, { ...input, sortOrder, status: 'PLANNED' });
  }

  getTask(projectId: string, featureId: string, taskId: string): Task {
    return taskView(this.requireTask(projectId, featureId, taskId));
  }

  updateTask(projectId: string, featureId: string, taskId: string, input: Partial<Pick<Task, 'code' | 'name' | 'type' | 'category' | 'area' | 'capabilityId' | 'status' | 'objective' | 'sortOrder' | 'designRevisionId'>>): Task {
    const current = this.requireTask(projectId, featureId, taskId);
    if (input.capabilityId) this.requireCapability(projectId, featureId, input.capabilityId);
    const nextType = input.type ?? current.type;
    const nextCapabilityId = input.capabilityId === undefined ? current.capabilityId : input.capabilityId;
    const nextDesignRevisionId = input.designRevisionId === undefined ? current.designRevisionId : input.designRevisionId;
    if (nextDesignRevisionId !== null) this.requireApprovedDesignBaseline(projectId, featureId, nextCapabilityId, nextDesignRevisionId);
    if (input.status && input.status !== current.status) {
      const allowed = (current.status === 'PLANNED' && input.status === 'AUTHORIZED')
        || (current.status === 'AUTHORIZED' && input.status === 'PLANNED');
      if (!allowed) throw new ApiError(409, 'INVALID_TASK_TRANSITION', '该 Task 状态必须通过授权、Run 或人工确认流程变更');
      if (input.status === 'AUTHORIZED' && nextType !== 'DESIGN') {
        this.requireApprovedDesignBaseline(projectId, featureId, nextCapabilityId, nextDesignRevisionId);
      }
      if (current.status === 'AUTHORIZED' && this.repository.findActiveAuthorization(projectId, taskId)) {
        throw new ApiError(409, 'ACTIVE_AUTHORIZATION_EXISTS', '请先撤销 ACTIVE Authorization');
      }
    }
    const values = { ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), updatedAt: new Date() };
    try {
      this.repository.updateTask(projectId, featureId, taskId, values);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'TASK_CODE_EXISTS', '该功能下的任务编号已存在');
      throw error;
    }
    return taskView({ ...current, ...values });
  }

  listAuthorizations(projectId: string, featureId: string, taskId: string): TaskAuthorization[] {
    this.requireTask(projectId, featureId, taskId);
    return this.repository.listAuthorizations(projectId, taskId).map(authorizationView);
  }

  authorizeTask(projectId: string, featureId: string, taskId: string): TaskAuthorization {
    try {
      return this.repository.transaction(() => {
        const task = this.requireTask(projectId, featureId, taskId);
        if (this.requireProject(projectId).workflowMode === 'AUTO') {
          throw new ApiError(409, 'AUTHORIZATION_NOT_REQUIRED', 'AUTO 项目不需要人工 Authorization');
        }
        if (task.status !== 'AUTHORIZED') {
          throw new ApiError(409, 'TASK_NOT_AUTHORIZED', '只有 AUTHORIZED Task 才能批准执行');
        }
        if (task.type !== 'DESIGN') {
          this.requireApprovedDesignBaseline(projectId, featureId, task.capabilityId, task.designRevisionId);
        }
        if (this.repository.findActiveAuthorization(projectId, taskId)) {
          throw new ApiError(409, 'ACTIVE_AUTHORIZATION_EXISTS', '该 Task 已有 ACTIVE Authorization');
        }
        const now = new Date();
        const authorization = {
          id: randomUUID(), taskId, projectId, featureId, status: 'ACTIVE', authorizedAt: now, revokedAt: null, createdAt: now,
        };
        this.repository.insertAuthorization(authorization);
        return authorizationView(authorization);
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'ACTIVE_AUTHORIZATION_EXISTS', '该 Task 已有 ACTIVE Authorization');
      throw error;
    }
  }

  revokeAuthorization(projectId: string, featureId: string, taskId: string, authorizationId: string): TaskAuthorization {
    return this.repository.transaction(() => {
      this.requireTask(projectId, featureId, taskId);
      const authorization = this.requireAuthorization(projectId, taskId, authorizationId);
      if (authorization.status !== 'ACTIVE') throw new ApiError(409, 'AUTHORIZATION_NOT_ACTIVE', 'Authorization 已失效');
      if (this.repository.findRunningRun(projectId, taskId)) {
        throw new ApiError(409, 'RUN_STILL_RUNNING', '存在 RUNNING Run 时请先中断 Run');
      }
      const now = new Date();
      if (this.repository.updateAuthorizationStatus(authorizationId, 'ACTIVE', 'REVOKED', now) !== 1) {
        throw new ApiError(409, 'AUTHORIZATION_NOT_ACTIVE', 'Authorization 已失效');
      }
      return authorizationView({ ...authorization, status: 'REVOKED', revokedAt: now });
    });
  }

  private normalizeChangedFiles(projectId: string, files: RunChangedFile[]): RunChangedFile[] {
    if (files.length > 500) throw new ApiError(400, 'INVALID_CHANGED_FILES', '修改文件最多 500 项');
    return files.map((file) => {
      if (typeof file === 'string') {
        if (!file.trim() || file.length > 500) throw new ApiError(400, 'INVALID_CHANGED_FILES', '历史字符串文件引用不能为空且不能超过 500 字符');
        return file.trim();
      }
      const source = this.repository.findProjectSource(projectId, file.sourceId);
      if (!source) throw new ApiError(400, 'RUN_SOURCE_PROJECT_MISMATCH', '文件引用的 Source 不属于当前项目', { sourceId: file.sourceId });
      return { sourceId: source.id, relativePath: safeRunRelativePath(file.relativePath) };
    });
  }

  private normalizeSourceExecutions(projectId: string, executions: RunSourceExecution[], existing?: RunSourceExecution[]): RunSourceExecution[] {
    if (executions.length > 100) throw new ApiError(400, 'INVALID_SOURCE_EXECUTIONS', '一次 Run 最多关联 100 个 Source');
    const seen = new Set<string>();
    return executions.map((execution) => {
      if (seen.has(execution.sourceId)) throw new ApiError(400, 'DUPLICATE_RUN_SOURCE', '同一 Run 中 Source 不能重复');
      seen.add(execution.sourceId);
      const source = this.repository.findProjectSource(projectId, execution.sourceId);
      if (!source) throw new ApiError(400, 'RUN_SOURCE_PROJECT_MISMATCH', 'Run Source 不属于当前项目', { sourceId: execution.sourceId });
      const baseline = {
        kind: execution.baseline.kind.trim().toUpperCase(), commit: execution.baseline.commit?.trim() || null,
        dirty: execution.baseline.dirty, manifestHash: execution.baseline.manifestHash?.trim() || null,
      };
      if (!baseline.kind || baseline.kind.length > 40 || (baseline.commit && baseline.commit.length > 100)
        || (baseline.manifestHash && baseline.manifestHash.length > 200)) {
        throw new ApiError(400, 'INVALID_SOURCE_BASELINE', '源码基线字段不合法');
      }
      const previous = existing?.find((item) => item.sourceId === execution.sourceId);
      if (previous && stableJson(previous.baseline) !== stableJson(baseline)) {
        throw new ApiError(409, 'RUN_SOURCE_BASELINE_CONFLICT', 'Run 启动时冻结的源码基线不能修改', { sourceId: execution.sourceId });
      }
      const changedFiles = execution.changedFiles.map((file) => {
        if (file.sourceId !== source.id) throw new ApiError(400, 'RUN_FILE_SOURCE_MISMATCH', 'Source 执行中的文件引用必须属于同一 Source');
        return { sourceId: source.id, relativePath: safeRunRelativePath(file.relativePath) };
      });
      return {
        sourceId: source.id, baseline,
        result: { commit: execution.result.commit?.trim() || null, workingTreeSummary: execution.result.workingTreeSummary?.trim() || null },
        read: Boolean(execution.read), modified: Boolean(execution.modified), changedFiles,
        verification: execution.verification.map((item) => ({
          command: item.command.trim(), workdir: item.workdir.trim(), reportedStatus: item.reportedStatus, summary: item.summary.trim(),
        })),
      };
    });
  }

  listRuns(projectId: string): AiRun[] {
    this.requireProject(projectId);
    return this.repository.listRuns(projectId).map((run) => this.runView(run));
  }

  getRun(projectId: string, runId: string): AiRun {
    return this.runView(this.requireRun(projectId, runId));
  }

  startRun(projectId: string, featureId: string, taskId: string, input: {
    authorizationId: string | null; actorType: RunActorType; actorName: string; baseCommit: string | null;
    sourceExecutions?: RunSourceExecution[];
  }): AiRun {
    try {
      return this.repository.transaction(() => {
        const task = this.requireTask(projectId, featureId, taskId);
        const project = this.requireProject(projectId);
        const isAuto = project.workflowMode === 'AUTO';
        const allowedStart = isAuto ? ['PLANNED', 'BLOCKED'].includes(task.status) : task.status === 'AUTHORIZED';
        if (!allowedStart) throw new ApiError(409, 'TASK_NOT_EXECUTABLE', 'Task 当前不可启动 Run');
        const authorization = isAuto ? null : this.requireAuthorization(projectId, taskId, input.authorizationId ?? '');
        if (!isAuto && (authorization?.featureId !== featureId || authorization.status !== 'ACTIVE')) {
          throw new ApiError(409, 'AUTHORIZATION_NOT_ACTIVE', 'Authorization 已失效');
        }
        if (this.repository.findRunningRun(projectId, taskId)) {
          throw new ApiError(409, 'RUN_ALREADY_RUNNING', '该 Task 已有 RUNNING Run');
        }
        const now = new Date();
        const designSnapshot = this.buildDesignSnapshot(projectId, featureId, task);
        const sourceExecutions = this.normalizeSourceExecutions(projectId, input.sourceExecutions ?? []);
        const run = {
          id: randomUUID(), projectId, featureId, taskId, authorizationId: authorization?.id ?? null,
          actorType: input.actorType, actorName: input.actorName, status: 'RUNNING', phase: 'PREPARING',
          baseCommit: input.baseCommit, resultCommit: null, summary: '', changedFiles: '[]',
          verificationSummary: null, designSnapshotJson: JSON.stringify(designSnapshot), sourceExecutionsJson: JSON.stringify(sourceExecutions),
          issues: '[]', startedAt: now, submittedAt: null, finishedAt: null,
          createdAt: now, updatedAt: now,
        };
        this.repository.insertRun(run);
        if (this.repository.updateTaskStatus(projectId, featureId, taskId, task.status, 'RUNNING', now) !== 1) {
          throw new ApiError(409, 'TASK_STATE_CONFLICT', 'Task 状态已变化');
        }
        const designRevisionId = this.resolveImplementationRevisionId(task);
        if (designRevisionId && task.designRevisionId !== designRevisionId) {
          this.repository.updateTask(projectId, featureId, taskId, { designRevisionId });
        }
        if (task.capabilityId) this.setCapabilityStatus(projectId, task.capabilityId, 'IMPLEMENTING');
        return this.runView(run);
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'RUN_ALREADY_RUNNING', '该 Task 已有 RUNNING Run');
      throw error;
    }
  }

  updateRunPhase(projectId: string, runId: string, phase: RunPhase): AiRun {
    const phases: RunPhase[] = ['PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING'];
    const run = this.requireRun(projectId, runId);
    if (run.status !== 'RUNNING') throw new ApiError(409, 'RUN_NOT_RUNNING', '只有 RUNNING Run 可以更新阶段');
    if (phases.indexOf(phase) < phases.indexOf(run.phase as RunPhase)) {
      throw new ApiError(409, 'INVALID_RUN_PHASE', 'Run 阶段不能回退');
    }
    const task = this.repository.findTaskById(run.taskId);
    if (phase === 'TESTING' && task?.capabilityId) this.setCapabilityStatus(projectId, task.capabilityId, 'TESTING');
    const updatedAt = new Date();
    if (this.repository.updateRun(runId, 'RUNNING', { phase, updatedAt }) !== 1) {
      throw new ApiError(409, 'RUN_NOT_RUNNING', 'Run 状态已变化');
    }
    return this.runView({ ...run, phase, updatedAt });
  }

  submitRun(projectId: string, runId: string, input: {
    summary: string; resultCommit: string | null; changedFiles: RunChangedFile[];
    verificationSummary: { reportedStatus: RunReportedStatus; summary: string; origin: RunVerificationOrigin }; issues: string[];
    sourceExecutions?: RunSourceExecution[];
  }): AiRun {
    return this.repository.transaction(() => {
      const run = this.requireRun(projectId, runId);
      if (run.status !== 'RUNNING') throw new ApiError(409, 'RUN_NOT_RUNNING', '只有 RUNNING Run 可以提交');
      const task = this.requireTask(projectId, run.featureId, run.taskId);
      if (task.status !== 'RUNNING') throw new ApiError(409, 'TASK_NOT_RUNNING', 'Task 状态已变化');
      const project = this.requireProject(projectId);
      const isAuto = project.workflowMode === 'AUTO';
      const authorization = run.authorizationId ? this.requireAuthorization(projectId, run.taskId, run.authorizationId) : null;
      if (!isAuto && authorization?.status !== 'ACTIVE') throw new ApiError(409, 'AUTHORIZATION_NOT_ACTIVE', 'Authorization 已失效');
      const now = new Date();
      const passed = input.verificationSummary.reportedStatus === 'PASS';
      const nextTaskStatus: TaskStatus = isAuto ? (passed ? 'DONE' : 'BLOCKED') : 'SUBMITTED';
      const changedFiles = this.normalizeChangedFiles(projectId, input.changedFiles);
      const storedSourceExecutions = parseJson<RunSourceExecution[]>(run.sourceExecutionsJson, []);
      const sourceExecutions = input.sourceExecutions
        ? this.normalizeSourceExecutions(projectId, input.sourceExecutions, storedSourceExecutions)
        : storedSourceExecutions;
      const verificationSummary: RunVerificationSummary = {
        status: input.verificationSummary.reportedStatus,
        reportedStatus: input.verificationSummary.reportedStatus,
        origin: input.verificationSummary.origin,
        evidenceStatus: input.verificationSummary.origin === 'AI_REPORTED' ? 'REPORTED'
          : input.verificationSummary.origin === 'LOCAL_CAPTURED' ? 'CAPTURED' : 'VERIFIED',
        summary: input.verificationSummary.summary,
      };
      const values = {
        status: 'SUBMITTED', phase: 'SUBMITTING', resultCommit: input.resultCommit, summary: input.summary,
        changedFiles: JSON.stringify(changedFiles), verificationSummary: JSON.stringify(verificationSummary),
        sourceExecutionsJson: JSON.stringify(sourceExecutions),
        issues: JSON.stringify(input.issues), submittedAt: now, finishedAt: now, updatedAt: now,
      };
      if (this.repository.updateRun(runId, 'RUNNING', values) !== 1
        || this.repository.updateTaskStatus(projectId, run.featureId, run.taskId, 'RUNNING', nextTaskStatus, now) !== 1
        || (authorization && this.repository.updateAuthorizationStatus(authorization.id, 'ACTIVE', 'CONSUMED', null) !== 1)) {
        throw new ApiError(409, 'RUN_STATE_CONFLICT', 'Run、Task 或 Authorization 状态已变化');
      }
      if (task.capabilityId) this.recomputeCapabilityStatus(projectId, task.capabilityId);
      return this.runView({ ...run, ...values });
    });
  }

  finishRun(projectId: string, runId: string, status: 'FAILED' | 'ABORTED', input: { summary: string; issues: string[] }): AiRun {
    return this.repository.transaction(() => {
      const run = this.requireRun(projectId, runId);
      if (run.status !== 'RUNNING') throw new ApiError(409, 'RUN_NOT_RUNNING', '只有 RUNNING Run 可以失败或中断');
      const task = this.requireTask(projectId, run.featureId, run.taskId);
      const project = this.requireProject(projectId);
      const isAuto = project.workflowMode === 'AUTO';
      const authorization = run.authorizationId ? this.requireAuthorization(projectId, run.taskId, run.authorizationId) : null;
      if (task.status !== 'RUNNING' || (!isAuto && authorization?.status !== 'ACTIVE')) {
        throw new ApiError(409, 'RUN_STATE_CONFLICT', 'Run、Task 或 Authorization 状态已变化');
      }
      const now = new Date();
      const values = { status, summary: input.summary, issues: JSON.stringify(input.issues), finishedAt: now, updatedAt: now };
      const nextTaskStatus: TaskStatus = isAuto ? 'BLOCKED' : 'AUTHORIZED';
      if (this.repository.updateRun(runId, 'RUNNING', values) !== 1
        || this.repository.updateTaskStatus(projectId, run.featureId, run.taskId, 'RUNNING', nextTaskStatus, now) !== 1
        || (authorization && this.repository.updateAuthorizationStatus(authorization.id, 'ACTIVE', 'CONSUMED', null) !== 1)) {
        throw new ApiError(409, 'RUN_STATE_CONFLICT', 'Run、Task 或 Authorization 状态已变化');
      }
      if (task.capabilityId) this.recomputeCapabilityStatus(projectId, task.capabilityId);
      return this.runView({ ...run, ...values });
    });
  }

  confirmTask(projectId: string, featureId: string, taskId: string): Task {
    return this.repository.transaction(() => {
      const task = this.requireTask(projectId, featureId, taskId);
      if (task.status !== 'SUBMITTED') throw new ApiError(409, 'TASK_NOT_SUBMITTED', '只有 SUBMITTED Task 可以确认完成');
      if (!this.repository.listRuns(projectId, taskId).some((run) => run.status === 'SUBMITTED')) {
        throw new ApiError(409, 'SUBMITTED_RUN_NOT_FOUND', '没有可确认的 SUBMITTED Run');
      }
      const now = new Date();
      if (this.repository.updateTaskStatus(projectId, featureId, taskId, 'SUBMITTED', 'CONFIRMED', now) !== 1) {
        throw new ApiError(409, 'TASK_STATE_CONFLICT', 'Task 状态已变化');
      }
      const active = this.repository.findActiveAuthorization(projectId, taskId);
      if (active) this.repository.updateAuthorizationStatus(active.id, 'ACTIVE', 'CONSUMED', null);
      return taskView({ ...task, status: 'CONFIRMED', updatedAt: now });
    });
  }

  returnTask(projectId: string, featureId: string, taskId: string): Task {
    return this.repository.transaction(() => {
      const task = this.requireTask(projectId, featureId, taskId);
      if (task.status !== 'SUBMITTED') throw new ApiError(409, 'TASK_NOT_SUBMITTED', '只有 SUBMITTED Task 可以退回');
      const now = new Date();
      if (this.repository.updateTaskStatus(projectId, featureId, taskId, 'SUBMITTED', 'AUTHORIZED', now) !== 1) {
        throw new ApiError(409, 'TASK_STATE_CONFLICT', 'Task 状态已变化');
      }
      return taskView({ ...task, status: 'AUTHORIZED', updatedAt: now });
    });
  }

  createSpecification(projectId: string, input: { kind: string; title: string; featureId: string | null; capabilityId?: string | null }): SpecificationSummary {
    this.requireProject(projectId);
    if (input.kind === 'feature-design' && !input.featureId) {
      throw new ApiError(400, 'INVALID_INPUT', '功能设计必须关联 Feature');
    }
    if (input.capabilityId) {
      if (!input.featureId || input.kind !== 'capability-design') {
        throw new ApiError(400, 'INVALID_INPUT', 'Capability Design 必须同时关联 Feature 和 Capability');
      }
      this.requireCapability(projectId, input.featureId, input.capabilityId);
      if (this.repository.findCapabilitySpecification(projectId, input.capabilityId)) {
        throw new ApiError(409, 'CAPABILITY_SPEC_EXISTS', '该 Capability 已经有设计资料');
      }
    } else if (input.featureId) {
      this.requireFeature(projectId, input.featureId);
      if (input.kind !== 'feature-design') {
        throw new ApiError(400, 'INVALID_INPUT', 'Feature 关联资料必须使用 feature-design 类型');
      }
      if (this.repository.findFeatureSpecification(projectId, input.featureId)) {
        throw new ApiError(409, 'FEATURE_SPEC_EXISTS', '该功能已经有设计资料');
      }
    } else if (this.repository.findProjectSpecification(projectId, input.kind)) {
      throw new ApiError(409, 'PROJECT_SPEC_EXISTS', '该项目已经存在同类型设计资料，请创建新 Revision');
    }
    const specification = {
      id: randomUUID(), projectId, featureId: input.featureId, capabilityId: input.capabilityId ?? null,
      kind: input.kind, title: input.title, latestRevisionId: null, approvedRevisionId: null, createdAt: new Date(),
    };
    try {
      this.repository.insertSpecification(specification);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ApiError(409, input.capabilityId ? 'CAPABILITY_SPEC_EXISTS' : input.featureId ? 'FEATURE_SPEC_EXISTS' : 'PROJECT_SPEC_EXISTS',
          input.capabilityId ? '该 Capability 已经有设计资料' : input.featureId ? '该功能已经有设计资料' : '该项目已经存在同类型设计资料，请创建新 Revision');
      }
      throw error;
    }
    return specificationView(specification, null, null);
  }

  createProjectSpecification(projectId: string, input: {
    type: 'BACKGROUND' | 'RESEARCH' | 'REQUIREMENT' | 'ARCHITECTURE' | 'TECHNOLOGY'; title: string;
  }): SpecificationSummary {
    const kind = {
      BACKGROUND: 'background', RESEARCH: 'research', REQUIREMENT: 'requirements',
      ARCHITECTURE: 'architecture', TECHNOLOGY: 'technology',
    }[input.type];
    return this.createSpecification(projectId, { kind, title: input.title, featureId: null, capabilityId: null });
  }

  createFeatureDesign(featureId: string, input: {
    changeSummary: string; content: string; source: string;
  }): { specification: SpecificationSummary; revision: SpecificationRevision } {
    const feature = this.repository.findFeatureById(featureId);
    if (!feature) throw new ApiError(404, 'FEATURE_NOT_FOUND', '功能不存在');
    try {
      return this.repository.transaction(() => {
        if (this.repository.findFeatureSpecification(feature.projectId, featureId)) {
          throw new ApiError(409, 'FEATURE_SPEC_EXISTS', '该功能已经有设计资料，请创建新 Revision');
        }
        const now = new Date();
        const specification = {
          id: randomUUID(), projectId: feature.projectId, featureId, capabilityId: null, kind: 'feature-design',
          approvedRevisionId: null,
          title: `${feature.name}功能设计`, latestRevisionId: null, createdAt: now,
        };
        const revision = {
          id: randomUUID(), specId: specification.id, revisionNo: 1, markdown: input.content,
          contentHash: createHash('sha256').update(input.content).digest('hex'), source: input.source,
          changeSummary: input.changeSummary, createdAt: now,
        };
        this.repository.insertSpecification(specification);
        this.repository.insertRevision(revision);
        if (this.repository.pointToRevision(specification.id, null, revision.id) !== 1) {
          throw new ApiError(409, 'REVISION_CONFLICT', '功能设计初版创建冲突');
        }
        return { specification: specificationView({ ...specification, latestRevisionId: revision.id }, 1, null), revision: revisionView(revision) };
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'FEATURE_SPEC_EXISTS', '该功能已经有设计资料，请创建新 Revision');
      throw error;
    }
  }

  getSpecification(projectId: string, specId: string): SpecificationDetail {
    const specification = this.requireSpecification(projectId, specId);
    const latest = specification.latestRevisionId
      ? this.repository.findRevision(specId, specification.latestRevisionId)
      : undefined;
    if (specification.latestRevisionId && !latest) {
      throw new Error('Specification latest revision points outside its history');
    }
    const approved = specification.approvedRevisionId
      ? this.repository.findRevision(specId, specification.approvedRevisionId)
      : undefined;
    if (specification.approvedRevisionId && !approved) {
      throw new Error('Specification approved revision points outside its history');
    }
    return {
      specification: specificationView(specification, latest?.revisionNo ?? null, approved?.revisionNo ?? null),
      latestRevision: latest ? revisionView(latest) : null,
      approvedRevision: approved ? revisionView(approved) : null,
      reviews: this.repository.listReviews(projectId, specId).map(reviewView),
    };
  }

  listRevisions(projectId: string, specId: string): SpecificationRevisionSummary[] {
    this.requireSpecification(projectId, specId);
    return this.repository.listRevisions(specId).map(revisionSummaryView);
  }

  getRevision(projectId: string, specId: string, revisionId: string): SpecificationRevision {
    this.requireSpecification(projectId, specId);
    const revision = this.repository.findRevision(specId, revisionId);
    if (!revision) throw new ApiError(404, 'REVISION_NOT_FOUND', '修订版本不存在');
    return revisionView(revision);
  }

  createRevision(projectId: string, specId: string, input: {
    content: string; changeSummary: string; expectedHeadRevisionId: string | null; source: string;
  }): SpecificationRevision {
    return this.repository.transaction(() => {
      const specification = this.requireSpecification(projectId, specId);
      if (specification.latestRevisionId !== input.expectedHeadRevisionId) {
        throw new ApiError(409, 'REVISION_CONFLICT', '当前版本已变化，请重新读取后再保存', { currentRevisionId: specification.latestRevisionId });
      }
      const latest = specification.latestRevisionId
        ? this.repository.findRevision(specId, specification.latestRevisionId)
        : undefined;
      if (specification.latestRevisionId && !latest) {
        throw new Error('Specification latest revision points outside its history');
      }
      const revision = {
        id: randomUUID(),
        specId,
        revisionNo: (latest?.revisionNo ?? 0) + 1,
        markdown: input.content,
        contentHash: createHash('sha256').update(input.content).digest('hex'),
        source: input.source,
        changeSummary: input.changeSummary,
        createdAt: new Date(),
      };
      this.repository.insertRevision(revision);
      if (this.repository.pointToRevision(specId, input.expectedHeadRevisionId, revision.id) !== 1) {
        throw new ApiError(409, 'REVISION_CONFLICT', '当前版本已变化，请重新读取后再保存');
      }
      if (specification.capabilityId) {
        const capability = this.repository.findCapability(projectId, specification.capabilityId);
        if (capability && capability.status === 'DRAFT') {
          this.repository.updateCapability(projectId, capability.id, { status: 'DESIGNED', updatedAt: new Date() });
          this.syncFeatureStatus(capability.featureId);
        }
      }
      return revisionView(revision);
    });
  }

  createRevisionBySpecId(specId: string, input: {
    content: string; changeSummary: string; expectedHeadRevisionId: string | null; source: string;
  }): SpecificationRevision {
    const specification = this.repository.findSpecificationById(specId);
    if (!specification) throw new ApiError(404, 'SPECIFICATION_NOT_FOUND', '规格不存在');
    return this.createRevision(specification.projectId, specId, input);
  }

  listReviews(projectId: string, status?: DesignReviewStatus): DesignReview[] {
    this.requireProject(projectId);
    return this.repository.listReviews(projectId).filter((review) => !status || review.status === status).map(reviewView);
  }

  getPendingReviews(projectId: string): DesignReview[] {
    return this.listReviews(projectId, 'PENDING');
  }

  submitDesignReviewBySpecId(specId: string, revisionId: string): DesignReview {
    const specification = this.repository.findSpecificationById(specId);
    if (!specification) throw new ApiError(404, 'SPECIFICATION_NOT_FOUND', '设计资料不存在');
    return this.submitDesignReview(specification.projectId, specId, revisionId);
  }

  submitDesignReview(projectId: string, specId: string, revisionId: string): DesignReview {
    try {
      return this.repository.transaction(() => {
        const specification = this.requireSpecification(projectId, specId);
        const revision = this.repository.findRevision(specId, revisionId);
        if (!revision) throw new ApiError(404, 'REVISION_NOT_FOUND', 'Revision 不存在');
        if (specification.approvedRevisionId === revisionId
          || this.repository.findApprovedReviewForRevision(projectId, specId, revisionId)) {
          throw new ApiError(409, 'REVISION_ALREADY_APPROVED', '该 Revision 已经是批准版本');
        }
        if (this.repository.findPendingReviewForSpec(projectId, specId)) {
          throw new ApiError(409, 'PENDING_REVIEW_EXISTS', '该设计资料已有待处理评审');
        }
        const previous = this.repository.listReviews(projectId, specId).find((review) => review.revisionId === revisionId);
        if (previous?.status === 'CHANGES_REQUESTED') {
          throw new ApiError(409, 'REVISION_CHANGES_REQUESTED', '该 Revision 已被要求修改，请创建新 Revision 后重新提交');
        }
        const now = new Date();
        const review = {
          id: randomUUID(), projectId, specId, revisionId, status: 'PENDING',
          submittedAt: now, decidedAt: null, decisionComment: null, createdAt: now,
        };
        this.repository.insertReview(review);
        return reviewView(review);
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'PENDING_REVIEW_EXISTS', '该设计资料已有待处理评审');
      throw error;
    }
  }

  decideDesignReview(projectId: string, reviewId: string, decision: 'APPROVED' | 'CHANGES_REQUESTED', comment: string | null): DesignReview {
    return this.repository.transaction(() => {
      const review = this.repository.findReview(projectId, reviewId);
      if (!review) throw new ApiError(404, 'REVIEW_NOT_FOUND', '设计评审不存在');
      if (review.status !== 'PENDING') throw new ApiError(409, 'REVIEW_ALREADY_DECIDED', '该设计评审已经处理');
      if (decision === 'CHANGES_REQUESTED' && !comment?.trim()) {
        throw new ApiError(400, 'DECISION_COMMENT_REQUIRED', '要求修改时必须填写原因');
      }
      const specification = this.requireSpecification(projectId, review.specId);
      if (!this.repository.findRevision(review.specId, review.revisionId)) {
        throw new Error('Design review revision is missing');
      }
      const decidedAt = new Date();
      const decisionComment = comment?.trim() || null;
      if (this.repository.updateReviewDecision(reviewId, decision, decidedAt, decisionComment) !== 1) {
        throw new ApiError(409, 'REVIEW_ALREADY_DECIDED', '该设计评审已经处理');
      }
      if (decision === 'APPROVED' && this.repository.pointToApprovedRevision(specification.id, review.revisionId) !== 1) {
        throw new ApiError(409, 'BASELINE_UPDATE_CONFLICT', '正式设计基线更新失败');
      }
      return reviewView({ ...review, status: decision, decidedAt, decisionComment });
    });
  }

  private resolveImplementationRevisionId(task: { projectId: string; featureId: string; capabilityId: string | null }) {
    const project = this.requireProject(task.projectId);
    const specification = task.capabilityId
      ? this.repository.findCapabilitySpecification(task.projectId, task.capabilityId)
      : this.repository.findFeatureSpecification(task.projectId, task.featureId);
    if (!specification) return null;
    return project.workflowMode === 'AUTO' ? specification.latestRevisionId : specification.approvedRevisionId;
  }

  private setCapabilityStatus(projectId: string, capabilityId: string, status: CapabilityStatus) {
    const capability = this.repository.findCapability(projectId, capabilityId);
    if (!capability || capability.status === status) return;
    this.repository.updateCapability(projectId, capabilityId, { status, updatedAt: new Date() });
    this.syncFeatureStatus(capability.featureId);
  }

  private recomputeCapabilityStatus(projectId: string, capabilityId: string) {
    const capability = this.repository.findCapability(projectId, capabilityId);
    if (!capability) return;
    const capabilityTasks = this.repository.listTasks(projectId, capability.featureId).filter((task) => task.capabilityId === capabilityId);
    let status: CapabilityStatus;
    if (capabilityTasks.some((task) => task.status === 'BLOCKED')) status = 'BLOCKED';
    else if (capabilityTasks.some((task) => task.status === 'RUNNING')) {
      const runningIds = new Set(capabilityTasks.filter((task) => task.status === 'RUNNING').map((task) => task.id));
      status = this.repository.listRuns(projectId).some((run) => runningIds.has(run.taskId) && run.status === 'RUNNING' && ['TESTING', 'SUBMITTING'].includes(run.phase)) ? 'TESTING' : 'IMPLEMENTING';
    } else if (capabilityTasks.length > 0 && capabilityTasks.every((task) => ['DONE', 'CONFIRMED'].includes(task.status))) status = 'DONE';
    else if (capabilityTasks.some((task) => ['DONE', 'CONFIRMED', 'SUBMITTED'].includes(task.status))) status = 'IMPLEMENTING';
    else status = this.repository.findCapabilitySpecification(projectId, capabilityId)?.latestRevisionId ? 'DESIGNED' : 'DRAFT';
    this.setCapabilityStatus(projectId, capabilityId, status);
  }

  private syncFeatureStatus(featureId: string) {
    const feature = this.repository.findFeatureById(featureId);
    if (!feature) return;
    const featureCapabilities = this.repository.listCapabilities(feature.projectId, featureId);
    let status: FeatureStatus = 'DRAFT';
    if (featureCapabilities.length > 0) {
      if (featureCapabilities.every((item) => item.status === 'DONE')) status = 'DELIVERED';
      else if (featureCapabilities.some((item) => item.status === 'TESTING')) status = 'VERIFYING';
      else if (featureCapabilities.some((item) => ['IMPLEMENTING', 'BLOCKED', 'DONE'].includes(item.status))) status = 'IMPLEMENTING';
      else if (featureCapabilities.every((item) => item.status === 'DESIGNED')) status = 'READY';
      else status = 'DESIGNING';
    }
    if (feature.status !== status) this.repository.updateFeature(feature.projectId, featureId, { status, updatedAt: new Date() });
  }

  private requireSpecification(projectId: string, specId: string) {
    const specification = this.repository.findSpecification(projectId, specId);
    if (!specification) throw new ApiError(404, 'SPECIFICATION_NOT_FOUND', '规格不存在');
    return specification;
  }

  private requireProject(projectId: string) {
    const project = this.repository.findProject(projectId);
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在');
    return project;
  }

  private requireModule(projectId: string, moduleId: string) {
    const module = this.repository.findModule(projectId, moduleId);
    if (!module) throw new ApiError(404, 'MODULE_NOT_FOUND', '模块不存在');
    return module;
  }

  private requireFeature(projectId: string, featureId: string) {
    const feature = this.repository.findFeature(projectId, featureId);
    if (!feature) throw new ApiError(404, 'FEATURE_NOT_FOUND', '功能不存在');
    return feature;
  }

  private requireCapability(projectId: string, featureId: string, capabilityId: string) {
    const capability = this.repository.findCapability(projectId, capabilityId);
    if (!capability || capability.featureId !== featureId) throw new ApiError(404, 'CAPABILITY_NOT_FOUND', 'Capability 不存在');
    return capability;
  }

  private requireTask(projectId: string, featureId: string, taskId: string) {
    const task = this.repository.findTask(projectId, featureId, taskId);
    if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在');
    return task;
  }

  private requireApprovedDesignBaseline(projectId: string, featureId: string, capabilityId: string | null, revisionId: string | null) {
    const specification = capabilityId
      ? this.repository.findCapabilitySpecification(projectId, capabilityId)
      : this.repository.findFeatureSpecification(projectId, featureId);
    if (!specification?.approvedRevisionId || !revisionId || specification.approvedRevisionId !== revisionId) {
      throw new ApiError(409, 'DESIGN_BASELINE_NOT_APPROVED', 'Task 必须绑定当前已批准的 Feature Design Revision');
    }
    const revision = this.repository.findRevision(specification.id, revisionId);
    if (!revision || !this.repository.findApprovedReviewForRevision(projectId, specification.id, revisionId)) {
      throw new ApiError(409, 'DESIGN_BASELINE_NOT_APPROVED', 'Task 必须绑定当前已批准的 Feature Design Revision');
    }
    return revision;
  }

  private requireAuthorization(projectId: string, taskId: string, authorizationId: string) {
    const authorization = this.repository.findAuthorization(projectId, taskId, authorizationId);
    if (!authorization) throw new ApiError(404, 'AUTHORIZATION_NOT_FOUND', 'Authorization 不存在');
    return authorization;
  }

  private requireRun(projectId: string, runId: string) {
    const run = this.repository.findRun(projectId, runId);
    if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', 'Run 不存在');
    return run;
  }
}
