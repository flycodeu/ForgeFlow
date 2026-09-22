/** One-time trace refresh for an already applied v7 project snapshot. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ArchiveService } from '../modules/archive/archive.service.js';
import { WorkspaceRepository } from '../modules/workspace/workspace.repository.js';
import { WorkspaceService } from '../modules/workspace/workspace.service.js';
import * as schema from '../db/schema.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const projectId = 'd03b1e52-1694-4b35-927f-078ec8a3a4f6';
const expected = JSON.parse(readFileSync(resolve(root, 'docs/streamfusion-forgeflow-desktop-v7-2026-09-22.json'), 'utf8'));
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function open(sqlite: Database.Database) {
  const connection = { sqlite, db: drizzle({ client: sqlite, schema }) };
  const workspace = new WorkspaceService(new WorkspaceRepository(connection));
  return { workspace, archive: new ArchiveService(connection, workspace) };
}
function validate(sqlite: Database.Database) {
  assert(sqlite.pragma('integrity_check', { simple: true }) === 'ok'
    && (sqlite.pragma('foreign_key_check') as unknown[]).length === 0, 'SQLite 完整性检查失败');
}
const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const path = value('--database') && resolve(value('--database')!);
const backupPath = value('--backup-db') && resolve(value('--backup-db')!);
const outputPath = value('--out') && resolve(value('--out')!);
const apply = args.includes('--apply');
const flags = ['--database', '--backup-db', '--out'];
assert(args.every((arg, index) => arg === '--apply' || flags.includes(arg)
  || (index > 0 && flags.includes(args[index - 1]!))), '未知命令参数');
assert(path && existsSync(path), '需要 --database <v7 数据库>');
if (apply) assert(backupPath && outputPath && !existsSync(backupPath) && !existsSync(outputPath)
  && new Set([path, backupPath, outputPath]).size === 3, '应用须独立且不可覆盖的备份和导出');
const sqlite = new Database(path, { readonly: !apply, fileMustExist: true });
try {
  sqlite.pragma('foreign_keys = ON');
  const { workspace, archive } = open(sqlite);
  const before = archive.exportProject(projectId);
  const baseline = () => {
    const actual = archive.exportProject(projectId);
    assert((['project', 'documents', 'engineeringAssetRevisions', 'specificationRevisions', 'events'] as const)
      .every((key) => stable(actual[key]) === stable(expected[key])), 'v7 快照已变化，须人工合并');
  };
  baseline(); validate(sqlite);
  const revisionId = before.project.specifications.find((item: any) => !item.featureId && item.kind === 'requirements')?.latestRevisionId;
  assert(revisionId && before.project.capabilities.length === 42
    && !before.project.traceLinks.some((item: any) => item.sourceId === revisionId), '当前需求或追溯关系状态异常');
  if (!apply) console.log(JSON.stringify({ mode: 'dry-run', links: 42 }));
  else {
    await sqlite.backup(backupPath!);
    const backup = new Database(backupPath!, { readonly: true, fileMustExist: true });
    try { validate(backup); } finally { backup.close(); }
    sqlite.transaction(() => {
      baseline();
      for (const capability of before.project.capabilities) workspace.createTraceLink(projectId, {
        sourceType: 'REQUIREMENT_REVISION', sourceId: revisionId,
        targetType: 'CAPABILITY', targetId: capability.id, relation: 'DERIVED_FROM',
      });
      const after = archive.exportProject(projectId);
      assert(after.project.traceLinks.length === before.project.traceLinks.length + 42
        && after.project.tasks.length === 0 && after.project.runs.length === 0, '关系数量或业务状态异常');
      validate(sqlite);
    }).immediate();
    try { writeFileSync(outputPath!, `${JSON.stringify(archive.exportProject(projectId), null, 2)}\n`, { flag: 'wx' }); }
    catch (error) { console.error('数据库已提交但导出失败，请检查库和备份，勿重跑。'); throw error; }
    console.log(JSON.stringify({ mode: 'applied', links: 42, backupPath, outputPath }));
  }
} finally { sqlite.close(); }
