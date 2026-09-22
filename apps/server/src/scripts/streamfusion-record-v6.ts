/** One-time, v5-snapshot-checked refresh of the StreamFusion design record. */
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
const expected = JSON.parse(readFileSync(resolve(root, 'docs/streamfusion-forgeflow-desktop-v5-2026-09-22.json'), 'utf8'));
const documentNames = {
  background: 'streamfusion-v6-background.md',
  requirements: 'streamfusion-v6-requirements.md',
  research: 'streamfusion-v6-research.md',
} as const;
const featureCodes: Record<string, string[]> = {
  P1_A2: ['A-01'],
  P1_B: ['A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07'],
  P1_C: ['U-01', 'U-02', 'U-03', 'U-04', 'U-05', 'U-06', 'U-07', 'U-08', 'U-09'],
  P1_C_DEPT: ['D-01', 'D-02', 'D-03', 'D-04', 'D-05'],
  P1_D: ['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06'],
  P1_D_PERMISSION: ['P-01', 'P-02', 'P-03'],
  P1_E: ['M-01', 'M-02', 'M-03', 'M-04', 'M-05', 'M-06', 'M-07', 'M-08'],
  P1_F: ['AU-01', 'AU-02', 'AU-03', 'AU-04'],
};
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function assertBaseline(actual: typeof expected) {
  for (const key of ['project', 'documents', 'engineeringAssetRevisions', 'specificationRevisions', 'events'] as const) {
    assert(stable(actual[key]) === stable(expected[key]), `项目与 v5 快照不一致：${key}；须人工合并`);
  }
}
function openArchive(sqlite: Database.Database) {
  const connection = { sqlite, db: drizzle({ client: sqlite, schema }) };
  const workspace = new WorkspaceService(new WorkspaceRepository(connection));
  return { workspace, archive: new ArchiveService(connection, workspace) };
}
function assertIntegrity(sqlite: Database.Database) {
  assert(sqlite.pragma('integrity_check', { simple: true }) === 'ok'
    && (sqlite.pragma('foreign_key_check') as unknown[]).length === 0, 'SQLite 完整性或外键检查失败');
}

