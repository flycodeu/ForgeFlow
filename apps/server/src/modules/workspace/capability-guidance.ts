import type { CapabilityDesignGuidance, ProjectProfile } from '@forgeflow/contracts';

type CapabilityGuidanceInput = {
  designProfile: string;
  projectType: string;
  projectName: string;
  projectDescription: string;
  featureName: string;
  capabilityCode: string;
  capabilityName: string;
  capabilitySummary: string;
  documents: Array<{ kind: string; revisionNo: number | null; content: string }>;
};

const CORE_SECTIONS = [
  '1. 功能定义', '2. 使用者与场景', '3. 前置条件', '4. 输入与校验', '5. 输出与状态变化', '6. 正常流程',
  '7. 业务规则', '8. 异常、边界与恢复', '9. 数据、契约与依赖', '10. 权限与安全', '11. 实现影响',
  '12. 验收用例与证据', '13. 当前实现状态', '14. 未决事项',
];

const PROFILE_SECTIONS: Record<ProjectProfile, { label: string; sections: string[]; keywords: RegExp }> = {
  WEB: { label: 'Web 系统', sections: ['输入字段', '业务逻辑', '数据设计', '领域 / 实体影响', 'API / 协议', 'UI / 交互', '权限', '实现指导', '测试'], keywords: /web|spring|fastify|http|rest|vue|react|管理系统|用户|权限/i },
  GODOT: { label: 'Godot 游戏', sections: ['角色状态', '物品 Resource', 'Inventory 状态', 'Scene / Node', 'Signal', 'Animation', 'Save Data', 'Playtest'], keywords: /godot|scene|node|signal|resource|gdscript|背包|存档|playtest/i },
  PIPELINE: { label: '实时 Pipeline', sections: ['输入流', 'Codec / FFmpeg', 'Thread', 'Queue / Buffer', '资源生命周期', '超时与错误恢复', '性能与资源', '测试'], keywords: /c\+\+|rtsp|ffmpeg|gstreamer|视频|pipeline|codec|decode|queue|buffer/i },
  AI: { label: 'AI / ML', sections: ['Input', 'Preprocess', 'Model', 'Batch', 'Inference', 'Postprocess', 'Metrics', 'GPU / CPU', 'Model Artifact', 'Evaluation'], keywords: /dataset|model|preprocess|inference|postprocess|metrics|tensorrt|llm|模型|推理/i },
  WORKFLOW: { label: '工作流', sections: ['Trigger', 'Node / State', 'Transition', 'Condition', 'Action', 'Retry / Timeout', 'Failure Recovery'], keywords: /workflow|trigger|transition|condition|retry|状态机|工作流|触发/i },
  CLI: { label: 'CLI / 自动化', sections: ['Command', 'Arguments', 'Config', 'Input / Output', 'Exit Code', 'Error Handling'], keywords: /\bcli\b|command|argument|exit code|命令行|脚本|自动化/i },
  GENERAL: { label: '通用研发项目', sections: ['运行结构', '状态与数据流', '配置', '资源与性能', '测试'], keywords: /$a/ },
};

function inferProfile(input: CapabilityGuidanceInput): ProjectProfile {
  const declared = `${input.designProfile} ${input.projectType}`.trim().toUpperCase();
  const aliases: Record<string, ProjectProfile> = { WEB: 'WEB', GAME: 'GODOT', GODOT: 'GODOT', PIPELINE: 'PIPELINE', AI: 'AI', WORKFLOW: 'WORKFLOW', CLI: 'CLI', GENERIC: 'GENERAL', GENERAL: 'GENERAL' };
  for (const [key, profile] of Object.entries(aliases)) if (declared.includes(key)) return profile;
  const corpus = [input.projectName, input.projectDescription, input.featureName, input.capabilityName, input.capabilitySummary,
    ...input.documents.map((item) => item.content)].join('\n');
  return (['GODOT', 'PIPELINE', 'AI', 'WORKFLOW', 'CLI', 'WEB'] as ProjectProfile[])
    .find((profile) => PROFILE_SECTIONS[profile].keywords.test(corpus)) ?? 'GENERAL';
}

function evidence(input: CapabilityGuidanceInput) {
  const labels: Record<string, string> = { research: 'Research', requirements: 'Requirement', architecture: 'Architecture', technology: 'Technology' };
  const refs = input.documents.filter((item) => item.revisionNo).map((item) => `- ${labels[item.kind] ?? item.kind} REV ${item.revisionNo}`);
  return refs.length ? refs.join('\n') : '- 待补充项目级 Requirement / Research / Architecture / Technology Revision';
}

