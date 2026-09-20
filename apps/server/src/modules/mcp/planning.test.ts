import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import type {
  CreatedAiToken, Feature, Module, Project, SpecificationRevision, SpecificationSummary, Task,
} from '@forgeflow/contracts';
import { createApp } from '../../app.js';

test('MCP planning tools create deduplicated drafts without crossing human approval boundaries', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-planning-'));
  const databasePath = join(directory, 'forgeflow.db');
  const app = createApp(databasePath);
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const rest = async <T>(method: 'GET' | 'POST', url: string, payload?: object, token?: string) => {
    const response = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : undefined });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${method} ${url}: ${response.statusCode} ${response.body}`);
    return response.json<T>();
  };
  let requestId = 0;
  const call = (token: string, name: string, args: object = {}) => app.inject({
    method: 'POST', url: '/mcp',
    headers: {
      host: '127.0.0.1:8787', authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream', 'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
    },
    payload: { jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } },
  });
  const success = <T>(response: Awaited<ReturnType<typeof call>>) => {
    assert.equal(response.statusCode, 200, response.body);
    const json = response.json<{ result: { isError?: boolean; content: { text: string }[] } }>();
    assert.equal(json.result.isError, undefined, response.body);
    return JSON.parse(json.result.content[0]!.text) as T;
  };
  const businessError = (response: Awaited<ReturnType<typeof call>>) => {
    assert.equal(response.statusCode, 200, response.body);
    const json = response.json<{ result: { isError?: boolean; content: { text: string }[] } }>();
    assert.equal(json.result.isError, true, response.body);
    return JSON.parse(json.result.content[0]!.text) as { code?: string; message?: string };
  };

  const planner = await rest<CreatedAiToken>('POST', '/api/ai-tokens', {
    name: 'codex-planner',
    scopes: ['project:read', 'project:write', 'spec:read', 'planning:write', 'task:read'],
  });
  const project = success<Project>(await call(planner.token, 'create_project_draft', {
    code: 'DEVICE_HOME', name: '个人设备管理系统', description: '统一管理个人设备台账、分组、维修记录与统计分析。', projectType: 'WEB',
  }));
  assert.equal(project.description, '统一管理个人设备台账、分组、维修记录与统计分析。');
  assert.equal(project.projectType, 'WEB');
  assert.equal(businessError(await call(planner.token, 'create_project_draft', {
    code: 'DEVICE_HOME', name: '重复项目', description: '不应创建',
  })).code, 'PROJECT_KEY_EXISTS');

  const initialContext = success<{ modules: Module[]; features: Feature[]; tasks: Task[] }>(
    await call(planner.token, 'get_project_planning_context', { projectId: project.id }),
  );
  assert.deepEqual(initialContext.modules, []);

  const specInputs = [
    ['BACKGROUND', '项目背景', '# 项目目标\n为个人设备建立可信台账。'],
    ['RESEARCH', '调研与分析', '# 调研目标\n比较本地优先设备管理方案。\n\n# 对当前项目的影响\n采用离线存储，不复制参考项目架构。'],
    ['REQUIREMENT', '需求分析', '# 项目目标\n统一管理个人设备。\n\n# 核心需求\n设备台账、设备分组、维修记录、统计分析。'],
    ['ARCHITECTURE', '架构设计', '# 总体架构\n采用本地 Web 工作台与 SQLite 持久化。\n\n# 模块边界\n设备、维修、分析。'],
    ['TECHNOLOGY', '技术栈', '# Frontend\nVue 3 + TypeScript\n\n# Backend\nNode.js + Fastify\n\n# Database\nSQLite'],
  ] as const;
  const specifications: SpecificationSummary[] = [];
  for (const [type, title, content] of specInputs) {
    const specification = success<SpecificationSummary>(await call(planner.token, 'create_project_spec', {
      projectId: project.id, type, title,
    }));
    specifications.push(specification);
    const revision = success<SpecificationRevision>(await call(planner.token, 'create_spec_revision', {
      specId: specification.id, expectedHeadRevisionId: null, changeSummary: `创建${title}第一版`, content,
    }));
    assert.equal(revision.revisionNo, 1);
    assert.match(revision.source, /^ai-token:/);
  }
  assert.equal(businessError(await call(planner.token, 'create_project_spec', {
    projectId: project.id, type: 'REQUIREMENT', title: '重复需求',
  })).code, 'PROJECT_SPEC_EXISTS');
  assert.equal(businessError(await call(planner.token, 'create_spec_revision', {
    specId: specifications[0]!.id, expectedHeadRevisionId: null, changeSummary: '过期写入', content: '# 冲突',
  })).code, 'REVISION_CONFLICT');

  const deviceModule = success<Module>(await call(planner.token, 'create_module', {
    projectId: project.id, code: 'DEVICE', name: '设备管理', description: '设备台账与分组边界', sortOrder: 1,
  }));
  const maintenanceModule = success<Module>(await call(planner.token, 'create_module', {
    projectId: project.id, code: 'MAINTENANCE', name: '维修与分析', description: '维修记录与统计分析边界', sortOrder: 2,
  }));
  assert.equal(businessError(await call(planner.token, 'create_module', {
    projectId: project.id, code: 'DEVICE_COPY', name: '设备管理', description: '', sortOrder: 3,
  })).code, 'MODULE_EXISTS');

  const ledger = success<Feature>(await call(planner.token, 'create_feature', {
    moduleId: deviceModule.id, code: 'DEVICE_LEDGER', name: '设备台账', summary: '记录设备基础信息、状态与归属。',
  }));
  const grouping = success<Feature>(await call(planner.token, 'create_feature', {
    moduleId: deviceModule.id, code: 'DEVICE_GROUP', name: '设备分组', summary: '按使用场景组织设备。',
  }));
  const repair = success<Feature>(await call(planner.token, 'create_feature', {
    moduleId: maintenanceModule.id, code: 'REPAIR_RECORD', name: '维修记录', summary: '维护设备维修过程与结果。',
  }));
  const analytics = success<Feature>(await call(planner.token, 'create_feature', {
    moduleId: maintenanceModule.id, code: 'DEVICE_ANALYTICS', name: '统计分析', summary: '汇总设备状态与维修趋势。',
  }));
  assert.deepEqual([ledger, grouping, repair, analytics].map((item) => item.status), ['DRAFT', 'DRAFT', 'DRAFT', 'DRAFT']);
  assert.equal(businessError(await call(planner.token, 'create_feature', {
    moduleId: deviceModule.id, code: 'LEDGER_COPY', name: '设备台账', summary: '不应复制',
  })).code, 'FEATURE_EXISTS');
  assert.equal(businessError(await call(planner.token, 'create_feature', {
    moduleId: maintenanceModule.id, code: 'LEDGER_OTHER_MODULE', name: '设备台账', summary: '跨模块也不应复制',
  })).code, 'FEATURE_EXISTS');

  const design = success<{ specification: SpecificationSummary; revision: SpecificationRevision }>(
    await call(planner.token, 'create_feature_design', {
      featureId: ledger.id,
      changeSummary: '设备台账功能设计第一版',
      content: '# 功能目标\n建立可信的个人设备台账。\n\n# 范围\n新增、编辑与查看设备。\n\n# 验收条件\n中文信息保存后可完整读取。',
    }),
  );
  assert.equal(design.revision.revisionNo, 1);
  assert.equal(businessError(await call(planner.token, 'create_feature_design', {
    featureId: ledger.id, changeSummary: '重复设计', content: '# 不应创建',
  })).code, 'FEATURE_SPEC_EXISTS');

  const tasks: Task[] = [];
  for (const input of [
    { code: 'T01', name: '设备数据基础', type: 'BACKEND', objective: '建立设备台账持久化与受控接口。', sortOrder: 1 },
    { code: 'T02', name: '设备台账工作台', type: 'FRONTEND', objective: '提供设备台账阅读与维护界面。', sortOrder: 2 },
    { code: 'T03', name: '台账集成验证', type: 'VERIFICATION', objective: '验证新增、编辑与中文数据链路。', sortOrder: 3 },
  ] as const) {
    tasks.push(success<Task>(await call(planner.token, 'create_task_plan', { featureId: ledger.id, ...input })));
  }
  assert.deepEqual(tasks.map((item) => item.status), ['PLANNED', 'PLANNED', 'PLANNED']);
  assert.equal(businessError(await call(planner.token, 'create_task_plan', {
    featureId: ledger.id, code: 'T04', name: '设备数据基础', type: 'OTHER', objective: '不应复制',
  })).code, 'TASK_PLAN_EXISTS');
  const invalidStatus = await call(planner.token, 'create_task_plan', {
    featureId: ledger.id, code: 'T99', name: '越权任务', type: 'OTHER', objective: '不应创建', status: 'CONFIRMED',
  });
  assert.equal(invalidStatus.json<{ result: { isError?: boolean } }>().result.isError, true);

  const context = success<{ project: Project; projectSpecifications: Array<{ type: string }>; modules: Module[]; features: { currentDesign: unknown }[]; tasks: Task[] }>(
    await call(planner.token, 'get_project_planning_context', { projectId: project.id }),
  );
  assert.equal(context.modules.length, 2);
  assert.equal(context.features.length, 4);
  assert.equal(context.tasks.length, 3);
  assert.equal(context.project.projectType, 'WEB');
  assert.ok(context.projectSpecifications.some((item) => item.type === 'research'));
  assert.ok(context.features.some((item) => item.currentDesign));

  const runOnly = await rest<CreatedAiToken>('POST', '/api/ai-tokens', {
    name: 'run-only', scopes: ['project:read', 'spec:read', 'task:read', 'run:write'],
  });
  assert.equal((await call(runOnly.token, 'create_module', {
    projectId: project.id, code: 'NOPE', name: '无权限', description: '', sortOrder: 9,
  })).statusCode, 403);
  const planningOnly = await rest<CreatedAiToken>('POST', '/api/ai-tokens', {
    name: 'planning-only', scopes: ['planning:write'],
  });
  assert.equal((await call(planningOnly.token, 'create_project_draft', {
    code: 'NO_PROJECT_SCOPE', name: '无权限项目', description: '',
  })).statusCode, 403);
  assert.equal((await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/features/${ledger.id}/tasks/${tasks[0]!.id}/authorizations`,
    headers: { authorization: `Bearer ${planner.token}` },
  })).statusCode, 403);

  const sqlite = new Database(databasePath, { readonly: true });
  try {
    const row = sqlite.prepare(`select p.name as projectName, p.description, m.name as moduleName,
      f.name as featureName, r.change_summary as changeSummary, t.name as taskName
      from rd_project p join rd_module m on m.project_id = p.id
      join rd_feature f on f.module_id = m.id
      join rd_spec s on s.feature_id = f.id
      join rd_spec_revision r on r.spec_id = s.id
      join rd_task t on t.feature_id = f.id
      where p.id = ? and f.id = ? order by t.sort_order limit 1`).get(project.id, ledger.id) as Record<string, string>;
    assert.deepEqual(row, {
      projectName: '个人设备管理系统',
      description: '统一管理个人设备台账、分组、维修记录与统计分析。',
      moduleName: '设备管理',
      featureName: '设备台账',
      changeSummary: '设备台账功能设计第一版',
      taskName: '设备数据基础',
    });
  } finally {
    sqlite.close();
  }
});
