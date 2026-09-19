export type HealthResponse = {
  status: 'ok' | 'error';
  service: 'forgeflow-server';
  database: 'ok' | 'error';
};

export type Project = {
  id: string;
  projectKey: string;
  name: string;
  createdAt: string;
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

export const TASK_STATUSES = [
  'PLANNED',
  'AUTHORIZED',
  'RUNNING',
  'SUBMITTED',
  'CONFIRMED',
] as const;

export type TaskStatus = typeof TASK_STATUSES[number];

export type Task = {
  id: string;
  projectId: string;
  featureId: string;
  code: string;
  name: string;
  type: TaskType;
  status: TaskStatus;
  objective: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
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

export type RunVerificationSummary = {
  status: string;
  summary: string;
};

export type AiRun = {
  id: string;
  projectId: string;
  featureId: string;
  taskId: string;
  authorizationId: string;
  actorType: RunActorType;
  actorName: string;
  status: RunStatus;
  phase: RunPhase;
  baseCommit: string | null;
  resultCommit: string | null;
  summary: string;
  changedFiles: string[];
  verificationSummary: RunVerificationSummary | null;
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
  kind: string;
  title: string;
  latestRevisionId: string | null;
  latestRevisionNumber: number | null;
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
  modules: Module[];
  features: Feature[];
  tasks: Task[];
  authorizations: TaskAuthorization[];
  runs: AiRun[];
  specifications: SpecificationSummary[];
};

export type SpecificationDetail = {
  specification: SpecificationSummary;
  latestRevision: SpecificationRevision | null;
};

export type ApiErrorResponse = {
  error: {
    code: string;
    message: string;
    currentRevisionId?: string | null;
  };
};

export type AiScope = 'project:read' | 'spec:read' | 'spec:write';

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
