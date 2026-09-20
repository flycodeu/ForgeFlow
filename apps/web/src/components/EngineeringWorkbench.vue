<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type {
  AiRun, Capability, CapabilityDetail, EngineeringAsset, EngineeringAssetRevision, Feature, FeatureEngineeringBlueprint, Project, ProjectDetail, Task, TraceLink,
} from '@forgeflow/contracts';
import { api as getJson } from '../api-client';

type NavFolder = { kind: string; label: string };
type NavGroup = { key: string; label: string; folders: NavFolder[] };
type TableData = { title: string; columns: string[]; rows: string[][] };

const props = defineProps<{ project: Project; feature: Feature; moduleName: string; detail: ProjectDetail }>();
const emit = defineEmits<{ changed: []; back: [] }>();

const blueprint = ref<FeatureEngineeringBlueprint | null>(null);
const selectedType = ref<'capability' | 'asset' | 'plan' | 'verification'>('capability');
const selectedId = ref('');
const capabilityDetail = ref<CapabilityDetail | null>(null);
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
const collapsedAssetFolders = ref(new Set<string>());

const navGroups: NavGroup[] = [
  { key: 'data', label: '数据与模型', folders: [{ kind: 'DATA_MODEL', label: '数据模型' }, { kind: 'CODE_MODEL', label: '代码模型' }, { kind: 'GODOT_RESOURCE', label: 'Godot Resource' }, { kind: 'MESSAGE_SCHEMA', label: '消息模型' }] },
  { key: 'contract', label: '接口与契约', folders: [{ kind: 'INTERFACE', label: '接口' }, { kind: 'PROTOBUF', label: 'Protobuf' }, { kind: 'MESSAGE_TOPIC', label: '消息主题' }, { kind: 'SIGNAL', label: 'Signal' }, { kind: 'CLI_CONTRACT', label: 'CLI 契约' }] },
  { key: 'ui', label: 'UI 与交互', folders: [{ kind: 'UI_DESIGN', label: '页面与交互' }] },
  { key: 'integration', label: '集成关系', folders: [{ kind: 'INTEGRATION', label: '集成契约' }] },
  { key: 'runtime', label: '算法 / Pipeline', folders: [{ kind: 'ALGORITHM', label: '算法' }, { kind: 'PIPELINE', label: 'Pipeline' }, { kind: 'CUDA_KERNEL', label: 'CUDA Kernel' }, { kind: 'WORKFLOW_NODE', label: '工作流节点' }] },
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
const designSections = computed(() => parseMarkdown(capabilityDetail.value?.design?.latestRevision?.content ?? ''));
const traceLinks = computed(() => {
  const ids = new Set([props.feature.id, selectedId.value, ...associatedAssets.value.map((item) => item.id), ...capabilityTasks.value.map((item) => item.id), ...capabilityRuns.value.map((item) => item.id)]);
  return (blueprint.value?.traceLinks ?? []).filter((item) => ids.has(item.sourceId) || ids.has(item.targetId));
});

function assetsFor(group: NavGroup) { return assets.value.filter((item) => group.folders.some((folder) => folder.kind === item.kind)); }
function assetsForFolder(folder: NavFolder) { return assets.value.filter((item) => item.kind === folder.kind); }
function visibleFolders(group: NavGroup) { return group.folders.filter((folder) => showAllDesignTypes.value || assetsForFolder(folder).length > 0); }
function visibleGroups() {
  const knownKinds = new Set(navGroups.flatMap((group) => group.folders.map((folder) => folder.kind)));
  const customFolders = [...new Set(assets.value.map((asset) => asset.kind).filter((kind) => !knownKinds.has(kind) && kind !== 'TEST_DESIGN'))]
    .map((kind) => ({ kind, label: assetKindLabel(kind) }));
  const groups = customFolders.length ? [...navGroups, { key: 'other', label: '其他工程设计', folders: customFolders }] : navGroups;
  return groups.filter((group) => showAllDesignTypes.value || assetsFor(group).length > 0);
}
function toggleAssetFolder(kind: string) {
  const next = new Set(collapsedAssetFolders.value);
  if (next.has(kind)) next.delete(kind); else next.add(kind);
  collapsedAssetFolders.value = next;
}
function capabilityLabel(status: Capability['status']) {
  return { DRAFT: '草稿', DESIGNED: '已设计', IMPLEMENTING: '实现中', TESTING: '验证中', DONE: '已完成', BLOCKED: '受阻' }[status];
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
    permission: '权限', model: '模型', framework: '框架', runtime: '运行时', latencyTarget: '延迟目标', throughput: '吞吐目标',
    transaction: '事务', compatibility: '兼容性', input: '输入', output: '输出', timeout: '超时', retry: '重试', failure: '失败处理',
    producer: '生产者', consumer: '消费者', threadModel: '线程模型', ownership: '资源所有权', backpressure: '背压',
    default: '默认值', required: '必填', nullable: '可空', description: '说明', constraint: '约束', source: '来源', status: '状态',
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
function parseMarkdown(markdown: string) {
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current = { title: '设计说明', lines: [] as string[] };
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = /^#{1,4}\s+(.+)$/.exec(raw.trim());
    if (heading) {
      if (current.lines.some(Boolean)) sections.push(current);
      current = { title: heading[1] ?? '设计说明', lines: [] };
    } else if (raw.trim() && !/^\|?\s*[-:]+/.test(raw)) current.lines.push(raw.replace(/^[-*]\s+/, ''));
  }
  if (current.lines.some(Boolean)) sections.push(current);
  return sections.slice(0, 8);
}
function resolveTraceNode(type: string, id: string) {
  const specification = props.detail.specifications.find((item) => item.latestRevisionId === id || item.approvedRevisionId === id || item.id === id);
  if (specification) return `${specification.title} REV ${specification.latestRevisionNumber ?? '—'}`;
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
    const query = new URLSearchParams(window.location.search);
    const requestedAsset = assets.value.find((item) => item.kind === query.get('asset') || item.code === query.get('asset'));
    const requestedCapability = capabilities.value.find((item) => item.code === query.get('capability'));
    const querySelection = requestedAsset ? { type: 'asset' as const, id: requestedAsset.id }
      : requestedCapability ? { type: 'capability' as const, id: requestedCapability.id }
        : query.get('section') === 'plan' ? { type: 'plan' as const, id: 'plan' }
          : query.get('section') === 'verification' ? { type: 'verification' as const, id: 'verification' } : null;
    const next = preferred ?? (selectedId.value ? { type: selectedType.value, id: selectedId.value } : querySelection);
    if (next && (next.type !== 'asset' || assets.value.some((item) => item.id === next.id))) await selectItem(next.type, next.id);
    else if (capabilities.value[0]) await selectItem('capability', capabilities.value[0].id);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '工程蓝图加载失败'; }
  finally { loading.value = false; }
}
async function selectItem(type: typeof selectedType.value, id: string) {
  selectedType.value = type; selectedId.value = id; capabilityDetail.value = null;
  assetHistory.value = []; selectedRevisionId.value = ''; showAssetHistory.value = false;
  if (type === 'capability') {
    capabilityDetail.value = await getJson(`/api/projects/${props.project.id}/features/${props.feature.id}/capabilities/${id}`);
  } else if (type === 'asset') {
    assetHistory.value = await getJson(`/api/projects/${props.project.id}/engineering-assets/${id}/revisions`);
    showAssetHistory.value = new URLSearchParams(window.location.search).get('history') === '1';
  }
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
watch(() => props.feature.id, () => { selectedId.value = ''; void loadBlueprint(); });
</script>

<template>
  <section class="engineering-workbench">
    <header class="engineering-header">
      <div class="engineering-title">
        <button type="button" class="back-button" @click="emit('back')">← 功能清单</button>
        <div><span class="workbench-kicker">工程设计工作台 · {{ moduleName }}</span><h1>{{ feature.name }}</h1><p>{{ feature.summary }}</p></div>
      </div>
      <div class="engineering-summary">
        <div><span>能力项</span><strong>{{ capabilities.length }}</strong><small>{{ doneCapabilities }} 项完成</small></div>
        <div><span>工程设计</span><strong>{{ completeKinds }} / {{ requiredKinds }}</strong><small>按所需类型核验</small></div>
        <div><span>实施任务</span><strong>{{ tasks.length }}</strong><small>{{ tasks.filter(item => item.status === 'DONE').length }} 项完成</small></div>
        <div><span>AI执行</span><strong>{{ runs.length }}</strong><small>{{ runs.filter(item => item.verificationSummary?.status === 'PASS').length }} 次通过</small></div>
        <button type="button" class="plan-button" :disabled="planning" @click="planBlueprint">{{ planning ? '规划中…' : 'AI 规划工程蓝图' }}</button>
      </div>
    </header>

    <div v-if="error" class="workbench-error">{{ error }}</div>
    <div v-if="loading" class="workbench-loading">正在装载工程对象与追踪关系…</div>
    <div v-else class="engineering-columns">
      <aside class="design-navigation">
        <div class="navigation-intro"><strong>功能与工程设计</strong><button type="button" @click="showAllDesignTypes = !showAllDesignTypes">{{ showAllDesignTypes ? '隐藏空类型' : '显示全部设计类型' }}</button></div>
        <section class="nav-section">
          <h2><span>功能清单</span><small>{{ capabilities.length }}</small></h2>
          <button v-for="item in capabilities" :key="item.id" type="button" :class="['nav-entry capability-entry', { active: selectedType === 'capability' && selectedId === item.id }]" @click="selectItem('capability', item.id)">
            <code>{{ item.code }}</code><span><strong>{{ item.name }}</strong><small>{{ item.summary }}</small></span><i :data-status="item.status">{{ capabilityLabel(item.status) }}</i>
          </button>
        </section>
        <section v-for="group in visibleGroups()" :key="group.key" class="nav-section asset-group">
          <h2><span>{{ group.label }}</span><small>{{ assetsFor(group).length }}</small></h2>
          <div v-for="folder in visibleFolders(group)" :key="folder.kind" class="asset-folder">
            <button class="folder-row" type="button" @click="toggleAssetFolder(folder.kind)"><span>{{ collapsedAssetFolders.has(folder.kind) ? '▸' : '▾' }}</span><strong>{{ folder.label }}</strong><small>{{ assetsForFolder(folder).length }}</small></button>
            <div v-if="!collapsedAssetFolders.has(folder.kind)" class="folder-entries">
              <button v-for="asset in assetsForFolder(folder)" :key="asset.id" type="button" :class="['nav-entry asset-entry', { active: selectedType === 'asset' && selectedId === asset.id }]" @click="selectItem('asset', asset.id)">
                <span class="asset-dot"></span><span><strong>{{ asset.name }}</strong><small>{{ assetStatusLabel(asset.status) }} · REV {{ asset.currentRevisionNo }}</small></span>
              </button>
              <p v-if="!assetsForFolder(folder).length">暂无对象</p>
            </div>
          </div>
        </section>
        <section class="nav-section bottom-navigation">
          <button type="button" :class="['nav-entry simple-entry', { active: selectedType === 'plan' }]" @click="selectItem('plan', 'plan')"><span class="asset-mark">计</span><span><strong>开发计划</strong><small>能力项到实施任务</small></span></button>
          <button type="button" :class="['nav-entry simple-entry', { active: selectedType === 'verification' }]" @click="selectItem('verification', 'verification')"><span class="asset-mark">验</span><span><strong>验证</strong><small>设计、执行与结果</small></span></button>
        </section>
      </aside>

      <main class="engineering-detail">
        <template v-if="selectedAsset">
          <div class="detail-heading">
            <div><span class="detail-type">{{ assetKindLabel(selectedAsset.kind) }}</span><h2>{{ selectedAsset.name }}</h2><p>{{ selectedAsset.summary }}</p></div>
            <div class="asset-actions"><div class="detail-badges"><code v-if="selectedAsset.code">{{ selectedAsset.code }}</code><span>{{ assetStatusLabel(selectedAsset.status) }}</span><strong>REV {{ selectedHistoricalRevision?.revisionNo ?? selectedAsset.currentRevisionNo }}{{ selectedHistoricalRevision ? ' · 历史只读' : ' · 当前' }}</strong></div><div><button type="button" @click="showAssetHistory = !showAssetHistory">查看历史版本</button><button type="button" class="primary" @click="openRevisionDialog">创建新版本</button></div></div>
          </div>
          <section v-if="showAssetHistory" class="design-card revision-history-card">
            <header><h3>工程设计版本历史</h3><span>历史版本只读，内容永不覆盖</span></header>
            <div class="revision-history-list"><button v-for="revision in assetHistory" :key="revision.id" type="button" :class="{ active: selectedRevisionId === revision.id }" @click="selectedRevisionId = selectedRevisionId === revision.id ? '' : revision.id"><strong>REV {{ revision.revisionNo }}</strong><span>{{ revision.changeSummary }}</span><small>{{ revision.source }} · {{ new Date(revision.createdAt).toLocaleString('zh-CN') }}</small><b>{{ revision.id === selectedAsset.currentRevisionId ? '当前' : '只读' }}</b></button></div>
          </section>
          <section v-if="selectedAsset.canonicalStatus === 'CONFLICT'" class="canonical-warning"><strong>核心事实冲突</strong><span>{{ selectedAsset.canonicalConflicts.join('；') }}</span></section>
          <dl v-if="selectedFacts.length" class="fact-grid">
            <div v-for="([key, value]) in selectedFacts" :key="key"><dt>{{ keyLabel(key) }}</dt><dd>{{ valueText(value) }}</dd></div>
          </dl>
          <section v-for="table in selectedTables" :key="table.title" class="design-card table-card">
            <header><h3>{{ table.title }}</h3><span>{{ table.rows.length }} 项</span></header>
            <div class="table-scroll"><table><thead><tr><th v-for="column in table.columns" :key="column">{{ column }}</th></tr></thead><tbody><tr v-for="(row, rowIndex) in table.rows" :key="rowIndex"><td v-for="(cell, index) in row" :key="index">{{ cell }}</td></tr></tbody></table></div>
          </section>
          <section v-if="selectedMarkdown" class="design-card narrative-card"><header><h3>设计说明</h3><span>说明、原因与兼容性；结构化数据为核心事实</span></header><div class="narrative"><p v-for="(line, index) in parseMarkdown(selectedMarkdown).flatMap(item => [item.title, ...item.lines])" :key="index">{{ line }}</p></div></section>
          <section class="design-card trace-card"><header><h3>追踪关系</h3><span>正向与反向</span></header><div v-if="(blueprint?.traceLinks ?? []).filter(link => link.sourceId === selectedAsset?.id || link.targetId === selectedAsset?.id).length" class="trace-list"><div v-for="link in (blueprint?.traceLinks ?? []).filter(link => link.sourceId === selectedAsset?.id || link.targetId === selectedAsset?.id)" :key="link.id"><strong>{{ traceLeft(link) }}</strong><span>{{ relationLabel(link.relation) }}</span><strong>{{ traceRight(link) }}</strong></div></div><p v-else class="empty-copy">暂无显式追踪关系。</p></section>
        </template>

        <template v-else-if="selectedCapability">
          <div class="detail-heading capability-heading">
            <div><span class="detail-type">能力项设计</span><h2><code>{{ selectedCapability.code }}</code> {{ selectedCapability.name }}</h2><p>{{ selectedCapability.summary }}</p></div>
            <div class="capability-state" :data-status="selectedCapability.status"><span>当前状态</span><strong>{{ capabilityLabel(selectedCapability.status) }}</strong></div>
          </div>
          <section class="capability-overview-grid">
            <div><span>设计版本</span><strong>{{ capabilityDetail?.design?.latestRevision ? `REV ${capabilityDetail.design.latestRevision.revisionNo}` : '未形成' }}</strong></div>
            <div><span>关联工程设计</span><strong>{{ associatedAssets.length }} 项</strong></div>
            <div><span>实施任务</span><strong>{{ capabilityTasks.length }} 项</strong></div>
            <div><span>验证结果</span><strong>{{ capabilityRuns.some(item => item.verificationSummary?.status === 'PASS') ? '已通过' : '待验证' }}</strong></div>
          </section>
          <section v-if="designSections.length" class="design-card capability-design"><header><h3>基本设计</h3><span>输入、行为、边界与验证</span></header><div class="section-grid"><article v-for="section in designSections" :key="section.title"><h4>{{ section.title }}</h4><p v-for="(line, index) in section.lines.slice(0, 6)" :key="index">{{ line }}</p></article></div></section>
          <section class="design-card"><header><h3>关联工程设计</h3><span>点击查看完整对象</span></header><div v-if="associatedAssets.length" class="asset-link-grid"><button v-for="asset in associatedAssets" :key="asset.id" type="button" @click="selectItem('asset', asset.id)"><span>{{ assetKindLabel(asset.kind) }}</span><strong>{{ asset.name }}</strong><small>{{ asset.summary }}</small></button></div><p v-else class="empty-copy">尚未关联工程设计，可通过 AI 规划后补充。</p></section>
          <section class="design-card implementation-card"><header><h3>实现与验证</h3><span>从设计到代码证据</span></header><div v-if="capabilityTasks.length" class="implementation-list"><article v-for="task in capabilityTasks" :key="task.id"><div><code>{{ task.code }}</code><strong>{{ task.name }}</strong><span :data-task-status="task.status">{{ taskStatus(task) }}</span></div><p>{{ task.objective }}</p><div v-for="run in capabilityRuns.filter(item => item.taskId === task.id)" :key="run.id" class="run-evidence"><span>AI执行 · {{ run.actorName }}</span><strong>{{ verificationLabel(run) }}</strong><code>{{ run.resultCommit ?? '尚无提交' }}</code><small>{{ run.changedFiles.map(runFileLabel).join(' · ') || '尚无文件记录' }}</small><p>{{ run.verificationSummary?.summary ?? run.summary }}</p></div></article></div><p v-else class="empty-copy">尚未创建实施任务。</p></section>
          <section class="design-card trace-card"><header><h3>来源与追踪</h3><span>{{ traceLinks.length }} 条关系</span></header><div v-if="traceLinks.length" class="trace-list"><div v-for="link in traceLinks" :key="link.id"><strong>{{ traceLeft(link) }}</strong><span>{{ relationLabel(link.relation) }}</span><strong>{{ traceRight(link) }}</strong></div></div><p v-else class="empty-copy">尚无显式追踪关系。</p></section>
        </template>

        <template v-else-if="selectedType === 'plan'">
          <div class="detail-heading"><div><span class="detail-type">实施视图</span><h2>开发计划</h2><p>Task 只描述 AI 下一次具体实施什么，功能结构由能力项表达。</p></div></div>
          <section class="design-card"><header><h3>能力项实施计划</h3><span>{{ tasks.length }} 项任务</span></header><div class="plan-table"><div class="plan-row head"><span>能力项</span><span>实施任务</span><span>领域</span><span>状态</span><span>验证</span></div><div v-for="capability in capabilities" :key="capability.id" class="plan-row"><span><code>{{ capability.code }}</code> {{ capability.name }}</span><span>{{ tasks.find(item => item.capabilityId === capability.id)?.name ?? '待 AI 规划' }}</span><span>{{ tasks.find(item => item.capabilityId === capability.id)?.area || '—' }}</span><span>{{ capabilityLabel(capability.status) }}</span><span>{{ runs.some(run => tasks.some(task => task.id === run.taskId && task.capabilityId === capability.id) && run.verificationSummary?.status === 'PASS') ? 'PASS' : '—' }}</span></div></div></section>
        </template>

        <template v-else>
          <div class="detail-heading"><div><span class="detail-type">验证视图</span><h2>验证设计与真实结果</h2><p>把测试设计、AI执行与实际结果放在同一处核对。</p></div></div>
          <section v-for="asset in assets.filter(item => item.kind === 'TEST_DESIGN')" :key="asset.id" class="design-card table-card"><header><h3>{{ asset.name }}</h3><span>{{ assetStatusLabel(asset.status) }}</span></header><div class="table-scroll"><table v-for="table in buildTables(asset.structuredData ?? {})" :key="table.title"><thead><tr><th v-for="column in table.columns" :key="column">{{ column }}</th></tr></thead><tbody><tr v-for="(row, ri) in table.rows" :key="ri"><td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td></tr></tbody></table></div></section>
      <section class="design-card run-snapshot-card"><header><h3>AI执行、设计与源码快照</h3><span>{{ visibleRuns.length }} 次</span></header><div class="run-snapshot-list"><article v-for="(run, index) in visibleRuns" :key="run.id"><header><div><span>RUN-{{ String(visibleRuns.length - index).padStart(3, '0') }}</span><strong>{{ run.summary || '执行中' }}</strong></div><div><b :data-freshness="run.designSnapshotStatus">{{ run.designSnapshotStatus === 'STALE' ? '设计已变化 · 可能过期' : run.designSnapshotStatus === 'CURRENT' ? '当前设计' : '历史未冻结' }}</b><em>{{ verificationLabel(run) }}</em></div></header><div class="snapshot-grid"><section><h4>设计快照</h4><p v-for="spec in run.designSnapshot.specifications" :key="spec.revisionId"><span>设计资料</span><code>REV {{ spec.revisionNo }}</code><small>{{ spec.revisionId.slice(0, 8) }}</small></p><p v-for="asset in run.designSnapshot.engineeringAssets" :key="asset.revisionId"><span>{{ assets.find(item => item.id === asset.assetId)?.name ?? '工程设计' }}</span><code>REV {{ asset.revisionNo }}</code><small>{{ asset.revisionId.slice(0, 8) }}</small></p><i v-for="warning in run.designSnapshotWarnings" :key="warning">{{ warning }}</i></section><section><h4>多源码执行快照</h4><div v-for="execution in run.sourceExecutions" :key="execution.sourceId" class="source-snapshot"><strong>{{ sourceName(execution.sourceId) }}</strong><span>基线 {{ execution.baseline.commit ?? execution.baseline.manifestHash ?? execution.baseline.kind }}</span><span>结果 {{ execution.result.commit ?? execution.result.workingTreeSummary ?? '无提交' }}</span><small>{{ execution.read ? '已读取' : '未读取' }} · {{ execution.modified ? '已修改' : '未修改' }}</small><code v-for="file in execution.changedFiles" :key="runFileLabel(file)">{{ runFileLabel(file) }}</code><em v-for="verification in execution.verification" :key="`${verification.workdir}:${verification.command}`">{{ verification.reportedStatus }} · {{ verification.workdir }} · {{ verification.command }}</em></div><p v-if="!run.sourceExecutions.length" class="empty-copy">本次执行未关联 Source。</p></section></div></article></div></section>
        </template>
      </main>
    </div>
    <div v-if="showRevisionDialog" class="revision-dialog-backdrop" @click.self="showRevisionDialog = false"><form class="revision-dialog" @submit.prevent="createRevision"><header><div><span>创建不可变版本</span><h2>{{ selectedAsset?.name }} · REV {{ (selectedAsset?.currentRevisionNo ?? 0) + 1 }}</h2></div><button type="button" @click="showRevisionDialog = false">×</button></header><label>变更摘要<input v-model="revisionSummary" maxlength="500" required /></label><label>结构化核心事实<textarea v-model="revisionStructuredData" rows="12" spellcheck="false" required /></label><label>设计说明 Markdown<textarea v-model="revisionMarkdown" rows="8" spellcheck="false" /></label><footer><button type="button" @click="showRevisionDialog = false">取消</button><button type="submit" class="primary" :disabled="savingRevision">{{ savingRevision ? '保存中…' : '创建新版本' }}</button></footer></form></div>
  </section>
</template>

<style scoped>
.engineering-workbench { display:grid; grid-template-rows:auto minmax(0,1fr); width:100%; height:100%; min-height:0; overflow:hidden; background:#eef2f3; color:#172a33; }
.engineering-header { display:flex; min-height:118px; align-items:center; justify-content:space-between; gap:28px; padding:16px 24px 15px; border-bottom:1px solid #ccd7dc; background:#fff; }
.engineering-title { display:flex; align-items:flex-start; gap:16px; min-width:300px; }
.back-button { min-height:34px; padding:0 11px; border:1px solid #d4dde1; background:#f8fafb; color:#53666f; font-size:13px; white-space:nowrap; }
.workbench-kicker,.detail-type { color:#16715f; font-size:13px; font-weight:750; letter-spacing:.04em; }
.engineering-title h1 { margin:3px 0 2px; font-size:28px; line-height:1.15; letter-spacing:-.025em; }
.engineering-title p,.detail-heading p { margin:0; color:#61727a; font-size:14px; line-height:1.5; }
.engineering-summary { display:grid; grid-template-columns:repeat(4,minmax(92px,1fr)) auto; align-items:stretch; gap:0; min-width:650px; }
.engineering-summary>div { display:grid; align-content:center; gap:1px; min-height:70px; padding:7px 16px; border-left:1px solid #e1e7ea; }
.engineering-summary span { color:#72818a; font-size:13px; }.engineering-summary strong { font-size:19px; }.engineering-summary small { color:#839098; font-size:12px; }
.plan-button { align-self:center; min-height:42px; margin-left:15px; padding:0 15px; border:0; background:#153c3c; color:#fff; font-size:14px; font-weight:700; }
.workbench-error,.workbench-loading { padding:18px 24px; font-size:14px; }.workbench-error { background:#fff0f0; color:#a23843; }
.engineering-columns { display:grid; grid-template-columns:320px minmax(0,1fr); min-height:0; overflow:hidden; }
.design-navigation { min-height:0; overflow-y:auto; border-right:1px solid #ccd7dc; background:#f8fafb; }
.navigation-intro { display:flex; min-height:52px; align-items:center; justify-content:space-between; gap:10px; padding:0 16px; border-bottom:1px solid #dce4e7; }.navigation-intro strong { font-size:15px; }.navigation-intro button { padding:0; border:0; background:transparent; color:#526971; font-size:13px; cursor:pointer; }
.nav-section { padding:12px 10px 5px; border-bottom:1px solid #e1e7e9; }.nav-section h2 { display:flex; align-items:center; justify-content:space-between; margin:0 6px 8px; font-size:14px; }.nav-section h2 small { color:#849198; font:12px ui-monospace,monospace; }
.nav-entry { display:grid; grid-template-columns:42px minmax(0,1fr) auto; align-items:center; gap:8px; width:100%; min-height:56px; padding:7px 9px; border:0; border-radius:5px; background:transparent; color:#243841; text-align:left; }.nav-entry:hover { background:#edf3f3; }.nav-entry.active { background:#e4f0ed; box-shadow:inset 3px 0 #16715f; }
.nav-entry code { color:#5f7078; font:700 12px ui-monospace,monospace; }.nav-entry>span:nth-child(2) { display:grid; min-width:0; gap:3px; }.nav-entry strong { overflow:hidden; font-size:14px; text-overflow:ellipsis; white-space:nowrap; }.nav-entry small { overflow:hidden; color:#76858d; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }.nav-entry i { padding:3px 6px; background:#edf1f2; color:#5b6d75; font-size:11px; font-style:normal; }.nav-entry i[data-status="DONE"] { background:#dff1e9; color:#15644f; }.nav-entry i[data-status="IMPLEMENTING"],.nav-entry i[data-status="TESTING"] { background:#fff0d9; color:#8a5b10; }.nav-entry i[data-status="BLOCKED"] { background:#fae4e6; color:#a23b47; }
.asset-group { padding-inline:8px; }.asset-folder { margin:0 0 4px; }.folder-row { display:grid; grid-template-columns:18px minmax(0,1fr) auto; align-items:center; gap:6px; width:100%; min-height:34px; padding:0 8px; border:0; background:transparent; color:#50636c; text-align:left; cursor:pointer; }.folder-row:hover { background:#edf2f3; }.folder-row strong { font-size:13px; }.folder-row small { color:#89969c; font-size:12px; }.folder-entries { position:relative; padding-left:15px; }.folder-entries::before { position:absolute; top:0; bottom:5px; left:12px; width:1px; background:#d9e1e4; content:''; }.folder-entries>p { margin:4px 0 7px 24px; color:#96a1a6; font-size:13px; }.asset-entry,.simple-entry { grid-template-columns:24px minmax(0,1fr); }.asset-entry { min-height:43px; padding-block:4px; }.asset-dot { z-index:1; display:block!important; width:7px; height:7px; margin-left:6px; border:2px solid #f8fafb; border-radius:50%; background:#90a0a6; }.asset-entry.active .asset-dot { background:#16715f; }.asset-mark { display:grid!important; width:28px; height:28px; place-items:center; border-radius:5px; background:#e5ebed; color:#38505b; font-size:13px; font-weight:800; }.bottom-navigation { padding-bottom:18px; }
.engineering-detail { min-height:0; overflow-y:auto; padding:25px clamp(24px,3vw,48px) 70px; background:#fff; }
.detail-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:25px; max-width:1180px; margin:0 auto 20px; padding-bottom:18px; border-bottom:1px solid #dbe3e6; }.detail-heading h2 { margin:4px 0 6px; font-size:26px; line-height:1.2; }.detail-heading h2 code { color:#61727a; font-size:18px; }.detail-badges { display:flex; gap:8px; }.detail-badges span,.detail-badges code { padding:5px 9px; background:#eef3f4; color:#46606a; font-size:12px; }
.asset-actions { display:grid; justify-items:end; gap:10px; }.asset-actions>div:last-child { display:flex; gap:8px; }.asset-actions button { min-height:34px; padding:0 11px; border:1px solid #ccd8dc; background:#fff; color:#38515a; font-size:13px; }.asset-actions button.primary,.revision-dialog button.primary { border-color:#153c3c; background:#153c3c; color:#fff; }.detail-badges strong { padding:5px 9px; background:#e3f1ed; color:#17634f; font-size:12px; }
.revision-history-list { display:grid; }.revision-history-list button { display:grid; grid-template-columns:85px minmax(180px,1fr) 260px 55px; align-items:center; gap:14px; min-height:54px; padding:8px 17px; border:0; border-bottom:1px solid #e5eaec; background:#fff; color:#2b414a; text-align:left; }.revision-history-list button:last-child { border-bottom:0; }.revision-history-list button:hover,.revision-history-list button.active { background:#eef7f4; }.revision-history-list strong { font:750 13px ui-monospace,monospace; }.revision-history-list span { font-size:14px; }.revision-history-list small { color:#72818a; font-size:13px; }.revision-history-list b { color:#16715f; font-size:12px; text-align:right; }
.canonical-warning { display:flex; max-width:1180px; margin:0 auto 18px; padding:12px 16px; border:1px solid #e8c0c5; background:#fff2f3; color:#932f3b; font-size:14px; }.canonical-warning strong { margin-right:16px; }
.fact-grid,.capability-overview-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); max-width:1180px; margin:0 auto 18px; border:1px solid #dbe3e6; }.fact-grid>div,.capability-overview-grid>div { display:grid; align-content:center; gap:5px; min-height:72px; padding:12px 16px; border-right:1px solid #e2e8ea; }.fact-grid>div:last-child,.capability-overview-grid>div:last-child { border-right:0; }.fact-grid dt,.capability-overview-grid span { color:#75848c; font-size:13px; }.fact-grid dd { margin:0; font-size:15px; font-weight:650; overflow-wrap:anywhere; }.capability-overview-grid strong { font-size:17px; }
.capability-state { display:grid; gap:3px; min-width:110px; padding:10px 14px; border-left:3px solid #d89831; background:#fff7e9; }.capability-state span { color:#7a684d; font-size:12px; }.capability-state strong { font-size:15px; }
.design-card { max-width:1180px; margin:0 auto 18px; border:1px solid #d7e0e4; background:#fff; box-shadow:0 8px 24px rgba(24,49,59,.045); }.design-card>header { display:flex; min-height:48px; align-items:center; justify-content:space-between; padding:0 17px; border-bottom:1px solid #e0e7ea; background:#f8fafb; }.design-card>header h3 { margin:0; font-size:17px; }.design-card>header span { color:#72818a; font-size:13px; }
.table-scroll { overflow-x:auto; }table { width:100%; border-collapse:collapse; font-size:14px; }th,td { padding:11px 13px; border-bottom:1px solid #e5eaec; text-align:left; vertical-align:top; }th { background:#f4f7f8; color:#53656e; font-size:13px; white-space:nowrap; }td { color:#2c414a; line-height:1.5; }tbody tr:last-child td { border-bottom:0; }
.narrative { padding:16px 18px; }.narrative p { margin:0 0 8px; color:#455861; font-size:15px; line-height:1.65; }
.section-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0; }.section-grid article { min-height:130px; padding:16px 18px; border-right:1px solid #e3e8ea; border-bottom:1px solid #e3e8ea; }.section-grid article:nth-child(2n) { border-right:0; }.section-grid h4 { margin:0 0 9px; color:#18353c; font-size:16px; }.section-grid p { margin:0 0 6px; color:#4f626b; font-size:14px; line-height:1.6; }
.asset-link-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); padding:12px; gap:10px; }.asset-link-grid button { display:grid; gap:5px; min-height:105px; padding:13px; border:1px solid #dbe3e6; background:#fff; color:#253b44; text-align:left; }.asset-link-grid button:hover { border-color:#6ea696; background:#f5faf8; }.asset-link-grid span { color:#16715f; font-size:12px; font-weight:750; }.asset-link-grid strong { font-size:15px; }.asset-link-grid small { color:#6e7e86; font-size:13px; line-height:1.45; }
.implementation-list>article { padding:16px 18px; border-bottom:1px solid #e4e9eb; }.implementation-list>article:last-child { border-bottom:0; }.implementation-list>article>div:first-child { display:flex; align-items:center; gap:11px; }.implementation-list strong { font-size:15px; }.implementation-list>article>div:first-child span { margin-left:auto; padding:3px 7px; background:#edf2f3; font-size:12px; }.implementation-list>article>p { color:#61717a; font-size:14px; }.run-evidence { display:grid; grid-template-columns:auto auto auto minmax(0,1fr); gap:8px 14px; margin-top:10px; padding:12px; background:#f3f8f6; }.run-evidence span,.run-evidence strong,.run-evidence code { font-size:13px; }.run-evidence small { overflow:hidden; color:#52656e; font-size:13px; text-overflow:ellipsis; white-space:nowrap; }.run-evidence p { grid-column:1/-1; margin:0; color:#3e554f; font-size:14px; }
.trace-list { padding:6px 16px 14px; }.trace-list>div { display:grid; grid-template-columns:minmax(130px,1fr) 100px minmax(130px,1fr); align-items:center; gap:12px; min-height:44px; border-bottom:1px solid #edf0f1; }.trace-list>div:last-child { border-bottom:0; }.trace-list strong { font-size:14px; }.trace-list span { color:#6c7c84; font-size:13px; text-align:center; }.empty-copy { margin:0; padding:20px; color:#75848c; font-size:14px; }
.plan-table { overflow-x:auto; }.plan-row { display:grid; grid-template-columns:1.1fr 1.5fr .7fr .65fr .55fr; gap:12px; min-width:780px; padding:12px 16px; border-bottom:1px solid #e5eaec; font-size:14px; }.plan-row.head { background:#f4f7f8; color:#65767f; font-size:13px; font-weight:700; }.plan-row code { margin-right:7px; color:#60717a; }.verification-list article { display:grid; grid-template-columns:80px minmax(200px,1fr) 110px; gap:8px 14px; padding:13px 17px; border-bottom:1px solid #e4e9eb; }.verification-list small { grid-column:2/-1; color:#667780; font-size:13px; }
.run-snapshot-list>article { padding:16px 18px 20px; border-bottom:1px solid #dce4e7; }.run-snapshot-list>article:last-child { border-bottom:0; }.run-snapshot-list>article>header { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:13px; }.run-snapshot-list>article>header>div { display:flex; align-items:center; gap:10px; }.run-snapshot-list header span { color:#16715f; font:750 13px ui-monospace,monospace; }.run-snapshot-list header strong { font-size:15px; }.run-snapshot-list header b,.run-snapshot-list header em { padding:4px 8px; background:#e8f2ef; color:#17634f; font-size:12px; font-style:normal; }.run-snapshot-list header b[data-freshness="STALE"] { background:#fff0db; color:#965f0d; }.run-snapshot-list header b[data-freshness="UNKNOWN"] { background:#edf0f2; color:#64747c; }.snapshot-grid { display:grid; grid-template-columns:1fr 1.2fr; gap:14px; }.snapshot-grid>section { min-width:0; padding:13px 14px; border:1px solid #dce4e7; background:#fafcfc; }.snapshot-grid h4 { margin:0 0 9px; font-size:14px; }.snapshot-grid p { display:grid; grid-template-columns:minmax(120px,1fr) 70px 70px; margin:0; padding:7px 0; border-bottom:1px solid #e5eaec; font-size:13px; }.snapshot-grid i { display:block; margin-top:9px; color:#9a6110; font-size:13px; font-style:normal; }.source-snapshot { display:grid; grid-template-columns:1fr 1fr; gap:5px 12px; padding:8px 0; border-bottom:1px solid #e1e7e9; }.source-snapshot:last-child { border-bottom:0; }.source-snapshot strong,.source-snapshot small { grid-column:1/-1; font-size:13px; }.source-snapshot span,.source-snapshot code,.source-snapshot em { overflow-wrap:anywhere; font-size:12px; }.source-snapshot code,.source-snapshot em { grid-column:1/-1; }.source-snapshot em { color:#52666e; font-style:normal; }
.revision-dialog-backdrop { position:fixed; inset:0; z-index:50; display:grid; place-items:center; padding:24px; background:rgba(14,31,38,.48); }.revision-dialog { display:grid; gap:15px; width:min(840px,calc(100vw - 48px)); max-height:calc(100vh - 48px); overflow:auto; padding:22px; background:#fff; box-shadow:0 24px 70px rgba(9,28,36,.3); }.revision-dialog header,.revision-dialog footer { display:flex; align-items:center; justify-content:space-between; gap:15px; }.revision-dialog header span { color:#16715f; font-size:13px; font-weight:750; }.revision-dialog h2 { margin:3px 0 0; font-size:22px; }.revision-dialog header>button { border:0; background:transparent; color:#687981; font-size:25px; }.revision-dialog label { display:grid; gap:6px; color:#445962; font-size:14px; font-weight:650; }.revision-dialog input,.revision-dialog textarea { width:100%; box-sizing:border-box; padding:10px 11px; border:1px solid #cdd8dc; background:#fbfcfc; color:#1d343d; font:14px/1.5 ui-monospace,Consolas,monospace; }.revision-dialog footer { justify-content:flex-end; }.revision-dialog footer button { min-height:38px; padding:0 15px; border:1px solid #ccd8dc; background:#fff; color:#38515a; font-size:14px; }
@media(max-width:1499px){.engineering-header{padding-inline:18px}.engineering-summary{min-width:570px}.engineering-summary>div{padding-inline:11px}.engineering-columns{grid-template-columns:300px minmax(0,1fr)}.asset-link-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:1199px){.engineering-header{align-items:flex-start;flex-direction:column;gap:10px}.engineering-summary{width:100%;min-width:0}.engineering-workbench{grid-template-rows:auto minmax(0,1fr)}.engineering-columns{grid-template-columns:300px minmax(0,1fr)}.fact-grid,.capability-overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.section-grid{grid-template-columns:1fr}.section-grid article{border-right:0}.engineering-title h1{font-size:25px}}
</style>
