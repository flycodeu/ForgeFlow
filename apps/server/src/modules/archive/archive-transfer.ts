import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ProjectArchiveExport, ProjectArchivePreview, ProjectArchiveRestoreInput } from '@forgeflow/contracts';
import type { openDatabase } from '../../db/client.js';
import { ApiError } from '../../shared/api-error.js';
import { normalizeLocalRoot } from '../workspace/workspace.service.js';

type Connection = ReturnType<typeof openDatabase>;
const id = z.string().min(1).max(128);
const text = z.string().max(500_000);
const small = z.string().max(2048);
const date = z.iso.datetime({ offset: true });
const num = z.number().int().nonnegative();
const obj = z.record(z.string(), z.json());
const strings = z.array(small).max(10_000);
const arr = <T extends z.ZodType>(schema: T) => z.array(schema).max(20_000);
const base = { id, projectId: id, createdAt: date };
const edited = { ...base, updatedAt: date };
const ranked = { ...edited, code: small, name: small, sortOrder: num };
const sourceSchema = z.object({ ...edited, alias: small, displayName: small, purpose: text,
  sourceKind: z.enum(['GIT', 'DIRECTORY']), remoteUrl: small.nullable(), repoSubdir: small.nullable(),
  scope: z.object({ include: strings, exclude: strings }).strict(),
  locations: arr(z.object({ environmentKey: small, localRoot: small,
    accessibility: z.enum(['UNKNOWN', 'ACCESSIBLE', 'INACCESSIBLE']),
    analysisStatus: z.enum(['NOT_REQUESTED', 'WAITING_AI', 'READING', 'PARTIAL', 'SYNCED', 'FAILED', 'STALE']), lastCheckedAt: date.nullable() }).strict()),
  status: z.literal('REGISTERED') }).strict();
const revisionSchema = z.object({ id, assetId: id, revisionNo: num.positive(), structuredData: obj.nullable(),
  contentMarkdown: text.nullable(), contentHash: small, source: small, changeSummary: text, createdAt: date }).strict();
