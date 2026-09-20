import type { EngineeringAssetRevision, ProjectDetail, SpecificationRevision } from './index.js';

export type ArchiveDocument = {
  id: string;
  projectId: string;
  title: string;
  originalFilename: string | null;
  sourcePath: string | null;
  contentType: 'text/markdown' | 'text/plain';
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
};
export type ArchiveDocumentDetail = ArchiveDocument & { content: string };
export type ArchiveDocumentInput = {
  title: string;
  content: string;
  originalFilename?: string | null;
  sourcePath?: string | null;
  contentType?: 'text/markdown' | 'text/plain';
  changeSummary?: string;
};
export type ArchiveDocumentUpdateInput = ArchiveDocumentInput & { expectedRevisionId: string };
export const WORK_EVENT_TYPES = ['PLAN', 'PROGRESS', 'DESIGN', 'RESULT', 'NOTE'] as const;
export type WorkEventType = typeof WORK_EVENT_TYPES[number];
export type WorkEventInput = {
  operationId: string;
  workId?: string;
  type: WorkEventType;
  title: string;
  content: string;
  occurredAt?: string;
  documentRevisionIds?: string[];
};
export type WorkEvent = {
  id: string;
  sequence: number;
  projectId: string;
  workId: string;
  type: WorkEventType;
  title: string;
  content: string;
  source: { kind: 'owner' | 'local_web' | 'ai_token'; name: string };
  occurredAt: string;
  receivedAt: string;
  documentRevisionIds: string[];
};
export type WorkEventPage = { items: WorkEvent[]; nextCursor: number | null };
export type WorkEventReceipt = { committed: true; replayed: boolean; event: WorkEvent };
export type ProjectArchiveExport = {
  format: 'forgeflow-project-archive';
  formatVersion: 1;
  exportedAt: string;
  project: ProjectDetail;
  documents: Array<ArchiveDocumentDetail & { revisions: EngineeringAssetRevision[] }>;
  engineeringAssetRevisions: EngineeringAssetRevision[];
  specificationRevisions: SpecificationRevision[];
  events: WorkEvent[];
};
