<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type {
  AiRun, AiScope, AiTokenSummary, ApiErrorResponse, CreatedAiToken, Feature, FeatureStatus, HealthResponse, Module, Project,
  ProjectDetail, SpecificationDetail, SpecificationRevision, SpecificationRevisionSummary,
  SpecificationSummary, Task, TaskAuthorization, TaskStatus, TaskType, RunPhase,
} from '@forgeflow/contracts';
import './app.css';

type WorkspacePage = 'projects' | 'overview' | 'requirements' | 'architecture' | 'technology'
  | 'features' | 'feature-detail' | 'development' | 'testing' | 'ai' | 'history' | 'document';
type DocumentPage = 'requirements' | 'architecture' | 'technology' | 'document';
type RevisionActivity = SpecificationRevisionSummary & { specification: SpecificationSummary };

class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options, credentials: 'same-origin',
    headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
  });
  if (response.status === 204) return undefined as T;
  const result: T | ApiErrorResponse = await response.json();
  if (!response.ok) {
    const problem = result as ApiErrorResponse;
    throw new ApiRequestError(response.status, problem.error?.message ?? `HTTP ${response.status}`);
  }
  return result as T;
}

const projects = ref<Project[]>([]);
const projectCardMeta = ref<Record<string, { updatedAt: string }>>({});
const projectDetail = ref<ProjectDetail | null>(null);
const specificationDetail = ref<SpecificationDetail | null>(null);
const revisions = ref<SpecificationRevisionSummary[]>([]);
const selectedRevision = ref<SpecificationRevision | null>(null);
const projectActivity = ref<RevisionActivity[]>([]);
const selectedProjectId = ref<string | null>(null);
const selectedSpecId = ref<string | null>(null);
const selectedFeature = ref<Feature | null>(null);
const featureTab = ref<'overview' | 'design' | 'plan' | 'history'>('overview');
const collapsedModules = ref(new Set<string>());
const expandedProgressFeatures = ref(new Set<string>());
const workspacePage = ref<WorkspacePage>('projects');
const documentMode = ref<'read' | 'edit'>('read');
const showProjectDialog = ref(false);
const showSpecDialog = ref(false);
const showModuleDialog = ref(false);
const showFeatureDialog = ref(false);
const showTaskDialog = ref(false);
const showRunSubmitDialog = ref(false);
const mobileNavOpen = ref(false);
const health = ref('连接中');
const error = ref('');
const notice = ref('');
const busy = ref(false);
const projectKey = ref('');
const projectName = ref('');
const specKind = ref('requirements');
const specTitle = ref('');
const editingModuleId = ref<string | null>(null);
const moduleCode = ref('');
const moduleName = ref('');
const moduleDescription = ref('');
const moduleSortOrder = ref(0);
const editingFeatureId = ref<string | null>(null);
const featureModuleId = ref('');
const featureCode = ref('');
const featureName = ref('');
const featureSummary = ref('');
const featureStatus = ref<FeatureStatus>('DRAFT');
const featureSortOrder = ref(0);
const editingTaskId = ref<string | null>(null);
const taskCode = ref('');
const taskName = ref('');
const taskType = ref<TaskType>('OTHER');
const taskStatus = ref<TaskStatus>('PLANNED');
const taskObjective = ref('');
const taskSortOrder = ref(0);
const selectedRun = ref<AiRun | null>(null);
const submittingRunId = ref<string | null>(null);
const runSummary = ref('');
const runResultCommit = ref('');
const runChangedFiles = ref('');
const runVerificationStatus = ref('PASS');
const runVerificationSummary = ref('');
const runIssues = ref('');
const returnPageAfterCreate = ref<DocumentPage>('requirements');
const draftContent = ref('');
const draftSummary = ref('');
const appView = ref<'loading' | 'workspace' | 'tokens'>('loading');
const tokens = ref<AiTokenSummary[]>([]);
const tokenName = ref('');
const tokenScopes = ref<AiScope[]>([]);
const revealedToken = ref('');

const scopeOptions: { value: AiScope; label: string }[] = [
  { value: 'project:read', label: '读取项目' },
  { value: 'spec:read', label: '读取设计资料' },
  { value: 'spec:write', label: '写入设计资料与版本' },
];
const kindNames: Record<string, string> = {
  requirements: '需求分析', architecture: '架构设计', technology: '技术栈',
  delivery: '交付与验证', other: '其他项目级资料', 'feature-design': '功能设计',
};
const featureStatuses: { value: FeatureStatus; label: string }[] = [
  { value: 'DRAFT', label: '草稿' }, { value: 'DESIGNING', label: '设计中' },
  { value: 'READY', label: '待实施' }, { value: 'IMPLEMENTING', label: '实施中' },
  { value: 'VERIFYING', label: '验证中' }, { value: 'ACCEPTANCE_PENDING', label: '待验收' },
  { value: 'ACCEPTED', label: '已验收' }, { value: 'DELIVERED', label: '已交付' },
];
const taskTypes: { value: TaskType; label: string }[] = [
  { value: 'DESIGN', label: '设计' }, { value: 'BACKEND', label: 'Backend' },
  { value: 'FRONTEND', label: 'Frontend' }, { value: 'INTEGRATION', label: '集成' },
  { value: 'VERIFICATION', label: '验证' }, { value: 'OTHER', label: '其他实施' },
];
const taskStatuses: { value: TaskStatus; label: string }[] = [
  { value: 'PLANNED', label: '待授权' }, { value: 'AUTHORIZED', label: '已授权' },
  { value: 'RUNNING', label: '进行中' }, { value: 'SUBMITTED', label: '已提交' },
  { value: 'CONFIRMED', label: '已确认' },
];
const pageConfigs: Record<DocumentPage, { title: string; kind?: string; description: string; empty: string }> = {
  requirements: { title: '需求分析', kind: 'requirements', description: '维护项目背景、目标、范围、核心需求、约束和未决问题。', empty: '当前还没有需求分析资料。' },
  architecture: { title: '架构设计', kind: 'architecture', description: '记录系统架构、模块边界、数据流、部署方式与关键决策。', empty: '当前还没有架构设计资料。' },
  technology: { title: '技术栈', kind: 'technology', description: '维护技术栈摘要、选型依据和详细技术说明。', empty: '当前还没有技术栈资料。' },
  document: { title: '项目级资料', description: '查看其他项目级设计资料及其版本。', empty: '当前没有可查看的项目级资料。' },
};
const navItems: { id: WorkspacePage; label: string; index?: string }[] = [
  { id: 'overview', label: '项目概览' },
  { id: 'requirements', label: '需求分析', index: '01' },
  { id: 'architecture', label: '架构设计', index: '02' },
  { id: 'technology', label: '技术栈', index: '03' },
  { id: 'features', label: '功能设计', index: '04' },
  { id: 'development', label: '开发进度', index: '05' },
  { id: 'testing', label: '测试与验收', index: '06' },
  { id: 'ai', label: 'AI 执行记录', index: '07' },
  { id: 'history', label: '版本与历史', index: '08' },
];

const currentProject = computed(() => projectDetail.value?.project ?? null);
const currentSpecification = computed(() => specificationDetail.value?.specification ?? null);
const currentRevision = computed(() => specificationDetail.value?.latestRevision ?? null);
const recentChanges = computed(() => projectActivity.value.slice(0, 8));
const isDocumentPage = computed(() => ['requirements', 'architecture', 'technology', 'document'].includes(workspacePage.value));
const activeDocumentPage = computed(() => (isDocumentPage.value ? workspacePage.value : 'document') as DocumentPage);
const activeDocumentConfig = computed(() => pageConfigs[activeDocumentPage.value]);
const latestProjectTime = computed(() => currentProject.value
  ? projectCardMeta.value[currentProject.value.id]?.updatedAt ?? currentProject.value.createdAt : null);
const otherMaterials = computed(() => projectDetail.value?.specifications.filter((item) =>
  item.featureId === null && !['requirements', 'architecture', 'technology'].includes(item.kind)) ?? []);
