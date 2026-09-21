import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const key = process.env.FORGEFLOW_INSTALLER_TEST_KEY;
if (!/^ForgeFlow-Test-[A-Za-z0-9-]+$/.test(key || '')) throw new Error('Use an isolated ForgeFlow-Test-* installer registry key.');
const installer = join(root, 'apps/desktop/dist', `${key}-Setup-${version}.exe`);
const base = await mkdtemp(join(root, '.artifacts/installer-smoke-'));
const target = join(base, '自选 安装目录');
const run = (file, args) => new Promise((res, rej) => {
  const child = spawn(file, args, { windowsHide: true, windowsVerbatimArguments: true, stdio: 'ignore' });
  child.once('error', rej); child.once('exit', code => res(code));
});
assert.equal(await run(installer, ['/S', `/D=${target}`]), 0);
await access(join(target, 'ForgeFlow.exe'));
const installedExeHash = createHash('sha256').update(await readFile(join(target, 'ForgeFlow.exe'))).digest('hex');
const installedManifest = JSON.parse(await readFile(join(target, 'forgeflow-install-manifest.json'), 'utf8'));
assert.equal(installedExeHash, installedManifest.files.find(file => file.path === 'ForgeFlow.exe')?.sha256);
assert.equal((await readFile(join(target, 'forgeflow-install-location.txt'), 'utf16le')).replace(/^\uFEFF/, ''), target);
assert.equal(await run(installer, ['/S', `/D=${target}`]), 2, 'Non-empty install targets must be rejected');
await writeFile(join(target, 'user-notes.txt'), 'Keep user-created files');
await writeFile(join(target, 'README.md'), 'Keep changed application files');
const hasRuntime = (await readFile(join(target, 'runtime/node.exe'))).subarray(0, 2).toString() === 'MZ';
if (hasRuntime) {
  const service = spawn(join(target, 'runtime/node.exe'), ['-e', 'console.log("ready"); setInterval(()=>{},1000)'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise((res, rej) => { service.stdout.once('data', res); service.once('error', rej); });
    assert.equal(await run(join(target, 'Uninstall.exe'), ['/S', `_?=${target}`]), 2, 'Running bundled processes must prevent removal');
    await access(join(target, 'ForgeFlow.exe'));
  } finally {
    service.kill();
    await new Promise(res => service.once('exit', res));
  }
}
// Hold an exclusive Windows file lock in another process, then verify no partial removal.
const lockCode = '$ErrorActionPreference="Stop"; $s=[IO.File]::Open($env:FORGEFLOW_TEST_LOCK,"Open","Read","None"); [Console]::WriteLine("locked"); [Console]::ReadLine() | Out-Null; $s.Dispose()';
const lock = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(lockCode, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, FORGEFLOW_TEST_LOCK: join(target, 'ForgeFlow.exe') }, stdio: ['pipe', 'pipe', 'pipe'] });
try {
  await new Promise((res, rej) => { lock.stdout.once('data', res); lock.once('exit', () => rej(new Error('Lock helper exited early'))); });
  assert.equal(await run(join(target, 'Uninstall.exe'), ['/S', `_?=${target}`]), 2);
  await access(join(target, 'runtime/node.exe'));
} finally {
  lock.stdin.end('\n');
  if (lock.exitCode === null) await new Promise(res => lock.once('exit', res));
}
assert.equal(await run(join(target, 'Uninstall.exe'), ['/S']), 0);
const deadline = Date.now() + 120_000;
while (true) {
  try { await access(join(target, 'Uninstall.exe')); }
  catch (error) { if (error.code === 'ENOENT') break; throw error; }
  if (Date.now() > deadline) throw new Error(`Uninstaller did not finish: ${target}`);
  await setTimeout(500);
}
await assert.rejects(access(join(target, 'ForgeFlow.exe')));
assert.equal(await readFile(join(target, 'user-notes.txt'), 'utf8'), 'Keep user-created files');
assert.equal(await readFile(join(target, 'README.md'), 'utf8'), 'Keep changed application files');
const result = { status: 'PASS', base, installer, installedExeHash, completedAt: new Date().toISOString(), checks: ['custom Unicode directory', 'installed executable matches manifest', 'non-empty directory blocked', ...(hasRuntime ? ['running bundled process blocked'] : []), 'locked program blocks all removal', 'normal uninstall removes itself', 'only unchanged application files removed', 'user and modified files retained'] };
await writeFile(join(base, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
