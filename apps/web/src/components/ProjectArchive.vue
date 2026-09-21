<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ArchiveDocument, ArchiveDocumentDetail, ArchiveDocumentInput, EngineeringAssetRevision, ProjectArchiveExport, WorkEvent, WorkEventInput, WorkEventPage, WorkEventReceipt, WorkEventType } from '@forgeflow/contracts';
import { api, ApiRequestError } from '../api-client';
import ArchiveMarkdown from './ArchiveMarkdown.vue';
import CaptureSettings from './CaptureSettings.vue';

const props = defineProps<{ projectId: string; initialTab?: 'documents' | 'records' }>();
const emit = defineEmits<{ changed: [] }>();
const view = ref<'documents' | 'records'>(props.initialTab ?? 'documents');
const documents = ref<ArchiveDocument[]>([]);
const document = ref<ArchiveDocumentDetail | null>(null);
const events = ref<WorkEvent[]>([]);
const nextCursor = ref<number | null>(null);
const loading = ref(false);
const detailLoading = ref(false);
const busy = ref(false);
const loadingMore = ref(false);
const error = ref('');
const notice = ref('');
const search = ref('');
const showReader = ref(false);
const showHistory = ref(false);
const historyLoading = ref(false);
const history = ref<EngineeringAssetRevision[]>([]);
const historical = ref<EngineeringAssetRevision | null>(null);
const raw = ref(false);
const editing = ref(false);
const draftTitle = ref('');
const draftContent = ref('');
const draftSummary = ref('');
const draftBase = ref('');
const conflict = ref(false);
const recordForm = ref(false);
const recordType = ref<WorkEventType>('NOTE');
const recordTitle = ref('');
const recordContent = ref('');
const recordWorkId = ref('');
const relatedDocumentId = ref('');
const expandedEvents = ref(new Set<string>());
const fileInput = ref<HTMLInputElement | null>(null);
type ImportItem = { file: File; state: 'ready' | 'saved' | 'failed'; message?: string };
const imports = ref<ImportItem[]>([]);
let projectEpoch = 0;
let detailRequest = 0;
let listRequest = 0;
let pendingEvent: WorkEventInput | null = null;
const eventPending = ref(false);
const labels: Record<WorkEventType, string> = { PLAN: '计划', PROGRESS: '进展', DESIGN: '设计', RESULT: '结果', NOTE: '笔记' };
const filteredDocuments = computed(() => documents.value.filter((item) => item.title.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const readContent = computed(() => historical.value?.contentMarkdown ?? document.value?.content ?? '');
const selectedIsText = computed(() => document.value?.contentType === 'text/plain');
const workChoices = computed(() => [...new Map(events.value.map((item) => [item.workId, item])).values()]);
const documentDirty = computed(() => editing.value && (
  draftTitle.value !== (document.value?.title ?? '') || draftContent.value !== (document.value?.content ?? '') || Boolean(draftSummary.value)
));
const recordDirty = computed(() => eventPending.value || Boolean(recordTitle.value || recordContent.value || recordWorkId.value || relatedDocumentId.value));
const hasUnsaved = computed(() => documentDirty.value || recordDirty.value || imports.value.some((item) => item.state === 'ready'));
const path = (projectId = props.projectId) => `/api/projects/${encodeURIComponent(projectId)}/archive`;
const message = (cause: unknown) => cause instanceof Error ? cause.message : '操作失败，请重试';
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const source = (event: WorkEvent) => event.source.kind === 'local_web' || event.source.kind === 'owner' ? '本地工作台' : event.source.name;

function cleanMessages() { error.value = ''; notice.value = ''; }
function canLeaveEditor() {
  return !documentDirty.value || window.confirm('放弃尚未保存的文档修改？取消可继续编辑或下载草稿。');
}
function canLeave() {
  if (busy.value) { error.value = '当前操作尚未结束，请完成后再离开。'; return false; }
  if (!hasUnsaved.value) return true;
  const details = [documentDirty.value && '文档修改', recordDirty.value && '工作记录', imports.value.some((item) => item.state === 'ready') && '待导入文件'].filter(Boolean).join('、');
  return window.confirm(`尚有未保存的${details}。确定放弃并离开？取消可保留当前内容并继续编辑。`);
}
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsaved.value) return;
  event.preventDefault();
  event.returnValue = '';
}
watch(hasUnsaved, (dirty) => {
  if (dirty) window.addEventListener('beforeunload', warnBeforeUnload);
  else window.removeEventListener('beforeunload', warnBeforeUnload);
}, { flush: 'sync' });
defineExpose({ canLeave });

