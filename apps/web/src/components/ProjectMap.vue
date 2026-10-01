<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ProjectDetail } from '@forgeflow/contracts';
import {
  orderProjectMapLayers,
  parseProjectMap,
  type ProjectMapEdge,
  type ProjectMapNode,
  type ProjectMapStatus,
} from './project-map';

/** The map is declared in the current architecture revision; registered features are not inferred as nodes. */
const props = defineProps<{
  detail: ProjectDetail;
  architectureMarkdown?: string | null;
  architectureRevision?: string | null;
}>();

const query = ref('');
const selectedNodeId = ref('');
const page = ref<HTMLElement | null>(null);
const diagram = ref<HTMLElement | null>(null);
const inspector = ref<HTMLElement | null>(null);
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
const layers = computed(() => {
  if (!map.value) return [];
  return orderProjectMapLayers(map.value).map((name) => ({
    name,
    nodes: map.value!.nodes.filter((node) => node.layer === name && (
      !searchTerm.value || matches(name) || matches(node.label) || matches(node.summary)
      || matches(node.source) || node.technology?.some(matches)
    )),
  })).filter((layer) => layer.nodes.length > 0);
});
const visibleIds = computed(() => new Set(layers.value.flatMap((layer) => layer.nodes.map((node) => node.id))));
const visibleEdges = computed(() => map.value?.edges.filter((edge) =>
  visibleIds.value.has(edge.from) && visibleIds.value.has(edge.to)) ?? []);
const selectedNode = computed<ProjectMapNode | null>(() =>
  visibleIds.value.has(selectedNodeId.value) ? nodesById.value.get(selectedNodeId.value) ?? null : null);
const selectedIncoming = computed(() => map.value?.edges.filter((edge) => edge.to === selectedNode.value?.id) ?? []);
const selectedOutgoing = computed(() => map.value?.edges.filter((edge) => edge.from === selectedNode.value?.id) ?? []);
const relatedIds = computed(() => new Set([
  ...selectedIncoming.value.map((edge) => edge.from),
  ...selectedOutgoing.value.map((edge) => edge.to),
]));
const nodeName = (id: string) => nodesById.value.get(id)?.label ?? id;
const statusText: Record<ProjectMapStatus, string> = { implemented: '文档标注已有代码', planned: '文档标注规划中' };
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

