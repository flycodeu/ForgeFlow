<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Feature, ProjectDetail } from '@forgeflow/contracts';
import ProjectMapCard from './ProjectMapCard.vue';
import {
  orderProjectMapLayers,
  parseProjectMap,
  type ProjectMapEdge,
  type ProjectMapNode,
  type ProjectMapStatus,
} from './project-map';

const props = defineProps<{
  detail: ProjectDetail;
  architectureMarkdown?: string | null;
  architectureRevision?: string | null;
}>();

const emit = defineEmits<{ openFeature: [feature: Feature] }>();
const flowId = ref('');
const dialog = ref<HTMLDialogElement | null>(null);
const query = ref('');
const directoryOpen = ref(false);
watch(query, (value) => { directoryOpen.value = Boolean(value.trim()); });
function toggleDirectory(event: Event) { directoryOpen.value = (event.target as HTMLDetailsElement).open; }
const selectedNodeId = ref('');
const page = ref<HTMLElement | null>(null);
const diagram = ref<HTMLElement | null>(null);
const diagramSize = ref({ width: 0, height: 0 });
type DrawnEdge = { key: string; d: string; from: string; to: string; status: ProjectMapStatus | 'unknown' };
const drawnEdges = ref<DrawnEdge[]>([]);
let resizeObserver: ResizeObserver | null = null;
let pendingFrame = 0;

const parsedMap = computed(() => parseProjectMap(props.architectureMarkdown));
const map = computed(() => parsedMap.value.state === 'ready' ? parsedMap.value.map : null);
const nodesById = computed(() => new Map(map.value?.nodes.map((node) => [node.id, node]) ?? []));
const searchTerm = computed(() => query.value.trim().toLocaleLowerCase());
const matches = (value: string | undefined) => value?.toLocaleLowerCase().includes(searchTerm.value) ?? false;
const featuresForNode = (node: ProjectMapNode) => props.detail.features.filter((feature) => node.featureCodes?.includes(feature.code));
const nodeMatches = (node: ProjectMapNode) => !searchTerm.value || matches(node.layer) || matches(node.label)
  || matches(node.summary) || matches(node.source) || node.technology?.some(matches) || node.details?.some(matches) || node.featureCodes?.some(matches)
  || featuresForNode(node).some((feature) => matches(feature.name) || matches(feature.code));
const layers = computed(() => {
  if (!map.value) return [];
  return orderProjectMapLayers(map.value).map((name) => ({ name,
    nodes: map.value!.nodes.filter((node) => (!node.placement || node.placement === 'main') && node.layer === name && nodeMatches(node)),
  })).filter((layer) => layer.nodes.length > 0);
});
const crosscutNodes = computed(() => map.value?.nodes.filter((node) => node.placement === 'crosscut' && nodeMatches(node)) ?? []);
const environmentNodes = computed(() => map.value?.nodes.filter((node) => node.placement === 'environment' && nodeMatches(node)) ?? []);
const visibleNodes = computed(() => [...layers.value.flatMap((layer) => layer.nodes), ...crosscutNodes.value, ...environmentNodes.value]);
const visibleIds = computed(() => new Set(visibleNodes.value.map((node) => node.id)));
const currentFlow = computed(() => map.value?.flows?.find((flow) => flow.id === flowId.value) ?? map.value?.flows?.[0]);
const featureGroups = computed(() => props.detail.modules.map((module) => ({ ...module,
  features: props.detail.features.filter((feature) => feature.moduleId === module.id && (!searchTerm.value
    || matches(module.name) || matches(feature.name) || matches(feature.code) || matches(feature.summary))),
})).filter((module) => module.features.length));
const unboundFeatures = computed(() => props.detail.features.filter((feature) =>
  !map.value?.nodes.some((node) => node.featureCodes?.includes(feature.code))));
const unresolvedCodes = computed(() => [...new Set(map.value?.nodes.flatMap((node) => node.featureCodes ?? []) ?? [])]
  .filter((code) => !props.detail.features.some((feature) => feature.code === code)));
