<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type {
  AiRun, AiScope, AiTokenSummary, CreatedAiToken, DesignReview, Feature, FeatureStatus, HealthResponse, Module, Project,
  ProjectDetail, ProjectSourceKind, SpecificationDetail, SpecificationRevision, SpecificationRevisionSummary,
  SpecificationSummary, TaskCategory, TaskStatus, TaskType, RunPhase,
} from '@forgeflow/contracts';
import CapabilityProgress from './components/CapabilityProgress.vue';
import EngineeringWorkbench from './components/EngineeringWorkbench.vue';
import ProjectLifecycleBar from './components/ProjectLifecycleBar.vue';
import ResearchWorkspace from './components/ResearchWorkspace.vue';
import SourceIntegration from './components/SourceIntegration.vue';
import { api, ApiRequestError } from './api-client';
import './app.css';

type WorkspacePage = 'projects' | 'overview' | 'background' | 'research' | 'requirements' | 'architecture' | 'technology'
  | 'sources' | 'features' | 'feature-detail' | 'planning' | 'development' | 'testing' | 'ai' | 'history' | 'document';
type DocumentPage = 'background' | 'research' | 'requirements' | 'architecture' | 'technology' | 'document';
type RevisionActivity = SpecificationRevisionSummary & { specification: SpecificationSummary };
type ProjectSourceDraft = {
  clientId: string; alias: string; displayName: string; purpose: string; sourceKind: ProjectSourceKind;
  environmentKey: string; localRoot: string; remoteUrl: string; repoSubdir: string;
};

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
const collapsedModules = ref(new Set<string>());
const workspacePage = ref<WorkspacePage>('projects');
const documentMode = ref<'read' | 'edit'>('read');
const showProjectDialog = ref(false);
const showSpecDialog = ref(false);
const showModuleDialog = ref(false);
const showFeatureDialog = ref(false);
const showReviewDecisionDialog = ref(false);
const mobileNavOpen = ref(false);
const health = ref('连接中');
const error = ref('');
const notice = ref('');
const busy = ref(false);
const projectKey = ref('');
const projectName = ref('');
const projectDescription = ref('');
const projectType = ref('GENERAL');
const projectSourceMode = ref<'existing' | 'later'>('later');
const projectSources = ref<ProjectSourceDraft[]>([]);
const expandedProjectSourceId = ref<string | null>(null);
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
const selectedRun = ref<AiRun | null>(null);
const returnPageAfterCreate = ref<DocumentPage>('requirements');
const draftContent = ref('');
const draftSummary = ref('');
const reviewDecisionComment = ref('');
const reviewDiffVisible = ref(false);
const diffBaseRevision = ref<SpecificationRevision | null>(null);
const appView = ref<'loading' | 'workspace' | 'tokens'>('loading');
const tokens = ref<AiTokenSummary[]>([]);
const tokenName = ref('');
const tokenScopes = ref<AiScope[]>([]);
const revealedToken = ref('');
const mcpUrl = import.meta.env.VITE_FORGEFLOW_MCP_URL ?? 'http://127.0.0.1:8787/mcp';

