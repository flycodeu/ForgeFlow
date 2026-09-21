import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, readdir, readFile, open, rename, copyFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';

const configName = 'storage.json';
const folded = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
const inside = (parent, child) => { const rel = relative(folded(parent), folded(child)); return !rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
const transient = (name) => name === configName || name.startsWith(`${configName}.`) || name === 'runtime.json' || name.startsWith('runtime.json.') || name === 'desktop.log' || name === 'service.sock' || name === '.migration.json';

export function bootstrapPath(env = process.env) {
  if (env.FORGEFLOW_CONFIG_DIR) return resolve(env.FORGEFLOW_CONFIG_DIR);
  if (!env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required, or set FORGEFLOW_CONFIG_DIR explicitly.');
  return join(env.LOCALAPPDATA, 'ForgeFlow');
}

export async function readStorageChoice({ env = process.env } = {}) {
  if (env.FORGEFLOW_DATA_DIR) return { dataPath: resolve(env.FORGEFLOW_DATA_DIR), configPath: null, override: true, canMigrate: false };
  const directory = bootstrapPath(env);
  await assertNoLinks(directory);
  const configPath = join(directory, configName);
  try {
    const value = JSON.parse(await readFile(configPath, 'utf8'));
    if (value.version !== 1 || typeof value.dataPath !== 'string' || !isAbsolute(value.dataPath)) throw new Error('存储配置无效，请保留原文件并修复配置。');
    await assertNoLinks(value.dataPath);
    // A missing configured directory must not silently create an empty database.
    if (!(await lstat(value.dataPath)).isDirectory()) throw new Error('已配置的数据目录不可用。');
    await validateConfiguredDatabase(value.dataPath);
    return { dataPath: value.dataPath, configPath, override: false, canMigrate: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { await lstat(configPath); } catch (probe) {
      if (probe.code === 'ENOENT') {
        let existingPath = null;
        try { if ((await lstat(join(directory, 'forgeflow.db'))).isFile()) existingPath = directory; } catch (legacyError) { if (legacyError.code !== 'ENOENT') throw legacyError; }
        return { dataPath: null, configPath, suggestedPath: join(directory, 'data'), existingPath, override: false, canMigrate: true };
      }
      throw probe;
    }
    throw new Error('已配置的数据目录不存在。请连接原磁盘，不会自动建立空数据库。');
  }
}

async function validateConfiguredDatabase(directory) {
  const path = join(directory, 'forgeflow.db');
  let handle;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 100) throw new Error('INVALID_DATABASE');
    handle = await open(path, 'r');
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 16 || header.toString('binary') !== 'SQLite format 3\0') throw new Error('INVALID_DATABASE');
  } catch {
    throw new Error('已配置目录中的 forgeflow.db 缺失、不可读取或格式无效。请恢复原数据库，不会自动建立空数据库。');
  } finally { await handle?.close(); }
}