async function load() {
  const epoch = projectEpoch;
  const request = ++listRequest;
  const projectId = props.projectId;
  loading.value = true;
  cleanMessages();
  try {
    const [docs, page] = await Promise.all([api<ArchiveDocument[]>(`${path(projectId)}/documents`), api<WorkEventPage>(`${path(projectId)}/events?limit=30`)]);
    if (epoch !== projectEpoch || request !== listRequest) return;
    documents.value = docs;
    events.value = page.items;
    nextCursor.value = page.nextCursor;
  } catch (cause) { if (epoch === projectEpoch && request === listRequest) error.value = message(cause); }
  finally { if (epoch === projectEpoch && request === listRequest) loading.value = false; }
}

async function selectDocument(id: string) {
  if (busy.value || !canLeaveEditor()) return;
  const epoch = projectEpoch;
  const request = ++detailRequest;
  editing.value = false;
  historical.value = null;
  showHistory.value = false;
  document.value = null;
  history.value = [];
  raw.value = false;
  showReader.value = true;
  detailLoading.value = true;
  cleanMessages();
  try {
    const result = await api<ArchiveDocumentDetail>(`${path()}/documents/${encodeURIComponent(id)}`);
    if (epoch === projectEpoch && request === detailRequest) document.value = result;
  } catch (cause) { if (epoch === projectEpoch && request === detailRequest) error.value = message(cause); }
  finally { if (epoch === projectEpoch && request === detailRequest) detailLoading.value = false; }
}

function startEdit() {
  if (!document.value || historical.value || busy.value) return;
  draftTitle.value = document.value.title;
  draftContent.value = document.value.content;
  draftSummary.value = '';
  draftBase.value = document.value.currentRevisionId;
  conflict.value = false;
  editing.value = true;
  showHistory.value = false;
  cleanMessages();
}

function createDocument() {
  if (busy.value || !canLeaveEditor()) return;
  ++detailRequest;
  document.value = null;
  detailLoading.value = false;
  historical.value = null;
  draftTitle.value = '';
  draftContent.value = '';
  draftSummary.value = '';
  draftBase.value = '';
  conflict.value = false;
  editing.value = true;
  showReader.value = true;
  showHistory.value = false;
  cleanMessages();
}

function updateDocumentList(item: ArchiveDocumentDetail) {
  documents.value = [item, ...documents.value.filter((doc) => doc.id !== item.id)];
}

async function saveDocument() {
  if (busy.value || conflict.value) return;
  const epoch = projectEpoch;
  const current = document.value;
  const input: ArchiveDocumentInput = {
    title: draftTitle.value, content: draftContent.value,
    originalFilename: current?.originalFilename ?? null, sourcePath: current?.sourcePath ?? null,
    contentType: current?.contentType ?? 'text/markdown', changeSummary: draftSummary.value || (current ? '编辑文档' : '创建文档'),
  };
  busy.value = true;
  cleanMessages();
  try {
    const saved = await api<ArchiveDocumentDetail>(`${path()}/documents${current ? `/${encodeURIComponent(current.id)}` : ''}`, {
      method: current ? 'PATCH' : 'POST', body: JSON.stringify(current ? { ...input, expectedRevisionId: draftBase.value } : input),
    });
    if (epoch !== projectEpoch) return;
    document.value = saved;
    updateDocumentList(saved);
    editing.value = false;
    historical.value = null;
    history.value = [];
    notice.value = '已保存';
    emit('changed');
  } catch (cause) {
    if (epoch !== projectEpoch) return;
    conflict.value = cause instanceof ApiRequestError && cause.status === 409;
    error.value = conflict.value ? '文档已有新版本。你的修改仍保留，请下载草稿后打开最新版本核对。' : message(cause);
  } finally { if (epoch === projectEpoch) busy.value = false; }
}