const scopeOptions: { value: AiScope; label: string }[] = [
  { value: 'project:read', label: '读取项目' },
  { value: 'project:write', label: '创建项目草稿' },
  { value: 'spec:read', label: '读取设计资料' },
  { value: 'spec:write', label: '写入设计资料与版本' },
  { value: 'planning:write', label: '规划模块、功能与 Task' },
  { value: 'task:read', label: '读取任务与授权' },
  { value: 'run:write', label: '启动与提交 AI Run' },
];
const kindNames: Record<string, string> = {
  background: '项目背景', research: '调研与分析', requirements: '需求分析', architecture: '架构设计', technology: '技术选型',
  delivery: '交付与验证', other: '其他项目级资料', 'feature-design': '功能 / 能力设计', 'capability-design': '能力项设计',
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
const taskCategories: { value: TaskCategory; label: string }[] = [
  { value: 'DESIGN', label: '设计' }, { value: 'IMPLEMENTATION', label: '实现' }, { value: 'INTEGRATION', label: '集成' },
  { value: 'VERIFICATION', label: '验证' }, { value: 'MIGRATION', label: '迁移' }, { value: 'CONTENT', label: '内容' }, { value: 'OTHER', label: '其他' },
];
const taskStatuses: { value: TaskStatus; label: string }[] = [
  { value: 'PLANNED', label: '待授权' }, { value: 'AUTHORIZED', label: '已授权' },
  { value: 'RUNNING', label: '进行中' }, { value: 'SUBMITTED', label: '已提交' },
  { value: 'CONFIRMED', label: '已确认' },
];
const pageConfigs: Record<DocumentPage, { title: string; kind?: string; empty: string }> = {
  background: { title: '项目背景', kind: 'background', empty: '当前还没有项目背景资料。' },
  research: { title: '调研与分析', kind: 'research', empty: '当前还没有调研与分析资料。' },
  requirements: { title: '需求分析', kind: 'requirements', empty: '当前还没有需求分析资料。' },
  architecture: { title: '架构设计', kind: 'architecture', empty: '当前还没有架构设计资料。' },
  technology: { title: '技术选型', kind: 'technology', empty: '当前还没有技术选型资料。' },
  document: { title: '项目级资料', empty: '当前没有可查看的项目级资料。' },
};
const navItems: { id: WorkspacePage; label: string }[] = [
  { id: 'overview', label: '项目概览' },
  { id: 'background', label: '01 项目背景' },
  { id: 'research', label: '02 调研与分析' },
  { id: 'requirements', label: '03 需求分析' },
  { id: 'architecture', label: '04 架构设计' },
  { id: 'technology', label: '05 技术选型' },
  { id: 'sources', label: '06 源码与集成' },
  { id: 'features', label: '07 功能 / 能力设计' },
  { id: 'planning', label: '08 开发计划' },
  { id: 'development', label: '09 实施进度' },
  { id: 'testing', label: '10 测试与验收' },
  { id: 'ai', label: '11 AI 执行记录' },
  { id: 'history', label: '12 版本与历史' },
];

const currentProject = computed(() => projectDetail.value?.project ?? null);
const currentSpecification = computed(() => specificationDetail.value?.specification ?? null);
const currentRevision = computed(() => specificationDetail.value?.latestRevision ?? null);
const approvedRevision = computed(() => specificationDetail.value?.approvedRevision ?? null);
const currentRevisionReview = computed(() => specificationDetail.value?.reviews.find((item) => item.revisionId === currentRevision.value?.id) ?? null);
const pendingReviews = computed(() => currentProject.value?.workflowMode === 'CONTROLLED'
  ? projectDetail.value?.reviews.filter((item) => item.status === 'PENDING') ?? [] : []);
const attentionCount = computed(() => submittedTasks.value.length + pendingReviews.value.length);
const recentChanges = computed(() => projectActivity.value.slice(0, 8));
const lifecycleRefreshKey = computed(() => projectDetail.value ? [
  ...projectDetail.value.capabilities.map((item) => `${item.id}:${item.status}:${item.updatedAt}`),
  ...projectDetail.value.tasks.map((item) => `${item.id}:${item.status}:${item.updatedAt}`),
  ...projectDetail.value.runs.map((item) => `${item.id}:${item.status}:${item.updatedAt}`),
  ...projectDetail.value.specifications.map((item) => `${item.id}:${item.latestRevisionId ?? ''}`),
].join('|') : '');
const isDocumentPage = computed(() => ['background', 'research', 'requirements', 'architecture', 'technology', 'document'].includes(workspacePage.value));
const activeDocumentPage = computed(() => (isDocumentPage.value ? workspacePage.value : 'document') as DocumentPage);
const activeDocumentConfig = computed(() => pageConfigs[activeDocumentPage.value]);
const latestProjectTime = computed(() => currentProject.value
  ? projectCardMeta.value[currentProject.value.id]?.updatedAt ?? currentProject.value.createdAt : null);
const selectedModule = computed(() => projectDetail.value?.modules.find((item) => item.id === selectedFeature.value?.moduleId) ?? null);
const engineeringCompleteness = computed(() => {
  const detail = projectDetail.value; if (!detail) return [];
  const profiles = detail.project.designProfile.toLowerCase().split(/[,+;\s]+/).filter(Boolean);
  const profileKinds: Record<string, string[]> = {
    web: ['DATA_MODEL', 'CODE_MODEL', 'INTERFACE', 'UI_DESIGN', 'INTEGRATION', 'CONFIG', 'TEST_DESIGN'],
    'backend-service': ['DATA_MODEL', 'CODE_MODEL', 'INTERFACE', 'INTEGRATION', 'CONFIG', 'DEPLOYMENT', 'TEST_DESIGN'],
    game: ['CODE_MODEL', 'UI_DESIGN', 'INTEGRATION', 'CONFIG', 'TEST_DESIGN'],
    ai: ['DATA_MODEL', 'CODE_MODEL', 'INTERFACE', 'ALGORITHM', 'INTEGRATION', 'CONFIG', 'DEPLOYMENT', 'TEST_DESIGN'],
    pipeline: ['CODE_MODEL', 'INTERFACE', 'PIPELINE', 'INTEGRATION', 'CONFIG', 'DEPLOYMENT', 'TEST_DESIGN'],
    'video-pipeline': ['CODE_MODEL', 'INTERFACE', 'PIPELINE', 'INTEGRATION', 'CONFIG', 'DEPLOYMENT', 'TEST_DESIGN'],
  };
  const required = [...new Set(profiles.flatMap((profile) => profileKinds[profile] ?? []))];
  const labels: Record<string, string> = { DATA_MODEL: '数据', CODE_MODEL: '模型', INTERFACE: '契约', UI_DESIGN: 'UI', INTEGRATION: '集成', ALGORITHM: '算法', PIPELINE: 'Pipeline', CONFIG: '配置', DEPLOYMENT: '部署', TEST_DESIGN: '验证' };
  return detail.features.map((feature) => {
    const existing = new Set(detail.engineeringAssets.filter((item) => item.featureId === feature.id).map((item) => item.kind));
    return { feature, kinds: required.map((kind) => ({ kind, label: labels[kind] ?? kind, exists: existing.has(kind) })) };
  });
});
const sortedRuns = computed(() => [...(projectDetail.value?.runs ?? [])].sort((a, b) =>
  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
const submittedTasks = computed(() => projectDetail.value?.tasks.filter((item) => item.status === 'SUBMITTED') ?? []);
const activeTasks = computed(() => projectDetail.value?.tasks.filter((item) => currentProject.value?.workflowMode === 'AUTO'
  ? ['PLANNED', 'RUNNING', 'BLOCKED'].includes(item.status)
  : ['AUTHORIZED', 'RUNNING', 'SUBMITTED'].includes(item.status)) ?? []);
const technologySummary = computed(() => {
  if (workspacePage.value !== 'technology' || !selectedRevision.value?.content) return [];
  const lines = selectedRevision.value.content.split(/\r?\n/);
  const rows: Array<{ category: string; choice: string; purpose: string; reason: string; alternatives: string; status: string }> = [];
  for (let index = 0; index < lines.length - 2; index += 1) {
    const headers = lines[index]!.split('|').map((item) => item.trim()).filter(Boolean);
    if (headers.length < 2 || !/类别|category/i.test(headers[0] ?? '') || !/选择|choice/i.test(headers[1] ?? '')) continue;
    if (!/^\s*\|?[\s:|-]+\|/.test(lines[index + 1] ?? '')) continue;
    for (let rowIndex = index + 2; rowIndex < lines.length && lines[rowIndex]!.includes('|'); rowIndex += 1) {
      const cells = lines[rowIndex]!.split('|').map((item) => item.trim()).filter(Boolean);
      if (cells.length >= 2) rows.push({ category: cells[0]!, choice: cells[1]!, purpose: cells[2] ?? '', reason: cells[3] ?? '', alternatives: cells[4] ?? '', status: cells[5] ?? '' });
    }
    break;
  }
  if (rows.length) return rows;
  let current = ''; const summaries: typeof rows = [];
  for (const line of lines) {
    const heading = /^#{2,4}\s+(.+)$/.exec(line.trim());
    if (heading) { current = heading[1]!.trim(); continue; }
    if (current && line.trim() && summaries.length < 12) { summaries.push({ category: current, choice: line.trim().replace(/^[-*]\s+/, ''), purpose: '', reason: '', alternatives: '', status: '' }); current = ''; }
  }
  return summaries;
});

function kindName(kind: string) { return kindNames[kind] ?? kind; }
function statusName(status: FeatureStatus) { return featureStatuses.find((item) => item.value === status)?.label ?? status; }
function featuresForModule(moduleId: string) { return projectDetail.value?.features.filter((item) => item.moduleId === moduleId) ?? []; }
function tasksForFeature(featureId: string) { return projectDetail.value?.tasks.filter((item) => item.featureId === featureId) ?? []; }
function taskTypeName(type: TaskType) { return taskTypes.find((item) => item.value === type)?.label ?? type; }
function taskCategoryName(category: TaskCategory) { return taskCategories.find((item) => item.value === category)?.label ?? category; }
function taskStatusName(status: TaskStatus) { return taskStatuses.find((item) => item.value === status)?.label ?? status; }
function reviewStatusName(status: DesignReview['status'] | null) {
  return status ? ({ PENDING: '待评审', APPROVED: '已批准', CHANGES_REQUESTED: '要求修改', CANCELLED: '已取消' })[status] : '草稿';
}
function revisionNumber(revisionId: string | null) {
  if (!revisionId) return null;
  const projectSpecification = projectDetail.value?.specifications.find((item) =>
    item.latestRevisionId === revisionId || item.approvedRevisionId === revisionId,
  );
  return revisions.value.find((item) => item.id === revisionId)?.revisionNo
    ?? (currentRevision.value?.id === revisionId ? currentRevision.value.revisionNo : null)
    ?? (approvedRevision.value?.id === revisionId ? approvedRevision.value.revisionNo : null)
    ?? (projectSpecification?.latestRevisionId === revisionId ? projectSpecification.latestRevisionNumber : null)
    ?? (projectSpecification?.approvedRevisionId === revisionId ? projectSpecification.approvedRevisionNumber : null);
}
function reviewSpecification(review: DesignReview) {
  return projectDetail.value?.specifications.find((item) => item.id === review.specId) ?? null;
}
function reviewTargetName(review: DesignReview) {
  const specification = reviewSpecification(review);
  if (!specification) return '未知设计资料';
  return specification.featureId ? featureDisplayName(specification.featureId) : kindName(specification.kind);
}
function runsForTask(taskId: string) { return sortedRuns.value.filter((item) => item.taskId === taskId); }
function latestRun(taskId: string) { return runsForTask(taskId)[0] ?? null; }
function runNumber(run: AiRun) {
  const chronological = [...(projectDetail.value?.runs ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return `RUN-${String(chronological.findIndex((item) => item.id === run.id) + 1).padStart(3, '0')}`;
}
function runStatusName(status: AiRun['status']) { return ({ RUNNING: '执行中', SUBMITTED: '已提交', FAILED: '失败', ABORTED: '已中断' })[status]; }
function runFileLabel(file: AiRun['changedFiles'][number]) { return typeof file === 'string' ? file : `${file.sourceId.slice(0, 8)} · ${file.relativePath}`; }
function verificationLabel(run: AiRun) {
  const verification = run.verificationSummary;
  if (!verification) return '—';
  if (verification.origin === 'AI_REPORTED') return verification.reportedStatus === 'PASS' ? 'AI报告通过' : `AI报告${verification.reportedStatus}`;
  return `${verification.reportedStatus} · ${verification.origin}`;
}
function runPhaseName(phase: RunPhase) { return ({ PREPARING: '准备', IMPLEMENTING: '实施', TESTING: '验证', SUBMITTING: '提交' })[phase]; }
function featureDisplayName(featureId: string) { return projectDetail.value?.features.find((item) => item.id === featureId)?.name ?? '未知功能'; }
function taskNameById(taskId: string) { return projectDetail.value?.tasks.find((item) => item.id === taskId)?.name ?? '未知 Task'; }
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
  let inCode = false; let code: string[] = []; let headingIndex = 0;
  const flush = () => { if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`); paragraph = []; };
  const closeList = () => { if (listType) output.push(`</${listType}>`); listType = null; };
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith('```')) { flush(); closeList(); if (inCode) { output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = []; } inCode = !inCode; continue; }
    if (inCode) { code.push(line); continue; }
    const h = /^(#{1,4})\s+(.+)$/.exec(line); const ul = /^[-*]\s+(.+)$/.exec(line); const ol = /^\d+\.\s+(.+)$/.exec(line); const quote = /^>\s?(.+)$/.exec(line);
    if (h) { flush(); closeList(); headingIndex += 1; output.push(`<h${h[1].length} id="design-section-${headingIndex}">${inlineMarkdown(h[2])}</h${h[1].length}>`); continue; }
    if (line.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[index + 1] ?? '')) {
      flush(); closeList();
      const headers = line.split('|').map((item) => item.trim()).filter(Boolean);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes('|')) {
        rows.push(lines[index]!.split('|').map((item) => item.trim()).filter(Boolean)); index += 1;
      }
      index -= 1;
      output.push(`<div class="markdown-table-wrap"><table><thead><tr>${headers.map((item) => `<th>${inlineMarkdown(item)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cell) => `<td>${inlineMarkdown(row[cell] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (ul || ol) { flush(); const next = ul ? 'ul' : 'ol'; if (listType !== next) { closeList(); listType = next; output.push(`<${next}>`); } output.push(`<li>${inlineMarkdown((ul ?? ol)![1])}</li>`); continue; }
    if (quote) { flush(); closeList(); output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); continue; }
    if (/^---+$/.test(line.trim())) { flush(); closeList(); output.push('<hr>'); continue; }
    if (!line.trim()) { flush(); closeList(); continue; }
    paragraph.push(line.trim());
  }
  if (inCode) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flush(); closeList(); return output.join('');
}

const revisionDiff = computed(() => {
  const before = (diffBaseRevision.value?.content ?? '').replace(/\r\n/g, '\n').split('\n');
  const after = (currentRevision.value?.content ?? '').replace(/\r\n/g, '\n').split('\n');
  const lcs = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
  for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = after.length - 1; newIndex >= 0; newIndex -= 1) {
      lcs[oldIndex]![newIndex] = before[oldIndex] === after[newIndex]
        ? lcs[oldIndex + 1]![newIndex + 1]! + 1
        : Math.max(lcs[oldIndex + 1]![newIndex]!, lcs[oldIndex]![newIndex + 1]!);
    }
  }
  const lines: Array<{ kind: 'same' | 'removed' | 'added'; text: string; oldLine: number | null; newLine: number | null }> = [];
  let oldIndex = 0; let newIndex = 0;
  while (oldIndex < before.length || newIndex < after.length) {
    if (oldIndex < before.length && newIndex < after.length && before[oldIndex] === after[newIndex]) {
      lines.push({ kind: 'same', text: before[oldIndex]!, oldLine: oldIndex + 1, newLine: newIndex + 1 });
      oldIndex += 1; newIndex += 1;
    } else if (oldIndex < before.length && (newIndex >= after.length || lcs[oldIndex + 1]![newIndex]! >= lcs[oldIndex]![newIndex + 1]!)) {
      lines.push({ kind: 'removed', text: before[oldIndex]!, oldLine: oldIndex + 1, newLine: null });
      oldIndex += 1;
    } else {
      lines.push({ kind: 'added', text: after[newIndex]!, oldLine: null, newLine: newIndex + 1 });
      newIndex += 1;
    }
  }
  return lines;
});

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
  reviewDiffVisible.value = false; diffBaseRevision.value = null;
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
  if (['background', 'research', 'requirements', 'architecture', 'technology'].includes(page)) { void openDocumentPage(page as DocumentPage); return; }
  workspacePage.value = page;
  if (page === 'ai' && !selectedRun.value) selectedRun.value = sortedRuns.value[0] ?? null;
}
function openOtherMaterial(spec: SpecificationSummary) {
  if (spec.featureId) {
    const feature = projectDetail.value?.features.find((item) => item.id === spec.featureId);
    if (feature) void openFeature(feature);
    return;
  }
  const page = spec.kind === 'background' ? 'background'
    : spec.kind === 'research' ? 'research'
      : spec.kind === 'requirements' ? 'requirements'
        : spec.kind === 'architecture' ? 'architecture'
          : spec.kind === 'technology' ? 'technology' : 'document';
  void openDocumentPage(page, spec);
}
function toggleModule(moduleId: string) {
  const next = new Set(collapsedModules.value);
  if (next.has(moduleId)) next.delete(moduleId); else next.add(moduleId);
  collapsedModules.value = next;
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
async function openFeature(feature: Feature) {
  clearMessage(); selectedFeature.value = feature; workspacePage.value = 'feature-detail'; documentMode.value = 'read'; mobileNavOpen.value = false;
  selectedRun.value = sortedRuns.value.find((item) => item.featureId === feature.id) ?? null;
}
function prepareNewMaterial(page: DocumentPage) {
  const config = pageConfigs[page]; if (!config.kind) return;
  specKind.value = config.kind; specTitle.value = config.title; returnPageAfterCreate.value = page; showSpecDialog.value = true;
}
function initialDocumentTemplate(page: DocumentPage) {
  if (page === 'background') return '# 项目背景\n\n# 服务对象\n\n# 项目目标\n\n# 成功标准\n\n# 约束\n\n# 不适用阶段与原因\n';
  if (page === 'research') return '# 调研目标\n\n# 调研对象\n\n## 对象 1\n\n- 名称：\n- 类型：\n- 来源：\n- URL / Repository / Document：\n\n### 观察到的能力\n\n### 实现特点\n\n### 可借鉴点\n\n### 风险 / 不适用点\n\n# 对当前项目的影响\n\n## 采用什么\n\n## 不采用什么\n\n## 为什么\n\n## 待进一步确认\n';
  if (page === 'technology') return '# Technology Decisions\n\n| 类别 | 选择 | 用途 | 原因 | 替代方案 | 状态 |\n| --- | --- | --- | --- | --- | --- |\n| Language |  |  |  |  | proposed |\n\n# 详细说明\n';
  if (page === 'architecture') return '# 系统边界\n\n# Architecture Components\n\n# 数据流\n\n# 控制流\n\n# 依赖\n\n# 部署与运行方式\n\n# 关键约束\n';
  if (page === 'requirements') return '# 目标\n\n# 使用场景\n\n# 需求\n\n# 约束\n\n# 验收条件\n\n# 未决事项\n';
  return '';
}
function startRevision() { if (currentSpecification.value) { draftContent.value = currentRevision.value?.content ?? ''; draftSummary.value = ''; documentMode.value = 'edit'; } }
function cancelRevision() { documentMode.value = 'read'; selectedRevision.value = currentRevision.value; }
async function selectHistory(revisionId: string) {
  const projectId = selectedProjectId.value; const specId = selectedSpecId.value; if (!projectId || !specId) return;
  clearMessage(); documentMode.value = 'read';
  try { selectedRevision.value = await api<SpecificationRevision>(`/api/projects/${projectId}/specifications/${specId}/revisions/${revisionId}`); }
  catch (cause) { showError(cause); }
}
async function showRevisionDiff() {
  const projectId = selectedProjectId.value; const specId = selectedSpecId.value; const latest = currentRevision.value;
  if (!projectId || !specId || !latest) return;
  clearMessage(); busy.value = true;
  try {
    let base = approvedRevision.value;
    if (!base) {
      const previous = revisions.value.find((item) => item.revisionNo < latest.revisionNo);
      base = previous ? await api<SpecificationRevision>(`/api/projects/${projectId}/specifications/${specId}/revisions/${previous.id}`) : null;
    }
    diffBaseRevision.value = base; reviewDiffVisible.value = true; documentMode.value = 'read'; selectedRevision.value = latest;
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function submitDesignReview() {
  const projectId = selectedProjectId.value; const specId = selectedSpecId.value; const latest = currentRevision.value;
  if (!projectId || !specId || !latest) return;
  clearMessage(); busy.value = true;
  try {
    await api<DesignReview>(`/api/projects/${projectId}/specifications/${specId}/revisions/${latest.id}/reviews`, { method: 'POST' });
    await refreshCurrentProject(); await loadSpecification(specId); notice.value = `REV ${latest.revisionNo} 已提交人工评审`;
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function approveDesignReview(review: DesignReview) {
  const projectId = selectedProjectId.value; const specId = selectedSpecId.value; if (!projectId || !specId) return;
  clearMessage(); busy.value = true;
  try {
    await api<DesignReview>(`/api/projects/${projectId}/reviews/${review.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'APPROVED', comment: '批准为正式实施基线' }) });
    await refreshCurrentProject(); await loadSpecification(specId); notice.value = '设计评审已批准，正式 Baseline 已更新';
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
function requestDesignChanges() { reviewDecisionComment.value = ''; showReviewDecisionDialog.value = true; }
async function submitChangeRequest() {
  const projectId = selectedProjectId.value; const specId = selectedSpecId.value; const review = currentRevisionReview.value;
  if (!projectId || !specId || !review) return;
  clearMessage(); busy.value = true;
  try {
    await api<DesignReview>(`/api/projects/${projectId}/reviews/${review.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'CHANGES_REQUESTED', comment: reviewDecisionComment.value }) });
    showReviewDecisionDialog.value = false; await refreshCurrentProject(); await loadSpecification(specId); notice.value = '已要求修改；该版本保持只读，请创建新版本';
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function openPendingReview(review: DesignReview) {
  const spec = reviewSpecification(review); if (!spec) return;
  if (spec.featureId) {
    const feature = projectDetail.value?.features.find((item) => item.id === spec.featureId);
    if (!feature) return;
    await openFeature(feature);
  } else {
    const page = spec.kind === 'background' ? 'background' : spec.kind === 'research' ? 'research' : spec.kind === 'requirements' ? 'requirements' : spec.kind === 'architecture' ? 'architecture' : spec.kind === 'technology' ? 'technology' : 'document';
    await openDocumentPage(page, spec);
  }
  await selectHistory(review.revisionId); await showRevisionDiff();
}

function newProjectSource(): ProjectSourceDraft {
  return { clientId: crypto.randomUUID(), alias: '', displayName: '', purpose: '', sourceKind: 'GIT',
    environmentKey: 'flycode-pc', localRoot: '', remoteUrl: '', repoSubdir: '' };
}

function openProjectDialog() {
  projectSourceMode.value = 'later';
  projectSources.value = [];
  expandedProjectSourceId.value = null;
  showProjectDialog.value = true;
}

function chooseProjectSourceMode(mode: 'existing' | 'later') {
  projectSourceMode.value = mode;
  if (mode === 'existing' && projectSources.value.length === 0) projectSources.value.push(newProjectSource());
  expandedProjectSourceId.value = mode === 'existing' ? projectSources.value[0]?.clientId ?? null : null;
}

function addProjectSource() { const source = newProjectSource(); projectSources.value.push(source); expandedProjectSourceId.value = source.clientId; }
function removeProjectSource(clientId: string) {
  projectSources.value = projectSources.value.filter((source) => source.clientId !== clientId);
  if (expandedProjectSourceId.value === clientId) expandedProjectSourceId.value = projectSources.value[0]?.clientId ?? null;
}

async function createProject() {
  clearMessage(); busy.value = true;
  try {
    const project = await api<Project>('/api/projects', { method: 'POST', body: JSON.stringify({
      projectKey: projectKey.value, name: projectName.value, description: projectDescription.value, projectType: projectType.value,
      sources: projectSourceMode.value === 'existing' ? projectSources.value.map((source) => ({
        alias: source.alias, displayName: source.displayName, purpose: source.purpose, sourceKind: source.sourceKind,
        environmentKey: source.environmentKey, localRoot: source.localRoot, remoteUrl: source.remoteUrl || null,
        repoSubdir: source.repoSubdir || null, scope: null, idempotencyKey: `project-create-${source.clientId}`,
      })) : [],
    }) });
    projectKey.value = ''; projectName.value = ''; projectDescription.value = ''; projectType.value = 'GENERAL';
    projectSourceMode.value = 'later'; projectSources.value = []; expandedProjectSourceId.value = null; showProjectDialog.value = false;
    await loadWorkspace(); await selectProject(project.id); notice.value = '项目已创建';
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function createSpecification() {
  const projectId = selectedProjectId.value; if (!projectId) return;
  clearMessage(); busy.value = true;
  try {
    const title = specTitle.value;
    const spec = await api<SpecificationSummary>(`/api/projects/${projectId}/specifications`, { method: 'POST', body: JSON.stringify({ kind: specKind.value, title }) });
    showSpecDialog.value = false; await refreshCurrentProject(); await openDocumentPage(returnPageAfterCreate.value, spec); documentMode.value = 'edit';
    draftContent.value = initialDocumentTemplate(returnPageAfterCreate.value); notice.value = `${title}已创建，请添加初版内容`;
  } catch (cause) { showError(cause); } finally { busy.value = false; }
}
async function createRevision() {
  const projectId = selectedProjectId.value; const specId = selectedSpecId.value; const detail = specificationDetail.value;
  if (!projectId || !specId || !detail) return;
  clearMessage(); busy.value = true;
  try {
    const revision = await api<SpecificationRevision>(`/api/projects/${projectId}/specifications/${specId}/revisions`, { method: 'POST', body: JSON.stringify({ content: draftContent.value, changeSummary: draftSummary.value, expectedHeadRevisionId: detail.specification.latestRevisionId }) });
    await refreshCurrentProject(); await loadSpecification(specId); documentMode.value = 'read'; notice.value = `REV ${revision.revisionNo} 已保存`;
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
    await loadWorkspace();
    const query = new URLSearchParams(window.location.search);
    const requestedProject = projects.value.find((item) => item.projectKey === query.get('project'));
    if (requestedProject) {
      await selectProject(requestedProject.id);
      const requestedFeature = projectDetail.value?.features.find((item) => item.code === query.get('feature'));
      if (requestedFeature) await openFeature(requestedFeature);
      else if (query.get('view') && ['overview', 'research', 'requirements', 'architecture', 'technology', 'sources', 'features', 'planning', 'development', 'testing', 'ai', 'history'].includes(query.get('view')!)) navigate(query.get('view') as WorkspacePage);
    }
    appView.value = 'workspace';
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
      <div class="settings-grid"><section class="surface settings-card"><div class="surface-heading"><div><span class="section-index">01</span><h2>创建 AI Token</h2></div></div><form class="form-stack" @submit.prevent="createToken"><label for="token-name">名称</label><input id="token-name" v-model="tokenName" maxlength="120" required /><span class="field-label">Scope</span><label v-for="scope in scopeOptions" :key="scope.value" class="scope-option"><input v-model="tokenScopes" type="checkbox" :value="scope.value" /><span>{{ scope.label }}</span><code>{{ scope.value }}</code></label><button class="primary-button" type="submit" :disabled="busy">创建 Token <span>→</span></button></form><div v-if="revealedToken" class="token-reveal"><strong>仅显示一次</strong><code>{{ revealedToken }}</code></div></section><section class="surface settings-card"><div class="surface-heading"><div><span class="section-index">02</span><h2>现有 Token</h2></div><span class="count-label">{{ tokens.length }}</span></div><div v-if="tokens.length"><div v-for="token in tokens" :key="token.id" class="token-row"><div><strong>{{ token.name }}</strong><small>{{ token.scopes.join(' · ') }}</small><small>创建于 {{ formatTime(token.createdAt) }}<template v-if="token.revokedAt"> · 已撤销</template></small></div><button v-if="!token.revokedAt" class="text-button danger" type="button" :disabled="busy" @click="revokeToken(token.id)">撤销</button></div></div><div v-else class="empty-state compact"><span>00</span><h3>尚未创建 Token</h3><p>Token 仅用于外部 AI 接入，不影响本地 Web 使用。</p></div></section></div>
      <section class="surface mcp-guide"><div class="surface-heading"><div><span class="section-index">03</span><h2>MCP 接入说明</h2></div><span class="status-pill active">Streamable HTTP</span></div><div class="mcp-guide-body"><div><span class="field-label">MCP URL</span><code>{{ mcpUrl }}</code><p>使用上方创建的 Token，并至少授予客户端所调用 Tool 需要的 Scope。Token 明文仅在创建时显示一次。</p></div><div class="mcp-configs"><div><strong>Codex</strong><pre>codex mcp add forgeflow --url {{ mcpUrl }} --bearer-token-env-var FORGEFLOW_MCP_TOKEN</pre></div><div><strong>Claude Code（PowerShell）</strong><pre>claude mcp add --transport http forgeflow {{ mcpUrl }} --header "Authorization: Bearer $env:FORGEFLOW_MCP_TOKEN"</pre></div></div></div></section>
    </main>

    <template v-if="appView === 'workspace'">
      <main v-if="workspacePage === 'projects'" class="project-home">
        <div class="project-home-heading"><div><h1>我的项目</h1></div><button class="primary-button" type="button" @click="openProjectDialog"><span>＋</span> 新建项目</button></div>
        <section v-if="projects.length" class="project-card-grid"><button v-for="project in projects" :key="project.id" class="project-card" type="button" @click="selectProject(project.id)"><div class="project-card-top"><span class="project-avatar">{{ project.name.slice(0, 1).toUpperCase() }}</span><code>{{ project.projectKey }}</code><b>→</b></div><span class="project-type">{{ project.projectType }}</span><h2>{{ project.name }}</h2><p>{{ project.description || '暂无项目描述' }}</p><dl><div><dt>创建时间</dt><dd>{{ formatDate(project.createdAt) }}</dd></div><div><dt>最近更新</dt><dd>{{ formatTime(projectCardMeta[project.id]?.updatedAt ?? project.createdAt) }}</dd></div></dl></button></section>
        <section v-else class="surface empty-state project-empty"><span>00</span><h3>还没有项目</h3><p>创建第一个项目，开始组织真实的研发资料与过程。</p><button class="primary-button" type="button" @click="openProjectDialog"><span>＋</span> 新建项目</button></section>
      </main>

      <div v-else-if="currentProject && projectDetail" class="console-layout">
        <aside class="sidebar" :class="{ open: mobileNavOpen }">
          <nav class="primary-nav" aria-label="项目工作台">
            <div v-for="item in navItems" :key="item.id" class="nav-group">
              <button class="nav-item" :class="{ active: workspacePage === item.id || (item.id === 'overview' && workspacePage === 'document') || (item.id === 'features' && workspacePage === 'feature-detail') }" type="button" @click="navigate(item.id)">
                <span class="nav-marker"></span><span>{{ item.label }}</span><small v-if="item.id === 'features'">{{ projectDetail.features.length }}</small>
              </button>
              <div v-if="item.id === 'features' && projectDetail.modules.length" class="sidebar-feature-tree">
                <div v-for="module in projectDetail.modules" :key="module.id" class="sidebar-module">
                  <button type="button" @click="toggleModule(module.id)"><span>{{ collapsedModules.has(module.id) ? '▸' : '▾' }}</span><strong>{{ module.name }}</strong><small>{{ featuresForModule(module.id).length }}</small></button>
                  <div v-if="!collapsedModules.has(module.id)" class="sidebar-features">
                    <button v-for="feature in featuresForModule(module.id)" :key="feature.id" type="button" :class="{ active: selectedFeature?.id === feature.id && workspacePage === 'feature-detail' }" @click="openFeature(feature)"><span></span><strong>{{ feature.name }}</strong><i :data-status="feature.status"></i></button>
                  </div>
                </div>
              </div>
            </div>
          </nav>
          <div class="sidebar-footer"><span class="health-dot" :class="{ offline: health !== '服务正常' }"></span><div><strong>{{ health }}</strong><small>ForgeFlow Local</small></div></div>
        </aside>
        <main class="main-workspace" :class="{ 'engineering-page': workspacePage === 'feature-detail' }"><button class="mobile-nav-toggle" type="button" @click="mobileNavOpen = !mobileNavOpen">☰ 项目导航</button>
          <ProjectLifecycleBar v-if="workspacePage !== 'feature-detail'" :project-id="currentProject.id" :refresh-key="lifecycleRefreshKey" @navigate="navigate" />
          <template v-if="workspacePage === 'overview'">
            <div class="compact-page-heading"><div><p class="eyebrow">{{ currentProject.projectKey }} / {{ currentProject.projectType }}</p><h1>项目概览</h1><p>{{ currentProject.name }}</p></div><div class="heading-meta"><span>创建于 {{ formatTime(currentProject.createdAt) }}</span><span>更新于 {{ latestProjectTime ? formatTime(latestProjectTime) : '—' }}</span></div></div>
            <div class="overview-metrics" aria-label="项目真实数据概览">
              <button type="button" @click="navigate('features')"><strong>{{ projectDetail.modules.length }}</strong><span>模块</span></button>
              <button type="button" @click="navigate('features')"><strong>{{ projectDetail.features.length }}</strong><span>功能</span></button>
              <button type="button" @click="navigate('development')"><strong>{{ activeTasks.length }}</strong><span>当前工作</span></button>
              <button type="button"><strong>{{ attentionCount }}</strong><span>待我处理</span></button>
            </div>
            <div class="overview-workbench cockpit-overview">
              <section class="surface work-status-panel"><div class="surface-heading"><div><h2>当前工作</h2></div><span class="surface-note">实施任务</span></div><div v-if="activeTasks.length" class="compact-feature-list"><button v-for="task in activeTasks.slice(0, 6)" :key="task.id" type="button" @click="openFeature(projectDetail.features.find(item => item.id === task.featureId)!)"><span><strong>{{ featureDisplayName(task.featureId) }} / {{ task.name }}</strong><small>{{ taskCategoryName(task.category) }} · {{ task.area || taskTypeName(task.type) }} · {{ taskStatusName(task.status) }}</small></span><span class="task-status" :data-status="task.status">{{ taskStatusName(task.status) }}</span></button></div><div v-else class="compact-empty">当前没有进行中的实施任务。</div></section>
              <section class="surface attention-surface"><div class="surface-heading"><div><h2>需要我处理</h2></div><span class="surface-note">{{ attentionCount }} 项</span></div><div v-if="pendingReviews.length || submittedTasks.length" class="compact-feature-list"><button v-for="review in pendingReviews.slice(0, 5)" :key="review.id" type="button" @click="openPendingReview(review)"><span><strong>{{ reviewTargetName(review) }}</strong><small>{{ reviewSpecification(review)?.title }} · REV {{ revisionNumber(review.revisionId) ?? '—' }}</small></span><span class="review-badge pending">待设计评审</span></button><button v-for="task in submittedTasks.slice(0, Math.max(0, 5 - pendingReviews.length))" :key="task.id" type="button" @click="openFeature(projectDetail.features.find(item => item.id === task.featureId)!)"><span><strong>{{ runNumber(latestRun(task.id)!) }}</strong><small>{{ featureDisplayName(task.featureId) }} / {{ task.name }} · 等待确认</small></span><span class="task-status" data-status="SUBMITTED">待确认</span></button></div><div v-else class="compact-empty">当前没有待设计评审或待确认的 AI执行。</div></section>
              <section class="surface changes-surface"><div class="surface-heading"><div><h2>最近变化</h2></div><span class="surface-note">设计版本</span></div><div v-if="recentChanges.length" class="activity-list"><button v-for="activity in recentChanges.slice(0, 6)" :key="activity.id" type="button" @click="openOtherMaterial(activity.specification)"><span class="activity-mark">R{{ activity.revisionNo }}</span><span><strong>{{ kindName(activity.specification.kind) }} · {{ activity.specification.title }}</strong><small>{{ activity.changeSummary }} · {{ formatTime(activity.createdAt) }}</small></span><b>→</b></button></div><div v-else class="compact-empty">暂无真实版本变化。</div></section>
              <section class="surface structure-status"><div class="surface-heading"><div><h2>工程设计完整度</h2></div><button class="text-button" type="button" @click="navigate('features')">查看工作台 →</button></div><div v-if="engineeringCompleteness.length" class="engineering-completeness"><article v-for="item in engineeringCompleteness" :key="item.feature.id"><strong>{{ item.feature.name }}</strong><div><span v-for="kind in item.kinds" :key="kind.kind" :class="{ complete: kind.exists }">{{ kind.label }} {{ kind.exists ? '✓' : '—' }}</span></div></article></div><div v-else class="compact-empty">尚未创建功能。</div></section>
            </div>
          </template>

          <ResearchWorkspace v-if="workspacePage === 'research'" :specification="currentSpecification" :revision="selectedRevision" @create="currentSpecification ? startRevision() : prepareNewMaterial('research')" />

          <SourceIntegration v-if="workspacePage === 'sources'" :project-id="currentProject.id" :sources="projectDetail.sources" :analyses="projectDetail.sourceAnalyses"
            @refresh="refreshCurrentProject" @notice="notice = $event; error = ''" @error="error = $event; notice = ''" />

          <template v-if="isDocumentPage && workspacePage !== 'research'">
            <div class="compact-page-heading document-page-heading"><div><h1>{{ activeDocumentPage === 'document' && currentSpecification ? currentSpecification.title : activeDocumentConfig.title }}</h1><p v-if="currentRevision">当前版本 REV {{ currentRevision.revisionNo }} · 更新于 {{ formatTime(currentRevision.createdAt) }}</p></div><div v-if="currentSpecification" class="document-actions"><button class="primary-button" type="button" @click="startRevision">创建新版本</button></div></div>
            <section v-if="!currentSpecification" class="surface document-empty-state"><h2>{{ activeDocumentConfig.empty }}</h2><button v-if="activeDocumentConfig.kind" class="primary-button" type="button" @click="prepareNewMaterial(activeDocumentPage)"><span>＋</span> 创建{{ activeDocumentConfig.title }}</button></section>
            <section v-if="currentSpecification && currentRevision && currentProject.workflowMode === 'CONTROLLED'" class="baseline-bar" :class="{ warning: currentSpecification.latestRevisionId !== currentSpecification.approvedRevisionId }"><div class="baseline-facts"><span><small>当前正式版本</small><strong>{{ approvedRevision ? `REV ${approvedRevision.revisionNo}` : '尚未批准' }}</strong></span><span><small>最新版本</small><strong>REV {{ currentRevision.revisionNo }}</strong></span><span><small>状态</small><strong>{{ currentSpecification.latestRevisionId === currentSpecification.approvedRevisionId ? '已批准' : reviewStatusName(currentRevisionReview?.status ?? null) }}</strong></span></div><p v-if="currentSpecification.latestRevisionId !== currentSpecification.approvedRevisionId">存在未批准的新版本 REV {{ currentRevision.revisionNo }}，当前实施基线仍为 {{ approvedRevision ? `REV ${approvedRevision.revisionNo}` : '空' }}。</p><div class="baseline-actions"><button v-if="currentSpecification.latestRevisionId !== currentSpecification.approvedRevisionId" class="secondary-button" type="button" @click="showRevisionDiff">查看变更</button><button v-if="!currentRevisionReview" class="primary-button" type="button" :disabled="busy" @click="submitDesignReview">提交评审</button><template v-if="currentRevisionReview?.status === 'PENDING'"><button class="primary-button" type="button" :disabled="busy" @click="approveDesignReview(currentRevisionReview)">批准</button><button class="secondary-button" type="button" :disabled="busy" @click="requestDesignChanges">要求修改</button></template></div></section>
            <section v-if="reviewDiffVisible && currentRevision" class="surface revision-diff"><div class="surface-heading"><div><span class="section-index">DIFF</span><h2>REV {{ currentRevision.revisionNo }} 变更</h2></div><span class="surface-note">对比 {{ diffBaseRevision ? `REV ${diffBaseRevision.revisionNo}` : '空内容' }}</span></div><div class="diff-legend"><span class="added">新增</span><span class="removed">删除</span><span>未变化</span></div><pre><span v-for="(line, index) in revisionDiff" :key="index" :class="`diff-line ${line.kind}`"><i>{{ line.oldLine ?? '' }}</i><i>{{ line.newLine ?? '' }}</i><b>{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}</b><code>{{ line.text || ' ' }}</code></span></pre></section>
            <div v-else-if="documentMode === 'read'" class="document-workbench"><article class="surface document-reader"><div class="document-statusbar"><div><span class="status-tag planning">草稿</span><strong>{{ selectedRevision ? `REV ${selectedRevision.revisionNo}` : '尚无版本' }}</strong><span v-if="selectedRevision?.id === currentRevision?.id">当前版本</span><span v-else-if="selectedRevision">历史版本 · 只读</span></div><small v-if="selectedRevision">{{ sourceName(selectedRevision.source) }} · {{ formatTime(selectedRevision.createdAt) }}</small></div><section v-if="workspacePage === 'technology' && technologySummary.length" class="technology-decisions-summary"><div class="technology-summary-head"><span>类别</span><span>选择</span><span>用途与原因</span><span>状态</span></div><div v-for="item in technologySummary" :key="`${item.category}-${item.choice}`" class="technology-decision"><span>{{ item.category }}</span><strong>{{ item.choice }}</strong><p>{{ [item.purpose, item.reason, item.alternatives && `替代：${item.alternatives}`].filter(Boolean).join(' · ') || '详细说明见正文' }}</p><b>{{ item.status || '—' }}</b></div></section><div v-if="selectedRevision" class="markdown-body" v-html="renderMarkdown(selectedRevision.content)"></div><div v-else class="empty-state document-empty"><span>R0</span><h3>尚未创建初版</h3><p>创建新版本后，Markdown 正文会在这里以阅读模式展示。</p><button class="primary-button" type="button" @click="startRevision">创建初版</button></div></article><aside class="surface version-rail"><div class="surface-heading"><div><span class="section-index">REV</span><h2>版本历史</h2></div><span class="count-label">{{ revisions.length }}</span></div><div v-if="revisions.length" class="revision-list"><button v-for="revision in revisions" :key="revision.id" type="button" :class="{ active: selectedRevision?.id === revision.id }" @click="selectHistory(revision.id)"><span class="revision-number">R{{ revision.revisionNo }}</span><span><strong>{{ revision.changeSummary }}</strong><small>{{ formatTime(revision.createdAt) }}</small></span><b>{{ revision.id === currentRevision?.id ? '当前' : '→' }}</b></button></div><div v-else class="empty-state compact"><span>R0</span><h3>暂无版本</h3></div></aside></div>
            <div v-else class="revision-create-layout"><form class="surface revision-editor" @submit.prevent="createRevision"><div class="surface-heading"><div><h2>创建新版本</h2></div><span class="surface-note">基于当前版本</span></div><div class="editor-fields"><label for="change-summary">变更摘要</label><input id="change-summary" v-model="draftSummary" maxlength="500" required placeholder="说明这次版本修改了什么" /><div class="field-row"><label for="markdown-content">Markdown 正文</label><span>{{ draftContent.length }} / 200000</span></div><textarea id="markdown-content" v-model="draftContent" maxlength="200000" required spellcheck="false"></textarea><div class="form-footer"><p>保存后形成不可变版本；历史版本保持只读。</p><div><button class="secondary-button" type="button" @click="cancelRevision">取消</button><button class="primary-button" type="submit" :disabled="busy">保存新版本 <span>→</span></button></div></div></div></form><aside class="surface reference-panel"><div class="surface-heading"><div><h2>当前版本参考</h2></div></div><div class="reference-meta"><strong>{{ currentRevision ? `REV ${currentRevision.revisionNo}` : '尚无版本' }}</strong><span>{{ currentRevision?.changeSummary ?? '将创建初版' }}</span></div><pre>{{ currentRevision?.content ?? '当前没有可参考的版本正文。' }}</pre></aside></div>
          </template>

          <template v-if="workspacePage === 'features'">
            <div class="compact-page-heading"><div><h1>功能 / 能力设计</h1></div><button class="primary-button" type="button" @click="editModule()"><span>＋</span> 新建模块</button></div>
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
            <EngineeringWorkbench
              :project="currentProject"
              :feature="selectedFeature"
              :module-name="selectedModule?.name ?? '未分组'"
              :detail="projectDetail"
              @changed="refreshCurrentProject"
              @back="navigate('features')"
            />
          </template>

           <template v-if="workspacePage === 'planning'"><div class="compact-page-heading"><div><h1>开发计划</h1></div></div><section class="surface plan-board"><div class="plan-board-head"><span>功能</span><span>当前设计</span><span>实施任务</span><span>状态</span></div><button v-for="feature in projectDetail.features" :key="feature.id" type="button" @click="openFeature(feature)"><span><strong>{{ feature.name }}</strong><small>{{ feature.code }}</small></span><span>{{ projectDetail.project.workflowMode === 'AUTO' ? (projectDetail.specifications.find(item => item.featureId === feature.id)?.latestRevisionNumber ? `REV ${projectDetail.specifications.find(item => item.featureId === feature.id)?.latestRevisionNumber}` : '待设计') : (projectDetail.specifications.find(item => item.featureId === feature.id)?.approvedRevisionNumber ? `REV ${projectDetail.specifications.find(item => item.featureId === feature.id)?.approvedRevisionNumber}` : '待批准') }}</span><span><i v-for="task in tasksForFeature(feature.id)" :key="task.id">{{ taskCategoryName(task.category) }}<b v-if="task.area"> / {{ task.area }}</b></i><em v-if="!tasksForFeature(feature.id).length">待规划</em></span><span>{{ tasksForFeature(feature.id).length }} 项 →</span></button><div v-if="!projectDetail.features.length" class="progress-empty"><strong>暂无功能</strong></div></section></template>

          <CapabilityProgress v-if="workspacePage === 'development'" :detail="projectDetail" mode="development" @open-feature="openFeature" />
          <CapabilityProgress v-if="workspacePage === 'testing'" :detail="projectDetail" mode="testing" @open-feature="openFeature" />
          <template v-if="workspacePage === 'ai'">
            <div class="compact-page-heading"><div><h1>AI 执行记录</h1></div></div>
            <section v-if="sortedRuns.length" class="run-workbench">
              <div class="surface run-ledger"><div class="run-ledger-head"><span>时间</span><span>功能 / 实施任务</span><span>AI</span><span>状态</span><span>AI执行</span></div><button v-for="run in sortedRuns" :key="run.id" type="button" :class="{ active: selectedRun?.id === run.id }" @click="selectedRun = run"><time>{{ formatTime(run.startedAt) }}</time><span>{{ featureDisplayName(run.featureId) }}<small>{{ taskNameById(run.taskId) }}</small></span><span>{{ run.actorName }}<small>{{ run.actorType }}</small></span><span class="run-status" :data-status="run.status">{{ runStatusName(run.status) }}</span><strong>{{ runNumber(run) }}</strong></button></div>
              <aside v-if="selectedRun" class="surface run-detail"><div class="surface-heading"><div><span class="section-index">AI执行</span><h2>{{ runNumber(selectedRun) }}</h2></div><span class="run-status" :data-status="selectedRun.status">{{ runStatusName(selectedRun.status) }}</span></div><dl><div><dt>实施任务</dt><dd>{{ featureDisplayName(selectedRun.featureId) }} / {{ taskNameById(selectedRun.taskId) }}</dd></div><div><dt>执行模式</dt><dd>{{ selectedRun.authorizationId ? '受控模式 · 已授权' : '自动模式' }}</dd></div><div><dt>执行者</dt><dd>{{ selectedRun.actorName }}</dd></div><div><dt>阶段</dt><dd>{{ runPhaseName(selectedRun.phase) }}</dd></div><div><dt>基线提交</dt><dd><code>{{ selectedRun.baseCommit || '—' }}</code></dd></div><div><dt>结果提交</dt><dd><code>{{ selectedRun.resultCommit || '—' }}</code></dd></div></dl><div class="run-result"><h3>结果摘要</h3><p>{{ selectedRun.summary || '尚未提交结果' }}</p><h3>修改文件</h3><ul v-if="selectedRun.changedFiles.length"><li v-for="file in selectedRun.changedFiles" :key="runFileLabel(file)"><code>{{ runFileLabel(file) }}</code></li></ul><p v-else>—</p><h3>验证</h3><p>{{ verificationLabel(selectedRun) }}{{ selectedRun.verificationSummary ? ` · ${selectedRun.verificationSummary.summary}` : '' }}</p><h3>问题</h3><ul v-if="selectedRun.issues.length"><li v-for="issue in selectedRun.issues" :key="issue">{{ issue }}</li></ul><p v-else>—</p></div><div class="run-timeline"><span>创建 {{ formatTime(selectedRun.createdAt) }}</span><span>开始 {{ formatTime(selectedRun.startedAt) }}</span><span v-if="selectedRun.submittedAt">提交 {{ formatTime(selectedRun.submittedAt) }}</span><span v-if="selectedRun.finishedAt">结束 {{ formatTime(selectedRun.finishedAt) }}</span></div></aside>
            </section>
            <section v-else class="surface formal-empty single"><h2>暂无 AI 执行记录。</h2></section>
          </template>
          <template v-if="workspacePage === 'history'"><div class="compact-page-heading"><div><h1>版本与历史</h1></div></div><section class="surface history-stream"><div class="history-stream-head"><span>版本</span><span>设计资料</span><span>变更摘要</span><span>来源</span><span>时间</span></div><button v-for="activity in projectActivity" :key="activity.id" type="button" @click="openOtherMaterial(activity.specification)"><span class="revision-number">R{{ activity.revisionNo }}</span><strong>{{ kindName(activity.specification.kind) }} · {{ activity.specification.title }}</strong><span>{{ activity.changeSummary }}</span><span>{{ sourceName(activity.source) }}</span><time>{{ formatTime(activity.createdAt) }}</time></button><div v-if="!projectActivity.length" class="progress-empty"><strong>暂无版本历史</strong></div></section></template>
        </main>
      </div>
    </template>

    <div v-if="showProjectDialog" class="dialog-backdrop" @click.self="showProjectDialog = false">
      <section class="dialog project-source-dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
        <div class="dialog-heading"><div><h2 id="project-dialog-title">新建项目</h2></div><button type="button" aria-label="关闭" @click="showProjectDialog = false">×</button></div>
        <form class="form-stack" @submit.prevent="createProject">
          <div class="project-form-grid">
            <label for="project-name">项目名称<input id="project-name" v-model="projectName" maxlength="120" required placeholder="例如 视频智能分析平台" /></label>
            <label for="project-key">项目标识<input id="project-key" v-model="projectKey" maxlength="32" required placeholder="例如 VIDEO_AI" /></label>
          </div>
          <p class="form-hint">项目标识使用 2–32 个字母、数字、_ 或 -，必须以字母开头。</p>
          <label for="project-type">项目类型<input id="project-type" v-model="projectType" maxlength="80" required placeholder="video-pipeline + ai + web" /></label>
          <p class="form-hint">自由描述真实技术形态；不是固定枚举。</p>
          <label for="project-description">项目描述<textarea id="project-description" v-model="projectDescription" maxlength="1000" placeholder="说明项目目标与运行场景"></textarea></label>

          <fieldset class="source-mode-fieldset">
            <legend>源码接入方式</legend>
            <label :class="{ active: projectSourceMode === 'existing' }"><input type="radio" name="source-mode" :checked="projectSourceMode === 'existing'" @change="chooseProjectSourceMode('existing')" /><span><strong>已有源码</strong><small>现在登记一个或多个实际位置</small></span></label>
            <label :class="{ active: projectSourceMode === 'later' }"><input type="radio" name="source-mode" :checked="projectSourceMode === 'later'" @change="chooseProjectSourceMode('later')" /><span><strong>稍后绑定源码</strong><small>先规划项目，不虚构路径</small></span></label>
          </fieldset>

          <section v-if="projectSourceMode === 'existing'" class="project-source-builder">
            <article v-for="(source, index) in projectSources" :key="source.clientId" class="project-source-row" :class="{ expanded: expandedProjectSourceId === source.clientId }">
              <header><button class="source-accordion-toggle" type="button" @click="expandedProjectSourceId = expandedProjectSourceId === source.clientId ? null : source.clientId"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>源码 {{ String(index + 1).padStart(2, '0') }} · {{ source.alias || source.displayName || '未命名' }}</strong><small>{{ source.localRoot || '尚未填写本地目录' }}</small><b>{{ expandedProjectSourceId === source.clientId ? '▾' : '›' }}</b></button><button v-if="projectSources.length > 1" class="remove-source" type="button" @click="removeProjectSource(source.clientId)">删除</button></header>
              <div v-if="expandedProjectSourceId === source.clientId" class="project-source-fields">
                <div class="project-form-grid"><label>源码别名<input v-model="source.alias" maxlength="40" required placeholder="backend" /></label><label>显示名称<input v-model="source.displayName" maxlength="120" required placeholder="业务后端" /></label></div>
                <label>用途<input v-model="source.purpose" maxlength="500" placeholder="业务 API 与数据处理" /></label>
                <div class="project-form-grid"><label>类型<select v-model="source.sourceKind"><option value="GIT">Git 仓库</option><option value="DIRECTORY">普通目录</option></select></label><label>当前环境<input v-model="source.environmentKey" maxlength="80" required placeholder="flycode-pc" /></label></div>
                <label>本地源码目录<input v-model="source.localRoot" maxlength="1024" required placeholder="D:\Projects\video-api" /></label>
                <div class="project-form-grid"><label>Git Remote（可选）<input v-model="source.remoteUrl" maxlength="2048" /></label><label>仓库子目录（可选）<input v-model="source.repoSubdir" maxlength="500" placeholder="apps/backend" /></label></div>
              </div>
            </article>
            <button class="add-source-row" type="button" @click="addProjectSource">＋ 添加源码位置</button>
          </section>

          <div class="dialog-actions"><button class="secondary-button" type="button" @click="showProjectDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">创建并进入 <span>→</span></button></div>
        </form>
      </section>
    </div>
    <div v-if="showSpecDialog" class="dialog-backdrop" @click.self="showSpecDialog = false"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="spec-dialog-title"><div class="dialog-heading"><div><p class="eyebrow">PROJECT DOCUMENT</p><h2 id="spec-dialog-title">创建{{ activeDocumentConfig.title }}</h2></div><button type="button" aria-label="关闭" @click="showSpecDialog = false">×</button></div><form class="form-stack" @submit.prevent="createSpecification"><label for="spec-title">资料名称</label><input id="spec-title" v-model="specTitle" maxlength="120" required /><p class="form-hint">正文将在下一步以 Markdown 创建首个 Revision。</p><div class="dialog-actions"><button class="secondary-button" type="button" @click="showSpecDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">创建并编辑 <span>→</span></button></div></form></section></div>
    <div v-if="showModuleDialog" class="dialog-backdrop" @click.self="showModuleDialog = false"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="module-dialog-title"><div class="dialog-heading"><div><p class="eyebrow">MODULE</p><h2 id="module-dialog-title">{{ editingModuleId ? '编辑模块' : '新建模块' }}</h2></div><button type="button" aria-label="关闭" @click="showModuleDialog = false">×</button></div><form class="form-stack" @submit.prevent="saveModule"><label for="module-name">模块名称</label><input id="module-name" v-model="moduleName" maxlength="120" required /><label for="module-code">模块编号</label><input id="module-code" v-model="moduleCode" maxlength="40" required placeholder="例如 IAM" /><label for="module-description">说明</label><textarea id="module-description" v-model="moduleDescription" maxlength="500"></textarea><label for="module-sort">排序值</label><input id="module-sort" v-model.number="moduleSortOrder" type="number" min="0" step="1" required /><div class="dialog-actions"><button class="secondary-button" type="button" @click="showModuleDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">{{ editingModuleId ? '保存修改' : '创建模块' }} →</button></div></form></section></div>
    <div v-if="showFeatureDialog" class="dialog-backdrop" @click.self="showFeatureDialog = false"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="feature-dialog-title"><div class="dialog-heading"><div><h2 id="feature-dialog-title">{{ editingFeatureId ? '编辑功能' : '新建功能' }}</h2></div><button type="button" aria-label="关闭" @click="showFeatureDialog = false">×</button></div><form class="form-stack" @submit.prevent="saveFeature"><label for="feature-module">所属模块</label><select id="feature-module" v-model="featureModuleId" required><option v-for="module in projectDetail?.modules ?? []" :key="module.id" :value="module.id">{{ module.name }}</option></select><label for="feature-name">功能名称</label><input id="feature-name" v-model="featureName" maxlength="120" required /><label for="feature-code">功能编号</label><input id="feature-code" v-model="featureCode" maxlength="40" required placeholder="例如 P2-W03" /><label for="feature-summary">摘要</label><textarea id="feature-summary" v-model="featureSummary" maxlength="1000"></textarea><div class="dialog-grid"><label>状态<select v-model="featureStatus"><option v-for="status in featureStatuses" :key="status.value" :value="status.value">{{ status.label }}</option></select></label><label>排序值<input v-model.number="featureSortOrder" type="number" min="0" step="1" required /></label></div><div class="dialog-actions"><button class="secondary-button" type="button" @click="showFeatureDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">{{ editingFeatureId ? '保存修改' : '创建功能' }} →</button></div></form></section></div>
    <div v-if="showReviewDecisionDialog" class="dialog-backdrop" @click.self="showReviewDecisionDialog = false"><section class="dialog review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-decision-title"><div class="dialog-heading"><div><p class="eyebrow">DESIGN REVIEW</p><h2 id="review-decision-title">要求修改 REV {{ currentRevision?.revisionNo }}</h2></div><button type="button" aria-label="关闭" @click="showReviewDecisionDialog = false">×</button></div><form class="form-stack" @submit.prevent="submitChangeRequest"><label for="review-comment">修改原因</label><textarea id="review-comment" v-model="reviewDecisionComment" maxlength="1000" required placeholder="说明必须调整的设计边界或问题"></textarea><p class="form-hint">当前 Revision 保持不可变。AI 或用户需要创建新的 Revision 后重新提交评审。</p><div class="dialog-actions"><button class="secondary-button" type="button" @click="showReviewDecisionDialog = false">取消</button><button class="primary-button" type="submit" :disabled="busy">提交修改要求</button></div></form></section></div>
  </div>
</template>