const selectedModule = computed(() => projectDetail.value?.modules.find((item) => item.id === selectedFeature.value?.moduleId) ?? null);
const featureSpecification = computed(() => projectDetail.value?.specifications.find((item) => item.featureId === selectedFeature.value?.id) ?? null);
const featureStatusCounts = computed(() => featureStatuses.map((status) => ({
  ...status, count: projectDetail.value?.features.filter((feature) => feature.status === status.value).length ?? 0,
})).filter((status) => status.count > 0));
const sortedRuns = computed(() => [...(projectDetail.value?.runs ?? [])].sort((a, b) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
const technologySummary = computed(() => {
  if (workspacePage.value !== 'technology' || !selectedRevision.value?.content) return [];
  const labels: Record<string, string> = {
    frontend: 'Frontend', '前端': 'Frontend', backend: 'Backend', '后端': 'Backend',
    database: 'Database', '数据库': 'Database', 'ai integration': 'AI Integration', 'ai 集成': 'AI Integration',
  };
  const values = new Map<string, string[]>(); let current: string | null = null;
  for (const line of selectedRevision.value.content.split(/\r?\n/)) {
    const heading = /^#{1,4}\s+(.+)$/.exec(line.trim());
    if (heading) { current = labels[heading[1].trim().toLowerCase()] ?? null; continue; }
    if (!current || !line.trim()) continue;
    const items = values.get(current) ?? [];
    if (items.length < 3) items.push(line.trim().replace(/^[-*]\s+/, ''));
    values.set(current, items);
  }
  return ['Frontend', 'Backend', 'Database', 'AI Integration']
    .flatMap((label) => values.get(label)?.length ? [{ label, value: values.get(label)!.join(' · ') }] : []);
});

function kindName(kind: string) { return kindNames[kind] ?? kind; }
function statusName(status: FeatureStatus) { return featureStatuses.find((item) => item.value === status)?.label ?? status; }
function featuresForModule(moduleId: string) { return projectDetail.value?.features.filter((item) => item.moduleId === moduleId) ?? []; }
function tasksForFeature(featureId: string) { return projectDetail.value?.tasks.filter((item) => item.featureId === featureId) ?? []; }
function taskTypeName(type: TaskType) { return taskTypes.find((item) => item.value === type)?.label ?? type; }
function taskStatusName(status: TaskStatus) { return taskStatuses.find((item) => item.value === status)?.label ?? status; }
function authorizationsForTask(taskId: string) { return projectDetail.value?.authorizations.filter((item) => item.taskId === taskId) ?? []; }
function activeAuthorization(taskId: string) { return authorizationsForTask(taskId).find((item) => item.status === 'ACTIVE') ?? null; }
function runsForTask(taskId: string) { return sortedRuns.value.filter((item) => item.taskId === taskId); }
function latestRun(taskId: string) { return runsForTask(taskId)[0] ?? null; }
function runNumber(run: AiRun) {
  const chronological = [...(projectDetail.value?.runs ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return `RUN-${String(chronological.findIndex((item) => item.id === run.id) + 1).padStart(3, '0')}`;
}
function runStatusName(status: AiRun['status']) { return ({ RUNNING: '执行中', SUBMITTED: '已提交', FAILED: '失败', ABORTED: '已中断' })[status]; }
function runPhaseName(phase: RunPhase) { return ({ PREPARING: '准备', IMPLEMENTING: '实施', TESTING: '验证', SUBMITTING: '提交' })[phase]; }
function featureDisplayName(featureId: string) { return projectDetail.value?.features.find((item) => item.id === featureId)?.name ?? '未知功能'; }
function taskNameById(taskId: string) { return projectDetail.value?.tasks.find((item) => item.id === taskId)?.name ?? '未知 Task'; }
function hasFeatureDesign(featureId: string) {
  return Boolean(projectDetail.value?.specifications.find((item) => item.featureId === featureId)?.latestRevisionNumber);
}
function taskProgress(featureId: string, types: TaskType[], emptyLabel: string) {
  const items = tasksForFeature(featureId).filter((item) => types.includes(item.type));
  if (!items.length) return emptyLabel;
  return `${items.filter((item) => item.status === 'CONFIRMED').length} / ${items.length}`;
}
function implementationProgress(featureId: string) {
  return taskProgress(featureId, ['BACKEND', 'FRONTEND', 'INTEGRATION', 'OTHER'], '未拆分');
}
function verificationProgress(featureId: string) { return taskProgress(featureId, ['VERIFICATION'], '—'); }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
function formatDate(value: string) { return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
function clearMessage() { error.value = ''; notice.value = ''; }
function showError(cause: unknown) { error.value = cause instanceof Error ? cause.message : '操作失败'; }
function sourceName(source: string) {
  if (source === 'owner:1' || source === 'local-web') return '本地工作台';
  if (source === 'api') return 'API';
  if (source.startsWith('ai-token:')) return 'AI Token';
  return source;
}
function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function inlineMarkdown(value: string) {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}
function renderMarkdown(markdown: string) {
  const output: string[] = []; let paragraph: string[] = []; let listType: 'ul' | 'ol' | null = null;
  let inCode = false; let code: string[] = [];
  const flush = () => { if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`); paragraph = []; };
  const closeList = () => { if (listType) output.push(`</${listType}>`); listType = null; };
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('```')) { flush(); closeList(); if (inCode) { output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; } inCode = !inCode; continue; }
    if (inCode) { code.push(line); continue; }
    const h = /^(#{1,4})\s+(.+)$/.exec(line); const ul = /^[-*]\s+(.+)$/.exec(line); const ol = /^\d+\.\s+(.+)$/.exec(line); const quote = /^>\s?(.+)$/.exec(line);
    if (h) { flush(); closeList(); output.push(`<h${h[1].length}>${inlineMarkdown(h[2])}</h${h[1].length}>`); continue; }
    if (ul || ol) { flush(); const next = ul ? 'ul' : 'ol'; if (listType !== next) { closeList(); listType = next; output.push(`<${next}>`); } output.push(`<li>${inlineMarkdown((ul ?? ol)![1])}</li>`); continue; }
    if (quote) { flush(); closeList(); output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); continue; }
    if (/^---+$/.test(line.trim())) { flush(); closeList(); output.push('<hr>'); continue; }
    if (!line.trim()) { flush(); closeList(); continue; }
    paragraph.push(line.trim());
  }
  if (inCode) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flush(); closeList(); return output.join('');
}

async function collectActivity(detail: ProjectDetail) {
  const histories = await Promise.all(detail.specifications.map(async (specification) => {
    const history = await api<SpecificationRevisionSummary[]>(`/api/projects/${detail.project.id}/specifications/${specification.id}/revisions`);
    return history.map((revision) => ({ ...revision, specification }));
  }));
  return histories.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
async function loadWorkspace() {
  projects.value = await api<Project[]>('/api/projects');
  const entries = await Promise.all(projects.value.map(async (project) => {
    try {
      const detail = await api<ProjectDetail>(`/api/projects/${project.id}`); const activity = await collectActivity(detail);
      const dates = [project.createdAt, ...detail.modules.map((item) => item.updatedAt), ...detail.features.map((item) => item.updatedAt), ...detail.tasks.map((item) => item.updatedAt), ...detail.runs.map((item) => item.updatedAt), ...detail.specifications.map((item) => item.createdAt), ...activity.map((item) => item.createdAt)];
      return [project.id, { updatedAt: dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]! }] as const;
    } catch { return [project.id, { updatedAt: project.createdAt }] as const; }
  }));
  projectCardMeta.value = Object.fromEntries(entries); workspacePage.value = 'projects'; selectedProjectId.value = null; projectDetail.value = null;
}
async function refreshCurrentProject() {
  const id = selectedProjectId.value; if (!id) return;
  projectDetail.value = await api<ProjectDetail>(`/api/projects/${id}`); projectActivity.value = await collectActivity(projectDetail.value);
  if (selectedFeature.value) selectedFeature.value = projectDetail.value.features.find((item) => item.id === selectedFeature.value?.id) ?? null;
  if (selectedRun.value) selectedRun.value = projectDetail.value.runs.find((item) => item.id === selectedRun.value?.id) ?? null;
  const dates = [projectDetail.value.project.createdAt, ...projectDetail.value.modules.map((item) => item.updatedAt), ...projectDetail.value.features.map((item) => item.updatedAt), ...projectDetail.value.tasks.map((item) => item.updatedAt), ...projectDetail.value.runs.map((item) => item.updatedAt), ...projectDetail.value.specifications.map((item) => item.createdAt), ...projectActivity.value.map((item) => item.createdAt)];
  projectCardMeta.value[id] = { updatedAt: dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0]! };
}
async function selectProject(id: string) {
  clearMessage(); busy.value = true; selectedProjectId.value = id; selectedSpecId.value = null;
  specificationDetail.value = null; selectedRevision.value = null; revisions.value = []; projectActivity.value = [];
  try { await refreshCurrentProject(); workspacePage.value = 'overview'; mobileNavOpen.value = false; }
  catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function loadSpecification(id: string) {
  const projectId = selectedProjectId.value; if (!projectId) return;
  const base = `/api/projects/${projectId}/specifications/${id}`;
  const [detail, history] = await Promise.all([api<SpecificationDetail>(base), api<SpecificationRevisionSummary[]>(`${base}/revisions`)]);
  selectedSpecId.value = id; specificationDetail.value = detail; revisions.value = history; selectedRevision.value = detail.latestRevision;
  draftContent.value = detail.latestRevision?.content ?? ''; draftSummary.value = '';
}
async function openDocumentPage(page: DocumentPage, preferredSpec?: SpecificationSummary) {
  clearMessage(); documentMode.value = 'read'; workspacePage.value = page; mobileNavOpen.value = false;
  const spec = preferredSpec ?? projectDetail.value?.specifications.find((item) => item.featureId === null && item.kind === pageConfigs[page].kind);
  if (!spec) { selectedSpecId.value = null; specificationDetail.value = null; revisions.value = []; selectedRevision.value = null; return; }
  busy.value = true;
  try { await loadSpecification(spec.id); } catch (cause) { showError(cause); } finally { busy.value = false; }
}
function showProjects() { clearMessage(); mobileNavOpen.value = false; void loadWorkspace().catch(showError); }
function navigate(page: WorkspacePage) {
  clearMessage(); mobileNavOpen.value = false;
  if (['requirements', 'architecture', 'technology'].includes(page)) { void openDocumentPage(page as DocumentPage); return; }
  workspacePage.value = page;
  if (page === 'ai' && !selectedRun.value) selectedRun.value = sortedRuns.value[0] ?? null;
}
function openOtherMaterial(spec: SpecificationSummary) {
  if (spec.featureId) {
    const feature = projectDetail.value?.features.find((item) => item.id === spec.featureId);
    if (feature) void openFeature(feature);
    return;
  }
  const page = spec.kind === 'requirements' ? 'requirements'
    : spec.kind === 'architecture' ? 'architecture'
      : spec.kind === 'technology' ? 'technology' : 'document';
  void openDocumentPage(page, spec);
}
function toggleModule(moduleId: string) {
  const next = new Set(collapsedModules.value);
  if (next.has(moduleId)) next.delete(moduleId); else next.add(moduleId);
  collapsedModules.value = next;
}
function toggleProgressFeature(featureId: string) {
  const next = new Set(expandedProgressFeatures.value);
  if (next.has(featureId)) next.delete(featureId); else next.add(featureId);
  expandedProgressFeatures.value = next;
}
function editModule(module?: Module) {
  editingModuleId.value = module?.id ?? null; moduleCode.value = module?.code ?? ''; moduleName.value = module?.name ?? '';
  moduleDescription.value = module?.description ?? ''; moduleSortOrder.value = module?.sortOrder ?? projectDetail.value?.modules.length ?? 0;
  showModuleDialog.value = true;
}
function editFeature(module: Module, feature?: Feature) {
  editingFeatureId.value = feature?.id ?? null; featureModuleId.value = feature?.moduleId ?? module.id;
  featureCode.value = feature?.code ?? ''; featureName.value = feature?.name ?? ''; featureSummary.value = feature?.summary ?? '';
  featureStatus.value = feature?.status ?? 'DRAFT'; featureSortOrder.value = feature?.sortOrder ?? featuresForModule(module.id).length;
  showFeatureDialog.value = true;
}
async function saveModule() {
  const projectId = selectedProjectId.value; if (!projectId) return;
  clearMessage(); busy.value = true;
  try {
    const body = JSON.stringify({ code: moduleCode.value, name: moduleName.value, description: moduleDescription.value, sortOrder: moduleSortOrder.value });
    const path = editingModuleId.value ? `/api/projects/${projectId}/modules/${editingModuleId.value}` : `/api/projects/${projectId}/modules`;
    await api<Module>(path, { method: editingModuleId.value ? 'PATCH' : 'POST', body });
    showModuleDialog.value = false; await refreshCurrentProject(); notice.value = editingModuleId.value ? '模块信息已更新' : '模块已创建';
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function saveFeature() {
  const projectId = selectedProjectId.value; if (!projectId) return;
  clearMessage(); busy.value = true;
  try {
    const body = JSON.stringify({ moduleId: featureModuleId.value, code: featureCode.value, name: featureName.value, summary: featureSummary.value, status: featureStatus.value, sortOrder: featureSortOrder.value });
    const path = editingFeatureId.value ? `/api/projects/${projectId}/features/${editingFeatureId.value}` : `/api/projects/${projectId}/features`;
    const saved = await api<Feature>(path, { method: editingFeatureId.value ? 'PATCH' : 'POST', body });
    showFeatureDialog.value = false; await refreshCurrentProject();
    if (selectedFeature.value?.id === saved.id) selectedFeature.value = saved;
    notice.value = editingFeatureId.value ? '功能信息已更新' : '功能已创建';
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
function editTask(task?: Task) {
  const feature = selectedFeature.value; if (!feature) return;
  editingTaskId.value = task?.id ?? null;
  taskCode.value = task?.code ?? `T${String(tasksForFeature(feature.id).length + 1).padStart(2, '0')}`;
  taskName.value = task?.name ?? '';
  taskType.value = task?.type ?? 'OTHER';
  taskStatus.value = task?.status ?? 'PLANNED';
  taskObjective.value = task?.objective ?? '';
  taskSortOrder.value = task?.sortOrder ?? tasksForFeature(feature.id).length;
  showTaskDialog.value = true;
}
async function saveTask() {
  const projectId = selectedProjectId.value; const feature = selectedFeature.value;
  if (!projectId || !feature) return;
  clearMessage(); busy.value = true;
  try {
    const body = JSON.stringify({ code: taskCode.value, name: taskName.value, type: taskType.value, status: taskStatus.value, objective: taskObjective.value, sortOrder: taskSortOrder.value });
    const base = `/api/projects/${projectId}/features/${feature.id}/tasks`;
    const path = editingTaskId.value ? `${base}/${editingTaskId.value}` : base;
    await api<Task>(path, { method: editingTaskId.value ? 'PATCH' : 'POST', body });
    showTaskDialog.value = false; await refreshCurrentProject();
    notice.value = editingTaskId.value ? '任务已更新' : '任务已创建';
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function taskAction<T>(action: () => Promise<T>, success: string) {
  clearMessage(); busy.value = true;
  try { await action(); await refreshCurrentProject(); notice.value = success; }
  catch (cause) { showError(cause); } finally { busy.value = false; }
}
function taskBase(task: Task) { return `/api/projects/${task.projectId}/features/${task.featureId}/tasks/${task.id}`; }
function prepareAuthorization(task: Task) {
  void taskAction(() => api<Task>(taskBase(task), { method: 'PATCH', body: JSON.stringify({ status: 'AUTHORIZED' }) }), 'Task 已进入待执行状态');
}
function approveTask(task: Task) {
  void taskAction(() => api<TaskAuthorization>(`${taskBase(task)}/authorizations`, { method: 'POST' }), '人工授权已生效');
}
function revokeTaskAuthorization(task: Task, authorization: TaskAuthorization) {
  void taskAction(() => api<TaskAuthorization>(`${taskBase(task)}/authorizations/${authorization.id}/revoke`, { method: 'POST' }), '授权已撤销');
}
function startManualRun(task: Task, authorization: TaskAuthorization) {
  void taskAction(() => api<AiRun>(`${taskBase(task)}/runs`, { method: 'POST', body: JSON.stringify({ authorizationId: authorization.id, actorName: 'manual-test', baseCommit: null }) }), '模拟 Run 已启动');
}
function advanceRun(run: AiRun) {
  const phases: RunPhase[] = ['PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING'];
  const next = phases[Math.min(phases.indexOf(run.phase) + 1, phases.length - 1)]!;
  void taskAction(() => api<AiRun>(`/api/projects/${run.projectId}/runs/${run.id}/phase`, { method: 'PATCH', body: JSON.stringify({ phase: next }) }), `Run 已进入${runPhaseName(next)}阶段`);
}
function openRunSubmit(run: AiRun) {
  submittingRunId.value = run.id; runSummary.value = ''; runResultCommit.value = ''; runChangedFiles.value = '';
  runVerificationStatus.value = 'PASS'; runVerificationSummary.value = ''; runIssues.value = ''; showRunSubmitDialog.value = true;
}
async function submitRun() {
  const projectId = selectedProjectId.value; const runId = submittingRunId.value; if (!projectId || !runId) return;
  await taskAction(() => api<AiRun>(`/api/projects/${projectId}/runs/${runId}/submit`, { method: 'POST', body: JSON.stringify({
    summary: runSummary.value, resultCommit: runResultCommit.value.trim() || null,
    changedFiles: runChangedFiles.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    verificationSummary: { status: runVerificationStatus.value, summary: runVerificationSummary.value },
    issues: runIssues.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
  }) }), 'Run 结果已提交，等待人工确认');
  if (!error.value) showRunSubmitDialog.value = false;
}
function finishRun(run: AiRun, status: 'fail' | 'abort') {
  const summary = status === 'fail' ? '开发验证标记为失败' : '人工中断本次 Run';
  void taskAction(() => api<AiRun>(`/api/projects/${run.projectId}/runs/${run.id}/${status}`, { method: 'POST', body: JSON.stringify({ summary, issues: [] }) }), status === 'fail' ? 'Run 已标记失败，需要重新授权' : 'Run 已中断，需要重新授权');
}
function confirmTask(task: Task) { void taskAction(() => api<Task>(`${taskBase(task)}/confirm`, { method: 'POST' }), 'Task 已人工确认完成'); }
function returnTask(task: Task) { void taskAction(() => api<Task>(`${taskBase(task)}/return`, { method: 'POST' }), 'Task 已退回，重新执行前需要再次授权'); }
async function openFeature(feature: Feature) {
  clearMessage(); selectedFeature.value = feature; workspacePage.value = 'feature-detail'; featureTab.value = 'overview'; documentMode.value = 'read'; mobileNavOpen.value = false;
  const spec = projectDetail.value?.specifications.find((item) => item.featureId === feature.id);
  if (!spec) { selectedSpecId.value = null; specificationDetail.value = null; revisions.value = []; selectedRevision.value = null; return; }
  busy.value = true;
  try { await loadSpecification(spec.id); } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function createFeatureDesign() {
  const projectId = selectedProjectId.value; const feature = selectedFeature.value; if (!projectId || !feature) return;
  clearMessage(); busy.value = true;
  try {
    let spec = featureSpecification.value;
    if (!spec) {
      spec = await api<SpecificationSummary>(`/api/projects/${projectId}/specifications`, { method: 'POST', body: JSON.stringify({ kind: 'feature-design', title: `${feature.name}功能设计`, featureId: feature.id }) });
      await refreshCurrentProject();
    }
    await loadSpecification(spec.id); featureTab.value = 'design'; startRevision();
    if (!currentRevision.value) {
      draftContent.value = `# 功能目标\n\n# 范围\n\n# 不包含范围\n\n# 功能明细\n\n## D-01 \n\n# 业务规则\n\n# 异常与边界\n\n# 依赖\n\n# 数据/API影响\n\n# 验收条件\n\n# 未决问题\n`;
    }
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
function prepareNewMaterial(page: DocumentPage) {
  const config = pageConfigs[page]; if (!config.kind) return;
  specKind.value = config.kind; specTitle.value = config.title; returnPageAfterCreate.value = page; showSpecDialog.value = true;
}
function startRevision() { if (currentSpecification.value) { draftContent.value = currentRevision.value?.content ?? ''; draftSummary.value = ''; documentMode.value = 'edit'; } }
function cancelRevision() { documentMode.value = 'read'; selectedRevision.value = currentRevision.value; }
async function selectHistory(revisionId: string) {
  const projectId = selectedProjectId.value; const specId = selectedSpecId.value; if (!projectId || !specId) return;
  clearMessage(); documentMode.value = 'read';
  try { selectedRevision.value = await api<SpecificationRevision>(`/api/projects/${projectId}/specifications/${specId}/revisions/${revisionId}`); }
  catch (cause) { showError(cause); }
}
async function createProject() {
  clearMessage(); busy.value = true;
  try {
    const project = await api<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ projectKey: projectKey.value, name: projectName.value }) });
    projectKey.value = ''; projectName.value = ''; showProjectDialog.value = false; await loadWorkspace(); await selectProject(project.id); notice.value = '项目已创建';
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function createSpecification() {
  const projectId = selectedProjectId.value; if (!projectId) return;
  clearMessage(); busy.value = true;
  try {
    const title = specTitle.value;
    const spec = await api<SpecificationSummary>(`/api/projects/${projectId}/specifications`, { method: 'POST', body: JSON.stringify({ kind: specKind.value, title }) });
    showSpecDialog.value = false; await refreshCurrentProject(); await openDocumentPage(returnPageAfterCreate.value, spec); documentMode.value = 'edit'; notice.value = `${title}已创建，请添加初版内容`;
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function createRevision() {
  const projectId = selectedProjectId.value; const specId = selectedSpecId.value; const detail = specificationDetail.value;
  if (!projectId || !specId || !detail) return;
  clearMessage(); busy.value = true;
  try {
    const revision = await api<SpecificationRevision>(`/api/projects/${projectId}/specifications/${specId}/revisions`, { method: 'POST', body: JSON.stringify({ content: draftContent.value, changeSummary: draftSummary.value, expectedHeadRevisionId: detail.specification.latestRevisionId }) });
    await refreshCurrentProject(); await loadSpecification(specId); documentMode.value = 'read'; notice.value = `Revision ${revision.revisionNo} 已保存`;
  } catch (cause) {
    if (cause instanceof ApiRequestError && cause.status === 409) {
      const content = draftContent.value; const summary = draftSummary.value; await loadSpecification(specId);
      draftContent.value = content; draftSummary.value = summary; documentMode.value = 'edit'; error.value = '最新版本已变化。草稿已保留，请对照最新内容后重新提交。';
    } else showError(cause);
  } finally { busy.value = false; }
}
async function openTokens() {
  clearMessage(); revealedToken.value = '';
  try { tokens.value = await api<AiTokenSummary[]>('/api/ai-tokens'); appView.value = 'tokens'; } catch (cause) { showError(cause); }
}
function closeTokens() { revealedToken.value = ''; appView.value = 'workspace'; clearMessage(); }
async function createToken() {
  clearMessage(); revealedToken.value = ''; busy.value = true;
  try {
    const created = await api<CreatedAiToken>('/api/ai-tokens', { method: 'POST', body: JSON.stringify({ name: tokenName.value, scopes: tokenScopes.value }) });
    revealedToken.value = created.token; tokenName.value = ''; tokenScopes.value = []; tokens.value = await api<AiTokenSummary[]>('/api/ai-tokens'); notice.value = 'Token 已创建。请立即复制，关闭此页后无法再查看。';
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function revokeToken(id: string) {
  clearMessage(); busy.value = true;
  try { await api(`/api/ai-tokens/${id}/revoke`, { method: 'POST' }); tokens.value = await api<AiTokenSummary[]>('/api/ai-tokens'); notice.value = 'Token 已撤销'; }
  catch (cause) { showError(cause); } finally { busy.value = false; }
}
onMounted(async () => {
  try {
    const status = await api<HealthResponse>('/api/health'); health.value = status.status === 'ok' && status.database === 'ok' ? '服务正常' : '服务异常';
    await loadWorkspace(); appView.value = 'workspace';
  } catch (cause) { health.value = '连接失败'; appView.value = 'workspace'; showError(cause); }
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <button class="brand" type="button" @click="showProjects"><span class="brand-mark">F</span><span class="brand-copy"><strong>ForgeFlow</strong><small>研发工作台</small></span></button>
      <button v-if="appView === 'workspace' && currentProject" class="project-switcher" type="button" @click="showProjects"><small>当前项目：</small><span>{{ currentProject.name }}</span><b>⌄</b></button>
      <div class="top-actions"><div class="health"><span class="health-dot" :class="{ offline: health !== '服务正常' }"></span>{{ health }}</div><button v-if="appView === 'workspace' && currentProject" class="top-link" @click="showProjects">返回项目列表</button><button v-if="appView === 'workspace'" class="top-link" @click="openTokens">Token 与设置</button><button v-if="appView === 'tokens'" class="top-link" @click="closeTokens">返回工作台</button></div>
    </header>
    <div v-if="error" class="message error" role="alert"><strong>操作未完成</strong><span>{{ error }}</span><button aria-label="关闭" @click="error = ''">×</button></div>
    <div v-if="notice" class="message success" role="status"><strong>已完成</strong><span>{{ notice }}</span><button aria-label="关闭" @click="notice = ''">×</button></div>
    <main v-if="appView === 'loading'" class="auth-main"><div class="loading-state"><span></span>正在连接 ForgeFlow…</div></main>

    <main v-if="appView === 'tokens'" class="settings-page">
      <div class="page-heading settings-heading"><div><p class="eyebrow">LOCAL / AI ACCESS</p><h1>Token 与设置</h1><p>为外部 AI Client 分配最小必要权限。Web 本地访问不需要登录。</p></div><button class="secondary-button" type="button" @click="closeTokens">← 返回工作台</button></div>
      <div class="settings-grid"><section class="surface settings-card"><div class="surface-heading"><div><span class="section-index">01</span><h2>创建 AI Token</h2></div></div><form class="form-stack" @submit.prevent="createToken"><label for="token-name">名称</label><input id="token-name" v-model="tokenName" maxlength="120" required /><span class="field-label">Scope</span><label v-for="scope in scopeOptions" :key="scope.value" class="scope-option"><input v-model="tokenScopes" type="checkbox" :value="scope.value" /><span>{{ scope.label }}</span><code>{{ scope.value }}</code></label><button class="primary-button" type="submit" :disabled="busy">创建 Token <span>→</span></button></form><div v-if="revealedToken" class="token-reveal"><strong>仅显示一次</strong><code>{{ revealedToken }}</code></div></section><section class="surface settings-card"><div class="surface-heading"><div><span class="section-index">02</span><h2>现有 Token</h2></div><span class="count-label">{{ tokens.length }}</span></div><div v-if="tokens.length"><div v-for="token in tokens" :key="token.id" class="token-row"><div><strong>{{ token.name }}</strong><small>{{ token.scopes.join(' · ') }}</small><small>创建于 {{ formatTime(token.createdAt) }}<template v-if="token.revokedAt"> · 已撤销</template></small></div><button v-if="!token.revokedAt" class="text-button danger" type="button" :disabled="busy" @click="revokeToken(token.id)">撤销</button></div></div><div v-else class="empty-state compact"><span>00</span><h3>尚未创建 Token</h3><p>Token 仅用于后续外部 AI 接入，不影响本地 Web 使用。</p></div></section></div>
    </main>

    <template v-if="appView === 'workspace'">
      <main v-if="workspacePage === 'projects'" class="project-home">
        <div class="project-home-heading"><div><p class="eyebrow">LOCAL WORKSPACE</p><h1>我的项目</h1><p>从项目进入需求、架构、技术栈、实施、测试与 AI 研发过程。</p></div><button class="primary-button" type="button" @click="showProjectDialog = true"><span>＋</span> 新建项目</button></div>
        <section v-if="projects.length" class="project-card-grid"><button v-for="project in projects" :key="project.id" class="project-card" type="button" @click="selectProject(project.id)"><div class="project-card-top"><span class="project-avatar">{{ project.name.slice(0, 1).toUpperCase() }}</span><code>{{ project.projectKey }}</code><b>→</b></div><h2>{{ project.name }}</h2><p>暂无项目描述</p><dl><div><dt>创建时间</dt><dd>{{ formatDate(project.createdAt) }}</dd></div><div><dt>最近更新</dt><dd>{{ formatTime(projectCardMeta[project.id]?.updatedAt ?? project.createdAt) }}</dd></div></dl></button></section>
        <section v-else class="surface empty-state project-empty"><span>00</span><h3>还没有项目</h3><p>创建第一个项目，开始组织真实的研发资料与过程。</p><button class="primary-button" type="button" @click="showProjectDialog = true"><span>＋</span> 新建项目</button></section>
      </main>

      <div v-else-if="currentProject && projectDetail" class="console-layout">
        <aside class="sidebar" :class="{ open: mobileNavOpen }"><nav class="primary-nav" aria-label="项目工作台"><button v-for="item in navItems" :key="item.id" class="nav-item" :class="{ active: workspacePage === item.id || (item.id === 'overview' && workspacePage === 'document') || (item.id === 'features' && workspacePage === 'feature-detail') }" type="button" @click="navigate(item.id)"><span class="nav-index">{{ item.index ?? '—' }}</span><span>{{ item.label }}</span></button></nav><div class="sidebar-footer"><span class="health-dot" :class="{ offline: health !== '服务正常' }"></span><div><strong>{{ health }}</strong><small>ForgeFlow Local</small></div></div></aside>
        <main class="main-workspace"><button class="mobile-nav-toggle" type="button" @click="mobileNavOpen = !mobileNavOpen">☰ 项目导航</button>
          <template v-if="workspacePage === 'overview'">
            <div class="compact-page-heading"><div><p class="eyebrow">{{ currentProject.projectKey }} / WORKSPACE</p><h1>项目概览</h1><p>{{ currentProject.name }}</p></div><div class="heading-meta"><span>创建于 {{ formatTime(currentProject.createdAt) }}</span><span>更新于 {{ latestProjectTime ? formatTime(latestProjectTime) : '—' }}</span></div></div>
            <div class="overview-workbench">
              <section class="surface project-structure-summary"><div class="surface-heading"><div><span class="section-index">01</span><h2>项目结构</h2></div><button class="text-button" type="button" @click="navigate('features')">查看功能设计 →</button></div><div class="metric-strip"><div><strong>{{ projectDetail.modules.length }}</strong><span>模块</span></div><div><strong>{{ projectDetail.features.length }}</strong><span>功能</span></div></div><div v-if="featureStatusCounts.length" class="status-distribution"><span v-for="status in featureStatusCounts" :key="status.value"><b>{{ status.count }}</b>{{ status.label }}</span></div><div v-else class="empty-inline"><span>尚未创建真实 Module / Feature</span></div></section>
              <section class="surface lifecycle-panel"><div class="surface-heading"><div><span class="section-index">02</span><h2>研发入口</h2></div><span class="surface-note">基于真实数据</span></div><div class="lifecycle-list"><button type="button" @click="navigate('requirements')"><span>01</span><strong>需求分析</strong><small>{{ projectDetail.specifications.find(item => item.featureId === null && item.kind === 'requirements')?.latestRevisionNumber ? `REV ${projectDetail.specifications.find(item => item.featureId === null && item.kind === 'requirements')?.latestRevisionNumber}` : '尚无资料' }}</small><b>→</b></button><button type="button" @click="navigate('architecture')"><span>02</span><strong>架构设计</strong><small>{{ projectDetail.specifications.find(item => item.featureId === null && item.kind === 'architecture')?.latestRevisionNumber ? `REV ${projectDetail.specifications.find(item => item.featureId === null && item.kind === 'architecture')?.latestRevisionNumber}` : '尚无资料' }}</small><b>→</b></button><button type="button" @click="navigate('technology')"><span>03</span><strong>技术栈</strong><small>{{ projectDetail.specifications.find(item => item.featureId === null && item.kind === 'technology')?.latestRevisionNumber ? `REV ${projectDetail.specifications.find(item => item.featureId === null && item.kind === 'technology')?.latestRevisionNumber}` : '尚无资料' }}</small><b>→</b></button><button type="button" @click="navigate('features')"><span>04</span><strong>功能设计</strong><small>{{ projectDetail.modules.length }} 个模块 · {{ projectDetail.features.length }} 个功能</small><b>→</b></button><button type="button" @click="navigate('development')"><span>05</span><strong>开发进度</strong><small>{{ projectDetail.features.length ? '查看真实功能状态' : '暂无功能数据' }}</small><b>→</b></button></div></section>
              <section class="surface work-status-panel"><div class="surface-heading"><div><span class="section-index">03</span><h2>当前工作</h2></div><span class="surface-note">{{ projectDetail.tasks.length }} 个 Task</span></div><div v-if="projectDetail.features.length" class="compact-feature-list"><button v-for="feature in projectDetail.features.slice(0, 5)" :key="feature.id" type="button" @click="openFeature(feature)"><span><strong>{{ feature.name }}</strong><small>{{ projectDetail.modules.find(item => item.id === feature.moduleId)?.name }} · 实施 {{ implementationProgress(feature.id) }}</small></span><span class="feature-status" :data-status="feature.status">{{ statusName(feature.status) }}</span></button></div><div v-else class="capability-empty"><span class="capability-mark">—</span><div><strong>暂无真实功能数据</strong><p>创建 Feature 与 Task 后，这里显示实际工作状态。</p></div></div></section>
              <section class="surface attention-surface"><div class="surface-heading"><div><span class="section-index">04</span><h2>需要我处理</h2></div><span class="surface-note">{{ projectDetail.tasks.filter(item => item.status === 'SUBMITTED').length }} 待确认</span></div><div v-if="projectDetail.tasks.some(item => item.status === 'SUBMITTED')" class="compact-feature-list"><button v-for="task in projectDetail.tasks.filter(item => item.status === 'SUBMITTED').slice(0, 4)" :key="task.id" type="button" @click="openFeature(projectDetail.features.find(item => item.id === task.featureId)!); featureTab = 'plan'"><span><strong>{{ task.name }}</strong><small>{{ featureDisplayName(task.featureId) }} · Run 已提交</small></span><span class="task-status" data-status="SUBMITTED">待确认</span></button></div><div v-else class="capability-empty"><span class="capability-mark">—</span><div><strong>当前没有待确认的 Run</strong><p>Review 与 Acceptance 能力仍尚未开放。</p></div></div></section>
              <section class="surface changes-surface"><div class="surface-heading"><div><span class="section-index">05</span><h2>最近变化</h2></div><span class="surface-note">真实 Revision</span></div><div v-if="recentChanges.length" class="activity-list"><button v-for="activity in recentChanges.slice(0, 5)" :key="activity.id" type="button" @click="openOtherMaterial(activity.specification)"><span class="activity-mark">R{{ activity.revisionNo }}</span><span><strong>{{ kindName(activity.specification.kind) }} · {{ activity.specification.title }}</strong><small>{{ activity.changeSummary }} · {{ formatTime(activity.createdAt) }}</small></span><b>→</b></button></div><div v-else class="empty-inline"><span>暂无真实版本变化</span></div></section>
              <section v-if="otherMaterials.length" class="surface other-materials"><div class="surface-heading"><div><span class="section-index">06</span><h2>其他项目级资料</h2></div></div><div class="material-links"><button v-for="spec in otherMaterials" :key="spec.id" type="button" @click="openOtherMaterial(spec)"><span>§</span><strong>{{ spec.title }}</strong><small>{{ spec.latestRevisionNumber ? `REV ${spec.latestRevisionNumber}` : '尚无版本' }}</small><b>→</b></button></div></section>
            </div>
          </template>

          <template v-if="isDocumentPage">
            <div class="compact-page-heading document-page-heading"><div><p class="eyebrow">{{ currentProject.projectKey }} / {{ activeDocumentPage.toUpperCase() }}</p><h1>{{ activeDocumentPage === 'document' && currentSpecification ? currentSpecification.title : activeDocumentConfig.title }}</h1><p>{{ activeDocumentConfig.description }}</p></div><div v-if="currentSpecification" class="document-actions"><button class="secondary-button" type="button" @click="documentMode = 'read'">查看历史版本</button><button class="primary-button" type="button" @click="startRevision">创建新版本</button></div></div>
            <section v-if="!currentSpecification" class="surface document-empty-state"><span class="empty-code">NO DOCUMENT</span><h2>{{ activeDocumentConfig.empty }}</h2><p>这里不会生成示例内容或虚假版本。</p><button v-if="activeDocumentConfig.kind" class="primary-button" type="button" @click="prepareNewMaterial(activeDocumentPage)"><span>＋</span> 创建{{ activeDocumentConfig.title }}</button></section>
            <div v-else-if="documentMode === 'read'" class="document-workbench"><article class="surface document-reader"><div class="document-statusbar"><div><span class="status-tag planning">草稿</span><strong>{{ selectedRevision ? `Revision ${selectedRevision.revisionNo}` : '尚无版本' }}</strong><span v-if="selectedRevision?.id === currentRevision?.id">当前版本</span><span v-else-if="selectedRevision">历史版本 · 只读</span></div><small v-if="selectedRevision">{{ sourceName(selectedRevision.source) }} · {{ formatTime(selectedRevision.createdAt) }}</small></div><section v-if="workspacePage === 'technology' && technologySummary.length" class="technology-summary"><div v-for="item in technologySummary" :key="item.label"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></div></section><div v-if="selectedRevision" class="markdown-body" v-html="renderMarkdown(selectedRevision.content)"></div><div v-else class="empty-state document-empty"><span>R0</span><h3>尚未创建初版</h3><p>创建新版本后，Markdown 正文会在这里以阅读模式展示。</p><button class="primary-button" type="button" @click="startRevision">创建初版</button></div></article><aside class="surface version-rail"><div class="surface-heading"><div><span class="section-index">REV</span><h2>版本历史</h2></div><span class="count-label">{{ revisions.length }}</span></div><div v-if="revisions.length" class="revision-list"><button v-for="revision in revisions" :key="revision.id" type="button" :class="{ active: selectedRevision?.id === revision.id }" @click="selectHistory(revision.id)"><span class="revision-number">R{{ revision.revisionNo }}</span><span><strong>{{ revision.changeSummary }}</strong><small>{{ formatTime(revision.createdAt) }}</small></span><b>{{ revision.id === currentRevision?.id ? '当前' : '→' }}</b></button></div><div v-else class="empty-state compact"><span>R0</span><h3>暂无版本</h3></div></aside></div>
            <div v-else class="revision-create-layout"><form class="surface revision-editor" @submit.prevent="createRevision"><div class="surface-heading"><div><span class="section-index">NEW</span><h2>创建新 Revision</h2></div><span class="surface-note">基于当前版本</span></div><div class="editor-fields"><label for="change-summary">变更摘要</label><input id="change-summary" v-model="draftSummary" maxlength="500" required placeholder="说明这次版本修改了什么" /><div class="field-row"><label for="markdown-content">Markdown 正文</label><span>{{ draftContent.length }} / 200000</span></div><textarea id="markdown-content" v-model="draftContent" maxlength="200000" required spellcheck="false"></textarea><div class="form-footer"><p>保存后形成不可变 Revision；历史版本保持只读。</p><div><button class="secondary-button" type="button" @click="cancelRevision">取消</button><button class="primary-button" type="submit" :disabled="busy">保存新 Revision <span>→</span></button></div></div></div></form><aside class="surface reference-panel"><div class="surface-heading"><div><span class="section-index">REF</span><h2>当前版本参考</h2></div></div><div class="reference-meta"><strong>{{ currentRevision ? `REV ${currentRevision.revisionNo}` : '尚无版本' }}</strong><span>{{ currentRevision?.changeSummary ?? '将创建初版' }}</span></div><pre>{{ currentRevision?.content ?? '当前没有可参考的版本正文。' }}</pre></aside></div>
          </template>

          <template v-if="workspacePage === 'features'">
            <div class="compact-page-heading"><div><p class="eyebrow">04 / FEATURE DESIGN</p><h1>功能设计</h1><p>按模块维护真实功能与版本化设计资料。</p></div><button class="primary-button" type="button" @click="editModule()"><span>＋</span> 新建模块</button></div>
            <section class="surface feature-tree">
              <div class="feature-tree-head"><span>模块 / 功能</span><span>编号</span><span>状态</span><span>排序</span><span>操作</span></div>
              <div v-for="module in projectDetail.modules" :key="module.id" class="module-group">
                <div class="module-row"><button class="tree-toggle" type="button" @click="toggleModule(module.id)">{{ collapsedModules.has(module.id) ? '▸' : '▾' }}</button><div><strong>{{ module.name }}</strong><small>{{ featuresForModule(module.id).length }} 个功能<span v-if="module.description"> · {{ module.description }}</span></small></div><code>{{ module.code }}</code><span>—</span><span>{{ module.sortOrder }}</span><div class="row-actions"><button type="button" @click="editFeature(module)">＋ 功能</button><button type="button" @click="editModule(module)">编辑</button></div></div>
                <div v-if="!collapsedModules.has(module.id)" class="module-features">
                  <div v-for="feature in featuresForModule(module.id)" :key="feature.id" class="feature-row" role="button" tabindex="0" @click="openFeature(feature)" @keydown.enter="openFeature(feature)"><span class="tree-branch">└</span><strong>{{ feature.name }}</strong><code>{{ feature.code }}</code><span class="feature-status" :data-status="feature.status">{{ statusName(feature.status) }}</span><span>{{ feature.sortOrder }}</span><span class="row-actions"><button type="button" @click.stop="editFeature(module, feature)">编辑</button><b>→</b></span></div>
                  <div v-if="!featuresForModule(module.id).length" class="tree-empty">该模块还没有功能。<button type="button" @click="editFeature(module)">新建第一个功能</button></div>
                </div>
              </div>
              <div v-if="!projectDetail.modules.length" class="progress-empty"><strong>还没有模块</strong><p>先创建一个模块，再在模块下添加功能。</p><button class="primary-button" type="button" @click="editModule()">＋ 新建模块</button></div>
            </section>
          </template>

          <template v-if="workspacePage === 'feature-detail' && selectedFeature">
            <div class="feature-detail-heading"><button class="back-link" type="button" @click="navigate('features')">← 功能设计</button><div class="compact-page-heading"><div><p class="eyebrow">{{ selectedModule?.code }} / {{ selectedFeature.code }}</p><h1>{{ selectedFeature.name }}</h1><p>{{ selectedFeature.summary || '暂无功能摘要' }}</p></div><span class="feature-status large" :data-status="selectedFeature.status">{{ statusName(selectedFeature.status) }}</span></div></div>
            <nav class="detail-tabs" aria-label="功能详情"><button :class="{ active: featureTab === 'overview' }" type="button" @click="featureTab = 'overview'; documentMode = 'read'">概览</button><button :class="{ active: featureTab === 'design' }" type="button" @click="featureTab = 'design'; documentMode = 'read'; selectedRevision = currentRevision">功能设计</button><button :class="{ active: featureTab === 'plan' }" type="button" @click="featureTab = 'plan'; documentMode = 'read'">实施计划</button><button :class="{ active: featureTab === 'history' }" type="button" @click="featureTab = 'history'; documentMode = 'read'">版本历史</button></nav>
            <section v-if="featureTab === 'overview'" class="feature-overview-grid"><div class="surface feature-facts"><div class="surface-heading"><div><span class="section-index">INFO</span><h2>功能信息</h2></div><button class="text-button" type="button" @click="selectedModule && editFeature(selectedModule, selectedFeature)">编辑</button></div><dl><div><dt>功能名称</dt><dd>{{ selectedFeature.name }}</dd></div><div><dt>编号</dt><dd><code>{{ selectedFeature.code }}</code></dd></div><div><dt>所属模块</dt><dd>{{ selectedModule?.name ?? '—' }}</dd></div><div><dt>状态</dt><dd>{{ statusName(selectedFeature.status) }}</dd></div><div><dt>摘要</dt><dd>{{ selectedFeature.summary || '—' }}</dd></div><div><dt>创建时间</dt><dd>{{ formatTime(selectedFeature.createdAt) }}</dd></div><div><dt>更新时间</dt><dd>{{ formatTime(selectedFeature.updatedAt) }}</dd></div></dl></div><div class="surface design-status"><div class="surface-heading"><div><span class="section-index">DESIGN</span><h2>设计状态</h2></div></div><template v-if="currentRevision"><strong class="current-design">REV {{ currentRevision.revisionNo }}</strong><span>最近修改：{{ formatTime(currentRevision.createdAt) }}</span><button class="primary-button" type="button" @click="featureTab = 'design'; documentMode = 'read'">查看当前设计 →</button></template><template v-else><strong>尚未创建功能设计</strong><p>设计正文将复用统一的 Specification / Revision 版本机制。</p><button class="primary-button" type="button" @click="createFeatureDesign">创建第一版设计</button></template></div></section>
            <template v-if="featureTab === 'design'">
              <div class="feature-design-actions"><div><span>当前设计</span><strong>{{ currentRevision ? `REV ${currentRevision.revisionNo}` : '尚无版本' }}</strong></div><button class="primary-button" type="button" @click="createFeatureDesign">{{ currentRevision ? '创建新版本' : '创建第一版设计' }}</button></div>
              <article v-if="documentMode === 'read'" class="surface feature-design-reader"><div v-if="selectedRevision" class="document-statusbar"><div><span class="status-tag planning">{{ selectedRevision.id === currentRevision?.id ? '当前版本' : '历史版本 · 只读' }}</span><strong>Revision {{ selectedRevision.revisionNo }}</strong></div><small>{{ formatTime(selectedRevision.createdAt) }}</small></div><div v-if="selectedRevision" class="markdown-body" v-html="renderMarkdown(selectedRevision.content)"></div><div v-else class="empty-state document-empty"><span>R0</span><h3>尚未创建功能设计</h3><p>创建首个 Revision 后会默认以阅读模式展示。</p></div></article>
              <div v-else class="revision-create-layout"><form class="surface revision-editor" @submit.prevent="createRevision"><div class="surface-heading"><div><span class="section-index">NEW</span><h2>创建功能设计 Revision</h2></div><span class="surface-note">历史版本不可覆盖</span></div><div class="editor-fields"><label for="feature-change-summary">变更摘要</label><input id="feature-change-summary" v-model="draftSummary" maxlength="500" required /><div class="field-row"><label for="feature-markdown-content">Markdown 正文</label><span>{{ draftContent.length }} / 200000</span></div><textarea id="feature-markdown-content" v-model="draftContent" maxlength="200000" required spellcheck="false"></textarea><div class="form-footer"><p>保存时提交 expectedHeadRevisionId，并形成不可变新版本。</p><div><button class="secondary-button" type="button" @click="cancelRevision">取消</button><button class="primary-button" type="submit" :disabled="busy">保存新 Revision →</button></div></div></div></form><aside class="surface reference-panel"><div class="surface-heading"><div><span class="section-index">REF</span><h2>当前版本参考</h2></div></div><pre>{{ currentRevision?.content ?? '当前没有可参考的版本正文。' }}</pre></aside></div>
            </template>
            <section v-if="featureTab === 'plan'" class="surface task-plan">
              <div class="surface-heading"><div><span class="section-index">TASK</span><h2>实施计划</h2></div><button class="primary-button" type="button" @click="editTask()">＋ 新建 Task</button></div>
              <div class="task-list-head"><span>排序 / 编号</span><span>任务</span><span>类型</span><span>状态</span><span>操作</span></div>
              <div v-if="tasksForFeature(selectedFeature.id).length" class="task-list execution-list">
                <article v-for="task in tasksForFeature(selectedFeature.id)" :key="task.id" class="task-entry">
                  <div class="task-row execution-row">
                    <span><b>{{ String(task.sortOrder).padStart(2, '0') }}</b><code>{{ task.code }}</code></span>
                    <span><strong>{{ task.name }}</strong><small>{{ task.objective || '未填写任务目标' }}</small></span>
                    <span>{{ taskTypeName(task.type) }}</span>
                    <span class="task-status" :data-status="task.status">{{ taskStatusName(task.status) }}<small>{{ task.status }}</small></span>
                    <button class="text-button" type="button" @click="editTask(task)">编辑</button>
                  </div>
                  <div class="execution-control">
                    <template v-if="task.status === 'PLANNED'">
                      <p><strong>等待人工授权</strong><span>批准前不能启动 Run。</span></p>
                      <button class="secondary-button" type="button" :disabled="busy" @click="prepareAuthorization(task)">设为待执行</button>
                    </template>
                    <template v-else-if="task.status === 'AUTHORIZED' && !activeAuthorization(task.id)">
                      <p><strong>尚无有效授权</strong><span>历史失败、撤销或退回不会自动生成新授权。</span></p>
                      <button class="primary-button" type="button" :disabled="busy" @click="approveTask(task)">批准执行</button>
                    </template>
                    <template v-else-if="task.status === 'AUTHORIZED' && activeAuthorization(task.id)">
                      <p><strong class="authorization-active">授权 ACTIVE</strong><span>{{ formatTime(activeAuthorization(task.id)!.authorizedAt) }}</span></p>
                      <div class="inline-actions"><button class="secondary-button dev-action" type="button" :disabled="busy" @click="startManualRun(task, activeAuthorization(task.id)!)">开始模拟 Run（验证）</button><button class="danger-text" type="button" :disabled="busy" @click="revokeTaskAuthorization(task, activeAuthorization(task.id)!)">撤销授权</button></div>
                    </template>
                    <template v-else-if="task.status === 'RUNNING' && latestRun(task.id)">
                      <p><strong>{{ runNumber(latestRun(task.id)!) }} · {{ runPhaseName(latestRun(task.id)!.phase) }}</strong><span>执行者 {{ latestRun(task.id)!.actorName }} · {{ latestRun(task.id)!.actorType }}</span></p>
                      <div class="inline-actions"><button v-if="latestRun(task.id)!.phase !== 'SUBMITTING'" class="secondary-button" type="button" :disabled="busy" @click="advanceRun(latestRun(task.id)!)">推进阶段</button><button class="primary-button" type="button" :disabled="busy" @click="openRunSubmit(latestRun(task.id)!)">提交结果</button><button class="danger-text" type="button" :disabled="busy" @click="finishRun(latestRun(task.id)!, 'fail')">标记失败</button><button class="text-button" type="button" :disabled="busy" @click="finishRun(latestRun(task.id)!, 'abort')">中断</button></div>
                    </template>
                    <template v-else-if="task.status === 'SUBMITTED' && latestRun(task.id)">
                      <p><strong>{{ runNumber(latestRun(task.id)!) }} 已提交</strong><span>{{ latestRun(task.id)!.summary }} · 修改文件 {{ latestRun(task.id)!.changedFiles.length }} · 验证 {{ latestRun(task.id)!.verificationSummary?.status ?? '未填写' }}</span></p>
                      <div class="inline-actions"><button class="primary-button" type="button" :disabled="busy" @click="confirmTask(task)">确认完成</button><button class="secondary-button" type="button" :disabled="busy" @click="returnTask(task)">退回重新执行</button></div>
                    </template>
                    <template v-else><p><strong>已人工确认</strong><span>仅 CONFIRMED Task 计入开发进度；历史 Run {{ runsForTask(task.id).length }} 条。</span></p></template>
                  </div>
                </article>
              </div>
              <div v-else class="progress-empty"><strong>尚未拆分实施 Task</strong><p>按实际交付边界创建 Task，不会自动按技术分层拆分。</p><button class="primary-button" type="button" @click="editTask()">创建第一个 Task</button></div>
            </section>
            <section v-if="featureTab === 'history'" class="surface feature-history"><div class="surface-heading"><div><span class="section-index">REV</span><h2>版本历史</h2></div><span class="count-label">{{ revisions.length }}</span></div><div v-if="revisions.length" class="history-split"><div class="revision-list"><button v-for="revision in revisions" :key="revision.id" type="button" :class="{ active: selectedRevision?.id === revision.id }" @click="selectHistory(revision.id)"><span class="revision-number">R{{ revision.revisionNo }}</span><span><strong>{{ revision.changeSummary }}</strong><small>{{ formatTime(revision.createdAt) }}</small></span><b>{{ revision.id === currentRevision?.id ? '当前' : '→' }}</b></button></div><article class="history-preview"><div v-if="selectedRevision" class="markdown-body" v-html="renderMarkdown(selectedRevision.content)"></div></article></div><div v-else class="progress-empty"><strong>暂无设计版本</strong><p>功能设计创建后会在这里保留只读历史。</p></div></section>
          </template>

          <template v-if="workspacePage === 'development'"><div class="compact-page-heading"><div><p class="eyebrow">05 / DELIVERY</p><h1>开发进度</h1><p>按 Module → Feature → Task 查看真实研发清单；进度只来自 Task 状态。</p></div></div><section class="surface progress-list"><div class="development-head"><span>模块 / 功能</span><span>状态</span><span>设计</span><span>实施</span><span>验证</span></div><template v-if="projectDetail.features.length"><div v-for="module in projectDetail.modules" :key="module.id" class="development-module"><div class="development-module-name"><strong>{{ module.name }}</strong><code>{{ module.code }}</code></div><template v-for="feature in featuresForModule(module.id)" :key="feature.id"><button class="development-feature-row" type="button" @click="toggleProgressFeature(feature.id)"><span><b>{{ expandedProgressFeatures.has(feature.id) ? '▾' : '▸' }}</b><strong>{{ feature.name }}</strong><code>{{ feature.code }}</code></span><span class="feature-status" :data-status="feature.status">{{ statusName(feature.status) }}</span><span>{{ hasFeatureDesign(feature.id) ? '✓ 已有设计' : '未设计' }}</span><span>{{ implementationProgress(feature.id) }}</span><span>{{ verificationProgress(feature.id) }}</span></button><div v-if="expandedProgressFeatures.has(feature.id)" class="development-tasks"><button v-for="task in tasksForFeature(feature.id)" :key="task.id" type="button" @click="openFeature(feature); featureTab = 'plan'"><span><code>{{ task.code }}</code><strong>{{ task.name }}</strong></span><span>{{ taskTypeName(task.type) }}</span><span class="task-status" :data-status="task.status">{{ task.status }}</span><span>{{ task.objective || '—' }}</span></button><div v-if="!tasksForFeature(feature.id).length" class="development-no-tasks">未拆分 Task</div></div></template></div><div class="progress-note">实施列只统计 BACKEND / FRONTEND / INTEGRATION / OTHER；DESIGN 不计入实施，VERIFICATION 单独统计。Feature 状态仍由人工维护。</div></template><div v-else class="progress-empty"><strong>当前没有可展示的功能</strong><p>创建 Feature 后，这里会显示真实状态；不会计算虚假进度。</p></div></section></template>
          <template v-if="workspacePage === 'testing'"><div class="compact-page-heading"><div><p class="eyebrow">06 / QUALITY</p><h1>测试与验收</h1><p>未来展示 Feature → Test → Acceptance。</p></div></div><section class="surface formal-empty single"><span class="empty-code">NOT AVAILABLE</span><h2>Test 与 Acceptance 模型尚未开放</h2><p>当前没有真实数据，因此不展示模拟结果、状态或数量。</p></section></template>
          <template v-if="workspacePage === 'ai'">
            <div class="compact-page-heading"><div><p class="eyebrow">07 / AI RUNS</p><h1>AI 执行记录</h1><p>记录每次授权后的真实 Run 生命周期；本轮仅提供手工模拟入口，不连接 AI Runner。</p></div></div>
            <section v-if="sortedRuns.length" class="run-workbench">
              <div class="surface run-ledger"><div class="run-ledger-head"><span>Run</span><span>功能 / Task</span><span>状态</span><span>执行者</span><span>开始时间</span></div><button v-for="run in sortedRuns" :key="run.id" type="button" :class="{ active: selectedRun?.id === run.id }" @click="selectedRun = run"><strong>{{ runNumber(run) }}</strong><span>{{ featureDisplayName(run.featureId) }}<small>{{ taskNameById(run.taskId) }}</small></span><span class="run-status" :data-status="run.status">{{ runStatusName(run.status) }}</span><span>{{ run.actorName }}<small>{{ run.actorType }}</small></span><time>{{ formatTime(run.startedAt) }}</time></button></div>
              <aside v-if="selectedRun" class="surface run-detail"><div class="surface-heading"><div><span class="section-index">RUN</span><h2>{{ runNumber(selectedRun) }}</h2></div><span class="run-status" :data-status="selectedRun.status">{{ selectedRun.status }}</span></div><dl><div><dt>Task</dt><dd>{{ featureDisplayName(selectedRun.featureId) }} / {{ taskNameById(selectedRun.taskId) }}</dd></div><div><dt>Authorization</dt><dd><code>{{ selectedRun.authorizationId }}</code></dd></div><div><dt>Actor</dt><dd>{{ selectedRun.actorName }} · {{ selectedRun.actorType }}</dd></div><div><dt>Phase</dt><dd>{{ runPhaseName(selectedRun.phase) }}（{{ selectedRun.phase }}）</dd></div><div><dt>baseCommit</dt><dd><code>{{ selectedRun.baseCommit || '—' }}</code></dd></div><div><dt>resultCommit</dt><dd><code>{{ selectedRun.resultCommit || '—' }}</code></dd></div></dl><div class="run-result"><h3>结果摘要</h3><p>{{ selectedRun.summary || '尚未提交结果' }}</p><h3>修改文件</h3><ul v-if="selectedRun.changedFiles.length"><li v-for="file in selectedRun.changedFiles" :key="file"><code>{{ file }}</code></li></ul><p v-else>—</p><h3>验证</h3><p>{{ selectedRun.verificationSummary ? `${selectedRun.verificationSummary.status} · ${selectedRun.verificationSummary.summary}` : '—' }}</p><h3>问题</h3><ul v-if="selectedRun.issues.length"><li v-for="issue in selectedRun.issues" :key="issue">{{ issue }}</li></ul><p v-else>—</p></div><div class="run-timeline"><span>创建 {{ formatTime(selectedRun.createdAt) }}</span><span>开始 {{ formatTime(selectedRun.startedAt) }}</span><span v-if="selectedRun.submittedAt">提交 {{ formatTime(selectedRun.submittedAt) }}</span><span v-if="selectedRun.finishedAt">结束 {{ formatTime(selectedRun.finishedAt) }}</span></div></aside>
            </section>
            <section v-else class="surface formal-empty single"><span class="empty-code">NO RUNS</span><h2>当前还没有执行记录</h2><p>在 Feature 实施计划中完成人工授权后，可使用开发验证入口启动首个 Run。</p></section>
          </template>
          <template v-if="workspacePage === 'history'"><div class="compact-page-heading"><div><p class="eyebrow">08 / HISTORY</p><h1>版本与历史</h1><p>项目现有设计资料的真实 Revision 记录。</p></div></div><section class="surface history-stream"><div class="history-stream-head"><span>版本</span><span>设计资料</span><span>变更摘要</span><span>来源</span><span>时间</span></div><button v-for="activity in projectActivity" :key="activity.id" type="button" @click="openOtherMaterial(activity.specification)"><span class="revision-number">R{{ activity.revisionNo }}</span><strong>{{ kindName(activity.specification.kind) }} · {{ activity.specification.title }}</strong><span>{{ activity.changeSummary }}</span><span>{{ sourceName(activity.source) }}</span><time>{{ formatTime(activity.createdAt) }}</time></button><div v-if="!projectActivity.length" class="progress-empty"><strong>暂无 Revision 历史</strong><p>创建项目级设计资料版本后会在这里显示。</p></div></section></template>
        </main>
      </div>
    </template>

    <div v-if="showProjectDialog" class="dialog-backdrop" @click.self="showProjectDialog = false"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title"><div class="dialog-heading"><div><p class="eyebrow">NEW PROJECT</p><h2 id="project-dialog-title">新建项目</h2></div><button type="button" aria-label="关闭" @click="showProjectDialog = false">×</button></div><form class="form-stack" @submit.prevent="createProject"><label for="project-name">项目名称</label><input id="project-name" v-model="projectName" maxlength="120" required placeholder="例如 ForgeFlow" /><label for="project-key">项目标识</label><input id="project-key" v-model="projectKey" maxlength="32" required placeholder="例如 FORGEFLOW" /><p class="form-hint">2–32 个字母、数字、_ 或 -，必须以字母开头。</p><div class="dialog-actions"><button class="secondary-button" type="button" @click="showProjectDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">创建并进入 <span>→</span></button></div></form></section></div>
    <div v-if="showSpecDialog" class="dialog-backdrop" @click.self="showSpecDialog = false"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="spec-dialog-title"><div class="dialog-heading"><div><p class="eyebrow">PROJECT DOCUMENT</p><h2 id="spec-dialog-title">创建{{ activeDocumentConfig.title }}</h2></div><button type="button" aria-label="关闭" @click="showSpecDialog = false">×</button></div><form class="form-stack" @submit.prevent="createSpecification"><label for="spec-title">资料名称</label><input id="spec-title" v-model="specTitle" maxlength="120" required /><p class="form-hint">正文将在下一步以 Markdown 创建首个 Revision。</p><div class="dialog-actions"><button class="secondary-button" type="button" @click="showSpecDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">创建并编辑 <span>→</span></button></div></form></section></div>
    <div v-if="showModuleDialog" class="dialog-backdrop" @click.self="showModuleDialog = false"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="module-dialog-title"><div class="dialog-heading"><div><p class="eyebrow">MODULE</p><h2 id="module-dialog-title">{{ editingModuleId ? '编辑模块' : '新建模块' }}</h2></div><button type="button" aria-label="关闭" @click="showModuleDialog = false">×</button></div><form class="form-stack" @submit.prevent="saveModule"><label for="module-name">模块名称</label><input id="module-name" v-model="moduleName" maxlength="120" required /><label for="module-code">模块编号</label><input id="module-code" v-model="moduleCode" maxlength="40" required placeholder="例如 IAM" /><label for="module-description">说明</label><textarea id="module-description" v-model="moduleDescription" maxlength="500"></textarea><label for="module-sort">排序值</label><input id="module-sort" v-model.number="moduleSortOrder" type="number" min="0" step="1" required /><div class="dialog-actions"><button class="secondary-button" type="button" @click="showModuleDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">{{ editingModuleId ? '保存修改' : '创建模块' }} →</button></div></form></section></div>
    <div v-if="showFeatureDialog" class="dialog-backdrop" @click.self="showFeatureDialog = false"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="feature-dialog-title"><div class="dialog-heading"><div><p class="eyebrow">FEATURE</p><h2 id="feature-dialog-title">{{ editingFeatureId ? '编辑功能' : '新建功能' }}</h2></div><button type="button" aria-label="关闭" @click="showFeatureDialog = false">×</button></div><form class="form-stack" @submit.prevent="saveFeature"><label for="feature-module">所属模块</label><select id="feature-module" v-model="featureModuleId" required><option v-for="module in projectDetail?.modules ?? []" :key="module.id" :value="module.id">{{ module.name }}</option></select><label for="feature-name">功能名称</label><input id="feature-name" v-model="featureName" maxlength="120" required /><label for="feature-code">功能编号</label><input id="feature-code" v-model="featureCode" maxlength="40" required placeholder="例如 P2-W03" /><label for="feature-summary">摘要</label><textarea id="feature-summary" v-model="featureSummary" maxlength="1000"></textarea><div class="dialog-grid"><label>状态<select v-model="featureStatus"><option v-for="status in featureStatuses" :key="status.value" :value="status.value">{{ status.label }}（{{ status.value }}）</option></select></label><label>排序值<input v-model.number="featureSortOrder" type="number" min="0" step="1" required /></label></div><div class="dialog-actions"><button class="secondary-button" type="button" @click="showFeatureDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">{{ editingFeatureId ? '保存修改' : '创建功能' }} →</button></div></form></section></div>
    <div v-if="showTaskDialog" class="dialog-backdrop" @click.self="showTaskDialog = false"><section class="dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-dialog-title"><div class="dialog-heading"><div><p class="eyebrow">TASK</p><h2 id="task-dialog-title">{{ editingTaskId ? '编辑 Task' : '新建 Task' }}</h2></div><button type="button" aria-label="关闭" @click="showTaskDialog = false">×</button></div><form class="form-stack" @submit.prevent="saveTask"><div class="dialog-grid"><label>任务名称<input v-model="taskName" maxlength="120" required /></label><label>任务编号<input v-model="taskCode" maxlength="40" required placeholder="例如 T01" /></label></div><label for="task-objective">任务目标</label><textarea id="task-objective" v-model="taskObjective" maxlength="2000" placeholder="说明完成此 Task 应达到的具体结果"></textarea><div class="dialog-grid"><label>类型<select v-model="taskType"><option v-for="type in taskTypes" :key="type.value" :value="type.value">{{ type.label }}（{{ type.value }}）</option></select></label><label>状态<select v-model="taskStatus" :disabled="!editingTaskId || !['PLANNED', 'AUTHORIZED'].includes(taskStatus)"><option value="PLANNED">待授权（PLANNED）</option><option value="AUTHORIZED">已授权（AUTHORIZED）</option><option v-if="!['PLANNED', 'AUTHORIZED'].includes(taskStatus)" :value="taskStatus">{{ taskStatusName(taskStatus) }}（{{ taskStatus }}）</option></select></label></div><label>排序值<input v-model.number="taskSortOrder" type="number" min="0" step="1" required /></label><p class="form-hint">RUNNING / SUBMITTED / CONFIRMED 只允许通过授权、Run 与人工确认操作产生，不能在表单中伪造。</p><div class="dialog-actions"><button class="secondary-button" type="button" @click="showTaskDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">{{ editingTaskId ? '保存修改' : '创建 Task' }} →</button></div></form></section></div>
    <div v-if="showRunSubmitDialog" class="dialog-backdrop" @click.self="showRunSubmitDialog = false"><section class="dialog run-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="run-submit-title"><div class="dialog-heading"><div><p class="eyebrow">RUN RESULT</p><h2 id="run-submit-title">提交 Run 结果</h2></div><button type="button" aria-label="关闭" @click="showRunSubmitDialog = false">×</button></div><form class="form-stack" @submit.prevent="submitRun"><label>结果摘要<textarea v-model="runSummary" maxlength="4000" required placeholder="说明本次 Run 完成了什么"></textarea></label><label>resultCommit（可空）<input v-model="runResultCommit" maxlength="120" placeholder="例如 abc123" /></label><label>修改文件（每行一个）<textarea v-model="runChangedFiles" maxlength="20000" spellcheck="false" placeholder="apps/server/src/...&#10;apps/web/src/..."></textarea></label><div class="dialog-grid"><label>验证状态<input v-model="runVerificationStatus" maxlength="40" required placeholder="PASS / FAIL / NOT_RUN" /></label><label>验证摘要<input v-model="runVerificationSummary" maxlength="2000" required placeholder="例如 typecheck、build、test 通过" /></label></div><label>问题（每行一个，可空）<textarea v-model="runIssues" maxlength="20000"></textarea></label><p class="form-hint">提交后 Run 与历史结果不可覆盖；Task 进入 SUBMITTED，仍需人工确认。</p><div class="dialog-actions"><button class="secondary-button" type="button" @click="showRunSubmitDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">提交结果 →</button></div></form></section></div>
  </div>
</template>
