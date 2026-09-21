<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AiRun, Feature, FeatureStatus, ProjectDetail, RunReportedStatus } from '@forgeflow/contracts';

const props = defineProps<{ detail: ProjectDetail }>();
const emit = defineEmits<{ openFeature: [feature: Feature] }>();

const activeTab = ref<'acceptance' | 'runs'>('acceptance');

const features = computed(() => props.detail.features.slice().sort((a, b) => a.sortOrder - b.sortOrder));
const runsWithVerification = computed(() =>
  props.detail.runs
    .filter((run) => run.verificationSummary)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
);

const totalVerificationRuns = computed(() => runsWithVerification.value.length);
const passedRuns = computed(() => runsWithVerification.value.filter((run) => run.verificationSummary?.status === 'PASS').length);
const passRate = computed(() =>
  totalVerificationRuns.value ? Math.round((passedRuns.value / totalVerificationRuns.value) * 100) : null,
);

const acceptedFeatures = computed(() =>
  features.value.filter((f) => ['ACCEPTED', 'DELIVERED'].includes(f.status)).length,
);

const pendingFeatures = computed(() =>
  features.value.filter((f) => ['VERIFYING', 'ACCEPTANCE_PENDING'].includes(f.status)).length,
);

const totalIssues = computed(() =>
  props.detail.runs.reduce((acc, r) => acc + (r.issues?.length ?? 0), 0),
);

function moduleOf(moduleId: string) {
  return props.detail.modules.find((m) => m.id === moduleId);
}

function capabilitiesOf(featureId: string) {
  return props.detail.capabilities.filter((c) => c.featureId === featureId);
}