const cardPath = 'docs/streamfusion-v6-operation-cards.md';
const cardBytes = readFileSync(resolve(root, cardPath));
const cardMarkdown = cardBytes.toString('utf8');
const cardHash = hash(cardBytes);
const headings = [...cardMarkdown.matchAll(/^## ((?:AU|A|U|D|R|P|M)-\d{2}) (.+)\r?$/gm)];
const cards = new Map<string, { name: string; content: string; summary: string }>();
for (const [index, heading] of headings.entries()) {
  const code = heading[1]!;
  assert(!cards.has(code), `重复操作编号：${code}`);
  const content = cardMarkdown.slice(heading.index!, headings[index + 1]?.index ?? cardMarkdown.length).trim();
  const sections = ['输入字段', '输出与状态', '处理与异常', '接口与数据', '验收要点'];
  for (const section of sections) assert(content.includes(`### ${section}\n`), `${code} 缺少 ${section}`);
  const summary = content.split(/\r?\n/).find((line, row) => row > 0 && line.trim())?.trim();
  assert(summary && summary.length > 10, `${code} 缺少具体目标`);
  cards.set(code, { name: heading[2]!.trim(), content: `${content}\n`, summary });
}
const codes = Object.values(featureCodes).flat();
assert(headings.length === 42 && codes.length === 42 && cards.size === 42
  && codes.every((code) => cards.has(code)), 'v6 卡片与 42 项操作清单不一致');
const featurePath = 'docs/streamfusion-v6-feature-summaries.md';
const featureBytes = readFileSync(resolve(root, featurePath));
const featureMarkdown = featureBytes.toString('utf8');
const featureHash = hash(featureBytes);
const featureSections = [...featureMarkdown.matchAll(/<!-- forgeflow-feature:(P1_[A-Z0-9_]+) -->\r?\n([\s\S]*?)\r?\n<!-- \/forgeflow-feature -->/g)];
const featureContent = new Map(featureSections.map((match) => [match[1]!, `${match[2]!.trim()}\n`]));
assert(featureSections.length === 8 && featureContent.size === 8
  && Object.entries(featureCodes).every(([code, items]) => {
    const content = featureContent.get(code);
    return content && ['范围与操作入口', '共同边界', '未决与证据'].every((title) => content.includes(`## ${title}`))
      && items.every((item) => content.includes(item));
  }), '八个 Feature 摘要与操作清单不匹配');
const documents = Object.fromEntries(Object.entries(documentNames).map(([kind, name]) => {
  const bytes = readFileSync(resolve(root, 'docs', name));
  assert(bytes.length > 500, `项目资料内容不足：${name}`);
  return [kind, { name, content: bytes.toString('utf8'), hash: hash(bytes) }];
})) as Record<keyof typeof documentNames, { name: string; content: string; hash: string }>;

const args = process.argv.slice(2);
const value = (flag: string) => { const at = args.indexOf(flag); return at < 0 ? undefined : args[at + 1]; };
const apply = args.includes('--apply');
const databasePath = value('--database') && resolve(value('--database')!);
const clonePath = value('--clone-to') && resolve(value('--clone-to')!);
const backupPath = value('--backup-db') && resolve(value('--backup-db')!);
const outputPath = value('--out') && resolve(value('--out')!);
const flags = ['--database', '--clone-to', '--backup-db', '--out'];
assert(args.every((arg, index) => arg === '--apply' || flags.includes(arg)
  || (index > 0 && flags.includes(args[index - 1]!))), '未知命令参数');
assert(databasePath && existsSync(databasePath), '用法：--database <现有库> [--clone-to <.tmp/新库> | --apply --backup-db <新库> --out <新 JSON>]');
assert(!(clonePath && apply), '克隆和迁移不能同时执行');
if (clonePath) {
  const inside = relative(resolve(root, '.tmp'), clonePath);
  assert(inside && inside !== '..' && !inside.startsWith('../') && !inside.startsWith('..\\')
    && !isAbsolute(inside) && !existsSync(clonePath), '隔离克隆只能创建在工作区 .tmp 的新路径');
}
if (apply) {
  assert(backupPath && outputPath && !existsSync(backupPath) && !existsSync(outputPath)
    && new Set([databasePath, backupPath, outputPath]).size === 3,
  '迁移须提供不可覆盖的独立 SQLite 备份和项目导出路径');
}

const sqlite = new Database(databasePath, { readonly: !apply, fileMustExist: true });
try {
  sqlite.pragma('foreign_keys = ON');
  const { archive, workspace } = openArchive(sqlite);
  const before = archive.exportProject(projectId);
  assertBaseline(before);
  assertIntegrity(sqlite);
  const capabilityByCode = new Map(before.project.capabilities.map((item: any) => [item.code, item]));
  assert(capabilityByCode.size === 42 && codes.every((code) => capabilityByCode.has(code)), '现有操作编号不匹配');
  const featureByCode = new Map(before.project.features.map((item: any) => [item.code, item]));
  assert(Object.keys(featureCodes).every((code) => featureByCode.get(code)?.status === 'DESIGNING'), '八个 Feature 不在设计阶段');
  const specByCapability = new Map(before.project.specifications.filter((item: any) => item.capabilityId)
    .map((item: any) => [item.capabilityId, item]));
  const featureSpecs = new Map(before.project.specifications.filter((item: any) => item.featureId && !item.capabilityId)
    .map((item: any) => [item.featureId, item]));
  const projectSpecs = new Map(before.project.specifications.filter((item: any) => !item.featureId)
    .map((item: any) => [item.kind, item]));
  for (const [featureCode, operationCodes] of Object.entries(featureCodes)) {
    const feature = featureByCode.get(featureCode);
    assert(featureSpecs.get(feature.id)?.latestRevisionId, `功能设计缺失：${featureCode}`);
    for (const code of operationCodes) {
      const capability = capabilityByCode.get(code);
      assert(capability.featureId === feature.id && capability.status === 'DESIGNED'
        && specByCapability.get(capability.id)?.latestRevisionId, `操作归属或设计缺失：${code}`);
    }
  }
  for (const kind of Object.keys(documentNames)) assert(projectSpecs.get(kind)?.latestRevisionId, `项目资料缺失：${kind}`);
  assert(before.project.tasks.length === 0 && before.project.runs.length === 0
    && before.project.reviews.length === 0, '存在实施或评审证据，须人工复核');
  if (clonePath) {
    await sqlite.backup(clonePath);
    const clone = new Database(clonePath, { readonly: true, fileMustExist: true });
    try {
      assertIntegrity(clone);
      assertBaseline(openArchive(clone).archive.exportProject(projectId));
    } finally { clone.close(); }
    console.log(JSON.stringify({ mode: 'clone', clonePath, baseline: 'v5', cards: 42 }));
  } else if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', databasePath, baseline: 'v5', cards: 42,
      projectRevisions: 3, featureRevisions: 8, capabilityRevisions: 42, requirementLinks: 42, archiveDocuments: 0,
      cardSha256: cardHash, featureSha256: featureHash }));
  } else {
    // Online backup captures a consistent WAL snapshot before taking the write lock.
    await sqlite.backup(backupPath!);
    const backup = new Database(backupPath!, { readonly: true, fileMustExist: true });
    try {
      assertIntegrity(backup);
      assertBaseline(openArchive(backup).archive.exportProject(projectId));
    } finally { backup.close(); }
    sqlite.transaction(() => {
      assertBaseline(archive.exportProject(projectId));
      const projectRevisions = new Map<string, string>();
      for (const [kind, doc] of Object.entries(documents)) {
        const spec = projectSpecs.get(kind)!;
        const revision = workspace.createRevision(projectId, spec.id, {
          content: doc.content, expectedHeadRevisionId: spec.latestRevisionId,
          changeSummary: '聚焦当前阶段的问题、任务和调研依据；历史版本保留',
          source: `local:docs/${doc.name}@sha256:${doc.hash}`,
        });
        projectRevisions.set(kind, revision.id);
      }
      for (const [featureCode, operationCodes] of Object.entries(featureCodes)) {
        const feature = featureByCode.get(featureCode)!;
        const spec = featureSpecs.get(feature.id)!;
        assert(operationCodes.every((code) => featureContent.get(featureCode)!.includes(code)), `Feature 操作索引不完整：${featureCode}`);
        workspace.createRevision(projectId, spec.id, { content: featureContent.get(featureCode)!,
          expectedHeadRevisionId: spec.latestRevisionId, changeSummary: '按八个功能边界整理操作目录，逐操作内容移至 Capability 当前设计',
          source: `local:${featurePath}#${featureCode}@sha256:${featureHash}` });
      }
      for (const code of codes) {
        const capability = capabilityByCode.get(code)!;
        const spec = specByCapability.get(capability.id)!;
        const revision = workspace.createRevision(projectId, spec.id, {
          content: cards.get(code)!.content, expectedHeadRevisionId: spec.latestRevisionId,
          changeSummary: '逐操作明确输入字段、结果、异常、接口/表和待执行验收；旧设计保留',
          source: `local:${cardPath}#${code}@sha256:${cardHash}`,
        });
        workspace.createTraceLink(projectId, { sourceType: 'REQUIREMENT_REVISION',
          sourceId: projectRevisions.get('requirements')!, targetType: 'CAPABILITY',
          targetId: capability.id, relation: 'DERIVED_FROM' });
        workspace.createTraceLink(projectId, { sourceType: 'CAPABILITY', sourceId: capability.id,
          targetType: 'SPECIFICATION_REVISION', targetId: revision.id, relation: 'IMPLEMENTS' });
      }
      const after = archive.exportProject(projectId);
      assert(after.project.capabilities.length === 42 && after.project.specifications.length === 64
        && after.specificationRevisions.length === before.specificationRevisions.length + 53
        && after.project.traceLinks.length === before.project.traceLinks.length + 84
        && after.documents.length === before.documents.length
        && after.project.features.filter((item: any) => item.status === 'DESIGNING').length === 8
        && after.project.tasks.length === 0 && after.project.runs.length === 0
        && after.project.reviews.length === 0, '迁移后数量或设计状态异常');
      assertIntegrity(sqlite);
    }).immediate();
    try { writeFileSync(outputPath!, `${JSON.stringify(archive.exportProject(projectId), null, 2)}\n`, { flag: 'wx' }); }
    catch (error) { console.error('数据库已经提交但导出失败，请核对库与备份；不能直接重跑。'); throw error; }
    console.log(JSON.stringify({ mode: 'applied', backupPath, outputPath, cards: 42,
      specificationRevisions: before.specificationRevisions.length + 53,
      traceLinks: before.project.traceLinks.length + 84, archiveDocuments: before.documents.length }));
  }
} finally { sqlite.close(); }
