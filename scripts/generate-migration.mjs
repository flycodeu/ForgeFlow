import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, ...extraArgs] = process.argv.slice(2).filter((argument) => argument !== '--');

if (!name || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name) || extraArgs.length > 0) {
  console.error('Usage: pnpm db:generate <descriptive_name>');
  console.error('Example: pnpm db:generate add_source_observation');
  process.exit(1);
}

const packagePath = fileURLToPath(new URL('../node_modules/drizzle-kit/package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const binPath = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.['drizzle-kit'];
if (!binPath) throw new Error('Cannot resolve the drizzle-kit CLI. Run pnpm install first.');

const result = spawnSync(process.execPath, [resolve(dirname(packagePath), binPath), 'generate', '--name', name], {
  stdio: 'inherit',
});

if (result.error) throw result.error;

if ((result.status ?? 1) === 0) {
  const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
  const journalPath = resolve(migrationsDir, 'meta/_journal.json');
  try {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
    let modified = false;
    for (const entry of journal.entries) {
      const match = /^(\d{4})_(.+)$/.exec(entry.tag);
      if (match) {
        const [, , cleanTag] = match;
        const oldSqlPath = resolve(migrationsDir, `${entry.tag}.sql`);
        const newSqlPath = resolve(migrationsDir, `${cleanTag}.sql`);
        const fs = await import('node:fs');
        if (fs.existsSync(oldSqlPath)) {
          fs.renameSync(oldSqlPath, newSqlPath);
        }
        const oldSnapshot = resolve(migrationsDir, `meta/${match[1]}_snapshot.json`);
        const newSnapshot = resolve(migrationsDir, `meta/${cleanTag}_snapshot.json`);
        if (fs.existsSync(oldSnapshot)) {
          fs.renameSync(oldSnapshot, newSnapshot);
        }
        entry.tag = cleanTag;
        modified = true;
      }
    }
    if (modified) {
      const fs = await import('node:fs');
      fs.writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
      console.log(`[db:generate] Normalized migration to semantic non-numbered format: ${name}.sql`);
    }
  } catch (error) {
    console.warn('[db:generate] Warning: Failed to normalize migration filename:', error);
  }
}

process.exitCode = result.status ?? 1;