async function openHistory() {
  if (!document.value) return;
  showHistory.value = !showHistory.value;
  if (!showHistory.value) return;
  const epoch = projectEpoch;
  const id = document.value.id;
  historyLoading.value = true;
  try {
    const result = await api<EngineeringAssetRevision[]>(`${path()}/documents/${encodeURIComponent(id)}/revisions`);
    if (epoch === projectEpoch && document.value?.id === id) history.value = result;
  } catch (cause) { if (epoch === projectEpoch && document.value?.id === id) error.value = message(cause); }
  finally { if (epoch === projectEpoch && document.value?.id === id) historyLoading.value = false; }
}

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadDocument() {
  if (!document.value) return;
  download(readContent.value, document.value.originalFilename || `${document.value.title}${selectedIsText.value ? '.txt' : '.md'}`, `${document.value.contentType};charset=utf-8`);
}
function downloadDraft() { download(draftContent.value, `${draftTitle.value || '未命名'}-草稿.md`, 'text/markdown;charset=utf-8'); }

async function exportProject() {
  if (busy.value) return;
  const epoch = projectEpoch;
  busy.value = true;
  cleanMessages();
  try {
    const result = await api<ProjectArchiveExport>(`${path()}/export`);
    if (epoch !== projectEpoch) return;
    download(JSON.stringify(result, null, 2), `${result.project.project.name}-项目档案-${new Date().toISOString().slice(0, 10)}.json`, 'application/json;charset=utf-8');
    notice.value = '项目档案已导出';
  } catch (cause) { if (epoch === projectEpoch) error.value = message(cause); }
  finally { if (epoch === projectEpoch) busy.value = false; }
}

function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  imports.value = Array.from(input.files ?? []).map((file) => ({ file, state: 'ready' }));
  input.value = '';
  cleanMessages();
}

async function importFiles() {
  if (busy.value) return;
  const epoch = projectEpoch;
  const basePath = path();
  busy.value = true;
  cleanMessages();
  let saved = 0;
  try {
    for (const item of imports.value.filter((item) => item.state === 'ready')) {
      if (epoch !== projectEpoch) break;
      try {
        if (!/\.(md|markdown|txt)$/i.test(item.file.name)) throw new Error('仅支持 Markdown 或 TXT 文件');
        if (item.file.size > 2 * 1024 * 1024) throw new Error('文件超过 2 MB，请拆分后导入');
        const bytes = await item.file.arrayBuffer();
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        if (content.length > 500_000) throw new Error('正文超过 500,000 字符，请拆分后导入');
        if (epoch !== projectEpoch) break;
        const result = await api<ArchiveDocumentDetail>(`${basePath}/documents`, { method: 'POST', body: JSON.stringify({
          title: item.file.name.replace(/\.(md|markdown|txt)$/i, ''), content, originalFilename: item.file.name,
          contentType: /\.txt$/i.test(item.file.name) ? 'text/plain' : 'text/markdown', changeSummary: '导入原文档',
        } satisfies ArchiveDocumentInput) });
        if (epoch !== projectEpoch) break;
        item.state = 'saved';
        updateDocumentList(result);
        saved += 1;
      } catch (cause) {
        if (epoch !== projectEpoch) break;
        item.state = 'failed';
        item.message = cause instanceof TypeError ? '无法按 UTF-8 解码，请另存为 UTF-8 后重新选择' : message(cause);
      }
    }
    if (epoch === projectEpoch && saved) { notice.value = `已存档 ${saved} 份文档`; emit('changed'); }
  } finally { if (epoch === projectEpoch) busy.value = false; }
}

