<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Capability, Feature, ProjectDetail } from '@forgeflow/contracts';
import { parseProjectMap, type ProjectMapNode, type ProjectMapStatus } from './project-map';

/** Pass the current architecture SpecificationRevision.content, not rendered HTML. */
const props = defineProps<{
  detail: ProjectDetail;
  architectureMarkdown?: string | null;
  architectureRevision?: string | null;
}>();
const emit = defineEmits<{ openFeature: [feature: Feature, capabilityId?: string] }>();

const view = ref<'structure' | 'architecture'>('architecture');
const query = ref('');
const selectedModuleId = ref('');
const selectedFeatureId = ref('');
const selectedNodeId = ref('');

const featureStatus: Record<Feature['status'], string> = {
  DRAFT: '草稿', DESIGNING: '设计中', READY: '待实施', IMPLEMENTING: '实施中',
  VERIFYING: '验证中', ACCEPTANCE_PENDING: '待验收', ACCEPTED: '已标记验收', DELIVERED: '交付标记（待核对）',
};
const capabilityStatus: Record<Capability['status'], string> = {
  DRAFT: '草稿', DESIGNED: '已设计', IMPLEMENTING: '实现中',
  TESTING: '验证中', DONE: '标记完成', BLOCKED: '受阻',
};
const mapStatus: Record<ProjectMapStatus, string> = {
  implemented: '已实现 · 文档标注', planned: '规划中 · 文档标注',
};
const matches = (text: string) => text.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase());
const sortedModules = computed(() => [...props.detail.modules].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN')));
const featuresOf = (moduleId: string) => props.detail.features
  .filter((feature) => feature.moduleId === moduleId)
  .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));
const capabilitiesOf = (featureId: string) => props.detail.capabilities
  .filter((capability) => capability.featureId === featureId)
  .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));
const matchingModules = computed(() => sortedModules.value.filter((module) =>
  !query.value.trim() || matches(module.code) || matches(module.name) || matches(module.description)
    || featuresOf(module.id).some((feature) => matches(feature.code) || matches(feature.name) || matches(feature.summary)
      || capabilitiesOf(feature.id).some((capability) => matches(capability.code) || matches(capability.name) || matches(capability.summary))),
));
const selectedModule = computed(() => matchingModules.value.find((module) => module.id === selectedModuleId.value) ?? matchingModules.value[0] ?? null);
const matchingFeatures = computed(() => selectedModule.value ? featuresOf(selectedModule.value.id).filter((feature) =>
  !query.value.trim() || matches(selectedModule.value!.name) || matches(feature.code) || matches(feature.name) || matches(feature.summary)
    || capabilitiesOf(feature.id).some((capability) => matches(capability.code) || matches(capability.name) || matches(capability.summary)),
) : []);
const selectedFeature = computed(() => matchingFeatures.value.find((feature) => feature.id === selectedFeatureId.value) ?? matchingFeatures.value[0] ?? null);
const matchingCapabilities = computed(() => selectedFeature.value ? capabilitiesOf(selectedFeature.value.id).filter((capability) =>
  !query.value.trim() || matches(selectedModule.value?.name ?? '') || matches(selectedFeature.value!.name)
    || matches(capability.code) || matches(capability.name) || matches(capability.summary),
) : []);

const parsedMap = computed(() => parseProjectMap(props.architectureMarkdown));
const map = computed(() => parsedMap.value.state === 'ready' ? parsedMap.value.map : null);
const layers = computed(() => [...new Set(map.value?.nodes.map((node) => node.layer) ?? [])].map((name) => ({
  name, nodes: map.value?.nodes.filter((node) => node.layer === name).filter((node) =>
    !query.value.trim() || matches(node.label) || matches(node.summary) || matches(node.layer)
      || node.technology?.some(matches) || matches(node.source ?? ''),
  ) ?? [],
})).filter((layer) => layer.nodes.length));
const nodesById = computed(() => new Map(map.value?.nodes.map((node) => [node.id, node]) ?? []));
const selectedNode = computed<ProjectMapNode | null>(() =>
  layers.value.flatMap((layer) => layer.nodes).find((node) => node.id === selectedNodeId.value)
    ?? layers.value[0]?.nodes[0] ?? null);
