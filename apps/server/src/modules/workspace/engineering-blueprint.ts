import type { Capability } from '@forgeflow/contracts';

export type BlueprintRecommendation = {
  kind: string;
  label: string;
  reason: string;
  suggestedAssets: string[];
};

const CATALOG: Record<string, BlueprintRecommendation> = {
  DATA_MODEL: { kind: 'DATA_MODEL', label: '数据与模型', reason: '明确持久化、数据结构和交换数据的字段、约束与关系。', suggestedAssets: ['核心数据模型'] },
  CODE_MODEL: { kind: 'CODE_MODEL', label: '代码模型', reason: '明确类、Struct、Resource、服务及其字段和方法边界。', suggestedAssets: ['核心代码模型'] },
  INTERFACE: { kind: 'INTERFACE', label: '接口与契约', reason: '明确跨边界输入、输出、错误、版本和兼容性。', suggestedAssets: ['功能契约'] },
  UI_DESIGN: { kind: 'UI_DESIGN', label: 'UI 与交互', reason: '明确页面、状态、操作和失败恢复。', suggestedAssets: ['主要交互界面'] },
  INTEGRATION: { kind: 'INTEGRATION', label: '集成关系', reason: '明确生产者、消费者、协议、超时、失败和验证。', suggestedAssets: ['模块集成契约'] },
  ALGORITHM: { kind: 'ALGORITHM', label: '算法与模型', reason: '明确算法输入、预处理、推理、输出、指标和资源。', suggestedAssets: ['算法运行契约'] },
  PIPELINE: { kind: 'PIPELINE', label: 'Pipeline', reason: '明确 Stage、线程、队列、Buffer、背压和恢复。', suggestedAssets: ['运行 Pipeline'] },
  CONFIG: { kind: 'CONFIG', label: '配置', reason: '明确可调参数、默认值、范围和生效方式。', suggestedAssets: ['运行配置'] },
  DEPLOYMENT: { kind: 'DEPLOYMENT', label: '部署运行', reason: '明确进程、运行时、外部依赖和资源要求。', suggestedAssets: ['部署单元'] },
  TEST_DESIGN: { kind: 'TEST_DESIGN', label: '验证设计', reason: '把能力、工程对象和可复现验证证据关联起来。', suggestedAssets: ['功能验证矩阵'] },
};

const PROFILE_KINDS: Record<string, string[]> = {
  web: ['DATA_MODEL', 'CODE_MODEL', 'INTERFACE', 'UI_DESIGN', 'INTEGRATION', 'CONFIG', 'TEST_DESIGN'],
  'backend-service': ['DATA_MODEL', 'CODE_MODEL', 'INTERFACE', 'INTEGRATION', 'CONFIG', 'DEPLOYMENT', 'TEST_DESIGN'],
  game: ['CODE_MODEL', 'UI_DESIGN', 'INTEGRATION', 'CONFIG', 'TEST_DESIGN'],
  godot: ['CODE_MODEL', 'UI_DESIGN', 'INTEGRATION', 'CONFIG', 'TEST_DESIGN'],
  unity: ['CODE_MODEL', 'UI_DESIGN', 'INTEGRATION', 'CONFIG', 'TEST_DESIGN'],
  ai: ['DATA_MODEL', 'CODE_MODEL', 'INTERFACE', 'ALGORITHM', 'INTEGRATION', 'CONFIG', 'DEPLOYMENT', 'TEST_DESIGN'],
  pipeline: ['CODE_MODEL', 'INTERFACE', 'PIPELINE', 'INTEGRATION', 'CONFIG', 'DEPLOYMENT', 'TEST_DESIGN'],
  'video-pipeline': ['CODE_MODEL', 'INTERFACE', 'PIPELINE', 'INTEGRATION', 'CONFIG', 'DEPLOYMENT', 'TEST_DESIGN'],
  workflow: ['CODE_MODEL', 'INTERFACE', 'INTEGRATION', 'CONFIG', 'TEST_DESIGN'],
  cli: ['CODE_MODEL', 'INTERFACE', 'CONFIG', 'DEPLOYMENT', 'TEST_DESIGN'],
};

export function resolveDesignProfiles(designProfile: string, projectType: string, featureName: string, featureSummary: string) {
  const raw = `${designProfile} ${projectType} ${featureName} ${featureSummary}`.toLowerCase();
  const explicit = designProfile.toLowerCase().split(/[,+;\s]+/).filter(Boolean);
  const inferred: string[] = [];
  if (/web|spring|fastify|vue|react|后台|管理端/.test(raw)) inferred.push('web');
  if (/service|backend|服务端/.test(raw)) inferred.push('backend-service');
  if (/godot|unity|game|游戏/.test(raw)) inferred.push('game');
  if (/pipeline|rtsp|ffmpeg|video|视频|流/.test(raw)) inferred.push('pipeline');
  if (/\bai\b|model|inference|tensor|算法|推理|模型/.test(raw)) inferred.push('ai');
  if (/workflow|工作流|状态机/.test(raw)) inferred.push('workflow');
  if (/\bcli\b|命令行/.test(raw)) inferred.push('cli');
  const profiles = [...new Set([...explicit.filter((item) => item !== 'generic'), ...inferred])];
  return profiles.length ? profiles : ['generic'];
}

export function planBlueprint(input: {
  designProfile: string;
  projectType: string;
  featureName: string;
  featureSummary: string;
  capabilities: Capability[];
}) {
  const profiles = resolveDesignProfiles(input.designProfile, input.projectType, input.featureName, input.featureSummary);
  const kinds = new Set<string>();
  for (const profile of profiles) for (const kind of PROFILE_KINDS[profile] ?? []) kinds.add(kind);
  if (!kinds.size) {
    kinds.add('CODE_MODEL');
    kinds.add('INTEGRATION');
    kinds.add('TEST_DESIGN');
  }
  const capabilityNames = input.capabilities.map((item) => `${item.code} ${item.name}`);
  return {
    profiles,
    recommendations: [...kinds].map((kind) => CATALOG[kind] ?? {
      kind, label: kind, reason: '由项目上下文建议的扩展工程设计。', suggestedAssets: [kind],
    }),
    initialStructuredData: (kind: string) => ({
      type: kind.toLowerCase(),
      scope: input.featureName,
      relatedCapabilities: capabilityNames,
      designStatus: '待 AI 依据项目资料补全',
    }),
  };
}

export function engineeringKindLabel(kind: string) {
  return CATALOG[kind]?.label ?? kind.replaceAll('_', ' ');
}
