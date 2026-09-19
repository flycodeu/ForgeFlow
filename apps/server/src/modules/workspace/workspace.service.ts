import { createHash, randomUUID } from 'node:crypto';
import type {
  AiRun, AuthorizationStatus, Feature, FeatureStatus, Module, Project, ProjectDetail, RunActorType, RunPhase,
  RunStatus, RunVerificationSummary, SpecificationDetail, SpecificationRevision, SpecificationRevisionSummary,
  SpecificationSummary, Task, TaskAuthorization, TaskStatus, TaskType,
} from '@forgeflow/contracts';
import { ApiError } from '../../shared/api-error.js';
import { WorkspaceRepository } from './workspace.repository.js';

function projectView(project: { id: string; projectKey: string; name: string; createdAt: Date }): Project {
  return { ...project, createdAt: project.createdAt.toISOString() };
}

function specificationView(
  specification: { id: string; projectId: string; featureId: string | null; kind: string; title: string; latestRevisionId: string | null; createdAt: Date },
  latestRevisionNumber: number | null,
): SpecificationSummary {
  return { ...specification, latestRevisionNumber, createdAt: specification.createdAt.toISOString() };
}

function moduleView(module: {
  id: string; projectId: string; code: string; name: string; description: string; sortOrder: number; createdAt: Date; updatedAt: Date;
}): Module {
  return { ...module, createdAt: module.createdAt.toISOString(), updatedAt: module.updatedAt.toISOString() };
}

function featureView(feature: {
  id: string; projectId: string; moduleId: string; code: string; name: string; summary: string; status: string;
  sortOrder: number; createdAt: Date; updatedAt: Date;
}): Feature {
  return {
    ...feature,
    status: feature.status as FeatureStatus,
    createdAt: feature.createdAt.toISOString(),
    updatedAt: feature.updatedAt.toISOString(),
  };
}

