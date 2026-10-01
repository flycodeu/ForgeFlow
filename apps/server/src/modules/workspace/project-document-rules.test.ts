import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateProjectDocument } from './project-document-rules.js';

function codes(kind: string, content: string): string[] {
  return validateProjectDocument(kind, content).map((issue) => issue.code);
}

test('rejects an implementation status list masquerading as project background', () => {
  const staleBackground = `# StreamFusion AI 项目背景
更新日期：2026-09-26。目标是统一管理连续视频分析的配置、节点、任务、业务事件及媒体证据。
当前已完成管理端实现：账号和个人中心、用户/角色/菜单/部门、PAGE 模块授权、操作审计、登录记录、IP 防护、服务信息、接口文档、单账号单会话及管理员强制登出。源码和本地工程验证是本次状态更新依据；负责人验收与生产部署单独记录。`;
  const result = codes('background', staleBackground);
  assert.ok(result.includes('BACKGROUND_PROGRESS_NOT_CONTEXT'));
  assert.ok(result.includes('BACKGROUND_APPROACH_MISSING'));
  assert.ok(result.includes('SOURCE_MISSING'));
});

test('rejects vague one-line background and generic source placeholder', () => {
  const result = codes('background', '# 项目背景\n本项目解决用户使用中的问题，采用分层方案，当前已有基础，未来持续优化。来源：待补。');
  assert.ok(result.includes('DOCUMENT_TOO_BRIEF'));
  assert.ok(result.includes('BACKGROUND_ONE_LINER'));
  assert.ok(result.includes('SOURCE_MISSING'));
});

test('accepts a substantive background without requiring fixed headings', () => {
  const content = `# 为什么要做这件事
过去需要人工从每个设备分别抄录运行时间和报警记录，值班人员很难判断同一故障是否重复发生，也无法在交接时解释状态变化的来源。项目因此要解决跨设备记录无法追溯的问题。

我们计划先让操作人员登记设备和采集来源，再将事件按稳定标识归并，最后提供一次可回看的故障处理流程。当前只有设备登记的原型；事件归并和交接页面仍是目标，需要在现场样本上验证恢复行为与误合并风险。

依据：产品负责人访谈记录（2026-09-20），设备交接纪要中保留了原始操作案例。`;
  assert.deepEqual(validateProjectDocument('background', content), []);
});

test('code fences cannot satisfy project document prose rules', () => {
  const content = `# 背景
当前项目待处理。

\`\`\`json
{"problem":"用户为什么遇到问题", "approach":"方案和流程", "source":"README.md", "target":"目标"}
\`\`\``;
  const result = codes('background', content);
  assert.ok(result.includes('DOCUMENT_TOO_BRIEF'));
  assert.ok(result.includes('SOURCE_MISSING'));
  assert.ok(result.includes('BACKGROUND_APPROACH_MISSING'));
});

test('a current goal phrase alone does not separate present facts from planned work', () => {
  const content = `# 项目缘起
值班人员无法从分散的记录解释故障问题，项目需要给用户提供可追溯的处理流程。当前目标是整理来源、分层设计并展示历史记录，先采集再归并，最后按事件回看。

方案由设备登记、归并服务和查询界面组成，输入记录后显示处理结果；边界包括丢失原始记录时不生成结论。依据：docs/operations/interview-2026-09-20.md。`;
  assert.ok(codes('background', content).includes('STATUS_BOUNDARY_MISSING'));
});

test('other project documents require decisions, observable flow, interactions, and rationale', () => {
  const longDescription = '用户需要在指定环境中完成登记和回查，每次记录应能追到原始输入，并在失败后保留原有数据。'.repeat(4);
  assert.ok(codes('research', `${longDescription}\n来源：README.md`).includes('RESEARCH_COMPARISON_MISSING'));
  assert.ok(codes('requirements', `${longDescription}\n来源：README.md`).includes('REQUIREMENT_FLOW_MISSING'));
  assert.ok(codes('architecture', `${longDescription}\n来源：README.md`).includes('ARCHITECTURE_INTERACTION_MISSING'));
  assert.ok(codes('technology', `${longDescription}\n来源：README.md`).includes('TECHNOLOGY_RATIONALE_MISSING'));
});

test('current reviewed project documents pass, while feature designs remain outside this gate', () => {
  for (const project of ['streamfusion', 'salary']) {
    for (const kind of ['background', 'research', 'requirements', 'architecture', 'technology']) {
      const url = new URL(`../../../../../docs/project-atlas/${project}-${kind}.md`, import.meta.url);
      assert.deepEqual(validateProjectDocument(kind, readFileSync(url, 'utf8')), [], `${project}-${kind}`);
    }
  }
  assert.deepEqual(validateProjectDocument('feature-design', '# 简短但合法的能力设计'), []);
});
