<script setup lang="ts">
import { computed } from 'vue';
import type { Capability, Feature, ProjectDetail } from '@forgeflow/contracts';

const props = defineProps<{ detail: ProjectDetail }>();
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
  if (capability.status === 'DONE' || tasks.some((task) => ['DONE', 'CONFIRMED'].includes(task.status))) return '已完成';
  if (capability.status === 'IMPLEMENTING' || tasks.some((task) => task.status === 'RUNNING')) return '进行中';
  if (capability.status === 'BLOCKED') return '受阻';
  return '未开始';
}
function verification(capability: Capability) {
  const latest = runsOf(capability).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  if (latest?.verificationSummary?.status === 'PASS') return `✓ ${latest.verificationSummary.origin === 'AI_REPORTED' ? 'AI 报告通过' : '有证据通过'}`;
  if (latest?.verificationSummary) return `${latest.verificationSummary.status} · ${latest.verificationSummary.origin}`;
  if (capability.status === 'TESTING') return '验证中';
  return '未开始';
}
function statusName(status: Capability['status']) {
  return { DRAFT: '草稿', DESIGNED: '已设计', IMPLEMENTING: '实现中', TESTING: '验证中', DONE: '已完成', BLOCKED: '受阻' }[status];
}
</script>

<template>
  <div class="progress-page">
    <header class="compact-page-heading">
      <div class="heading-title-group">
        <h1>实施进度</h1>
        <span class="heading-badge">{{ rows.length }} 项</span>
      </div>
      <div class="rollup-stats">
        <span class="stat-label">标记完成</span>
        <strong class="stat-value">{{ rows.filter(item => item.status === 'DONE').length }} <small>/ {{ rows.length }}</small></strong>
      </div>
    </header>
    <section class="surface matrix-card">
      <div class="matrix-head">
        <span>所属模块</span>
        <span>关联功能</span>
        <span>功能</span>
        <span>设计</span>
        <span>实现</span>
        <span>验证</span>
      </div>
      <div v-if="rows.length" class="matrix-rows">
        <button
          v-for="capability in rows"
          :key="capability.id"
          type="button"
          class="matrix-row"
          @click="featureOf(capability) && emit('openFeature', featureOf(capability)!)"
        >
          <span class="cell-module">
            <strong>{{ moduleOf(capability)?.name ?? '—' }}</strong>
          </span>
          <span class="cell-feature">
            <strong>{{ featureOf(capability)?.name ?? '—' }}</strong>
          </span>
          <span class="cell-capability">
            <strong class="cap-name">{{ capability.name }}</strong>
            <span class="cap-pill" :data-status="capability.status">{{ statusName(capability.status) }}</span>
          </span>
          <span class="cell-status">
            <span class="status-badge-clean" :class="{ pass: hasDesign(capability) }">
              {{ hasDesign(capability) ? '✓ 已设计' : '未设计' }}
            </span>
          </span>
          <span class="cell-status">
            <span
              class="status-badge-clean"
              :class="{
                pass: implementation(capability) === '已完成',
                active: implementation(capability) === '进行中',
                warn: implementation(capability) === '受阻'
              }"
            >
              {{ implementation(capability) === '已完成' ? '✓ 已完成' : implementation(capability) }}
            </span>
          </span>
          <span class="cell-status">
            <span
              class="status-badge-clean"
              :class="{
                pass: verification(capability).startsWith('✓'),
                active: verification(capability) === '验证中'
              }"
            >
              {{ verification(capability) }}
            </span>
          </span>
        </button>
      </div>
      <div v-else class="compact-empty">
        暂无能力项
      </div>
    </section>
  </div>
</template>

