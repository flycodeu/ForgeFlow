import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, access, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readStorageChoice, validateStorageTarget, saveStorageChoice, copyStorage, inspectStorage, checkSqliteFiles } from './desktop-storage.mjs';
import { createDesktopController } from '../desktop-service.mjs';

async function fixture(action) {
  const root = await mkdtemp(join(tmpdir(), 'forgeflow-storage-'));
  const env = { FORGEFLOW_CONFIG_DIR: join(root, 'config'), USERPROFILE: join(root, 'home'), WINDIR: join(root, 'windows'), ProgramFiles: join(root, 'programs') };
  try { await action({ root, env }); } finally { await rm(root, { recursive: true, force: true }); }
}
async function database(path) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE entries (id TEXT PRIMARY KEY, text TEXT); INSERT INTO entries VALUES (\'1\', \'保留的文档\');'); db.close();
}
async function source(root) {
  const path = join(root, 'source'); await mkdir(join(path, 'capture', 'project'), { recursive: true });
  await database(join(path, 'forgeflow.db')); await database(join(path, 'capture', 'project', 'collector.sqlite'));
  await writeFile(join(path, 'document.md'), '# 文档原文');
  await writeFile(join(path, 'runtime.json'), 'private secret'); await writeFile(join(path, 'desktop.log'), 'transient');
  return path;
}

test('first run only returns setup, explicit override and missing configured disk never create an empty DB', () => fixture(async ({ root, env }) => {
  const initial = await readStorageChoice({ env });
  assert.equal(initial.dataPath, null); assert.equal(initial.existingPath, null);
  assert.equal(initial.suggestedPath, join(root, 'config', 'data'));
  assert.deepEqual(await readdir(root), []);
  const data = join(root, 'data'); await mkdir(data); await database(join(data, 'forgeflow.db')); await saveStorageChoice(data, { env });
  assert.equal((await readStorageChoice({ env })).dataPath, data);
  await rm(data, { recursive: true });
  await assert.rejects(readStorageChoice({ env }), /不存在/);
  const overridden = await readStorageChoice({ env: { ...env, FORGEFLOW_DATA_DIR: join(root, 'override') } });
  assert.equal(overridden.canMigrate, false); assert.equal(overridden.override, true);
}));

test('target must be empty and dedicated, never root, home, program folder, source parent/child or linked folder', () => fixture(async ({ root, env }) => {
  const from = await source(root);
  for (const path of [parse(root).root, env.USERPROFILE, join(env.WINDIR, 'data'), join(env.ProgramFiles, 'data'), from, root, join(from, 'child'), 'relative']) {
    await assert.rejects(validateStorageTarget(path, { env, sourcePath: from, runtimeRoot: join(root, 'install') }));
  }
  await assert.rejects(validateStorageTarget(join(root, 'install', 'data'), { env, runtimeRoot: join(root, 'install') }));
  await assert.rejects(validateStorageTarget(join(root, 'install', 'data'), { env, runtimeRoot: join(root, 'install', 'runtime') }), /程序安装目录/);
  assert.equal((await validateStorageTarget(join(root, 'user-data'), { env, runtimeRoot: join(root, 'install', 'runtime') })).dataPath, join(root, 'user-data'));
  assert.equal((await validateStorageTarget(join(root, 'custom-data'), { env, runtimeRoot: join(root, 'custom-resource-path') })).dataPath, join(root, 'custom-data'));
  const occupied = join(root, 'occupied'); await mkdir(occupied); await writeFile(join(occupied, 'keep.txt'), 'must stay');
  await assert.rejects(validateStorageTarget(occupied, { env }), /必须为空/);
  const linked = join(root, 'linked'); await symlink(from, linked, 'junction');
  await assert.rejects(validateStorageTarget(join(linked, 'new'), { env }), /链接|联接/);
  assert.equal(await readFile(join(occupied, 'keep.txt'), 'utf8'), 'must stay');
}));

test('legacy database reuse requires explicit permission and only the known old default', () => fixture(async ({ root, env }) => {
  await mkdir(env.FORGEFLOW_CONFIG_DIR); await database(join(env.FORGEFLOW_CONFIG_DIR, 'forgeflow.db'));
  assert.equal((await readStorageChoice({ env })).existingPath, env.FORGEFLOW_CONFIG_DIR);
  await assert.rejects(validateStorageTarget(env.FORGEFLOW_CONFIG_DIR, { env }), /必须为空/);
  assert.equal((await validateStorageTarget(env.FORGEFLOW_CONFIG_DIR, { env, allowLegacy: true })).legacy, true);
  const elsewhere = await source(root);
  await assert.rejects(validateStorageTarget(elsewhere, { env, allowLegacy: true }), /必须为空/);
}));

