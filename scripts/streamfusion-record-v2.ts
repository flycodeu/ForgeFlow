/** One-time StreamFusion AI record correction. Run with pnpm --filter @forgeflow/server exec tsx ../../scripts/streamfusion-record-v2.ts. */
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../apps/server/src/db/client.js';
import { ArchiveService } from '../apps/server/src/modules/archive/archive.service.js';
import { WorkspaceRepository } from '../apps/server/src/modules/workspace/workspace.repository.js';
import { WorkspaceService } from '../apps/server/src/modules/workspace/workspace.service.js';
import * as schema from '../apps/server/src/db/schema.js';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = 'D:/FlyLabs/StreamFusion AI';
const projectId = 'd03b1e52-1694-4b35-927f-078ec8a3a4f6';
const original = JSON.parse(readFileSync(resolve(root, 'docs/streamfusion-forgeflow-archive-2026-09-21.json'), 'utf8'));
const designPath = resolve(root, 'docs/streamfusion-feature-design-v2-2026-09-21.md');
const deliveryPath = resolve(root, 'docs/streamfusion-engineering-delivery-v2-2026-09-21.md');
const foundationCodes = ['P0_W01', 'P0_W01B', 'P1_W00', 'P1_A1', 'P1_INTEGRATION'];
const identityCodes = ['P1_A2', 'P1_B', 'P1_C', 'P1_C_DEPT', 'P1_D', 'P1_D_PERMISSION', 'P1_E', 'P1_F'];
const videoCodes = ['VIDEO_SOURCE', 'NODE_AGENT', 'RUNTIME', 'EVENT_EVIDENCE'];
const sourceHashes: Record<string, string> = {
  '登录与个人中心.md': '2AC55448CA6F2DD39DFC558C1E447A82BB3ADB0081F6D1178A402C798614EC9E',
  '用户管理.md': '54FF3CFE1B6A61730588A631A90CE298D9E6A3FDC9E9605A29B05BC9579D0468',
  '部门管理.md': '7B757503168B441E1FF28AF1AD6DE4218A71FD88226DD47A101CE1CCFBE0AD89',
  '角色管理.md': '39DFD109EE071B84306444BC3E34F8E49129B9943CE72A5E15389BAB4D466155',
  '权限目录.md': 'CEEAFE321E9B7245C5FEC0E86431E0C328C41AC58F26CF14B94EB623E13C6BF7',
  '菜单管理.md': 'CD35D5A21E64E76F5EA2E6D229CA5DA79630CF9B4C910FDAE8DBB3BBB8790889',
  '操作审计.md': '36741050580764950D858579985AFC9A7393504CBD32BC252E0EFF7D16D812BF',
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
const apply = args.includes('--apply');
const seedIsolated = args.includes('--seed-isolated');
assert(args.every((value, index) => ['--apply', '--seed-isolated'].includes(value) || ['--database', '--backup', '--out'].includes(value)
  || (index > 0 && ['--database', '--backup', '--out'].includes(args[index - 1]!))), '未知命令参数');
assert(!(apply && seedIsolated), '不能同时初始化和应用迁移');
assert(typeof option('--database') === 'string', '用法：--database <隔离库> [--backup <不可覆盖的迁移前 JSON> --out <v2 JSON> --apply]');
const databasePath = resolve(option('--database')!);
if (seedIsolated) {
  const underTmp = relative(resolve(root, '.tmp'), databasePath);
  assert(underTmp && underTmp !== '..' && !underTmp.startsWith('..\\') && !underTmp.startsWith('../')
    && !isAbsolute(underTmp) && !existsSync(databasePath),
    '只允许在工作区 .tmp 创建不存在的隔离库');
} else assert(existsSync(databasePath), `数据库不存在：${databasePath}`);
const backupPath = option('--backup') ? resolve(option('--backup')!) : undefined;
const outputPath = option('--out') ? resolve(option('--out')!) : undefined;
if (apply) assert(backupPath && outputPath && backupPath !== outputPath && databasePath !== backupPath
  && databasePath !== outputPath && !existsSync(backupPath) && !existsSync(outputPath), '应用迁移必须指定两个新的、不同的备份和输出路径');

const designMarkdown = readFileSync(designPath, 'utf8');
const deliveryMarkdown = readFileSync(deliveryPath, 'utf8');
assert(original.project.project.id === projectId && original.project.project.projectKey === 'STREAMFUSION_AI', '原始快照的项目标识不符');
assert(original.project.features.length === 17 && original.project.specifications.length === 22
  && original.specificationRevisions.length === 24, '原始快照数量不是 2026-09-21 的版本');
const designs = new Map<string, string>();
for (const match of designMarkdown.matchAll(/<!-- forgeflow-feature:([A-Z0-9_]+) -->\s*([\s\S]*?)\s*<!-- \/forgeflow-feature -->/g)) {
  assert(!designs.has(match[1]!), `重复设计段落：${match[1]}`);
  designs.set(match[1]!, `${match[2]!.trim()}\n`);
}
assert(designs.size === 8 && identityCodes.every((code) => designs.has(code)), 'RBAC 设计段落不完整');
for (const [filename, expected] of Object.entries(sourceHashes)) {
  const path = resolve(sourceRoot, 'docs/features/P1-W01/功能设计', filename);
  assert(hash(readFileSync(path)).toUpperCase() === expected, `原文已变更，请重新审核摘要：${path}`);
}

if (seedIsolated) {
  assert(!backupPath && !outputPath, '隔离库初始化不接受备份或输出参数');
  const connection = openDatabase(databasePath);
  try {
    const skip = new Set(['displayId', 'sources', 'recommendedFlow', 'exclusions', 'prompts', 'latestRevisionNumber',
      'approvedRevisionNumber', 'currentRevisionNo', 'canonicalStatus', 'canonicalConflicts', 'designSnapshotStatus', 'designSnapshotWarnings']);
    const dateKeys = new Set(['createdAt', 'updatedAt', 'authorizedAt', 'revokedAt', 'submittedAt', 'decidedAt',
      'requestedAt', 'startedAt', 'completedAt', 'finishedAt']);
    const jsonKeys: Record<string, string> = { scope: 'scope_json', locations: 'locations_json', structuredData: 'structured_data' };
    function insert(table: string, input: Record<string, any>) {
      const entries = Object.entries(input).filter(([key]) => !skip.has(key)).map(([key, value]) => [
        jsonKeys[key] ?? key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value === null ? null : dateKeys.has(key) ? new Date(value as string).getTime()
          : jsonKeys[key] ? JSON.stringify(value) : value,
      ] as const);
      connection.sqlite.prepare(`INSERT INTO ${table} (${entries.map(([key]) => `"${key}"`).join(',')}) VALUES (${entries.map(() => '?').join(',')})`)
        .run(...entries.map(([, value]) => value));
    }
    connection.sqlite.transaction(() => {
      connection.sqlite.pragma('defer_foreign_keys = ON');
      const p = original.project;
      insert('rd_project', p.project);
      for (const [key, table] of [['sources', 'rd_project_source'], ['modules', 'rd_module'], ['features', 'rd_feature'],
        ['specifications', 'rd_spec']] as const) for (const entry of p[key]) {
        insert(table, key === 'sources' ? { ...entry, lastIdempotencyKey: `isolated-${entry.id}` } : entry);
      }
      for (const { content, ...entry } of original.specificationRevisions) insert('rd_spec_revision', { ...entry, markdown: content });
      assert(connection.sqlite.pragma('foreign_key_check').length === 0, '隔离库重建有无效关联');
    }).immediate();
    console.log(JSON.stringify({ isolatedDatabase: databasePath, projectId, restoredFrom: 'immutable 2026-09-21 snapshot',
      features: 17, specifications: 22, revisions: 24 }));
  } finally { connection.sqlite.close(); }
  process.exit(0);
}

// Open without migrations; dry-run remains read-only even if a newer application is installed.
const sqlite = new Database(databasePath, { readonly: !apply, fileMustExist: true });
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
try {
  const row = (sql: string, ...parameters: unknown[]) => sqlite.prepare(sql).get(...parameters) as any;
  const rows = (sql: string, ...parameters: unknown[]) => sqlite.prepare(sql).all(...parameters) as any[];
  const scalar = (sql: string, ...parameters: unknown[]) => Number(row(sql, ...parameters)?.count ?? 0);
  const project = row('SELECT id, project_key AS projectKey FROM rd_project WHERE id = ?', projectId);
  assert(project?.projectKey === 'STREAMFUSION_AI', '目标项目不匹配');
  assert(scalar('SELECT count(*) AS count FROM rd_feature WHERE project_id = ?', projectId) === 17, '功能数量变化');
  assert(scalar('SELECT count(*) AS count FROM rd_module WHERE project_id = ?', projectId) === 3, '模块数量变化');
  assert(scalar('SELECT count(*) AS count FROM rd_spec WHERE project_id = ?', projectId) === 22, '资料数量变化');
  assert(scalar('SELECT count(*) AS count FROM rd_project_source WHERE project_id = ?', projectId) === 1, '源码绑定变化');
  for (const table of ['rd_source_analysis', 'rd_capability', 'rd_engineering_asset', 'rd_trace_link', 'rd_task', 'rd_ai_run',
    'rd_task_authorization', 'rd_design_review', 'rd_work_event']) {
    assert(scalar(`SELECT count(*) AS count FROM ${table} WHERE project_id = ?`, projectId) === 0, `发现额外引用：${table}`);
  }
  for (const expected of original.project.features) {
    const actual = row('SELECT id, module_id AS moduleId, code, name, status FROM rd_feature WHERE id = ? AND project_id = ?', expected.id, projectId);
    assert(actual && ['id', 'moduleId', 'code', 'name', 'status'].every((key) => actual[key] === expected[key]), `功能已变更：${expected.code}`);
    const spec = original.project.specifications.find((item: any) => item.featureId === expected.id);
    assert(spec, `原始设计缺失：${expected.code}`);
    const actualSpec = row('SELECT id, kind, title, latest_revision_id AS latestRevisionId, approved_revision_id AS approvedRevisionId FROM rd_spec WHERE id = ? AND feature_id = ? AND project_id = ?', spec.id, expected.id, projectId);
    assert(actualSpec && ['id', 'kind', 'title', 'latestRevisionId', 'approvedRevisionId'].every((key) => actualSpec[key] === spec[key]), `设计索引已变更：${expected.code}`);
    assert(!rows('SELECT id FROM rd_trace_link WHERE project_id = ? AND (source_id IN (?, ?) OR target_id IN (?, ?))',
      projectId, expected.id, spec.id, expected.id, spec.id).length, `新增追踪关系：${expected.code}`);
  }
  for (const spec of original.project.specifications) {
    const actual = row(`SELECT id, project_id AS projectId, feature_id AS featureId, capability_id AS capabilityId,
      kind, title, latest_revision_id AS latestRevisionId, approved_revision_id AS approvedRevisionId
      FROM rd_spec WHERE id = ? AND project_id = ?`, spec.id, projectId);
    assert(actual && ['id', 'projectId', 'featureId', 'capabilityId', 'kind', 'title', 'latestRevisionId', 'approvedRevisionId']
      .every((key) => actual[key] === spec[key]), `资料已变更：${spec.title}`);
    const revisions = rows('SELECT id, revision_no AS revisionNo, markdown AS content, content_hash AS contentHash FROM rd_spec_revision WHERE spec_id = ? ORDER BY revision_no', spec.id);
    const old = original.specificationRevisions.filter((item: any) => item.specId === spec.id)
      .sort((a: any, b: any) => a.revisionNo - b.revisionNo);
    assert(revisions.length === old.length && old.length > 0 && old.every((entry: any, index: number) =>
      ['id', 'revisionNo', 'content', 'contentHash'].every((key) => revisions[index]![key] === entry[key])
      && hash(entry.content) === entry.contentHash), `资料历史已变更：${spec.title}`);
  }
  assert(scalar('SELECT count(*) AS count FROM rd_spec_revision WHERE spec_id IN (SELECT id FROM rd_spec WHERE project_id = ?)', projectId) === 24,
    '项目设计版本数量变化');
  assert(rows('PRAGMA foreign_key_check').length === 0, '迁移前外键不完整');

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', databasePath, projectId,
    removeFoundationFeatures: foundationCodes, preserveDetachedRevisions: 9, addRbacRevisions: identityCodes.length,
    videoCandidatesWithoutDesign: videoCodes, designSourceHashes: sourceHashes }, null, 2));
  if (apply) {
    const connection = { sqlite, db: drizzle({ client: sqlite, schema }) };
    const workspace = new WorkspaceService(new WorkspaceRepository(connection));
    const archive = new ArchiveService(connection, workspace);
    const before = archive.exportProject(projectId);
    assert(before.project.features.length === 17 && before.specificationRevisions.length === 24, '备份前再次读取失败');
    writeFileSync(backupPath!, `${JSON.stringify(before, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    const now = Date.now();
    sqlite.transaction(() => {
      for (const code of [...foundationCodes, ...videoCodes]) {
        const feature = original.project.features.find((item: any) => item.code === code)!;
        const spec = original.project.specifications.find((item: any) => item.featureId === feature.id)!;
        const kind = `${foundationCodes.includes(code) ? 'legacy-delivery' : 'candidate-video'}-${code}`;
        assert(sqlite.prepare('UPDATE rd_spec SET feature_id = NULL, kind = ? WHERE id = ? AND feature_id = ?').run(kind, spec.id, feature.id).changes === 1,
          `无法保留旧设计：${code}`);
        if (foundationCodes.includes(code)) {
          assert(sqlite.prepare('DELETE FROM rd_feature WHERE id = ? AND project_id = ?').run(feature.id, projectId).changes === 1,
            `无法移出基础工作包：${code}`);
        }
      }
      for (const code of identityCodes) {
        const feature = original.project.features.find((item: any) => item.code === code)!;
        const spec = original.project.specifications.find((item: any) => item.featureId === feature.id)!;
        const content = designs.get(code)!;
        const revisionId = randomUUID();
        const nextRevisionNo = Math.max(...original.specificationRevisions.filter((entry: any) => entry.specId === spec.id)
          .map((entry: any) => entry.revisionNo)) + 1;
        sqlite.prepare(`INSERT INTO rd_spec_revision
          (id, spec_id, revision_no, markdown, content_hash, source, change_summary, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(revisionId, spec.id, nextRevisionNo, content, hash(content),
          'codex:streamfusion-record-v2-2026-09-21', '以原仓库功能设计提炼行为、失败及待执行验收；保留初版状态摘要', now);
        assert(sqlite.prepare('UPDATE rd_spec SET title = ?, latest_revision_id = ? WHERE id = ? AND latest_revision_id = ?')
          .run(`${feature.name}功能设计摘要`, revisionId, spec.id, spec.latestRevisionId).changes === 1, `设计版本并发变化：${code}`);
      }
      const assetId = randomUUID();
      const revisionId = randomUUID();
      const metadata = { title: '工程交付与证据边界', originalFilename: 'streamfusion-engineering-delivery-v2-2026-09-21.md',
        sourcePath: deliveryPath, contentType: 'text/markdown' };
      const structuredData = JSON.stringify(metadata);
      sqlite.prepare(`INSERT INTO rd_engineering_asset
        (id, project_id, kind, name, summary, structured_data, content_markdown, status, current_revision_id, created_at, updated_at)
        VALUES (?, ?, 'PROJECT_DOCUMENT', ?, '', ?, ?, 'ARCHIVED', NULL, ?, ?)`).run(assetId, projectId, metadata.title,
        structuredData, deliveryMarkdown, now, now);
      sqlite.prepare(`INSERT INTO rd_engineering_asset_revision
        (id, asset_id, revision_no, structured_data, content_markdown, content_hash, source, change_summary, created_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`).run(revisionId, assetId, structuredData, deliveryMarkdown,
        hash(`${stableJson(metadata)}\n${deliveryMarkdown}`), 'codex:streamfusion-record-v2-2026-09-21',
        '把五个工程工作包从功能树移入工程交付资料，并说明历史证据边界', now);
      sqlite.prepare('UPDATE rd_engineering_asset SET current_revision_id = ? WHERE id = ?').run(revisionId, assetId);
      assert(rows('PRAGMA foreign_key_check').length === 0, '迁移后外键不完整');
      assert(scalar('SELECT count(*) AS count FROM rd_feature WHERE project_id = ?', projectId) === 12, '迁移后功能数量错误');
    }).immediate();
    const after = archive.exportProject(projectId);
    assert(after.project.features.length === 12 && after.project.specifications.length === 22
      && after.specificationRevisions.length === 32 && after.documents.length === 1, 'v2 导出结构不符');
    writeFileSync(outputPath!, `${JSON.stringify(after, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({ backupPath, outputPath, features: 12, specifications: 22,
      revisions: 32, projectDocuments: 1, foreignKeyCheck: 'PASS', integrityCheck: row('PRAGMA integrity_check')?.integrity_check }, null, 2));
  }
} finally { sqlite.close(); }
