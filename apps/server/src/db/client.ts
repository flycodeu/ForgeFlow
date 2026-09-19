import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

const defaultDatabasePath = fileURLToPath(new URL('../../../../data/forgeflow.db', import.meta.url));
const migrationsFolder = fileURLToPath(new URL('../../../../migrations/', import.meta.url));

export function openDatabase(databasePath = process.env.FORGEFLOW_DB_PATH ?? defaultDatabasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);

  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('busy_timeout = 5000');

    const db = drizzle({ client: sqlite, schema });
    migrate(db, { migrationsFolder });
    return { sqlite, db };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
