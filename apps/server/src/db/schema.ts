import { check, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable('rd_project', {
  id: text('id').primaryKey(),
  projectKey: text('project_key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  projectType: text('project_type').notNull().default('GENERAL'),
  workflowMode: text('workflow_mode').notNull().default('AUTO'),
  designProfile: text('design_profile').notNull().default('generic'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const projectSources = sqliteTable('rd_project_source', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  alias: text('alias').notNull(),
  displayName: text('display_name').notNull(),
  purpose: text('purpose').notNull().default(''),
  sourceKind: text('source_kind').notNull(),
  remoteUrl: text('remote_url'),
  repoSubdir: text('repo_subdir'),
  scopeJson: text('scope_json'),
  locationsJson: text('locations_json').notNull(),
  status: text('status').notNull().default('REGISTERED'),
  lastIdempotencyKey: text('last_idempotency_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_project_source_project_alias_unique').on(table.projectId, table.alias),
  uniqueIndex('rd_project_source_idempotency_unique').on(table.projectId, table.lastIdempotencyKey),
]);

export const sourceAnalyses = sqliteTable('rd_source_analysis', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  requestedSourceIdsJson: text('requested_source_ids_json').notNull(),
  targetScopeJson: text('target_scope_json').notNull(),
  environmentKey: text('environment_key').notNull(),
  status: text('status').notNull().default('WAITING_AI'),
  sourceSnapshotsJson: text('source_snapshots_json'),
  checkpointJson: text('checkpoint_json'),
  summary: text('summary'),
  errorsJson: text('errors_json'),
  requestedAt: integer('requested_at', { mode: 'timestamp_ms' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  check('rd_source_analysis_status_allowed', sql`${table.status} in ('WAITING_AI', 'READING', 'PARTIAL', 'SYNCED', 'FAILED', 'STALE')`),
]);

export const modules = sqliteTable('rd_module', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_module_project_code_unique').on(table.projectId, table.code),
  check('rd_module_sort_order_non_negative', sql`${table.sortOrder} >= 0`),
]);

export const features = sqliteTable('rd_feature', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  summary: text('summary').notNull().default(''),
  status: text('status').notNull().default('DRAFT'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_feature_project_code_unique').on(table.projectId, table.code),
  check('rd_feature_sort_order_non_negative', sql`${table.sortOrder} >= 0`),
  check('rd_feature_status_allowed', sql`${table.status} in ('DRAFT', 'DESIGNING', 'READY', 'IMPLEMENTING', 'VERIFYING', 'ACCEPTANCE_PENDING', 'ACCEPTED', 'DELIVERED')`),
]);

export const capabilities = sqliteTable('rd_capability', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  moduleId: text('module_id').notNull().references(() => modules.id, { onDelete: 'restrict' }),
  featureId: text('feature_id').notNull().references(() => features.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  summary: text('summary').notNull().default(''),
  status: text('status').notNull().default('DRAFT'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_capability_feature_code_unique').on(table.featureId, table.code),
  check('rd_capability_sort_order_non_negative', sql`${table.sortOrder} >= 0`),
  check('rd_capability_status_allowed', sql`${table.status} in ('DRAFT', 'DESIGNED', 'IMPLEMENTING', 'TESTING', 'DONE', 'BLOCKED')`),
]);

export const engineeringAssets = sqliteTable('rd_engineering_asset', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  moduleId: text('module_id').references(() => modules.id, { onDelete: 'restrict' }),
  featureId: text('feature_id').references(() => features.id, { onDelete: 'restrict' }),
  capabilityId: text('capability_id').references(() => capabilities.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  code: text('code'),
  summary: text('summary').notNull().default(''),
  structuredData: text('structured_data'),
  contentMarkdown: text('content_markdown'),
  status: text('status').notNull().default('DRAFT'),
  currentRevisionId: text('current_revision_id').references((): AnySQLiteColumn => engineeringAssetRevisions.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_engineering_asset_feature_kind_name_unique').on(table.featureId, table.kind, table.name),
]);

export const engineeringAssetRevisions = sqliteTable('rd_engineering_asset_revision', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull().references(() => engineeringAssets.id, { onDelete: 'restrict' }),
  revisionNo: integer('revision_no').notNull(),
  structuredData: text('structured_data'),
  contentMarkdown: text('content_markdown'),
  contentHash: text('content_hash').notNull(),
  source: text('source').notNull().default('unknown'),
  changeSummary: text('change_summary').notNull().default('未记录（旧版）'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_engineering_asset_revision_asset_no_unique').on(table.assetId, table.revisionNo),
  check('rd_engineering_asset_revision_no_positive', sql`${table.revisionNo} > 0`),
]);

export const traceLinks = sqliteTable('rd_trace_link', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  relation: text('relation').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_trace_link_unique').on(table.projectId, table.sourceType, table.sourceId, table.targetType, table.targetId, table.relation),
]);

export const tasks = sqliteTable('rd_task', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  featureId: text('feature_id').notNull().references(() => features.id, { onDelete: 'restrict' }),
  capabilityId: text('capability_id').references(() => capabilities.id, { onDelete: 'restrict' }),
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull().default('OTHER'),
  category: text('category').notNull().default('OTHER'),
  area: text('area').notNull().default(''),
  status: text('status').notNull().default('PLANNED'),
  objective: text('objective').notNull().default(''),
  designRevisionId: text('design_revision_id').references((): AnySQLiteColumn => specificationRevisions.id, { onDelete: 'restrict' }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_task_feature_code_unique').on(table.featureId, table.code),
  check('rd_task_sort_order_non_negative', sql`${table.sortOrder} >= 0`),
  check('rd_task_type_allowed', sql`${table.type} in ('DESIGN', 'BACKEND', 'FRONTEND', 'INTEGRATION', 'VERIFICATION', 'OTHER')`),
  check('rd_task_status_allowed', sql`${table.status} in ('PLANNED', 'AUTHORIZED', 'RUNNING', 'SUBMITTED', 'CONFIRMED', 'DONE', 'BLOCKED')`),
]);

export const taskAuthorizations = sqliteTable('rd_task_authorization', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'restrict' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  featureId: text('feature_id').notNull().references(() => features.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('ACTIVE'),
  authorizedAt: integer('authorized_at', { mode: 'timestamp_ms' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_task_authorization_active_unique').on(table.taskId).where(sql`${table.status} = 'ACTIVE'`),
  check('rd_task_authorization_status_allowed', sql`${table.status} in ('ACTIVE', 'REVOKED', 'CONSUMED')`),
  check('rd_task_authorization_revoked_time', sql`(${table.status} = 'REVOKED' and ${table.revokedAt} is not null) or (${table.status} != 'REVOKED' and ${table.revokedAt} is null)`),
]);

export const aiRuns = sqliteTable('rd_ai_run', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  featureId: text('feature_id').notNull().references(() => features.id, { onDelete: 'restrict' }),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'restrict' }),
  authorizationId: text('authorization_id').references(() => taskAuthorizations.id, { onDelete: 'restrict' }),
  actorType: text('actor_type').notNull(),
  actorName: text('actor_name').notNull(),
  status: text('status').notNull().default('RUNNING'),
  phase: text('phase').notNull().default('PREPARING'),
  baseCommit: text('base_commit'),
  resultCommit: text('result_commit'),
  summary: text('summary').notNull().default(''),
  changedFiles: text('changed_files').notNull().default('[]'),
  verificationSummary: text('verification_summary'),
  designSnapshotJson: text('design_snapshot_json').notNull().default('{"specifications":[],"engineeringAssets":[]}'),
  sourceExecutionsJson: text('source_executions_json').notNull().default('[]'),
  issues: text('issues').notNull().default('[]'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_ai_run_running_task_unique').on(table.taskId).where(sql`${table.status} = 'RUNNING'`),
  check('rd_ai_run_actor_type_allowed', sql`${table.actorType} in ('MANUAL', 'AI_TOKEN')`),
  check('rd_ai_run_status_allowed', sql`${table.status} in ('RUNNING', 'SUBMITTED', 'FAILED', 'ABORTED')`),
  check('rd_ai_run_phase_allowed', sql`${table.phase} in ('PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING')`),
]);

export const specifications = sqliteTable('rd_spec', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  featureId: text('feature_id').references(() => features.id, { onDelete: 'restrict' }),
  capabilityId: text('capability_id').references(() => capabilities.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  latestRevisionId: text('latest_revision_id').references((): AnySQLiteColumn => specificationRevisions.id, { onDelete: 'restrict' }),
  approvedRevisionId: text('approved_revision_id').references((): AnySQLiteColumn => specificationRevisions.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_spec_feature_unique').on(table.featureId).where(sql`${table.featureId} is not null and ${table.capabilityId} is null`),
  uniqueIndex('rd_spec_capability_unique').on(table.capabilityId).where(sql`${table.capabilityId} is not null`),
  uniqueIndex('rd_spec_project_kind_unique').on(table.projectId, table.kind).where(sql`${table.featureId} is null and ${table.capabilityId} is null`),
]);

export const specificationRevisions = sqliteTable('rd_spec_revision', {
  id: text('id').primaryKey(),
  specId: text('spec_id').notNull().references(() => specifications.id, { onDelete: 'restrict' }),
  revisionNo: integer('revision_no').notNull(),
  markdown: text('markdown').notNull(),
  contentHash: text('content_hash').notNull(),
  source: text('source').notNull().default('unknown'),
  changeSummary: text('change_summary').notNull().default('未记录（旧版）'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_spec_revision_spec_no_unique').on(table.specId, table.revisionNo),
  check('rd_spec_revision_no_positive', sql`${table.revisionNo} > 0`),
]);

export const designReviews = sqliteTable('rd_design_review', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  specId: text('spec_id').notNull().references(() => specifications.id, { onDelete: 'restrict' }),
  revisionId: text('revision_id').notNull().references(() => specificationRevisions.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('PENDING'),
  submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }).notNull(),
  decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  decisionComment: text('decision_comment'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('rd_design_review_revision_pending_unique').on(table.revisionId).where(sql`${table.status} = 'PENDING'`),
  uniqueIndex('rd_design_review_spec_pending_unique').on(table.specId).where(sql`${table.status} = 'PENDING'`),
  check('rd_design_review_status_allowed', sql`${table.status} in ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED')`),
  check('rd_design_review_decision_time', sql`(${table.status} = 'PENDING' and ${table.decidedAt} is null) or (${table.status} != 'PENDING' and ${table.decidedAt} is not null)`),
]);

export const owner = sqliteTable('rd_owner', {
  id: integer('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [check('rd_owner_singleton', sql`${table.id} = 1`)]);

export const ownerSessions = sqliteTable('rd_owner_session', {
  sessionHash: text('session_hash').primaryKey(),
  ownerId: integer('owner_id').notNull().references(() => owner.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});

export const aiTokens = sqliteTable('rd_ai_token', {
  id: text('id').primaryKey(),
  ownerId: integer('owner_id').notNull().references(() => owner.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  scopes: text('scopes').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
});
