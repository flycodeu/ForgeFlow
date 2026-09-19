import { check, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable('rd_project', {
  id: text('id').primaryKey(),
  projectKey: text('project_key').notNull().unique(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

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

export const specifications = sqliteTable('rd_spec', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'restrict' }),
  featureId: text('feature_id').references(() => features.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  latestRevisionId: text('latest_revision_id').references((): AnySQLiteColumn => specificationRevisions.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [uniqueIndex('rd_spec_feature_unique').on(table.featureId)]);

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