const outgoing = (id: string) => map.value?.edges.filter((edge) => edge.from === id) ?? [];
const incoming = computed(() => map.value?.edges.filter((edge) => edge.to === selectedNode.value?.id) ?? []);
const nodeName = (id: string) => nodesById.value.get(id)?.label ?? id;

function selectNode(id: string) {
  query.value = '';
  selectedNodeId.value = id;
}
function changeView(next: 'structure' | 'architecture') {
  view.value = next;
  query.value = '';
}
watch(() => props.detail.project.id, () => {
  query.value = '';
  selectedModuleId.value = '';
  selectedFeatureId.value = '';
  selectedNodeId.value = '';
});
</script>

<template>
  <div class="project-map-page">
    <header class="map-heading">
      <div>
        <span class="map-eyebrow">PROJECT ATLAS</span>
        <h1>项目全景图</h1>
        <p>先看最新架构修订中的模块交互，再对照项目的功能登记树。</p>
      </div>
      <div class="map-counts" aria-label="项目结构数量">
        <span><strong>{{ detail.modules.length }}</strong> 登记模块</span>
        <span><strong>{{ detail.features.length }}</strong> 登记功能</span>
        <span><strong>{{ detail.capabilities.length }}</strong> 登记操作</span>
      </div>
    </header>

    <div class="map-toolbar">
      <div class="map-tabs" role="group" aria-label="全景图视图">
        <button type="button" :aria-pressed="view === 'structure'" @click="changeView('structure')">登记功能树</button>
        <button type="button" :aria-pressed="view === 'architecture'" @click="changeView('architecture')">交互与拓扑</button>
      </div>
      <label class="map-search">
        <span class="sr-only">搜索{{ view === 'structure' ? '模块、功能或操作' : '架构节点或技术' }}</span>
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.8" cy="8.8" r="5.7" stroke="currentColor" stroke-width="1.5"/><path d="m13.3 13.3 4.3 4.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <input v-model="query" type="search" :placeholder="view === 'structure' ? '查找模块、功能或操作' : '查找节点、技术或来源'" />
      </label>
    </div>

    <template v-if="view === 'structure'">
      <p class="map-note">这棵树保留项目的功能登记，可能包含早期或尚未迁移的规划项。现行方案请对照最新架构和项目资料；登记状态不等同于代码验证或负责人验收。</p>
      <div v-if="!detail.modules.length" class="map-empty">尚未记录模块。创建模块和功能后，这里会显示项目结构。</div>
      <div v-else-if="!matchingModules.length" class="map-empty">没有匹配的模块、功能或操作。</div>
      <div v-else class="structure-grid">
        <section class="structure-column" aria-label="模块">
          <header><span class="column-index">01</span><h2>模块</h2><small>{{ matchingModules.length }}</small></header>
          <div class="column-list">
            <button v-for="module in matchingModules" :key="module.id" type="button" class="structure-item"
              :class="{ selected: selectedModule?.id === module.id }" :aria-pressed="selectedModule?.id === module.id"
              @click="selectedModuleId = module.id; selectedFeatureId = ''">
              <span class="item-code">{{ module.code }}</span><strong>{{ module.name }}</strong>
              <small>{{ featuresOf(module.id).length }} 项功能</small>
            </button>
          </div>
        </section>
        <section class="structure-column" aria-label="功能">
          <header><span class="column-index">02</span><h2>功能</h2><small>{{ matchingFeatures.length }}</small></header>
          <div v-if="matchingFeatures.length" class="column-list">
            <button v-for="feature in matchingFeatures" :key="feature.id" type="button" class="structure-item"
              :class="{ selected: selectedFeature?.id === feature.id }" :aria-pressed="selectedFeature?.id === feature.id"
              @click="selectedFeatureId = feature.id">
              <span class="item-code">{{ feature.code }}</span><strong>{{ feature.name }}</strong>
              <span class="item-foot"><small>{{ capabilitiesOf(feature.id).length }} 项操作</small><em>{{ featureStatus[feature.status] }}</em></span>
            </button>
          </div>
          <p v-else class="column-empty">该模块尚未记录功能。</p>
        </section>
        <section class="structure-column" aria-label="操作">
          <header><span class="column-index">03</span><h2>操作</h2><small>{{ matchingCapabilities.length }}</small></header>
          <div v-if="matchingCapabilities.length" class="column-list">
            <button v-for="capability in matchingCapabilities" :key="capability.id" type="button" class="structure-item capability-item"
              @click="selectedFeature && emit('openFeature', selectedFeature, capability.id)">
              <span class="item-code">{{ capability.code }}</span><strong>{{ capability.name }}</strong>
              <span class="item-foot"><small>{{ capability.summary || '暂无说明' }}</small><em>{{ capabilityStatus[capability.status] }}</em></span>
            </button>
          </div>
          <p v-else class="column-empty">{{ selectedFeature ? '该功能尚未记录操作。' : '选择功能后查看操作。' }}</p>
        </section>
      </div>
      <section v-if="selectedFeature" class="selected-feature surface" aria-label="当前功能说明">
        <div><span class="item-code">{{ selectedModule?.name }} / {{ selectedFeature.code }}</span><h2>{{ selectedFeature.name }}</h2><p>{{ selectedFeature.summary || '尚未填写功能说明。' }}</p></div>
        <button type="button" @click="emit('openFeature', selectedFeature)">查看功能详情 <span aria-hidden="true">↗</span></button>
      </section>
    </template>

    <template v-else>
      <p class="map-note">图中节点与有方向的连线仅来自架构文档{{ architectureRevision ? ` ${architectureRevision}` : '' }}；“已实现”是文档标注，不代表独立验证。层级按 JSON 中节点首次出现的顺序排列。</p>
      <div class="map-legend" aria-label="交互关系图例">
        <span data-status="implemented"><i aria-hidden="true"></i>已实现 · 文档标注</span>
        <span data-status="planned"><i aria-hidden="true"></i>规划中 · 文档标注</span>
        <span data-status="unknown"><i aria-hidden="true"></i>关系状态未标注</span>
      </div>
      <div v-if="parsedMap.state === 'missing'" class="map-empty">
        <strong>尚未记录交互拓扑</strong>
        <p>请在架构设计正文中添加一个 <code>forgeflow-map</code> JSON 代码块，明确节点、层级和连线。此处不会凭功能名称推断技术关系。</p>
      </div>
      <div v-else-if="parsedMap.state === 'invalid'" class="map-empty invalid" role="alert">
        <strong>架构图暂不可展示</strong><p>{{ parsedMap.reason }}</p>
      </div>
      <div v-else-if="!layers.length" class="map-empty">没有匹配的架构节点。</div>
      <div v-else class="architecture-layout">
        <div class="layer-stack" aria-label="架构分层">
          <section v-for="(layer, index) in layers" :key="layer.name" class="map-layer" :aria-label="`${layer.name}层`">
            <header class="layer-heading"><span>{{ String(index + 1).padStart(2, '0') }}</span><h2>{{ layer.name }}</h2><small>{{ layer.nodes.length }} 个节点</small></header>
            <div class="layer-nodes">
              <article v-for="node in layer.nodes" :key="node.id" class="map-node" :class="{ active: selectedNode?.id === node.id }">
                <button class="node-select" type="button" :aria-pressed="selectedNode?.id === node.id" @click="selectedNodeId = node.id">
                  <span class="node-top"><small>{{ node.id }}</small><em :data-status="node.status">{{ mapStatus[node.status] }}</em></span>
                  <strong>{{ node.label }}</strong><span class="node-summary">{{ node.summary }}</span>
                </button>
                <div v-if="outgoing(node.id).length" class="node-edges" :aria-label="`${node.label}的对外连接`">
                  <button v-for="(edge, edgeIndex) in outgoing(node.id)" :key="`${edge.to}-${edgeIndex}`" type="button"
                    :data-status="edge.status ?? 'unknown'" @click="selectNode(edge.to)">
                    <span aria-hidden="true">→</span><span><b>{{ edge.label }}</b> · {{ nodeName(edge.to) }}</span>
                    <em>{{ edge.status ? mapStatus[edge.status] : '关系状态未标注' }}</em>
                  </button>
                </div>
              </article>
            </div>
          </section>
        </div>
        <aside v-if="selectedNode" class="node-detail surface" aria-label="节点详情">
          <span class="detail-kicker">SELECTED NODE / {{ selectedNode.layer }}</span>
          <h2>{{ selectedNode.label }}</h2><p>{{ selectedNode.summary }}</p>
          <span class="detail-status" :data-status="selectedNode.status">{{ mapStatus[selectedNode.status] }}</span>
          <div class="detail-section"><h3>技术与学习线索</h3>
            <div v-if="selectedNode.technology?.length" class="technology-tags"><span v-for="item in selectedNode.technology" :key="item">{{ item }}</span></div>
            <p v-else>文档未标注具体技术。</p>
          </div>
          <div class="detail-section"><h3>来源</h3><p>{{ selectedNode.source || '文档未标注来源。' }}</p></div>
          <div class="detail-section"><h3>交互方向</h3>
            <ul v-if="incoming.length || outgoing(selectedNode.id).length" class="relation-list">
              <li v-for="(edge, index) in incoming" :key="`in-${index}`"><button type="button" @click="selectNode(edge.from)">{{ nodeName(edge.from) }}</button><span>→ {{ edge.label }} →</span><strong>{{ selectedNode.label }}</strong><small>{{ edge.status ? mapStatus[edge.status] : '关系状态未标注' }}</small></li>
              <li v-for="(edge, index) in outgoing(selectedNode.id)" :key="`out-${index}`"><strong>{{ selectedNode.label }}</strong><span>→ {{ edge.label }} →</span><button type="button" @click="selectNode(edge.to)">{{ nodeName(edge.to) }}</button><small>{{ edge.status ? mapStatus[edge.status] : '关系状态未标注' }}</small></li>
            </ul>
            <p v-else>文档未记录该节点的连线。</p>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.project-map-page { min-width: 0; color: var(--ink); container: project-map / inline-size; }
