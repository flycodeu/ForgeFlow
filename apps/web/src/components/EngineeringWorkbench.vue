<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type {
  AiRun, Capability, CapabilityDetail, EngineeringAsset, EngineeringAssetRevision, Feature, FeatureEngineeringBlueprint, Project, ProjectDetail, SpecificationDetail, Task, TraceLink,
} from '@forgeflow/contracts';
import { api as getJson } from '../api-client';
import ArchiveMarkdown from './ArchiveMarkdown.vue';
import CapabilityDesignView from './CapabilityDesignView.vue';
import SqlDataModelView from './SqlDataModelView.vue';

type NavFolder = { kind: string; label: string };
type NavGroup = { key: string; label: string; folders: NavFolder[] };
type TableData = { title: string; columns: string[]; rows: string[][] };

const props = defineProps<{ project: Project; feature: Feature; moduleName: string; detail: ProjectDetail; initialCapabilityId?: string | null }>();
const emit = defineEmits<{ changed: []; back: [] }>();

const blueprint = ref<FeatureEngineeringBlueprint | null>(null);
const selectedType = ref<'overview' | 'capability' | 'asset' | 'plan' | 'verification'>('overview');
const selectedId = ref('');
const capabilityDetail = ref<CapabilityDetail | null>(null);
const featureDesign = ref<SpecificationDetail | null>(null);
const loading = ref(true);
const planning = ref(false);
const error = ref('');
const assetHistory = ref<EngineeringAssetRevision[]>([]);
const selectedRevisionId = ref('');
const showAssetHistory = ref(false);
const showRevisionDialog = ref(false);
const revisionSummary = ref('');
const revisionStructuredData = ref('');
const revisionMarkdown = ref('');
const savingRevision = ref(false);
const showAllDesignTypes = ref(false);
const collapsedNavBranches = ref(new Set<string>());
const navigationOpen = ref(false);
let selectionRequest = 0;

const navGroups: NavGroup[] = [
  { key: 'data', label: '数据与模型', folders: [{ kind: 'DATA_MODEL', label: '数据模型' }, { kind: 'CODE_MODEL', label: '代码模型' }, { kind: 'GODOT_RESOURCE', label: 'Godot Resource' }, { kind: 'MESSAGE_SCHEMA', label: '消息模型' }] },
  { key: 'contract', label: '接口与契约', folders: [{ kind: 'INTERFACE', label: '接口' }, { kind: 'PROTOBUF', label: 'Protobuf' }, { kind: 'MESSAGE_TOPIC', label: '消息主题' }, { kind: 'SIGNAL', label: 'Signal' }, { kind: 'CLI_CONTRACT', label: 'CLI 契约' }] },
  { key: 'ui', label: '界面与交互', folders: [{ kind: 'UI_DESIGN', label: '页面与交互' }] },
  { key: 'integration', label: '集成关系', folders: [{ kind: 'INTEGRATION', label: '集成契约' }] },
  { key: 'runtime', label: '算法与处理流程', folders: [{ kind: 'ALGORITHM', label: '算法' }, { kind: 'PIPELINE', label: '处理流程' }, { kind: 'CUDA_KERNEL', label: 'CUDA 内核' }, { kind: 'WORKFLOW_NODE', label: '工作流节点' }] },
  { key: 'operations', label: '配置与部署', folders: [{ kind: 'CONFIG', label: '配置' }, { kind: 'DEPLOYMENT', label: '部署' }] },
];

const capabilities = computed(() => (blueprint.value?.capabilities ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder));
const assets = computed(() => blueprint.value?.assets ?? []);
const selectedAsset = computed(() => selectedType.value === 'asset' ? assets.value.find((item) => item.id === selectedId.value) ?? null : null);
const selectedHistoricalRevision = computed(() => assetHistory.value.find((item) => item.id === selectedRevisionId.value) ?? null);
const selectedCapability = computed(() => selectedType.value === 'capability' ? capabilities.value.find((item) => item.id === selectedId.value) ?? null : null);
const tasks = computed(() => props.detail.tasks.filter((item) => item.featureId === props.feature.id));
const runs = computed(() => props.detail.runs.filter((item) => item.featureId === props.feature.id));
const requestedRunId = new URLSearchParams(window.location.search).get('run');
const visibleRuns = computed(() => requestedRunId ? runs.value.filter((item) => item.id === requestedRunId) : runs.value);
const completeKinds = computed(() => blueprint.value?.completeness.filter((item) => item.exists).length ?? 0);
const requiredKinds = computed(() => blueprint.value?.completeness.length ?? 0);
const doneCapabilities = computed(() => capabilities.value.filter((item) => item.status === 'DONE').length);
const selectedStructured = computed<Record<string, unknown>>(() => selectedHistoricalRevision.value?.structuredData ?? selectedAsset.value?.structuredData ?? {});
const selectedMarkdown = computed(() => selectedHistoricalRevision.value?.contentMarkdown ?? selectedAsset.value?.contentMarkdown ?? null);
const isSqlDataModel = computed(() => selectedAsset.value?.kind === 'DATA_MODEL'
  && Array.isArray(selectedStructured.value.fields) && Boolean(selectedStructured.value.sqlPath));
const selectedTables = computed(() => buildTables(selectedStructured.value));
const selectedFacts = computed(() => Object.entries(selectedStructured.value)
  .filter(([, value]) => !Array.isArray(value) && (typeof value !== 'object' || value === null))
  .filter(([key]) => !['type', 'relatedCapabilities', 'designStatus'].includes(key)));
const associatedAssets = computed(() => {
  const capability = selectedCapability.value;
  if (!capability) return [];
  return assets.value.filter((asset) => {
    if (asset.capabilityId === capability.id) return true;
    const related = asset.structuredData?.relatedCapabilities;
    return Array.isArray(related) && related.some((value) => String(value).startsWith(capability.code));
  });
});
const capabilityTasks = computed(() => selectedCapability.value ? tasks.value.filter((item) => item.capabilityId === selectedCapability.value?.id) : []);
const capabilityRuns = computed(() => {
  const ids = new Set(capabilityTasks.value.map((item) => item.id));
  return runs.value.filter((item) => ids.has(item.taskId));
});
function currentCheckCount(capabilityId: string) {
  const taskIds = new Set(tasks.value.filter((task) => task.capabilityId === capabilityId).map((task) => task.id));
  const latest = new Map(runs.value.filter((run) => taskIds.has(run.taskId) && run.verificationSummary)
    .sort((a, b) => new Date(a.finishedAt ?? a.createdAt).getTime() - new Date(b.finishedAt ?? b.createdAt).getTime())
    .map((run) => [run.taskId, run]));
  return [...latest.values()].filter((run) => run.designSnapshotStatus === 'CURRENT'
    && run.verificationSummary?.origin === 'CI' && run.verificationSummary.evidenceStatus === 'VERIFIED'
    && run.verificationSummary.reportedStatus === 'PASS').length;
}
const traceLinks = computed(() => {
  const ids = new Set([selectedId.value, ...capabilityTasks.value.map((item) => item.id), ...capabilityRuns.value.map((item) => item.id)]);
  return (blueprint.value?.traceLinks ?? []).filter((item) => ids.has(item.sourceId) || ids.has(item.targetId));
});

