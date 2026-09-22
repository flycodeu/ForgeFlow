<script setup lang="ts">
import { computed } from 'vue';
import ArchiveMarkdown from './ArchiveMarkdown.vue';

type SqlField = { name?: string; type?: string; declaration?: string };

const props = defineProps<{
  data: Record<string, unknown>;
  markdown: string | null;
}>();

const fields = computed(() => (Array.isArray(props.data.fields) ? props.data.fields : []) as SqlField[]);
const sourcePath = computed(() => String(props.data.sqlPath ?? ''));
const cardPath = computed(() => String(props.data.cardPath ?? ''));
const hash = computed(() => String(props.data.sqlSha256 ?? ''));
const table = computed(() => String(props.data.table ?? ''));
const normalized = computed(() => (props.markdown ?? '').replace(/\r\n?/g, '\n'));
const purpose = computed(() => {
  const heading = /^##\s+\d+\.\s+`[^`]+`\s+(.+)$/m.exec(normalized.value);
  return heading?.[1]?.trim() ?? '';
});
const sql = computed(() => /## 当前 SQL 原文\s*\n+```sql\s*\n([\s\S]*?)\n```/i.exec(normalized.value)?.[1]?.trim() ?? '');

function paragraph(label: string) {
  const lines = normalized.value.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`**${label}**：`));
  if (start < 0) return '';
  const collected = [lines[start]!.slice(`**${label}**：`.length)];
  for (let index = start + 1; index < lines.length && lines[index]!.trim(); index += 1) collected.push(lines[index]!);
  return collected.join(' ').trim();
}

const constraints = computed(() => {
  const explicit = paragraph('约束/索引');
  if (explicit) return explicit;
  const facts = paragraph('字段事实');
  return facts.split('。').slice(1).join('。').trim();
});
const difference = computed(() => paragraph('目标与差异'));
const hasSummary = computed(() => Boolean(purpose.value || constraints.value || difference.value));

function declarationInfo(field: SqlField) {
  const declaration = field.declaration ?? '';
  const nullable = /\bNOT\s+NULL\b/i.test(declaration) ? '非空' : /\bNULL\b/i.test(declaration) ? '可空' : '未注明';
  const defaultValue = /\bDEFAULT\s+('[^']*'|[\w().+-]+)/i.exec(declaration)?.[1];
  if (/\bAUTO_INCREMENT\b/i.test(declaration)) return `${nullable} · 自增`;
  return defaultValue ? `${nullable} · 默认 ${defaultValue.replace(/^'|'$/g, '')}` : nullable;
}

function meaning(field: SqlField) {
  const comment = /\bCOMMENT\s+'((?:''|[^'])*)'/i.exec(field.declaration ?? '')?.[1];
  const description = comment?.replaceAll("''", "'");
  return field.name === 'id' && description === '主键ID，自增' ? '记录唯一标识' : description ?? '原始字段未注明用途';
}
</script>

<template>
  <div class="data-model-view">
    <section v-if="purpose" class="model-intro">
      <span>表职责</span><strong>{{ purpose }}</strong>
    </section>

    <section v-if="fields.length" class="model-section">
      <header><h3>字段</h3><span>{{ fields.length }} 列 · 当前 DDL</span></header>
      <div class="model-table-scroll"><table>
        <thead><tr><th>列名</th><th>类型</th><th>空值与默认</th><th>业务含义</th></tr></thead>
        <tbody><tr v-for="field in fields" :key="field.name"><td><code>{{ field.name }}</code></td><td><code>{{ field.type }}</code></td><td>{{ declarationInfo(field) }}</td><td>{{ meaning(field) }}</td></tr></tbody>
      </table></div>
    </section>

    <section v-if="constraints" class="model-section model-prose">
      <header><h3>关键约束与索引</h3></header><ArchiveMarkdown :content="constraints" />
    </section>
    <section v-if="difference" class="model-section model-prose">
      <header><h3>目标与现状差异</h3></header><ArchiveMarkdown :content="difference" />
    </section>
    <section v-if="!hasSummary && markdown" class="model-section model-prose">
      <header><h3>设计说明</h3></header><ArchiveMarkdown :content="markdown.replace(/## 当前 SQL 原文[\s\S]*$/i, '').trim()" />
    </section>

    <details v-if="sourcePath || cardPath || hash || sql" class="model-source">
      <summary>来源与当前 DDL</summary>
      <dl>
        <div v-if="sourcePath"><dt>逐表 SQL</dt><dd><code>{{ sourcePath }}</code></dd></div>
        <div v-if="cardPath"><dt>表卡</dt><dd><code>{{ cardPath }}</code></dd></div>
        <div v-if="hash"><dt>SQL SHA-256</dt><dd><code>{{ hash }}</code></dd></div>
      </dl>
      <div v-if="sql" class="model-sql"><strong>{{ table || '当前表' }} · 原始空库建表 SQL（不用于已有库升级）</strong><pre><code>{{ sql }}</code></pre></div>
    </details>
  </div>
</template>

<style scoped>
.data-model-view { max-width: 1200px; margin: 0 auto; }
.model-intro, .model-section, .model-source { min-width: 0; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.model-intro { display: grid; gap: 4px; padding: 16px 20px; }
.model-intro span { color: var(--muted); font-size: 12px; }
.model-intro strong { color: var(--ink); font-size: 16px; }
.model-section { overflow: hidden; }
.model-section header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 0 20px; border-bottom: 1px solid var(--line); background: var(--surface-subtle); }
.model-section h3 { margin: 0; color: var(--ink); font-size: 15px; }
.model-section header span { color: var(--muted); font-size: 12px; }
.model-table-scroll { overflow-x: auto; }
table { width: 100%; min-width: 680px; border-collapse: collapse; font-size: 13px; }
th, td { padding: 9px 14px; border-bottom: 1px solid var(--surface-subtle); text-align: left; vertical-align: top; }
th { background: var(--surface-subtle); color: var(--ink-secondary); white-space: nowrap; }
td { color: var(--ink-secondary); line-height: 1.5; }
th:first-child, td:first-child { width: 18%; }
th:nth-child(2), td:nth-child(2) { width: 15%; }
th:nth-child(3), td:nth-child(3) { width: 21%; }
tr:last-child td { border-bottom: 0; }
code { font-family: var(--mono); overflow-wrap: anywhere; }
.model-prose :deep(.archive-markdown) { padding: 14px 20px; }
.model-prose :deep(.archive-markdown p:last-child) { margin-bottom: 0; }
.model-source { padding: 0 20px 18px; }
.model-source summary { padding: 14px 0; color: var(--ink); font-size: 14px; font-weight: 600; cursor: pointer; }
.model-source[open] summary { border-bottom: 1px solid var(--line); }
.model-source dl { display: grid; gap: 8px; margin: 16px 0; }
.model-source dl > div { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 10px; font-size: 12px; }
.model-source dt { color: var(--muted); }
.model-source dd { min-width: 0; margin: 0; color: var(--ink-secondary); overflow-wrap: anywhere; }
.model-sql strong { display: block; margin-bottom: 8px; font-size: 12px; color: var(--ink-secondary); }
.model-sql pre { max-height: 420px; overflow: auto; margin: 0; padding: 14px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface-subtle); color: var(--ink-secondary); font: 12px/1.55 var(--mono); }
@media (max-width: 600px) { .model-source dl > div { grid-template-columns: 1fr; gap: 2px; } }
</style>