const featureStatuses: Record<string, string> = { DRAFT: '草稿', DESIGNING: '设计中', DESIGN_REVIEW: '设计评审', READY: '待实施', IMPLEMENTING: '实施中', VERIFYING: '待验证', ACCEPTANCE_PENDING: '待验收', ACCEPTED: '已验收', DELIVERED: '已交付' };
function openFeature(id: string) {
  const feature = props.detail.features.find((item) => item.id === id);
  if (feature) { dialog.value?.close(); emit('openFeature', feature); }
}
const visibleEdges = computed(() => map.value?.edges.filter((edge) =>
  visibleIds.value.has(edge.from) && visibleIds.value.has(edge.to)) ?? []);
const selectedNode = computed<ProjectMapNode | null>(() =>
  nodesById.value.get(selectedNodeId.value) ?? null);
const selectedIncoming = computed(() => map.value?.edges.filter((edge) => edge.to === selectedNode.value?.id) ?? []);
const selectedOutgoing = computed(() => map.value?.edges.filter((edge) => edge.from === selectedNode.value?.id) ?? []);
const nodeName = (id: string) => nodesById.value.get(id)?.label ?? id;
const cardStatusText: Record<ProjectMapStatus, string> = { implemented: '已有代码', planned: '规划中' };
const edgeStatusText = (edge: ProjectMapEdge) =>
  edge.status === 'implemented' ? '文档标注已连接' : edge.status === 'planned' ? '规划连线' : '未标注状态';
const palette = [
  { accent: '#5168cc', tint: '#f1f3ff', border: '#cfd6fa' },
  { accent: '#15846e', tint: '#eefaf5', border: '#bfe9d6' },
  { accent: '#3979b8', tint: '#eef6fd', border: '#c8e0f7' },
  { accent: '#ae6a28', tint: '#fff8ee', border: '#f2dac0' },
  { accent: '#765aab', tint: '#f6f2fc', border: '#ded0f4' },
  { accent: '#66798a', tint: '#f2f6f9', border: '#d7e1e8' },
];
const layerStyle = (index: number) => ({
  '--band-accent': palette[index % palette.length]!.accent,
  '--band-tint': palette[index % palette.length]!.tint,
  '--band-border': palette[index % palette.length]!.border,
});

async function selectNode(id: string) {
  selectedNodeId.value = id;
  await nextTick();
  if (selectedNode.value && dialog.value && !dialog.value.open) dialog.value.showModal();
}
function navigateToNode(id: string) { selectedNodeId.value = id; }
function closeDetails() { selectedNodeId.value = ''; }

function scheduleMeasure() {
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    measureEdges();
  });
}

function measureEdges() {
  const root = diagram.value;
  if (!root || !map.value) {
    drawnEdges.value = [];
    return;
  }
  const rootBounds = root.getBoundingClientRect();
  diagramSize.value = { width: rootBounds.width, height: rootBounds.height };
  const bounds = new Map<string, DOMRect>();
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-map-node]'))) {
    const id = element.dataset.mapNode;
    if (id) bounds.set(id, element.getBoundingClientRect());
  }
  drawnEdges.value = visibleEdges.value.flatMap((edge, index) => {
    const from = bounds.get(edge.from);
    const to = bounds.get(edge.to);
    if (!from || !to) return [];
    const fromCenterX = from.left + from.width / 2 - rootBounds.left;
    const toCenterX = to.left + to.width / 2 - rootBounds.left;
    const fromCenterY = from.top + from.height / 2 - rootBounds.top;
    const toCenterY = to.top + to.height / 2 - rootBounds.top;
    let x1: number, y1: number, x2: number, y2: number, d: string;
    if (Math.abs(toCenterY - fromCenterY) > Math.max(from.height, to.height) * .58) {
      const down = toCenterY > fromCenterY;
      x1 = fromCenterX;
      y1 = (down ? from.bottom : from.top) - rootBounds.top;
      x2 = toCenterX;
      y2 = (down ? to.top : to.bottom) - rootBounds.top;
      const bend = Math.max(25, Math.abs(y2 - y1) * .42) * (down ? 1 : -1);
      d = 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + bend) + ', ' + x2 + ' ' + (y2 - bend) + ', ' + x2 + ' ' + y2;
    } else {
      const right = toCenterX > fromCenterX;
      x1 = (right ? from.right : from.left) - rootBounds.left;
      y1 = fromCenterY;
      x2 = (right ? to.left : to.right) - rootBounds.left;
      y2 = toCenterY;
      const bend = Math.max(24, Math.abs(x2 - x1) * .46) * (right ? 1 : -1);
      d = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + bend) + ' ' + y1 + ', ' + (x2 - bend) + ' ' + y2 + ', ' + x2 + ' ' + y2;
    }
    return [{ key: edge.from + '-' + edge.to + '-' + index, d, from: edge.from, to: edge.to, status: edge.status ?? 'unknown' }];
  });
}