const changedFile = z.union([small, z.object({ sourceId: id, relativePath: small }).strict()]);
const reported = z.enum(['PASS', 'FAIL', 'NOT_RUN', 'SKIPPED', 'ERROR']);
const projectSchema = z.object({
  project: z.object({ id, projectKey: small, name: small, description: text, projectType: small,
    workflowMode: z.enum(['AUTO', 'CONTROLLED']), designProfile: small, createdAt: date }).strict(),
  sources: arr(sourceSchema),
  sourceAnalyses: arr(z.object({ id, projectId: id, displayId: small, requestedSourceIds: arr(id),
    targetScope: z.object({ featureId: id.optional(), capabilityId: id.optional(), analysisScope: obj.nullable().optional(), prompt: text.nullable().optional() }).strict(),
    environmentKey: small, status: z.enum(['WAITING_AI', 'READING', 'PARTIAL', 'SYNCED', 'FAILED', 'STALE']),
    sourceSnapshots: obj.nullable(), checkpoint: obj.nullable(), summary: text.nullable(), errors: obj.nullable(),
    requestedAt: date, startedAt: date.nullable(), completedAt: date.nullable(), updatedAt: date,
    sources: arr(sourceSchema), recommendedFlow: strings, exclusions: strings,
    prompts: z.object({ codex: text, claude: text }).strict() }).strict()),
  modules: arr(z.object({ ...ranked, description: text }).strict()),
  features: arr(z.object({ ...ranked, moduleId: id, summary: text,
    status: z.enum(['DRAFT', 'DESIGNING', 'READY', 'IMPLEMENTING', 'VERIFYING', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'DELIVERED']) }).strict()),
  capabilities: arr(z.object({ ...ranked, moduleId: id, featureId: id, summary: text,
    status: z.enum(['DRAFT', 'DESIGNED', 'IMPLEMENTING', 'TESTING', 'DONE', 'BLOCKED']) }).strict()),
  tasks: arr(z.object({ ...ranked, featureId: id, capabilityId: id.nullable(),
    type: z.enum(['DESIGN', 'BACKEND', 'FRONTEND', 'INTEGRATION', 'VERIFICATION', 'OTHER']),
    category: z.enum(['DESIGN', 'IMPLEMENTATION', 'INTEGRATION', 'VERIFICATION', 'MIGRATION', 'CONTENT', 'OTHER']), area: small,
    status: z.enum(['PLANNED', 'AUTHORIZED', 'RUNNING', 'SUBMITTED', 'CONFIRMED', 'DONE', 'BLOCKED']), objective: text, designRevisionId: id.nullable() }).strict()),
  authorizations: arr(z.object({ ...base, taskId: id, featureId: id, status: z.enum(['ACTIVE', 'REVOKED', 'CONSUMED']), authorizedAt: date, revokedAt: date.nullable() }).strict()),
  specifications: arr(z.object({ ...base, featureId: id.nullable(), capabilityId: id.nullable(), kind: small, title: small,
    latestRevisionId: id.nullable(), latestRevisionNumber: num.positive().nullable(), approvedRevisionId: id.nullable(), approvedRevisionNumber: num.positive().nullable() }).strict()),
  reviews: arr(z.object({ ...base, specId: id, revisionId: id, status: z.enum(['PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED']),
    submittedAt: date, decidedAt: date.nullable(), decisionComment: text.nullable() }).strict()),
  engineeringAssets: arr(z.object({ ...edited, moduleId: id.nullable(), featureId: id.nullable(), capabilityId: id.nullable(), kind: small,
    name: small, code: small.nullable(), summary: text, structuredData: obj.nullable(), contentMarkdown: text.nullable(), status: small,
    currentRevisionId: id, currentRevisionNo: num.positive(), canonicalStatus: z.enum(['CONSISTENT', 'CONFLICT']), canonicalConflicts: strings }).strict()),
  traceLinks: arr(z.object({ ...base, sourceType: small, sourceId: id, targetType: small, targetId: id, relation: small }).strict()),
  runs: arr(z.object({ ...edited, featureId: id, taskId: id, authorizationId: id.nullable(), actorType: z.enum(['MANUAL', 'AI_TOKEN']), actorName: small,
    status: z.enum(['RUNNING', 'SUBMITTED', 'FAILED', 'ABORTED']), phase: z.enum(['PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING']),
    baseCommit: small.nullable(), resultCommit: small.nullable(), summary: text, changedFiles: arr(changedFile),
    verificationSummary: z.object({ status: reported, reportedStatus: reported, evidenceStatus: z.enum(['UNVERIFIED', 'REPORTED', 'CAPTURED', 'VERIFIED']),
      origin: z.enum(['AI_REPORTED', 'LOCAL_CAPTURED', 'CI', 'HUMAN']), summary: text }).strict().nullable(),
    designSnapshot: z.object({ specifications: arr(z.object({ specId: id, revisionId: id, revisionNo: num.positive() }).strict()),
      engineeringAssets: arr(z.object({ assetId: id, revisionId: id, revisionNo: num.positive() }).strict()) }).strict(),
    sourceExecutions: arr(z.object({ sourceId: id,
      baseline: z.object({ kind: small, commit: small.nullable(), dirty: z.boolean().nullable(), manifestHash: small.nullable() }).strict(),
      result: z.object({ commit: small.nullable(), workingTreeSummary: text.nullable() }).strict(), read: z.boolean(), modified: z.boolean(),
      changedFiles: arr(z.object({ sourceId: id, relativePath: small }).strict()), verification: arr(z.object({ command: text, workdir: small, reportedStatus: reported, summary: text }).strict()) }).strict()),
    designSnapshotJson: text.optional(), sourceExecutionsJson: text.optional(),
    designSnapshotStatus: z.enum(['CURRENT', 'STALE', 'UNKNOWN']), designSnapshotWarnings: strings, issues: strings,
    startedAt: date, submittedAt: date.nullable(), finishedAt: date.nullable() }).strict()),
}).strict();
const archiveSchema = z.object({ format: z.literal('forgeflow-project-archive'), formatVersion: z.literal(1), exportedAt: date,
  project: projectSchema, engineeringAssetRevisions: arr(revisionSchema),
  specificationRevisions: arr(z.object({ id, specId: id, revisionNo: num.positive(), content: text, contentHash: small, source: small, changeSummary: text, createdAt: date }).strict()),
  documents: arr(z.object({ ...edited, title: small, originalFilename: small.nullable(), sourcePath: small.nullable(),
    contentType: z.enum(['text/markdown', 'text/plain']), currentRevisionId: id, content: text, revisions: arr(revisionSchema) }).strict()),
  events: arr(z.object({ id, sequence: num.positive(), projectId: id, workId: id, type: z.enum(['PLAN', 'PROGRESS', 'DESIGN', 'RESULT', 'NOTE']),
    title: small, content: text, source: z.object({ kind: z.enum(['owner', 'local_web', 'ai_token']), name: small }).strict(),
    occurredAt: date, receivedAt: date, documentRevisionIds: arr(id) }).strict()),
}).strict();

