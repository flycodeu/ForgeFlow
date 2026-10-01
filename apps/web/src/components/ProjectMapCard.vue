<script setup lang="ts">
import type { Feature } from '@forgeflow/contracts';
import type { ProjectMapNode } from './project-map';

defineProps<{ node: ProjectMapNode; features: Feature[]; horizontal?: boolean }>();
defineEmits<{ select: [id: string]; openFeature: [id: string] }>();
</script>

<template>
  <article class="module-card" :data-map-node="node.id" :data-status="node.status" :class="{ horizontal }">
    <button class="card-title" type="button" :aria-label="'查看' + node.label + '详情'" @click="$emit('select', node.id)">
      <strong>{{ node.label }}</strong><span :data-status="node.status">{{ node.status === 'planned' ? '规划' : '已有代码' }}</span>
    </button>
    <ul v-if="node.details?.length" class="card-details"><li v-for="item in node.details.slice(0, 4)" :key="item">{{ item }}</li></ul>
    <p v-else-if="!features.length" class="card-summary">{{ node.summary }}</p>
    <div v-if="features.length" class="card-features" aria-label="关联功能">
      <button v-for="feature in features.slice(0, 6)" :key="feature.id" type="button" @click="$emit('openFeature', feature.id)">{{ feature.name }}<span aria-hidden="true">↗</span></button>
    </div>
    <p v-if="node.technology?.length" class="card-technology">{{ node.technology.slice(0, 4).join(' · ') }}</p>
    <button v-if="(node.details?.length ?? 0) > 4 || features.length > 6 || (node.technology?.length ?? 0) > 4" class="card-more" type="button" @click="$emit('select', node.id)">查看全部内容 →</button>
  </article>
</template>

<style scoped>
.module-card { position: relative; z-index: 3; min-width: 0; padding: 12px; border: 1px solid var(--band-border, var(--line)); border-radius: 7px; background: var(--surface); text-align: left; transition: opacity .15s, box-shadow .15s; }
.card-title { display: flex; align-items: start; justify-content: space-between; gap: 8px; width: 100%; padding: 0; text-align: left; }
.card-title strong { color: var(--band-accent, var(--ink)); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.card-title > span { flex: none; padding-top: 2px; color: var(--muted); font-size: 9px; font-weight: 400; }
.card-title > span[data-status="planned"] { color: #a36520; }
.card-title:hover strong { text-decoration: underline; text-underline-offset: 3px; }
button:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; border-radius: 3px; }
.card-details { display: grid; gap: 4px; margin: 8px 0 0; padding: 0; list-style: none; }
.card-details li, .card-summary { color: var(--ink-secondary); font-size: 11px; line-height: 1.65; overflow-wrap: anywhere; }
.card-summary { margin: 8px 0 0; }
.card-features { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.card-features button { display: flex; align-items: center; gap: 5px; padding: 3px 6px; border: 1px solid var(--band-border, var(--line)); border-radius: 4px; color: var(--ink-secondary); background: var(--band-tint, var(--surface-subtle)); text-align: left; font-size: 10px; line-height: 1.5; }
.card-features button:hover { border-color: var(--band-accent, var(--primary)); color: var(--primary); }
.card-features button span { color: var(--muted); font-size: 9px; }
.card-technology { margin: 9px 0 0; padding-top: 8px; border-top: 1px solid var(--line-subtle); color: var(--muted); font-family: var(--mono); font-size: 9px; line-height: 1.6; overflow-wrap: anywhere; }
.card-more { grid-column: 1 / -1; justify-self: start; padding: 7px 0 0; color: var(--primary); font-size: 10px; }
@container project-map (min-width: 900px) {
  .module-card.horizontal { display: grid; grid-template-columns: minmax(150px, .8fr) minmax(180px, 1.2fr); column-gap: 18px; align-items: start; }
  .module-card.horizontal:has(.card-features) { grid-template-columns: minmax(140px, .8fr) minmax(175px, 1.2fr) minmax(130px, .9fr); }
  .horizontal .card-title { display: grid; gap: 4px; }
  .horizontal .card-title > span { padding: 0; }
  .horizontal .card-details, .horizontal .card-summary, .horizontal .card-features { margin-top: 0; }
  .horizontal .card-technology { grid-column: 1 / -1; }
}
</style>