function latestRunOf(featureId: string) {
  return props.detail.runs
    .filter((r) => r.featureId === featureId && r.verificationSummary)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function featureStatusLabel(status: FeatureStatus) {
  const map: Record<FeatureStatus, string> = {
    DRAFT: '草稿',
    DESIGNING: '设计中',
    READY: '待实施',
    IMPLEMENTING: '实施中',
    VERIFYING: '验证中',
    ACCEPTANCE_PENDING: '待验收',
    ACCEPTED: '已验收',
    DELIVERED: '已交付',
  };
  return map[status] ?? status;
}

function runStatusLabel(status: RunReportedStatus) {
  const map: Record<RunReportedStatus, string> = {
    PASS: '通过',
    FAIL: '失败',
    NOT_RUN: '未执行',
    SKIPPED: '已跳过',
    ERROR: '异常',
  };
  return map[status] ?? status;
}
function evidenceLabel(run: AiRun | undefined) {
  const evidence = run?.verificationSummary;
  if (!evidence) return '未记录';
  return `${evidence.origin === 'AI_REPORTED' ? 'AI 报告' : '证据'}${runStatusLabel(evidence.reportedStatus)}`;
}

function formatTime(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="testing-workspace">
    <header class="compact-page-heading">
      <div class="heading-title-group">
        <h1>测试与验收</h1>
      </div>
    </header>

    <div class="testing-kpis-grid">
      <div class="kpi-card">
        <span class="kpi-label">验证通过率</span>
        <strong class="kpi-value">{{ passRate === null ? '—' : `${passRate}%` }}</strong>
        <span class="kpi-meta">{{ totalVerificationRuns ? `${passedRuns} / ${totalVerificationRuns} 项通过` : '尚无验证证据' }}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">待验收功能</span>
        <strong class="kpi-value">{{ pendingFeatures }}</strong>
        <span class="kpi-meta">{{ features.length }} 项</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">已验收交付</span>
        <strong class="kpi-value success-stat">{{ acceptedFeatures }}</strong>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">未解决问题</span>
        <strong class="kpi-value" :class="{ warn: totalIssues > 0 }">{{ totalIssues }}</strong>
        <span class="kpi-meta">{{ totalIssues ? `${totalIssues} 项待修复` : (totalVerificationRuns ? '无阻塞问题' : '尚未验证') }}</span>
      </div>
    </div>

    <div class="testing-tabs">
      <button
        type="button"
        class="tab-btn"
        :class="{ active: activeTab === 'acceptance' }"
        @click="activeTab = 'acceptance'"
      >
        验收清单 ({{ features.length }})
      </button>
      <button
        type="button"
        class="tab-btn"
        :class="{ active: activeTab === 'runs' }"
        @click="activeTab = 'runs'"
      >
        执行与测试记录 ({{ runsWithVerification.length }})
      </button>
    </div>

    <!-- Tab 1: Feature Acceptance Matrix -->
    <section v-if="activeTab === 'acceptance'" class="surface matrix-card">
      <div class="qa-table-head">
        <span>功能</span>
        <span>最新验证证据</span>
        <span>验收状态</span>
        <span>操作</span>
      </div>
      <div v-if="features.length" class="qa-table-body">
        <div
          v-for="feature in features"
          :key="feature.id"
          class="qa-table-row"
          role="button"
          tabindex="0"
          @click="emit('openFeature', feature)"
          @keydown.enter.self="emit('openFeature', feature)"
          @keydown.space.prevent.self="emit('openFeature', feature)"
        >
          <div class="cell-main">
            <span class="module-prefix">{{ moduleOf(feature.moduleId)?.name ?? '默认模块' }} /</span>
            <strong>{{ feature.name }}</strong>
          </div>
          <div class="cell-test">
            <template v-if="latestRunOf(feature.id)?.verificationSummary">
              <span
                class="test-badge"
                :class="{
                  pass: latestRunOf(feature.id)?.verificationSummary?.status === 'PASS',
                  fail: latestRunOf(feature.id)?.verificationSummary?.status === 'FAIL',
                }"
              >
                {{ evidenceLabel(latestRunOf(feature.id)) }}
              </span>
            </template>
            <span v-else class="test-empty">暂无核验记录</span>
          </div>
          <div class="cell-status">
            <span class="feature-status-pill" :data-status="feature.status">
              {{ featureStatusLabel(feature.status) }}
            </span>
          </div>
          <div class="cell-action">
            <button class="text-button" type="button" @click.stop="emit('openFeature', feature)">
              查看 →
            </button>
          </div>
        </div>
      </div>
      <div v-else class="compact-empty">
        暂无功能验收项
      </div>
    </section>

    <!-- Tab 2: Verification Runs & Logs -->
    <section v-else class="surface matrix-card">
      <div class="runs-table-head">
        <span>执行时间</span>
        <span>关联任务 / 功能</span>
        <span>执行者</span>
        <span>核验结论</span>
        <span>修改文件</span>
        <span>问题项</span>
      </div>
      <div v-if="runsWithVerification.length" class="runs-table-body">
        <div v-for="run in runsWithVerification" :key="run.id" class="runs-table-row">
          <div class="run-cell-time">
            <time>{{ formatTime(run.startedAt) }}</time>
          </div>
          <div class="run-cell-task">
            <strong>{{ props.detail.features.find(f => f.id === run.featureId)?.name ?? '未知功能' }}</strong>
            <small>{{ props.detail.tasks.find(t => t.id === run.taskId)?.name ?? run.taskId }}</small>
          </div>
          <div class="run-cell-actor">
            <span>{{ run.actorName }}</span>
            <small>{{ run.actorType }}</small>
          </div>
          <div class="run-cell-verdict">
            <span
              class="test-badge"
              :class="{
                pass: run.verificationSummary?.status === 'PASS',
                fail: run.verificationSummary?.status === 'FAIL',
              }"
            >
              {{ evidenceLabel(run) }}
            </span>
            <small>{{ run.verificationSummary?.summary }}</small>
          </div>
          <div class="run-cell-files">
            <span>{{ run.changedFiles.length }} 个文件</span>
          </div>
          <div class="run-cell-issues">
            <span v-if="run.issues.length" class="issue-badge">{{ run.issues.length }} 项异常</span>
            <span v-else class="clean-badge">0 阻塞</span>
          </div>
        </div>
      </div>
      <div v-else class="compact-empty">
        暂无测试执行记录
      </div>
    </section>
  </div>
</template>

<style scoped>
.testing-workspace {
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
.testing-kpis-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 20px;
}
.kpi-card {
  display: flex;
  flex-direction: column;
  padding: 12px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: all 0.15s ease;
}
.kpi-card:hover {
  border-color: var(--line-strong);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}
.kpi-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
}
.kpi-value {
  color: var(--ink);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
  margin: 3px 0 1px;
  letter-spacing: -0.02em;
}
.kpi-value.success-stat {
  color: #16a34a;
}
.kpi-value.warn {
  color: #dc2626;
}
.kpi-meta {
  color: var(--muted-light);
  font-size: 11.5px;
}

.testing-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 4px;
}
.tab-btn {
  padding: 8px 16px;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  font-size: 13.5px;
  font-weight: 500;
  border: 0;
  cursor: pointer;
  transition: all 0.15s ease;
}
.tab-btn:hover {
  color: var(--ink);
  background: var(--surface-subtle);
}
.tab-btn.active {
  color: var(--primary);
  background: var(--primary-subtle);
  font-weight: 600;
}

.matrix-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