function assetsFor(group: NavGroup) { return assets.value.filter((item) => group.folders.some((folder) => folder.kind === item.kind)); }
function visibleGroups() {
  const knownKinds = new Set(navGroups.flatMap((group) => group.folders.map((folder) => folder.kind)));
  const customFolders = [...new Set(assets.value.map((asset) => asset.kind).filter((kind) => !knownKinds.has(kind) && kind !== 'TEST_DESIGN'))]
    .map((kind) => ({ kind, label: assetKindLabel(kind) }));
  const groups = customFolders.length ? [...navGroups, { key: 'other', label: '其他工程设计', folders: customFolders }] : navGroups;
  return groups.filter((group) => showAllDesignTypes.value || assetsFor(group).length > 0);
}
function toggleNavBranch(key: string) {
  const next = new Set(collapsedNavBranches.value);
  if (next.has(key)) next.delete(key); else next.add(key);
  collapsedNavBranches.value = next;
}
function capabilityLabel(status: Capability['status']) {
  return { DRAFT: '草稿', DESIGNED: '已设计', IMPLEMENTING: '实现中', TESTING: '验证中', DONE: '已完成', BLOCKED: '受阻' }[status];
}
function featureStatusLabel(status: Feature['status']) {
  return { DRAFT: '草稿', DESIGNING: '设计中', READY: '待实施', IMPLEMENTING: '实现中', VERIFYING: '验证中', ACCEPTANCE_PENDING: '待验收', ACCEPTED: '已验收', DELIVERED: '交付标记（待核对）' }[status];
}
function assetKindLabel(kind: string) {
  const labels: Record<string, string> = {
    DATA_MODEL: '数据模型', CODE_MODEL: '代码模型', INTERFACE: '接口契约', UI_DESIGN: 'UI 交互', INTEGRATION: '集成契约',
    ALGORITHM: '算法设计', PIPELINE: '运行 Pipeline', CONFIG: '运行配置', DEPLOYMENT: '部署设计', TEST_DESIGN: '验证设计',
    GODOT_RESOURCE: 'Godot Resource', SIGNAL: 'Signal', PROTOBUF: 'Protobuf', CUDA_KERNEL: 'CUDA Kernel', MESSAGE_TOPIC: '消息主题',
  };
  return labels[kind] ?? kind.replaceAll('_', ' ');
}
function assetStatusLabel(status: string) {
  return { DRAFT: '草稿', DESIGNED: '已设计', IMPLEMENTING: '实现中', TESTING: '验证中', DONE: '已完成', BLOCKED: '受阻' }[status] ?? status;
}
function keyLabel(key: string) {
  const labels: Record<string, string> = {
    name: '名称', type: '类型', purpose: '用途', route: '路由', method: '方法', path: '路径', protocol: '协议', version: '版本',
    schemaVersion: 'Schema 版本', serialization: '序列化格式', format: '格式', mutability: '可变性', example: '示例',
    permission: '权限', model: '模型', framework: '框架', runtime: '运行时', latencyTarget: '延迟目标', throughput: '吞吐目标',
    transaction: '事务', compatibility: '兼容性', input: '输入', output: '输出', timeout: '超时', retry: '重试', failure: '失败处理',
    producer: '生产者', consumer: '消费者', threadModel: '线程模型', ownership: '资源所有权', backpressure: '背压',
    default: '默认值', required: '必填', nullable: '可空', description: '说明', constraint: '约束', source: '来源', status: '状态',
    concern: '关注点', decision: '设计决定', reason: '原因', platform: '平台', storage: '存储', mapping: '字段映射', notes: '说明',
    item: '问题', current: '当前实现', target: '目标状态',
  };
  return labels[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase());
}
function valueText(value: unknown) {
  if (value === true) return '是';
  if (value === false) return '否';
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
function singularTitle(key: string) {
  const labels: Record<string, string> = {
    fields: '字段', methods: '方法', indexes: '索引', relations: '关系', constraints: '约束', request: '请求', response: '响应', errors: '错误',
    actions: '操作', states: '界面状态', flow: '交互流程', stages: '运行阶段', connections: '连接关系', contracts: '契约清单', inputs: '输入', outputs: '输出',
    preprocess: '预处理', postprocess: '后处理', metrics: '指标', resources: '资源', dependencies: '依赖', settings: '配置项', tests: '验证用例',
    artifacts: '实现对象', relatedCapabilities: '关联能力项', components: '组件', signals: 'Signal', saveData: '存档数据', datasets: '数据集', failures: '失败处理',
    compatibilityRules: '兼容性规则', storageAdapters: '平台存储映射', knownGaps: '当前缺口',
  };
  return labels[key] ?? keyLabel(key);
}
function buildTables(data: Record<string, unknown>): TableData[] {
  const result: TableData[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      result.push({ title: singularTitle(key), columns: ['内容'], rows: value.map((item) => [valueText(item)]) });
      continue;
    }
    const objects = value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    if (!objects.length) continue;
    const columns = [...new Set(objects.flatMap((item) => Object.keys(item)))];
    result.push({ title: singularTitle(key), columns: columns.map(keyLabel), rows: objects.map((item) => columns.map((column) => valueText(item[column]))) });
  }
  return result;
}
function resolveTraceNode(type: string, id: string) {
  const specification = props.detail.specifications.find((item) => item.latestRevisionId === id || item.approvedRevisionId === id || item.id === id);
  if (specification) return specification.title;
  const anyAsset = assets.value.find((item) => item.id === id);
  if (anyAsset) return anyAsset.name;
  if (type === 'CAPABILITY') return capabilities.value.find((item) => item.id === id)?.name ?? id.slice(0, 8);
  if (type === 'ENGINEERING_ASSET') return assets.value.find((item) => item.id === id)?.name ?? id.slice(0, 8);
  if (type === 'TASK') return tasks.value.find((item) => item.id === id)?.name ?? id.slice(0, 8);
  if (type === 'RUN') return runs.value.find((item) => item.id === id)?.summary || `AI执行 ${id.slice(0, 6)}`;
  if (type === 'FEATURE') return props.feature.name;
  return `${type} ${id.slice(0, 6)}`;
}
function traceLeft(link: TraceLink) {
  return link.sourceType === 'REQUIREMENT_REVISION' && link.targetType === 'FEATURE'
    ? resolveTraceNode(link.targetType, link.targetId) : resolveTraceNode(link.sourceType, link.sourceId);
}
function traceRight(link: TraceLink) {
  return link.sourceType === 'REQUIREMENT_REVISION' && link.targetType === 'FEATURE'
    ? resolveTraceNode(link.sourceType, link.sourceId) : resolveTraceNode(link.targetType, link.targetId);
}
function relationLabel(relation: string) {
  return { DERIVED_FROM: '来源于', IMPLEMENTS: '实现', DEPENDS_ON: '依赖', VERIFIED_BY: '由其验证', INTEGRATES_WITH: '集成' }[relation] ?? relation;
}
function taskStatus(task: Task) { return { PLANNED: '待实施', AUTHORIZED: '已就绪', RUNNING: '执行中', SUBMITTED: '已提交', CONFIRMED: '已确认', DONE: '已完成', BLOCKED: '受阻' }[task.status]; }
function runFileLabel(file: AiRun['changedFiles'][number]) { return typeof file === 'string' ? file : `${file.sourceId.slice(0, 8)} · ${file.relativePath}`; }
function verificationLabel(run: AiRun) {
  const verification = run.verificationSummary;
  if (!verification) return '尚未报告';
  if (verification.origin === 'AI_REPORTED') return verification.reportedStatus === 'PASS' ? 'AI报告通过' : `AI报告 ${verification.reportedStatus}`;
  return `${verification.reportedStatus} · ${verification.origin}`;
}
function sourceName(sourceId: string) { return props.detail.sources.find((source) => source.id === sourceId)?.alias ?? sourceId.slice(0, 8); }

