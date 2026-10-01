<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { AiRun, Feature, FeatureStatus, ProjectDetail } from '@forgeflow/contracts';
import { currentLocalReviewVerdict, latestRun, runVerificationContext, runVerificationLabel, runVerificationTone } from '../evidence-status';
import { api } from '../api-client';

const props = defineProps<{ detail: ProjectDetail }>();
const emit = defineEmits<{ openFeature: [feature: Feature]; changed: [] }>();

const activeTab = ref<'acceptance' | 'runs'>('acceptance');
const reviewRunId = ref<string | null>(null);
const reviewDecision = ref<'PASS' | 'FAIL'>('PASS');
const reviewSummary = ref('');
const reviewEvidenceKind = ref<'SOURCE_FILE' | 'HTTPS_URL'>('SOURCE_FILE');
const reviewSourceId = ref('');
const reviewRelativePath = ref('');
const reviewUrl = ref('');
const reviewError = ref('');
const reviewNotice = ref('');
const reviewSaving = ref(false);
const selectedReviewRun = computed(() => props.detail.runs.find((run) => run.id === reviewRunId.value));

const features = computed(() => props.detail.features.slice().sort((a, b) => a.sortOrder - b.sortOrder));
const runsWithVerification = computed(() =>
  props.detail.runs
    .filter((run) => run.verificationSummary)
    .sort((a, b) => runTime(b) - runTime(a)),
);

function runTime(run: AiRun) {
  return new Date(run.finishedAt ?? run.submittedAt ?? run.createdAt).getTime();
}
const latestByTask = computed(() => {
  const grouped = new Map<string, AiRun[]>();
  for (const run of props.detail.runs) grouped.set(run.taskId, [...(grouped.get(run.taskId) ?? []), run]);
  return new Map([...grouped].flatMap(([taskId, runs]) => {
    const latest = latestRun(runs);
    return latest ? [[taskId, latest] as const] : [];
  }));
});
const currentChecks = computed(() => [...latestByTask.value.values()].filter((run) =>
  currentLocalReviewVerdict(run) !== null,
));
const totalVerificationRuns = computed(() => currentChecks.value.length);
const passedRuns = computed(() => currentChecks.value.filter((run) => currentLocalReviewVerdict(run) === 'PASS').length);
const passRate = computed(() =>
  totalVerificationRuns.value ? Math.round((passedRuns.value / totalVerificationRuns.value) * 100) : null,
);

const acceptedFeatures = computed(() =>
  features.value.filter((f) => f.status === 'ACCEPTED').length,
);

const pendingFeatures = computed(() =>
  features.value.filter((f) => f.status === 'ACCEPTANCE_PENDING').length,
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
  return latestRun(props.detail.runs.filter((run) => run.featureId === featureId));
}

function featureStatusLabel(status: FeatureStatus) {
  const map: Record<FeatureStatus, string> = {
    DRAFT: '草稿',
    DESIGNING: '设计中',
    READY: '待实施',
    IMPLEMENTING: '实施中',
    VERIFYING: '验证中',
    ACCEPTANCE_PENDING: '待验收',
    ACCEPTED: '已标记验收',
    DELIVERED: '交付标记（待核对）',
  };
  return map[status] ?? status;
}

function evidenceLabel(run: AiRun | undefined) { return run ? runVerificationLabel(run) : '未记录'; }
function evidenceContext(run: AiRun) {
  return runVerificationContext(run, latestByTask.value.get(run.taskId)?.id === run.id);
}
function verifiedTone(run: AiRun) {
  return latestByTask.value.get(run.taskId)?.id === run.id ? runVerificationTone(run) : '';
}

