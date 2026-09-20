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
process.exitCode = result.status ?? 1;