async function loadBlueprint(preferred?: { type: typeof selectedType.value; id: string }) {
  loading.value = true; error.value = '';
  try {
    blueprint.value = await getJson(`/api/projects/${props.project.id}/features/${props.feature.id}/engineering-blueprint`);
    const featureSpecification = props.detail.specifications.find((item) => item.featureId === props.feature.id && item.capabilityId === null && item.kind === 'feature-design');
    featureDesign.value = featureSpecification
      ? await getJson(`/api/projects/${props.project.id}/specifications/${featureSpecification.id}`)
      : null;
    const query = new URLSearchParams(window.location.search);
    const requestedAsset = assets.value.find((item) => item.kind === query.get('asset') || item.code === query.get('asset'));
    const requestedCapability = capabilities.value.find((item) => item.code === query.get('capability'));
    const initialCapability = capabilities.value.find((item) => item.id === props.initialCapabilityId);
    const querySelection = initialCapability ? { type: 'capability' as const, id: initialCapability.id }
      : requestedAsset ? { type: 'asset' as const, id: requestedAsset.id }
      : requestedCapability ? { type: 'capability' as const, id: requestedCapability.id }
        : query.get('section') === 'plan' ? { type: 'plan' as const, id: 'plan' }
          : query.get('section') === 'verification' ? { type: 'verification' as const, id: 'verification' } : null;
    const next = preferred ?? (selectedId.value ? { type: selectedType.value, id: selectedId.value } : querySelection);
    if (next && (next.type !== 'asset' || assets.value.some((item) => item.id === next.id))) await selectItem(next.type, next.id);
    else await selectItem('overview', 'overview');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '工程蓝图加载失败'; }
  finally { loading.value = false; }
}
async function selectItem(type: typeof selectedType.value, id: string) {
  const request = ++selectionRequest;
  navigationOpen.value = false;
  selectedType.value = type; selectedId.value = id; capabilityDetail.value = null;
  assetHistory.value = []; selectedRevisionId.value = ''; showAssetHistory.value = false;
  try {
    if (type === 'capability') {
      const detail = await getJson<CapabilityDetail>(`/api/projects/${props.project.id}/features/${props.feature.id}/capabilities/${id}`);
      if (request === selectionRequest) capabilityDetail.value = detail;
    } else if (type === 'asset') {
      const history = await getJson<EngineeringAssetRevision[]>(`/api/projects/${props.project.id}/engineering-assets/${id}/revisions`);
      if (request === selectionRequest) {
        assetHistory.value = history;
        showAssetHistory.value = new URLSearchParams(window.location.search).get('history') === '1';
      }
    }
  } catch (cause) { if (request === selectionRequest) error.value = cause instanceof Error ? cause.message : '设计内容加载失败'; }
}

function openRevisionDialog() {
  if (!selectedAsset.value) return;
  revisionSummary.value = '';
  revisionStructuredData.value = JSON.stringify(selectedAsset.value.structuredData ?? {}, null, 2);
  revisionMarkdown.value = selectedAsset.value.contentMarkdown ?? '';
  showRevisionDialog.value = true;
}

async function createRevision() {
  if (!selectedAsset.value) return;
  savingRevision.value = true; error.value = '';
  try {
    const structuredData = JSON.parse(revisionStructuredData.value) as Record<string, unknown>;
    const updated = await getJson<EngineeringAsset>(`/api/projects/${props.project.id}/engineering-assets/${selectedAsset.value.id}/revisions`, {
      method: 'POST', body: JSON.stringify({ expectedCurrentRevisionId: selectedAsset.value.currentRevisionId,
        changeSummary: revisionSummary.value, structuredData, contentMarkdown: revisionMarkdown.value || null }),
    });
    showRevisionDialog.value = false;
    emit('changed');
    await loadBlueprint({ type: 'asset', id: updated.id });
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '创建版本失败'; }
  finally { savingRevision.value = false; }
}
async function planBlueprint() {
  planning.value = true; error.value = '';
  try {
    await getJson(`/api/projects/${props.project.id}/features/${props.feature.id}/engineering-blueprint/plan`, { method: 'POST', body: JSON.stringify({ createAssets: true }) });
    emit('changed'); await loadBlueprint();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'AI 工程蓝图规划失败'; }
  finally { planning.value = false; }
}

onMounted(() => loadBlueprint());
watch(() => [props.feature.id, props.initialCapabilityId], () => { selectedId.value = ''; void loadBlueprint(); });
</script>

