import type { FeatureDesignGuidance, ProjectProfile, TaskCategory } from '@forgeflow/contracts';

type GuidanceInput = {
  projectType: string;
  projectName: string;
  projectDescription: string;
  featureName: string;
  featureSummary: string;
  documents: Array<{ kind: string; revisionNo: number | null; content: string }>;
};

type TaskSeed = { name: string; category: TaskCategory; area: string; objective: string };

const CORE_SECTIONS = [
  '范围与操作入口', '共同边界', '依赖与影响', '未决与依据',
];

const PROFILES: Record<ProjectProfile, { label: string; keywords: RegExp; sections: string[]; tasks: TaskSeed[] }> = {
  WEB: {
    label: 'Web 系统', keywords: /web|spring|fastify|http|rest|vue|react|浏览器|权限管理|用户管理/i,
    sections: ['数据模型', '接口与契约', '页面与交互', '权限', '事务与并发'],
    tasks: [
      { name: '领域与数据约束', category: 'IMPLEMENTATION', area: 'domain', objective: '实现详细设计中的数据关系、约束与原子性规则。' },
      { name: '服务与接口契约', category: 'IMPLEMENTATION', area: 'service', objective: '实现能力入口、权限、错误契约与事务边界。' },
      { name: '用户交互', category: 'IMPLEMENTATION', area: 'ui', objective: '实现设计中明确存在的页面、状态反馈与交互闭环。' },
      { name: '集成验证', category: 'VERIFICATION', area: 'integration', objective: '贯通真实数据、接口与用户操作并验证验收条件。' },
    ],
  },
  GODOT: {
    label: 'Godot 游戏', keywords: /godot|scene|node|signal|resource|gdscript|背包|存档|playtest/i,
    sections: ['Scene 结构', 'Node 职责', 'Resource', 'Signal', 'Input', 'Runtime State', 'UI 与游戏交互', 'Save Data', 'Playtest'],
    tasks: [
      { name: '资源与运行数据', category: 'IMPLEMENTATION', area: 'godot-data', objective: '实现 Resource、运行时状态及其约束。' },
      { name: '核心玩法行为', category: 'IMPLEMENTATION', area: 'godot-runtime', objective: '实现 Capability 对应的节点职责、信号与状态变化。' },
      { name: '场景与 UI 交互', category: 'INTEGRATION', area: 'godot-ui', objective: '连接 Scene、Node、Input、Signal 与玩家反馈。' },
      { name: '存档集成', category: 'INTEGRATION', area: 'save-data', objective: '实现存档格式、恢复路径与版本兼容策略。' },
      { name: 'Playtest', category: 'VERIFICATION', area: 'playtest', objective: '按玩家验收场景验证交互、边界和恢复。' },
    ],
  },
  PIPELINE: {
    label: '实时 Pipeline', keywords: /c\+\+|rtsp|ffmpeg|gstreamer|视频|pipeline|codec|decode|queue|buffer|backpressure/i,
    sections: ['Pipeline', 'Input 与 Codec', 'Thread 模型', 'Queue 与 Buffer', 'Memory 生命周期', 'GPU / CPU 资源', 'Backpressure', 'Reconnect', 'Performance'],
    tasks: [
      { name: 'Source Pipeline', category: 'IMPLEMENTATION', area: 'pipeline', objective: '实现输入连接、探测、生命周期与关闭路径。' },
      { name: 'Decode 与采样', category: 'IMPLEMENTATION', area: 'video', objective: '实现解码、帧采样及时间戳策略。' },
      { name: 'Queue / Buffer', category: 'IMPLEMENTATION', area: 'runtime', objective: '实现线程间队列、内存所有权和背压策略。' },
      { name: '推理集成', category: 'INTEGRATION', area: 'ai', objective: '连接推理、后处理与结果聚合，不引入无关 UI 或 HTTP 层。' },
      { name: '长稳与性能验证', category: 'VERIFICATION', area: 'performance', objective: '验证断流恢复、错误流、资源上限与长期运行。' },
    ],
  },
  AI: {
    label: 'AI / ML', keywords: /dataset|model|preprocess|inference|postprocess|metrics|tensorrt|llm|模型|推理/i,
    sections: ['Dataset 与 Input', 'Preprocess', 'Model', 'Inference', 'Postprocess', 'Metrics 与 Evaluation', 'Model Artifact', 'GPU / CPU Resource', 'Deployment'],
    tasks: [
      { name: '数据与预处理', category: 'IMPLEMENTATION', area: 'data', objective: '实现输入契约、数据校验与预处理。' },
      { name: '模型推理链路', category: 'IMPLEMENTATION', area: 'inference', objective: '实现模型加载、推理与资源治理。' },
      { name: '后处理与指标', category: 'IMPLEMENTATION', area: 'evaluation', objective: '实现结果解释、指标和评估口径。' },
      { name: '部署集成', category: 'INTEGRATION', area: 'deployment', objective: '集成模型制品、运行环境与发布边界。' },
      { name: '质量验证', category: 'VERIFICATION', area: 'metrics', objective: '按数据集、性能和资源验收条件验证。' },
    ],
  },
  WORKFLOW: {
    label: '工作流', keywords: /workflow|trigger|transition|condition|retry|状态机|工作流|节点|触发/i,
    sections: ['Trigger', 'Node', 'State 与 Transition', 'Condition', 'Action', 'Retry', 'Timeout', 'Failure Recovery'],
    tasks: [
      { name: '状态与节点模型', category: 'IMPLEMENTATION', area: 'workflow', objective: '实现节点、状态、迁移和持久边界。' },
      { name: '触发与动作', category: 'IMPLEMENTATION', area: 'orchestration', objective: '实现触发、条件和动作执行。' },
      { name: '重试与恢复', category: 'IMPLEMENTATION', area: 'resilience', objective: '实现超时、重试、暂停与失败恢复。' },
      { name: '流程验证', category: 'VERIFICATION', area: 'workflow', objective: '验证主路径、分支、重试和人工恢复。' },
    ],
  },
  CLI: {
    label: 'CLI / 自动化', keywords: /\bcli\b|command|argument|exit code|命令行|脚本|自动化/i,
    sections: ['Command', 'Arguments', 'Config', 'Input / Output', 'Exit Code', 'Error Handling'],
    tasks: [
      { name: '命令与配置', category: 'IMPLEMENTATION', area: 'cli', objective: '实现命令、参数、配置优先级和输入校验。' },
      { name: '核心处理', category: 'IMPLEMENTATION', area: 'core', objective: '实现与终端表现解耦的核心能力。' },
      { name: '输出与错误契约', category: 'INTEGRATION', area: 'cli', objective: '实现标准输出、标准错误和退出码。' },
      { name: '命令行验证', category: 'VERIFICATION', area: 'cli', objective: '验证正常、非法输入和自动化调用场景。' },
    ],
  },
  GENERAL: {
    label: '通用研发项目', keywords: /$a/,
    sections: ['运行结构', '状态与数据流', '配置', '资源与性能'],
    tasks: [
      { name: '核心能力实现', category: 'IMPLEMENTATION', area: 'core', objective: '按 Capability 和关键规则实现核心行为。' },
      { name: '依赖集成', category: 'INTEGRATION', area: 'integration', objective: '完成设计中明确的依赖与上下游集成。' },
      { name: '验收条件验证', category: 'VERIFICATION', area: 'verification', objective: '逐项验证设计中的验收条件和恢复路径。' },
    ],
  },
};

