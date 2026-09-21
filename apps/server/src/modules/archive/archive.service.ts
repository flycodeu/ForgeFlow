import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import type {
  ArchiveDocument, ArchiveDocumentDetail, ArchiveDocumentInput, ArchiveDocumentUpdateInput,
  ProjectArchiveExport, WorkEvent, WorkEventInput, WorkEventPage, WorkEventReceipt,
} from '@forgeflow/contracts';
import type { openDatabase } from '../../db/client.js';
import { engineeringAssets, engineeringAssetRevisions, projects, specificationRevisions, specifications, workEvents } from '../../db/schema.js';
import { ApiError } from '../../shared/api-error.js';
import type { AuthService } from '../security/auth.service.js';
import type { WorkspaceService } from '../workspace/workspace.service.js';
import { previewArchive, restoreArchive } from './archive-transfer.js';
import type { ProjectArchiveRestoreInput } from '@forgeflow/contracts';

type Connection = ReturnType<typeof openDatabase>;
type Principal = Awaited<ReturnType<AuthService['require']>>;
type EventRow = typeof workEvents.$inferSelect;
const identifier = z.string().trim().min(1).max(128);
const documentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(500_000),
  originalFilename: z.string().max(512).nullable().optional(),
  sourcePath: z.string().max(2048).nullable().optional(),
  contentType: z.enum(['text/markdown', 'text/plain']).default('text/markdown'),
  changeSummary: z.string().trim().max(2000).default('保存文档'),
}).strict();
const eventSchema = z.object({
  operationId: identifier,
  workId: identifier.optional(),
  type: z.enum(['PLAN', 'PROGRESS', 'DESIGN', 'RESULT', 'NOTE']),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(100_000),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  documentRevisionIds: z.array(identifier).max(100).default([]),
}).strict();

