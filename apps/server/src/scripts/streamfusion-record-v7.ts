/** Snapshot-checked project material and function-map refresh. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ArchiveService } from '../modules/archive/archive.service.js';
import { WorkspaceRepository } from '../modules/workspace/workspace.repository.js';
import { WorkspaceService } from '../modules/workspace/workspace.service.js';
import * as schema from '../db/schema.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const projectId = 'd03b1e52-1694-4b35-927f-078ec8a3a4f6';
const expected = JSON.parse(readFileSync(resolve(root, 'docs/streamfusion-forgeflow-desktop-v6-2026-09-22.json'), 'utf8'));
const materials = [
  ['background', '项目背景', 'streamfusion-v7-background.md'],
  ['research', '调研与分析', 'streamfusion-v7-research.md'],
  ['requirements', '需求分析', 'streamfusion-v7-requirements.md'],
  ['architecture', '架构设计', 'streamfusion-v7-architecture.md'],
  ['technology', '技术选型', 'streamfusion-v7-technology.md'],
] as const;
const additions = [
  ['FOUNDATION', 'COMMON', '通用能力', '配置、安全响应、审计与观测的跨业务入口。现有底座与待设计的业务能力分别记录。'],
  ['FOUNDATION', 'WEB_API', '前后端业务对接', '按操作核对 Web、API、服务事务与数据/节点响应；管理会话、路由及状态刷新。'],
  ['VIDEO', 'ALGO_ASSET', '算法与模型版本管理', '可信模型制品、推理输入输出、版本校验、发布与引用保护。'],
  ['VIDEO', 'SCENARIO_RELEASE', '检测场景与发布', '将模型、插件/规则和参数固定为可追溯的场景发布版。'],
  ['VIDEO', 'VIDEO_PREVIEW', '实时预览与运行诊断', '原始/带框预览与视频源、节点、模型及证据状态的故障定位。'],
] as const;
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function baseline(actual: typeof expected) {
  for (const key of ['project', 'documents', 'engineeringAssetRevisions', 'specificationRevisions', 'events'] as const) {
    assert(stable(actual[key]) === stable(expected[key]), `v6 项目快照已变化：${key}；请人工合并`);
  }
}
function open(sqlite: Database.Database) {
  const connection = { sqlite, db: drizzle({ client: sqlite, schema }) };
  const workspace = new WorkspaceService(new WorkspaceRepository(connection));
  return { workspace, archive: new ArchiveService(connection, workspace) };
}
function integrity(sqlite: Database.Database) {
  assert(sqlite.pragma('integrity_check', { simple: true }) === 'ok'
    && (sqlite.pragma('foreign_key_check') as unknown[]).length === 0, 'SQLite 完整性检查失败');
}
const documents = materials.map(([kind, title, name]) => {
  const bytes = readFileSync(resolve(root, 'docs', name));
  assert(bytes.length > 500, `内容不足：${name}`);
  return { kind, title, name, content: bytes.toString('utf8'), hash: createHash('sha256').update(bytes).digest('hex') };
});
const mapName = 'streamfusion-v7-function-map.md';
const mapBytes = readFileSync(resolve(root, 'docs', mapName));
const mapHash = createHash('sha256').update(mapBytes).digest('hex');
const sections = [...mapBytes.toString('utf8').matchAll(/<!-- forgeflow-feature:([A-Z_]+) -->\r?\n([\s\S]*?)\r?\n<!-- \/forgeflow-feature -->/g)];
const designs = new Map(sections.map((match) => [match[1]!, `${match[2]!.trim()}\n`]));
assert(sections.length === additions.length && additions.every(([, code]) => designs.has(code)), '新增功能与设计节不匹配');

const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const apply = args.includes('--apply');
const databasePath = value('--database') && resolve(value('--database')!);
const clonePath = value('--clone-to') && resolve(value('--clone-to')!);
const backupPath = value('--backup-db') && resolve(value('--backup-db')!);
const outputPath = value('--out') && resolve(value('--out')!);
const flags = ['--database', '--clone-to', '--backup-db', '--out'];
assert(args.every((arg, index) => arg === '--apply' || flags.includes(arg)
  || (index > 0 && flags.includes(args[index - 1]!))), '未知命令参数');
assert(databasePath && existsSync(databasePath), '用法：--database <v6 库> [--clone-to <.tmp/新库> | --apply --backup-db <新库> --out <新 JSON>]');
assert(!(clonePath && apply), '克隆与应用不可同时执行');
if (clonePath) {
  const inside = relative(resolve(root, '.tmp'), clonePath);
  assert(inside && inside !== '..' && !inside.startsWith('../') && !inside.startsWith('..\\')
    && !isAbsolute(inside) && !existsSync(clonePath), '克隆须在 .tmp 的新路径');
}
if (apply) assert(backupPath && outputPath && !existsSync(backupPath) && !existsSync(outputPath)
  && new Set([databasePath, backupPath, outputPath]).size === 3, '应用须有独立、不可覆盖的备份与导出路径');

const sqlite = new Database(databasePath, { readonly: !apply, fileMustExist: true });
try {
  sqlite.pragma('foreign_keys = ON');
  const { workspace, archive } = open(sqlite);
  const before = archive.exportProject(projectId);
  baseline(before);
  integrity(sqlite);
  const modules = new Map(before.project.modules.map((item: any) => [item.code, item]));
  assert(additions.every(([module, code]) => modules.has(module)
    && !before.project.features.some((item: any) => item.code === code)), '模块或新功能编号冲突');
  const specs = new Map(before.project.specifications.filter((item: any) => !item.featureId)
    .map((item: any) => [item.kind, item]));
  assert(documents.every(({ kind }) => specs.get(kind)?.latestRevisionId), '项目资料缺失');
  assert(before.project.tasks.length === 0 && before.project.runs.length === 0 && before.project.reviews.length === 0,
    '已有实施或评审证据，须人工复核');
  if (clonePath) {
    await sqlite.backup(clonePath);
    const clone = new Database(clonePath, { readonly: true, fileMustExist: true });
    try { integrity(clone); baseline(open(clone).archive.exportProject(projectId)); } finally { clone.close(); }
    console.log(JSON.stringify({ mode: 'clone', clonePath, baseline: 'v6' }));
  } else if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', baseline: 'v6', documents: documents.length, features: additions.length }));
  } else {
    await sqlite.backup(backupPath!);
    const backup = new Database(backupPath!, { readonly: true, fileMustExist: true });
    try { integrity(backup); baseline(open(backup).archive.exportProject(projectId)); } finally { backup.close(); }
    sqlite.transaction(() => {
      baseline(archive.exportProject(projectId));
      for (const doc of documents) {
        const spec = specs.get(doc.kind)!;
        workspace.createRevision(projectId, spec.id, { content: doc.content, expectedHeadRevisionId: spec.latestRevisionId,
          changeSummary: '按实时视频推理产品全链路重写，区分当前事实、候选与待验证决定',
          source: `local:docs/${doc.name}@sha256:${doc.hash}` });
        assert(sqlite.prepare('UPDATE rd_spec SET title = ? WHERE id = ? AND title = ?')
          .run(doc.title, spec.id, spec.title).changes === 1, `资料标题已变化：${doc.kind}`);
      }
      for (const [moduleCode, code, name, summary] of additions) {
        const feature = workspace.createFeatureDraft(modules.get(moduleCode)!.id, { code, name, summary });
        workspace.createFeatureDesign(feature.id, { content: designs.get(code)!,
          changeSummary: '补全功能结构与职责边界；具体操作字段和契约留待场景确认',
          source: `local:docs/${mapName}#${code}@sha256:${mapHash}` });
      }
      const after = archive.exportProject(projectId);
      assert(after.project.features.length === before.project.features.length + additions.length
        && after.project.specifications.length === before.project.specifications.length + additions.length
        && after.specificationRevisions.length === before.specificationRevisions.length + documents.length + additions.length
        && after.project.capabilities.length === before.project.capabilities.length
        && after.project.tasks.length === 0 && after.project.runs.length === 0
        && after.project.reviews.length === 0, '更新后数量/状态异常');
      integrity(sqlite);
    }).immediate();
    try { writeFileSync(outputPath!, `${JSON.stringify(archive.exportProject(projectId), null, 2)}\n`, { flag: 'wx' }); }
    catch (error) { console.error('数据库已提交但导出失败，请核对库与备份，勿重跑。'); throw error; }
    console.log(JSON.stringify({ mode: 'applied', backupPath, outputPath, revisions: documents.length + additions.length,
      features: before.project.features.length + additions.length }));
  }
} finally { sqlite.close(); }