/* Tab 1: QA Acceptance Table */
.qa-table-head {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(160px, 1fr) 100px 66px;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--line);
  color: var(--ink-secondary);
  font-size: 12.5px;
  font-weight: 600;
}
.qa-table-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(160px, 1fr) 100px 66px;
  align-items: center;
  gap: 16px;
  width: 100%;
  height: 52px;
  min-height: 52px;
  max-height: 52px;
  padding: 0 20px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--surface-subtle);
  text-align: left;
  transition: background 0.12s;
  cursor: pointer;
}
.qa-table-row:hover {
  background: var(--surface-subtle);
}
.cell-main {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.module-prefix {
  color: var(--muted-light);
  font-size: 12px;
}
.cell-main strong {
  color: var(--ink);
  font-size: 13.5px;
  font-weight: 600;
}
.code-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-subtle);
  border: 1px solid var(--line);
  color: var(--ink-secondary);
  font: 600 11px var(--mono);
}
.cell-count span {
  font-size: 12px;
  color: var(--muted);
}
.cell-test {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.test-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}
.test-badge.pass {
  background: #dcfce7;
  color: #15803d;
}
.test-badge.fail {
  background: #fee2e2;
  color: #b91c1c;
}
.test-note {
  color: var(--muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.test-empty {
  color: var(--muted-light);
  font-size: 12px;
}
.feature-status-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-secondary);
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
}
.feature-status-pill[data-status="DRAFT"] {
  background: var(--surface-subtle);
  color: var(--muted);
}
.feature-status-pill[data-status="DESIGNING"],
.feature-status-pill[data-status="READY"] {
  border-color: color-mix(in srgb, var(--primary) 30%, transparent);
  background: var(--primary-subtle);
  color: var(--primary);
}
.feature-status-pill[data-status="IMPLEMENTING"],
.feature-status-pill[data-status="VERIFYING"],
.feature-status-pill[data-status="ACCEPTANCE_PENDING"] {
  border-color: color-mix(in srgb, #d97706 25%, transparent);
  background: #fffbeb;
  color: #92400e;
}
.feature-status-pill[data-status="ACCEPTED"],
.feature-status-pill[data-status="DELIVERED"] {
  border-color: color-mix(in srgb, #16a34a 25%, transparent);
  background: #f0fdf4;
  color: #15803d;
}

.cell-action {
  text-align: right;
}
.cell-action button {
  font-size: 12.5px;
  padding: 4px 8px;
}

/* Tab 2: Runs & Logs Table */
.runs-table-head {
  display: grid;
  grid-template-columns: 140px minmax(180px, 1.4fr) 110px minmax(220px, 1.6fr) 90px 90px;
  align-items: center;
  gap: 16px;
  padding: 12px 20px;
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--line);
  color: var(--ink-secondary);
  font-size: 12.5px;
  font-weight: 600;
}
.runs-table-row {
  display: grid;
  grid-template-columns: 140px minmax(180px, 1.4fr) 110px minmax(220px, 1.6fr) 90px 90px;
  align-items: center;
  gap: 16px;
  width: 100%;
  height: 52px;
  min-height: 52px;
  max-height: 52px;
  padding: 0 20px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--surface-subtle);
  font-size: 13px;
  text-align: left;
}
.run-cell-time time {
  color: var(--muted);
  font-size: 12px;
  font-family: var(--mono);
}
.run-cell-task {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.run-cell-task strong {
  color: var(--ink);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-cell-task small {
  color: var(--muted-light);
  font-size: 11px;
}
.run-cell-actor {
  display: flex;
  flex-direction: column;
}
.run-cell-actor span {
  color: var(--ink-secondary);
  font-weight: 500;
  font-size: 12.5px;
}
.run-cell-actor small {
  color: var(--muted-light);
  font-size: 11px;
}
.run-cell-verdict {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.run-cell-verdict small {
  color: var(--muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.run-cell-files span {
  color: var(--muted);
  font-size: 12px;
}
.issue-badge {
  display: inline-flex;
  padding: 2px 6px;
  background: #fee2e2;
  color: #b91c1c;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 600;
}
.clean-badge {
  display: inline-flex;
  padding: 2px 6px;
  background: var(--surface-subtle);
  color: var(--muted);
  border-radius: 4px;
  font-size: 11.5px;
}
.testing-workspace { container: testing / inline-size; }
.runs-table-head, .runs-table-row { min-width: 930px; }
.matrix-card { overflow-x: auto; border-radius: 6px; }
.cell-main strong { overflow: hidden; text-overflow: ellipsis; }
.cell-main .module-prefix { flex-shrink: 0; }
@container testing (max-width: 740px) {
  .testing-kpis-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .qa-table-head, .qa-table-row { grid-template-columns: minmax(0, 1fr) 130px 76px; gap: 8px; padding-inline: 12px; }
  .qa-table-head > :last-child, .qa-table-row > :last-child, .module-prefix { display: none; }
  .testing-tabs { flex-wrap: wrap; gap: 4px; }
  .tab-btn { padding-inline: 10px; }
}
@container testing (max-width: 440px) {
  .qa-table-head, .qa-table-row { grid-template-columns: minmax(0, 1fr) 120px; }
  .qa-table-head > :nth-child(3), .qa-table-row > :nth-child(3) { display: none; }
}
</style>