watch(() => props.detail.project.id, () => { query.value = ''; directoryOpen.value = false; flowId.value = ''; dialog.value?.close(); selectedNodeId.value = ''; });
watch(diagram, (current, previous) => { if (previous) resizeObserver?.unobserve(previous); if (current) resizeObserver?.observe(current); scheduleMeasure(); });
watch([layers, crosscutNodes, environmentNodes, visibleEdges], async () => { await nextTick(); scheduleMeasure(); }, { flush: 'post' });
onMounted(() => {
  resizeObserver = new ResizeObserver(scheduleMeasure);
  if (diagram.value) resizeObserver.observe(diagram.value);
  window.addEventListener('resize', scheduleMeasure);
  scheduleMeasure();
});
onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('resize', scheduleMeasure);
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
});
</script>

<template>
  <div ref="page" class="project-map-page">
    <header class="map-heading">
      <div><h1>项目模块图</h1><span class="map-revision">{{ architectureRevision }}</span></div>
      <label class="map-search"><span>搜索</span><input v-model="query" type="search" aria-label="搜索功能、模块或技术" placeholder="功能、模块或技术" /></label>
    </header>
    <section v-if="map?.flows?.length" class="flow-panel" aria-label="业务流程">
      <header class="flow-heading"><h2>业务流程</h2><div class="flow-tabs"><button v-for="flow in map.flows" :key="flow.id" type="button" :aria-pressed="currentFlow?.id === flow.id" @click="flowId = flow.id">{{ flow.label }}<small v-if="flow.status === 'planned'">规划</small></button></div></header>
      <ol v-if="currentFlow" class="flow-steps">
        <li v-for="(step, index) in currentFlow.steps" :key="index"><span class="step-number">{{ String(index + 1).padStart(2, '0') }}</span><div><button v-if="step.nodeId" type="button" @click="selectNode(step.nodeId)">{{ step.label }}</button><strong v-else>{{ step.label }}</strong><p v-if="step.description">{{ step.description }}</p></div></li>
      </ol>
    </section>
    <div v-if="parsedMap.state === 'missing'" class="map-empty"><strong>暂无模块图</strong><p>完善项目的架构设计后，可在这里查看模块与交互关系。</p></div>
    <div v-else-if="parsedMap.state === 'invalid'" class="map-empty invalid" role="alert"><strong>模块图暂不可展示</strong><p>{{ parsedMap.reason }}</p></div>
    <section v-else class="diagram-panel" aria-label="项目分层模块图">
      <header class="diagram-meta"><h2>功能与架构 <small>{{ map?.nodes.length }} 个模块 · {{ map?.edges.length }} 条交互</small></h2><div class="map-legend" aria-label="图例"><span><i></i>已有代码</span><span><i class="planned"></i>规划</span></div></header>
      <p v-if="!visibleNodes.length" class="map-empty">没有匹配的模块。</p>
      <div v-else ref="diagram" class="module-diagram">
        <svg v-if="drawnEdges.length" class="diagram-lines" :viewBox="'0 0 ' + diagramSize.width + ' ' + diagramSize.height" preserveAspectRatio="none" aria-hidden="true">
          <defs><marker v-for="state in ['implemented', 'planned', 'unknown']" :id="'map-arrow-' + state" :key="state" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" :stroke="state === 'planned' ? '#b88336' : '#6b8e9a'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></marker></defs>
          <path v-for="edge in drawnEdges" :key="edge.key" :d="edge.d" :data-status="edge.status" :marker-end="'url(#map-arrow-' + edge.status + ')'" />
        </svg>
        <div class="diagram-body" :class="{ 'with-crosscut': crosscutNodes.length }">
          <div class="main-layers">
            <section v-for="(layer, index) in layers" :key="layer.name" class="map-band" :style="layerStyle(index)">
              <header class="band-heading"><span>{{ String(index + 1).padStart(2, '0') }}</span><h3>{{ layer.name }}</h3></header>
              <div class="band-nodes"><ProjectMapCard v-for="node in layer.nodes" :key="node.id" :node="node" :features="featuresForNode(node)" :horizontal="layer.nodes.length === 1" @select="selectNode" @open-feature="openFeature" /></div>
            </section>
          </div>
          <aside v-if="crosscutNodes.length" class="map-band crosscut-band" aria-label="横切能力"><header class="band-heading"><h3>横切能力</h3></header><div class="crosscut-cards"><ProjectMapCard v-for="node in crosscutNodes" :key="node.id" :node="node" :features="featuresForNode(node)" @select="selectNode" @open-feature="openFeature" /></div></aside>
        </div>
        <section v-if="environmentNodes.length" class="map-band environment-band" :style="layerStyle(5)" aria-label="运行与开发环境"><header class="band-heading"><h3>运行与开发环境</h3></header><div class="band-nodes"><ProjectMapCard v-for="node in environmentNodes" :key="node.id" :node="node" :features="featuresForNode(node)" @select="selectNode" @open-feature="openFeature" /></div></section>
      </div>
      <details v-if="query && map?.edges.length" class="map-source-note"><summary>筛选后的交互</summary>仅显示两端都匹配的连线，清空搜索可查看完整图。</details>
    </section>
    <details class="feature-directory" :open="directoryOpen" @toggle="toggleDirectory">
      <summary><h2>登记功能 <small>{{ detail.features.length }}</small></h2><span>{{ unboundFeatures.length ? unboundFeatures.length + ' 项尚未关联架构' : '查看全部功能' }}</span></summary>
      <div class="directory-groups"><section v-for="group in featureGroups" :key="group.id"><h3>{{ group.name }}</h3><div class="directory-items"><button v-for="feature in group.features" :key="feature.id" type="button" @click="openFeature(feature.id)"><strong>{{ feature.name }}</strong><small>{{ featureStatuses[feature.status] || feature.status }}</small></button></div></section></div>
      <p v-if="!featureGroups.length" class="directory-empty">没有匹配的登记功能。</p>
    </details>
    <details v-if="map" class="map-source-note"><summary>资料来源</summary><p>架构设计 {{ architectureRevision }} · 功能清单 {{ detail.features.length }} 项。图中状态采用架构文档记录，功能状态采用登记记录。</p><p v-if="unresolvedCodes.length">未找到关联功能：{{ unresolvedCodes.join('、') }}</p></details>
    <dialog ref="dialog" class="module-inspector" aria-labelledby="module-details-title" @close="closeDetails" @click="($event.target === dialog) && dialog?.close()">
      <template v-if="selectedNode">
        <header class="inspector-head"><div><span>{{ selectedNode.layer }}</span><h2 id="module-details-title">{{ selectedNode.label }}</h2></div><button type="button" autofocus aria-label="关闭模块详情" @click="dialog?.close()">×</button></header>
        <small class="node-state">{{ cardStatusText[selectedNode.status] }}</small><p class="inspector-summary">{{ selectedNode.summary }}</p>
        <div v-if="selectedNode.details?.length" class="inspector-section"><h3>功能与职责</h3><ul class="detail-responsibilities"><li v-for="item in selectedNode.details" :key="item">{{ item }}</li></ul></div>
        <div v-if="featuresForNode(selectedNode).length" class="inspector-section"><h3>关联功能</h3><div class="detail-features"><button v-for="feature in featuresForNode(selectedNode)" :key="feature.id" type="button" @click="openFeature(feature.id)">{{ feature.name }} ↗</button></div></div>
        <div v-if="selectedNode.technology?.length" class="inspector-section"><h3>技术</h3><div class="technology-tags"><span v-for="item in selectedNode.technology" :key="item">{{ item }}</span></div></div>
        <div v-if="selectedIncoming.length || selectedOutgoing.length" class="inspector-section"><h3>交互关系</h3><div class="relation-list"><div v-for="(edge, index) in [...selectedIncoming, ...selectedOutgoing]" :key="index" class="relation-item"><div><button type="button" @click="navigateToNode(edge.from)">{{ nodeName(edge.from) }}</button><span>→</span><button type="button" @click="navigateToNode(edge.to)">{{ nodeName(edge.to) }}</button></div><p>{{ edge.label }}<small v-if="edge.status !== 'implemented'"> · {{ edgeStatusText(edge) }}</small></p></div></div></div>
        <div v-if="selectedNode.source" class="inspector-section"><h3>来源</h3><p class="source-path">{{ selectedNode.source }}</p></div>
      </template>
    </dialog>
  </div>
