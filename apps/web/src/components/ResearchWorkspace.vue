<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { SpecificationRevision, SpecificationSummary } from '@forgeflow/contracts';

const props = defineProps<{ specification: SpecificationSummary | null; revision: SpecificationRevision | null }>();
const emit = defineEmits<{ create: [] }>();

type ResearchItem = { name: string; body: string[]; source: string; url: string; status: string };

const items = computed<ResearchItem[]>(() => {
  const content = props.revision?.content ?? '';
  const result: ResearchItem[] = [];
  let current: ResearchItem | null = null;
  for (const line of content.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line.trim());
    if (heading && !/对当前项目的影响|调研目标|调研对象/.test(heading[1] ?? '')) {
      if (current) result.push(current);
      current = { name: heading[1]!.trim(), body: [], source: '公开资料', url: '', status: '已分析' };
      continue;
    }
    if (!current || !line.trim() || /^\|\s*[-:]+/.test(line)) continue;
    if (line.includes('|')) {
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      const key = cells[0] ?? ''; const value = cells[1] ?? '';
      if (/来源/.test(key)) current.source = value;
      else if (/URL/.test(key)) current.url = value;
      else if (/状态/.test(key)) current.status = value;
    } else if (!/^###?\s+/.test(line)) current.body.push(line.replace(/^[-*]\s+/, '').trim());
  }
  if (current) result.push(current);
  return result;
});
const selectedName = ref('');
const selected = computed(() => items.value.find((item) => item.name === selectedName.value) ?? items.value[0] ?? null);
watch(items, (value) => { if (!value.some((item) => item.name === selectedName.value)) selectedName.value = value[0]?.name ?? ''; }, { immediate: true });
</script>

<template>
  <div class="research-workspace">
    <header class="compact-page-heading">
      <div class="heading-title-group">
        <h1>调研与分析</h1>
      </div>
      <button class="primary-button" type="button" @click="emit('create')">
        {{ revision ? '＋ 创建新版本' : '＋ 新建调研' }}
      </button>
    </header>
    <div v-if="items.length" class="research-layout surface">
      <aside>
        <div class="list-title">
          <strong>调研对象</strong>
          <span class="count-pill">{{ items.length }}</span>
        </div>
        <div class="research-items-list">
          <button
            v-for="item in items"
            :key="item.name"
            :class="{ active: selected?.name === item.name }"
            @click="selectedName = item.name"
          >
            <span>
              <strong>{{ item.name }}</strong>
            </span>
            <em class="status-badge">{{ item.status }}</em>
          </button>
        </div>
      </aside>
      <article v-if="selected">
        <header class="article-header">
          <div>
            <h2>{{ selected.name }}</h2>
          </div>
          <span class="status-badge active">{{ selected.status }}</span>
        </header>
        <dl class="research-meta">
          <div>
            <dt>来源</dt>
            <dd>{{ selected.source }}</dd>
          </div>
          <div>
            <dt>版本</dt>
            <dd>{{ revision?.revisionNo ?? '—' }}</dd>
          </div>
          <div>
            <dt>URL / 仓库</dt>
            <dd>
              <a v-if="selected.url" :href="selected.url" target="_blank" rel="noreferrer">{{ selected.url }}</a>
              <span v-else class="text-muted">未提供</span>
            </dd>
          </div>
        </dl>
        <section class="research-findings">
          <h3>观察与结论</h3>
          <div class="finding-lines">
            <p v-for="(line, idx) in selected.body" :key="idx">{{ line }}</p>
            <p v-if="!selected.body.length" class="text-muted">暂无观察记录</p>
          </div>
        </section>
      </article>
    </div>
    <div v-else class="surface empty-state">
      <h3>尚无调研对象</h3>
      <button class="primary-button" type="button" @click="emit('create')">＋ 新建调研</button>
    </div>
  </div>
</template>

<style scoped>
.research-workspace {
  container: research / inline-size;
  color: var(--ink);
}
.research-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 360px;
  overflow: hidden;
  border-radius: 6px;
}
.research-layout aside {
  border-right: 1px solid var(--line);
  background: var(--surface-subtle);
  display: flex;
  flex-direction: column;
}
.list-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.list-title strong {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink);
}
.count-pill {
  padding: 2px 7px;
  background: var(--line);
  border-radius: 9999px;
  color: var(--ink-secondary);
  font-size: 11.5px;
  font-weight: 600;
}
.research-items-list {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.research-items-list button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 12px 18px;
  border: 0;
  border-bottom: 1px solid var(--surface-subtle);
  background: transparent;
  color: var(--ink-secondary);
  text-align: left;
  transition: all 0.12s;
  cursor: pointer;
}
.research-items-list button:hover {
  background: var(--surface-subtle);
}
.research-items-list button.active {
  background: var(--surface);
  border-left: 3px solid var(--primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.research-items-list button span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.research-items-list button strong {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
}
.research-items-list button small {
  color: var(--muted);
  font-size: 12px;
}
.status-badge {
  padding: 2px 7px;
  border-radius: 4px;
  background: var(--surface-subtle);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  font-style: normal;
}
.status-badge.active {
  background: #ecfdf5;
  color: #059669;
}
article {
  padding: 28px 32px;
  background: var(--surface);
  overflow-y: auto;
}
.article-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
article h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.01em;
}
.research-meta {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 20px 0;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-subtle);
}
.research-meta dt {
  color: var(--muted);
  font-size: 12px;
}
.research-meta dd {
  margin: 4px 0 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.research-meta dd a {
  color: var(--primary);
}
.research-findings h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  margin: 24px 0 12px;
}
.finding-lines p {
  color: var(--ink-secondary);
  font-size: 14px;
  line-height: 1.7;
  margin: 0 0 10px;
}
.text-muted {
  color: var(--muted-light);
}
@container research (max-width: 720px) {
  .research-layout { grid-template-columns: 1fr; }
  .research-layout aside { border-right: 0; border-bottom: 1px solid var(--line); }
  .research-items-list { max-height: 150px; }
  .research-meta { grid-template-columns: 1fr 1fr; }
  .research-meta > div:last-child { grid-column: 1 / -1; }
}
</style>
