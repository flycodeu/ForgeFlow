<script setup lang="ts">
import { computed } from 'vue';
import ArchiveMarkdown from './ArchiveMarkdown.vue';

const props = defineProps<{ content: string }>();
const headings = ['输入字段', '输出与状态', '处理与异常', '接口与数据', '验收要点'] as const;
const design = computed(() => {
  const matches = [...props.content.matchAll(/^### (.+)\s*$/gm)];
  if (matches.length < headings.length || !headings.every((heading, index) => matches[index]?.[1] === heading)) return null;
  const intro = props.content.slice(0, matches[0]!.index).replace(/^#{1,2} [^\n]+\n+/, '').trim();
  const sections = matches.map((match, index) => ({
    title: match[1]!, content: props.content.slice(match.index! + match[0].length, matches[index + 1]?.index ?? props.content.length).trim(),
  }));
  return { intro, sections: sections.filter((section) => section.title !== '来源'),
    source: sections.find((section) => section.title === '来源')?.content };
});
</script>

<template>
  <div v-if="design" class="operation-design">
    <p class="operation-goal">{{ design.intro }}</p>
    <section v-for="section in design.sections" :key="section.title" class="operation-section" :class="{ 'input-section': section.title === '输入字段' }">
      <h3>{{ section.title }}</h3>
      <ArchiveMarkdown :content="section.content" />
    </section>
    <details v-if="design.source" class="operation-source"><summary>来源</summary><ArchiveMarkdown :content="design.source" /></details>
  </div>
  <ArchiveMarkdown v-else :content="content" class="legacy-design" />
</template>

<style scoped>
.operation-design { color: var(--ink-secondary); }
.operation-goal { margin: 0; padding: 18px 20px; color: var(--ink); font-size: 15px; line-height: 1.6; font-weight: 600; }
.operation-section { padding: 14px 20px 16px; border-top: 1px solid var(--line); }
.operation-section h3 { margin: 0 0 10px; color: var(--ink); font-size: 14px; font-weight: 650; }
.operation-section :deep(.archive-markdown) { font-size: 13px; line-height: 1.65; }
.operation-section :deep(.archive-table) { margin: 0; }
.operation-section :deep(p:last-child), .operation-section :deep(ul:last-child) { margin-bottom: 0; }
.operation-section :deep(th:first-child), .operation-section :deep(td:first-child) { width: 28%; min-width: 120px; }
.operation-source { padding: 12px 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
.operation-source summary { cursor: pointer; width: fit-content; }
.operation-source :deep(.archive-markdown) { margin-top: 10px; font-size: 12px; }
.legacy-design { padding: 18px 20px; }
@media (max-width: 760px) {
  .operation-goal { padding: 14px 12px; }
  .operation-section { padding: 12px; }
  .operation-source { padding: 10px 12px; }
}
</style>