test('migration copies complete business data and queue, verifies hashes and SQLite, retains source and old config until commit', () => fixture(async ({ root, env }) => {
  const from = await source(root); await saveStorageChoice(from, { env });
  const baseline = await inspectStorage(from); const target = join(root, 'moved');
  const stages = [];
  const copied = await copyStorage({ sourcePath: from, targetPath: target, env, progress: (value) => stages.push(value) });
  assert.equal(copied.files, 3); assert.deepEqual(stages, ['copying', 'verifying']);
  assert.deepEqual(await inspectStorage(target), baseline); assert.deepEqual(await inspectStorage(from), baseline);
  await assert.rejects(access(join(target, 'runtime.json'))); await assert.rejects(access(join(target, 'desktop.log')));
  assert.equal((await readStorageChoice({ env })).dataPath, from);
  await saveStorageChoice(target, { env }); assert.equal((await readStorageChoice({ env })).dataPath, target);
  assert.equal(await readFile(join(from, 'document.md'), 'utf8'), '# 文档原文');
}));

test('corrupt destination and concurrent source writes abort without changing saved path', () => fixture(async ({ root, env }) => {
  const from = await source(root); await saveStorageChoice(from, { env });
  await assert.rejects(copyStorage({ sourcePath: from, targetPath: join(root, 'bad-copy'), env,
    beforeVerify: (target) => writeFile(join(target, 'document.md'), 'damaged') }), /校验不一致/);
  await assert.rejects(copyStorage({ sourcePath: from, targetPath: join(root, 'changed-source'), env,
    beforeVerify: () => writeFile(join(from, 'document.md'), 'new source data') }), /原目录发生变化/);
  assert.equal((await readStorageChoice({ env })).dataPath, from);
  const bad = join(root, 'invalid'); await mkdir(bad); await writeFile(join(bad, 'broken.sqlite'), 'not sqlite');
  await assert.rejects(checkSqliteFiles(bad, await inspectStorage(bad)), /格式无效/);
}));

test('links inside data fail closed and never copy outside files', () => fixture(async ({ root, env }) => {
  const from = await source(root); const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'private.txt'), 'private');
  await symlink(outside, join(from, 'external'), 'junction');
  await assert.rejects(copyStorage({ sourcePath: from, targetPath: join(root, 'target'), env }), /存在链接/);
  await assert.rejects(access(join(root, 'target')));
}));

function fakeServiceFactory(events, { failPath, graceful = true } = {}) {
  return async ({ dataPath, emit, deferPublication }) => {
    const ready = { type: 'ready', url: `http://127.0.0.1:1234/#desktop-token=test` };
    events.push(['start', dataPath, deferPublication]);
    if (dataPath === failPath) throw new Error('candidate start failed');
    if (!deferPublication) emit(ready);
    return { waitUntilReady: async () => ready, publishReady: async () => { events.push(['publish', dataPath]); emit(ready); },
      stop: async (options) => { events.push(['stop', dataPath, options]); return { graceful }; }, releaseLock: async () => events.push(['unlock', dataPath]) };
  };
}

test('controller first choice is committed only after authenticated readiness, no automatic legacy reuse', () => fixture(async ({ root, env }) => {
  const messages = []; const events = [];
  const target = join(root, 'selected');
  const startService = async (options) => { await mkdir(options.dataPath, { recursive: true }); await database(join(options.dataPath, 'forgeflow.db')); assert.equal((await readStorageChoice({ env })).dataPath, null); return fakeServiceFactory(events)(options); };
  const controller = await createDesktopController({ runtimeRoot: join(root, 'install', 'runtime'), env, startService, emit: (value) => messages.push(value) });
  assert.equal(messages[0].type, 'setup-required'); assert.equal(events.length, 0);
  await controller.handle({ type: 'choose-storage', path: target });
  assert.equal((await readStorageChoice({ env })).dataPath, target);
  assert.equal(messages.filter((value) => value.type === 'ready').length, 1);
  assert.ok(messages.findIndex((value) => value.type === 'storage-info') > messages.findIndex((value) => value.type === 'ready'));
  await controller.stop();
}));

test('failed candidate start rolls back to source, retaining old config and all source contents', () => fixture(async ({ root, env }) => {
  const from = await source(root); await saveStorageChoice(from, { env });
  const baseline = await inspectStorage(from); const target = join(root, 'failed-target'); const messages = []; const events = [];
  const controller = await createDesktopController({ runtimeRoot: join(root, 'install', 'runtime'), env, startService: fakeServiceFactory(events, { failPath: target }), emit: (value) => messages.push(value) });
  await controller.handle({ type: 'migrate-storage', path: target });
  assert.equal((await readStorageChoice({ env })).dataPath, from); assert.deepEqual(await inspectStorage(from), baseline);
  assert.equal(events.filter(([type, path]) => type === 'start' && path === from).length, 2);
  assert.equal(messages.at(-2).type, 'storage-error');
  assert.equal(events.find(([type]) => type === 'stop')[2].retainLock, true);
  await controller.stop();
}));