function inferProfile(input: GuidanceInput): ProjectProfile {
  const declared = input.projectType.trim().toUpperCase();
  if (declared in PROFILES) return declared as ProjectProfile;
  const corpus = [input.projectType, input.projectName, input.projectDescription, input.featureName, input.featureSummary,
    ...input.documents.map((item) => item.content)].join('\n');
  const order: ProjectProfile[] = ['GODOT', 'PIPELINE', 'AI', 'WORKFLOW', 'CLI', 'WEB'];
  return order.find((profile) => PROFILES[profile].keywords.test(corpus)) ?? 'GENERAL';
}

function referenceLines(input: GuidanceInput) {
  const labels: Record<string, string> = { background: 'Project Background', research: 'Research', requirements: 'Requirement', architecture: 'Architecture', technology: 'Technology' };
  const lines = input.documents.filter((item) => item.revisionNo).map((item) => `- ${labels[item.kind] ?? item.kind} REV ${item.revisionNo}`);
  return lines.length ? lines.join('\n') : '- 待补充：Requirement / Research / Architecture / Technology Revision';
}

function buildTemplate(input: GuidanceInput, profile: ProjectProfile) {
  return `# ${input.featureName}

${input.featureSummary || '填写本功能对使用者产生的可观察结果。'}

## 范围与操作入口

逐项列 Capability 编号、名称与一句话用途；具体字段、状态、接口、异常和验收写在对应操作卡。

## 共同边界

只记录跨操作共用的权限、状态、事务、兼容和保护规则，不重复操作卡。

## 依赖与影响

列真实的上游、下游及会受影响的功能；${PROFILES[profile].sections.join('、')}仅在本功能实际涉及且有来源时补充。

## 未决与依据

${referenceLines(input)}

区分已确认、目标方案和未决；原始材料、DDL 和执行状态留在来源或工作记录。
`;
}

export function buildFeatureDesignGuidance(input: GuidanceInput): FeatureDesignGuidance {
  const profile = inferProfile(input);
  return {
    profile,
    profileLabel: PROFILES[profile].label,
    evidenceKinds: input.documents.map((item) => item.kind),
    coreSections: CORE_SECTIONS,
    adaptiveSections: PROFILES[profile].sections,
    markdownTemplate: buildTemplate(input, profile),
    suggestedTasks: PROFILES[profile].tasks.map((task, index) => ({ ...task, code: `T${String(index + 1).padStart(2, '0')}` })),
    guardrails: [
      'Feature 总览只列范围、操作入口和共同规则；逐项字段、接口、表关系与验收进入 Capability Design。',
      '不得把外部参考直接复制为当前架构；必须记录采用、不采用及原因。',
      '不得虚构项目不存在的 Database、HTTP API、UI、Frontend 或 Backend。',
      '只保留影响当前决策的内容；删除模板提示和空章节，不以篇幅或章节数量判断完成。',
      '已有设计是参考基线，不限制新的方案；记录改变了什么、原因和实际验证范围，便于后续维护。',
      '原始文档可存档；状态和执行证据进入工作记录，设计中只引用必要的来源。',
    ],
  };
}