function invalid(message: string): never { throw new ApiError(400, 'INVALID_ARCHIVE', message); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function digest(value: unknown) { return createHash('sha256').update(stableJson(value)).digest('hex'); }
function textHash(value: string) { return createHash('sha256').update(value).digest('hex'); }

export function validateArchive(input: unknown): ProjectArchiveExport {
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(input)); } catch { return invalid('存档不是有效 JSON'); }
  if (bytes > 32 * 1024 * 1024) throw new ApiError(413, 'ARCHIVE_TOO_LARGE', '存档不能超过 32 MiB');
  let parsed: ReturnType<typeof archiveSchema.safeParse>;
  try { parsed = archiveSchema.safeParse(input); } catch { return invalid('存档结构嵌套过深或格式无效'); }
  if (!parsed.success) return invalid(parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  for (const run of parsed.data.project.runs) {
    for (const [raw, value] of [[run.designSnapshotJson, run.designSnapshot], [run.sourceExecutionsJson, run.sourceExecutions]] as const) {
      if (raw !== undefined) {
        try { if (digest(JSON.parse(raw)) !== digest(value)) invalid('运行快照 JSON 副本不一致'); }
        catch { invalid('运行快照 JSON 副本无效'); }
      }
    }
    delete run.designSnapshotJson; delete run.sourceExecutionsJson;
  }
  const a = parsed.data as ProjectArchiveExport;
  const p = a.project;
  const unique = (rows: Array<object>, fields: string[]) => {
    const keys = rows.map((row)=>JSON.stringify(fields.map((key)=>(row as Record<string,unknown>)[key])));
    if (new Set(keys).size !== keys.length) invalid(`重复唯一字段: ${fields.join(', ')}`);
  };
  unique(p.modules,['code']); unique(p.features,['code']); unique(p.capabilities,['featureId','code']); unique(p.tasks,['featureId','code']);
  unique(p.sources,['alias']); unique(a.engineeringAssetRevisions,['assetId','revisionNo']); unique(a.specificationRevisions,['specId','revisionNo']);
  unique(p.authorizations.filter((r)=>r.status==='ACTIVE'),['taskId']); unique(p.runs.filter((r)=>r.status==='RUNNING'),['taskId']);
  unique(p.reviews.filter((r)=>r.status==='PENDING'),['specId']);
  unique(p.specifications.filter((r)=>r.capabilityId!==null),['capabilityId']);
  unique(p.specifications.filter((r)=>r.capabilityId===null && r.featureId!==null),['featureId']);
  unique(p.specifications.filter((r)=>r.capabilityId===null && r.featureId===null),['kind']);
  unique(p.engineeringAssets.filter((r)=>r.featureId!==null),['featureId','kind','name']);
  unique(p.traceLinks,['sourceType','sourceId','targetType','targetId','relation']);
  for (const row of p.authorizations) if ((row.status==='REVOKED') !== (row.revokedAt!==null)) invalid('授权状态与撤销时间不一致');
  for (const row of p.reviews) if ((row.status==='PENDING') !== (row.decidedAt===null)) invalid('评审状态与决定时间不一致');
  for (const row of a.specificationRevisions) if (row.contentHash!==textHash(row.content)) invalid('设计历史内容校验不一致');
  for (const row of a.engineeringAssetRevisions) if (row.contentHash!==textHash(`${stableJson(row.structuredData)}\n${row.contentMarkdown??''}`)) invalid('文档历史内容校验不一致');
  const all = [p.project, ...Object.values(p).filter(Array.isArray).flat(), ...a.engineeringAssetRevisions, ...a.specificationRevisions, ...a.events];
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of all) {
    if (byId.has(row.id)) invalid(`重复标识: ${row.id}`);
    byId.set(row.id, row as unknown as Record<string, unknown>);
    if ('projectId' in row && row.projectId !== p.project.id) invalid('包含其他项目的数据');
  }
  const groups: Record<string, Set<string>> = Object.fromEntries(Object.entries(p).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, new Set((v as Array<{id:string}>).map((r) => r.id))]));
  groups.specificationRevisions = new Set(a.specificationRevisions.map((r) => r.id));
  groups.engineeringAssetRevisions = new Set(a.engineeringAssetRevisions.map((r) => r.id));
  groups.events = new Set(a.events.map((r) => r.id));
  const ref = (value: string | null | undefined, group: string) => { if (value != null && !groups[group]?.has(value)) invalid(`无效 ${group} 关联: ${value}`); };
  const check = (rows: Array<object>, fields: Record<string, string>) => rows.forEach((row) => Object.entries(fields).forEach(([field, group]) => ref((row as Record<string,string>)[field], group)));
  check(p.features, {moduleId:'modules'}); check(p.capabilities, {moduleId:'modules', featureId:'features'});
  check(p.tasks, {featureId:'features',capabilityId:'capabilities',designRevisionId:'specificationRevisions'});
  check(p.authorizations, {featureId:'features', taskId:'tasks'});
  check(p.runs, {featureId:'features',taskId:'tasks',authorizationId:'authorizations'});
  check(p.specifications, {featureId:'features',capabilityId:'capabilities',latestRevisionId:'specificationRevisions',approvedRevisionId:'specificationRevisions'});
  check(p.reviews, {specId:'specifications',revisionId:'specificationRevisions'});
  check(p.engineeringAssets, {moduleId:'modules',featureId:'features',capabilityId:'capabilities',currentRevisionId:'engineeringAssetRevisions'});
  check(a.engineeringAssetRevisions, {assetId:'engineeringAssets'}); check(a.specificationRevisions, {specId:'specifications'});
  const belongs = (childId: string | null | undefined, field: string, parentId: string | null | undefined) => {
    if (childId && parentId && byId.get(childId)?.[field] !== parentId) invalid(`关联层级不一致: ${childId}`);
  };
  for (const row of [...p.capabilities, ...p.engineeringAssets]) belongs(row.featureId, 'moduleId', row.moduleId);
  for (const row of [...p.engineeringAssets, ...p.tasks, ...p.specifications]) {
    if (row.capabilityId && !row.featureId) invalid('能力关联缺少所属功能');
    belongs(row.capabilityId, 'featureId', row.featureId);
  }
  for (const row of [...p.authorizations, ...p.runs]) belongs(row.taskId, 'featureId', row.featureId);
  for (const row of p.runs) belongs(row.authorizationId, 'taskId', row.taskId);
  for (const row of p.specifications) { belongs(row.latestRevisionId, 'specId', row.id); belongs(row.approvedRevisionId, 'specId', row.id); }
  for (const row of p.specifications) for (const state of ['latest','approved'] as const) {
    const revision = row[`${state}RevisionId`] ? byId.get(row[`${state}RevisionId`]!) : undefined;
    if ((revision?.revisionNo??null)!==row[`${state}RevisionNumber`]) invalid('设计版本号与历史不一致');
  }
  for (const row of p.engineeringAssets) {
    belongs(row.currentRevisionId, 'assetId', row.id);
    const revision=byId.get(row.currentRevisionId)!;
    if (revision.revisionNo!==row.currentRevisionNo || revision.contentMarkdown!==row.contentMarkdown || digest(revision.structuredData)!==digest(row.structuredData)) invalid('文档当前内容与历史不一致');
  }
  for (const row of p.reviews) belongs(row.revisionId, 'specId', row.specId);
  for (const row of p.sourceAnalyses) {
    row.requestedSourceIds.forEach((v) => ref(v, 'sources')); ref(row.targetScope.featureId, 'features'); ref(row.targetScope.capabilityId, 'capabilities');
    belongs(row.targetScope.capabilityId, 'featureId', row.targetScope.featureId);
    row.sources.forEach((s) => { ref(s.id, 'sources'); if (s.projectId !== p.project.id) invalid('分析来源属于其他项目'); });
  }
  const traceGroups: Record<string,string> = { PROJECT:'project', MODULE:'modules', FEATURE:'features', CAPABILITY:'capabilities', TASK:'tasks', SPECIFICATION:'specifications', SPEC:'specifications', SPEC_REVISION:'specificationRevisions', ENGINEERING_ASSET:'engineeringAssets', ENGINEERING_ASSET_REVISION:'engineeringAssetRevisions', AI_RUN:'runs', RUN:'runs', PROJECT_SOURCE:'sources', SOURCE:'sources' };
  for (const link of p.traceLinks) for (const side of ['source','target'] as const) {
    const group = traceGroups[link[`${side}Type`].toUpperCase()];
    if (group === 'project') { if (link[`${side}Id`] !== p.project.id) invalid('跨项目关联'); }
    else if (group) ref(link[`${side}Id`], group);
    else if (!byId.has(link[`${side}Id`])) invalid('关联节点不存在');
  }
  for (const run of p.runs) {
    for (const item of run.designSnapshot.specifications) {
      ref(item.specId,'specifications'); ref(item.revisionId,'specificationRevisions'); belongs(item.revisionId,'specId',item.specId);
      if (byId.get(item.revisionId)?.revisionNo!==item.revisionNo) invalid('运行引用设计版本号不一致');
    }
    for (const item of run.designSnapshot.engineeringAssets) {
      ref(item.assetId,'engineeringAssets'); ref(item.revisionId,'engineeringAssetRevisions'); belongs(item.revisionId,'assetId',item.assetId);
      if (byId.get(item.revisionId)?.revisionNo!==item.revisionNo) invalid('运行引用文档版本号不一致');
    }
    run.changedFiles.forEach((f) => { if (typeof f !== 'string') ref(f.sourceId, 'sources'); });
    run.sourceExecutions.forEach((s) => { ref(s.sourceId, 'sources'); s.changedFiles.forEach((f) => ref(f.sourceId,'sources')); });
  }
  const sequences = new Set<number>();
  for (const event of a.events) {
    ref(event.workId,'events'); const root = byId.get(event.workId)!;
    if (root.workId !== root.id) invalid('工作记录根节点无效');
    event.documentRevisionIds.forEach((v) => ref(v,'engineeringAssetRevisions'));
    if (sequences.has(event.sequence)) invalid('重复事件序号'); sequences.add(event.sequence);
  }
  const assets = p.engineeringAssets.filter((asset) => asset.kind === 'PROJECT_DOCUMENT');
  if (assets.length !== a.documents.length || new Set(a.documents.map((d) => d.id)).size !== a.documents.length) invalid('文档副本数量不一致');
  for (const doc of a.documents) {
    const asset = assets.find((v) => v.id === doc.id);
    if (!asset || doc.projectId !== p.project.id || asset.currentRevisionId !== doc.currentRevisionId || asset.contentMarkdown !== doc.content || asset.name !== doc.title) invalid('文档副本与工程存档不一致');
    if ((asset.structuredData?.sourcePath??null)!==doc.sourcePath || (asset.structuredData?.originalFilename??null)!==doc.originalFilename || (asset.structuredData?.contentType??'text/markdown')!==doc.contentType) invalid('文档来源信息副本不一致');
    const originals = a.engineeringAssetRevisions.filter((r) => r.assetId === doc.id).sort((x,y) => x.revisionNo-y.revisionNo);
    if (digest(originals) !== digest([...doc.revisions].sort((x,y) => x.revisionNo-y.revisionNo))) invalid('文档历史副本不一致');
  }
  return a;
}

