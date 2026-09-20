<script setup lang="ts">
import { computed } from 'vue';
import type { Capability, Feature, ProjectDetail } from '@forgeflow/contracts';

const props = defineProps<{ detail: ProjectDetail; mode?: 'development' | 'testing' }>();
const emit = defineEmits<{ openFeature: [feature: Feature] }>();

const rows = computed(() => props.detail.capabilities
  .slice()
  .sort((a, b) => {
    const featureA = props.detail.features.find((feature) => feature.id === a.featureId);
    const featureB = props.detail.features.find((feature) => feature.id === b.featureId);
    return (featureA?.sortOrder ?? 0) - (featureB?.sortOrder ?? 0) || a.sortOrder - b.sortOrder;
  }));

function featureOf(capability: Capability) { return props.detail.features.find((feature) => feature.id === capability.featureId); }
function moduleOf(capability: Capability) { return props.detail.modules.find((module) => module.id === capability.moduleId); }
function tasksOf(capability: Capability) { return props.detail.tasks.filter((task) => task.capabilityId === capability.id); }
function runsOf(capability: Capability) {
  const ids = new Set(tasksOf(capability).map((task) => task.id));
  return props.detail.runs.filter((run) => ids.has(run.taskId));
}
function hasDesign(capability: Capability) { return props.detail.specifications.some((spec) => spec.capabilityId === capability.id && spec.latestRevisionId); }
function implementation(capability: Capability) {
  const tasks = tasksOf(capability);
  if (capability.status === 'DONE' || tasks.some((task) => ['DONE', 'CONFIRMED'].includes(task.status))) return '✓ 已完成';
  if (capability.status === 'IMPLEMENTING' || tasks.some((task) => task.status === 'RUNNING')) return '进行中';
  if (capability.status === 'BLOCKED') return '受阻';
  return '—';
}
function verification(capability: Capability) {
  const latest = runsOf(capability).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (latest?.verificationSummary?.status === 'PASS') return `✓ PASS · ${latest.verificationSummary.summary}`;
  if (latest?.verificationSummary) return `${latest.verificationSummary.status} · ${latest.verificationSummary.summary}`;
  if (capability.status === 'TESTING') return '测试中';
  return '—';
}
function statusName(status: Capability['status']) {
  return { DRAFT: '草稿', DESIGNED: '已设计', IMPLEMENTING: '实现中', TESTING: '测试中', DONE: '完成', BLOCKED: '受阻' }[status];
}
</script>

<template>
  <div class="progress-page">
    <header>
      <div><small>{{ mode === 'testing' ? 'VERIFICATION' : 'CAPABILITY DELIVERY' }}</small><h1>{{ mode === 'testing' ? '测试与验收' : '实施进度' }}</h1><p>{{ mode === 'testing' ? '测试状态来自 Capability 关联 Run 的真实验证结果。' : 'Module → Feature → Capability 是产品结构；Task 与 Run 作为实施证据。' }}</p></div>
      <div class="rollup"><strong>{{ rows.filter(item => item.status === 'DONE').length }} / {{ rows.length }}</strong><span>Capability DONE</span></div>
    </header>
    <section class="matrix">
      <div class="matrix-head"><span>模块</span><span>功能</span><span>能力项</span><span>设计</span><span>实现</span><span>测试 / 证据</span></div>
      <button v-for="capability in rows" :key="capability.id" type="button" @click="featureOf(capability) && emit('openFeature', featureOf(capability)!)">
        <span><strong>{{ moduleOf(capability)?.name ?? '—' }}</strong><small>{{ moduleOf(capability)?.code }}</small></span>
        <span><strong>{{ featureOf(capability)?.name ?? '—' }}</strong><small>{{ featureOf(capability)?.code }}</small></span>
        <span><code>{{ capability.code }}</code><strong>{{ capability.name }}</strong><em :data-status="capability.status">{{ statusName(capability.status) }}</em></span>
        <span :class="{ ok: hasDesign(capability) }">{{ hasDesign(capability) ? '✓ 已设计' : '—' }}</span>
        <span :class="{ ok: implementation(capability).startsWith('✓') }">{{ implementation(capability) }}</span>
        <span :class="{ ok: verification(capability).startsWith('✓') }">{{ verification(capability) }}</span>
      </button>
      <div v-if="!rows.length" class="empty"><strong>尚无 Capability</strong><p>在 Feature 中拆出用户可理解的能力后，这里会自动形成研发进度矩阵。</p></div>
    </section>
  </div>
</template>

<style scoped>
.progress-page { color: #192e38; }
.progress-page > header { display: flex; align-items: end; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
header small { color: #647982; font-size: 12px; font-weight: 800; letter-spacing: .13em; }
h1 { margin: 5px 0 7px; font: 700 29px Georgia, 'Noto Serif SC', serif; }
header p { margin: 0; color: #667981; font-size: 14px; }
.rollup { display: grid; justify-items: end; }
.rollup strong { color: #126c59; font-size: 24px; }
.rollup span { color: #6f8088; font-size: 12px; }
.matrix { border: 1px solid #d4dfe3; background: #fff; }
.matrix-head, .matrix > button { display: grid; grid-template-columns: 1fr 1.1fr 1.5fr .65fr .75fr 1.45fr; align-items: center; gap: 14px; }
.matrix-head { padding: 11px 16px; background: #eaf0f1; color: #53666f; font-size: 13px; font-weight: 800; }
.matrix > button { width: 100%; min-height: 64px; padding: 12px 16px; border: 0; border-bottom: 1px solid #e0e7ea; background: transparent; color: #40545d; font-size: 14px; text-align: left; cursor: pointer; }
.matrix > button:hover { background: #f6faf8; }
.matrix > button > span { min-width: 0; }
.matrix strong { display: block; overflow: hidden; color: #233943; text-overflow: ellipsis; white-space: nowrap; }
.matrix small { display: block; margin-top: 3px; color: #849198; font-size: 12px; }
.matrix code { float: left; margin-right: 8px; color: #116c59; font-weight: 800; }
.matrix em { display: inline-block; margin-top: 5px; padding: 2px 6px; background: #edf2f3; color: #607079; font-size: 11px; font-style: normal; font-weight: 800; }
.matrix em[data-status='DONE'] { background: #dff1e9; color: #12644f; }
.matrix em[data-status='IMPLEMENTING'] { background: #fff0d7; color: #87570f; }
.matrix em[data-status='TESTING'] { background: #e4eef7; color: #345f83; }
.matrix em[data-status='BLOCKED'] { background: #fae4e7; color: #a43845; }
.ok { color: #126c59; font-weight: 750; }
.empty { padding: 60px 24px; color: #667880; text-align: center; }
.empty strong { font-size: 18px; }
.empty p { font-size: 14px; }
@media (max-width: 1100px) { .matrix-head, .matrix > button { grid-template-columns: 1fr 1.1fr 1.5fr .75fr 1.3fr; } .matrix-head span:nth-child(5), .matrix > button > span:nth-child(5) { display: none; } }
</style>
