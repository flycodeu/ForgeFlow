import { spawnSync } from 'node:child_process';
import { cp, copyFile, mkdir, access, readFile, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'apps/desktop/runtime');
if (process.platform !== 'win32') throw new Error('This packaging entry currently targets Windows only.');
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Build with Node 24 to match better-sqlite3 ABI.');
await access(join(root, 'apps/web/dist/index.html'));
await access(join(root, 'apps/server/dist/server.js'));
await rm(runtime, { recursive: true, force: true });
await mkdir(join(runtime, 'apps'), { recursive: true });
// Copy the installed production dependency closure without fetching new versions.
// Conflicting transitive versions remain nested, matching Node resolution.
const packages = new Map();
const graph = new Map();
async function findPackage(from, name) {
  for (let cursor = from; ; cursor = dirname(cursor)) {
    const candidate = join(cursor, 'node_modules', name);
    try { await access(join(candidate, 'package.json')); return await realpath(candidate); } catch {}
    if (dirname(cursor) === cursor) throw new Error(`Installed dependency is missing: ${name}`);
  }
}
async function collect(directory) {
  if (graph.has(directory)) return;
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const item = { directory, version: manifest.version, name: manifest.name, dependencies: [] };
  graph.set(directory, item);
  if (!packages.has(manifest.name)) packages.set(manifest.name, item);
  const add = async (source) => { item.dependencies.push(source); await collect(source); };
  for (const name of Object.keys(manifest.dependencies ?? {})) await add(await findPackage(directory, name));
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    let optional; try { optional = await findPackage(directory, name); } catch { continue; }
    await add(optional);
  }
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (manifest.peerDependenciesMeta?.[name]?.optional) continue;
    await add(await findPackage(directory, name));
  }
}
await collect(join(root, 'apps/server'));
async function install(item, destination, available) {
  await cp(item.directory, destination, { recursive: true, dereference: true,
    filter: (source) => !['node_modules', '.git'].includes(basename(source)) });
  const local = new Map(available); local.set(item.name, item.version);
  for (const dependency of item.dependencies) {
    const child = graph.get(dependency);
    if (local.get(child.name) === child.version) continue;
    await install(child, join(destination, 'node_modules', child.name), local);
  }
}
const available = new Map([...packages].map(([name, item]) => [name, item.version]));
for (const [name, item] of packages) {
  const destination = name === '@forgeflow/server' ? join(runtime, 'apps/server') : join(runtime, 'apps/server/node_modules', name);
  await install(item, destination, available);
}
await cp(join(root, 'apps/web/dist'), join(runtime, 'apps/web/dist'), { recursive: true });
await cp(join(root, 'migrations'), join(runtime, 'migrations'), { recursive: true });
await mkdir(join(runtime, 'scripts'), { recursive: true });
await copyFile(join(root, 'scripts/desktop-service.mjs'), join(runtime, 'scripts/desktop-service.mjs'));
await copyFile(join(root, 'scripts/project-archive.mjs'), join(runtime, 'scripts/project-archive.mjs'));
await copyFile(join(root, 'scripts/session-capture.mjs'), join(runtime, 'scripts/session-capture.mjs'));
await cp(join(root, 'scripts/lib'), join(runtime, 'scripts/lib'), { recursive: true });
await copyFile(process.execPath, join(runtime, 'node.exe'));
const check = spawnSync(join(runtime, 'node.exe'), ['--input-type=module', '-e', "import Database from 'better-sqlite3'; const db = new Database(':memory:'); console.log(db.prepare('select 1 as ok').get().ok); db.close();"], { cwd: join(runtime, 'apps/server'), windowsHide: true, encoding: 'utf8' });
if (check.status !== 0 || check.stdout.trim() !== '1') throw new Error('Packaged SQLite native-module smoke test failed.');
console.log(`Prepared standalone runtime: ${runtime}`);
