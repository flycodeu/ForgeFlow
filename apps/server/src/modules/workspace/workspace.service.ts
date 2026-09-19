import { createHash, randomUUID } from 'node:crypto';
import type {
  Feature, FeatureStatus, Module, Project, ProjectDetail, SpecificationDetail, SpecificationRevision,
  SpecificationRevisionSummary, SpecificationSummary,
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
}
