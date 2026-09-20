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
    <header><div><h1>调研与分析</h1><p v-if="revision">当前版本 REV {{ revision.revisionNo }}</p></div><button type="button" @click="emit('create')">{{ revision ? '创建新版本' : '创建调研' }}</button></header>
    <div v-if="items.length" class="research-layout">
      <aside><div class="list-title"><strong>调研对象</strong><span>{{ items.length }}</span></div><button v-for="item in items" :key="item.name" :class="{ active: selected?.name === item.name }" @click="selectedName = item.name"><span><strong>{{ item.name }}</strong><small>{{ item.source }}</small></span><em>{{ item.status }}</em></button></aside>
      <article v-if="selected"><header><div><h2>{{ selected.name }}</h2></div><span>{{ selected.status }}</span></header><dl><div><dt>来源</dt><dd>{{ selected.source }}</dd></div><div><dt>版本</dt><dd>REV {{ revision?.revisionNo ?? '—' }}</dd></div><div><dt>URL / 仓库</dt><dd><a v-if="selected.url" :href="selected.url" target="_blank" rel="noreferrer">{{ selected.url }}</a><span v-else>正文未提供</span></dd></div></dl><section><h3>观察与结论</h3><p v-for="line in selected.body" :key="line">{{ line }}</p><p v-if="!selected.body.length">暂无观察记录</p></section></article>
    </div>
    <div v-else class="empty"><strong>尚无调研对象</strong><button type="button" @click="emit('create')">创建调研</button></div>
  </div>
</template>

<style scoped>
.research-workspace { color: #1c303a; }
.research-workspace > header { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
header small { color: #6c7f87; font-size: 12px; font-weight: 800; letter-spacing: .13em; }
h1 { margin: 5px 0 7px; font: 700 29px Georgia, 'Noto Serif SC', serif; }
.research-workspace > header p { margin: 0; color: #657780; font-size: 14px; }
.research-workspace > header button, .empty button { min-height: 40px; padding: 0 16px; border: 1px solid #126d5a; background: #126d5a; color: #fff; font-size: 14px; }
.research-layout { display: grid; grid-template-columns: 340px minmax(0, 1fr); min-height: 620px; border: 1px solid #d4dfe3; background: #fff; }
.research-layout aside { border-right: 1px solid #d4dfe3; background: #f7f9f9; }
.list-title { display: flex; justify-content: space-between; padding: 18px; border-bottom: 1px solid #dbe4e7; }
.list-title span { color: #16715e; font-weight: 800; }
aside > button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 14px 16px; border: 0; border-bottom: 1px solid #e0e7ea; background: transparent; color: #344b55; text-align: left; }
aside > button.active { background: #fff; box-shadow: inset 3px 0 #14715f; }
aside > button span { display: grid; gap: 4px; }
aside > button strong { font-size: 15px; }
aside > button small { color: #71838b; font-size: 12px; }
aside > button em { padding: 3px 7px; background: #e3f0ec; color: #126a58; font-size: 12px; font-style: normal; }
article { padding: 28px 32px; }
article > header { display: flex; justify-content: space-between; padding-bottom: 18px; border-bottom: 1px solid #dee6e9; }
article h2 { margin: 5px 0 0; font: 700 25px Georgia, 'Noto Serif SC', serif; }
article > header > span { align-self: start; padding: 4px 8px; background: #e3f0ec; color: #126a58; font-size: 12px; font-weight: 800; }
dl { display: grid; grid-template-columns: repeat(3, 1fr); margin: 20px 0; border: 1px solid #dbe4e7; }
dl div { padding: 12px 14px; border-right: 1px solid #dbe4e7; }
dt { color: #71828a; font-size: 12px; }
dd { margin: 5px 0 0; font-size: 14px; }
dd a { color: #126d5a; }
article section { padding: 8px 0 20px; }
article h3 { font-size: 18px; }
article section p, article footer p { color: #40545e; font-size: 15px; line-height: 1.7; }
article footer { padding: 15px 17px; border-left: 3px solid #d18a2b; background: #fff9ef; }
article footer p { margin: 5px 0 0; }
.empty { display: grid; place-content: center; min-height: 520px; padding: 40px; border: 1px solid #d4dfe3; background: #fff; color: #687982; text-align: center; }
.empty strong { color: #273e48; font-size: 19px; }
.empty p { max-width: 580px; font-size: 14px; line-height: 1.6; }
.empty button { justify-self: center; }
@media (max-width: 800px) { .research-layout { display: block; } .research-layout aside { border-right: 0; border-bottom: 1px solid #d4dfe3; } dl { grid-template-columns: 1fr; } }
</style>