.map-heading { display: flex; align-items: end; justify-content: space-between; gap: 24px; padding: 6px 0 22px; }
.map-eyebrow, .detail-kicker { color: var(--primary); font-family: var(--mono); font-size: 11px; font-weight: 700; letter-spacing: .12em; }
.map-heading h1 { margin: 4px 0 3px; font-size: 25px; line-height: 1.2; letter-spacing: -.04em; }
.map-heading p { margin: 0; color: var(--muted); font-size: 13px; }
.map-counts { display: flex; gap: 18px; flex-shrink: 0; color: var(--muted); font-size: 12px; white-space: nowrap; }
.map-counts span { display: flex; align-items: baseline; gap: 5px; }
.map-counts strong { color: var(--ink); font-family: var(--mono); font-size: 18px; font-weight: 650; }
.map-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 12px; }
.map-tabs { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-subtle); }
.map-tabs button { padding: 6px 13px; border-radius: 6px; color: var(--muted); font-size: 12px; font-weight: 600; white-space: nowrap; }
.map-tabs button[aria-pressed="true"] { background: var(--surface); color: var(--primary); box-shadow: var(--shadow-xs); }
.map-search { display: flex; align-items: center; gap: 7px; width: min(300px, 100%); min-width: 0; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--muted); }
.map-search:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-subtle); }
.map-search svg { width: 17px; height: 17px; flex: none; }
.map-search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; background: none; font-size: 12px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.map-note { margin: 0 0 16px; color: var(--muted); font-size: 11.5px; line-height: 1.6; }
.map-legend { display: flex; flex-wrap: wrap; gap: 7px 17px; margin: -5px 0 15px; color: var(--muted); font-size: 10.5px; }
.map-legend span { display: inline-flex; align-items: center; gap: 6px; }
.map-legend i { display: inline-block; width: 18px; border-top: 2px solid var(--success); }
.map-legend [data-status="planned"] i { border-color: var(--warning); border-top-style: dashed; }
.map-legend [data-status="unknown"] i { border-color: var(--line-strong); border-top-style: dotted; }
.map-empty { padding: 34px; border: 1px dashed var(--line-strong); border-radius: 10px; background: var(--surface); color: var(--muted); font-size: 13px; }
.map-empty strong { display: block; color: var(--ink); font-size: 15px; }
.map-empty p { margin: 7px 0 0; }
.map-empty.invalid { border-color: var(--warning-border); background: var(--warning-bg); }
.structure-grid { display: grid; grid-template-columns: minmax(0,.75fr) minmax(0,1.05fr) minmax(0,1.2fr); gap: 12px; min-width: 0; }
.structure-column { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); box-shadow: var(--shadow-xs); }
.structure-column > header { display: flex; align-items: center; gap: 8px; padding: 13px 15px; border-bottom: 1px solid var(--line); background: var(--surface-subtle); }
.column-index { color: var(--primary); font-family: var(--mono); font-size: 11px; font-weight: 700; }
.structure-column h2 { margin: 0; font-size: 13px; }
.structure-column header small { margin-left: auto; color: var(--muted); font-family: var(--mono); }
.column-list { display: flex; flex-direction: column; gap: 5px; max-height: 55vh; overflow-y: auto; padding: 7px; }
.structure-item { display: flex; flex-direction: column; align-items: start; gap: 4px; width: 100%; min-width: 0; padding: 10px 11px; border: 1px solid transparent; border-radius: 7px; text-align: left; }
.structure-item:hover, .structure-item:focus-visible { background: var(--surface-hover); border-color: var(--line); }
.structure-item.selected { background: var(--primary-subtle); border-color: var(--primary-border); }
.item-code { color: var(--primary); font-family: var(--mono); font-size: 10.5px; font-weight: 700; letter-spacing: .02em; overflow-wrap: anywhere; }
.structure-item strong { max-width: 100%; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
.structure-item small, .item-foot small { color: var(--muted); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.item-foot { display: flex; align-items: start; justify-content: space-between; gap: 8px; width: 100%; min-width: 0; }
.item-foot em { flex: none; color: var(--muted); font-size: 10.5px; font-style: normal; white-space: nowrap; }
.capability-item { border-bottom: 1px solid var(--line-subtle); }
.column-empty { margin: 0; padding: 18px; color: var(--muted); font-size: 12px; }
.selected-feature { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 12px; padding: 18px 20px; border: 1px solid var(--line); border-radius: 10px; }
.selected-feature h2 { margin: 3px 0; font-size: 16px; }
.selected-feature p { margin: 0; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.selected-feature button { flex: none; padding: 8px 11px; border: 1px solid var(--line); border-radius: 7px; color: var(--primary); font-size: 12px; font-weight: 600; }
.selected-feature button:hover { background: var(--primary-subtle); }
.architecture-layout { display: grid; grid-template-columns: minmax(0,1.65fr) minmax(260px,.85fr); align-items: start; gap: 15px; min-width: 0; }
.layer-stack { display: flex; flex-direction: column; gap: 13px; min-width: 0; }
.map-layer { min-width: 0; padding: 15px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.layer-heading { display: flex; align-items: baseline; gap: 9px; margin-bottom: 13px; }
.layer-heading > span { color: var(--primary); font-family: var(--mono); font-size: 11px; font-weight: 700; }
.layer-heading h2 { margin: 0; font-size: 14px; overflow-wrap: anywhere; }
.layer-heading small { margin-left: auto; color: var(--muted); font-size: 11px; white-space: nowrap; }
.layer-nodes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 10px; }
.map-node { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
.map-node.active { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-subtle); }
.node-select { display: flex; flex-direction: column; align-items: start; gap: 6px; width: 100%; min-width: 0; padding: 12px; text-align: left; }
.node-select:hover { background: var(--surface-hover); }
.node-top { display: flex; justify-content: space-between; align-items: start; gap: 7px; width: 100%; }
.node-top small { color: var(--primary); font-family: var(--mono); font-size: 10px; overflow-wrap: anywhere; }
.node-top em, .detail-status { padding: 2px 6px; border: 1px solid var(--line); border-radius: 4px; color: var(--muted); font-size: 10px; font-style: normal; white-space: nowrap; }
.node-top em[data-status="implemented"], .detail-status[data-status="implemented"] { border-color: var(--success-border); background: var(--success-bg); color: var(--success-ink); }
.node-top em[data-status="planned"], .detail-status[data-status="planned"] { border-color: var(--warning-border); background: var(--warning-bg); color: var(--warning-ink); }
.node-select strong { font-size: 13px; overflow-wrap: anywhere; }
.node-summary { color: var(--muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.node-edges { display: flex; flex-direction: column; gap: 3px; padding: 7px 10px 9px; border-top: 1px solid var(--line-subtle); }
.node-edges button { display: grid; grid-template-columns: 12px minmax(0,1fr); gap: 1px 6px; width: 100%; padding: 4px 4px 4px 7px; border-left: 2px solid var(--success); text-align: left; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.node-edges button[data-status="planned"] { border-color: var(--warning); border-left-style: dashed; }
.node-edges button[data-status="unknown"] { border-color: var(--line-strong); border-left-style: dotted; }
.node-edges button:hover { color: var(--primary); }
.node-edges button > span:first-child { color: var(--primary); font-weight: 700; }
.node-edges b { color: var(--ink-secondary); font-weight: 600; }
.node-edges em { grid-column: 2; color: var(--muted-light); font-size: 10px; font-style: normal; }
.node-detail { position: sticky; top: 12px; min-width: 0; padding: 20px; border: 1px solid var(--line); border-radius: 10px; }
.node-detail h2 { margin: 6px 0; font-size: 20px; overflow-wrap: anywhere; }
.node-detail > p, .detail-section > p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.detail-status { display: inline-block; margin-top: 12px; }
.detail-section { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line-subtle); }
.detail-section h3 { margin: 0 0 9px; color: var(--ink-secondary); font-size: 12px; }
.technology-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.technology-tags span { padding: 3px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface-subtle); color: var(--ink-secondary); font-size: 11px; overflow-wrap: anywhere; }
.relation-list { display: flex; flex-direction: column; gap: 9px; margin: 0; padding: 0; list-style: none; }
.relation-list li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.relation-list button { padding: 0; color: var(--primary); text-align: left; text-decoration: underline; text-underline-offset: 2px; }
.relation-list strong { color: var(--ink-secondary); }
.relation-list small { flex-basis: 100%; color: var(--muted-light); font-size: 10px; }
@container project-map (max-width: 850px) {
  .architecture-layout { grid-template-columns: minmax(0,1fr); }
  .node-detail { position: static; }
}
@container project-map (max-width: 710px) {
  .structure-grid { grid-template-columns: minmax(0,1fr); }
  .column-list { max-height: 220px; }
  .map-heading { align-items: start; flex-direction: column; gap: 12px; }
  .map-toolbar { align-items: stretch; flex-direction: column; }
  .map-search { width: 100%; }
  .selected-feature { align-items: start; flex-direction: column; }
}
@container project-map (max-width: 410px) {
  .map-counts { width: 100%; justify-content: space-between; }
  .map-tabs { width: 100%; }
  .map-tabs button { flex: 1; padding-inline: 5px; }
}
</style>
