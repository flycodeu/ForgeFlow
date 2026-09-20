import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import * as schema from './schema.js';

const defaultDatabasePath = fileURLToPath(new URL('../../../../data/forgeflow.db', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
const legacyUpgradePath = fileURLToPath(new URL('../../../../migrations/legacy/pre-baseline-upgrade.sql', import.meta.url));
const lastPublicPreBaselineMigration = 1789790350672;

type SqliteDatabase = Database.Database;

function tableExists(sqlite: SqliteDatabase, tableName: string): boolean {
  return Boolean(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function columnExists(sqlite: SqliteDatabase, tableName: string, columnName: string): boolean {
  if (!tableExists(sqlite, tableName)) return false;
  return (sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .some((column) => column.name === columnName);
}

function hasBaselineSchema(sqlite: SqliteDatabase): boolean {
  return tableExists(sqlite, 'rd_capability')
    && tableExists(sqlite, 'rd_engineering_asset_revision')
    && tableExists(sqlite, 'rd_project_source')
    && columnExists(sqlite, 'rd_project', 'workflow_mode')
    && columnExists(sqlite, 'rd_ai_run', 'design_snapshot_json');
}

function registerBaseline(sqlite: SqliteDatabase, hash: string, timestamp: number): void {
  sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(hash, timestamp);
}

function preparePreBaselineDatabase(sqlite: SqliteDatabase): void {
  if (!tableExists(sqlite, '__drizzle_migrations')) return;

  const [baseline] = readMigrationFiles({ migrationsFolder });
  if (!baseline) throw new Error('ForgeFlow baseline migration is missing.');

  const lastMigration = sqlite.prepare(
    'SELECT created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1',
  ).get() as { createdAt: number } | undefined;
  if (!lastMigration || lastMigration.createdAt >= baseline.folderMillis) return;

  if (hasBaselineSchema(sqlite)) {
    registerBaseline(sqlite, baseline.hash, baseline.folderMillis);
    return;
  }

  if (lastMigration.createdAt < lastPublicPreBaselineMigration) {
    throw new Error(
      'This database predates the supported ForgeFlow pre-release schema. '
      + 'Start the previous version once to apply its migrations, then upgrade again.',
    );
  }

  const legacySql = readFileSync(legacyUpgradePath, 'utf8');
  const upgradeBlocks = [...legacySql.matchAll(
    /-- forgeflow-legacy-step:(\d+)\s*([\s\S]*?)(?=-- forgeflow-legacy-step:|$)/g,
  )]
    .map((match) => ({ timestamp: Number(match[1]), sql: match[2] ?? '' }))
    .filter((block) => block.timestamp > lastMigration.createdAt);

  if (upgradeBlocks.length === 0) {
    throw new Error('No compatible pre-baseline database upgrade was found.');
  }

  sqlite.exec('BEGIN');
  try {
    for (const block of upgradeBlocks) {
      const statements = block.sql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) sqlite.exec(statement);
    }
    registerBaseline(sqlite, baseline.hash, baseline.folderMillis);
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function openDatabase(databasePath = process.env.FORGEFLOW_DB_PATH ?? defaultDatabasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);

  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');
    sqlite.function('forgeflow_engineering_hash', { deterministic: true }, (structuredData: string | null, contentMarkdown: string | null) => {
      let structured: unknown = null;
      if (structuredData) {
        try { structured = JSON.parse(structuredData); } catch { structured = structuredData; }
      }
      return createHash('sha256').update(`${stableJson(structured)}\n${contentMarkdown ?? ''}`, 'utf8').digest('hex');
    });

    preparePreBaselineDatabase(sqlite);
    const db = drizzle({ client: sqlite, schema });
    migrate(db, { migrationsFolder });
    return { sqlite, db };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
