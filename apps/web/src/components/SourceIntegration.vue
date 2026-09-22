<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ProjectSource, ProjectSourceKind, SourceAnalysis } from '@forgeflow/contracts';
import { api } from '../api-client';

const props = defineProps<{ projectId: string; sources: ProjectSource[]; analyses: SourceAnalysis[] }>();
const emit = defineEmits<{ refresh: []; notice: [message: string]; error: [message: string] }>();

type SourceDraft = {
  sourceId: string | null;
  alias: string;
  displayName: string;
  purpose: string;
  sourceKind: ProjectSourceKind;
  environmentKey: string;
  localRoot: string;
  remoteUrl: string;
  repoSubdir: string;
  includeText: string;
  excludeText: string;
  expectedUpdatedAt: string | null;
  idempotencyKey: string;
};

const defaultIncludes = 'README*\npackage.json\nsrc/**\ntests/**\nmigrations/**';
const defaultExcludes = 'node_modules/**\ndist/**\nbuild/**\n.cache/**\nlogs/**\n.env\nmodels/**\ndata/**';
const busy = ref(false);
const pickingFolder = ref(false);
const showSourceDialog = ref(false);
const showAnalysisDialog = ref(false);
const expandedSourceId = ref<string | null>(null);
const sourceDraft = ref<SourceDraft>(emptySource());
const analysisEnvironment = ref('');
const analysisSourceIds = ref<string[]>([]);
const analysisDescription = ref('当前项目架构和代码组织');
const selectedAnalysisId = ref<string | null>(props.analyses[0]?.id ?? null);
const createdAnalysis = ref<SourceAnalysis | null>(null);

const analyses = computed(() => createdAnalysis.value && !props.analyses.some((item) => item.id === createdAnalysis.value?.id)
  ? [createdAnalysis.value, ...props.analyses] : props.analyses);
const selectedAnalysis = computed(() => analyses.value.find((item) => item.id === selectedAnalysisId.value) ?? null);
const environmentKeys = computed(() => [...new Set(props.sources.flatMap((source) => source.locations.map((location) => location.environmentKey)))]);

watch(() => props.analyses, (value) => {
  if (!selectedAnalysisId.value && value[0]) selectedAnalysisId.value = value[0].id;
}, { deep: true });

function emptySource(): SourceDraft {
  return {
    sourceId: null, alias: '', displayName: '', purpose: '', sourceKind: 'GIT', environmentKey: 'flycode-pc', localRoot: '',
    remoteUrl: '', repoSubdir: '', includeText: defaultIncludes, excludeText: defaultExcludes,
    expectedUpdatedAt: null, idempotencyKey: crypto.randomUUID(),
  };
}
function lines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function addSource() { sourceDraft.value = emptySource(); showSourceDialog.value = true; }
function addEnvironment(source: ProjectSource) {
  sourceDraft.value = {
    sourceId: source.id, alias: source.alias, displayName: source.displayName, purpose: source.purpose,
    sourceKind: source.sourceKind, environmentKey: '', localRoot: '', remoteUrl: source.remoteUrl ?? '',
    repoSubdir: source.repoSubdir ?? '', includeText: source.scope.include.join('\n'), excludeText: source.scope.exclude.join('\n'),
    expectedUpdatedAt: source.updatedAt, idempotencyKey: crypto.randomUUID(),
  };
  showSourceDialog.value = true;
}
async function saveSource() {
  busy.value = true;
  try {
    const draft = sourceDraft.value;
    const base = `/api/projects/${props.projectId}/sources`;
    await api<ProjectSource>(draft.sourceId ? `${base}/${draft.sourceId}` : base, {
      method: draft.sourceId ? 'PATCH' : 'POST',
      body: JSON.stringify({
        alias: draft.alias, displayName: draft.displayName, purpose: draft.purpose, sourceKind: draft.sourceKind,
        environmentKey: draft.environmentKey, localRoot: draft.localRoot, remoteUrl: draft.remoteUrl || null,
        repoSubdir: draft.repoSubdir || null, scope: { include: lines(draft.includeText), exclude: lines(draft.excludeText) },
        expectedUpdatedAt: draft.expectedUpdatedAt, idempotencyKey: draft.idempotencyKey,
      }),
    });
    showSourceDialog.value = false;
    emit('notice', draft.sourceId ? '源码环境位置已登记。' : '源码位置已登记。');
    emit('refresh');
  } catch (error) { emit('error', error instanceof Error ? error.message : '保存源码位置失败'); }
  finally { busy.value = false; }
}
async function pickFolder() {
  pickingFolder.value = true;
  try {
    const res = await api<{ path: string | null }>('/api/system/select-directory', { method: 'POST' });
    if (res?.path) {
      sourceDraft.value.localRoot = res.path;
    }
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '调用系统文件夹选择失败');
  } finally {
    pickingFolder.value = false;
  }
}
const sourceToDelete = ref<ProjectSource | null>(null);