function canReview(run: AiRun) {
  return run.status === 'SUBMITTED' && run.designSnapshotStatus === 'CURRENT'
    && latestByTask.value.get(run.taskId)?.id === run.id
    && Boolean(run.verificationSummary) && !run.verificationSummary?.manualReview;
}
function reviewSources(run: AiRun) {
  const referencedIds = new Set(run.sourceExecutions.map((item) => item.sourceId));
  for (const file of run.changedFiles) if (typeof file !== 'string') referencedIds.add(file.sourceId);
  return props.detail.sources.filter((source) => referencedIds.has(source.id));
}
function startReview(run: AiRun) {
  reviewRunId.value = reviewRunId.value === run.id ? null : run.id;
  reviewDecision.value = run.verificationSummary?.reportedStatus === 'PASS' ? 'PASS' : 'FAIL';
  reviewSummary.value = '';
  reviewEvidenceKind.value = reviewSources(run).length ? 'SOURCE_FILE' : 'HTTPS_URL';
  reviewSourceId.value = reviewSources(run)[0]?.id ?? '';
  reviewRelativePath.value = '';
  reviewUrl.value = '';
  reviewError.value = '';
  reviewNotice.value = '';
  if (reviewRunId.value) void nextTick(() => document.getElementById('run-review-form')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}
async function submitReview(run: AiRun) {
  if (reviewSaving.value) return;
  reviewError.value = '';
  const evidenceRefs = reviewEvidenceKind.value === 'SOURCE_FILE'
    ? [{ kind: 'SOURCE_FILE' as const, sourceId: reviewSourceId.value, relativePath: reviewRelativePath.value.trim() }]
    : [{ kind: 'HTTPS_URL' as const, url: reviewUrl.value.trim() }];
  reviewSaving.value = true;
  try {
    await api(`/api/projects/${props.detail.project.id}/runs/${run.id}/manual-review`, {
      method: 'POST', body: JSON.stringify({ decision: reviewDecision.value, summary: reviewSummary.value.trim(), evidenceRefs }),
    });
    reviewRunId.value = null;
    reviewNotice.value = '本机复核已记录，正在刷新项目数据。';
    emit('changed');
  } catch (cause) {
    reviewError.value = cause instanceof Error ? cause.message : '保存复核失败';
  } finally { reviewSaving.value = false; }
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
        <span class="kpi-label">当前本机复核通过率</span>
        <strong class="kpi-value">{{ passRate === null ? '—' : `${passRate}%` }}</strong>
        <span class="kpi-meta">{{ totalVerificationRuns ? `${passedRuns} / ${totalVerificationRuns} 项任务通过` : '暂无当前设计的本机复核' }}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">待验收功能</span>
        <strong class="kpi-value">{{ pendingFeatures }}</strong>
        <span class="kpi-meta">{{ features.length }} 项</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">已标记验收功能</span>
        <strong class="kpi-value success-stat">{{ acceptedFeatures }}</strong>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">执行记录问题项</span>
        <strong class="kpi-value" :class="{ warn: totalIssues > 0 }">{{ totalIssues }}</strong>
        <span class="kpi-meta">{{ totalIssues ? '含历史记录，未判断是否解决' : '暂无问题记录' }}</span>
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
        <span>最近执行报告</span>
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
            <template v-if="latestRunOf(feature.id)">
              <span
                class="test-badge"
                :class="verifiedTone(latestRunOf(feature.id)!)"
                :title="latestRunOf(feature.id)?.verificationSummary?.summary"
              >
                {{ evidenceLabel(latestRunOf(feature.id)) }}
              </span>
              <small class="evidence-note">{{ evidenceContext(latestRunOf(feature.id)!) }}</small>
            </template>
            <span v-else class="test-empty">暂无执行记录</span>
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
    <template v-else>
      <p v-if="reviewNotice" class="review-notice" role="status">{{ reviewNotice }}</p>
      <form v-if="selectedReviewRun" id="run-review-form" class="review-form" @submit.prevent="submitReview(selectedReviewRun)">
        <p>本机操作复核当前设计与引用材料。原 AI 报告会保留，复核记录独立展示。</p>
        <label>复核结论<select v-model="reviewDecision"><option v-if="selectedReviewRun.verificationSummary?.reportedStatus === 'PASS'" value="PASS">通过</option><option value="FAIL">未通过</option></select></label>
        <p v-if="selectedReviewRun.verificationSummary?.reportedStatus !== 'PASS'" class="review-constraint">原执行报告未通过，本次只能记录“未通过”；要确认通过，请按当前设计重新执行。</p>
        <label class="review-wide">复核依据与结论<textarea v-model="reviewSummary" rows="2" maxlength="2000" required placeholder="写明实际核对的内容和结论" /></label>
        <label>证据类型<select v-model="reviewEvidenceKind"><option v-if="reviewSources(selectedReviewRun).length" value="SOURCE_FILE">项目源码文件</option><option value="HTTPS_URL">HTTPS 链接</option></select></label>
        <template v-if="reviewEvidenceKind === 'SOURCE_FILE'">
          <label>本次 Run 的 Source<select v-model="reviewSourceId" required><option v-for="source in reviewSources(selectedReviewRun)" :key="source.id" :value="source.id">{{ source.alias }}</option></select></label>
          <label class="review-wide">相对文件路径<input v-model="reviewRelativePath" required placeholder="src/module/file.ts" /></label>
        </template>
        <label v-else class="review-wide">证据链接<input v-model="reviewUrl" type="url" pattern="https://.*" required placeholder="https://example.com/evidence" /></label>
        <span v-if="reviewError" class="review-error" role="alert">{{ reviewError }}</span>
        <div class="review-actions"><button type="button" @click="reviewRunId = null">取消</button><button type="submit" :disabled="reviewSaving">{{ reviewSaving ? '保存中…' : '保存本机复核' }}</button></div>
      </form>
      <section class="surface matrix-card">
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
              :class="verifiedTone(run)"
            >
              {{ evidenceLabel(run) }}
            </span>
            <small :title="run.verificationSummary?.summary">{{ evidenceContext(run) }} · {{ run.verificationSummary?.summary }}</small>
            <small v-if="run.verificationSummary?.manualReview" class="review-summary" :title="run.verificationSummary.manualReview.summary">{{ run.verificationSummary.manualReview.recordedBy === 'IMPORTED' ? '导入记录（来源未核验）' : `本机复核记录（${run.verificationSummary.manualReview.recordedBy === 'LOCAL_WEB' ? '本机操作' : 'Owner 凭据'}）` }}：{{ run.verificationSummary.manualReview.summary }}</small>
            <button v-if="canReview(run)" type="button" class="review-action" @click="startReview(run)">{{ reviewRunId === run.id ? '取消复核' : '记录本机复核' }}</button>
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
    </template>
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
  min-height: 64px;
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
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  min-width: 0;
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
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.evidence-note { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; }
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
.feature-status-pill[data-status="ACCEPTED"] {
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
  min-height: 72px;
  padding: 10px 20px;
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
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  min-width: 0;
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
.review-action { padding: 2px 0; border: 0; background: transparent; color: var(--primary); font-size: 11.5px; font-weight: 600; cursor: pointer; }
.review-action:hover { text-decoration: underline; }
.review-notice { margin: 10px 20px; color: #047857; font-size: 12px; }
.review-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; margin-bottom: 12px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-subtle); }
.review-form p { grid-column: 1 / -1; margin: 0; color: var(--muted); font-size: 12px; }
.review-form p.review-constraint { color: #92400e; }
.review-form label { display: grid; gap: 5px; color: var(--ink-secondary); font-size: 12px; font-weight: 600; }
.review-form .review-wide, .review-error, .review-actions { grid-column: 1 / -1; }
.review-form input, .review-form select, .review-form textarea { width: 100%; min-width: 0; padding: 7px 9px; box-sizing: border-box; border: 1px solid var(--line-strong); border-radius: 5px; background: var(--surface); color: var(--ink); font: inherit; }
.review-form textarea { resize: vertical; }
.review-error { color: #b91c1c; font-size: 12px; }
.review-actions { display: flex; justify-content: flex-end; gap: 8px; }
.review-actions button { padding: 7px 12px; border: 1px solid var(--line-strong); border-radius: 5px; background: var(--surface); color: var(--ink-secondary); font-size: 12px; cursor: pointer; }
.review-actions button[type='submit'] { border-color: var(--primary); background: var(--primary); color: white; }
.review-actions button:disabled { opacity: 0.55; cursor: not-allowed; }
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
  .review-form { grid-template-columns: 1fr; }
  .review-form p, .review-form .review-wide, .review-error, .review-actions { grid-column: 1; }
}
</style>
