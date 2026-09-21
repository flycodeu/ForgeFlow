import { readdir, readFile, mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const payload = resolve(process.env.FORGEFLOW_INSTALLER_PAYLOAD || join(root, 'apps/desktop/dist/ForgeFlow'));
const compiler = resolve(process.env.NSIS_MAKENSIS || join(root, '.artifacts/installer-tools/nsis-3.11/makensis.exe'));
const appKey = process.env.FORGEFLOW_INSTALLER_TEST_KEY || 'ForgeFlow';
if (!/^ForgeFlow(?:-Test-[A-Za-z0-9-]+)?$/.test(appKey)) throw new Error('Invalid installer key');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const output = join(root, 'apps/desktop/dist', `${appKey}-Setup-${version}.exe`);
const buildDir = join(root, '.artifacts/installer-build', appKey);
const hash = data => createHash('sha256').update(data).digest('hex');
const quote = value => `"${value.replaceAll('$', '$$').replaceAll('"', '$\\"')}"`;
await stat(join(payload, 'ForgeFlow.exe'));
await stat(join(payload, 'runtime/node.exe'));
await mkdir(buildDir, { recursive: true });
const files = [], directories = [];
async function walk(relative = '') {
  for (const entry of await readdir(join(payload, relative), { withFileTypes: true })) {
    const name = join(relative, entry.name);
    if (/\.(?:db|sqlite|sqlite3)(?:-wal|-shm)?$/i.test(entry.name) || entry.name === '.env' || (!relative && /^(?:data|backups|capture|Uninstall\.exe|forgeflow-install-)/i.test(entry.name))) throw new Error(`User data or installer metadata must not enter the payload: ${name}`);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in payload: ${name}`);
    if (entry.isDirectory()) { directories.push(name); await walk(name); }
    else if (entry.isFile()) files.push({ path: name, sha256: hash(await readFile(join(payload, name))) });
    else throw new Error(`Unsupported payload item: ${name}`);
  }
}
await walk();
files.sort((a, b) => a.path.localeCompare(b.path));
const manifest = JSON.stringify({ product: 'ForgeFlow', version, files, directories }, null, 2);
const manifestFile = join(buildDir, 'manifest.json');
await writeFile(manifestFile, manifest);
await writeFile(join(buildDir, 'build.nsh'), '# -*- coding: utf-8 -*-\n' + Object.entries({ OUTPUT: output, GUARD: join(root, 'apps/desktop/installer/guard.ps1'), APP_ICON: join(root, 'apps/desktop/src-tauri/icons/icon.ico'), MANIFEST: manifestFile, MANIFEST_HASH: hash(manifest), VERSION: version, APPKEY: appKey, ...(appKey !== 'ForgeFlow' ? { TEST_DEFAULT: join(buildDir, 'isolated-default-install') } : {}) }).map(([key, value]) => `!define ${key} ${quote(value)}`).join('\n'));
await writeFile(join(buildDir, 'payload.nsh'), '# -*- coding: utf-8 -*-\n' + files.map(file => `SetOutPath "$INSTDIR\\${dirname(file.path) === '.' ? '' : dirname(file.path).replaceAll('$', '$$')}"\nFile ${quote(join(payload, file.path))}`).join('\n'));
await copyFile(join(root, 'apps/desktop/installer/setup.nsi'), join(buildDir, 'setup.nsi'));
const result = spawnSync(compiler, ['/V2', join(buildDir, 'setup.nsi')], { stdio: 'inherit' });
if (result.error) throw new Error(`NSIS compiler unavailable: ${compiler}. Set NSIS_MAKENSIS to an official portable NSIS makensis.exe.`, { cause: result.error });
if (result.status !== 0) process.exit(result.status || 1);
console.log(JSON.stringify({ output, payload, files: files.length, sha256: hash(await readFile(output)) }, null, 2));
