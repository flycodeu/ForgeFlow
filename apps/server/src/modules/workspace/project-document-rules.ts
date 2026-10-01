/**
 * A small, deterministic quality gate for new project-level Specification revisions.
 * It does not rewrite old revisions or attempt to establish whether a claim is true.
 * Callers should return the issues to the author so the source text can be improved.
 */
export type ProjectDocumentKind = 'background' | 'research' | 'requirements' | 'architecture' | 'technology';

export interface ProjectDocumentIssue {
  code: string;
  message: string;
}

const projectKinds = new Set<string>(['background', 'research', 'requirements', 'architecture', 'technology']);

function proseLines(markdown: string, includeHeadings = false): string[] {
  const lines: string[] = [];
  let fence: { marker: string; length: number } | null = null;
  let inComment = false;

  for (const original of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = original.trim();
    const marker = /^(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence.marker && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = { marker: marker[0], length: marker.length };
      continue;
    }
    if (line.startsWith('<!--')) inComment = true;
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (!line || /^\|?\s*:?-{3,}/.test(line)) continue;
    if (/^#{1,6}\s/.test(line)) {
      if (includeHeadings) lines.push(line.replace(/^#{1,6}\s+/, ''));
      continue;
    }
    lines.push(line);
  }
  return lines;
}

function hasTraceableSource(lines: string[]): boolean {
  return lines.some((line) => {
    if (!/(?:来源|依据|参考|访谈|用户反馈|源码|代码入口|需求单|会议纪要|测试记录|档案|source|reference|evidence|readme)/i.test(line)) return false;
    // A label alone ("来源：待补") is not an evidence reference. Accept a document,
    // repository path, URL, issue, or a dated human record as a retrievable pointer.
    return /\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/\S+|(?:[\w.-]+[/\\])+[\w.-]+|\b[\w.-]+\.(?:md|txt|pdf|docx|ts|tsx|js|java|py|json|yaml|yml)\b|\b[A-Z]{1,8}-?\d{2,}(?:[-–—]\s*[A-Z]?\d{2,})?\b|(?:issue|工单|需求单)\s*[#：:]?\s*[A-Za-z]*\d+|(?:访谈|会议|反馈|纪要|记录).{0,24}\d{4}[-年./]\d{1,2}/i.test(line);
  });
}

function hasCurrentAndTarget(body: string): boolean {
  const current = /当前|目前|现有|现行|现状|已有|已经|已实现|已交付|原先|最初|尚未|暂未|尚无|current|existing|implemented|as.is/i;
  const target = /目标|计划|拟定|拟验证|拟采用|预期|未来|后续|下一步|待确认|待验证|尚需|仍需|仍应|需要|应当|应该|将会|首期|target|planned|proposed|to.be/i;
  // "当前目标是……" contains both words but does not separate a fact from a plan.
  const clauses = body.split(/[。！？；;，,\n]/).map((clause) => clause.trim()).filter(Boolean);
  return clauses.some((clause, index) => current.test(clause)
    && !/(?:当前|目前|现有)\s*(?:目标|计划|拟定|希望)/.test(clause)
    && clauses.some((other, otherIndex) => otherIndex !== index && target.test(other)));
}

function add(issues: ProjectDocumentIssue[], code: string, message: string): void {
  issues.push({ code, message });
}

/**
 * Returns blocking issues for a *new* project-level revision. It deliberately uses
 * broad concepts rather than requiring particular Markdown headings or a template.
 * Feature and Capability designs are outside this gate.
 */
export function validateProjectDocument(kind: string, markdown: string): ProjectDocumentIssue[] {
  if (!projectKinds.has(kind)) return [];

  const issues: ProjectDocumentIssue[] = [];
  const lines = proseLines(markdown);
  const body = lines.join('\n');
  const statusText = proseLines(markdown, true).join('\n');
  const visible = body
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*_#|>~\s]/g, '');

  if (visible.length < 140) {
    add(issues, 'DOCUMENT_TOO_BRIEF', '项目级文档正文过短；请写明具体场景、判断依据、设计取舍和边界，而非一句概述或功能目录。');
  }
  if (!hasTraceableSource(lines)) {
    add(issues, 'SOURCE_MISSING', '缺少可回查的依据；请标明文档或源码路径、资料链接、工单编号，或带日期的访谈/会议记录。');
  }

  if (kind === 'background') {
    const problem = /为什么|为何|问题|痛点|困难|风险|成本|无法|难以|不便|缺少|缺乏|依赖|现状|起因|动因|motivat|problem|pain|need|gap/i.test(body);
    const approach = /流程|路径|步骤|方案|分层|设计|从.{1,40}到|先.{0,40}再|演进|取舍|approach|flow|plan|design/i.test(body);
    const audience = /用户|使用者|操作者|人员|角色|客户|业务方|负责人|谁|user|operator|stakeholder/i.test(body);
    const statusMentions = body.match(/更新日期|已完成|已实现|已上线|进度|完成情况|状态更新|当前状态/g)?.length ?? 0;
    if (!problem) {
      add(issues, statusMentions >= 2 ? 'BACKGROUND_PROGRESS_NOT_CONTEXT' : 'BACKGROUND_MOTIVATION_MISSING',
        statusMentions >= 2
          ? '项目背景不能主要是更新日期或已完成功能清单；请解释项目为何产生、原有问题及其影响。'
          : '项目背景缺少创建动因；请解释原有场景的问题、影响及为何需要这个项目。');
    }
    if (!audience) add(issues, 'BACKGROUND_AUDIENCE_MISSING', '项目背景缺少服务对象；请说明谁遇到问题，以及希望完成什么工作。');
    if (!approach) add(issues, 'BACKGROUND_APPROACH_MISSING', '项目背景缺少总体方案或形成过程；请描述从问题到目标的一条主要路径和取舍。');
    if (!hasCurrentAndTarget(statusText)) add(issues, 'STATUS_BOUNDARY_MISSING', '请区分已有事实与目标或待验证方案，避免把规划写成已完成。');
    const narrativeLines = lines.filter((line) => !/^(?:[-*+]|\d+[.)])\s|^\|/.test(line));
    if (narrativeLines.length < 2) add(issues, 'BACKGROUND_ONE_LINER', '项目背景需要展开说明，不能只用一句话或一张功能表代替。');
  } else if (kind === 'research') {
    if (!/比较|对比|取舍|优缺点|优势|局限|适用|约束|候选|方案|代价|风险|trade.off|compare|alternative|option/i.test(body)) {
      add(issues, 'RESEARCH_COMPARISON_MISSING', '调研需要比较可选方案或公开做法，并写出适用条件与限制。');
    }
    if (!/决定|决策|选择|采用|暂不|优先|待验证|需要验证|实验|验证|下一步|结论|decision|choose|verify/i.test(body)) {
      add(issues, 'RESEARCH_DECISION_MISSING', '调研需要说明本项目如何使用这些资料：当前取舍、待验证假设或下一步实验。');
    }
  } else if (kind === 'requirements') {
    if (!/用户|使用者|操作者|角色|业务方|客户|值班|人员|user|operator|stakeholder/i.test(body)) {
      add(issues, 'REQUIREMENT_ACTOR_MISSING', '需求应说明谁执行这项工作或使用结果。');
    }
    if (!/输入|操作|采集|配置|提交|触发|提供|导入|选择|查询|读取|请求|input|action|trigger/i.test(body)
      || !/输出|结果|显示|保存|生成|返回|可见|得到|呈现|查看|output|result|display/i.test(body)) {
      add(issues, 'REQUIREMENT_FLOW_MISSING', '需求应描述用户的输入或操作，以及可观察的结果。');
    }
    if (!/失败|异常|边界|约束|不能|拒绝|校验|验收|恢复|重试|failure|error|acceptance|constraint/i.test(body)) {
      add(issues, 'REQUIREMENT_BOUNDARY_MISSING', '需求应说明失败、约束或可核对的验收条件。');
    }
  } else if (kind === 'architecture') {
    if (!/模块|组件|服务|节点|客户端|界面|进程|系统|层|module|component|service|node|layer/i.test(body)
      || !/调用|交互|数据流|流向|传递|请求|写入|同步|→|->|调用链|flow|exchange|request|event/i.test(body)) {
      add(issues, 'ARCHITECTURE_INTERACTION_MISSING', '架构应列明主要模块及其调用或数据流向；只有组件目录不足以解释系统。');
    }
    if (!/失败|异常|恢复|边界|权限|一致性|隔离|重试|回滚|幂等|failure|error|boundary|retry|recovery/i.test(body)) {
      add(issues, 'ARCHITECTURE_FAILURE_MISSING', '架构应交代关键失败或职责边界，便于判断交互是否可靠。');
    }
    if (!hasCurrentAndTarget(statusText)) add(issues, 'STATUS_BOUNDARY_MISSING', '架构应区分当前接通的调用链与目标或待验证的链路。');
  } else if (kind === 'technology') {
    if (!/技术|依赖|框架|语言|数据库|运行时|平台|协议|库|工具|stack|framework|runtime|library/i.test(body)
      || !/用于|承担|负责|使用|选择|原因|适合|为[了]?|用途|why|because|used for|purpose/i.test(body)) {
      add(issues, 'TECHNOLOGY_RATIONALE_MISSING', '技术选型应列明实际技术或依赖及其用途和选择原因，不能只列工具名。');
    }
    if (!/候选|备选|比较|取舍|代价|条件|门槛|待验证|实验|不引入|暂不|下一步|相比|却要|但必须|但需|仍需|alternative|trade.off|condition|verify/i.test(body)) {
      add(issues, 'TECHNOLOGY_DECISION_MISSING', '技术选型应说明候选方案、采用条件、代价或下一步验证。');
    }
    if (!hasCurrentAndTarget(statusText)) add(issues, 'STATUS_BOUNDARY_MISSING', '技术文档应区分实际使用的依赖与候选或待验证技术。');
  }

  return issues;
}
