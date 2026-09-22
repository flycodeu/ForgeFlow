/** One-time, snapshot-checked refresh of three StreamFusion project materials. */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ArchiveService } from '../modules/archive/archive.service.js';
import { WorkspaceRepository } from '../modules/workspace/workspace.repository.js';
import { WorkspaceService } from '../modules/workspace/workspace.service.js';
import * as schema from '../db/schema.js';

const require = createRequire(new URL('../../package.json', import.meta.url));
const Database = require('better-sqlite3');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const projectId = 'd03b1e52-1694-4b35-927f-078ec8a3a4f6';
const expected = JSON.parse(readFileSync(resolve(root, 'docs/streamfusion-forgeflow-desktop-v3-2026-09-22.json'), 'utf8'));
const files = [
  ['background', 'streamfusion-v3-background.md'],
  ['requirements', 'streamfusion-v3-requirements.md'],
  ['research', 'streamfusion-v3-research.md'],
] as const;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function assertSnapshot(actual: typeof expected) {
  for (const key of ['project', 'documents', 'engineeringAssetRevisions', 'specificationRevisions', 'events'] as const) {
    assert(stable(actual[key]) === stable(expected[key]), `项目自 v3 快照后变化：${key}；请先人工复核`);
  }
}
const args = process.argv.slice(2);
const value = (flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
const databasePath = value('--database') && resolve(value('--database')!);
const backupPath = value('--backup-db') && resolve(value('--backup-db')!);
const outputPath = value('--out') && resolve(value('--out')!);
const apply = args.includes('--apply');
assert(args.every((arg, index) => arg === '--apply' || ['--database', '--backup-db', '--out'].includes(arg)
  || (index > 0 && ['--database', '--backup-db', '--out'].includes(args[index - 1]!))), '未知命令参数');
assert(databasePath && existsSync(databasePath), '用法：--database <库> [--apply --backup-db <新文件> --out <新文件>]');
assert(!apply || (backupPath && outputPath && new Set([databasePath, backupPath, outputPath]).size === 3
  && !existsSync(backupPath) && !existsSync(outputPath)), '应用需独立且不可覆盖的备份和输出路径');

const sqlite = new Database(databasePath, { readonly: !apply });
try {
  sqlite.pragma('foreign_keys = ON');
  const connection = { sqlite, db: drizzle({ client: sqlite, schema }) };
  const workspace = new WorkspaceService(new WorkspaceRepository(connection));
  const archive = new ArchiveService(connection, workspace);
  const before = archive.exportProject(projectId);
  assertSnapshot(before);
  assert(sqlite.pragma('integrity_check', { simple: true }) === 'ok' && sqlite.pragma('foreign_key_check').length === 0,
    '更新前数据库不完整');
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', revisions: files.length, existingCapabilities: before.project.capabilities.length }));
  } else {
    await sqlite.backup(backupPath!);
    sqlite.transaction(() => {
      assertSnapshot(archive.exportProject(projectId));
      for (const [kind, filename] of files) {
        const spec = before.project.specifications.find((item: any) => !item.featureId && item.kind === kind);
        assert(spec?.latestRevisionId, `项目资料缺失：${kind}`);
        workspace.createRevision(projectId, spec.id, {
          content: readFileSync(resolve(root, 'docs', filename), 'utf8'),
          changeSummary: '明确产品问题、阶段需求及分问题调研；逐操作设计保留在 Capability',
          expectedHeadRevisionId: spec.latestRevisionId,
          source: `local:docs/${filename}`,
        });
      }
      const after = archive.exportProject(projectId);
      assert(after.specificationRevisions.length === before.specificationRevisions.length + 3
        && after.project.capabilities.length === 42 && after.project.tasks.length === 0 && after.project.runs.length === 0,
      '更新后版本或业务状态不符');
      assert(sqlite.pragma('foreign_key_check').length === 0 && sqlite.pragma('integrity_check', { simple: true }) === 'ok',
        '更新后数据库不完整');
    }).immediate();
    try { writeFileSync(outputPath!, `${JSON.stringify(archive.exportProject(projectId), null, 2)}\n`, { flag: 'wx' }); }
    catch (error) { console.error('数据库已提交，导出失败；请检查数据库，不能直接重跑。'); throw error; }
    console.log(JSON.stringify({ mode: 'applied', backupPath, outputPath, newRevisions: 3, capabilities: 42 }));
  }
} finally { sqlite.close(); }