export async function assertNoLinks(path) {
  let cursor = resolve(path);
  for (;;) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`不支持符号链接或目录联接：${cursor}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(cursor) === cursor) break;
    cursor = dirname(cursor);
  }
}

export async function secureDataDirectory(path) {
  await assertNoLinks(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const directory = await realpath(path);
  if (process.platform === 'win32') {
    const identity = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true });
    const sid = identity.stdout?.match(/S-1-5-[\d-]+/)?.[0];
    if (!sid) throw new Error('无法确定当前用户，未写入数据。');
    const acl = spawnSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
    if (acl.status !== 0) throw new Error('无法保护数据目录访问权限，未写入数据。');
  }
  return directory;
}

export async function validateStorageTarget(path, { sourcePath, runtimeRoot, env = process.env, allowLegacy = false } = {}) {
  if (typeof path !== 'string' || !path.trim() || !isAbsolute(path)) throw new Error('请选择绝对路径。');
  if (process.platform === 'win32' && (path.startsWith('\\\\') || /[<>"|?*]/.test(path) || /(^|[\\/])[^\\/]*[. ]([\\/]|$)/.test(path))) throw new Error('请选择本机磁盘上的普通目录。');
  const target = resolve(path);
  if (folded(target) === folded(parse(target).root) || folded(target) === folded(resolve(env.USERPROFILE || homedir()))) throw new Error('不能使用磁盘根目录或用户主目录，请新建专用文件夹。');
  const installRoot = runtimeRoot && basename(resolve(runtimeRoot)).toLowerCase() === 'runtime' ? dirname(resolve(runtimeRoot)) : null;
  const protectedRoots = [env.WINDIR, env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], runtimeRoot, installRoot].filter(Boolean).map((value) => resolve(value));
  if (protectedRoots.some((root) => inside(root, target))) throw new Error('不能将数据放在系统或程序安装目录。');
  if (sourcePath && (inside(resolve(sourcePath), target) || inside(target, resolve(sourcePath)))) throw new Error('新旧数据目录不能相同，也不能相互包含。');
  await assertNoLinks(target);
  let entries = [];
  try {
    if (!(await lstat(target)).isDirectory()) throw new Error('目标不是文件夹。');
    entries = await readdir(target);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const legacy = allowLegacy && folded(target) === folded(resolve(bootstrapPath(env))) && entries.includes('forgeflow.db');
  if (entries.length && !legacy) throw new Error('目标目录必须为空，请选择新的专用文件夹。');
  if (legacy) await checkSqliteFiles(target, await inspectStorage(target));
  return { dataPath: target, legacy };
}

async function digestFile(path) {
  const hash = createHash('sha256');
  const handle = await open(path, 'r');
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); }
  finally { await handle.close(); }
  return hash.digest('hex');
}

export async function inspectStorage(directory) {
  await assertNoLinks(directory);
  const files = [];
  async function visit(current, prefix = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (!prefix && transient(entry.name)) continue;
      const rel = prefix ? join(prefix, entry.name) : entry.name;
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`数据中存在链接，无法安全迁移：${rel}`);
      if (entry.isDirectory()) await visit(path, rel);
      else if (entry.isFile()) files.push({ path: rel, hash: await digestFile(path), bytes: (await lstat(path)).size });
      else throw new Error(`数据中存在不支持的文件类型：${rel}`);
    }
  }
  await visit(directory);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function checkSqliteFiles(directory, manifest) {
  for (const item of manifest) {
    const path = join(directory, item.path);
    const handle = await open(path, 'r');
    const magic = Buffer.alloc(16);
    try { await handle.read(magic, 0, 16, 0); } finally { await handle.close(); }
    const expectedDatabase = /\.(db|sqlite|sqlite3)$/i.test(item.path);
    if (magic.toString('binary') !== 'SQLite format 3\0') {
      if (expectedDatabase) throw new Error(`SQLite 文件格式无效：${item.path}`);
      continue;
    }
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const result = db.prepare('PRAGMA quick_check').all();
      if (result.length !== 1 || Object.values(result[0])[0] !== 'ok') throw new Error(`SQLite 校验失败：${item.path}`);
    } finally { db.close(); }
  }
}

async function durableJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2)); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, path);
  // Windows does not expose directory fsync through Node; file replacement remains atomic.
  if (process.platform !== 'win32') { const dir = await open(dirname(path), 'r'); try { await dir.sync(); } finally { await dir.close(); } }
}

export async function saveStorageChoice(dataPath, { env = process.env } = {}) {
  const directory = bootstrapPath(env);
  await assertNoLinks(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await durableJson(join(directory, configName), { version: 1, dataPath: await realpath(dataPath) });
}

// Caller must hold the source runtime lock and stop every writer before entering.
// Source files are never deleted. A failed target is retained for inspection, never reused silently.
export async function copyStorage({ sourcePath, targetPath, runtimeRoot, env = process.env, progress = () => {}, beforeVerify }) {
  const { dataPath } = await validateStorageTarget(targetPath, { sourcePath, runtimeRoot, env });
  await assertNoLinks(sourcePath);
  const before = await inspectStorage(sourcePath);
  await secureDataDirectory(dataPath);
  await durableJson(join(dataPath, '.migration.json'), { version: 1, sourcePath, stage: 'copying', createdAt: new Date().toISOString() });
  progress('copying');
  for (const item of before) {
    const target = join(dataPath, item.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(join(sourcePath, item.path), target, constants.COPYFILE_EXCL);
    const handle = await open(target, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
  }
  await beforeVerify?.(dataPath);
  progress('verifying');
  const after = await inspectStorage(sourcePath);
  const copied = await inspectStorage(dataPath);
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('迁移期间原目录发生变化，已保留原目录，请关闭其他写入进程后重试。');
  if (JSON.stringify(before) !== JSON.stringify(copied)) throw new Error('目标文件校验不一致，未切换数据目录。');
  await checkSqliteFiles(dataPath, copied);
  await durableJson(join(dataPath, '.migration.json'), { version: 1, sourcePath, stage: 'verified', createdAt: new Date().toISOString() });
  return { dataPath, files: copied.length, bytes: copied.reduce((sum, item) => sum + item.bytes, 0) };
}
