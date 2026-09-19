import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import DatabaseDriver from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createApp } from '../app.js';
import { openDatabase } from './client.js';

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-s1t02-'));
  return {
    path: join(directory, 'forgeflow.db'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function migrationCount(sqlite: Database.Database) {
  return (sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as { count: number }).count;
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
    '__drizzle_migrations', 'rd_ai_token', 'rd_feature', 'rd_module', 'rd_owner', 'rd_owner_session', 'rd_project', 'rd_spec', 'rd_spec_revision',
  ]);
  assert.equal(migrationCount(first.sqlite), 4);
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
  assert.equal(migrationCount(second.sqlite), 4);
  assert.equal((second.sqlite.prepare('SELECT count(*) AS count FROM rd_spec_revision').get() as { count: number }).count, 1);
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

test('database initialization errors stop app creation', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-s1t02-invalid-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => createApp(directory));
});

test('migration upgrades S1-T02 revisions and backfills the latest pointer', (t) => {
  const fixture = temporaryDatabase();
  const migrationsFolder = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
  const legacyFolder = join(fixture.path, '..', 'legacy-migrations');
  mkdirSync(join(legacyFolder, 'meta'), { recursive: true });
  copyFileSync(join(migrationsFolder, '0000_clever_raza.sql'), join(legacyFolder, '0000_clever_raza.sql'));
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(join(legacyFolder, 'meta', '_journal.json'), JSON.stringify(journal));

  const legacy = new DatabaseDriver(fixture.path);
  let upgraded: ReturnType<typeof openDatabase> | undefined;
  t.after(() => {
    if (legacy.open) legacy.close();
    if (upgraded?.sqlite.open) upgraded.sqlite.close();
    fixture.cleanup();
  });
  legacy.pragma('foreign_keys = ON');
  migrate(drizzle({ client: legacy }), { migrationsFolder: legacyFolder });
  const now = Date.now();
  legacy.prepare('INSERT INTO rd_project (id, project_key, name, created_at) VALUES (?, ?, ?, ?)')
    .run('p1', 'P1', 'Old Project', now);
  legacy.prepare('INSERT INTO rd_spec (id, project_id, kind, title, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('s1', 'p1', 'requirements', 'Old Spec', now);
  const insert = legacy.prepare('INSERT INTO rd_spec_revision (id, spec_id, revision_no, markdown, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('r1', 's1', 1, '# Original', 'hash1', now);
  insert.run('r2', 's1', 2, '# Updated', 'hash2', now);
  legacy.close();

  upgraded = openDatabase(fixture.path);
  assert.equal(migrationCount(upgraded.sqlite), 4);
  assert.equal((upgraded.sqlite.prepare('SELECT latest_revision_id AS id FROM rd_spec WHERE id = ?').get('s1') as { id: string }).id, 'r2');
  assert.deepEqual(upgraded.sqlite.prepare('SELECT markdown, source, change_summary AS summary FROM rd_spec_revision WHERE id = ?').get('r1'), {
    markdown: '# Original', source: 'unknown', summary: '未记录（旧版）',
  });
  assert.equal((upgraded.sqlite.prepare('SELECT feature_id AS featureId FROM rd_spec WHERE id = ?').get('s1') as { featureId: string | null }).featureId, null);
});
