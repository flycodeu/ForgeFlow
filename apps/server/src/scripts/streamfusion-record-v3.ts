/** One-time, source-checked upgrade of the StreamFusion AI project record. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { ArchiveService } from '../modules/archive/archive.service.js';
import { WorkspaceRepository } from '../modules/workspace/workspace.repository.js';
import { WorkspaceService } from '../modules/workspace/workspace.service.js';
import * as schema from '../db/schema.js';

const require = createRequire(new URL('../../package.json', import.meta.url));
const Database = require('better-sqlite3');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sourceRoot = 'D:/FlyLabs/StreamFusion AI';
const projectId = 'd03b1e52-1694-4b35-927f-078ec8a3a4f6';
const expected = JSON.parse(readFileSync(resolve(root, 'docs/streamfusion-forgeflow-desktop-v2-2026-09-21.json'), 'utf8'));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex').toUpperCase();
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const files = [
  { feature: 'P1_A2', codes: ['A-01'], path: 'docs/features/P1-W01/功能设计/登录与个人中心.md', sha: '2AC55448CA6F2DD39DFC558C1E447A82BB3ADB0081F6D1178A402C798614EC9E' },
  { feature: 'P1_B', codes: ['A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07'], path: 'docs/features/P1-W01/功能设计/登录与个人中心.md', sha: '2AC55448CA6F2DD39DFC558C1E447A82BB3ADB0081F6D1178A402C798614EC9E' },
  { feature: 'P1_C', codes: ['U-01', 'U-02', 'U-03', 'U-04', 'U-05', 'U-06', 'U-07', 'U-08', 'U-09'], path: 'docs/features/P1-W01/功能设计/用户管理.md', sha: '54FF3CFE1B6A61730588A631A90CE298D9E6A3FDC9E9605A29B05BC9579D0468' },
  { feature: 'P1_C_DEPT', codes: ['D-01', 'D-02', 'D-03', 'D-04', 'D-05'], path: 'docs/features/P1-W01/功能设计/部门管理.md', sha: '7B757503168B441E1FF28AF1AD6DE4218A71FD88226DD47A101CE1CCFBE0AD89' },
  { feature: 'P1_D', codes: ['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06'], path: 'docs/features/P1-W01/功能设计/角色管理.md', sha: '39DFD109EE071B84306444BC3E34F8E49129B9943CE72A5E15389BAB4D466155' },
  { feature: 'P1_D_PERMISSION', codes: ['P-01', 'P-02', 'P-03'], path: 'docs/features/P1-W01/功能设计/权限目录.md', sha: 'CEEAFE321E9B7245C5FEC0E86431E0C328C41AC58F26CF14B94EB623E13C6BF7' },
  { feature: 'P1_E', codes: ['M-01', 'M-02', 'M-03', 'M-04', 'M-05', 'M-06', 'M-07', 'M-08'], path: 'docs/features/P1-W01/功能设计/菜单管理.md', sha: 'CD35D5A21E64E76F5EA2E6D229CA5DA79630CF9B4C910FDAE8DBB3BBB8790889' },
  { feature: 'P1_F', codes: ['AU-01', 'AU-02', 'AU-03', 'AU-04'], path: 'docs/features/P1-W01/功能设计/操作审计.md', sha: '36741050580764950D858579985AFC9A7393504CBD32BC252E0EFF7D16D812BF' },
] as const;
const tables = [
  { name: 'sys_dept', feature: 'P1_C_DEPT', sql: '部门表.sql', card: '部门表.md' },
  { name: 'sys_user', feature: 'P1_C', sql: '用户表.sql', card: '用户表.md' },
  { name: 'sys_role', feature: 'P1_D', sql: '角色表.sql', card: '角色表.md' },
  { name: 'sys_permission', feature: 'P1_D_PERMISSION', sql: '权限表.sql', card: '权限表.md' },
  { name: 'sys_menu', feature: 'P1_E', sql: '菜单表.sql', card: '菜单表.md' },
  { name: 'sys_user_role', feature: 'P1_C', sql: '用户角色关联表.sql', card: '用户角色关联表.md' },
  { name: 'sys_role_permission', feature: 'P1_D', sql: '角色权限关联表.sql', card: '角色权限关联表.md' },
  { name: 'sys_operation_log', feature: 'P1_F', sql: '操作审计表.sql', card: '操作审计表.md' },
] as const;
type Operation = { code: string; name: string; content: string; feature: string; sourcePath: string; sourceHash: string };
const readSource = (path: string) => readFileSync(resolve(sourceRoot, path), 'utf8');
const model = readFileSync(resolve(root, 'docs/streamfusion-v3-data-model.md'), 'utf8');
const modelSections = [...model.matchAll(/^## \d+\. `(sys_\w+)`[^\n]*\n/gm)];
assert(modelSections.length === 8, '八表资料章节数量不符');
const modelByTable = new Map(modelSections.map((match, index) => [match[1]!, model.slice(match.index!, modelSections[index + 1]?.index ?? model.indexOf('## 跨表实施门槛')).trim()]));
for (const table of tables) {
  const line = model.split('\n').find((item) => item.startsWith(`| \`${table.name}\` |`));
  assert(line && modelByTable.has(table.name), `表资料缺失：${table.name}`);
  const hashes = [...line.matchAll(/[A-F0-9]{64}/g)].map((item) => item[0]);
  assert(hashes.length === 2, `表资料 hash 缺失：${table.name}`);
  assert(hash(readFileSync(resolve(sourceRoot, 'platform-api/sql/业务', table.sql))) === hashes[0], `SQL 已变化：${table.sql}`);
  assert(hash(readFileSync(resolve(sourceRoot, 'docs/features/P1-W01', table.card))) === hashes[1], `表卡已变化：${table.card}`);
}

const operations: Operation[] = [];
const uniqueFiles = new Map<string, string>();
for (const group of files) {
  const content = readSource(group.path);
  assert(hash(readFileSync(resolve(sourceRoot, group.path))) === group.sha, `功能原文已变化：${group.path}`);
  uniqueFiles.set(group.path, content);
  if (group.feature === 'P1_A2' || group.feature === 'P1_B') {
    const rows = new Map([...content.matchAll(/^\| (A-\d{2}) \| ([^|]+) \|[^\n]+$/gm)].map((match) => [match[1]!, { name: match[2]!.trim(), row: match[0] }]));
    const detailSections = new Map([
      ['A-01', content.slice(content.indexOf('## 2. A-01'), content.indexOf('## 3. A-04'))],
      ['A-04', content.slice(content.indexOf('## 3. A-04'), content.indexOf('## 3A. A-05'))],
      ['A-05', content.slice(content.indexOf('## 3A. A-05'), content.indexOf('## 4. 会话'))],
    ]);
    const shared = content.slice(content.indexOf('## 4. 会话'), content.indexOf('## 5. 实施'));
    for (const code of group.codes) {
      const row = rows.get(code);
      const acceptance = content.split('\n').find((line) => line.startsWith(`- ${code}：`));
      assert(row && acceptance, `认证操作缺失：${code}`);
      const detail = detailSections.get(code) ?? shared;
      assert(detail && !detail.includes('undefined'), `认证细节缺失：${code}`);
      operations.push({ code, name: row.name, feature: group.feature, sourcePath: group.path, sourceHash: group.sha,
        content: `# ${code} ${row.name}\n\n## 操作输入与结果\n\n| 编号 | 功能 | 输入与处理 | 成功结果 | 失败处理 |\n|---|---|---|---|---|\n${row.row}\n\n## 处理与边界\n\n${detail.trim()}\n\n## 验收用例\n\n${acceptance}\n` });
    }
  } else {
    const headings = [...content.matchAll(/^### ((?:U|D|R|P|M|AU)-\d{2}) (.+)$/gm)];
    assert(headings.length === group.codes.length, `操作章节数量不符：${group.path}`);
    for (const [index, match] of headings.entries()) {
      const code = match[1]!;
      assert(code === group.codes[index], `操作顺序不符：${group.path} ${code}`);
      const remainder = content.slice(match.index! + match[0].length);
      const boundary = /^#{2,3} /gm.exec(remainder);
      const section = remainder.slice(0, boundary?.index ?? remainder.length).trim();
      const acceptance = content.split('\n').filter((line) => line.startsWith(`| ${code} |`) && !section.includes(line));
      assert(section.length > 80, `操作内容不足：${code}`);
      operations.push({ code, name: match[2]!.trim(), feature: group.feature, sourcePath: group.path, sourceHash: group.sha,
        content: `# ${code} ${match[2]!.trim()}\n\n${section}\n${acceptance.length ? `\n## 原文验收矩阵\n\n${acceptance.join('\n')}\n` : ''}` });
    }
  }
}
assert(operations.length === 42 && new Set(operations.map((item) => item.code)).size === 42, '42 项操作不完整');
const userDesign = uniqueFiles.get('docs/features/P1-W01/功能设计/用户管理.md')!;
const userCommon = [
  userDesign.slice(userDesign.indexOf('## 2. 谁能操作'), userDesign.indexOf('## 3. 功能明细')),
  userDesign.slice(userDesign.indexOf('## 4. 操作共同结果'), userDesign.indexOf('## 5. 验收用例')),
].join('\n').trim();
const apiPath = 'docs/design/P1-W01-api-contracts.md';
const apiContract = readSource(apiPath);
const userApi = apiContract.slice(apiContract.indexOf('## 3. 用户接口'), apiContract.indexOf('## 4. 部门接口'));
assert(userCommon.length > 500 && userApi.includes('POST /users'), '用户公共规则或接口契约缺失');
const userApiPaths: Record<string, string[]> = {
  'U-01': ['GET /users |'], 'U-02': ['GET /users/{id} |', 'GET /users/{id}/roles |', 'GET /users/{id}/access |'],
  'U-03': ['POST /users |'], 'U-04': ['PUT /users/{id} |'], 'U-05': ['PUT /users/{id}/department |'],
  'U-06': ['GET /users/{id}/roles |', 'PUT /users/{id}/roles |'],
  'U-07': ['POST /users/{id}:enable'], 'U-08': ['POST /users/{id}:reset-password |'],
  'U-09': ['DELETE /users/{id} |'],
};
const userTables: Record<string, string[]> = {
  'U-01': ['sys_user', 'sys_dept', 'sys_role', 'sys_user_role'],
  'U-02': ['sys_user', 'sys_user_role', 'sys_role', 'sys_role_permission', 'sys_permission'],
  'U-03': ['sys_user', 'sys_dept', 'sys_role', 'sys_user_role', 'sys_operation_log'],
  'U-04': ['sys_user', 'sys_operation_log'],
  'U-05': ['sys_user', 'sys_dept', 'sys_operation_log'],
  'U-06': ['sys_user', 'sys_user_role', 'sys_role', 'sys_role_permission', 'sys_operation_log'],
  'U-07': ['sys_user', 'sys_user_role', 'sys_role', 'sys_operation_log'],
  'U-08': ['sys_user', 'sys_operation_log'],
  'U-09': ['sys_user', 'sys_user_role', 'sys_role', 'sys_operation_log'],
};
const fieldMappings: Record<string, string> = {
  'U-03': 'username → sys_user.username（唯一）；nickname → sys_user.nickname；avatarKey → sys_user.avatar_key；deptId → sys_user.dept_id，须检查 sys_dept.id；roleIds → sys_user_role(user_id, role_id)，须检查 sys_role.id 和可授予范围；初始密码仅由后端生成 hash 存入 sys_user.password_hash，must_change_password=true；成功审计 → sys_operation_log。当前 SQL 的软删字段与目标硬删不同，不能将表存在视为业务已实现。',
  'U-04': 'nickname → sys_user.nickname；avatarKey → sys_user.avatar_key；version → sys_user.version 作并发条件，成功后递增；sys_user.username/dept_id/status/session_version/password_hash 不由本操作修改；成功审计 → sys_operation_log。',
  'U-09': 'If-Match → sys_user.version；先清 sys_user_role 中 user_id 对应关系，再硬删除 sys_user.id，成功审计保留旧 target_id；旧会话按旧用户 ID 失效，同名新建取得新 ID。当前 sys_operation_log 没有明确的账号/名称摘要字段，目标审计展示仍待设计与增量迁移。',
};
for (const op of operations) {
  const requirement = readFileSync(resolve(root, 'docs/streamfusion-v3-requirements.md'), 'utf8').split('\n')
    .find((line) => line.startsWith(`| ${op.code} |`));
  assert(requirement, `需求索引缺失：${op.code}`);
  op.content += `\n## 对应需求与来源\n\n${requirement}\n\n功能原文：${op.sourcePath}（SHA-256 ${op.sourceHash}）。本页是设计记录，尚未批准、实施或执行验收。\n`;
  if (!op.code.startsWith('U-')) continue;
  const lines = userApiPaths[op.code]!.flatMap((path) => userApi.split('\n').filter((line) => line.startsWith(`| ${path}`)));
  assert(lines.length === userApiPaths[op.code]!.length, `用户接口契约缺失：${op.code}`);
  op.content += `\n## 接口与数据关系\n\n| 方法/路径 | 输入 | 成功 | 权限 |\n|---|---|---|---|\n${lines.join('\n')}\n\n涉及表：${userTables[op.code]!.map((table) => `\`${table}\``).join('、')}。表的完整字段、约束、索引见同项目数据模型；接口详细响应和错误见 ${apiPath}（SHA-256 ${hash(readFileSync(resolve(sourceRoot, apiPath)))}）。\n`;
  if (fieldMappings[op.code]) op.content += `\n字段到当前表列及目标差异：${fieldMappings[op.code]}\n`;
  op.content += `\n## 用户管理共同规则\n\n${userCommon}\n`;
}
const projectDocuments = [
  ['background', 'streamfusion-v3-background.md'], ['requirements', 'streamfusion-v3-requirements.md'],
  ['research', 'streamfusion-v3-research.md'], ['architecture', 'streamfusion-v3-architecture.md'],
  ['technology', 'streamfusion-v3-technology.md'],
] as const;

const args = process.argv.slice(2);
const option = (name: string) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const apply = args.includes('--apply');
const databasePath = option('--database') && resolve(option('--database')!);
const backupJson = option('--backup-json') && resolve(option('--backup-json')!);
const backupDb = option('--backup-db') && resolve(option('--backup-db')!);
const outputPath = option('--out') && resolve(option('--out')!);
const clonePath = option('--clone-to') && resolve(option('--clone-to')!);
assert(args.every((arg, index) => ['--apply'].includes(arg) || ['--database', '--backup-json', '--backup-db', '--out', '--clone-to'].includes(arg)
  || (index > 0 && ['--database', '--backup-json', '--backup-db', '--out', '--clone-to'].includes(args[index - 1]!))), '未知命令参数');
assert(databasePath && existsSync(databasePath), '用法：--database <现有库> [--clone-to <新隔离库> | --apply --backup-json <新文件> --backup-db <新文件> --out <新文件>]');
assert(!(clonePath && apply), '克隆和应用不能同时执行');
if (clonePath) {
  const underTmp = relative(resolve(root, '.tmp'), clonePath);
  assert(underTmp && underTmp !== '..' && !underTmp.startsWith('../') && !underTmp.startsWith('..\\')
    && !isAbsolute(underTmp) && !existsSync(clonePath), '隔离克隆只能创建在工作区 .tmp 的新文件');
}
if (apply) {
  assert(backupJson && backupDb && outputPath && new Set([databasePath, backupJson, backupDb, outputPath]).size === 4
    && !existsSync(backupJson) && !existsSync(backupDb) && !existsSync(outputPath), '应用时需指定三个不可覆盖的独立备份/输出路径');
}

const sqlite = new Database(databasePath, { readonly: !apply });
try {
  sqlite.pragma('foreign_keys = ON');
  const connection = { sqlite, db: drizzle({ client: sqlite, schema }) };
  const workspace = new WorkspaceService(new WorkspaceRepository(connection));
  const archive = new ArchiveService(connection, workspace);
  const before = archive.exportProject(projectId);
  for (const key of ['project', 'documents', 'engineeringAssetRevisions', 'specificationRevisions', 'events'] as const) {
    assert(stable(before[key]) === stable(expected[key]), `桌面库自 v2 快照后已有变更：${key}；请人工合并`);
  }
  assert(before.project.capabilities.length === 0 && before.project.tasks.length === 0 && before.project.runs.length === 0
    && before.project.reviews.length === 0 && before.project.traceLinks.length === 0, '已有操作或证据，拒绝覆盖');
  assert(sqlite.pragma('integrity_check', { simple: true }) === 'ok' && sqlite.pragma('foreign_key_check').length === 0, '迁移前数据库不完整');
  if (clonePath) {
    await sqlite.backup(clonePath);
    console.log(JSON.stringify({ mode: 'clone', clonePath, operations: operations.length, tables: tables.length }));
  } else if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', databasePath, operations: operations.length, tables: tables.length,
      sourceDocuments: uniqueFiles.size, projectRevisions: projectDocuments.length, currentFeatures: before.project.features.length }));
  } else {
    writeFileSync(backupJson!, `${JSON.stringify(before, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await sqlite.backup(backupDb!);
    const backup = new Database(backupDb!, { readonly: true });
    try { assert(backup.pragma('integrity_check', { simple: true }) === 'ok'
      && backup.pragma('foreign_key_check').length === 0, '迁移前数据库备份不完整'); }
    finally { backup.close(); }
    sqlite.transaction(() => {
      const locked = archive.exportProject(projectId);
      for (const key of ['project', 'documents', 'engineeringAssetRevisions', 'specificationRevisions', 'events'] as const) {
        assert(stable(locked[key]) === stable(expected[key]), `写入前项目已有变更：${key}`);
      }
      const featureByCode = new Map(before.project.features.map((item: any) => [item.code, item]));
      const specByKind = new Map(before.project.specifications.filter((item: any) => !item.featureId).map((item: any) => [item.kind, item]));
      const updatedProjectDocs = new Map<string, string>();
      for (const [kind, filename] of projectDocuments) {
        const spec: any = specByKind.get(kind);
        assert(spec?.latestRevisionId, `项目资料缺失：${kind}`);
        const content = readFileSync(resolve(root, 'docs', filename), 'utf8');
        const revision = workspace.createRevision(projectId, spec.id, { content,
          changeSummary: '按目标、需求、调研、架构和技术职责重新整理；旧版本保留',
          expectedHeadRevisionId: spec.latestRevisionId, source: `import:${filename}@sha256:${hash(content)}` });
        updatedProjectDocs.set(kind, revision.id);
      }
      const capabilityByCode = new Map<string, { id: string; featureId: string; revisionId: string }>();
      for (const group of files) {
        const feature: any = featureByCode.get(group.feature);
        assert(feature?.status === 'DESIGNING', `功能状态变化：${group.feature}`);
        const spec: any = before.project.specifications.find((item: any) => item.featureId === feature.id && !item.capabilityId);
        assert(spec?.latestRevisionId, `功能设计缺失：${group.feature}`);
        const text = uniqueFiles.get(group.path)!;
        const heading = text.indexOf('## 1.');
        assert(heading > 0, `功能设计章节缺失：${group.path}`);
        const content = `# ${feature.name}\n\n${text.slice(heading).trim()}\n`;
        workspace.createRevision(projectId, spec.id, { content, changeSummary: '保留原仓库逐操作设计、字段、失败与验收；替换两段摘要',
          expectedHeadRevisionId: spec.latestRevisionId, source: `import:${group.path}@sha256:${group.sha}` });
      }
      for (const [index, op] of operations.entries()) {
        const feature: any = featureByCode.get(op.feature);
        const capability = workspace.createCapability(projectId, feature.id, { code: op.code, name: op.name,
          summary: `${op.sourcePath}#${op.code}`, sortOrder: index });
        const design = workspace.createCapabilityDesign(capability.id, { content: op.content,
          changeSummary: '按原始操作编号录入具体行为、输入与失败/验收；未执行实施或验收',
          source: `import:${op.sourcePath}@sha256:${op.sourceHash}` });
        capabilityByCode.set(op.code, { id: capability.id, featureId: feature.id, revisionId: design.revision.id });
        workspace.createTraceLink(projectId, { sourceType: 'REQUIREMENT_REVISION', sourceId: updatedProjectDocs.get('requirements')!,
          targetType: 'CAPABILITY', targetId: capability.id, relation: 'DERIVED_FROM' });
        workspace.createTraceLink(projectId, { sourceType: 'CAPABILITY', sourceId: capability.id,
          targetType: 'SPECIFICATION_REVISION', targetId: design.revision.id, relation: 'IMPLEMENTS' });
      }
      for (const table of tables) {
        const feature: any = featureByCode.get(table.feature);
        const sqlPath = `platform-api/sql/业务/${table.sql}`;
        const sql = readSource(sqlPath);
        const section = modelByTable.get(table.name)!;
        const fields = sql.split('\n').flatMap((line) => {
          const match = /^\s{4}([a-z_]+)\s+([A-Z]+(?:\(\d+(?:,\d+)?\))?)(?=\s|,|$)(.*)/.exec(line);
          return match ? [{ name: match[1], type: match[2], declaration: line.trim().replace(/,$/, '') }] : [];
        });
        assert(fields.length >= 3, `SQL 字段解析不完整：${table.name}`);
        const related = operations.filter((item) => (userTables[item.code] ?? []).includes(table.name) || item.feature === table.feature)
          .map((item) => `${item.code} ${item.name}`);
        const asset = workspace.createEngineeringAsset(projectId, feature.id, { kind: 'DATA_MODEL', name: `${table.name} 当前DDL与目标差异`,
          code: table.name.toUpperCase(), summary: `本地逐表 SQL 字段和约束；目标差异未实施`, status: 'DRAFT',
          structuredData: { table: table.name, fields, relatedCapabilities: related, sqlPath,
            sqlSha256: hash(readFileSync(resolve(sourceRoot, sqlPath))), cardPath: `docs/features/P1-W01/${table.card}` },
          contentMarkdown: `# ${table.name}\n\n${section}\n\n## 当前 SQL 原文\n\n\`\`\`sql\n${sql.trim()}\n\`\`\`\n`,
          source: `import:${sqlPath}@sha256:${hash(readFileSync(resolve(sourceRoot, sqlPath)))}`,
          changeSummary: '分别记录现行字段约束与尚未实施的目标差异' });
        for (const op of operations.filter((item) => (userTables[item.code] ?? []).includes(table.name) || item.feature === table.feature)) {
          workspace.createTraceLink(projectId, { sourceType: 'CAPABILITY', sourceId: capabilityByCode.get(op.code)!.id,
            targetType: 'ENGINEERING_ASSET', targetId: asset.id, relation: 'DEPENDS_ON' });
        }
      }
      const principal: Parameters<ArchiveService['createDocument']>[2] = { kind: 'local_web', id: 'local', name: 'ForgeFlow Local' };
      for (const [path, content] of uniqueFiles) {
        archive.createDocument(projectId, { title: path.split('/').at(-1)!.replace(/\.md$/, '') + '（原文快照）',
          originalFilename: path.split('/').at(-1)!, sourcePath: resolve(sourceRoot, path),
          content, contentType: 'text/markdown', changeSummary: `原文 SHA-256 ${hash(readFileSync(resolve(sourceRoot, path)))}` }, principal);
      }
      archive.createDocument(projectId, { title: '八表当前 DDL 与目标差异', originalFilename: 'streamfusion-v3-data-model.md',
        sourcePath: resolve(root, 'docs/streamfusion-v3-data-model.md'), content: model, contentType: 'text/markdown',
        changeSummary: '逐表核对字段/约束/索引与尚未实施的硬删和审计目标' }, principal);
      assert(sqlite.pragma('foreign_key_check').length === 0, '迁移后外键错误');
      assert(sqlite.pragma('integrity_check', { simple: true }) === 'ok', '迁移后数据库不完整');
      const after = archive.exportProject(projectId);
      assert(after.project.capabilities.length === 42 && after.project.engineeringAssets.filter((item: any) => item.kind === 'DATA_MODEL').length === 8
        && after.documents.length === 9 && after.project.features.filter((item: any) => item.status === 'DESIGNING').length === 8,
      'v3 数量或设计阶段不符');
    }).immediate();
    const after = archive.exportProject(projectId);
    try { writeFileSync(outputPath!, `${JSON.stringify(after, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { console.error('数据库已提交，导出文件写入失败；请先检查数据库，不能直接重跑迁移。'); throw error; }
    console.log(JSON.stringify({ mode: 'applied', backupJson, backupDb, outputPath, features: after.project.features.length,
      capabilities: 42, dataModels: 8, projectDocuments: after.documents.length,
      specifications: after.project.specifications.length, revisions: after.specificationRevisions.length,
      taskCount: after.project.tasks.length, runCount: after.project.runs.length, foreignKeyCheck: 'PASS' }, null, 2));
  }
} finally { sqlite.close(); }