async function loadMore() {
  if (nextCursor.value === null || loadingMore.value) return;
  const epoch = projectEpoch;
  const request = listRequest;
  loadingMore.value = true;
  try {
    const page = await api<WorkEventPage>(`${path()}/events?limit=30&before=${nextCursor.value}`);
    if (epoch !== projectEpoch || request !== listRequest) return;
    const known = new Set(events.value.map((item) => item.id));
    events.value.push(...page.items.filter((item) => !known.has(item.id)));
    nextCursor.value = page.nextCursor;
  } catch (cause) { if (epoch === projectEpoch) error.value = message(cause); }
  finally { if (epoch === projectEpoch) loadingMore.value = false; }
}

async function submitRecord() {
  if (busy.value) return;
  const epoch = projectEpoch;
  if (!pendingEvent) pendingEvent = {
    operationId: crypto.randomUUID(), type: recordType.value, title: recordTitle.value, content: recordContent.value,
    ...(recordWorkId.value ? { workId: recordWorkId.value } : {}),
    documentRevisionIds: documents.value.filter((item) => item.id === relatedDocumentId.value).map((item) => item.currentRevisionId),
  };
  eventPending.value = true;
  busy.value = true;
  cleanMessages();
  try {
    const result = await api<WorkEventReceipt>(`${path()}/events`, { method: 'POST', body: JSON.stringify(pendingEvent) });
    if (epoch !== projectEpoch) return;
    events.value = [result.event, ...events.value.filter((item) => item.id !== result.event.id)];
    pendingEvent = null;
    eventPending.value = false;
    recordForm.value = false;
    recordTitle.value = '';
    recordContent.value = '';
    relatedDocumentId.value = '';
    recordWorkId.value = '';
    notice.value = result.replayed ? '已确认此前记录保存成功' : '已记录';
    emit('changed');
  } catch (cause) {
    if (epoch !== projectEpoch) return;
    if (cause instanceof ApiRequestError && cause.status >= 400 && cause.status < 500) { pendingEvent = null; eventPending.value = false; }
    error.value = message(cause);
  } finally { if (epoch === projectEpoch) busy.value = false; }
}