function selectNode(id: string) {
  selectedNodeId.value = selectedNodeId.value === id ? '' : id;
  if (selectedNodeId.value && (page.value?.getBoundingClientRect().width ?? 9999) <= 870) {
    nextTick(() => inspector.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

function navigateToNode(id: string) {
  if (!visibleIds.value.has(id)) query.value = '';
  selectedNodeId.value = id;
}

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

watch(() => props.detail.project.id, () => { query.value = ''; selectedNodeId.value = ''; });
watch([layers, visibleEdges], async () => { await nextTick(); scheduleMeasure(); }, { flush: 'post' });
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
      <div class="heading-copy">
        <span class="map-eyebrow">ARCHITECTURE / MODULES</span>
        <h1>项目模块图</h1>
        <p>按架构修订中的模块和真实声明的交互方向排列。</p>
      </div>
      <label class="map-search">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.7" stroke="currentColor" stroke-width="1.5"/><path d="m13.3 13.3 4.3 4.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span class="sr-only">搜索模块、职责或技术</span>
        <input v-model="query" type="search" placeholder="搜索模块、职责或技术" />
      </label>
    </header>

    <div v-if="parsedMap.state === 'missing'" class="map-empty">
      <strong>架构修订中还没有模块图</strong>
      <p>在架构设计正文加入一个 <code>forgeflow-map</code> JSON 代码块，明确层级、模块和连线后，这里才会绘制关系。</p>
    </div>
    <div v-else-if="parsedMap.state === 'invalid'" class="map-empty invalid" role="alert">
      <strong>模块图暂不可展示</strong><p>{{ parsedMap.reason }}</p>
    </div>
    <template v-else>
      <div class="map-context">
        <p>依据：最新架构修订{{ architectureRevision ? ' ' + architectureRevision : '' }}。节点和连线的“已有代码”仅是文档标注，不能代替运行验证。</p>
        <div class="map-legend" aria-label="模块图图例">
          <span><i class="legend-line" aria-hidden="true"></i>文档标注已连接</span>
          <span><i class="legend-line planned" aria-hidden="true"></i>规划连线</span>
          <span><i class="legend-line unknown" aria-hidden="true"></i>未标注状态</span>
        </div>
      </div>
      <div v-if="!layers.length" class="map-empty">没有匹配的模块。</div>
      <div v-else class="diagram-layout">
        <section class="diagram-panel" aria-label="项目分层模块图">
          <div class="diagram-meta">
            <span>{{ map?.nodes.length }} 个模块 <span aria-hidden="true">·</span> {{ map?.edges.length }} 条明确关系</span>
            <button v-if="selectedNode" type="button" @click="selectedNodeId = ''">取消聚焦</button>
          </div>
          <div ref="diagram" class="module-diagram">
            <svg v-if="drawnEdges.length" class="diagram-lines" :viewBox="'0 0 ' + diagramSize.width + ' ' + diagramSize.height" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="map-arrow-implemented" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#3d8291" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>
                <marker id="map-arrow-planned" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#b88336" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>
                <marker id="map-arrow-unknown" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L7 4 L1 7" fill="none" stroke="#8b9aad" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>
              </defs>
              <path v-for="edge in drawnEdges" :key="edge.key" :d="edge.d" :data-status="edge.status"
                :class="{ focused: selectedNode && (selectedNode.id === edge.from || selectedNode.id === edge.to), muted: selectedNode && selectedNode.id !== edge.from && selectedNode.id !== edge.to }"
                :marker-end="'url(#map-arrow-' + edge.status + ')'" />
            </svg>
            <section v-for="(layer, index) in layers" :key="layer.name" class="map-band" :style="layerStyle(index)" :aria-label="layer.name + '层'">
              <header class="band-heading"><span>{{ String(index + 1).padStart(2, '0') }}</span><h2>{{ layer.name }}</h2><small>{{ layer.nodes.length }} 个模块</small></header>
              <div class="band-nodes">
                <button v-for="node in layer.nodes" :key="node.id" type="button" class="module-card"
                  :data-map-node="node.id" :data-status="node.status" :aria-pressed="selectedNode?.id === node.id"
                  :class="{ selected: selectedNode?.id === node.id, related: selectedNode && relatedIds.has(node.id), subdued: selectedNode && selectedNode.id !== node.id && !relatedIds.has(node.id) }"
                  @click="selectNode(node.id)">
                  <span class="card-top"><i aria-hidden="true"></i><small>{{ cardStatusText[node.status] }}</small></span>
                  <strong>{{ node.label }}</strong>
                  <span v-if="node.technology?.length" class="card-technology">{{ node.technology.slice(0, 2).join(' · ') }}</span>
                </button>
              </div>
            </section>
          </div>
          <p v-if="query" class="diagram-filter-note">搜索时仅绘制两端都在结果中的关系。清空搜索可查看完整图。</p>
        </section>

        <aside ref="inspector" class="module-inspector" aria-label="模块详情">
          <template v-if="selectedNode">
            <button class="back-to-diagram" type="button" @click="diagram?.scrollIntoView({ behavior: 'smooth', block: 'start' })">↑ 返回模块图</button>
            <div class="inspector-head"><span>MODULE / {{ selectedNode.layer }}</span><h2>{{ selectedNode.label }}</h2><small :data-status="selectedNode.status">{{ statusText[selectedNode.status] }}</small></div>
            <p class="inspector-summary">{{ selectedNode.summary }}</p>
            <div class="inspector-section"><h3>技术线索</h3>
              <div v-if="selectedNode.technology?.length" class="technology-tags"><span v-for="item in selectedNode.technology" :key="item">{{ item }}</span></div>
              <p v-else>架构修订未标注。</p>
            </div>
            <div class="inspector-section"><h3>来源位置</h3><p class="source-path">{{ selectedNode.source || '架构修订未标注。' }}</p></div>
            <div class="inspector-section"><h3>明确关系 <small>{{ selectedIncoming.length + selectedOutgoing.length }}</small></h3>
              <div v-if="selectedIncoming.length || selectedOutgoing.length" class="relation-list">
                <div v-for="(edge, index) in selectedIncoming" :key="'in-' + index" class="relation-item" :data-status="edge.status ?? 'unknown'">
                  <span class="relation-direction">流入</span><button type="button" @click="navigateToNode(edge.from)">{{ nodeName(edge.from) }}</button>
                  <span class="relation-arrow" aria-hidden="true">→</span><strong>{{ selectedNode.label }}</strong>
                  <small>{{ edge.label }} · {{ edgeStatusText(edge) }}</small>
                </div>
                <div v-for="(edge, index) in selectedOutgoing" :key="'out-' + index" class="relation-item" :data-status="edge.status ?? 'unknown'">
                  <span class="relation-direction">流出</span><strong>{{ selectedNode.label }}</strong>
                  <span class="relation-arrow" aria-hidden="true">→</span><button type="button" @click="navigateToNode(edge.to)">{{ nodeName(edge.to) }}</button>
                  <small>{{ edge.label }} · {{ edgeStatusText(edge) }}</small>
                </div>
              </div>
              <p v-else>架构修订未声明该模块的连线。</p>
            </div>
          </template>
          <template v-else>
            <span class="inspector-placeholder-mark" aria-hidden="true">↗</span>
            <h2>选择一个模块</h2>
            <p>点击图中的模块，查看它的职责、技术线索、来源位置和明确声明的输入输出关系。</p>
            <div class="inspector-boundary"><strong>图谱边界</strong><span>登记的功能项不会自动变成架构模块；未声明的交互也不会画成连线。</span></div>
          </template>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.project-map-page { min-width: 0; color: var(--ink); container: project-map / inline-size; }
.map-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding: 3px 0 18px; }
.heading-copy { min-width: 0; }
.map-eyebrow, .inspector-head > span { color: var(--primary); font-family: var(--mono); font-size: 10px; font-weight: 700; letter-spacing: .12em; }
.map-heading h1 { margin: 4px 0 5px; font-size: 26px; line-height: 1.18; letter-spacing: -.045em; }
.map-heading p { margin: 0; color: var(--muted); font-size: 12px; }
.map-search { display: flex; align-items: center; gap: 8px; width: min(280px, 100%); flex: none; padding: 8px 11px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--muted); }
.map-search:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-subtle); }
.map-search svg { width: 17px; height: 17px; flex: none; }
.map-search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; background: none; font-size: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.map-context { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 11px; }
.map-context p { max-width: 630px; margin: 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
.map-legend { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px 14px; flex: none; color: var(--muted); font-size: 10px; }
.map-legend > span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.legend-line { display: inline-block; width: 18px; border-top: 2px solid #3d8291; }
.legend-line.planned { border-color: #b88336; border-top-style: dashed; }
.legend-line.unknown { border-color: #8b9aad; border-top-style: dotted; }
.map-empty { padding: 38px; border: 1px dashed var(--line-strong); border-radius: 11px; background: var(--surface); color: var(--muted); font-size: 13px; }
.map-empty strong { display: block; color: var(--ink); font-size: 15px; }
.map-empty p { margin: 7px 0 0; }
.map-empty.invalid { border-color: var(--warning-border); background: var(--warning-bg); }
.diagram-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(235px, 280px); align-items: start; gap: 14px; min-width: 0; }
.diagram-panel { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); box-shadow: var(--shadow-xs); }
.diagram-meta { display: flex; align-items: center; justify-content: space-between; min-height: 36px; padding: 7px 17px; border-bottom: 1px solid var(--line-subtle); color: var(--muted); font-family: var(--mono); font-size: 10px; }
.diagram-meta button { padding: 2px 4px; color: var(--primary); font-family: inherit; font-size: 10px; font-weight: 600; }
.diagram-meta button:hover { text-decoration: underline; }
.module-diagram { position: relative; display: flex; flex-direction: column; gap: 28px; min-width: 0; padding: 22px 22px 26px; background-color: #fbfcfe; background-image: radial-gradient(#e6ebf2 0.7px, transparent 0.7px); background-size: 18px 18px; }
.diagram-lines { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.diagram-lines > path { fill: none; stroke: #3d8291; stroke-width: 1.75; opacity: .52; vector-effect: non-scaling-stroke; transition: opacity .2s ease, stroke-width .2s ease; }
.diagram-lines path[data-status="planned"] { stroke: #b88336; stroke-dasharray: 5 5; opacity: .62; }
.diagram-lines path[data-status="unknown"] { stroke: #8b9aad; stroke-dasharray: 2 5; }
.diagram-lines path.focused { opacity: 1; stroke-width: 2.5; }
.diagram-lines path.muted { opacity: .13; }
.map-band { position: relative; min-width: 0; padding: 12px 13px 13px; border: 1px solid var(--band-border); border-left: 4px solid var(--band-accent); border-radius: 8px; background: var(--band-tint); }
.band-heading { position: relative; z-index: 3; display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.band-heading > span { color: var(--band-accent); font-family: var(--mono); font-size: 10px; font-weight: 700; }
.band-heading h2 { margin: 0; color: var(--ink-secondary); font-size: 12px; font-weight: 700; }
.band-heading small { margin-left: auto; color: var(--muted); font-size: 10px; white-space: nowrap; }
.band-nodes { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.module-card { position: relative; z-index: 3; display: flex; flex: 0 1 238px; flex-direction: column; align-items: start; gap: 6px; width: min(100%, 238px); min-width: 0; min-height: 82px; padding: 10px 11px; border: 1px solid var(--band-accent); border-radius: 7px; background: var(--surface); box-shadow: 0 1px 2px rgba(15, 23, 42, .04); text-align: left; transition: transform .15s ease, opacity .15s ease, box-shadow .15s ease; }
.module-card:hover, .module-card:focus-visible { transform: translateY(-2px); box-shadow: var(--shadow-sm); outline: 0; }
.module-card:focus-visible { box-shadow: 0 0 0 3px var(--primary-border); }
.module-card.selected { box-shadow: 0 0 0 3px var(--band-border), var(--shadow-sm); }
.module-card.subdued { opacity: .52; }
.module-card.related { box-shadow: 0 0 0 2px var(--band-border); }
.card-top { display: flex; align-items: center; gap: 5px; color: var(--muted); }
.card-top i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #3d8291; }
.module-card[data-status="planned"] .card-top i { background: #b88336; }
.card-top small { font-size: 10px; }
.module-card strong { max-width: 100%; color: var(--ink); font-size: 12px; line-height: 1.3; overflow-wrap: anywhere; }
.card-technology { max-width: 100%; color: var(--muted); font-size: 10px; line-height: 1.35; overflow-wrap: anywhere; }
.diagram-filter-note { margin: 0; padding: 8px 17px; border-top: 1px solid var(--line-subtle); color: var(--muted); font-size: 10px; }
.module-inspector { position: sticky; top: 10px; min-width: 0; padding: 18px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); box-shadow: var(--shadow-xs); }
.back-to-diagram { display: none; padding: 0 0 10px; color: var(--primary); font-size: 11px; font-weight: 600; }
.inspector-head h2 { margin: 6px 0 9px; font-size: 18px; line-height: 1.28; overflow-wrap: anywhere; }
.inspector-head > small { display: inline-block; padding: 2px 6px; border: 1px solid var(--success-border); border-radius: 4px; background: var(--success-bg); color: var(--success-ink); font-size: 10px; }
.inspector-head > small[data-status="planned"] { border-color: var(--warning-border); background: var(--warning-bg); color: var(--warning-ink); }
.inspector-summary { margin: 14px 0 0; color: var(--ink-secondary); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.inspector-section { margin-top: 16px; padding-top: 13px; border-top: 1px solid var(--line-subtle); }
.inspector-section h3 { display: flex; justify-content: space-between; gap: 8px; margin: 0 0 8px; font-size: 11px; }
.inspector-section h3 small { color: var(--muted); font-family: var(--mono); font-weight: 400; }
.inspector-section p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.55; overflow-wrap: anywhere; }
.source-path { font-family: var(--mono); }
.technology-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.technology-tags span { padding: 3px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--surface-subtle); color: var(--ink-secondary); font-size: 10px; overflow-wrap: anywhere; }
.relation-list { display: flex; flex-direction: column; gap: 7px; }
.relation-item { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 4px; padding: 8px 9px; border-left: 2px solid #3d8291; border-radius: 0 5px 5px 0; background: var(--surface-subtle); color: var(--ink-secondary); font-size: 10px; line-height: 1.45; }
.relation-item[data-status="planned"] { border-left-color: #b88336; }
.relation-item[data-status="unknown"] { border-left-color: var(--line-strong); }
.relation-direction { width: 100%; color: var(--muted); font-size: 9px; }
.relation-item button { padding: 0; color: var(--primary); font-size: inherit; font-weight: 600; text-align: left; text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
.relation-item strong { font-size: inherit; font-weight: 650; overflow-wrap: anywhere; }
.relation-arrow { color: var(--muted); }
.relation-item small { width: 100%; color: var(--muted); font-size: 9px; overflow-wrap: anywhere; }
.inspector-placeholder-mark { display: grid; place-items: center; width: 35px; height: 35px; border: 1px solid var(--primary-border); border-radius: 8px; background: var(--primary-subtle); color: var(--primary); font-size: 20px; }
.module-inspector > h2 { margin: 14px 0 6px; font-size: 16px; }
.module-inspector > p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.65; }
.inspector-boundary { display: flex; flex-direction: column; gap: 5px; margin-top: 22px; padding-top: 13px; border-top: 1px solid var(--line-subtle); color: var(--muted); font-size: 10px; line-height: 1.55; }
.inspector-boundary strong { color: var(--ink-secondary); font-size: 11px; }
@container project-map (max-width: 870px) {
  .diagram-layout { grid-template-columns: minmax(0, 1fr); }
  .module-inspector { position: static; scroll-margin-top: 12px; }
  .back-to-diagram { display: inline-block; }
}
@container project-map (max-width: 600px) {
  .map-heading { align-items: start; flex-direction: column; gap: 13px; }
  .map-search { width: 100%; }
  .map-context { flex-direction: column; gap: 8px; }
  .map-legend { justify-content: flex-start; }
  .module-diagram { gap: 24px; padding: 15px 11px 19px; }
  .module-card { flex: 1 1 100%; width: 100%; }
}
</style>