<template>
  <section class="engineering-workbench" @keydown.esc="navigationOpen = false">
    <header class="engineering-header">
      <div class="engineering-title">
        <button type="button" class="back-button" @click="emit('back')">← 功能清单</button>
        <div><span class="workbench-kicker">{{ moduleName }}</span><h1>{{ feature.name }}</h1></div>
      </div>
      <div class="engineering-summary">
        <button type="button" class="navigation-toggle" :aria-expanded="navigationOpen" aria-controls="feature-design-navigation" @click="navigationOpen = !navigationOpen">{{ navigationOpen ? '关闭目录' : '设计目录' }}</button>
        <button type="button" class="plan-button" :disabled="planning" @click="planBlueprint">{{ planning ? '创建中…' : '补充设计草稿' }}</button>
      </div>
    </header>

    <div v-if="error" class="workbench-error">{{ error }}</div>
    <div v-if="loading" class="workbench-loading">正在装载工程对象与追踪关系…</div>
    <div v-else class="engineering-columns">
      <button v-if="navigationOpen" class="navigation-backdrop" type="button" aria-label="关闭设计目录" @click="navigationOpen = false"></button>
      <aside id="feature-design-navigation" class="design-navigation" :class="{ open: navigationOpen }">
        <div class="navigation-intro"><div><strong>设计目录</strong></div><button type="button" @click="showAllDesignTypes = !showAllDesignTypes">{{ showAllDesignTypes ? '隐藏空分类' : '显示空分类' }}</button></div>
        <nav class="design-tree" aria-label="功能设计层级目录">
          <button type="button" :class="['tree-node tree-root', { active: selectedType === 'overview' }]" @click="selectItem('overview', 'overview')">
            <span><strong>{{ feature.name }}</strong></span><b>总览</b>
          </button>

          <div class="tree-branches">
            <section class="tree-branch">
              <button type="button" class="tree-branch-row" :aria-expanded="!collapsedNavBranches.has('capabilities')" @click="toggleNavBranch('capabilities')">
                <span class="tree-caret">{{ collapsedNavBranches.has('capabilities') ? '▸' : '▾' }}</span><strong>功能明细</strong><small>{{ capabilities.length }}</small>
              </button>
              <div v-if="!collapsedNavBranches.has('capabilities')" class="tree-leaves">
                <button v-for="item in capabilities" :key="item.id" type="button" :class="['tree-node tree-leaf capability-leaf', { active: selectedType === 'capability' && selectedId === item.id }]" @click="selectItem('capability', item.id)">
                  <strong :title="`${item.code} ${item.name}`"><code>{{ item.code }}</code> {{ item.name }}</strong><span :data-status="item.status">{{ capabilityLabel(item.status) }}</span>
                </button>
              </div>
            </section>

            <section v-for="group in visibleGroups()" :key="group.key" class="tree-branch">
              <button type="button" class="tree-branch-row" :aria-expanded="!collapsedNavBranches.has(group.key)" @click="toggleNavBranch(group.key)">
                <span class="tree-caret">{{ collapsedNavBranches.has(group.key) ? '▸' : '▾' }}</span><strong>{{ group.label }}</strong><small>{{ assetsFor(group).length }}</small>
              </button>
              <div v-if="!collapsedNavBranches.has(group.key)" class="tree-leaves">
                <button v-for="asset in assetsFor(group)" :key="asset.id" type="button" :class="['tree-node tree-leaf asset-leaf', { active: selectedType === 'asset' && selectedId === asset.id }]" @click="selectItem('asset', asset.id)">
                  <span class="asset-dot"></span><span><strong :title="asset.name">{{ asset.name }}</strong></span>
                </button>
                <p v-if="!assetsFor(group).length">暂无设计</p>
              </div>
            </section>

            <section class="tree-branch tree-delivery-branch">
              <button type="button" class="tree-branch-row" :aria-expanded="!collapsedNavBranches.has('delivery')" @click="toggleNavBranch('delivery')">
                <span class="tree-caret">{{ collapsedNavBranches.has('delivery') ? '▸' : '▾' }}</span><strong>实施与验证</strong><small>2</small>
              </button>
              <div v-if="!collapsedNavBranches.has('delivery')" class="tree-leaves">
                <button type="button" :class="['tree-node tree-leaf simple-leaf', { active: selectedType === 'plan' }]" @click="selectItem('plan', 'plan')"><span class="leaf-index">计</span><strong>开发计划</strong></button>
                <button type="button" :class="['tree-node tree-leaf simple-leaf', { active: selectedType === 'verification' }]" @click="selectItem('verification', 'verification')"><span class="leaf-index">验</span><strong>验证结果</strong></button>
              </div>
            </section>
          </div>
        </nav>
      </aside>

      <main class="engineering-detail">
        <template v-if="selectedType === 'overview'">
          <div class="detail-heading overview-heading">
            <div><h2>{{ feature.name }}</h2></div>
            <div class="feature-state"><span>当前状态</span><strong>{{ featureStatusLabel(feature.status) }}</strong></div>
          </div>
          <section class="overview-metrics">
            <div><span>功能明细</span><strong>{{ capabilities.length }}</strong><small>{{ doneCapabilities }} 项标记完成</small></div>
            <div><span>设计资料</span><strong>{{ assets.length }}</strong></div>
            <div><span>实施任务</span><strong>{{ tasks.length }}</strong><small>{{ runs.length }} 次执行</small></div>
          </section>
          <section class="design-card capability-catalog">
            <header><h3>功能明细</h3></header>
            <div class="catalog-table">
              <button v-for="item in capabilities" :key="item.id" type="button" @click="selectItem('capability', item.id)">
                <strong><code>{{ item.code }}</code> {{ item.name }}</strong><span>{{ capabilityLabel(item.status) }} →</span>
              </button>
            </div>
          </section>
          <details v-if="featureDesign?.latestRevision?.content" class="design-card feature-design-accordion">
            <summary>功能范围与共同边界 <span>REV {{ featureDesign.latestRevision.revisionNo }}</span></summary>
            <ArchiveMarkdown class="design-document" :content="featureDesign.latestRevision.content" />
          </details>
        </template>

        <template v-else-if="selectedAsset">
          <div class="detail-heading">
            <div><span class="detail-type">{{ assetKindLabel(selectedAsset.kind) }}</span><h2>{{ selectedAsset.name }}</h2></div>
            <div class="asset-actions"><div class="detail-badges"><span>{{ assetStatusLabel(selectedAsset.status) }}</span><strong v-if="selectedHistoricalRevision">历史版本 · 只读</strong></div><div><button type="button" @click="showAssetHistory = !showAssetHistory">查看历史版本</button><button type="button" class="primary" @click="openRevisionDialog">创建新版本</button></div></div>
          </div>
          <section v-if="showAssetHistory" class="design-card revision-history-card">
            <header><h3>工程设计版本历史</h3></header>
            <div class="revision-history-list"><button v-for="revision in assetHistory" :key="revision.id" type="button" :class="{ active: selectedRevisionId === revision.id }" @click="selectedRevisionId = selectedRevisionId === revision.id ? '' : revision.id"><strong>版本 {{ revision.revisionNo }}</strong><span>{{ revision.changeSummary }}</span><small>{{ revision.source }} · {{ new Date(revision.createdAt).toLocaleString('zh-CN') }}</small><b>{{ revision.id === selectedAsset.currentRevisionId ? '当前' : '只读' }}</b></button></div>
          </section>
          <section v-if="selectedAsset.canonicalStatus === 'CONFLICT'" class="canonical-warning"><strong>核心数据冲突</strong><span>{{ selectedAsset.canonicalConflicts.join('；') }}</span></section>
          <SqlDataModelView v-if="isSqlDataModel" :data="selectedStructured" :markdown="selectedMarkdown" />
          <template v-else>
            <dl v-if="selectedFacts.length" class="fact-grid">
              <div v-for="([key, value]) in selectedFacts" :key="key"><dt>{{ keyLabel(key) }}</dt><dd>{{ valueText(value) }}</dd></div>
            </dl>
            <section v-for="table in selectedTables" :key="table.title" class="design-card table-card">
              <header><h3>{{ table.title }}</h3><span>{{ table.rows.length }} 项</span></header>
              <div class="table-scroll"><table><thead><tr><th v-for="column in table.columns" :key="column">{{ column }}</th></tr></thead><tbody><tr v-for="(row, rowIndex) in table.rows" :key="rowIndex"><td v-for="(cell, index) in row" :key="index">{{ cell }}</td></tr></tbody></table></div>
            </section>
            <section v-if="selectedMarkdown" class="design-card narrative-card"><header><h3>设计说明</h3></header><ArchiveMarkdown class="narrative" :content="selectedMarkdown" /><details class="design-source"><summary>查看原文</summary><pre>{{ selectedMarkdown }}</pre></details></section>
          </template>
          <section class="design-card trace-card"><header><h3>关联</h3></header><div v-if="(blueprint?.traceLinks ?? []).filter(link => link.sourceId === selectedAsset?.id || link.targetId === selectedAsset?.id).length" class="trace-list"><div v-for="link in (blueprint?.traceLinks ?? []).filter(link => link.sourceId === selectedAsset?.id || link.targetId === selectedAsset?.id)" :key="link.id"><strong>{{ traceLeft(link) }}</strong><span>{{ relationLabel(link.relation) }}</span><strong>{{ traceRight(link) }}</strong></div></div><p v-else class="empty-copy">暂无显式追踪关系。</p></section>
        </template>

        <template v-else-if="selectedCapability">
          <div class="detail-heading capability-heading">
            <div><span class="detail-type">{{ selectedCapability.code }}</span><h2>{{ selectedCapability.name }}</h2></div>
            <div class="capability-state" :data-status="selectedCapability.status"><span>当前状态</span><strong>{{ capabilityLabel(selectedCapability.status) }}</strong></div>
          </div>
          <section v-if="capabilityDetail?.design?.latestRevision?.content" class="design-card capability-design"><header><h3>操作设计</h3><span>REV {{ capabilityDetail.design.latestRevision.revisionNo }}</span></header><CapabilityDesignView :content="capabilityDetail.design.latestRevision.content" /></section>
          <div class="capability-progress-line"><span>关联设计 {{ associatedAssets.length }}</span><span>实施任务 {{ capabilityTasks.length }}</span><span>当前 CI 核验 {{ currentCheckCount(selectedCapability.id) }} / {{ capabilityTasks.length }}</span></div>
          <section v-if="associatedAssets.length" class="design-card"><header><h3>关联设计</h3></header><div class="asset-link-grid"><button v-for="asset in associatedAssets" :key="asset.id" type="button" @click="selectItem('asset', asset.id)"><span>{{ assetKindLabel(asset.kind) }}</span><strong>{{ asset.name }}</strong></button></div></section>
          <section v-if="capabilityTasks.length" class="design-card implementation-card"><header><h3>实现与验证</h3></header><div class="implementation-list"><article v-for="task in capabilityTasks" :key="task.id"><div><code>{{ task.code }}</code><strong>{{ task.name }}</strong><span :data-task-status="task.status">{{ taskStatus(task) }}</span></div><p>{{ task.objective }}</p><div v-for="run in capabilityRuns.filter(item => item.taskId === task.id)" :key="run.id" class="run-evidence"><span>执行记录 · {{ run.actorName }}</span><strong>{{ verificationLabel(run) }}</strong><code>{{ run.resultCommit ?? '尚无提交' }}</code><small>{{ run.changedFiles.map(runFileLabel).join(' · ') || '尚无文件记录' }}</small><p>{{ run.verificationSummary?.summary ?? run.summary }}</p></div></article></div></section>
          <details v-if="traceLinks.length" class="design-card trace-card"><summary>来源与追踪 <span>{{ traceLinks.length }} 条关系</span></summary><div class="trace-list"><div v-for="link in traceLinks" :key="link.id"><strong>{{ traceLeft(link) }}</strong><span>{{ relationLabel(link.relation) }}</span><strong>{{ traceRight(link) }}</strong></div></div></details>
        </template>

        <template v-else-if="selectedType === 'plan'">
          <div class="detail-heading"><div><h2>开发计划</h2></div></div>
          <section class="design-card"><header><h3>能力项实施计划</h3><span>{{ tasks.length }} 项任务</span></header><div class="plan-table"><div class="plan-row head"><span>能力项</span><span>实施任务</span><span>领域</span><span>状态</span><span>当前 CI 核验</span></div><div v-for="capability in capabilities" :key="capability.id" class="plan-row"><span><code>{{ capability.code }}</code> {{ capability.name }}</span><span>{{ tasks.find(item => item.capabilityId === capability.id)?.name ?? '待规划' }}</span><span>{{ tasks.find(item => item.capabilityId === capability.id)?.area || '—' }}</span><span>{{ capabilityLabel(capability.status) }}</span><span>{{ currentCheckCount(capability.id) }} / {{ tasks.filter(task => task.capabilityId === capability.id).length }}</span></div></div></section>
        </template>

        <template v-else>
          <div class="detail-heading"><div><h2>验证设计与执行结果</h2></div></div>
          <section v-for="asset in assets.filter(item => item.kind === 'TEST_DESIGN')" :key="asset.id" class="design-card table-card"><header><h3>{{ asset.name }}</h3><span>{{ assetStatusLabel(asset.status) }}</span></header><div class="table-scroll"><table v-for="table in buildTables(asset.structuredData ?? {})" :key="table.title"><thead><tr><th v-for="column in table.columns" :key="column">{{ column }}</th></tr></thead><tbody><tr v-for="(row, ri) in table.rows" :key="ri"><td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td></tr></tbody></table></div></section>
      <section class="design-card run-snapshot-card"><header><h3>任务执行与设计快照</h3><span>{{ visibleRuns.length }} 次运行</span></header><div class="run-snapshot-list"><article v-for="(run, index) in visibleRuns" :key="run.id"><header><div><span>RUN-{{ String(visibleRuns.length - index).padStart(3, '0') }}</span><strong>{{ run.summary || '执行中' }}</strong></div><div><b :data-freshness="run.designSnapshotStatus">{{ run.designSnapshotStatus === 'STALE' ? '设计已变更' : run.designSnapshotStatus === 'CURRENT' ? '当前设计' : '未冻结' }}</b><em>{{ verificationLabel(run) }}</em></div></header><div class="snapshot-grid"><section><h4>设计快照</h4><p v-for="spec in run.designSnapshot.specifications" :key="spec.revisionId"><span>设计资料</span><code>REV {{ spec.revisionNo }}</code><small>{{ spec.revisionId.slice(0, 8) }}</small></p><p v-for="asset in run.designSnapshot.engineeringAssets" :key="asset.revisionId"><span>{{ assets.find(item => item.id === asset.assetId)?.name ?? '工程设计' }}</span><code>REV {{ asset.revisionNo }}</code><small>{{ asset.revisionId.slice(0, 8) }}</small></p><i v-for="warning in run.designSnapshotWarnings" :key="warning">{{ warning }}</i></section><section><h4>多源码执行快照</h4><div v-for="execution in run.sourceExecutions" :key="execution.sourceId" class="source-snapshot"><strong>{{ sourceName(execution.sourceId) }}</strong><span>基线 {{ execution.baseline.commit ?? execution.baseline.manifestHash ?? execution.baseline.kind }}</span><span>结果 {{ execution.result.commit ?? execution.result.workingTreeSummary ?? '无提交' }}</span><small>{{ execution.read ? '已读取' : '未读取' }} · {{ execution.modified ? '已修改' : '未修改' }}</small><code v-for="file in execution.changedFiles" :key="runFileLabel(file)">{{ runFileLabel(file) }}</code><em v-for="verification in execution.verification" :key="`${verification.workdir}:${verification.command}`">{{ verification.reportedStatus }} · {{ verification.workdir }} · {{ verification.command }}</em></div><p v-if="!run.sourceExecutions.length" class="empty-copy">本次执行未关联 Source。</p></section></div></article></div></section>
        </template>
      </main>
    </div>
    <div v-if="showRevisionDialog" class="revision-dialog-backdrop" @click.self="showRevisionDialog = false"><form class="revision-dialog" @submit.prevent="createRevision"><header><div><span>创建不可变版本</span><h2>{{ selectedAsset?.name }} · REV {{ (selectedAsset?.currentRevisionNo ?? 0) + 1 }}</h2></div><button type="button" @click="showRevisionDialog = false">×</button></header><label>变更摘要<input v-model="revisionSummary" maxlength="500" required /></label><label>结构化数据 (JSON)<textarea v-model="revisionStructuredData" rows="12" spellcheck="false" required /></label><label>设计说明 Markdown<textarea v-model="revisionMarkdown" rows="8" spellcheck="false" /></label><footer><button type="button" @click="showRevisionDialog = false">取消</button><button type="submit" class="primary" :disabled="savingRevision">{{ savingRevision ? '保存中…' : '创建新版本' }}</button></footer></form></div>
  </section>