function toggleEvent(id: string) {
  const next = new Set(expandedEvents.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expandedEvents.value = next;
}

function backToDirectory() {
  if (!canLeaveEditor()) return;
  editing.value = false;
  showReader.value = false;
}

watch(() => props.projectId, () => {
  projectEpoch += 1;
  detailRequest += 1;
  documents.value = [];
  document.value = null;
  events.value = [];
  nextCursor.value = null;
  history.value = [];
  historical.value = null;
  editing.value = false;
  showReader.value = false;
  showHistory.value = false;
  detailLoading.value = false;
  historyLoading.value = false;
  busy.value = false;
  loadingMore.value = false;
  recordForm.value = false;
  pendingEvent = null;
  eventPending.value = false;
  recordTitle.value = '';
  recordContent.value = '';
  recordWorkId.value = '';
  relatedDocumentId.value = '';
  imports.value = [];
  search.value = '';
  expandedEvents.value = new Set();
  void load();
}, { immediate: true });
onBeforeUnmount(() => { projectEpoch += 1; detailRequest += 1; listRequest += 1; window.removeEventListener('beforeunload', warnBeforeUnload); });
</script>

<template>
  <section class="project-archive" aria-label="项目档案">
    <header class="archive-heading">
      <div><h1>{{ view === 'records' ? '工作记录' : '项目档案' }}</h1><span v-if="view === 'documents'" class="archive-count">{{ documents.length }} 份文档</span></div>
      <button type="button" :disabled="busy || loading" @click="exportProject">导出项目</button>
    </header>
    <div class="archive-tabs" role="tablist" aria-label="档案内容">
      <button id="archive-documents-tab" type="button" role="tab" :aria-selected="view === 'documents'" aria-controls="archive-documents" :class="{ active: view === 'documents' }" @click="view = 'documents'">文档</button>
      <button id="archive-records-tab" type="button" role="tab" :aria-selected="view === 'records'" aria-controls="archive-records" :class="{ active: view === 'records' }" @click="view = 'records'">工作记录</button>
      <button class="refresh" type="button" :disabled="loading || busy" @click="load">刷新</button>
    </div>
    <div v-if="error" class="archive-message error" role="alert">{{ error }}</div>
    <div v-if="notice" class="archive-message" role="status">{{ notice }}</div>
    <CaptureSettings v-if="view === 'records'" :key="projectId" :project-id="projectId" />
    <div v-if="loading" class="archive-empty" role="status">正在读取档案…</div>
    <template v-else>
      <div v-show="view === 'documents'" id="archive-documents" role="tabpanel" aria-labelledby="archive-documents-tab">
        <div v-if="imports.length" class="import-panel">
          <div class="import-heading"><strong>导入文档</strong><button type="button" :disabled="busy" @click="imports = []">关闭</button></div>
          <div v-for="(item, index) in imports" :key="index" class="import-row"><span>{{ item.file.name }}</span><small :class="{ failed: item.state === 'failed' }">{{ item.state === 'saved' ? '已存档' : item.state === 'failed' ? item.message : '待导入' }}</small></div>
          <div class="import-footer"><small>UTF-8 · Markdown / TXT · 每份最多 2 MB、500,000 字符</small><button class="primary" type="button" :disabled="busy || !imports.some(item => item.state === 'ready')" @click="importFiles">{{ busy ? '正在导入…' : '开始导入' }}</button></div>
          <p v-if="imports.some(item => item.state === 'failed')" class="import-warning">部分文件导入失败，请检查文件格式后重试。</p>
        </div>
        <div class="archive-layout" :class="{ 'reader-open': showReader }">
          <aside class="archive-directory" aria-label="文档目录">
            <div class="directory-toolbar"><input v-model="search" aria-label="查找文档" placeholder="查找文档" /><div><button type="button" :disabled="busy" @click="createDocument">新建</button><button type="button" :disabled="busy" @click="fileInput?.click()">导入</button></div></div>
            <input ref="fileInput" class="file-input" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple @change="chooseFiles" />
            <nav v-if="filteredDocuments.length"><button v-for="item in filteredDocuments" :key="item.id" type="button" :class="{ selected: document?.id === item.id }" :aria-current="document?.id === item.id ? 'page' : undefined" :title="item.title" :disabled="busy" @click="selectDocument(item.id)">{{ item.title }}</button></nav>
            <div v-else class="archive-empty compact">{{ search ? '没有匹配的文档' : '暂无文档' }}</div>
          </aside>
          <article class="archive-reader">
            <button class="directory-back" type="button" :disabled="busy" @click="backToDirectory">← 文档目录</button>
            <div v-if="detailLoading" class="archive-empty" role="status">正在读取文档…</div>
            <form v-else-if="editing" class="archive-editor" @submit.prevent="saveDocument">
              <label for="archive-title">标题</label><input id="archive-title" v-model="draftTitle" required maxlength="200" :disabled="busy" />
              <label for="archive-content">正文</label><textarea id="archive-content" v-model="draftContent" maxlength="500000" spellcheck="false" :disabled="busy" aria-label="文档原文"></textarea>
              <label for="archive-summary">修改摘要</label><input id="archive-summary" v-model="draftSummary" maxlength="500" :disabled="busy" />
              <div class="editor-actions"><button type="button" @click="downloadDraft">下载草稿</button><button v-if="conflict && document" type="button" :disabled="busy" @click="selectDocument(document.id)">打开最新版本</button><button type="button" :disabled="busy" @click="canLeaveEditor() && (editing = false)">取消</button><button class="primary" type="submit" :disabled="busy || conflict || !draftTitle.trim()">{{ busy ? '保存中…' : document ? '保存新版本' : '保存文档' }}</button></div>
            </form>
            <template v-else-if="document">
              <header class="reader-heading"><h2>{{ document.title }}</h2><div><button type="button" :aria-pressed="raw" @click="raw = !raw">{{ raw ? '阅读' : '原文' }}</button><button type="button" :aria-expanded="showHistory" @click="openHistory">历史</button><button type="button" @click="downloadDocument">下载</button><button v-if="!historical" type="button" @click="startEdit">编辑</button></div></header>
              <div v-if="historical" class="history-notice"><span>历史版本 · {{ time(historical.createdAt) }}</span><button type="button" @click="historical = null">返回当前</button></div>
              <div v-if="showHistory" class="history-list"><span v-if="historyLoading">正在读取历史…</span><button v-for="revision in history" :key="revision.id" type="button" :class="{ selected: (historical?.id ?? document.currentRevisionId) === revision.id }" @click="historical = revision.id === document.currentRevisionId ? null : revision"><span>{{ revision.changeSummary }}</span><small>{{ time(revision.createdAt) }}{{ revision.id === document.currentRevisionId ? ' · 当前' : '' }}</small></button></div>
              <div class="reader-meta"><span>{{ time(historical?.createdAt ?? document.updatedAt) }}</span><span v-if="document.sourcePath || document.originalFilename" :title="document.sourcePath || document.originalFilename || ''">{{ document.sourcePath || document.originalFilename }}</span></div>
              <pre v-if="raw || selectedIsText" class="raw-content">{{ readContent }}</pre><ArchiveMarkdown v-else-if="readContent" :content="readContent" /><div v-else class="archive-empty compact">空文档</div>
            </template>
            <div v-else class="archive-empty"><p>选择一份文档</p><button type="button" @click="createDocument">新建文档</button></div>
          </article>
        </div>
      </div>
      <div v-show="view === 'records'" id="archive-records" role="tabpanel" aria-labelledby="archive-records-tab" class="archive-records">
        <div class="records-toolbar"><span>{{ events.length }} 条已加载</span><button class="primary" type="button" :disabled="busy" @click="recordForm = !recordForm">{{ recordForm ? '收起' : '添加记录' }}</button></div>
        <form v-if="recordForm" class="record-form" @submit.prevent="submitRecord">
          <div class="record-fields"><label>类型<select v-model="recordType" :disabled="busy || eventPending"><option v-for="(label, type) in labels" :key="type" :value="type">{{ label }}</option></select></label><label>所属工作<select v-model="recordWorkId" :disabled="busy || eventPending"><option value="">新的一次工作</option><option v-for="work in workChoices" :key="work.workId" :value="work.workId">{{ work.title }}</option></select></label><label>关联文档<select v-model="relatedDocumentId" :disabled="busy || eventPending"><option value="">不关联</option><option v-for="item in documents" :key="item.id" :value="item.id">{{ item.title }}</option></select></label></div>
          <label for="record-title">标题</label><input id="record-title" v-model="recordTitle" required maxlength="200" :disabled="busy || eventPending" />
          <label for="record-content">正文</label><textarea id="record-content" v-model="recordContent" maxlength="100000" :disabled="busy || eventPending" spellcheck="false"></textarea>
          <div class="editor-actions"><button class="primary" type="submit" :disabled="busy || !recordTitle.trim()">{{ busy ? '保存中…' : eventPending ? '重试确认' : '保存记录' }}</button></div>
        </form>
        <div v-if="!events.length" class="archive-empty">暂无工作记录</div>
        <div v-else class="event-list"><article v-for="event in events" :key="event.id" class="event"><button class="event-summary" type="button" :aria-expanded="expandedEvents.has(event.id)" @click="toggleEvent(event.id)"><span class="event-kind">{{ labels[event.type] }}</span><strong>{{ event.title }}</strong><small>{{ source(event) }} · {{ time(event.occurredAt) }}</small><span aria-hidden="true">{{ expandedEvents.has(event.id) ? '−' : '+' }}</span></button><div v-if="expandedEvents.has(event.id)" class="event-content"><ArchiveMarkdown :content="event.content" /><div v-if="event.documentRevisionIds.length" class="event-links"><span>关联文档</span><template v-for="revisionId in event.documentRevisionIds" :key="revisionId"><button v-if="documents.some(item => item.currentRevisionId === revisionId)" type="button" @click="view = 'documents'; selectDocument(documents.find(item => item.currentRevisionId === revisionId)!.id)">{{ documents.find(item => item.currentRevisionId === revisionId)?.title }}</button><span v-else>历史文档版本</span></template></div></div></article></div>
        <button v-if="nextCursor !== null" class="load-more" type="button" :disabled="loadingMore" @click="loadMore">{{ loadingMore ? '读取中…' : '更早的记录' }}</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.project-archive { min-width: 0; color: var(--ink); container-type: inline-size; }
.project-archive button, .project-archive input, .project-archive select, .project-archive textarea { font: inherit; }
.project-archive button { border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: var(--ink-secondary); padding: 6px 10px; cursor: pointer; font-size: 13px; white-space: nowrap; }
.project-archive button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
.project-archive button:focus-visible, .project-archive input:focus-visible, .project-archive textarea:focus-visible, .project-archive select:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.project-archive button:disabled { opacity: .5; cursor: default; }
.project-archive button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-ink); }
.project-archive button.primary:hover:not(:disabled) { background: var(--primary-hover); }
.archive-heading, .archive-heading > div, .reader-heading, .reader-heading > div, .import-heading, .import-footer, .records-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.archive-heading { margin-bottom: 18px; }
.archive-heading h1 { font-size: 25px; margin: 0; letter-spacing: -.5px; }
.archive-count, .reader-meta, .records-toolbar > span { color: var(--muted); font-size: 12px; }
.archive-tabs { display: flex; border-bottom: 1px solid var(--line); gap: 20px; margin-bottom: 16px; }
.archive-tabs > button { border: 0; background: none; padding: 8px 2px 12px; border-radius: 0; }
.archive-tabs > button.active { color: var(--primary); border-bottom: 2px solid var(--primary); font-weight: 600; }
.archive-tabs > button.refresh { margin-left: auto; color: var(--muted); }
.archive-message { padding: 10px 12px; margin: 12px 0; color: var(--primary); background: var(--primary-subtle); border-radius: 5px; font-size: 13px; overflow-wrap: anywhere; }
.archive-message.error { color: var(--danger-ink); background: var(--danger-bg); }
.archive-layout { display: grid; grid-template-columns: minmax(170px, 230px) minmax(0, 1fr); border: 1px solid var(--line); border-radius: 7px; background: var(--surface); min-height: 440px; }
.archive-directory { border-right: 1px solid var(--line); min-width: 0; background: var(--surface-subtle); border-radius: 7px 0 0 7px; padding: 10px; }
.directory-toolbar > div { display: flex; gap: 6px; margin: 8px 0 12px; }
.project-archive input, .project-archive textarea, .project-archive select { width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 4px; padding: 8px; font-size: 13px; }
.archive-directory nav { display: flex; flex-direction: column; gap: 2px; }
.archive-directory nav button { width: 100%; border-color: transparent; text-align: left; overflow: hidden; text-overflow: ellipsis; padding: 9px 10px; background: transparent; }
.archive-directory nav button.selected { background: var(--primary-subtle); color: var(--primary); border-color: var(--primary-border); }
.file-input { display: none; }
.archive-reader { min-width: 0; padding: 24px; }
.reader-heading { align-items: start; flex-wrap: wrap; margin-bottom: 12px; }
.reader-heading h2 { font-size: 20px; margin: 0; overflow-wrap: anywhere; flex: 1 1 220px; }
.reader-heading > div { flex-wrap: wrap; gap: 6px; }
.reader-meta { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
.reader-meta span { max-width: 100%; overflow-wrap: anywhere; }
.raw-content { white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.8 var(--mono); margin: 0; color: var(--ink-secondary); }
.archive-empty { padding: 60px 16px; text-align: center; color: var(--muted); font-size: 14px; }
.archive-empty.compact { padding: 24px 8px; }
.archive-empty p { margin: 0 0 16px; }
.project-archive .directory-back { display: none; margin-bottom: 16px; }
.archive-editor, .record-form { display: flex; flex-direction: column; gap: 8px; }
.archive-editor label, .record-form label { color: var(--muted); font-size: 12px; }
.archive-editor textarea { min-height: 340px; resize: vertical; font: 13px/1.7 var(--mono); tab-size: 2; }
.editor-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: center; margin-top: 12px; }
.editor-actions small { margin-right: auto; color: var(--muted); font-size: 12px; }
.history-notice { display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--accent-subtle); color: var(--accent); padding: 8px; margin-bottom: 14px; font-size: 12px; }
.history-list { background: var(--surface-subtle); padding: 8px; border-radius: 5px; margin: 14px 0; display: flex; flex-direction: column; max-height: 230px; overflow-y: auto; gap: 5px; }
.history-list button { display: flex; flex-wrap: wrap; justify-content: space-between; text-align: left; white-space: normal; gap: 8px; border-color: transparent; }
.history-list button.selected { background: var(--primary-subtle); border-color: var(--primary-border); }
.history-list small { color: var(--muted); }
.import-panel { border: 1px solid var(--line); border-radius: 6px; padding: 14px; margin-bottom: 16px; background: var(--surface); }
.import-heading { font-size: 14px; margin-bottom: 12px; }
.import-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(80px, 1fr); gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--line-subtle); font-size: 13px; overflow-wrap: anywhere; }
.import-row small { text-align: right; color: var(--muted); }
.import-row small.failed { color: var(--danger-ink); }
.import-footer { margin-top: 12px; flex-wrap: wrap; }
.import-footer small, .import-warning { font-size: 12px; color: var(--muted); }
.import-warning { margin: 12px 0 0; }
.records-toolbar { padding: 0 0 16px; }
.record-form { padding: 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; margin-bottom: 20px; }
.record-fields { display: grid; grid-template-columns: 100px 1fr 1fr; gap: 12px; }
.record-fields label { display: flex; flex-direction: column; gap: 6px; }
.record-form textarea { min-height: 160px; resize: vertical; }
.event-list { border-top: 1px solid var(--line); }
.event { border-bottom: 1px solid var(--line); }
.event-summary { display: grid; grid-template-columns: 46px minmax(0, 1fr) auto 16px; gap: 12px; align-items: center; width: 100%; text-align: left; }
.project-archive button.event-summary { border: 0; background: transparent; padding: 16px 8px; }
.event-summary strong { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.event-kind { color: var(--primary); font-size: 12px; }
.event-summary small { color: var(--muted); font-size: 12px; }
.event-content { padding: 0 24px 20px 66px; min-width: 0; }
.event-links { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; margin-top: 20px; }
.load-more { display: block; margin: 20px auto 0; }
@container (max-width: 720px) {
  .archive-layout { grid-template-columns: 1fr; min-height: 330px; }
  .archive-directory { border-right: 0; border-radius: 7px; }
  .archive-layout:not(.reader-open) .archive-reader { display: none; }
  .archive-layout.reader-open .archive-directory { display: none; }
  .project-archive .directory-back { display: inline-block; }
  .archive-reader { padding: 16px; }
  .event-summary { grid-template-columns: 40px minmax(0, 1fr) 16px; gap: 8px; }
  .event-summary small { grid-column: 2; grid-row: 2; white-space: normal; }
  .event-summary > span:last-child { grid-column: 3; grid-row: 1; }
  .event-content { padding-left: 12px; padding-right: 12px; }
  .record-fields { grid-template-columns: 1fr; gap: 8px; }
  .archive-heading h1 { font-size: 22px; }
  .archive-heading > div { gap: 8px; flex-wrap: wrap; }
  .archive-count { font-size: 11px; }
  .archive-editor textarea { min-height: 260px; }
}
</style>