function taskView(task: {
  id: string; projectId: string; featureId: string; code: string; name: string; type: string; status: string;
  objective: string; sortOrder: number; createdAt: Date; updatedAt: Date;
}): Task {
  return {
    ...task,
    type: task.type as TaskType,
    status: task.status as TaskStatus,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function authorizationView(authorization: {
  id: string; taskId: string; projectId: string; featureId: string; status: string;
  authorizedAt: Date; revokedAt: Date | null; createdAt: Date;
}): TaskAuthorization {
  return {
    ...authorization,
    status: authorization.status as AuthorizationStatus,
    authorizedAt: authorization.authorizedAt.toISOString(),
    revokedAt: authorization.revokedAt?.toISOString() ?? null,
    createdAt: authorization.createdAt.toISOString(),
  };
}

function runView(run: {
  id: string; projectId: string; featureId: string; taskId: string; authorizationId: string;
  actorType: string; actorName: string; status: string; phase: string; baseCommit: string | null;
  resultCommit: string | null; summary: string; changedFiles: string; verificationSummary: string | null;
  issues: string; startedAt: Date; submittedAt: Date | null; finishedAt: Date | null; createdAt: Date; updatedAt: Date;
}): AiRun {
  return {
    ...run,
    actorType: run.actorType as RunActorType,
    status: run.status as RunStatus,
    phase: run.phase as RunPhase,
    changedFiles: JSON.parse(run.changedFiles) as string[],
    verificationSummary: run.verificationSummary ? JSON.parse(run.verificationSummary) as RunVerificationSummary : null,
    issues: JSON.parse(run.issues) as string[],
    startedAt: run.startedAt.toISOString(),
    submittedAt: run.submittedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function revisionView(revision: {
  id: string; specId: string; revisionNo: number; markdown: string; contentHash: string;
  source: string; changeSummary: string; createdAt: Date;
}): SpecificationRevision {
  return {
    id: revision.id,
    specId: revision.specId,
    revisionNo: revision.revisionNo,
    content: revision.markdown,
    contentHash: revision.contentHash,
    source: revision.source,
    changeSummary: revision.changeSummary,
    createdAt: revision.createdAt.toISOString(),
  };
}

function revisionSummaryView(revision: {
  id: string; specId: string; revisionNo: number; contentHash: string;
  source: string; changeSummary: string; createdAt: Date;
}): SpecificationRevisionSummary {
  return { ...revision, createdAt: revision.createdAt.toISOString() };
}

function isUniqueConstraint(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export class WorkspaceService {
  constructor(private readonly repository: WorkspaceRepository) {}

  createProject(input: { projectKey: string; name: string }): Project {
    const project = { id: randomUUID(), ...input, createdAt: new Date() };
    try {
      this.repository.insertProject(project);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ApiError(409, 'PROJECT_KEY_EXISTS', '项目标识已存在');
      }
      throw error;
    }
    return projectView(project);
  }

  listProjects(): Project[] {
    return this.repository.listProjects().map(projectView);
  }

  getProject(projectId: string): ProjectDetail {
    const project = this.repository.findProject(projectId);
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在');
    return {
      project: projectView(project),
      modules: this.repository.listModules(projectId).map(moduleView),
      features: this.repository.listFeatures(projectId).map(featureView),
      tasks: this.repository.listTasks(projectId).map(taskView),
      authorizations: this.repository.listAuthorizations(projectId).map(authorizationView),
      runs: this.repository.listRuns(projectId).map(runView),
      specifications: this.repository.listSpecifications(projectId)
        .map(({ specification, latestRevisionNumber }) => specificationView(specification, latestRevisionNumber)),
    };
  }

  listModules(projectId: string): Module[] {
    this.requireProject(projectId);
    return this.repository.listModules(projectId).map(moduleView);
  }

  createModule(projectId: string, input: { code: string; name: string; description: string; sortOrder: number }): Module {
    this.requireProject(projectId);
    const now = new Date();
    const module = { id: randomUUID(), projectId, ...input, createdAt: now, updatedAt: now };
    try {
      this.repository.insertModule(module);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'MODULE_CODE_EXISTS', '模块编号已存在');
      throw error;
    }
    return moduleView(module);
  }

  updateModule(projectId: string, moduleId: string, input: Partial<Pick<Module, 'code' | 'name' | 'description' | 'sortOrder'>>): Module {
    const current = this.requireModule(projectId, moduleId);
    const values = { ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), updatedAt: new Date() };
    try {
      this.repository.updateModule(projectId, moduleId, values);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'MODULE_CODE_EXISTS', '模块编号已存在');
      throw error;
    }
    return moduleView({ ...current, ...values });
  }

  listFeatures(projectId: string, moduleId?: string): Feature[] {
    this.requireProject(projectId);
    if (moduleId) this.requireModule(projectId, moduleId);
    return this.repository.listFeatures(projectId, moduleId).map(featureView);
  }

  createFeature(projectId: string, input: {
    moduleId: string; code: string; name: string; summary: string; status: FeatureStatus; sortOrder: number;
  }): Feature {
    this.requireProject(projectId);
    this.requireModule(projectId, input.moduleId);
    const now = new Date();
    const feature = { id: randomUUID(), projectId, ...input, createdAt: now, updatedAt: now };
    try {
      this.repository.insertFeature(feature);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'FEATURE_CODE_EXISTS', '功能编号已存在');
      throw error;
    }
    return featureView(feature);
  }

  getFeature(projectId: string, featureId: string): Feature {
    return featureView(this.requireFeature(projectId, featureId));
  }

  updateFeature(projectId: string, featureId: string, input: Partial<Pick<Feature, 'moduleId' | 'code' | 'name' | 'summary' | 'status' | 'sortOrder'>>): Feature {
    const current = this.requireFeature(projectId, featureId);
    if (input.moduleId) this.requireModule(projectId, input.moduleId);
    const values = { ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), updatedAt: new Date() };
    try {
      this.repository.updateFeature(projectId, featureId, values);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'FEATURE_CODE_EXISTS', '功能编号已存在');
      throw error;
    }
    return featureView({ ...current, ...values });
  }

  listTasks(projectId: string, featureId: string): Task[] {
    this.requireFeature(projectId, featureId);
    return this.repository.listTasks(projectId, featureId).map(taskView);
  }

  createTask(projectId: string, featureId: string, input: {
    code: string; name: string; type: TaskType; status: TaskStatus; objective: string; sortOrder: number;
  }): Task {
    this.requireFeature(projectId, featureId);
    if (input.status !== 'PLANNED') {
      throw new ApiError(409, 'INVALID_TASK_TRANSITION', '新建 Task 必须从 PLANNED 开始');
    }
    const now = new Date();
    const task = { id: randomUUID(), projectId, featureId, ...input, createdAt: now, updatedAt: now };
    try {
      this.repository.insertTask(task);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'TASK_CODE_EXISTS', '该功能下的任务编号已存在');
      throw error;
    }
    return taskView(task);
  }

  getTask(projectId: string, featureId: string, taskId: string): Task {
    return taskView(this.requireTask(projectId, featureId, taskId));
  }

  updateTask(projectId: string, featureId: string, taskId: string, input: Partial<Pick<Task, 'code' | 'name' | 'type' | 'status' | 'objective' | 'sortOrder'>>): Task {
    const current = this.requireTask(projectId, featureId, taskId);
    if (input.status && input.status !== current.status) {
      const allowed = (current.status === 'PLANNED' && input.status === 'AUTHORIZED')
        || (current.status === 'AUTHORIZED' && input.status === 'PLANNED');
      if (!allowed) throw new ApiError(409, 'INVALID_TASK_TRANSITION', '该 Task 状态必须通过授权、Run 或人工确认流程变更');
      if (current.status === 'AUTHORIZED' && this.repository.findActiveAuthorization(projectId, taskId)) {
        throw new ApiError(409, 'ACTIVE_AUTHORIZATION_EXISTS', '请先撤销 ACTIVE Authorization');
      }
    }
    const values = { ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), updatedAt: new Date() };
    try {
      this.repository.updateTask(projectId, featureId, taskId, values);
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'TASK_CODE_EXISTS', '该功能下的任务编号已存在');
      throw error;
    }
    return taskView({ ...current, ...values });
  }

  listAuthorizations(projectId: string, featureId: string, taskId: string): TaskAuthorization[] {
    this.requireTask(projectId, featureId, taskId);
    return this.repository.listAuthorizations(projectId, taskId).map(authorizationView);
  }

  authorizeTask(projectId: string, featureId: string, taskId: string): TaskAuthorization {
    try {
      return this.repository.transaction(() => {
        const task = this.requireTask(projectId, featureId, taskId);
        if (task.status !== 'AUTHORIZED') {
          throw new ApiError(409, 'TASK_NOT_AUTHORIZED', '只有 AUTHORIZED Task 才能批准执行');
        }
        if (this.repository.findActiveAuthorization(projectId, taskId)) {
          throw new ApiError(409, 'ACTIVE_AUTHORIZATION_EXISTS', '该 Task 已有 ACTIVE Authorization');
        }
        const now = new Date();
        const authorization = {
          id: randomUUID(), taskId, projectId, featureId, status: 'ACTIVE', authorizedAt: now, revokedAt: null, createdAt: now,
        };
        this.repository.insertAuthorization(authorization);
        return authorizationView(authorization);
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'ACTIVE_AUTHORIZATION_EXISTS', '该 Task 已有 ACTIVE Authorization');
      throw error;
    }
  }

  revokeAuthorization(projectId: string, featureId: string, taskId: string, authorizationId: string): TaskAuthorization {
    return this.repository.transaction(() => {
      this.requireTask(projectId, featureId, taskId);
      const authorization = this.requireAuthorization(projectId, taskId, authorizationId);
      if (authorization.status !== 'ACTIVE') throw new ApiError(409, 'AUTHORIZATION_NOT_ACTIVE', 'Authorization 已失效');
      if (this.repository.findRunningRun(projectId, taskId)) {
        throw new ApiError(409, 'RUN_STILL_RUNNING', '存在 RUNNING Run 时请先中断 Run');
      }
      const now = new Date();
      if (this.repository.updateAuthorizationStatus(authorizationId, 'ACTIVE', 'REVOKED', now) !== 1) {
        throw new ApiError(409, 'AUTHORIZATION_NOT_ACTIVE', 'Authorization 已失效');
      }
      return authorizationView({ ...authorization, status: 'REVOKED', revokedAt: now });
    });
  }

  listRuns(projectId: string): AiRun[] {
    this.requireProject(projectId);
    return this.repository.listRuns(projectId).map(runView);
  }

  getRun(projectId: string, runId: string): AiRun {
    return runView(this.requireRun(projectId, runId));
  }

  startRun(projectId: string, featureId: string, taskId: string, input: {
    authorizationId: string; actorType: RunActorType; actorName: string; baseCommit: string | null;
  }): AiRun {
    try {
      return this.repository.transaction(() => {
        const task = this.requireTask(projectId, featureId, taskId);
        if (task.status !== 'AUTHORIZED') throw new ApiError(409, 'TASK_NOT_AUTHORIZED', 'Task 当前不可启动 Run');
        const authorization = this.requireAuthorization(projectId, taskId, input.authorizationId);
        if (authorization.featureId !== featureId || authorization.status !== 'ACTIVE') {
          throw new ApiError(409, 'AUTHORIZATION_NOT_ACTIVE', 'Authorization 已失效');
        }
        if (this.repository.findRunningRun(projectId, taskId)) {
          throw new ApiError(409, 'RUN_ALREADY_RUNNING', '该 Task 已有 RUNNING Run');
        }
        const now = new Date();
        const run = {
          id: randomUUID(), projectId, featureId, taskId, authorizationId: authorization.id,
          actorType: input.actorType, actorName: input.actorName, status: 'RUNNING', phase: 'PREPARING',
          baseCommit: input.baseCommit, resultCommit: null, summary: '', changedFiles: '[]',
          verificationSummary: null, issues: '[]', startedAt: now, submittedAt: null, finishedAt: null,
          createdAt: now, updatedAt: now,
        };
        this.repository.insertRun(run);
        if (this.repository.updateTaskStatus(projectId, featureId, taskId, 'AUTHORIZED', 'RUNNING', now) !== 1) {
          throw new ApiError(409, 'TASK_NOT_AUTHORIZED', 'Task 状态已变化');
        }
        return runView(run);
      });
    } catch (error) {
      if (isUniqueConstraint(error)) throw new ApiError(409, 'RUN_ALREADY_RUNNING', '该 Task 已有 RUNNING Run');
      throw error;
    }
  }

  updateRunPhase(projectId: string, runId: string, phase: RunPhase): AiRun {
    const phases: RunPhase[] = ['PREPARING', 'IMPLEMENTING', 'TESTING', 'SUBMITTING'];
    const run = this.requireRun(projectId, runId);
    if (run.status !== 'RUNNING') throw new ApiError(409, 'RUN_NOT_RUNNING', '只有 RUNNING Run 可以更新阶段');
    if (phases.indexOf(phase) < phases.indexOf(run.phase as RunPhase)) {
      throw new ApiError(409, 'INVALID_RUN_PHASE', 'Run 阶段不能回退');
    }
    const updatedAt = new Date();
    if (this.repository.updateRun(runId, 'RUNNING', { phase, updatedAt }) !== 1) {
      throw new ApiError(409, 'RUN_NOT_RUNNING', 'Run 状态已变化');
    }
    return runView({ ...run, phase, updatedAt });
  }

  submitRun(projectId: string, runId: string, input: {
    summary: string; resultCommit: string | null; changedFiles: string[];
    verificationSummary: RunVerificationSummary; issues: string[];
  }): AiRun {
    return this.repository.transaction(() => {
      const run = this.requireRun(projectId, runId);
      if (run.status !== 'RUNNING') throw new ApiError(409, 'RUN_NOT_RUNNING', '只有 RUNNING Run 可以提交');
      const task = this.requireTask(projectId, run.featureId, run.taskId);
      if (task.status !== 'RUNNING') throw new ApiError(409, 'TASK_NOT_RUNNING', 'Task 状态已变化');
      const authorization = this.requireAuthorization(projectId, run.taskId, run.authorizationId);
      if (authorization.status !== 'ACTIVE') throw new ApiError(409, 'AUTHORIZATION_NOT_ACTIVE', 'Authorization 已失效');
      const now = new Date();
      const values = {
        status: 'SUBMITTED', phase: 'SUBMITTING', resultCommit: input.resultCommit, summary: input.summary,
        changedFiles: JSON.stringify(input.changedFiles), verificationSummary: JSON.stringify(input.verificationSummary),
        issues: JSON.stringify(input.issues), submittedAt: now, finishedAt: now, updatedAt: now,
      };
      if (this.repository.updateRun(runId, 'RUNNING', values) !== 1
        || this.repository.updateTaskStatus(projectId, run.featureId, run.taskId, 'RUNNING', 'SUBMITTED', now) !== 1
        || this.repository.updateAuthorizationStatus(authorization.id, 'ACTIVE', 'CONSUMED', null) !== 1) {
        throw new ApiError(409, 'RUN_STATE_CONFLICT', 'Run、Task 或 Authorization 状态已变化');
      }
      return runView({ ...run, ...values });
    });
  }

  finishRun(projectId: string, runId: string, status: 'FAILED' | 'ABORTED', input: { summary: string; issues: string[] }): AiRun {
    return this.repository.transaction(() => {
      const run = this.requireRun(projectId, runId);
      if (run.status !== 'RUNNING') throw new ApiError(409, 'RUN_NOT_RUNNING', '只有 RUNNING Run 可以失败或中断');
      const task = this.requireTask(projectId, run.featureId, run.taskId);
      const authorization = this.requireAuthorization(projectId, run.taskId, run.authorizationId);
      if (task.status !== 'RUNNING' || authorization.status !== 'ACTIVE') {
        throw new ApiError(409, 'RUN_STATE_CONFLICT', 'Run、Task 或 Authorization 状态已变化');
      }
      const now = new Date();
      const values = { status, summary: input.summary, issues: JSON.stringify(input.issues), finishedAt: now, updatedAt: now };
      if (this.repository.updateRun(runId, 'RUNNING', values) !== 1
        || this.repository.updateTaskStatus(projectId, run.featureId, run.taskId, 'RUNNING', 'AUTHORIZED', now) !== 1
        || this.repository.updateAuthorizationStatus(authorization.id, 'ACTIVE', 'CONSUMED', null) !== 1) {
        throw new ApiError(409, 'RUN_STATE_CONFLICT', 'Run、Task 或 Authorization 状态已变化');
      }
      return runView({ ...run, ...values });
    });
  }

  confirmTask(projectId: string, featureId: string, taskId: string): Task {
    return this.repository.transaction(() => {
      const task = this.requireTask(projectId, featureId, taskId);
      if (task.status !== 'SUBMITTED') throw new ApiError(409, 'TASK_NOT_SUBMITTED', '只有 SUBMITTED Task 可以确认完成');
      if (!this.repository.listRuns(projectId, taskId).some((run) => run.status === 'SUBMITTED')) {
        throw new ApiError(409, 'SUBMITTED_RUN_NOT_FOUND', '没有可确认的 SUBMITTED Run');
      }
      const now = new Date();
      if (this.repository.updateTaskStatus(projectId, featureId, taskId, 'SUBMITTED', 'CONFIRMED', now) !== 1) {
        throw new ApiError(409, 'TASK_STATE_CONFLICT', 'Task 状态已变化');
      }
      const active = this.repository.findActiveAuthorization(projectId, taskId);
      if (active) this.repository.updateAuthorizationStatus(active.id, 'ACTIVE', 'CONSUMED', null);
      return taskView({ ...task, status: 'CONFIRMED', updatedAt: now });
    });
  }

  returnTask(projectId: string, featureId: string, taskId: string): Task {
    return this.repository.transaction(() => {
      const task = this.requireTask(projectId, featureId, taskId);
      if (task.status !== 'SUBMITTED') throw new ApiError(409, 'TASK_NOT_SUBMITTED', '只有 SUBMITTED Task 可以退回');
      const now = new Date();
      if (this.repository.updateTaskStatus(projectId, featureId, taskId, 'SUBMITTED', 'AUTHORIZED', now) !== 1) {
        throw new ApiError(409, 'TASK_STATE_CONFLICT', 'Task 状态已变化');
      }
      return taskView({ ...task, status: 'AUTHORIZED', updatedAt: now });
    });
  }

  createSpecification(projectId: string, input: { kind: string; title: string; featureId: string | null }): SpecificationSummary {
    this.requireProject(projectId);
    if (input.kind === 'feature-design' && !input.featureId) {
      throw new ApiError(400, 'INVALID_INPUT', '功能设计必须关联 Feature');
    }
    if (input.featureId) {
      this.requireFeature(projectId, input.featureId);
      if (input.kind !== 'feature-design') {
        throw new ApiError(400, 'INVALID_INPUT', 'Feature 关联资料必须使用 feature-design 类型');
      }
      if (this.repository.findFeatureSpecification(projectId, input.featureId)) {
        throw new ApiError(409, 'FEATURE_SPEC_EXISTS', '该功能已经有设计资料');
      }
    }
    const specification = {
      id: randomUUID(), projectId, ...input, latestRevisionId: null, createdAt: new Date(),
    };
    this.repository.insertSpecification(specification);
    return specificationView(specification, null);
  }

  getSpecification(projectId: string, specId: string): SpecificationDetail {
    const specification = this.requireSpecification(projectId, specId);
    const latest = specification.latestRevisionId
      ? this.repository.findRevision(specId, specification.latestRevisionId)
      : undefined;
    if (specification.latestRevisionId && !latest) {
      throw new Error('Specification latest revision points outside its history');
    }
    return {
      specification: specificationView(specification, latest?.revisionNo ?? null),
      latestRevision: latest ? revisionView(latest) : null,
    };
  }

  listRevisions(projectId: string, specId: string): SpecificationRevisionSummary[] {
    this.requireSpecification(projectId, specId);
    return this.repository.listRevisions(specId).map(revisionSummaryView);
  }

  getRevision(projectId: string, specId: string, revisionId: string): SpecificationRevision {
    this.requireSpecification(projectId, specId);
    const revision = this.repository.findRevision(specId, revisionId);
    if (!revision) throw new ApiError(404, 'REVISION_NOT_FOUND', '修订版本不存在');
    return revisionView(revision);
  }

  createRevision(projectId: string, specId: string, input: {
    content: string; changeSummary: string; expectedHeadRevisionId: string | null; source: string;
  }): SpecificationRevision {
    return this.repository.transaction(() => {
      const specification = this.requireSpecification(projectId, specId);
      if (specification.latestRevisionId !== input.expectedHeadRevisionId) {
        throw new ApiError(409, 'REVISION_CONFLICT', '当前版本已变化，请重新读取后再保存', { currentRevisionId: specification.latestRevisionId });
      }
      const latest = specification.latestRevisionId
        ? this.repository.findRevision(specId, specification.latestRevisionId)
        : undefined;
      if (specification.latestRevisionId && !latest) {
        throw new Error('Specification latest revision points outside its history');
      }
      const revision = {
        id: randomUUID(),
        specId,
        revisionNo: (latest?.revisionNo ?? 0) + 1,
        markdown: input.content,
        contentHash: createHash('sha256').update(input.content).digest('hex'),
        source: input.source,
        changeSummary: input.changeSummary,
        createdAt: new Date(),
      };
      this.repository.insertRevision(revision);
      if (this.repository.pointToRevision(specId, input.expectedHeadRevisionId, revision.id) !== 1) {
        throw new ApiError(409, 'REVISION_CONFLICT', '当前版本已变化，请重新读取后再保存');
      }
      return revisionView(revision);
    });
  }

  private requireSpecification(projectId: string, specId: string) {
    const specification = this.repository.findSpecification(projectId, specId);
    if (!specification) throw new ApiError(404, 'SPECIFICATION_NOT_FOUND', '规格不存在');
    return specification;
  }

  private requireProject(projectId: string) {
    const project = this.repository.findProject(projectId);
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', '项目不存在');
    return project;
  }

  private requireModule(projectId: string, moduleId: string) {
    const module = this.repository.findModule(projectId, moduleId);
    if (!module) throw new ApiError(404, 'MODULE_NOT_FOUND', '模块不存在');
    return module;
  }

  private requireFeature(projectId: string, featureId: string) {
    const feature = this.repository.findFeature(projectId, featureId);
    if (!feature) throw new ApiError(404, 'FEATURE_NOT_FOUND', '功能不存在');
    return feature;
  }

  private requireTask(projectId: string, featureId: string, taskId: string) {
    const task = this.repository.findTask(projectId, featureId, taskId);
    if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', '任务不存在');
    return task;
  }

  private requireAuthorization(projectId: string, taskId: string, authorizationId: string) {
    const authorization = this.repository.findAuthorization(projectId, taskId, authorizationId);
    if (!authorization) throw new ApiError(404, 'AUTHORIZATION_NOT_FOUND', 'Authorization 不存在');
    return authorization;
  }

  private requireRun(projectId: string, runId: string) {
    const run = this.repository.findRun(projectId, runId);
    if (!run) throw new ApiError(404, 'RUN_NOT_FOUND', 'Run 不存在');
    return run;
  }
}