</template>

<style scoped>
.engineering-workbench { container: feature-detail / inline-size; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden; background: var(--canvas); color: var(--ink); }
.engineering-header { display: flex; flex-shrink: 0; min-height: 76px; align-items: center; justify-content: space-between; gap: 20px; padding: 12px 24px; border-bottom: 1px solid var(--line); background: var(--surface); }
.engineering-title { display: flex; align-items: center; gap: 16px; min-width: 300px; }
.back-button { min-height: 34px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface); color: var(--ink-secondary); font-size: 13px; font-weight: 500; white-space: nowrap; transition: all 0.15s; }
.back-button:hover { background: var(--surface-subtle); border-color: var(--muted-light); }
.workbench-kicker, .detail-type { color: var(--primary); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.engineering-title h1 { margin: 2px 0 2px; font-size: 24px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; color: var(--ink); }
.engineering-title p, .detail-heading p { margin: 0; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
.engineering-summary { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.engineering-summary > div { display: grid; align-content: center; gap: 2px; min-height: 60px; padding: 6px 16px; border-left: 1px solid var(--line); }
.engineering-summary span { color: var(--muted); font-size: 12px; }
.engineering-summary strong { font-size: 20px; font-weight: 700; color: var(--ink); }
.engineering-summary small { color: var(--muted-light); font-size: 11.5px; }
.plan-button { align-self: center; min-height: 38px; margin-left: 16px; padding: 0 16px; border: 0; border-radius: 6px; background: var(--primary); color: var(--primary-ink); font-size: 13.5px; font-weight: 600; box-shadow: 0 1px 2px color-mix(in srgb, var(--primary) 20%, transparent); transition: all 0.15s; }
.plan-button:hover { background: var(--primary-hover); }
.workbench-error, .workbench-loading { padding: 16px 24px; font-size: 13.5px; text-align: center; }
.workbench-error { background: #fff1f2; color: #e11d48; }
.engineering-columns { position: relative; display: grid; grid-template-columns: 250px minmax(0, 1fr); flex: 1; min-height: 0; overflow: hidden; }
.navigation-toggle { display: none; min-height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: var(--primary); font-size: 12px; }
.navigation-backdrop { display: none; }
.design-navigation { min-height: 0; overflow-y: auto; border-right: 1px solid var(--line); background: var(--surface-subtle); }
.navigation-intro { display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--line); background: var(--surface); }
.navigation-intro > div { display: grid; gap: 2px; }
.navigation-intro strong { font-size: 14px; font-weight: 750; color: var(--ink); }
.navigation-intro small { color: var(--muted); font-size: 10.5px; }
.navigation-intro button { padding: 0; border: 0; background: transparent; color: var(--primary); font-size: 12px; font-weight: 650; cursor: pointer; }
.design-tree { padding: 14px 10px 28px; }
.tree-node, .tree-branch-row { width: 100%; border: 0; background: transparent; color: var(--ink); text-align: left; cursor: pointer; transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease; }
.tree-node:focus-visible, .tree-branch-row:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.tree-root { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; min-height: 38px; padding: 8px 10px; border: 1px solid transparent; border-radius: 5px; background: transparent; }
.tree-root:hover { border-color: var(--muted-light); background: var(--surface-subtle); }
.tree-root.active { background: var(--primary-subtle); box-shadow: inset 3px 0 var(--primary); }
.tree-root-mark { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 5px; background: var(--ink); color: var(--primary-ink); font: 700 11px var(--mono); }
.tree-root > span { display: grid; min-width: 0; gap: 2px; }
.tree-root small { color: var(--muted); font-size: 10.5px; }
.tree-root strong { overflow: hidden; color: var(--ink); font-size: 14px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
.tree-root b { padding: 3px 7px; border-radius: 4px; background: var(--primary-subtle); color: var(--primary-hover); font-size: 10.5px; font-weight: 700; }
.tree-branches { position: relative; margin-left: 9px; padding: 5px 0 0 12px; }
.tree-branches::before { position: absolute; top: 0; bottom: 14px; left: 0; width: 1px; background: var(--line-strong); content: ''; }
.tree-branch { position: relative; }
.tree-branch::before { position: absolute; top: 18px; left: -15px; width: 13px; height: 1px; background: var(--line-strong); content: ''; }
.tree-branch-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 5px; min-height: 36px; padding: 0 8px 0 2px; border-radius: 5px; }
.tree-branch-row:hover { background: var(--surface-hover); }
.tree-branch-row strong { font-size: 12.5px; font-weight: 700; color: var(--ink-secondary); }
.tree-branch-row small { min-width: 22px; color: var(--muted); font: 11px var(--mono); text-align: right; }
.tree-caret { color: var(--muted); font-size: 11px; }
.tree-leaves { position: relative; margin-left: 9px; padding: 1px 0 4px 17px; }
.tree-leaves::before { position: absolute; top: 0; bottom: 10px; left: 0; width: 1px; background: var(--line); content: ''; }
.tree-leaves > p { margin: 3px 0 6px; color: var(--muted-light); font-size: 11px; }
.tree-leaf { position: relative; display: grid; align-items: center; gap: 7px; min-height: 38px; padding: 4px 8px; border-radius: 5px; }
.tree-leaf::before { position: absolute; top: 19px; left: -17px; width: 14px; height: 1px; background: var(--line); content: ''; }
.tree-leaf:hover { background: var(--surface-hover); }
.tree-leaf.active { background: var(--primary-subtle); box-shadow: inset 2px 0 var(--primary); }
.capability-leaf { grid-template-columns: minmax(0, 1fr) auto; }
.capability-leaf code { color: var(--muted); font: 700 10.5px var(--mono); }
.capability-leaf strong code { margin-right: 4px; }
.capability-leaf strong, .asset-leaf strong, .simple-leaf strong { overflow: hidden; color: var(--ink); font-size: 12.5px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.capability-leaf > span { color: var(--muted); font-size: 10px; }
.capability-leaf > span[data-status="DONE"] { color: #15803d; }
.capability-leaf > span[data-status="BLOCKED"] { color: #be123c; }
.asset-leaf { grid-template-columns: 16px minmax(0, 1fr); }
.asset-leaf > span:nth-child(2) { display: grid; min-width: 0; gap: 1px; }
.asset-leaf small { overflow: hidden; color: var(--muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
.asset-dot { z-index: 1; width: 7px; height: 7px; margin-left: 2px; border: 2px solid var(--surface-subtle); border-radius: 50%; background: var(--muted-light); }
.asset-leaf.active .asset-dot { background: var(--primary); }
.simple-leaf { grid-template-columns: 24px minmax(0, 1fr); }
.leaf-index { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 4px; background: var(--line); color: var(--ink-secondary); font-size: 10px; font-weight: 750; }
.tree-delivery-branch { margin-top: 2px; }
.engineering-detail { min-width: 0; min-height: 0; overflow-y: auto; padding: 24px clamp(20px, 3vw, 36px) 48px; background: var(--canvas); }
.detail-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; max-width: 1200px; margin: 0 auto 20px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.detail-heading h2 { margin: 4px 0 6px; font-size: 21px; font-weight: 650; line-height: 1.4; color: var(--ink); overflow-wrap: anywhere; }
.detail-heading h2 code { color: var(--muted); font-size: 16px; }
.feature-state { display: grid; min-width: 140px; gap: 3px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.feature-state span, .feature-state small { color: var(--muted); font-size: 11.5px; }
.feature-state strong { color: var(--ink); font-size: 14px; font-weight: 600; }
.overview-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); max-width: 1200px; margin: 0 auto 20px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); overflow: hidden; }
.overview-metrics > div { display: grid; gap: 3px; padding: 14px 18px; border-right: 1px solid var(--line); }
.overview-metrics > div:last-child { border-right: 0; }
.overview-metrics span, .overview-metrics small { color: var(--muted); font-size: 12px; }
.overview-metrics strong { color: var(--ink); font-size: 18px; }
.catalog-table { display: grid; }
.catalog-table button { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 40px; padding: 8px 20px; border: 0; border-bottom: 1px solid var(--line-subtle); background: var(--surface); color: var(--ink-secondary); text-align: left; }
.catalog-table button:last-child { border-bottom: 0; }
.catalog-table button:hover { background: var(--surface-subtle); }
.catalog-table code { color: var(--primary); font-weight: 700; }
.catalog-table strong { color: var(--ink); font-size: 14px; }
.catalog-table p { margin: 0; color: var(--ink-secondary); font-size: 13.5px; line-height: 1.5; }
.catalog-table span { color: var(--muted); font-size: 12px; text-align: right; }
.design-document { min-width: 0; padding: 18px 20px; }
.design-source { min-width: 0; border-top: 1px solid var(--line); padding: 10px 20px 16px; color: var(--muted); font-size: 12px; }
.design-source summary { width: fit-content; cursor: pointer; color: var(--primary); }
.design-source pre { max-height: 400px; overflow: auto; margin: 10px 0 0; padding: 12px; background: var(--surface-subtle); color: var(--ink-secondary); font: 12px/1.6 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.capability-definition { display: grid; max-width: 1200px; margin: 0 auto 16px; gap: 5px; padding: 14px 18px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.capability-definition span { color: var(--muted); font-size: 11.5px; font-weight: 600; }
.capability-definition strong { color: var(--ink); font-size: 15px; line-height: 1.5; }
.capability-definition small { color: var(--muted); font-size: 12px; }
.detail-badges { display: flex; gap: 8px; }
.detail-badges span, .detail-badges code { padding: 4px 8px; border-radius: 4px; background: var(--surface-subtle); color: var(--ink-secondary); font-size: 12px; font-weight: 500; }
.detail-badges strong { padding: 4px 8px; border-radius: 4px; background: var(--primary-subtle); color: var(--primary-hover); font-size: 12px; font-weight: 600; }
.asset-actions { display: grid; justify-items: end; gap: 10px; }
.asset-actions > div:last-child { display: flex; gap: 8px; }
.asset-actions button { min-height: 32px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface); color: var(--ink-secondary); font-size: 13px; font-weight: 500; transition: all 0.15s; }
.asset-actions button:hover { background: var(--surface-subtle); border-color: var(--muted-light); }
.asset-actions button.primary, .revision-dialog button.primary { border: 0; background: var(--primary); color: var(--primary-ink); font-weight: 600; box-shadow: 0 1px 2px color-mix(in srgb, var(--primary) 20%, transparent); }
.asset-actions button.primary:hover, .revision-dialog button.primary:hover { background: var(--primary-hover); }
.revision-history-list { display: grid; }
.revision-history-list button { display: grid; grid-template-columns: 85px minmax(180px, 1fr) 240px 50px; align-items: center; gap: 14px; min-height: 50px; padding: 8px 18px; border: 0; border-bottom: 1px solid var(--surface-subtle); background: var(--surface); color: var(--ink-secondary); text-align: left; }
.revision-history-list button:last-child { border-bottom: 0; }
.revision-history-list button:hover, .revision-history-list button.active { background: var(--primary-subtle); }
.revision-history-list strong { font: 700 12.5px var(--mono); color: var(--primary-hover); }
.revision-history-list span { font-size: 13.5px; color: var(--ink); }
.revision-history-list small { color: var(--muted); font-size: 12px; }
.revision-history-list b { color: var(--primary); font-size: 11.5px; text-align: right; }
.canonical-warning { display: flex; max-width: 1200px; margin: 0 auto 18px; padding: 12px 16px; border: 1px solid #fecdd3; border-radius: 8px; background: #fff1f2; color: #9f1239; font-size: 13.5px; }
.canonical-warning strong { margin-right: 14px; }
.fact-grid, .capability-overview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); max-width: 1200px; margin: 0 auto 20px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); overflow: hidden; }
.fact-grid > div, .capability-overview-grid > div { display: grid; align-content: center; gap: 4px; min-height: 68px; padding: 12px 18px; border-right: 1px solid var(--line); }
.fact-grid > div:last-child, .capability-overview-grid > div:last-child { border-right: 0; }
.fact-grid dt, .capability-overview-grid span { color: var(--muted); font-size: 12px; font-weight: 500; }
.fact-grid dd { margin: 0; font-size: 14.5px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
.capability-overview-grid strong { font-size: 16px; font-weight: 700; color: var(--ink); }
.capability-state { display: grid; gap: 3px; min-width: 110px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.capability-state span { color: var(--muted); font-size: 11.5px; }
.capability-state strong { font-size: 14px; font-weight: 600; color: var(--ink); }
.design-card { min-width: 0; max-width: 1200px; margin: 0 auto 20px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); overflow: hidden; }
.feature-design-accordion > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 46px; padding: 10px 20px; color: var(--ink); font-size: 14px; font-weight: 600; cursor: pointer; }
.feature-design-accordion > summary span { color: var(--muted); font-size: 12px; font-weight: 400; }
.feature-design-accordion[open] > summary { border-bottom: 1px solid var(--line); }
.trace-card > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 46px; padding: 10px 20px; color: var(--ink); font-size: 14px; font-weight: 600; cursor: pointer; }
.trace-card > summary span { color: var(--muted); font-size: 12px; font-weight: 400; }
.trace-card[open] > summary { border-bottom: 1px solid var(--line); }
.capability-progress-line { display: flex; flex-wrap: wrap; gap: 8px 18px; max-width: 1200px; margin: -4px auto 18px; color: var(--muted); font-size: 12px; }
.design-card > header { display: flex; min-height: 46px; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid var(--line); background: var(--surface-subtle); }
.design-card > header h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--ink); }
.design-card > header span { color: var(--muted); font-size: 12px; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th, td { padding: 10px 16px; border-bottom: 1px solid var(--surface-subtle); text-align: left; vertical-align: top; }
th { background: var(--surface-subtle); color: var(--ink-secondary); font-size: 12.5px; font-weight: 600; white-space: nowrap; }
td { color: var(--ink-secondary); line-height: 1.5; }
tbody tr:last-child td { border-bottom: 0; }
.narrative { padding: 18px 20px; }
.asset-link-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 12px; gap: 8px; }
.asset-link-grid button { display: grid; gap: 4px; min-height: 58px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface); color: var(--ink); text-align: left; transition: background 0.15s; }
.asset-link-grid button:hover { border-color: var(--primary); background: var(--primary-subtle); transform: translateY(-1px); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04); }
.asset-link-grid span { color: var(--primary); font-size: 11.5px; font-weight: 700; }
.asset-link-grid strong { font-size: 14px; font-weight: 600; }
.asset-link-grid small { color: var(--muted); font-size: 12px; line-height: 1.4; }
.implementation-list > article { padding: 16px 20px; border-bottom: 1px solid var(--surface-subtle); }
.implementation-list > article:last-child { border-bottom: 0; }
.implementation-list > article > div:first-child { display: flex; align-items: center; gap: 10px; }
.implementation-list strong { font-size: 14.5px; font-weight: 600; color: var(--ink); }
.implementation-list > article > div:first-child span { margin-left: auto; padding: 2px 7px; border-radius: 4px; background: var(--surface-subtle); font-size: 11.5px; font-weight: 600; color: var(--ink-secondary); }
.implementation-list > article > p { color: var(--muted); font-size: 13.5px; margin: 4px 0 0; }
.run-evidence { display: grid; grid-template-columns: auto auto auto minmax(0, 1fr); gap: 8px 14px; margin-top: 12px; padding: 12px 14px; border-radius: 8px; background: var(--surface-subtle); border: 1px solid var(--surface-subtle); }
.run-evidence span, .run-evidence strong, .run-evidence code { font-size: 12.5px; }
.run-evidence strong { color: var(--primary); }
.run-evidence small { overflow: hidden; color: var(--muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.run-evidence p { grid-column: 1 / -1; margin: 0; color: var(--ink-secondary); font-size: 13px; }
.trace-list { padding: 6px 20px 14px; }
.trace-list > div { display: grid; grid-template-columns: minmax(130px, 1fr) 100px minmax(130px, 1fr); align-items: center; gap: 12px; min-height: 42px; border-bottom: 1px solid var(--surface-subtle); }
.trace-list > div:last-child { border-bottom: 0; }
.trace-list strong { font-size: 13.5px; font-weight: 600; color: var(--ink); }
.trace-list span { color: var(--muted); font-size: 12px; text-align: center; }
.empty-copy { margin: 0; padding: 24px; color: var(--muted-light); font-size: 13.5px; text-align: center; }
.plan-table { overflow-x: auto; }
.plan-row { display: grid; grid-template-columns: 1.1fr 1.5fr 0.7fr 0.65fr 0.55fr; gap: 12px; min-width: 780px; padding: 12px 20px; border-bottom: 1px solid var(--surface-subtle); font-size: 13.5px; }
.plan-row.head { background: var(--surface-subtle); color: var(--ink-secondary); font-size: 12.5px; font-weight: 600; }
.plan-row code { margin-right: 7px; color: var(--primary); font-weight: 700; }
.run-snapshot-list > article { padding: 18px 22px; border-bottom: 1px solid var(--surface-subtle); }
.run-snapshot-list > article:last-child { border-bottom: 0; }
.run-snapshot-list > article > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
.run-snapshot-list > article > header > div { display: flex; align-items: center; gap: 10px; }
.run-snapshot-list header span { color: var(--primary); font: 700 12.5px var(--mono); }
.run-snapshot-list header strong { font-size: 14.5px; font-weight: 600; color: var(--ink); }
.run-snapshot-list header b, .run-snapshot-list header em { padding: 3px 8px; border-radius: 4px; background: var(--primary-subtle); color: var(--primary-hover); font-size: 11.5px; font-style: normal; font-weight: 600; }
.run-snapshot-list header b[data-freshness="STALE"] { background: #fffbeb; color: #b45309; }
.run-snapshot-list header b[data-freshness="UNKNOWN"] { background: var(--surface-subtle); color: var(--muted); }
.snapshot-grid { display: grid; grid-template-columns: 1fr 1.2fr; gap: 14px; }
.snapshot-grid > section { min-width: 0; padding: 12px 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-subtle); }
.snapshot-grid h4 { margin: 0 0 8px; font-size: 13.5px; font-weight: 600; color: var(--ink); }
.snapshot-grid p { display: grid; grid-template-columns: minmax(120px, 1fr) 70px 70px; margin: 0; padding: 6px 0; border-bottom: 1px solid var(--surface-subtle); font-size: 12.5px; }
.snapshot-grid i { display: block; margin-top: 8px; color: #b45309; font-size: 12px; font-style: normal; }
.source-snapshot { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; padding: 8px 0; border-bottom: 1px solid var(--surface-subtle); }
.source-snapshot:last-child { border-bottom: 0; }
.source-snapshot strong, .source-snapshot small { grid-column: 1 / -1; font-size: 12.5px; }
.source-snapshot span, .source-snapshot code, .source-snapshot em { overflow-wrap: anywhere; font-size: 11.5px; }
.source-snapshot code, .source-snapshot em { grid-column: 1 / -1; }
.source-snapshot em { color: var(--muted); font-style: normal; }
.revision-dialog-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 24px; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); }
.revision-dialog { display: flex; flex-direction: column; gap: 14px; width: min(840px, calc(100vw - 48px)); max-height: calc(90vh); overflow: auto; padding: 24px; border-radius: 16px; background: var(--surface); box-shadow: var(--shadow-xl); }
.revision-dialog header, .revision-dialog footer { display: flex; align-items: center; justify-content: space-between; gap: 15px; }
.revision-dialog header span { color: var(--primary); font-size: 12px; font-weight: 700; text-transform: uppercase; }
.revision-dialog h2 { margin: 2px 0 0; font-size: 20px; font-weight: 700; color: var(--ink); }
.revision-dialog header > button { border: 0; background: transparent; color: var(--muted); font-size: 24px; line-height: 1; cursor: pointer; }
.revision-dialog label { display: flex; flex-direction: column; gap: 6px; color: var(--ink-secondary); font-size: 13px; font-weight: 600; }
.revision-dialog input, .revision-dialog textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); color: var(--ink); font: 13.5px/1.5 var(--mono); }
.revision-dialog input:focus, .revision-dialog textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent); }
.revision-dialog footer { justify-content: flex-end; }
.revision-dialog footer button { min-height: 38px; padding: 0 16px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface); color: var(--ink-secondary); font-size: 13.5px; font-weight: 500; cursor: pointer; }
@container feature-detail (max-width: 1000px) {
  .engineering-header { padding-inline: 18px; }
  .engineering-title { min-width: 0; }
  .engineering-title h1 { font-size: 20px; }
  .engineering-columns { grid-template-columns: 220px minmax(0, 1fr); }
  .engineering-detail { padding: 20px 18px 40px; }
  .detail-heading { gap: 12px; flex-wrap: wrap; }
  .detail-heading > div:first-child { min-width: 0; }
  .fact-grid, .capability-overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .snapshot-grid { grid-template-columns: minmax(0, 1fr); }
  .revision-history-list button { grid-template-columns: 64px minmax(0, 1fr) 40px; gap: 8px; }
  .revision-history-list small { grid-column: 2; grid-row: 2; }
  .revision-history-list b { grid-column: 3; grid-row: 1; }
}
@container feature-detail (max-width: 760px) {
  .engineering-header { padding: 10px 12px; min-height: 64px; gap: 10px; flex-wrap: wrap; }
  .engineering-title { gap: 10px; flex: 1 1 250px; }
  .engineering-title > div { min-width: 0; }
  .engineering-title h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .engineering-summary { margin-left: auto; }
  .navigation-toggle { display: inline-flex; align-items: center; }
  .plan-button { min-height: 34px; margin: 0; padding-inline: 10px; font-size: 12px; }
  .engineering-columns { grid-template-columns: minmax(0, 1fr); }
  .navigation-backdrop { display: block; position: absolute; z-index: 29; inset: 0; border: 0; background: rgb(31 38 35 / 20%); }
  .design-navigation { display: none; position: absolute; z-index: 30; top: 0; bottom: 0; left: 0; width: min(290px, 88%); background: var(--surface); box-shadow: var(--shadow-lg); }
  .design-navigation.open { display: block; }
  .navigation-intro { min-height: 42px; }
  .engineering-detail { padding: 18px 12px 32px; }
  .asset-actions { width: 100%; justify-items: start; }
  .asset-actions > div:last-child { flex-wrap: wrap; }
  .overview-metrics > div { padding: 10px 12px; }
  .overview-metrics strong { font-size: 16px; }
  .asset-link-grid { grid-template-columns: minmax(0, 1fr); }
  .design-card > header { gap: 10px; padding: 8px 12px; }
  .design-card > header span { text-align: right; }
  .run-evidence { grid-template-columns: 1fr 1fr; }
  .trace-list > div { grid-template-columns: minmax(0, 1fr); gap: 3px; padding: 10px 0; }
  .trace-list span { text-align: left; }
  .run-snapshot-list > article > header, .run-snapshot-list > article > header > div { flex-wrap: wrap; }
  .fact-grid > div, .capability-overview-grid > div { min-height: 52px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .design-document { padding: 14px 12px; }
  .design-source { padding-inline: 12px; }
}
@container feature-detail (max-width: 400px) {
  .fact-grid, .capability-overview-grid { grid-template-columns: minmax(0, 1fr); }
  .overview-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .overview-metrics small { display: none; }
  .overview-metrics > div { padding: 8px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
}
</style>
