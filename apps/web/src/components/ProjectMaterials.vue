<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ArchiveDocument, Capability, Feature, SpecificationSummary } from '@forgeflow/contracts';
import { api } from '../api-client';

const props = defineProps<{ projectId: string; specifications: SpecificationSummary[]; features: Feature[]; capabilities: Capability[] }>();
const emit = defineEmits<{
  openSpecification: [specification: SpecificationSummary]; openDocument: [documentId: string];
  openCapability: [feature: Feature, capabilityId: string];
}>();

const standardKinds = [
  { kind: 'background', label: '项目背景' },
  { kind: 'research', label: '调研与分析' },
  { kind: 'requirements', label: '需求分析' },
  { kind: 'architecture', label: '架构设计' },
  { kind: 'technology', label: '技术选型' },
];
const documents = ref<ArchiveDocument[]>([]);
const search = ref('');
const loading = ref(false);
const error = ref('');
let requestId = 0;

const projectSpecifications = computed(() => props.specifications.filter((item) => !item.featureId && !item.capabilityId));
const query = computed(() => search.value.trim().toLocaleLowerCase());
const matches = (value: string) => value.toLocaleLowerCase().includes(query.value);
const standard = computed(() => standardKinds.flatMap(({ kind, label }) =>
  projectSpecifications.value.filter((item) => item.kind === kind && (matches(item.title) || matches(label))).map((item) => ({ item, label })),
));
const custom = computed(() => projectSpecifications.value
  .filter((item) => !standardKinds.some(({ kind }) => kind === item.kind) && (matches(item.title) || matches(item.kind)))
  .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')));
const matchingDocuments = computed(() => documents.value.filter((item) => matches(item.title) || matches(item.sourcePath ?? '')));
const featureById = computed(() => new Map(props.features.map((item) => [item.id, item])));
const matchingCapabilities = computed(() => props.capabilities.filter((item) => {
  const feature = featureById.value.get(item.featureId);
  return matches(item.code) || matches(item.name) || matches(feature?.name ?? '');
}).sort((a, b) => a.code.localeCompare(b.code, 'zh-CN')));

async function load() {
  const current = ++requestId;
  loading.value = true;
  error.value = '';
  try {
    const result = await api<ArchiveDocument[]>(`/api/projects/${encodeURIComponent(props.projectId)}/archive/documents`);
    if (current === requestId) documents.value = result;
  } catch (cause) {
    if (current === requestId) {
      documents.value = [];
      error.value = cause instanceof Error ? cause.message : '档案文档读取失败';
    }
  } finally { if (current === requestId) loading.value = false; }
}
watch(() => props.projectId, () => { documents.value = []; void load(); }, { immediate: true });
</script>

<template>
  <section class="materials-index">
    <header class="materials-heading">
      <h1>资料总览</h1>
      <input v-model="search" type="search" aria-label="查找项目资料" placeholder="查找标题、类别或来源路径" />
    </header>
    <div v-if="error" class="materials-error" role="alert">{{ error }} <button type="button" @click="load">重试</button></div>
    <div class="materials-count">{{ projectSpecifications.length }} 份项目资料 · {{ props.capabilities.length }} 项功能操作 · {{ documents.length }} 份档案文档</div>

    <section class="materials-section">
      <header><h2>项目设计资料</h2><span>{{ standard.length }}</span></header>
      <div v-if="standard.length" class="materials-list">
        <button v-for="entry in standard" :key="entry.item.id" type="button" @click="emit('openSpecification', entry.item)">
          <span class="material-kind">{{ entry.label }}</span><strong>{{ entry.item.title }}</strong>
          <small>{{ entry.item.latestRevisionNumber ? `REV ${entry.item.latestRevisionNumber}` : '暂无正文' }}</small><span class="material-arrow">→</span>
        </button>
      </div>
      <p v-else class="materials-empty">{{ query ? '没有匹配的项目设计资料' : '暂无项目设计资料' }}</p>
    </section>

    <section class="materials-section">
      <header><h2>功能操作设计</h2><span>{{ matchingCapabilities.length }}</span></header>
      <div v-if="matchingCapabilities.length" class="materials-list">
        <button v-for="item in matchingCapabilities" :key="item.id" type="button"
          @click="featureById.get(item.featureId) && emit('openCapability', featureById.get(item.featureId)!, item.id)">
          <span class="material-kind">{{ item.code }}</span><strong>{{ item.name }}</strong>
          <small>{{ featureById.get(item.featureId)?.name ?? '未分组功能' }}</small><span class="material-arrow">→</span>
        </button>
      </div>
      <p v-else class="materials-empty">{{ query ? '没有匹配的功能操作' : '暂无功能操作设计' }}</p>
    </section>

    <section class="materials-section">
      <header><h2>其他项目级资料</h2><span>{{ custom.length }}</span></header>
      <div v-if="custom.length" class="materials-list">
        <button v-for="item in custom" :key="item.id" type="button" @click="emit('openSpecification', item)">
          <span class="material-kind" :title="item.kind">{{ item.kind }}</span><strong>{{ item.title }}</strong>
          <small>{{ item.latestRevisionNumber ? `REV ${item.latestRevisionNumber}` : '暂无正文' }}</small><span class="material-arrow">→</span>
        </button>
      </div>
      <p v-else class="materials-empty">{{ query ? '没有匹配的其他资料' : '暂无其他项目级资料' }}</p>
    </section>

    <section class="materials-section">
      <header><h2>档案文档</h2><span>{{ matchingDocuments.length }}</span></header>
      <div v-if="matchingDocuments.length" class="materials-list">
        <button v-for="item in matchingDocuments" :key="item.id" type="button" @click="emit('openDocument', item.id)">
          <span class="material-kind">档案</span><strong>{{ item.title }}</strong>
          <small :title="item.sourcePath ?? undefined">{{ item.sourcePath || '本地文档' }}</small><span class="material-arrow">→</span>
        </button>
      </div>
      <p v-else class="materials-empty">{{ loading ? '正在读取档案文档…' : query ? '没有匹配的档案文档' : '暂无档案文档' }}</p>
    </section>
  </section>
</template>

<style scoped>
.materials-index { padding: 24px; min-width: 0; color: var(--ink); }
.materials-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
.materials-heading h1 { margin: 0; font-size: 22px; }
.materials-heading input { width: min(360px, 100%); min-height: 36px; padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 5px; background: var(--surface); color: var(--ink); font-size: 13px; }
.materials-count { color: var(--muted); font-size: 12px; margin-bottom: 20px; }
.materials-error { margin-bottom: 14px; color: #b91c1c; font-size: 13px; }
.materials-error button { border: 0; background: none; color: var(--primary); cursor: pointer; }
.materials-section { border-top: 1px solid var(--line); margin-bottom: 20px; }
.materials-section > header { display: flex; align-items: center; gap: 8px; min-height: 44px; }
.materials-section h2 { margin: 0; font-size: 15px; }
.materials-section > header span { color: var(--muted); font-size: 12px; }
.materials-list { border: 1px solid var(--line); border-radius: 5px; overflow: hidden; background: var(--surface); }
.materials-list button { display: grid; grid-template-columns: minmax(100px, 145px) minmax(0, 1fr) minmax(70px, 180px) 18px; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 8px 14px; border: 0; border-bottom: 1px solid var(--line); background: none; text-align: left; cursor: pointer; }
.materials-list button:last-child { border-bottom: 0; }
.materials-list button:hover, .materials-list button:focus-visible { background: var(--surface-subtle); }
.material-kind, .materials-list small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
.materials-list strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-size: 13px; font-weight: 600; }
.material-arrow { color: var(--primary); }
.materials-empty { margin: 0; padding: 12px 14px; color: var(--muted); font-size: 13px; }
@media (max-width: 720px) {
  .materials-index { padding: 16px 12px; }
  .materials-heading { align-items: stretch; flex-direction: column; }
  .materials-heading input { width: 100%; box-sizing: border-box; }
  .materials-list button { grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; }
  .material-kind { grid-column: 1; grid-row: 1; }
  .materials-list strong { grid-column: 1; grid-row: 2; white-space: normal; overflow-wrap: anywhere; }
  .materials-list small { grid-column: 1; grid-row: 3; }
  .material-arrow { grid-column: 2; grid-row: 2; }
}
</style>
