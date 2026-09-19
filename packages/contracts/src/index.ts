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
