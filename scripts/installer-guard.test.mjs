import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const guard = resolve(import.meta.dirname, '../apps/desktop/installer/guard.ps1');
const digest = data => createHash('sha256').update(data).digest('hex');
const run = (mode, target, hash = '') => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', guard, '-Mode', mode, '-Target', target, ...(hash ? ['-ManifestHash', hash] : [])], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PSModulePath: 'C:\\nonexistent-test-modules' } });

test('installer only accepts empty ordinary local folders', { skip: process.platform !== 'win32' }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'forgeflow-installer-guard-'));
  assert.equal(run('Install', join(base, 'empty')).status, 0);
  assert.equal(run('Install', 'C:\\').status, 2);
  await writeFile(join(base, 'keep.txt'), 'user data');
  assert.equal(run('Install', base).status, 2);
  const linked = `${base}-link`;
  await symlink(base, linked, 'junction');
  assert.equal(run('Install', join(linked, 'child')).status, 2);
  assert.equal(await readFile(join(base, 'keep.txt'), 'utf8'), 'user data');
});

test('uninstall validates manifest and location before removal; modified and extra files survive', { skip: process.platform !== 'win32' }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'forgeflow-installer-uninstall-'));
  await mkdir(join(base, 'runtime'));
  await writeFile(join(base, 'runtime/程序.txt'), 'program');
  await writeFile(join(base, 'changed.txt'), 'user edit');
  await writeFile(join(base, 'user.db'), 'user data');
  const manifest = JSON.stringify({ files: [{ path: 'runtime/程序.txt', sha256: digest('program') }, { path: 'changed.txt', sha256: digest('original') }], directories: ['runtime'] });
  await writeFile(join(base, 'forgeflow-install-manifest.json'), manifest);
  await writeFile(join(base, 'forgeflow-install-location.txt'), base);
  assert.equal(run('Uninstall', base, digest('wrong')).status, 2);
  await access(join(base, 'runtime/程序.txt'));
  await writeFile(join(base, 'forgeflow-install-location.txt'), `${base}-moved`);
  assert.equal(run('Uninstall', base, digest(manifest)).status, 2);
  await access(join(base, 'runtime/程序.txt'));
  await writeFile(join(base, 'forgeflow-install-location.txt'), base);
  const result = run('Uninstall', base, digest(manifest));
  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(access(join(base, 'runtime/程序.txt')));
  assert.equal(await readFile(join(base, 'changed.txt'), 'utf8'), 'user edit');
  assert.equal(await readFile(join(base, 'user.db'), 'utf8'), 'user data');
});

test('installer accepts existing valid ForgeFlow directory for in-place upgrade', { skip: process.platform !== 'win32' }, async () => {
  const base = await mkdtemp(join(tmpdir(), 'forgeflow-installer-upgrade-'));
  await writeFile(join(base, 'ForgeFlow.exe'), 'binary');
  await writeFile(join(base, 'Uninstall.exe'), 'uninstaller');
  await writeFile(join(base, 'forgeflow-install-manifest.json'), '{}');
  await writeFile(join(base, 'user-data.db'), 'user database');

  assert.equal(run('Install', base).status, 0);
  assert.equal(await readFile(join(base, 'user-data.db'), 'utf8'), 'user database');
});