function confirmDeleteSource(source: ProjectSource) {
  sourceToDelete.value = source;
}

async function executeDeleteSource() {
  const source = sourceToDelete.value;
  if (!source) return;
  sourceToDelete.value = null;
  busy.value = true;
  try {
    await api(`/api/projects/${props.projectId}/sources/${source.id}`, { method: 'DELETE' });
    emit('notice', `源码「${source.displayName}」已移除`);
    emit('refresh');
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '删除源码失败');
  } finally {
    busy.value = false;
  }
}
function openAnalysis(sourceIds = props.sources.map((source) => source.id)) {
  analysisSourceIds.value = [...sourceIds];
  analysisEnvironment.value = environmentKeys.value[0] ?? '';
  analysisDescription.value = '当前项目架构和代码组织';
  showAnalysisDialog.value = true;
}
async function requestAnalysis() {
  busy.value = true;
  try {
    const analysis = await api<SourceAnalysis>(`/api/projects/${props.projectId}/source-analyses`, {
      method: 'POST', body: JSON.stringify({
        sourceIds: analysisSourceIds.value, environmentKey: analysisEnvironment.value,
        analysisScope: { description: analysisDescription.value }, prompt: '只读检查工程入口与代码组织，不修改业务源码。',
      }),
    });
    createdAnalysis.value = analysis;
    selectedAnalysisId.value = analysis.id;
    showAnalysisDialog.value = false;
    emit('notice', '分析请求已登记，等待外部 AI。');
    emit('refresh');
  } catch (error) { emit('error', error instanceof Error ? error.message : '创建分析请求失败'); }
  finally { busy.value = false; }
}
async function copyPrompt(kind: 'codex' | 'claude') {
  const analysis = selectedAnalysis.value; if (!analysis) return;
  try { await navigator.clipboard.writeText(analysis.prompts[kind]); emit('notice', `${kind === 'codex' ? 'Codex' : 'Claude Code'} 提示词已复制。`); }
  catch { emit('error', '浏览器未允许复制，请手动选择提示词。'); }
}
function analysisStatusName(status: SourceAnalysis['status']) {
  return ({ WAITING_AI: '等待 AI', READING: '读取中', PARTIAL: '部分完成', SYNCED: '已同步', FAILED: '失败', STALE: '已过期' })[status];
}
function latestAnalysis(sourceId: string) { return analyses.value.find((item) => item.sources.some((source) => source.id === sourceId)); }
function sourceStatus(source: ProjectSource) {
  const analysis = latestAnalysis(source.id);
  if (analysis?.status === 'SYNCED') return '已同步';
  if (analysis?.status === 'STALE') return '分析已过期';
  if (analysis?.status === 'WAITING_AI') return '等待 AI';
  if (analysis?.status === 'READING') return '读取中';
  if (analysis?.status === 'PARTIAL') return '部分完成';
  if (analysis?.status === 'FAILED') return '分析失败';
  if (source.locations.some((item) => item.accessibility === 'ACCESSIBLE')) return '可访问';
  if (source.locations.some((item) => item.accessibility === 'INACCESSIBLE')) return '不可访问';
  return '已登记';
}
function sourceTone(source: ProjectSource) {
  const status = sourceStatus(source);
  return status === '已同步' || status === '可访问' ? 'success'
    : status === '不可访问' || status === '分析失败' ? 'danger' : 'waiting';
}
function firstPath(source: ProjectSource) { return source.locations[0]?.localRoot ?? '未登记环境位置'; }
function formatTime(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function snapshotEntries(analysis: SourceAnalysis) { return Object.entries(analysis.sourceSnapshots ?? {}); }
function sourceAlias(sourceId: string) { return props.sources.find((source) => source.id === sourceId)?.alias ?? sourceId.slice(0, 8); }
function formatSnapshot(snapshot: unknown) { return JSON.stringify(snapshot, null, 2); }
</script>

<template>
  <section class="source-workspace">
    <header class="compact-page-heading">
      <div class="heading-title-group">
        <h1>源码与集成</h1>
        <span class="heading-badge">共 {{ sources.length }} 项源码</span>
      </div>
      <div class="source-actions">
        <button class="secondary-button" type="button" @click="addSource">＋ 添加源码</button>
        <button class="primary-button" type="button" :disabled="!sources.length" @click="openAnalysis()">请求 AI 分析</button>
      </div>
    </header>

    <div v-if="sources.length" class="source-table">
      <div class="source-table-head"><span>源码</span><span>位置</span><span>类型</span><span>状态</span><span>最近分析</span><span></span></div>
      <template v-for="source in sources" :key="source.id">
        <button class="source-row" type="button" @click="expandedSourceId = expandedSourceId === source.id ? null : source.id">
          <span class="source-name"><strong>{{ source.displayName }}</strong><small>{{ source.alias }}<template v-if="source.purpose"> · {{ source.purpose }}</template></small></span>
          <code>{{ firstPath(source) }}</code>
          <span>{{ source.sourceKind === 'GIT' ? 'Git' : '普通目录' }}</span>
          <span class="status-badge" :data-tone="sourceTone(source)">{{ sourceStatus(source) }}</span>
          <span>{{ formatTime(latestAnalysis(source.id)?.completedAt ?? latestAnalysis(source.id)?.requestedAt ?? null) }}</span>
          <b>{{ expandedSourceId === source.id ? '▾' : '›' }}</b>
        </button>
        <article v-if="expandedSourceId === source.id" class="source-detail">
          <dl>
            <div v-for="location in source.locations" :key="location.environmentKey"><dt>{{ location.environmentKey }}</dt><dd><code>{{ location.localRoot }}</code><small>{{ location.accessibility === 'ACCESSIBLE' ? '可访问' : location.accessibility === 'INACCESSIBLE' ? '不可访问' : '访问状态未知' }}</small></dd></div>
            <div v-if="source.remoteUrl"><dt>Git Remote</dt><dd>{{ source.remoteUrl }}</dd></div>
            <div v-if="source.repoSubdir"><dt>仓库子目录</dt><dd><code>{{ source.repoSubdir }}</code></dd></div>
            <div><dt>分析范围</dt><dd>{{ source.scope.include.length }} 项包含 · {{ source.scope.exclude.length }} 项排除</dd></div>
          </dl>
          <div class="source-item-actions">
            <button type="button" @click.stop="addEnvironment(source)">＋ 添加环境位置</button>
            <button type="button" @click.stop="openAnalysis([source.id])">请求分析</button>
            <button type="button" class="danger-btn" @click.stop="confirmDeleteSource(source)">删除源码</button>
          </div>
        </article>
      </template>
    </div>
    <div v-else class="source-empty"><p>还没有登记源码。</p><button class="primary-button" type="button" @click="addSource">＋ 添加源码</button></div>

    <section class="analysis-section">
      <header><h2>分析记录</h2><span>{{ analyses.length }}</span></header>
      <p v-if="!analyses.length" class="empty-line">暂无分析记录。</p>
      <div v-else class="analysis-table">
        <button v-for="analysis in analyses" :key="analysis.id" type="button" :class="{ active: selectedAnalysisId === analysis.id }" @click="selectedAnalysisId = selectedAnalysisId === analysis.id ? null : analysis.id">
          <strong>{{ analysis.displayId }}</strong><span>{{ analysis.sources.map((source) => source.alias).join(' · ') }}</span><span>{{ analysis.environmentKey }}</span>
          <b class="status-badge" :data-tone="analysis.status === 'SYNCED' ? 'success' : analysis.status === 'FAILED' ? 'danger' : 'waiting'">{{ analysisStatusName(analysis.status) }}</b>
          <time>{{ formatTime(analysis.requestedAt) }}</time><i>{{ selectedAnalysisId === analysis.id ? '▾' : '›' }}</i>
        </button>
      </div>
      <article v-if="selectedAnalysis" class="analysis-detail">
        <div><strong>{{ analysisStatusName(selectedAnalysis.status) }}</strong><span>{{ (selectedAnalysis.targetScope.analysisScope as { description?: string } | null)?.description || '当前项目架构和代码组织' }}</span></div>
        <p v-if="selectedAnalysis.summary" class="analysis-result-summary">{{ selectedAnalysis.summary }}</p>
        <div v-if="snapshotEntries(selectedAnalysis).length" class="analysis-findings">
          <details v-for="[sourceId, snapshot] in snapshotEntries(selectedAnalysis)" :key="sourceId">
            <summary>{{ sourceAlias(sourceId) }} · 源码快照与代码引用</summary>
            <pre>{{ formatSnapshot(snapshot) }}</pre>
          </details>
        </div>
        <div v-if="selectedAnalysis.status === 'WAITING_AI' || selectedAnalysis.status === 'READING'" class="prompt-actions"><button type="button" @click="copyPrompt('codex')">复制 Codex 提示词</button><button type="button" @click="copyPrompt('claude')">复制 Claude Code 提示词</button></div>
        <details><summary>查看请求提示词</summary><pre>{{ selectedAnalysis.prompts.codex }}</pre></details>
      </article>
    </section>

    <div v-if="showSourceDialog" class="source-dialog-backdrop" @click.self="showSourceDialog = false">
      <section class="source-dialog" role="dialog" aria-modal="true" aria-labelledby="source-dialog-title">
        <header><h2 id="source-dialog-title">{{ sourceDraft.sourceId ? '添加环境位置' : '添加源码' }}</h2><button type="button" aria-label="关闭" @click="showSourceDialog = false">×</button></header>
        <form @submit.prevent="saveSource">
          <div class="field-pair"><label>源码别名<input v-model="sourceDraft.alias" maxlength="40" required placeholder="backend" /></label><label>显示名称<input v-model="sourceDraft.displayName" maxlength="120" required placeholder="业务后端" /></label></div>
          <label>用途<input v-model="sourceDraft.purpose" maxlength="500" placeholder="业务 API 与数据处理" /></label>
          <div class="field-pair"><label>类型<select v-model="sourceDraft.sourceKind"><option value="GIT">Git 仓库</option><option value="DIRECTORY">普通目录</option></select></label><label>当前环境<input v-model="sourceDraft.environmentKey" maxlength="80" required placeholder="flycode-pc" /></label></div>
          <label>本地源码目录
            <div class="path-input-group">
              <input v-model="sourceDraft.localRoot" maxlength="1024" required placeholder="D:\Projects\video-api" />
              <button type="button" class="browse-button" :disabled="pickingFolder" @click="pickFolder">
                {{ pickingFolder ? '选择中…' : '选择文件夹' }}
              </button>
            </div>
          </label>
          <div class="field-pair"><label>Git Remote（可选）<input v-model="sourceDraft.remoteUrl" maxlength="2048" placeholder="https://..." /></label><label>仓库子目录（可选）<input v-model="sourceDraft.repoSubdir" maxlength="500" placeholder="apps/backend" /></label></div>
          <details class="scope-editor"><summary>分析范围</summary><div class="field-pair"><label>包含（每行一项）<textarea v-model="sourceDraft.includeText" spellcheck="false"></textarea></label><label>排除（每行一项）<textarea v-model="sourceDraft.excludeText" spellcheck="false"></textarea></label></div></details>
          <footer><button class="secondary-button" type="button" @click="showSourceDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">保存</button></footer>
        </form>
      </section>
    </div>

    <div v-if="showAnalysisDialog" class="source-dialog-backdrop" @click.self="showAnalysisDialog = false">
      <section class="source-dialog analysis-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-dialog-title">
        <header><h2 id="analysis-dialog-title">请求 AI 分析</h2><button type="button" aria-label="关闭" @click="showAnalysisDialog = false">×</button></header>
        <form @submit.prevent="requestAnalysis">
          <label>目标环境<select v-model="analysisEnvironment" required><option v-for="key in environmentKeys" :key="key" :value="key">{{ key }}</option></select></label>
          <fieldset><legend>选择源码</legend><label v-for="source in sources" :key="source.id" class="source-check"><input v-model="analysisSourceIds" type="checkbox" :value="source.id" /><span><code>{{ source.alias }}</code>{{ source.displayName }}</span></label></fieldset>
          <label>分析范围<textarea v-model="analysisDescription" maxlength="1000" required></textarea></label>
          <footer><button class="secondary-button" type="button" @click="showAnalysisDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy || !analysisSourceIds.length">创建请求</button></footer>
        </form>
      </section>
    </div>

    <!-- Confirm Delete Source Dialog -->
    <div v-if="sourceToDelete" class="source-dialog-backdrop" @click.self="sourceToDelete = null">
      <section class="source-dialog" style="width: min(480px, calc(100vw - 48px));" role="dialog" aria-modal="true" aria-labelledby="delete-source-title">
        <header>
          <h2 id="delete-source-title">移除源码</h2>
          <button type="button" aria-label="关闭" @click="sourceToDelete = null">×</button>
        </header>
        <div style="padding: 20px 22px;">
          <p style="margin: 0; font-size: 14px; line-height: 1.6; color: var(--ink-secondary);">
            确定要移除源码「<strong>{{ sourceToDelete.displayName }}</strong>」吗？此操作将清理该源码的登记与关联分析记录。
          </p>
        </div>
        <footer style="display: flex; justify-content: flex-end; gap: 10px; padding: 12px 22px 20px; border-top: 1px solid var(--line);">
          <button class="secondary-button" type="button" :disabled="busy" @click="sourceToDelete = null">取消</button>
          <button class="primary-button danger-submit-btn" type="button" :disabled="busy" @click="executeDeleteSource">确认移除</button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.source-workspace{display:grid;gap:20px;max-width:1440px;margin:0 auto;padding-bottom:40px}.source-heading{display:flex;min-height:48px;align-items:center;justify-content:space-between;gap:20px}.source-heading h1{margin:0;color:var(--ink);font-size:28px;line-height:1.2}.source-actions{display:flex;gap:9px}.help-button{min-height:36px;padding:0 10px;border:0;background:transparent;color:var(--muted);font-size:13px}.source-help{position:relative;padding:14px 42px 14px 16px;border:1px solid var(--line);background:#f8fafc}.source-help strong{font-size:14px}.source-help p{margin:5px 0 0;color:var(--muted);font-size:13px;line-height:1.55}.source-help button{position:absolute;top:8px;right:10px;border:0;background:transparent;color:var(--muted);font-size:20px}.source-table,.analysis-section{border:1px solid var(--line);background:#fff}.source-table-head,.source-row{display:grid;grid-template-columns:minmax(180px,1.15fr) minmax(250px,1.7fr) 110px 110px 170px 24px;align-items:center;gap:14px;padding:0 16px}.source-table-head{min-height:42px;border-bottom:1px solid var(--line);background:#f8fafc;color:var(--muted);font-size:13px;font-weight:700}.source-row{width:100%;height:52px;min-height:52px;max-height:52px;box-sizing:border-box;border:0;border-bottom:1px solid #e8ecef;background:#fff;color:var(--ink);font-size:14px;text-align:left}.source-row:hover{background:#f8fafc}.source-row>code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-row>b{text-align:right}.source-name{display:grid;gap:3px;min-width:0}.source-name strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}.source-name small{overflow:hidden;color:var(--muted);font-size:13px;text-overflow:ellipsis;white-space:nowrap}.status-badge{justify-self:start;display:inline-flex;min-height:26px;align-items:center;padding:0 8px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:13px;font-weight:700;white-space:nowrap}.status-badge[data-tone="success"]{background:#dcfce7;color:#15803d}.status-badge[data-tone="waiting"]{background:#fef3c7;color:#92400e}.status-badge[data-tone="danger"]{background:#fee2e2;color:#b91c1c}.source-detail{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;padding:14px 16px 16px 30px;border-bottom:1px solid var(--line);background:#f8fafc}.source-detail dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;margin:0}.source-detail dl>div{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px}.source-detail dt{color:var(--muted);font-size:13px}.source-detail dd{min-width:0;margin:0;font-size:14px;overflow-wrap:anywhere}.source-detail dd small{display:block;margin-top:3px;color:var(--muted);font-size:13px}.source-detail>div{display:flex;align-items:flex-start;gap:8px}.source-detail button,.prompt-actions button{min-height:34px;padding:0 10px;border:1px solid var(--line-strong);background:#fff;color:#0f172a;font-size:13px;border-radius:4px}.source-empty{display:flex;min-height:100px;align-items:center;justify-content:space-between;padding:20px;border:1px solid var(--line);background:#fff}.source-empty p,.empty-line{margin:0;color:var(--muted);font-size:14px}.analysis-section>header{display:flex;min-height:48px;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid var(--line)}.analysis-section h2{margin:0;font-size:20px}.analysis-section>header span{color:var(--muted);font-size:13px}.empty-line{padding:20px}.analysis-table>button{display:grid;width:100%;grid-template-columns:100px minmax(170px,1fr) 150px 120px 180px 20px;align-items:center;gap:12px;min-height:48px;padding:0 16px;border:0;border-bottom:1px solid #e8ecef;background:#fff;color:var(--ink);font-size:14px;text-align:left}.analysis-table>button:hover,.analysis-table>button.active{background:#f8fafc}.analysis-table time{color:var(--muted);font-size:13px}.analysis-table i{font-style:normal;text-align:right}.analysis-detail{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px 20px;padding:16px;border-top:1px solid var(--line);background:#f8fafc}.analysis-detail>div:first-child{display:grid;gap:4px}.analysis-detail>div:first-child strong{font-size:15px}.analysis-detail>div:first-child span{color:var(--muted);font-size:14px}.prompt-actions{display:flex;gap:8px}.analysis-detail details{grid-column:1/-1}.analysis-detail summary,.scope-editor summary{cursor:pointer;color:#334155;font-size:13px;font-weight:700}.analysis-detail pre{max-height:180px;margin:10px 0 0;overflow:auto;padding:12px;background:#0f172a;color:#e2e8f0;font:13px/1.55 var(--mono);white-space:pre-wrap;border-radius:6px}.source-dialog-backdrop{position:fixed;z-index:80;inset:0;display:grid;place-items:center;padding:24px;background:rgba(15,23,42,.45)}.source-dialog{display:grid;grid-template-rows:auto minmax(0,1fr);width:min(960px,calc(100vw - 48px));max-height:80vh;border:1px solid var(--line-strong);background:#fff;box-shadow:0 24px 80px rgba(12,24,28,.25);border-radius:8px}.source-dialog>header{display:flex;min-height:60px;align-items:center;justify-content:space-between;padding:0 22px;border-bottom:1px solid var(--line)}.source-dialog h2{margin:0;font-size:20px}.source-dialog>header button{border:0;background:transparent;color:var(--muted);font-size:24px}.source-dialog form{display:grid;gap:14px;min-height:0;overflow-y:auto;padding:20px 22px}.source-dialog label{display:grid;gap:6px;color:#334155;font-size:14px;font-weight:700}.source-dialog input,.source-dialog textarea,.source-dialog select{box-sizing:border-box;width:100%;min-height:40px;padding:8px 10px;border:1px solid var(--line-strong);background:#fff;color:var(--ink);font:14px/1.45 inherit;border-radius:6px}.source-dialog textarea{min-height:76px;resize:vertical}.source-dialog label small,.dialog-hint{color:var(--muted);font-size:13px;font-weight:400}.field-pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}.scope-editor{padding:12px;border:1px solid var(--line);border-radius:6px}.scope-editor .field-pair{margin-top:12px}.source-dialog footer{display:flex;justify-content:flex-end;gap:9px;padding-top:4px}.source-dialog fieldset{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;padding:12px;border:1px solid var(--line);border-radius:6px}.source-dialog legend{padding:0 6px;font-size:14px;font-weight:700}.source-check{display:flex!important;align-items:center;gap:9px!important;min-height:40px;padding:8px;background:#f8fafc;border-radius:6px}.source-check input{width:auto;min-height:auto}.source-check code{margin-right:8px;color:#2563eb}.dialog-hint{display:block}.analysis-dialog{width:min(760px,calc(100vw - 48px))}@media(max-width:1200px){.source-table-head,.source-row{grid-template-columns:minmax(170px,1fr) minmax(220px,1.4fr) 90px 105px 24px}.source-table-head span:nth-child(5),.source-row>span:nth-child(5){display:none}.source-detail{grid-template-columns:1fr}.analysis-table>button{grid-template-columns:90px minmax(150px,1fr) 125px 115px 20px}.analysis-table time{display:none}}@media(max-width:800px){.source-heading{align-items:flex-start;flex-direction:column}.source-table-head{display:none}.source-row{grid-template-columns:minmax(0,1fr) auto auto 20px;padding-block:10px}.source-row>code,.source-row>span:nth-child(3){display:none}.source-detail dl{grid-template-columns:1fr}.analysis-table>button{grid-template-columns:85px minmax(0,1fr) auto 20px}.analysis-table>button>span:nth-child(3){display:none}.field-pair,.source-dialog fieldset{grid-template-columns:1fr}.analysis-detail{grid-template-columns:1fr}.prompt-actions{justify-content:flex-start}}
.analysis-result-summary { grid-column: 1 / -1; margin: 0; padding: 11px 13px; border-left: 3px solid var(--primary); background: var(--primary-subtle); color: var(--ink-secondary); line-height: 1.55; }
.analysis-findings { grid-column: 1 / -1; display: grid; gap: 8px; }
.analysis-findings details { padding: 10px 12px; border: 1px solid var(--line); background: var(--surface); }
</style>
