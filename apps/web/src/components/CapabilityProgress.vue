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
        <span class="heading-badge">共 {{ rows.length }} 项能力</span>
      </div>
      <div class="rollup-stats">
        <span class="stat-label">已交付</span>
        <strong class="stat-value">{{ rows.filter(item => item.status === 'DONE').length }} <small>/ {{ rows.length }}</small></strong>
      </div>
    </header>
    <section class="surface matrix-card">
      <div class="matrix-head">
        <span>所属模块</span>
        <span>关联功能</span>
        <span>能力项名称</span>
        <span>架构设计</span>
        <span>工程实现</span>
        <span>自动化验证</span>
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
            <code class="cap-code">{{ capability.code }}</code>
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
  color: #0f172a;
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
  background: #f1f5f9;
  border-radius: 999px;
  color: #64748b;
  font-size: 12px;
  font-weight: 500;
}
.rollup-stats {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 14px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.stat-label {
  color: #64748b;
  font-size: 12.5px;
  font-weight: 500;
}
.stat-value {
  color: #2563eb;
  font-size: 17px;
  font-weight: 700;
  line-height: 1;
}
.stat-value small {
  color: #94a3b8;
  font-size: 12.5px;
  font-weight: 500;
  margin-left: 2px;
}
.matrix-card {
  background: #ffffff;
  overflow: hidden;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.matrix-head {
  display: grid;
  grid-template-columns: minmax(130px, 1.2fr) minmax(150px, 1.4fr) minmax(260px, 2.2fr) 110px 110px 130px;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  color: #475569;
  font-size: 12.5px;
  font-weight: 600;
}
.matrix-rows {
  display: flex;
  flex-direction: column;
}
.matrix-row {
  display: grid;
  grid-template-columns: minmax(130px, 1.2fr) minmax(150px, 1.4fr) minmax(260px, 2.2fr) 110px 110px 130px;
  align-items: center;
  gap: 16px;
  width: 100%;
  height: 52px;
  min-height: 52px;
  max-height: 52px;
  padding: 0 20px;
  box-sizing: border-box;
  border: 0;
  border-bottom: 1px solid #f1f5f9;
  background: transparent;
  color: #334155;
  font-size: 13.5px;
  text-align: left;
  transition: background 0.12s;
  cursor: pointer;
}
.matrix-row:hover {
  background: #f8fafc;
}
.cell-module, .cell-feature {
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  height: 100%;
}
.cell-module strong, .cell-feature strong {
  overflow: hidden;
  color: #0f172a;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13.5px;
  font-weight: 600;
}
.cell-capability {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  height: 100%;
}
.cap-code {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  color: #475569;
  font: 600 11px var(--mono);
  flex-shrink: 0;
}
.cap-name {
  color: #0f172a;
  font-weight: 600;
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cap-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.cap-pill[data-status='DONE'] { background: #dcfce7; color: #15803d; }
.cap-pill[data-status='IMPLEMENTING'] { background: #fef3c7; color: #b45309; }
.cap-pill[data-status='TESTING'] { background: #e0f2fe; color: #0369a1; }
.cap-pill[data-status='BLOCKED'] { background: #ffe4e6; color: #e11d48; }

.cell-status {
  display: flex;
  align-items: center;
  height: 100%;
}
.status-badge-clean {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.status-badge-clean.pass {
  background: #dcfce7;
  color: #15803d;
  font-weight: 600;
}
.status-badge-clean.active {
  background: #eff6ff;
  color: #1d4ed8;
  font-weight: 600;
}
.status-badge-clean.warn {
  background: #fee2e2;
  color: #b91c1c;
}
</style>