export function previewArchive(input: unknown): ProjectArchivePreview {
  const a = validateArchive(input);
  return { digest: digest(a), sourceProject: { id: a.project.project.id, projectKey: a.project.project.projectKey, name: a.project.project.name },
    counts: { ...Object.fromEntries(Object.entries(a.project).filter(([,v]) => Array.isArray(v)).map(([k,v]) => [k,(v as unknown[]).length])),
      documents: a.documents.length, events: a.events.length, engineeringAssetRevisions: a.engineeringAssetRevisions.length, specificationRevisions: a.specificationRevisions.length },
    warnings: ['仅恢复为新项目；来源目录保留原路径，不读取或修改目录。', '历史运行与授权仅用于记录；恢复后不会启动 AI、任务或采集器。', '自由文本和自定义 JSON 原样保留，其中手写的旧链接不会自动改写。'] };
}

const tableNames: Record<string,string> = { sources:'rd_project_source', sourceAnalyses:'rd_source_analysis', modules:'rd_module', features:'rd_feature', capabilities:'rd_capability',
  tasks:'rd_task', authorizations:'rd_task_authorization', runs:'rd_ai_run', specifications:'rd_spec', reviews:'rd_design_review', engineeringAssets:'rd_engineering_asset', traceLinks:'rd_trace_link' };
