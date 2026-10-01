<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '../markdown-renderer';

const props = defineProps<{ content: string }>();
const html = computed(() => renderMarkdown(props.content));
</script>

<template>
  <div class="archive-markdown" v-html="html"></div>
</template>

<style scoped>
.archive-markdown { min-width: 0; max-width: 100%; color: var(--ink-secondary); font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
.archive-markdown :deep(h1), .archive-markdown :deep(h2), .archive-markdown :deep(h3), .archive-markdown :deep(h4), .archive-markdown :deep(h5), .archive-markdown :deep(h6) { color: var(--ink); line-height: 1.4; margin: 1.5em 0 .65em; }
.archive-markdown :deep(h1) { font-size: 24px; }
.archive-markdown :deep(h2) { font-size: 20px; }
.archive-markdown :deep(h3) { font-size: 16px; }
.archive-markdown :deep(h4), .archive-markdown :deep(h5), .archive-markdown :deep(h6) { font-size: 14px; }
.archive-markdown :deep(> :first-child) { margin-top: 0; }
.archive-markdown :deep(p) { margin: 0 0 .8em; }
.archive-markdown :deep(ul), .archive-markdown :deep(ol) { margin: 0 0 1em; padding-left: 1.7em; }
.archive-markdown :deep(li) { margin: .15em 0; }
.archive-markdown :deep(a) { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
.archive-markdown :deep(code) { font-family: var(--mono); font-size: .9em; background: var(--surface-subtle); padding: 1px 4px; border-radius: 3px; }
.archive-markdown :deep(pre) { overflow-x: auto; max-width: 100%; background: var(--surface-subtle); padding: 14px; border-radius: 5px; }
.archive-markdown :deep(pre code) { padding: 0; background: none; }
.archive-markdown :deep(blockquote) { margin: 12px 0; padding: 4px 14px; border-left: 3px solid var(--primary-border); color: var(--muted); }
.archive-markdown :deep(.markdown-table-wrap) { max-width: 100%; overflow-x: auto; margin: 16px 0; border: 1px solid var(--line); border-radius: 6px; }
.archive-markdown :deep(table) { border-collapse: collapse; width: max-content; min-width: 100%; font-size: 13px; }
.archive-markdown :deep(th), .archive-markdown :deep(td) { border-bottom: 1px solid var(--line); border-right: 1px solid var(--line-subtle); padding: 9px 11px; text-align: left; min-width: 120px; max-width: 360px; vertical-align: top; overflow-wrap: anywhere; }
.archive-markdown :deep(th:last-child), .archive-markdown :deep(td:last-child) { border-right: 0; }
.archive-markdown :deep(th) { background: var(--surface-subtle); color: var(--ink); font-weight: 600; }
.archive-markdown :deep(tbody tr:nth-child(even)) { background: var(--surface-subtle); }
.archive-markdown :deep(hr) { border: 0; border-top: 1px solid var(--line); margin: 20px 0; }
.archive-markdown :deep(img) { max-width: 100%; height: auto; }
</style>