</template>

<style scoped>
.project-map-page { min-width: 0; color: var(--ink); container: project-map / inline-size; }
.map-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 0 0 18px; }
.map-heading > div { display: flex; align-items: baseline; gap: 10px; }
.map-heading h1 { margin: 0; font-size: 24px; letter-spacing: -.035em; }
.map-revision { color: var(--muted); font-family: var(--mono); font-size: 10px; }
.map-search { display: flex; align-items: center; gap: 9px; width: 265px; padding: 8px 11px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--muted); font-size: 11px; }
.map-search:focus-within { border-color: var(--primary); }
.map-search > span { flex: none; }
.map-search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; background: none; font-size: 12px; }
.flow-panel, .diagram-panel, .feature-directory { min-width: 0; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.flow-heading { display: flex; align-items: center; gap: 20px; padding: 12px 16px; border-bottom: 1px solid var(--line-subtle); }
h2 { margin: 0; font-size: 13px; }
.flow-heading h2 { flex: none; }
.flow-tabs { display: flex; flex-wrap: wrap; gap: 5px; }
.flow-tabs button { display: flex; gap: 6px; padding: 5px 8px; border-radius: 5px; color: var(--muted); font-size: 11px; }
.flow-tabs button[aria-pressed="true"] { color: var(--primary); background: var(--primary-subtle); }
.flow-tabs small { color: #a36520; font-size: 9px; }
.flow-steps { display: flex; gap: 23px; padding: 18px 16px; margin: 0; list-style: none; overflow-x: auto; }
.flow-steps li { position: relative; display: flex; flex: 1 0 125px; align-items: start; gap: 8px; min-width: 0; }
.flow-steps li + li::before { position: absolute; left: -18px; top: 2px; color: #96a3b3; content: '→'; }
.step-number { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--line); border-radius: 6px; color: var(--primary); font-family: var(--mono); font-size: 9px; }
.flow-steps button, .flow-steps strong { display: block; padding: 3px 0 0; color: var(--ink-secondary); font-size: 11px; font-weight: 600; text-align: left; }
.flow-steps button:hover { color: var(--primary); text-decoration: underline; }
.flow-steps p { margin: 5px 0 0; color: var(--muted); font-size: 10px; line-height: 1.6; }
.diagram-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line-subtle); }
.diagram-meta h2 small { margin-left: 10px; color: var(--muted); font-size: 10px; font-weight: 400; }
.map-legend { display: flex; gap: 12px; color: var(--muted); font-size: 10px; }
.map-legend > span { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.map-legend i { width: 16px; border-top: 2px solid #6b8e9a; }
.map-legend i.planned { border-color: #b88336; border-top-style: dashed; }
.module-diagram { position: relative; padding: 24px; background: #fbfcfe; border-radius: 0 0 10px 10px; }
.diagram-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
.diagram-body.with-crosscut { grid-template-columns: minmax(0, 1fr) 205px; }
.main-layers { display: flex; flex-direction: column; gap: 34px; min-width: 0; }
.map-band { position: relative; min-width: 0; padding: 12px; border: 1px solid var(--band-border); border-left: 3px solid var(--band-accent); border-radius: 7px; background: var(--band-tint); }
.band-heading { position: relative; z-index: 3; display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.band-heading > span { color: var(--band-accent); font-family: var(--mono); font-size: 9px; }
.band-heading h3 { margin: 0; color: var(--band-accent); font-size: 12px; }
.band-nodes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 205px), 1fr)); gap: 10px; }
.crosscut-band { --band-accent: #a4596c; --band-tint: #fff5f6; --band-border: #eed0d7; }
.crosscut-cards { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 12px; }
.environment-band { margin-top: 26px; }
.diagram-lines { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.diagram-lines > path { fill: none; stroke: #6b8e9a; stroke-width: 1.4; opacity: .45; vector-effect: non-scaling-stroke; }
.diagram-lines path[data-status="planned"] { stroke: #b88336; stroke-dasharray: 5 5; }
.diagram-lines path[data-status="unknown"] { stroke-dasharray: 2 5; }
.map-empty { padding: 28px; color: var(--muted); font-size: 12px; }
.map-empty strong { color: var(--ink); font-size: 14px; }
.map-empty p { margin-bottom: 0; }
.map-empty.invalid { background: var(--warning-bg); }
.feature-directory > summary { display: flex; align-items: center; gap: 10px; padding: 13px 16px; cursor: pointer; list-style: none; }
.feature-directory > summary::before { color: var(--muted); content: '▸'; }
.feature-directory[open] > summary::before { content: '▾'; }
.feature-directory summary h2 { flex: 1; }
.feature-directory summary small { margin-left: 6px; color: var(--muted); font-size: 10px; font-weight: 400; }
.feature-directory summary > span { color: var(--muted); font-size: 10px; }
.directory-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr)); gap: 18px; padding: 16px; border-top: 1px solid var(--line-subtle); }
.directory-groups h3 { margin: 0 0 8px; font-size: 11px; }
.directory-items { display: grid; gap: 5px; }
.directory-items button { display: flex; align-items: baseline; justify-content: space-between; gap: 7px; padding: 7px 8px; border: 1px solid var(--line-subtle); border-radius: 5px; text-align: left; }
.directory-items button:hover { border-color: var(--primary-border); background: var(--primary-subtle); }
.directory-items strong { color: var(--ink-secondary); font-size: 11px; font-weight: 500; }
.directory-items small { flex: none; color: var(--muted); font-size: 9px; }
.directory-empty { padding: 12px 16px; color: var(--muted); font-size: 11px; }
.map-source-note { padding: 8px 0; color: var(--muted); font-size: 10px; line-height: 1.7; }
.map-source-note summary { cursor: pointer; width: fit-content; }
.map-source-note p { margin: 6px 0; }
.diagram-panel > .map-source-note { padding: 8px 16px; }
.module-inspector { width: min(580px, calc(100vw - 32px)); max-height: 80vh; padding: 24px; overflow-y: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); box-shadow: 0 20px 80px #15223833; }
.module-inspector::backdrop { background: #16233755; }
.inspector-head { display: flex; justify-content: space-between; gap: 14px; }
.inspector-head span { color: var(--muted); font-size: 11px; }
.inspector-head h2 { margin: 5px 0 8px; font-size: 21px; }
.inspector-head > button { align-self: start; width: 30px; height: 30px; border-radius: 6px; background: var(--surface-subtle); font-size: 21px; }
.node-state { color: var(--primary); font-size: 10px; }
.inspector-summary { color: var(--ink-secondary); font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.inspector-section { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line-subtle); }
.inspector-section h3 { margin: 0 0 9px; font-size: 11px; }
.detail-responsibilities { margin: 0; padding-left: 18px; color: var(--ink-secondary); font-size: 12px; line-height: 1.8; }
.technology-tags, .detail-features { display: flex; flex-wrap: wrap; gap: 6px; }
.technology-tags span, .detail-features button { padding: 4px 7px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink-secondary); font-size: 11px; }
.detail-features button { color: var(--primary); }
.relation-list { display: grid; gap: 8px; }
.relation-item { padding: 9px 10px; border-left: 2px solid #6b8e9a; background: var(--surface-subtle); }
.relation-item > div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px; }
.relation-item button { padding: 0; color: var(--primary); font-size: 11px; text-align: left; }
.relation-item p { margin: 5px 0 0; color: var(--muted); font-size: 10px; }
.source-path { margin: 0; color: var(--muted); font-family: var(--mono); font-size: 10px; overflow-wrap: anywhere; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
@container project-map (max-width: 780px) {
  .diagram-body.with-crosscut { grid-template-columns: minmax(0, 1fr); }
  .crosscut-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 205px), 1fr)); }
  .flow-heading { align-items: start; flex-direction: column; gap: 8px; }
}
@container project-map (max-width: 520px) {
  .map-heading { align-items: start; flex-direction: column; }
  .map-search { width: 100%; }
  .module-diagram { padding: 14px 10px; }
  .diagram-meta { align-items: start; flex-direction: column; gap: 7px; padding: 12px; }
  .diagram-meta h2 small { display: block; margin: 5px 0 0; }
  .feature-directory > summary { flex-wrap: wrap; }
  .feature-directory summary > span { width: 100%; padding-left: 17px; }
}
</style>