const dateKeys = new Set(['createdAt','updatedAt','authorizedAt','revokedAt','submittedAt','decidedAt','requestedAt','startedAt','completedAt','finishedAt','occurredAt','receivedAt']);
const jsonColumns: Record<string,string> = { scope:'scope_json', locations:'locations_json', requestedSourceIds:'requested_source_ids_json', targetScope:'target_scope_json', sourceSnapshots:'source_snapshots_json', checkpoint:'checkpoint_json', errors:'errors_json', structuredData:'structured_data', changedFiles:'changed_files', verificationSummary:'verification_summary', designSnapshot:'design_snapshot_json', sourceExecutions:'source_executions_json', issues:'issues' };
const derived = new Set(['displayId','sources','recommendedFlow','exclusions','prompts','latestRevisionNumber','approvedRevisionNumber','currentRevisionNo','canonicalStatus','canonicalConflicts','designSnapshotStatus','designSnapshotWarnings']);
function insert(connection: Connection, table: string, row: Record<string,unknown>) {
  const entries = Object.entries(row).filter(([key]) => !derived.has(key)).map(([key,value]) => [jsonColumns[key] ?? key.replace(/[A-Z]/g,(c)=>`_${c.toLowerCase()}`),
    value === null ? null : dateKeys.has(key) ? new Date(value as string).getTime() : jsonColumns[key] ? JSON.stringify(value) : value] as const);
  connection.sqlite.prepare(`INSERT INTO ${table} (${entries.map(([key]) => `"${key}"`).join(',')}) VALUES (${entries.map(()=>'?').join(',')})`).run(...entries.map(([,v])=>v));
}

