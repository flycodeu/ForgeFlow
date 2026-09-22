/** Snapshot-checked addition of StreamFusion foundation operation designs. */
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
const expected = JSON.parse(readFileSync(resolve(root, 'docs/streamfusion-forgeflow-desktop-v7-linked-2026-09-22.json'), 'utf8'));
const cardName = 'streamfusion-v8-foundation-cards.md';
const bytes = readFileSync(resolve(root, 'docs', cardName));
const content = bytes.toString('utf8');
const digest = createHash('sha256').update(bytes).digest('hex');
const featureCodes = { COMMON: ['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06'],
  WEB_API: ['W-01', 'W-02', 'W-03', 'W-04', 'W-05', 'W-06', 'W-07'] } as const;
const headings = [...content.matchAll(/^## ([CW]-\d{2}) (.+)\r?$/gm)];
const cards = new Map(headings.map((heading, index) => {
  const body = content.slice(heading.index!, headings[index + 1]?.index ?? content.length).trim();
  for (const section of ['输入字段', '输出与状态', '处理与异常', '接口与数据', '验收要点']) {
    if (!body.includes(`### ${section}\n`)) throw new Error(`${heading[1]} 缺少 ${section}`);
  }
  return [heading[1]!, { name: heading[2]!.trim(), content: `${body}\n`,
    summary: body.split(/\r?\n/)[1]!.trim() }] as const;
}));
const codes = Object.values(featureCodes).flat();
if (cards.size !== 13 || headings.length !== 13 || !codes.every((code) => cards.has(code))) {
  throw new Error('操作卡编号不完整或重复');
}
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
function integrity(sqlite: Database.Database) {
  assert(sqlite.pragma('integrity_check', { simple: true }) === 'ok'
    && (sqlite.pragma('foreign_key_check') as unknown[]).length === 0, 'SQLite 完整性检查失败');
}
const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const databasePath = value('--database') && resolve(value('--database')!);
const clonePath = value('--clone-to') && resolve(value('--clone-to')!);
const backupPath = value('--backup-db') && resolve(value('--backup-db')!);
const outputPath = value('--out') && resolve(value('--out')!);
const apply = args.includes('--apply');
const flags = ['--database', '--clone-to', '--backup-db', '--out'];
assert(args.every((arg, index) => arg === '--apply' || flags.includes(arg)
  || (index > 0 && flags.includes(args[index - 1]!))), '未知参数');
assert(databasePath && existsSync(databasePath), '需要 --database <v7 数据库>');
assert(!(clonePath && apply), '克隆与应用不可同时执行');
if (clonePath) {
  const inside = relative(resolve(root, '.tmp'), clonePath);
  assert(inside && inside !== '..' && !inside.startsWith('../') && !inside.startsWith('..\\')
    && !isAbsolute(inside) && !existsSync(clonePath), '隔离库须是 .tmp 中的新路径');
}
if (apply) assert(backupPath && outputPath && !existsSync(backupPath) && !existsSync(outputPath)
  && new Set([databasePath, backupPath, outputPath]).size === 3, '须使用独立且不可覆盖的备份与导出路径');

const sqlite = new Database(databasePath, { readonly: !apply, fileMustExist: true });
try {
  sqlite.pragma('foreign_keys = ON');
  const { workspace, archive } = open(sqlite);
  const baseline = () => {
    const actual = archive.exportProject(projectId);
    for (const key of ['project', 'documents', 'engineeringAssetRevisions', 'specificationRevisions', 'events'] as const) {
      assert(stable(actual[key]) === stable(expected[key]), `v7 快照已变化：${key}；须人工合并`);
    }
    return actual;
  };
  const before = baseline(); integrity(sqlite);
  const features = new Map(before.project.features.map((item: any) => [item.code, item]));
  assert(Object.keys(featureCodes).every((code) => features.get(code)?.status === 'DRAFT'
    && !before.project.capabilities.some((item: any) => item.featureId === features.get(code).id)), '目标功能已变更或已有操作卡');
  const requirements = before.project.specifications.find((item: any) => !item.featureId && item.kind === 'requirements');
  assert(requirements?.latestRevisionId && before.project.capabilities.length === 42
    && before.project.tasks.length === 0 && before.project.runs.length === 0 && before.project.reviews.length === 0,
  '需求或实施/验收记录已变更');
  const requirementsRevisionId: string = requirements.latestRevisionId;
  if (clonePath) {
    await sqlite.backup(clonePath);
    const clone = new Database(clonePath, { readonly: true, fileMustExist: true });
    try { integrity(clone); } finally { clone.close(); }
    console.log(JSON.stringify({ mode: 'clone', clonePath, cards: codes.length }));
  } else if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', cards: codes.length, code: codes, digest }));
  } else {
    await sqlite.backup(backupPath!);
    const backup = new Database(backupPath!, { readonly: true, fileMustExist: true });
    try { integrity(backup); } finally { backup.close(); }
    sqlite.transaction(() => {
      baseline();
      for (const [featureCode, operations] of Object.entries(featureCodes)) {
        const feature = features.get(featureCode);
        for (const [index, code] of operations.entries()) {
          const card = cards.get(code)!;
          const capability = workspace.createCapability(projectId, feature.id, {
            code, name: card.name, summary: card.summary, sortOrder: index,
          });
          const design = workspace.createCapabilityDesign(capability.id, {
            content: card.content, changeSummary: '分项整理输入、输出、异常、接口与数据和证据边界',
            source: `local:docs/${cardName}#${code}@sha256:${digest}`,
          });
          workspace.createTraceLink(projectId, { sourceType: 'REQUIREMENT_REVISION',
            sourceId: requirementsRevisionId, targetType: 'CAPABILITY',
            targetId: capability.id, relation: 'DERIVED_FROM' });
          workspace.createTraceLink(projectId, { sourceType: 'CAPABILITY', sourceId: capability.id,
            targetType: 'SPECIFICATION_REVISION', targetId: design.revision.id, relation: 'IMPLEMENTS' });
        }
      }
      const after = archive.exportProject(projectId);
      assert(after.project.capabilities.length === before.project.capabilities.length + codes.length
        && after.project.specifications.length === before.project.specifications.length + codes.length
        && after.specificationRevisions.length === before.specificationRevisions.length + codes.length
        && after.project.traceLinks.length === before.project.traceLinks.length + codes.length * 2
        && after.project.tasks.length === 0 && after.project.runs.length === 0 && after.project.reviews.length === 0,
      '导入后数量或实施状态异常');
      integrity(sqlite);
    }).immediate();
    try { writeFileSync(outputPath!, `${JSON.stringify(archive.exportProject(projectId), null, 2)}\n`, { flag: 'wx' }); }
    catch (error) { console.error('数据库已提交但导出失败；请检查备份，勿重跑'); throw error; }
    console.log(JSON.stringify({ mode: 'applied', cards: codes.length, backupPath, outputPath }));
  }
} finally { sqlite.close(); }
