export type HealthResponse = {
  status: 'ok' | 'error';
  service: 'forgeflow-server';
  database: 'ok' | 'error';
};

export type Project = {
  id: string;
  projectKey: string;
  name: string;
  description: string;
  projectType: string;
  workflowMode: WorkflowMode;
  designProfile: string;
  createdAt: string;
};

export const WORKFLOW_MODES = ['AUTO', 'CONTROLLED'] as const;
export type WorkflowMode = typeof WORKFLOW_MODES[number];

export const CAPABILITY_STATUSES = ['DRAFT', 'DESIGNED', 'IMPLEMENTING', 'TESTING', 'DONE', 'BLOCKED'] as const;
export type CapabilityStatus = typeof CAPABILITY_STATUSES[number];

export type Capability = {
  id: string;
  projectId: string;
  moduleId: string;
  featureId: string;
  code: string;
  name: string;
  summary: string;
  status: CapabilityStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export const BUILTIN_ENGINEERING_ASSET_KINDS = [
  'DATA_MODEL',
  'CODE_MODEL',
  'INTERFACE',
  'UI_DESIGN',
  'INTEGRATION',
  'ALGORITHM',
  'PIPELINE',
  'CONFIG',
  'DEPLOYMENT',
  'TEST_DESIGN',
  'OTHER',
] as const;

export type EngineeringAsset = {
  id: string;
  projectId: string;
  moduleId: string | null;
  featureId: string | null;
  capabilityId: string | null;
  kind: string;
  name: string;
  code: string | null;
  summary: string;
  structuredData: Record<string, unknown> | null;
  contentMarkdown: string | null;
  status: string;
  currentRevisionId: string;
  currentRevisionNo: number;
  canonicalStatus: 'CONSISTENT' | 'CONFLICT';
  canonicalConflicts: string[];
  createdAt: string;
  updatedAt: string;
};

export type EngineeringAssetRevision = {
  id: string;
  assetId: string;
  revisionNo: number;
  structuredData: Record<string, unknown> | null;
  contentMarkdown: string | null;
  contentHash: string;
  source: string;
  changeSummary: string;
  createdAt: string;
};

export const TRACE_RELATIONS = ['DERIVED_FROM', 'IMPLEMENTS', 'DEPENDS_ON', 'VERIFIED_BY', 'INTEGRATES_WITH'] as const;
export type TraceRelation = typeof TRACE_RELATIONS[number] | string;

export type TraceLink = {
  id: string;
  projectId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relation: TraceRelation;
  createdAt: string;
};

export const PROJECT_SOURCE_KINDS = ['GIT', 'DIRECTORY'] as const;
export type ProjectSourceKind = typeof PROJECT_SOURCE_KINDS[number];

export const SOURCE_ACCESSIBILITY = ['UNKNOWN', 'ACCESSIBLE', 'INACCESSIBLE'] as const;
export type SourceAccessibility = typeof SOURCE_ACCESSIBILITY[number];

export type ProjectSourceScope = {
  include: string[];
  exclude: string[];
};

export type ProjectSourceLocation = {
  environmentKey: string;
  localRoot: string;
  accessibility: SourceAccessibility;
  analysisStatus: 'NOT_REQUESTED' | 'WAITING_AI' | 'READING' | 'PARTIAL' | 'SYNCED' | 'FAILED' | 'STALE';
  lastCheckedAt: string | null;
};

export type ProjectSource = {
  id: string;
  projectId: string;
  alias: string;
  displayName: string;
  purpose: string;
  sourceKind: ProjectSourceKind;
  remoteUrl: string | null;
  repoSubdir: string | null;
  scope: ProjectSourceScope;
  locations: ProjectSourceLocation[];
  status: 'REGISTERED';
  createdAt: string;
  updatedAt: string;
};

export const SOURCE_ANALYSIS_STATUSES = ['WAITING_AI', 'READING', 'PARTIAL', 'SYNCED', 'FAILED', 'STALE'] as const;
export type SourceAnalysisStatus = typeof SOURCE_ANALYSIS_STATUSES[number];

export type SourceAnalysisTargetScope = {
  featureId?: string;
  capabilityId?: string;
  analysisScope?: Record<string, unknown> | null;
  prompt?: string | null;
};

export type SourceAnalysis = {
  id: string;
  displayId: string;
  projectId: string;
  requestedSourceIds: string[];
  targetScope: SourceAnalysisTargetScope;
  environmentKey: string;
  status: SourceAnalysisStatus;
  sourceSnapshots: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  summary: string | null;
  errors: Record<string, unknown> | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  sources: ProjectSource[];
  recommendedFlow: string[];
  exclusions: string[];
  prompts: { codex: string; claude: string };
};

export type UpsertProjectSourceInput = {
  projectId: string;
  sourceId?: string | null;
  alias: string;
  displayName: string;
  purpose: string;
  sourceKind: ProjectSourceKind;
  environmentKey: string;
  localRoot: string;
  remoteUrl?: string | null;
  repoSubdir?: string | null;
  scope?: Partial<ProjectSourceScope> | null;
  expectedUpdatedAt?: string | null;
  idempotencyKey: string;
};

export type RequestSourceAnalysisInput = {
  projectId: string;
  sourceIds: string[];
  environmentKey: string;
  featureId?: string | null;
  capabilityId?: string | null;
  analysisScope?: Record<string, unknown> | null;
  prompt?: string | null;
};

export type ResolveProjectSourcesInput = {
  projectId?: string;
  projectCode?: string;
  cwd?: string;
  remoteUrl?: string;
  projectName?: string;
};

export type ResolvedProjectSources = {
  project: Project;
  sources: ProjectSource[];
};

export type EngineeringBlueprintPlan = {
  featureId: string;
  profiles: string[];
  evidence: Array<{ kind: string; revisionNo: number | null }>;
  recommendedKinds: Array<{
    kind: string;
    label: string;
    reason: string;
    suggestedAssets: string[];
  }>;
  createdAssets: EngineeringAsset[];
  guardrails: string[];
};

export type FeatureEngineeringBlueprint = {
  feature: Feature;
  capabilities: Capability[];
  assets: EngineeringAsset[];
  traceLinks: TraceLink[];
  requiredKinds: string[];
  completeness: Array<{ kind: string; label: string; exists: boolean; count: number }>;
};

export const FEATURE_STATUSES = [
  'DRAFT',
  'DESIGNING',
  'READY',
  'IMPLEMENTING',
  'VERIFYING',
  'ACCEPTANCE_PENDING',
  'ACCEPTED',
  'DELIVERED',
] as const;

export type FeatureStatus = typeof FEATURE_STATUSES[number];

export type Module = {
  id: string;
  projectId: string;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Feature = {
  id: string;
  projectId: string;
  moduleId: string;
  code: string;
  name: string;
  summary: string;
  status: FeatureStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export const TASK_TYPES = [
  'DESIGN',
  'BACKEND',
  'FRONTEND',
  'INTEGRATION',
  'VERIFICATION',
  'OTHER',
] as const;

export type TaskType = typeof TASK_TYPES[number];

export const TASK_CATEGORIES = [
  'DESIGN',
  'IMPLEMENTATION',
  'INTEGRATION',
  'VERIFICATION',
  'MIGRATION',
  'CONTENT',
  'OTHER',
] as const;

export type TaskCategory = typeof TASK_CATEGORIES[number];

export const TASK_STATUSES = [
  'PLANNED',
  'AUTHORIZED',
  'RUNNING',
  'SUBMITTED',
  'CONFIRMED',
  'DONE',
  'BLOCKED',
] as const;

export type TaskStatus = typeof TASK_STATUSES[number];

export type Task = {
  id: string;
  projectId: string;
  featureId: string;
  capabilityId: string | null;
  code: string;
  name: string;
  type: TaskType;
  category: TaskCategory;
  area: string;
  status: TaskStatus;
  objective: string;
  designRevisionId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectProfile = 'WEB' | 'GODOT' | 'PIPELINE' | 'AI' | 'WORKFLOW' | 'CLI' | 'GENERAL';

export type FeatureDesignGuidance = {
  profile: ProjectProfile;
  profileLabel: string;
  evidenceKinds: string[];
  coreSections: string[];
  adaptiveSections: string[];
  markdownTemplate: string;
  suggestedTasks: Array<{
    code: string;
    name: string;
    category: TaskCategory;
    area: string;
    objective: string;
  }>;
  guardrails: string[];
};

export type CapabilityDesignGuidance = {
  profile: ProjectProfile;
  profileLabel: string;
  coreSections: string[];
  adaptiveSections: string[];
  markdownTemplate: string;
  guardrails: string[];
};

export const AUTHORIZATION_STATUSES = ['ACTIVE', 'REVOKED', 'CONSUMED'] as const;
export type AuthorizationStatus = typeof AUTHORIZATION_STATUSES[number];

export type TaskAuthorization = {
  id: string;
  taskId: string;
  projectId: string;
  featureId: string;
  status: AuthorizationStatus;
  authorizedAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export const RUN_STATUSES = ['RUNNING', 'SUBMITTED', 'FAILED', 'ABORTED'] as const;
export type RunStatus = typeof RUN_STATUSES[number];

export const RUN_PHASES = ['PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING'] as const;
export type RunPhase = typeof RUN_PHASES[number];
export type RunActorType = 'MANUAL' | 'AI_TOKEN';

export const RUN_REPORTED_STATUSES = ['PASS', 'FAIL', 'NOT_RUN', 'SKIPPED', 'ERROR'] as const;
export type RunReportedStatus = typeof RUN_REPORTED_STATUSES[number];
export const RUN_VERIFICATION_ORIGINS = ['AI_REPORTED', 'LOCAL_CAPTURED', 'CI', 'HUMAN'] as const;
export type RunVerificationOrigin = typeof RUN_VERIFICATION_ORIGINS[number];
export type RunEvidenceStatus = 'UNVERIFIED' | 'REPORTED' | 'CAPTURED' | 'VERIFIED';

export type RunVerificationSummary = {
  status: RunReportedStatus;
  reportedStatus: RunReportedStatus;
  evidenceStatus: RunEvidenceStatus;
  origin: RunVerificationOrigin;
  summary: string;
};

export type RunDesignSnapshotItem = {
  specId: string;
  revisionId: string;
  revisionNo: number;
};

export type RunEngineeringAssetSnapshotItem = {
  assetId: string;
  revisionId: string;
  revisionNo: number;
};

export type RunDesignSnapshot = {
  specifications: RunDesignSnapshotItem[];
  engineeringAssets: RunEngineeringAssetSnapshotItem[];
};

export type RunChangedFile = string | { sourceId: string; relativePath: string };

export type RunSourceExecution = {
  sourceId: string;
  baseline: {
    kind: string;
    commit: string | null;
    dirty: boolean | null;
    manifestHash: string | null;
  };
  result: {
    commit: string | null;
    workingTreeSummary: string | null;
  };
  read: boolean;
  modified: boolean;
  changedFiles: Array<{ sourceId: string; relativePath: string }>;
  verification: Array<{
    command: string;
    workdir: string;
    reportedStatus: RunReportedStatus;
    summary: string;
  }>;
};

export type AiRun = {
  id: string;
  projectId: string;
  featureId: string;
  taskId: string;
  authorizationId: string | null;
  actorType: RunActorType;
  actorName: string;
  status: RunStatus;
  phase: RunPhase;
  baseCommit: string | null;
  resultCommit: string | null;
  summary: string;
  changedFiles: RunChangedFile[];
  verificationSummary: RunVerificationSummary | null;
  designSnapshot: RunDesignSnapshot;
  sourceExecutions: RunSourceExecution[];
  designSnapshotStatus: 'CURRENT' | 'STALE' | 'UNKNOWN';
  designSnapshotWarnings: string[];
  issues: string[];
  startedAt: string;
  submittedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SpecificationSummary = {
  id: string;
  projectId: string;
  featureId: string | null;
  capabilityId: string | null;
  kind: string;
  title: string;
  latestRevisionId: string | null;
  latestRevisionNumber: number | null;
  approvedRevisionId: string | null;
  approvedRevisionNumber: number | null;
  createdAt: string;
};

export type SpecificationRevision = {
  id: string;
  specId: string;
  revisionNo: number;
  content: string;
  contentHash: string;
  source: string;
  changeSummary: string;
  createdAt: string;
};

export type SpecificationRevisionSummary = Omit<SpecificationRevision, 'content'>;

export type ProjectDetail = {
  project: Project;
  sources: ProjectSource[];
  sourceAnalyses: SourceAnalysis[];
  modules: Module[];
  features: Feature[];
  capabilities: Capability[];
  tasks: Task[];
  authorizations: TaskAuthorization[];
  runs: AiRun[];
  specifications: SpecificationSummary[];
  reviews: DesignReview[];
  engineeringAssets: EngineeringAsset[];
  traceLinks: TraceLink[];
};

export type LifecycleStageStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'FORMED' | 'ISSUE';
export type ProjectLifecycleStage = {
  key: 'discovery' | 'requirements' | 'decisions' | 'breakdown' | 'engineering' | 'implementation' | 'verification' | 'complete';
  label: string;
  status: LifecycleStageStatus;
  summary: string;
  target: 'research' | 'requirements' | 'architecture' | 'technology' | 'features' | 'development' | 'testing' | 'overview';
};

export type ProjectLifecycle = {
  currentStage: ProjectLifecycleStage['key'];
  stages: ProjectLifecycleStage[];
};

export type CapabilityDetail = {
  capability: Capability;
  design: SpecificationDetail | null;
  implementationRevision: SpecificationRevision | null;
  tasks: Task[];
  runs: AiRun[];
  engineeringAssets: EngineeringAsset[];
  traceLinks: TraceLink[];
};

export type SpecificationDetail = {
  specification: SpecificationSummary;
  latestRevision: SpecificationRevision | null;
  approvedRevision: SpecificationRevision | null;
  reviews: DesignReview[];
};

export const DESIGN_REVIEW_STATUSES = ['PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED'] as const;
export type DesignReviewStatus = typeof DESIGN_REVIEW_STATUSES[number];

export type DesignReview = {
  id: string;
  projectId: string;
  specId: string;
  revisionId: string;
  status: DesignReviewStatus;
  submittedAt: string;
  decidedAt: string | null;
  decisionComment: string | null;
  createdAt: string;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    currentRevisionId?: string | null;
  };
};

export type AiScope =
  | 'project:read'
  | 'project:write'
  | 'spec:read'
  | 'spec:write'
  | 'planning:write'
  | 'task:read'
  | 'run:write';

export type OwnerIdentity = { kind: 'owner'; id: 1; username: string };
export type AiIdentity = { kind: 'ai_token'; id: string; name: string; scopes: AiScope[] };

export type AuthStatus = { initialized: boolean };
export type CurrentIdentity = { identity: OwnerIdentity };

export type AiTokenSummary = {
  id: string;
  name: string;
  scopes: AiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedAiToken = AiTokenSummary & { token: string };