export function restoreArchive(connection: Connection, input: ProjectArchiveRestoreInput): string {
  const envelope = z.object({ archive:z.unknown(), projectKey:z.string().regex(/^[A-Z][A-Z0-9_-]{0,39}$/), name:z.string().trim().min(1).max(200), expectedDigest:z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(input);
  if (!envelope.success) invalid('请输入新项目标识、名称和预览校验值');
  const a = validateArchive(envelope.data.archive);
  if (digest(a) !== envelope.data.expectedDigest) throw new ApiError(409,'ARCHIVE_CHANGED','存档与预览不一致，请重新预览');
  const mapping = new Map<string,string>();
  for (const row of [a.project.project, ...Object.values(a.project).filter(Array.isArray).flat(), ...a.engineeringAssetRevisions,...a.specificationRevisions,...a.events]) mapping.set(row.id,randomUUID());
  const map = (value: string) => mapping.get(value) ?? value;
  const refKeys = new Set(['id','projectId','moduleId','featureId','capabilityId','taskId','authorizationId','specId','assetId','revisionId','designRevisionId','currentRevisionId','latestRevisionId','approvedRevisionId','sourceId','targetId','workId']);
  const remap = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') return refKeys.has(key) || ['requestedSourceIds','documentRevisionIds'].includes(key) ? map(value) : value;
    if (Array.isArray(value)) return value.map((v)=>remap(v,key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k, ['structuredData','sourceSnapshots','checkpoint','errors','analysisScope'].includes(k) ? v : remap(v,k)]));
    return value;
  };
  const restored = remap(a) as ProjectArchiveExport;
  const p = restored.project;
  p.project.projectKey = envelope.data.projectKey; p.project.name = envelope.data.name;
  for (const source of p.sources) source.locations = source.locations.map((location)=>({...location,normalizedLocalRoot:normalizeLocalRoot(location.localRoot)}));
  connection.sqlite.transaction(() => {
    if (connection.sqlite.prepare('SELECT 1 FROM rd_project WHERE project_key = ?').get(p.project.projectKey)) throw new ApiError(409,'PROJECT_KEY_EXISTS','新项目标识已存在');
    connection.sqlite.pragma('defer_foreign_keys = ON');
    insert(connection,'rd_project',p.project);
    for (const group of ['sources','modules','features','capabilities','specifications','engineeringAssets','tasks','authorizations','runs','reviews','sourceAnalyses','traceLinks'] as const) {
      for (const row of p[group]) insert(connection,tableNames[group]!,{...row,...(group === 'sources' ? {lastIdempotencyKey:`restored-${row.id}`} : {})});
    }
    for (const row of restored.specificationRevisions) { const {content,...rest}=row; insert(connection,'rd_spec_revision',{...rest,markdown:content}); }
    for (const row of restored.engineeringAssetRevisions) insert(connection,'rd_engineering_asset_revision',row);
    for (const event of [...restored.events].sort((x,y)=>x.sequence-y.sequence)) {
      insert(connection,'rd_work_event',{id:event.id,projectId:event.projectId,workId:event.workId,principalKey:`archive:${p.project.id}`,
        operationId:`restored-${event.id}`,payloadHash:digest(event),type:event.type,title:event.title,content:event.content,
        sourceKind:event.source.kind,sourceName:event.source.name,documentRevisionIdsJson:JSON.stringify(event.documentRevisionIds),occurredAt:event.occurredAt,receivedAt:event.receivedAt});
    }
    if ((connection.sqlite.pragma('foreign_key_check') as unknown[]).length) invalid('恢复后存在无效关联');
  }).immediate();
  return p.project.id;
}