test('unclean shutdown never enters copying and restarts original service', () => fixture(async ({ root, env }) => {
  const from = await source(root); await saveStorageChoice(from, { env }); const messages = [];
  const target = join(root, 'target');
  const controller = await createDesktopController({ runtimeRoot: join(root, 'install', 'runtime'), env, startService: fakeServiceFactory([], { graceful: false }), emit: (value) => messages.push(value) });
  await controller.handle({ type: 'migrate-storage', path: target });
  assert.ok(messages.some((value) => value.type === 'storage-error' && value.message.includes('中止迁移')));
  await assert.rejects(access(target)); assert.equal((await readStorageChoice({ env })).dataPath, from);
  await controller.stop();
}));

test('configuration commit failure stops candidate before restoring old runtime, never publishes candidate', () => fixture(async ({ root, env }) => {
  const from = await source(root); await saveStorageChoice(from, { env }); const messages = []; const events = [];
  const target = join(root, 'target'); const oldConfig = await readFile(join(env.FORGEFLOW_CONFIG_DIR, 'storage.json'), 'utf8');
  const controller = await createDesktopController({ runtimeRoot: join(root, 'install', 'runtime'), env, startService: fakeServiceFactory(events),
    persistChoice: async () => { throw new Error('Disk write failed'); }, emit: (value) => messages.push(value) });
  await controller.handle({ type: 'migrate-storage', path: target });
  assert.equal(await readFile(join(env.FORGEFLOW_CONFIG_DIR, 'storage.json'), 'utf8'), oldConfig);
  assert.equal(events.some(([type, path]) => type === 'publish' && path === target), false);
  assert.ok(events.some(([type, path]) => type === 'stop' && path === target));
  assert.equal(messages.filter((value) => value.type === 'ready').length, 2);
  assert.ok(messages.some((value) => value.type === 'storage-error' && value.message === 'Disk write failed'));
  await controller.stop();
}));

test('configured directory with moved database refuses launch without rebuilding or changing config and queue', () => fixture(async ({ root, env }) => {
  const from = await source(root); await saveStorageChoice(from, { env });
  const configPath = join(env.FORGEFLOW_CONFIG_DIR, 'storage.json');
  const savedConfig = await readFile(configPath, 'utf8');
  const savedQueue = await readFile(join(from, 'capture', 'project', 'collector.sqlite'));
  await rename(join(from, 'forgeflow.db'), join(from, 'forgeflow.db.saved'));
  let launches = 0;
  await assert.rejects(readStorageChoice({ env }), /forgeflow.db 缺失/);
  await assert.rejects(createDesktopController({ runtimeRoot: join(root, 'install', 'runtime'), env,
    startService: async () => { launches++; throw new Error('must not launch'); }, emit: () => {} }), /不会自动建立空数据库/);
  assert.equal(launches, 0); await assert.rejects(access(join(from, 'forgeflow.db')));
  assert.equal(await readFile(configPath, 'utf8'), savedConfig);
  assert.deepEqual(await readFile(join(from, 'capture', 'project', 'collector.sqlite')), savedQueue);
  await rename(join(from, 'forgeflow.db.saved'), join(from, 'forgeflow.db'));
  assert.equal((await readStorageChoice({ env })).dataPath, from);
}));

test('configured empty, non-SQLite, directory and linked database fail closed; explicit override still permits initialization', () => fixture(async ({ root, env }) => {
  const data = join(root, 'data'); await mkdir(data); await saveStorageChoice(data, { env });
  const path = join(data, 'forgeflow.db');
  for (const content of [Buffer.alloc(0), Buffer.alloc(4096, 65)]) {
    await writeFile(path, content);
    await assert.rejects(readStorageChoice({ env }), /格式无效/);
    assert.deepEqual(await readFile(path), content);
  }
  await rm(path); await mkdir(path);
  await assert.rejects(readStorageChoice({ env }), /格式无效/);
  await rm(path, { recursive: true });
  const linked = join(root, 'database-link-target'); await mkdir(linked);
  await symlink(linked, path, 'junction');
  await assert.rejects(readStorageChoice({ env }), /格式无效/);
  const override = await readStorageChoice({ env: { ...env, FORGEFLOW_DATA_DIR: join(root, 'brand-new') } });
  assert.equal(override.override, true); await assert.rejects(access(override.dataPath));
}));