function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(400, 'INVALID_INPUT', result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  return result.data;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function hash(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function source(principal: Principal) {
  return { kind: principal.kind, name: principal.kind === 'owner' ? principal.username : principal.name };
}
function eventView(row: EventRow): WorkEvent {
  return {
    id: row.id, sequence: row.sequence, projectId: row.projectId, workId: row.workId,
    type: row.type as WorkEvent['type'], title: row.title, content: row.content,
    source: { kind: row.sourceKind as WorkEvent['source']['kind'], name: row.sourceName },
    occurredAt: row.occurredAt.toISOString(), receivedAt: row.receivedAt.toISOString(),
    documentRevisionIds: JSON.parse(row.documentRevisionIdsJson) as string[],
  };
}

export class ArchiveService {
  constructor(private readonly connection: Connection, private readonly workspace: WorkspaceService) {}

  preview(input: unknown) { return previewArchive(input); }
  restore(input: ProjectArchiveRestoreInput) { return this.workspace.getProject(restoreArchive(this.connection, input)); }

  private requireProject(projectId: string) {
    if (!this.connection.db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
      throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在');
    }
  }

  private documentView(row: Pick<typeof engineeringAssets.$inferSelect,
    'id' | 'projectId' | 'name' | 'structuredData' | 'currentRevisionId' | 'createdAt' | 'updatedAt'>): ArchiveDocument {
    const metadata = JSON.parse(row.structuredData ?? '{}') as Record<string, unknown>;
    return {
      id: row.id, projectId: row.projectId, title: row.name,
      originalFilename: typeof metadata.originalFilename === 'string' ? metadata.originalFilename : null,
      sourcePath: typeof metadata.sourcePath === 'string' ? metadata.sourcePath : null,
      contentType: metadata.contentType === 'text/plain' ? 'text/plain' : 'text/markdown',
      currentRevisionId: row.currentRevisionId!, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  listDocuments(projectId: string): ArchiveDocument[] {
    this.requireProject(projectId);
    return this.connection.db.select({ id: engineeringAssets.id, projectId: engineeringAssets.projectId,
      name: engineeringAssets.name, structuredData: engineeringAssets.structuredData,
      currentRevisionId: engineeringAssets.currentRevisionId, createdAt: engineeringAssets.createdAt, updatedAt: engineeringAssets.updatedAt,
    }).from(engineeringAssets).where(and(eq(engineeringAssets.projectId, projectId), eq(engineeringAssets.kind, 'PROJECT_DOCUMENT')))
      .orderBy(desc(engineeringAssets.updatedAt), asc(engineeringAssets.id)).all().map((row) => this.documentView(row));
  }

  getDocument(projectId: string, documentId: string): ArchiveDocumentDetail {
    this.requireProject(projectId);
    const row = this.connection.db.select().from(engineeringAssets).where(and(eq(engineeringAssets.projectId, projectId),
      eq(engineeringAssets.id, documentId), eq(engineeringAssets.kind, 'PROJECT_DOCUMENT'))).get();
    if (!row) throw new ApiError(404, 'ARCHIVE_DOCUMENT_NOT_FOUND', '存档文档不存在');
    return { ...this.documentView(row), content: row.contentMarkdown ?? '' };
  }

  getDocumentHistory(projectId: string, documentId: string) {
    this.getDocument(projectId, documentId);
    return this.workspace.getEngineeringAssetHistory(projectId, documentId);
  }

  createDocument(projectId: string, input: ArchiveDocumentInput, principal: Principal): ArchiveDocumentDetail {
    const parsed = validate(documentSchema, input);
    this.requireProject(projectId);
    const id = randomUUID();
    const revisionId = randomUUID();
    const now = new Date();
    const metadata = { title: parsed.title, originalFilename: parsed.originalFilename ?? null,
      sourcePath: parsed.sourcePath ?? null, contentType: parsed.contentType };
    const structuredData = JSON.stringify(metadata);
    const savedId = this.connection.sqlite.transaction(() => {
      if (parsed.sourcePath) {
        const existing = this.listDocuments(projectId).find((doc) => doc.sourcePath === parsed.sourcePath);
        if (existing) {
          const detail = this.getDocument(projectId, existing.id);
          if (detail.title === parsed.title && detail.content === parsed.content
            && detail.originalFilename === metadata.originalFilename && detail.contentType === metadata.contentType) return existing.id;
          throw new ApiError(409, 'ARCHIVE_DOCUMENT_EXISTS', '该来源文档已经存档，请读取现有版本后更新',
            { documentId: existing.id, currentRevisionId: existing.currentRevisionId });
        }
      }
      this.connection.db.insert(engineeringAssets).values({ id, projectId, kind: 'PROJECT_DOCUMENT', name: parsed.title,
        structuredData, contentMarkdown: parsed.content, status: 'ARCHIVED', createdAt: now, updatedAt: now }).run();
      this.connection.db.insert(engineeringAssetRevisions).values({ id: revisionId, assetId: id, revisionNo: 1,
        structuredData, contentMarkdown: parsed.content, contentHash: hash(`${stableJson(metadata)}\n${parsed.content}`),
        source: `${principal.kind}:${source(principal).name}`, changeSummary: parsed.changeSummary, createdAt: now }).run();
      this.connection.db.update(engineeringAssets).set({ currentRevisionId: revisionId }).where(eq(engineeringAssets.id, id)).run();
      return id;
    }).immediate();
    return this.getDocument(projectId, savedId);
  }

  updateDocument(projectId: string, documentId: string, input: ArchiveDocumentUpdateInput, principal: Principal): ArchiveDocumentDetail {
    const parsed = validate(documentSchema.extend({ expectedRevisionId: identifier }), input);
    this.connection.sqlite.transaction(() => {
      const current = this.getDocument(projectId, documentId);
      if (current.currentRevisionId !== parsed.expectedRevisionId) throw new ApiError(409, 'ARCHIVE_VERSION_CONFLICT',
        '文档已有新版本，请刷新后合并，当前输入尚未保存', { currentRevisionId: current.currentRevisionId });
      const prior = this.connection.db.select().from(engineeringAssetRevisions).where(eq(engineeringAssetRevisions.id, current.currentRevisionId)).get()!;
      const revisionId = randomUUID();
      const now = new Date();
      const metadata = { title: parsed.title,
        originalFilename: Object.hasOwn(parsed, 'originalFilename') ? parsed.originalFilename ?? null : current.originalFilename,
        sourcePath: Object.hasOwn(parsed, 'sourcePath') ? parsed.sourcePath ?? null : current.sourcePath,
        contentType: Object.hasOwn(input, 'contentType') ? parsed.contentType : current.contentType };
      if (metadata.sourcePath && this.listDocuments(projectId).some((doc) => doc.id !== documentId && doc.sourcePath === metadata.sourcePath)) {
        throw new ApiError(409, 'ARCHIVE_DOCUMENT_EXISTS', '该来源已关联另一份存档文档');
      }
      const structuredData = JSON.stringify(metadata);
      this.connection.db.insert(engineeringAssetRevisions).values({ id: revisionId, assetId: documentId,
        revisionNo: prior.revisionNo + 1, structuredData, contentMarkdown: parsed.content,
        contentHash: hash(`${stableJson(metadata)}\n${parsed.content}`), source: `${principal.kind}:${source(principal).name}`,
        changeSummary: parsed.changeSummary, createdAt: now }).run();
      const changed = this.connection.db.update(engineeringAssets).set({ name: parsed.title, structuredData,
        contentMarkdown: parsed.content, currentRevisionId: revisionId, updatedAt: now }).where(and(
        eq(engineeringAssets.id, documentId), eq(engineeringAssets.currentRevisionId, parsed.expectedRevisionId))).run();
      if (changed.changes !== 1) throw new ApiError(409, 'ARCHIVE_VERSION_CONFLICT', '文档已有新版本，请刷新后合并');
    }).immediate();
    return this.getDocument(projectId, documentId);
  }

  listEvents(projectId: string, options: { before?: number; limit?: number; workId?: string } = {}): WorkEventPage {
    this.requireProject(projectId);
    const parsed = validate(z.object({ before: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(50), workId: identifier.optional() }).strict(), options);
    const rows = this.connection.db.select().from(workEvents).where(and(eq(workEvents.projectId, projectId),
      parsed.before ? lt(workEvents.sequence, parsed.before) : undefined,
      parsed.workId ? eq(workEvents.workId, parsed.workId) : undefined)).orderBy(desc(workEvents.sequence)).limit(parsed.limit + 1).all();
    const items = rows.slice(0, parsed.limit).map(eventView);
    return { items, nextCursor: rows.length > parsed.limit ? items.at(-1)!.sequence : null };
  }

  appendEvent(projectId: string, input: WorkEventInput, principal: Principal): WorkEventReceipt {
    const parsed = validate(eventSchema, input);
    parsed.documentRevisionIds = [...new Set(parsed.documentRevisionIds)].sort();
    const principalKey = `${principal.kind}:${principal.id}`;
    const payloadHash = hash(stableJson(parsed));
    return this.connection.sqlite.transaction((): WorkEventReceipt => {
      this.requireProject(projectId);
      const prior = this.connection.db.select().from(workEvents).where(and(eq(workEvents.projectId, projectId),
        eq(workEvents.principalKey, principalKey), eq(workEvents.operationId, parsed.operationId))).get();
      if (prior) {
        if (prior.payloadHash !== payloadHash) throw new ApiError(409, 'WORK_EVENT_OPERATION_CONFLICT', '同一操作标识已提交不同内容');
        return { committed: true, replayed: true, event: eventView(prior) };
      }
      if (parsed.workId) {
        const root = this.connection.db.select().from(workEvents).where(and(eq(workEvents.projectId, projectId),
          eq(workEvents.id, parsed.workId), eq(workEvents.workId, parsed.workId))).get();
        if (!root) throw new ApiError(404, 'WORK_NOT_FOUND', '本项目中不存在该工作记录');
        if (principal.kind === 'ai_token' && root.principalKey !== principalKey) {
          throw new ApiError(403, 'WORK_SOURCE_MISMATCH', '此工作由其他连接创建，请建立新的工作记录');
        }
      }
      for (const revisionId of parsed.documentRevisionIds) {
        const revision = this.connection.db.select({ id: engineeringAssetRevisions.id }).from(engineeringAssetRevisions)
          .innerJoin(engineeringAssets, eq(engineeringAssetRevisions.assetId, engineeringAssets.id))
          .where(and(eq(engineeringAssetRevisions.id, revisionId), eq(engineeringAssets.projectId, projectId))).get();
        if (!revision) throw new ApiError(404, 'DOCUMENT_REVISION_NOT_FOUND', '关联文档版本不存在或不属于本项目');
      }
      const id = randomUUID();
      const now = new Date();
      const actor = source(principal);
      const row = this.connection.db.insert(workEvents).values({ id, projectId, workId: parsed.workId ?? id, principalKey,
        operationId: parsed.operationId, payloadHash, type: parsed.type, title: parsed.title, content: parsed.content,
        sourceKind: actor.kind, sourceName: actor.name, documentRevisionIdsJson: JSON.stringify(parsed.documentRevisionIds),
        occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : now, receivedAt: now }).returning().get();
      return { committed: true, replayed: false, event: eventView(row) };
    }).immediate();
  }

  exportProject(projectId: string): ProjectArchiveExport {
    return this.connection.sqlite.transaction((): ProjectArchiveExport => {
      const project = this.workspace.getProject(projectId);
      const specIds = project.specifications.map((spec) => spec.id);
      const revisions = specIds.length ? this.connection.db.select().from(specificationRevisions)
        .innerJoin(specifications, eq(specificationRevisions.specId, specifications.id))
        .where(and(eq(specifications.projectId, projectId), inArray(specificationRevisions.specId, specIds)))
        .orderBy(asc(specificationRevisions.createdAt)).all().map(({ rd_spec_revision: row }) => ({
          id: row.id, specId: row.specId, revisionNo: row.revisionNo, content: row.markdown, contentHash: row.contentHash,
          source: row.source, changeSummary: row.changeSummary, createdAt: row.createdAt.toISOString(),
        })) : [];
      return { format: 'forgeflow-project-archive', formatVersion: 1, exportedAt: new Date().toISOString(), project,
        documents: this.listDocuments(projectId).map((doc) => ({ ...this.getDocument(projectId, doc.id), revisions: this.getDocumentHistory(projectId, doc.id) })),
        engineeringAssetRevisions: project.engineeringAssets.flatMap((asset) => this.workspace.getEngineeringAssetHistory(projectId, asset.id)),
        specificationRevisions: revisions,
        events: this.connection.db.select().from(workEvents).where(eq(workEvents.projectId, projectId)).orderBy(asc(workEvents.sequence)).all().map(eventView),
      };
    })();
  }
}