function adaptiveTemplate(profile: ProjectProfile) {
  if (profile === 'WEB') return `## 输入字段

| 字段 | 类型 | 必填 | 限制 / 关联 |
| --- | --- | --- | --- |
| 待填写 | 待填写 | 是 / 否 | 唯一性、长度或关联对象 |

## 业务逻辑

1. 写出可以直接编码的校验、读取、写入和回滚顺序。

## 数据设计

| 对象 | 类型 | 读取 / 写入 | 作用 |
| --- | --- | --- | --- |
| 待识别 | Entity / Relation / Document | 读取 / 写入 | 由当前技术栈决定 |

## 领域 / 实体影响

仅描述当前项目真实使用的模型形式；非 Java 项目不得虚构 Entity / DTO / VO。

## API / 协议

| 方法 | 路径 / 协议 | Request | Response / Error |
| --- | --- | --- | --- |
| 待识别 | 待识别 | 待识别 | 待识别 |

## UI / 交互

描述入口、交互顺序、校验、成功反馈和失败反馈。项目无 UI 时删除本节。

## 权限

记录真实权限标识和服务端校验位置。

## 实现指导

| Artifact | Impact | Reason |
| --- | --- | --- |
| 待识别 | 新增 / 修改 | 只作为编码指导，不是修改授权 |

## 测试

| 场景 | 预期 | 实际 |
| --- | --- | --- |
| 正常路径 | 待填写 | NOT_RUN |
| 关键失败路径 | 待填写 | NOT_RUN |`;
  if (profile === 'GODOT') return `## 角色状态

说明触发前后的玩家或角色状态。

## 物品 Resource

列出 Item Resource 输入、约束与效果。

## Inventory 状态

说明 Slot、堆叠和运行时状态变化。

## Scene / Node

说明涉及的 Scene、Node 职责与生命周期。

## Signal

列出信号、参数、发出者和订阅者。

## Animation

仅在存在动画反馈时填写。

## Save Data

说明持久化影响和兼容策略。

## Playtest

| 场景 | 预期 | 实际 |
| --- | --- | --- |
| 玩家主路径 | 可观察且无阻断 | NOT_RUN |`;
  if (profile === 'PIPELINE') return `## 输入流

说明输入协议、媒体信息和时间戳。

## Codec / FFmpeg

说明 Codec 支持、FFmpeg API 和上下文创建/销毁。

## Thread

说明线程归属、停止语义和同步边界。

## Queue / Buffer

说明容量、所有权、背压与丢帧策略。

## 资源生命周期

说明 Packet、Frame、CPU/GPU Buffer 的创建、转移和释放顺序。

## 超时与错误恢复

说明超时、EOF、解码错误和重建路径。

## 性能与资源

记录延迟、吞吐、内存和 GPU 预算。

## 测试

| 场景 | 指标 / 预期 | 实际 |
| --- | --- | --- |
| 正常解码 | 持续输出有效帧 | NOT_RUN |
| 错误流 | 安全失败并释放资源 | NOT_RUN |`;
  return PROFILE_SECTIONS[profile].sections.map((section) => `## ${section}\n\n按当前项目真实形态填写；不适用则删除。`).join('\n\n');
}

export function buildCapabilityDesignGuidance(input: CapabilityGuidanceInput): CapabilityDesignGuidance {
  const profile = inferProfile(input);
  return {
    profile,
    profileLabel: PROFILE_SECTIONS[profile].label,
    coreSections: CORE_SECTIONS,
    adaptiveSections: PROFILE_SECTIONS[profile].sections,
    markdownTemplate: `# ${input.capabilityCode} ${input.capabilityName}

> ${PROFILE_SECTIONS[profile].label} 能力详细设计｜固定研发过程 + 技术栈自适应章节

## 1. 功能定义

${input.capabilitySummary || '说明这个 Capability 完成后可观察到的结果。'}

用一句完整的话明确触发条件、系统行为和可观察结果；这句话会显示在能力详情，不放在左侧导航。

## 2. 使用者与场景

说明谁在什么场景使用，以及谁可以查看、触发或修改。

## 3. 前置条件

## 4. 输入与校验

写明字段、类型、是否必填、长度或格式，以及无效输入如何反馈。

## 5. 输出与状态变化

说明返回结果、持久化变化、事件、界面反馈及必须保持不变的字段。

## 6. 正常流程

1. 写出 AI 可以直接据此编码的处理顺序。

## 7. 业务规则

## 8. 异常、边界与恢复

至少检查空值、重复操作、目标不存在、并发或依赖失败；不适用项说明原因。

## 9. 数据、契约与依赖

写清读取和修改的对象、字段、接口、函数、命令、事件或上下游，并说明兼容要求。

## 10. 权限与安全

说明真实的权限检查、敏感数据和越权结果；无账号系统时说明本地或运行环境边界。

## 11. 实现影响

| Artifact Type | Artifact | Impact | Reason |
| --- | --- | --- | --- |
| 待识别 | 待识别 | 新增 / 修改 | 从真实项目推导 |

## 设计依据

${evidence(input)}

${adaptiveTemplate(profile)}

## 12. 验收用例与证据

| 编号 | 前置条件 | 输入与操作 | 预期结果 | 所需证据 |
| --- | --- | --- | --- | --- |
| AC-01 | 待填写 | 待填写 | 待填写 | 自动化测试 / 页面操作 / 日志 / 指标 |

- [ ] 正常路径可复现
- [ ] 关键失败路径符合恢复策略
- [ ] 实现结果可对应到代码与真实测试

## 13. 当前实现状态

设计：DRAFT
实现：NOT_STARTED
测试：NOT_RUN

## 14. 未决事项

记录尚未确认的规则、负责人、确认时点，以及后续变更必须同步检查的对象。
`,
    guardrails: [
      '模板是可选参考，允许沿用原文档、自主组织章节和补充方案，不以章节数量判断设计完成。',
      '按实际功能记录规则、字段、异常、影响和证据；不适用章节可省略，未验证的结果应明确标注。',
      '技术章节由 designProfile、项目上下文和 Capability 语义共同决定，designProfile 不是内容限制。',
      '不得为无 HTTP、无数据库或无 UI 项目虚构 Controller、REST API、数据库表或页面。',
      '字段、API、实体和 Artifact 继续保存在版本化正文及约定表格中。',
    ],
  };
}