<style scoped>
.progress-page {
  container: progress / inline-size;
  color: var(--ink);
}
.heading-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}
.heading-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  background: var(--surface-subtle);
  border-radius: 999px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
}
.rollup-stats {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.stat-label {
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 500;
}
.stat-value {
  color: var(--primary);
  font-size: 17px;
  font-weight: 700;
  line-height: 1;
}
.stat-value small {
  color: var(--muted-light);
  font-size: 12.5px;
  font-weight: 500;
  margin-left: 2px;
}
.matrix-card {
  background: var(--surface);
  overflow-x: auto;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-sm);
}
.matrix-head {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) minmax(110px, 1fr) minmax(180px, 1.6fr) 90px 90px 140px;
  align-items: center;
  gap: 16px;
  min-width: 760px;
  padding: 12px 20px;
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}
.matrix-rows {
  display: flex;
  flex-direction: column;
}
.matrix-row {
  display: grid;
  grid-template-columns: minmax(100px, 1fr) minmax(110px, 1fr) minmax(180px, 1.6fr) 90px 90px 140px;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-width: 760px;
  min-height: 52px;
  height: auto;
  padding: 12px 20px;
  box-sizing: border-box;
  border: 0;
  border-bottom: 1px solid var(--line-subtle);
  background: transparent;
  color: var(--ink-secondary);
  font-size: 13px;
  text-align: left;
  transition: background 0.12s;
  cursor: pointer;
}
.matrix-row:hover {
  background: var(--surface-subtle);
}
.cell-module, .cell-feature {
  display: flex;
  align-items: center;
  overflow: hidden;
  min-width: 0;
}
.cell-module strong, .cell-feature strong {
  overflow: hidden;
  color: var(--ink);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}
.cell-capability {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  min-width: 0;
}
.cap-code {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  background: var(--surface-subtle);
  border: 1px solid var(--line);
  color: var(--ink-secondary);
  font: 600 11px var(--mono);
  flex-shrink: 0;
}
.cap-name {
  color: var(--ink);
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cap-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: var(--radius-xs);
  background: var(--surface-subtle);
  color: var(--muted);
  border: 1px solid var(--line);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.cap-pill[data-status='DONE'] {
  background: var(--primary-subtle);
  color: var(--primary-dark);
  border-color: rgba(15, 118, 110, 0.2);
}
.cap-pill[data-status='IMPLEMENTING'] {
  background: var(--surface-subtle);
  color: var(--ink);
  border-color: var(--line-strong);
}
.cap-pill[data-status='TESTING'] {
  background: rgba(15, 118, 110, 0.08);
  color: var(--primary);
  border-color: rgba(15, 118, 110, 0.25);
}
.cap-pill[data-status='BLOCKED'] {
  background: rgba(225, 29, 72, 0.06);
  color: #be123c;
  border-color: rgba(225, 29, 72, 0.2);
}

.cell-status {
  display: flex;
  align-items: center;
}
.status-badge-clean {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  background: var(--surface-subtle);
  color: var(--muted);
  border: 1px solid var(--line);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.status-badge-clean.pass {
  background: var(--primary-subtle);
  color: var(--primary-dark);
  border-color: rgba(15, 118, 110, 0.25);
  font-weight: 600;
}
.status-badge-clean.active {
  background: rgba(15, 118, 110, 0.08);
  color: var(--primary);
  border-color: rgba(15, 118, 110, 0.25);
  font-weight: 600;
}
.status-badge-clean.warn {
  background: rgba(225, 29, 72, 0.06);
  color: #be123c;
  border-color: rgba(225, 29, 72, 0.2);
}
@container progress (max-width: 900px) {
  .matrix-head, .matrix-row { grid-template-columns: minmax(0, 1fr) 76px 76px 120px; gap: 10px; padding-inline: 12px; }
  .matrix-head > :nth-child(-n+2), .matrix-row > :nth-child(-n+2) { display: none; }
}
@container progress (max-width: 540px) {
  .matrix-head, .matrix-row { grid-template-columns: minmax(0, 1fr) 120px; }
  .matrix-head > :nth-child(4), .matrix-head > :nth-child(5), .matrix-row > :nth-child(4), .matrix-row > :nth-child(5) { display: none; }
  .cell-capability { min-width: 0; }
  .cap-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
</style>
