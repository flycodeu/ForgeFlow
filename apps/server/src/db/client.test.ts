import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import DatabaseDriver from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { createApp } from '../app.js';
import { openDatabase } from './client.js';

const preBaselineFixture = fileURLToPath(new URL('./test-fixtures/pre-baseline-v0.1.sql', import.meta.url));
const preBaselineUpgrade = fileURLToPath(new URL('../../../../migrations/legacy/pre-baseline-upgrade.sql', import.meta.url));
const lastPublicPreBaselineMigration = 1789790350672;

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-database-'));
  return {
    path: join(directory, 'forgeflow.db'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function migrationCount(sqlite: Database.Database) {
  return (sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as { count: number }).count;
}

function applyStatements(sqlite: Database.Database, sql: string) {
  for (const statement of sql.split('--> statement-breakpoint').map((item) => item.trim()).filter(Boolean)) {
    sqlite.exec(statement);
  }
}

function createPreBaselineDatabase(sqlite: Database.Database, throughTimestamp = lastPublicPreBaselineMigration) {
  applyStatements(sqlite, readFileSync(preBaselineFixture, 'utf8'));

  if (throughTimestamp > lastPublicPreBaselineMigration) {
    const upgradeSql = readFileSync(preBaselineUpgrade, 'utf8');
    const blocks = [...upgradeSql.matchAll(
      /-- forgeflow-legacy-step:(\d+)\s*([\s\S]*?)(?=-- forgeflow-legacy-step:|$)/g,
    )]
      .map((match) => ({ timestamp: Number(match[1]), sql: match[2] ?? '' }))
      .filter((block) => block.timestamp <= throughTimestamp);
    for (const block of blocks) applyStatements(sqlite, block.sql);
  }

  sqlite.exec('CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
  sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run('pre-baseline-fixture', throughTimestamp);
}

test('empty database migrates, enforces keys, and survives a second open', (t) => {
  const fixture = temporaryDatabase();
  const first = openDatabase(fixture.path);
  let second: ReturnType<typeof openDatabase> | undefined;
  t.after(() => {
    if (first.sqlite.open) first.sqlite.close();
    if (second?.sqlite.open) second.sqlite.close();
    fixture.cleanup();
  });

  const tables = first.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  assert.deepEqual(tables.map((row) => row.name), [
    '__drizzle_migrations', 'rd_ai_run', 'rd_ai_token', 'rd_capability', 'rd_design_review', 'rd_engineering_asset', 'rd_engineering_asset_revision', 'rd_feature', 'rd_module', 'rd_owner', 'rd_owner_session', 'rd_project',
    'rd_project_source', 'rd_source_analysis', 'rd_spec', 'rd_spec_revision', 'rd_task', 'rd_task_authorization', 'rd_trace_link',
  ]);
  assert.equal(migrationCount(first.sqlite), 1);
  assert.equal(first.sqlite.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(first.sqlite.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(first.sqlite.pragma('busy_timeout', { simple: true }), 5000);

  const now = Date.now();
  first.sqlite.prepare('INSERT INTO rd_project (id, project_key, name, created_at) VALUES (?, ?, ?, ?)')
    .run('project-1', 'P1', 'Example', now);
  assert.throws(() => first.sqlite.prepare('INSERT INTO rd_project (id, project_key, name, created_at) VALUES (?, ?, ?, ?)')
    .run('project-2', 'P1', 'Duplicate', now), /UNIQUE/);
  assert.throws(() => first.sqlite.prepare('INSERT INTO rd_spec (id, project_id, kind, title, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('spec-invalid', 'missing', 'requirements', 'Invalid', now), /FOREIGN KEY/);

  first.sqlite.prepare('INSERT INTO rd_module (id, project_id, code, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('module-1', 'project-1', 'IAM', 'Identity', '', 0, now, now);
  assert.throws(() => first.sqlite.prepare('INSERT INTO rd_module (id, project_id, code, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('module-2', 'project-1', 'IAM', 'Duplicate', '', 0, now, now), /UNIQUE/);
  first.sqlite.prepare('INSERT INTO rd_feature (id, project_id, module_id, code, name, summary, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('feature-1', 'project-1', 'module-1', 'USER', 'User management', '', 'DESIGNING', 0, now, now);
  assert.throws(() => first.sqlite.prepare('INSERT INTO rd_feature (id, project_id, module_id, code, name, summary, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('feature-2', 'project-1', 'module-1', 'INVALID', 'Invalid', '', 'BLOCKED', 0, now, now), /CHECK/);
  const insertTask = first.sqlite.prepare('INSERT INTO rd_task (id, project_id, feature_id, code, name, type, status, objective, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertTask.run('task-1', 'project-1', 'feature-1', 'T01', 'Backend', 'BACKEND', 'RUNNING', 'Build API', 0, now, now);
  assert.throws(() => insertTask.run('task-2', 'project-1', 'feature-1', 'T01', 'Duplicate', 'FRONTEND', 'PLANNED', '', 1, now, now), /UNIQUE/);
  assert.throws(() => insertTask.run('task-3', 'project-1', 'feature-1', 'T03', 'Invalid type', 'TEST', 'PLANNED', '', 2, now, now), /CHECK/);
  assert.throws(() => insertTask.run('task-4', 'project-1', 'feature-1', 'T04', 'Invalid status', 'OTHER', 'CANCELLED', '', 3, now, now), /CHECK/);
  const insertAuthorization = first.sqlite.prepare('INSERT INTO rd_task_authorization (id, task_id, project_id, feature_id, status, authorized_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertAuthorization.run('auth-1', 'task-1', 'project-1', 'feature-1', 'ACTIVE', now, now);
  assert.throws(() => insertAuthorization.run('auth-2', 'task-1', 'project-1', 'feature-1', 'ACTIVE', now, now), /UNIQUE/);
  assert.throws(() => insertAuthorization.run('auth-3', 'task-1', 'project-1', 'feature-1', 'REVOKED', now, now), /CHECK/);
  const insertRun = first.sqlite.prepare('INSERT INTO rd_ai_run (id, project_id, feature_id, task_id, authorization_id, actor_type, actor_name, status, phase, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  insertRun.run('run-1', 'project-1', 'feature-1', 'task-1', 'auth-1', 'MANUAL', 'manual-test', 'RUNNING', 'PREPARING', now, now, now);
  assert.throws(() => insertRun.run('run-2', 'project-1', 'feature-1', 'task-1', 'auth-1', 'MANUAL', 'manual-test', 'RUNNING', 'IMPLEMENTING', now, now, now), /UNIQUE/);
  assert.throws(() => insertRun.run('run-3', 'project-1', 'feature-1', 'task-1', 'auth-1', 'MANUAL', 'manual-test', 'RUNNING', 'DEPLOYING', now, now, now), /CHECK/);

  first.sqlite.prepare('INSERT INTO rd_spec (id, project_id, kind, title, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('spec-1', 'project-1', 'requirements', 'Requirements', now);
  const insertRevision = first.sqlite.prepare(
    'INSERT INTO rd_spec_revision (id, spec_id, revision_no, markdown, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insertRevision.run('revision-1', 'spec-1', 1, '# Initial', 'hash-1', now);
  assert.throws(() => insertRevision.run('revision-2', 'spec-1', 1, '# Duplicate', 'hash-2', now), /UNIQUE/);
  assert.throws(() => insertRevision.run('revision-3', 'spec-1', 0, '# Invalid', 'hash-3', now), /CHECK/);
  assert.throws(() => first.sqlite.prepare('UPDATE rd_spec_revision SET markdown = ? WHERE id = ?')
    .run('# Overwritten', 'revision-1'), /immutable/);
  assert.throws(() => first.sqlite.prepare('DELETE FROM rd_spec_revision WHERE id = ?')
    .run('revision-1'), /immutable/);
  first.sqlite.close();

  second = openDatabase(fixture.path);
  assert.equal(migrationCount(second.sqlite), 1);
  assert.equal((second.sqlite.prepare('SELECT count(*) AS count FROM rd_spec_revision').get() as { count: number }).count, 1);
  assert.equal((second.sqlite.prepare('SELECT status FROM rd_task WHERE id = ?').get('task-1') as { status: string }).status, 'RUNNING');
  assert.equal((second.sqlite.prepare('SELECT phase FROM rd_ai_run WHERE id = ?').get('run-1') as { phase: string }).phase, 'PREPARING');
});

test('health endpoint probes the migrated database', async (t) => {
  const fixture = temporaryDatabase();
  const app = createApp(fixture.path);
  t.after(async () => {
    await app.close();
    fixture.cleanup();
  });
  const response = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', service: 'forgeflow-server', database: 'ok' });
});

test('current pre-baseline database is registered without replaying the schema', (t) => {
  const fixture = temporaryDatabase();
  const initial = openDatabase(fixture.path);
  initial.sqlite.prepare('DELETE FROM __drizzle_migrations').run();
  initial.sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    .run('legacy-current-schema', 1789824280874);
  initial.sqlite.close();

  const reopened = openDatabase(fixture.path);
  t.after(() => {
    if (reopened.sqlite.open) reopened.sqlite.close();
    fixture.cleanup();
  });

  assert.equal(migrationCount(reopened.sqlite), 2);
  assert.equal((reopened.sqlite.prepare('SELECT count(*) AS count FROM rd_project').get() as { count: number }).count, 0);
});

test('database initialization errors stop app creation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-invalid-database-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => createApp(directory));
});

test('pre-baseline database upgrades without losing revision history', (t) => {
  const fixture = temporaryDatabase();
  const legacy = new DatabaseDriver(fixture.path);
  let upgraded: ReturnType<typeof openDatabase> | undefined;
  t.after(() => {
    if (legacy.open) legacy.close();
    if (upgraded?.sqlite.open) upgraded.sqlite.close();
    fixture.cleanup();
  });
  legacy.pragma('foreign_keys = ON');
  createPreBaselineDatabase(legacy);
  const now = Date.now();
  legacy.prepare('INSERT INTO rd_project (id, project_key, name, created_at) VALUES (?, ?, ?, ?)')
    .run('p1', 'P1', 'Old Project', now);
  legacy.prepare('INSERT INTO rd_spec (id, project_id, kind, title, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('s1', 'p1', 'requirements', 'Old Spec', now);
  const insert = legacy.prepare('INSERT INTO rd_spec_revision (id, spec_id, revision_no, markdown, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('r1', 's1', 1, '# Original', 'hash1', now);
  insert.run('r2', 's1', 2, '# Updated', 'hash2', now);
  legacy.prepare('UPDATE rd_spec SET latest_revision_id = ? WHERE id = ?').run('r2', 's1');
  legacy.close();

  upgraded = openDatabase(fixture.path);
  assert.equal(migrationCount(upgraded.sqlite), 2);
  assert.equal((upgraded.sqlite.prepare('SELECT latest_revision_id AS id FROM rd_spec WHERE id = ?').get('s1') as { id: string }).id, 'r2');
  assert.deepEqual(upgraded.sqlite.prepare('SELECT markdown, source, change_summary AS summary FROM rd_spec_revision WHERE id = ?').get('r1'), {
    markdown: '# Original', source: 'unknown', summary: '未记录（旧版）',
  });
  assert.equal((upgraded.sqlite.prepare('SELECT feature_id AS featureId FROM rd_spec WHERE id = ?').get('s1') as { featureId: string | null }).featureId, null);
});

test('migration preserves legacy EngineeringAsset content as immutable REV 1', (t) => {
  const fixture = temporaryDatabase();
  const legacy = new DatabaseDriver(fixture.path);
  let upgraded: ReturnType<typeof openDatabase> | undefined;
  t.after(() => {
    if (legacy.open) legacy.close();
    if (upgraded?.sqlite.open) upgraded.sqlite.close();
    fixture.cleanup();
  });
  legacy.pragma('foreign_keys = ON');
  createPreBaselineDatabase(legacy, 1789821950134);
  const now = Date.now();
  legacy.prepare('INSERT INTO rd_project (id, project_key, name, created_at) VALUES (?, ?, ?, ?)').run('p-asset', 'PA', 'Asset Project', now);
  legacy.prepare('INSERT INTO rd_module (id, project_id, code, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('m-asset', 'p-asset', 'CORE', 'Core', '', 0, now, now);
  legacy.prepare('INSERT INTO rd_feature (id, project_id, module_id, code, name, summary, status, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('f-asset', 'p-asset', 'm-asset', 'USER', 'User', '', 'DESIGNING', 0, now, now);
  legacy.prepare('INSERT INTO rd_engineering_asset (id, project_id, module_id, feature_id, kind, name, summary, structured_data, content_markdown, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('asset-1', 'p-asset', 'm-asset', 'f-asset', 'INTERFACE', 'POST /users', '', '{"method":"POST","path":"/users"}', '# 说明\n事务创建用户', 'DESIGNED', now, now);
  legacy.close();

  upgraded = openDatabase(fixture.path);
  const asset = upgraded.sqlite.prepare('SELECT current_revision_id AS revisionId FROM rd_engineering_asset WHERE id = ?').get('asset-1') as { revisionId: string };
  const revision = upgraded.sqlite.prepare('SELECT asset_id AS assetId, revision_no AS revisionNo, structured_data AS structuredData, content_markdown AS contentMarkdown, content_hash AS contentHash FROM rd_engineering_asset_revision WHERE id = ?').get(asset.revisionId) as Record<string, unknown>;
  assert.deepEqual({ ...revision, contentHash: undefined }, { assetId: 'asset-1', revisionNo: 1, structuredData: '{"method":"POST","path":"/users"}', contentMarkdown: '# 说明\n事务创建用户', contentHash: undefined });
  assert.match(String(revision.contentHash), /^[0-9a-f]{64}$/);
  assert.throws(() => upgraded!.sqlite.prepare('UPDATE rd_engineering_asset_revision SET content_markdown = ? WHERE id = ?').run('changed', asset.revisionId), /immutable/);
  assert.throws(() => upgraded!.sqlite.prepare('DELETE FROM rd_engineering_asset_revision WHERE id = ?').run(asset.revisionId), /immutable/);
});
