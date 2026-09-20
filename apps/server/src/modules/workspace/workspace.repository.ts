import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { openDatabase } from '../../db/client.js';
import {
  aiRuns, capabilities, designReviews, engineeringAssetRevisions, engineeringAssets, features, modules, projectSources, projects, sourceAnalyses,
  specificationRevisions, specifications, taskAuthorizations, tasks, traceLinks,
} from '../../db/schema.js';

type Connection = ReturnType<typeof openDatabase>;

export class WorkspaceRepository {
  constructor(private readonly connection: Connection) {}

  transaction<T>(work: () => T): T {
    return this.connection.sqlite.transaction(work).immediate();
  }

  insertProject(project: typeof projects.$inferInsert) {
    this.connection.db.insert(projects).values(project).run();
  }

  listProjects() {
    return this.connection.db.select().from(projects).orderBy(desc(projects.createdAt), projects.name).all();
  }

  findProject(id: string) {
    return this.connection.db.select().from(projects).where(eq(projects.id, id)).get();
  }

  updateProject(id: string, values: Partial<typeof projects.$inferInsert>) {
    return this.connection.db.update(projects).set(values).where(eq(projects.id, id)).run().changes;
  }

  insertProjectSource(source: typeof projectSources.$inferInsert) {
    this.connection.db.insert(projectSources).values(source).run();
  }

  listProjectSources(projectId: string) {
    return this.connection.db.select().from(projectSources).where(eq(projectSources.projectId, projectId))
      .orderBy(asc(projectSources.alias), asc(projectSources.createdAt)).all();
  }

  listAllProjectSources() {
    return this.connection.db.select().from(projectSources).orderBy(asc(projectSources.alias)).all();
  }

  findProjectSource(projectId: string, sourceId: string) {
    return this.connection.db.select().from(projectSources)
      .where(and(eq(projectSources.projectId, projectId), eq(projectSources.id, sourceId))).get();
  }

  findProjectSourceByIdempotencyKey(projectId: string, idempotencyKey: string) {
    return this.connection.db.select().from(projectSources)
      .where(and(eq(projectSources.projectId, projectId), eq(projectSources.lastIdempotencyKey, idempotencyKey))).get();
  }

  updateProjectSource(projectId: string, sourceId: string, values: Partial<typeof projectSources.$inferInsert>) {
    return this.connection.db.update(projectSources).set(values)
      .where(and(eq(projectSources.projectId, projectId), eq(projectSources.id, sourceId))).run().changes;
  }

  insertSourceAnalysis(analysis: typeof sourceAnalyses.$inferInsert) {
    this.connection.db.insert(sourceAnalyses).values(analysis).run();
  }

  listSourceAnalyses(projectId: string) {
    return this.connection.db.select().from(sourceAnalyses).where(eq(sourceAnalyses.projectId, projectId))
      .orderBy(desc(sourceAnalyses.requestedAt)).all();
  }

  findSourceAnalysis(projectId: string, analysisId: string) {
    return this.connection.db.select().from(sourceAnalyses)
      .where(and(eq(sourceAnalyses.projectId, projectId), eq(sourceAnalyses.id, analysisId))).get();
  }

  updateSourceAnalysis(projectId: string, analysisId: string, values: Partial<typeof sourceAnalyses.$inferInsert>) {
    return this.connection.db.update(sourceAnalyses).set(values)
      .where(and(eq(sourceAnalyses.projectId, projectId), eq(sourceAnalyses.id, analysisId))).run().changes;
  }

  insertModule(module: typeof modules.$inferInsert) {
    this.connection.db.insert(modules).values(module).run();
  }

  listModules(projectId: string) {
    return this.connection.db.select().from(modules).where(eq(modules.projectId, projectId))
      .orderBy(asc(modules.sortOrder), asc(modules.createdAt), asc(modules.name)).all();
  }

  findModule(projectId: string, moduleId: string) {
    return this.connection.db.select().from(modules)
      .where(and(eq(modules.projectId, projectId), eq(modules.id, moduleId))).get();
  }

  findModuleById(moduleId: string) {
    return this.connection.db.select().from(modules).where(eq(modules.id, moduleId)).get();
  }

  updateModule(projectId: string, moduleId: string, values: Partial<typeof modules.$inferInsert>) {
    return this.connection.db.update(modules).set(values)
      .where(and(eq(modules.projectId, projectId), eq(modules.id, moduleId))).run().changes;
  }

  insertFeature(feature: typeof features.$inferInsert) {
    this.connection.db.insert(features).values(feature).run();
  }

  listFeatures(projectId: string, moduleId?: string) {
    const predicate = moduleId
      ? and(eq(features.projectId, projectId), eq(features.moduleId, moduleId))
      : eq(features.projectId, projectId);
    return this.connection.db.select().from(features).where(predicate)
      .orderBy(asc(features.sortOrder), asc(features.createdAt), asc(features.name)).all();
  }

  findFeature(projectId: string, featureId: string) {
    return this.connection.db.select().from(features)
      .where(and(eq(features.projectId, projectId), eq(features.id, featureId))).get();
  }

  findFeatureById(featureId: string) {
    return this.connection.db.select().from(features).where(eq(features.id, featureId)).get();
  }

  updateFeature(projectId: string, featureId: string, values: Partial<typeof features.$inferInsert>) {
    return this.connection.db.update(features).set(values)
      .where(and(eq(features.projectId, projectId), eq(features.id, featureId))).run().changes;
  }

  insertCapability(capability: typeof capabilities.$inferInsert) {
    this.connection.db.insert(capabilities).values(capability).run();
  }

  listCapabilities(projectId: string, featureId?: string) {
    const predicate = featureId
      ? and(eq(capabilities.projectId, projectId), eq(capabilities.featureId, featureId))
      : eq(capabilities.projectId, projectId);
    return this.connection.db.select().from(capabilities).where(predicate)
      .orderBy(asc(capabilities.sortOrder), asc(capabilities.createdAt), asc(capabilities.name)).all();
  }

  findCapability(projectId: string, capabilityId: string) {
    return this.connection.db.select().from(capabilities)
      .where(and(eq(capabilities.projectId, projectId), eq(capabilities.id, capabilityId))).get();
  }

  findCapabilityById(capabilityId: string) {
    return this.connection.db.select().from(capabilities).where(eq(capabilities.id, capabilityId)).get();
  }

  updateCapability(projectId: string, capabilityId: string, values: Partial<typeof capabilities.$inferInsert>) {
    return this.connection.db.update(capabilities).set(values)
      .where(and(eq(capabilities.projectId, projectId), eq(capabilities.id, capabilityId))).run().changes;
  }

  insertEngineeringAsset(asset: typeof engineeringAssets.$inferInsert) {
    this.connection.db.insert(engineeringAssets).values(asset).run();
  }

  listEngineeringAssets(projectId: string, featureId?: string, capabilityId?: string) {
    const predicate = capabilityId && featureId
      ? and(eq(engineeringAssets.projectId, projectId), eq(engineeringAssets.featureId, featureId), eq(engineeringAssets.capabilityId, capabilityId))
      : featureId
        ? and(eq(engineeringAssets.projectId, projectId), eq(engineeringAssets.featureId, featureId))
        : eq(engineeringAssets.projectId, projectId);
    return this.connection.db.select().from(engineeringAssets).where(predicate)
      .orderBy(asc(engineeringAssets.kind), asc(engineeringAssets.name), asc(engineeringAssets.createdAt)).all();
  }

  findEngineeringAsset(projectId: string, assetId: string) {
    return this.connection.db.select().from(engineeringAssets)
      .where(and(eq(engineeringAssets.projectId, projectId), eq(engineeringAssets.id, assetId))).get();
  }

  findEngineeringAssetByFeatureKindName(featureId: string, kind: string, name: string) {
    return this.connection.db.select().from(engineeringAssets)
      .where(and(eq(engineeringAssets.featureId, featureId), eq(engineeringAssets.kind, kind), eq(engineeringAssets.name, name))).get();
  }

  updateEngineeringAsset(projectId: string, assetId: string, values: Partial<typeof engineeringAssets.$inferInsert>) {
    return this.connection.db.update(engineeringAssets).set(values)
      .where(and(eq(engineeringAssets.projectId, projectId), eq(engineeringAssets.id, assetId))).run().changes;
  }

  advanceEngineeringAssetRevision(projectId: string, assetId: string, expectedCurrentRevisionId: string | null,
    values: Partial<typeof engineeringAssets.$inferInsert>) {
    const head = expectedCurrentRevisionId === null
      ? isNull(engineeringAssets.currentRevisionId)
      : eq(engineeringAssets.currentRevisionId, expectedCurrentRevisionId);
    return this.connection.db.update(engineeringAssets).set(values)
      .where(and(eq(engineeringAssets.projectId, projectId), eq(engineeringAssets.id, assetId), head)).run().changes;
  }

  insertEngineeringAssetRevision(revision: typeof engineeringAssetRevisions.$inferInsert) {
    this.connection.db.insert(engineeringAssetRevisions).values(revision).run();
  }

  listEngineeringAssetRevisions(assetId: string) {
    return this.connection.db.select().from(engineeringAssetRevisions)
      .where(eq(engineeringAssetRevisions.assetId, assetId)).orderBy(desc(engineeringAssetRevisions.revisionNo)).all();
  }

  findEngineeringAssetRevision(assetId: string, revisionId: string) {
    return this.connection.db.select().from(engineeringAssetRevisions)
      .where(and(eq(engineeringAssetRevisions.assetId, assetId), eq(engineeringAssetRevisions.id, revisionId))).get();
  }

  insertTraceLink(link: typeof traceLinks.$inferInsert) {
    this.connection.db.insert(traceLinks).values(link).run();
  }

  listTraceLinks(projectId: string) {
    return this.connection.db.select().from(traceLinks).where(eq(traceLinks.projectId, projectId))
      .orderBy(asc(traceLinks.createdAt)).all();
  }

  insertTask(task: typeof tasks.$inferInsert) {
    this.connection.db.insert(tasks).values(task).run();
  }

  listTasks(projectId: string, featureId?: string) {
    const predicate = featureId
      ? and(eq(tasks.projectId, projectId), eq(tasks.featureId, featureId))
      : eq(tasks.projectId, projectId);
    return this.connection.db.select().from(tasks).where(predicate)
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt), asc(tasks.name)).all();
  }

  findTask(projectId: string, featureId: string, taskId: string) {
    return this.connection.db.select().from(tasks)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.featureId, featureId), eq(tasks.id, taskId))).get();
  }

  findTaskById(taskId: string) {
    return this.connection.db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  }

  updateTask(projectId: string, featureId: string, taskId: string, values: Partial<typeof tasks.$inferInsert>) {
    return this.connection.db.update(tasks).set(values)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.featureId, featureId), eq(tasks.id, taskId))).run().changes;
  }

  insertReview(review: typeof designReviews.$inferInsert) {
    this.connection.db.insert(designReviews).values(review).run();
  }

  listReviews(projectId: string, specId?: string) {
    const predicate = specId
      ? and(eq(designReviews.projectId, projectId), eq(designReviews.specId, specId))
      : eq(designReviews.projectId, projectId);
    return this.connection.db.select().from(designReviews).where(predicate)
      .orderBy(desc(designReviews.createdAt)).all();
  }

  findReview(projectId: string, reviewId: string) {
    return this.connection.db.select().from(designReviews)
      .where(and(eq(designReviews.projectId, projectId), eq(designReviews.id, reviewId))).get();
  }

  findPendingReviewForSpec(projectId: string, specId: string) {
    return this.connection.db.select().from(designReviews)
      .where(and(eq(designReviews.projectId, projectId), eq(designReviews.specId, specId), eq(designReviews.status, 'PENDING'))).get();
  }

  findApprovedReviewForRevision(projectId: string, specId: string, revisionId: string) {
    return this.connection.db.select().from(designReviews)
      .where(and(eq(designReviews.projectId, projectId), eq(designReviews.specId, specId),
        eq(designReviews.revisionId, revisionId), eq(designReviews.status, 'APPROVED'))).get();
  }

  updateReviewDecision(reviewId: string, status: string, decidedAt: Date, decisionComment: string | null) {
    return this.connection.db.update(designReviews).set({ status, decidedAt, decisionComment })
      .where(and(eq(designReviews.id, reviewId), eq(designReviews.status, 'PENDING'))).run().changes;
  }

  updateTaskStatus(projectId: string, featureId: string, taskId: string, expectedStatus: string, status: string, updatedAt: Date) {
    return this.connection.db.update(tasks).set({ status, updatedAt })
      .where(and(eq(tasks.projectId, projectId), eq(tasks.featureId, featureId), eq(tasks.id, taskId), eq(tasks.status, expectedStatus)))
      .run().changes;
  }

  insertAuthorization(authorization: typeof taskAuthorizations.$inferInsert) {
    this.connection.db.insert(taskAuthorizations).values(authorization).run();
  }

  listAuthorizations(projectId: string, taskId?: string) {
    const predicate = taskId
      ? and(eq(taskAuthorizations.projectId, projectId), eq(taskAuthorizations.taskId, taskId))
      : eq(taskAuthorizations.projectId, projectId);
    return this.connection.db.select().from(taskAuthorizations).where(predicate)
      .orderBy(desc(taskAuthorizations.createdAt)).all();
  }

  findAuthorization(projectId: string, taskId: string, authorizationId: string) {
    return this.connection.db.select().from(taskAuthorizations)
      .where(and(eq(taskAuthorizations.projectId, projectId), eq(taskAuthorizations.taskId, taskId), eq(taskAuthorizations.id, authorizationId))).get();
  }

  findActiveAuthorization(projectId: string, taskId: string) {
    return this.connection.db.select().from(taskAuthorizations)
      .where(and(eq(taskAuthorizations.projectId, projectId), eq(taskAuthorizations.taskId, taskId), eq(taskAuthorizations.status, 'ACTIVE'))).get();
  }

  updateAuthorizationStatus(authorizationId: string, expectedStatus: string, status: string, revokedAt: Date | null) {
    return this.connection.db.update(taskAuthorizations).set({ status, revokedAt })
      .where(and(eq(taskAuthorizations.id, authorizationId), eq(taskAuthorizations.status, expectedStatus))).run().changes;
  }

  insertRun(run: typeof aiRuns.$inferInsert) {
    this.connection.db.insert(aiRuns).values(run).run();
  }

  listRuns(projectId: string, taskId?: string) {
    const predicate = taskId
      ? and(eq(aiRuns.projectId, projectId), eq(aiRuns.taskId, taskId))
      : eq(aiRuns.projectId, projectId);
    return this.connection.db.select().from(aiRuns).where(predicate)
      .orderBy(desc(aiRuns.createdAt)).all();
  }

  findRun(projectId: string, runId: string) {
    return this.connection.db.select().from(aiRuns)
      .where(and(eq(aiRuns.projectId, projectId), eq(aiRuns.id, runId))).get();
  }

  findRunById(runId: string) {
    return this.connection.db.select().from(aiRuns).where(eq(aiRuns.id, runId)).get();
  }

  findRunningRun(projectId: string, taskId: string) {
    return this.connection.db.select().from(aiRuns)
      .where(and(eq(aiRuns.projectId, projectId), eq(aiRuns.taskId, taskId), eq(aiRuns.status, 'RUNNING'))).get();
  }

  updateRun(runId: string, expectedStatus: string, values: Partial<typeof aiRuns.$inferInsert>) {
    return this.connection.db.update(aiRuns).set(values)
      .where(and(eq(aiRuns.id, runId), eq(aiRuns.status, expectedStatus))).run().changes;
  }

  insertSpecification(specification: typeof specifications.$inferInsert) {
    this.connection.db.insert(specifications).values(specification).run();
  }

  findSpecification(projectId: string, specId: string) {
    return this.connection.db.select().from(specifications)
      .where(and(eq(specifications.projectId, projectId), eq(specifications.id, specId))).get();
  }

  findSpecificationById(specId: string) {
    return this.connection.db.select().from(specifications).where(eq(specifications.id, specId)).get();
  }

  findProjectSpecification(projectId: string, kind: string) {
    return this.connection.db.select().from(specifications)
      .where(and(eq(specifications.projectId, projectId), eq(specifications.kind, kind), isNull(specifications.featureId), isNull(specifications.capabilityId))).get();
  }

  findFeatureSpecification(projectId: string, featureId: string) {
    return this.connection.db.select().from(specifications)
      .where(and(eq(specifications.projectId, projectId), eq(specifications.featureId, featureId), isNull(specifications.capabilityId))).get();
  }

  findCapabilitySpecification(projectId: string, capabilityId: string) {
    return this.connection.db.select().from(specifications)
      .where(and(eq(specifications.projectId, projectId), eq(specifications.capabilityId, capabilityId))).get();
  }

  listSpecifications(projectId: string) {
    return this.connection.db.select({
      specification: specifications,
      latestRevisionNumber: specificationRevisions.revisionNo,
    }).from(specifications)
      .leftJoin(specificationRevisions, eq(specifications.latestRevisionId, specificationRevisions.id))
      .where(eq(specifications.projectId, projectId))
      .orderBy(specifications.createdAt, specifications.title).all();
  }

  findRevision(specId: string, revisionId: string) {
    return this.connection.db.select().from(specificationRevisions)
      .where(and(eq(specificationRevisions.specId, specId), eq(specificationRevisions.id, revisionId))).get();
  }

  listRevisions(specId: string) {
    return this.connection.db.select({
      id: specificationRevisions.id,
      specId: specificationRevisions.specId,
      revisionNo: specificationRevisions.revisionNo,
      contentHash: specificationRevisions.contentHash,
      source: specificationRevisions.source,
      changeSummary: specificationRevisions.changeSummary,
      createdAt: specificationRevisions.createdAt,
    }).from(specificationRevisions)
      .where(eq(specificationRevisions.specId, specId))
      .orderBy(desc(specificationRevisions.revisionNo)).all();
  }

  insertRevision(revision: typeof specificationRevisions.$inferInsert) {
    this.connection.db.insert(specificationRevisions).values(revision).run();
  }

  pointToRevision(specId: string, expectedId: string | null, revisionId: string) {
    const expected = expectedId === null
      ? isNull(specifications.latestRevisionId)
      : eq(specifications.latestRevisionId, expectedId);
    return this.connection.db.update(specifications)
      .set({ latestRevisionId: revisionId })
      .where(and(eq(specifications.id, specId), expected)).run().changes;
  }

  pointToApprovedRevision(specId: string, revisionId: string) {
    return this.connection.db.update(specifications).set({ approvedRevisionId: revisionId })
      .where(eq(specifications.id, specId)).run().changes;
  }

  hasProjectWorkEvents(projectId: string): boolean {
    return Boolean(this.connection.sqlite.prepare('SELECT 1 FROM rd_work_event WHERE project_id = ? LIMIT 1').get(projectId));
  }

  deleteProject(projectId: string) {
    return this.transaction(() => {
      const sqlite = this.connection.sqlite;
      sqlite.pragma('foreign_keys = OFF');
      try {
        sqlite.prepare('DELETE FROM rd_trace_link WHERE project_id = ?').run(projectId);
        sqlite.prepare('DELETE FROM rd_ai_run WHERE project_id = ?').run(projectId);
        sqlite.prepare('DELETE FROM rd_task_authorization WHERE project_id = ?').run(projectId);
        sqlite.prepare('DELETE FROM rd_task WHERE project_id = ?').run(projectId);
        sqlite.prepare(`
          DELETE FROM rd_engineering_asset_revision
          WHERE asset_id IN (SELECT id FROM rd_engineering_asset WHERE project_id = ?)
        `).run(projectId);
        sqlite.prepare('DELETE FROM rd_engineering_asset WHERE project_id = ?').run(projectId);
        sqlite.prepare('DELETE FROM rd_design_review WHERE project_id = ?').run(projectId);
        sqlite.prepare(`
          DELETE FROM rd_spec_revision
          WHERE spec_id IN (SELECT id FROM rd_spec WHERE project_id = ?)
        `).run(projectId);
        sqlite.prepare('DELETE FROM rd_spec WHERE project_id = ?').run(projectId);
        sqlite.prepare('DELETE FROM rd_capability WHERE project_id = ?').run(projectId);
        sqlite.prepare('DELETE FROM rd_feature WHERE project_id = ?').run(projectId);
        sqlite.prepare('DELETE FROM rd_module WHERE project_id = ?').run(projectId);
        sqlite.prepare('DELETE FROM rd_source_analysis WHERE project_id = ?').run(projectId);
        sqlite.prepare('DELETE FROM rd_project_source WHERE project_id = ?').run(projectId);
        const res = sqlite.prepare('DELETE FROM rd_project WHERE id = ?').run(projectId);
        return res.changes;
      } finally {
        sqlite.pragma('foreign_keys = ON');
      }
    });
  }

  deleteModule(projectId: string, moduleId: string) {
    return this.transaction(() => {
      const sqlite = this.connection.sqlite;
      sqlite.pragma('foreign_keys = OFF');
      try {
        const featureIds = (sqlite.prepare('SELECT id FROM rd_feature WHERE project_id = ? AND module_id = ?').all(projectId, moduleId) as Array<{ id: string }>).map((row) => row.id);
        for (const featureId of featureIds) {
          sqlite.prepare('DELETE FROM rd_trace_link WHERE project_id = ? AND (source_id = ? OR target_id = ?)').run(projectId, featureId, featureId);
          sqlite.prepare('DELETE FROM rd_ai_run WHERE feature_id = ?').run(featureId);
          sqlite.prepare('DELETE FROM rd_task_authorization WHERE feature_id = ?').run(featureId);
          sqlite.prepare('DELETE FROM rd_task WHERE feature_id = ?').run(featureId);
          sqlite.prepare(`
            DELETE FROM rd_engineering_asset_revision
            WHERE asset_id IN (SELECT id FROM rd_engineering_asset WHERE feature_id = ?)
          `).run(featureId);
          sqlite.prepare('DELETE FROM rd_engineering_asset WHERE feature_id = ?').run(featureId);
          sqlite.prepare(`
            DELETE FROM rd_spec_revision
            WHERE spec_id IN (SELECT id FROM rd_spec WHERE feature_id = ?)
          `).run(featureId);
          sqlite.prepare('DELETE FROM rd_spec WHERE feature_id = ?').run(featureId);
          sqlite.prepare('DELETE FROM rd_capability WHERE feature_id = ?').run(featureId);
          sqlite.prepare('DELETE FROM rd_feature WHERE id = ?').run(featureId);
        }
        const res = sqlite.prepare('DELETE FROM rd_module WHERE project_id = ? AND id = ?').run(projectId, moduleId);
        return res.changes;
      } finally {
        sqlite.pragma('foreign_keys = ON');
      }
    });
  }

  deleteFeature(projectId: string, featureId: string) {
    return this.transaction(() => {
      const sqlite = this.connection.sqlite;
      sqlite.pragma('foreign_keys = OFF');
      try {
        sqlite.prepare('DELETE FROM rd_trace_link WHERE project_id = ? AND (source_id = ? OR target_id = ?)').run(projectId, featureId, featureId);
        sqlite.prepare('DELETE FROM rd_ai_run WHERE feature_id = ?').run(featureId);
        sqlite.prepare('DELETE FROM rd_task_authorization WHERE feature_id = ?').run(featureId);
        sqlite.prepare('DELETE FROM rd_task WHERE feature_id = ?').run(featureId);
        sqlite.prepare(`
          DELETE FROM rd_engineering_asset_revision
          WHERE asset_id IN (SELECT id FROM rd_engineering_asset WHERE feature_id = ?)
        `).run(featureId);
        sqlite.prepare('DELETE FROM rd_engineering_asset WHERE feature_id = ?').run(featureId);
        sqlite.prepare(`
          DELETE FROM rd_spec_revision
          WHERE spec_id IN (SELECT id FROM rd_spec WHERE feature_id = ?)
        `).run(featureId);
        sqlite.prepare('DELETE FROM rd_spec WHERE feature_id = ?').run(featureId);
        sqlite.prepare('DELETE FROM rd_capability WHERE feature_id = ?').run(featureId);
        const res = sqlite.prepare('DELETE FROM rd_feature WHERE project_id = ? AND id = ?').run(projectId, featureId);
        return res.changes;
      } finally {
        sqlite.pragma('foreign_keys = ON');
      }
    });
  }

  deleteProjectSource(projectId: string, sourceId: string) {
    return this.transaction(() => {
      const sqlite = this.connection.sqlite;
      sqlite.pragma('foreign_keys = OFF');
      try {
        sqlite.prepare('DELETE FROM rd_source_analysis WHERE project_id = ? AND requested_source_ids_json LIKE ?').run(projectId, `%${sourceId}%`);
        const res = sqlite.prepare('DELETE FROM rd_project_source WHERE project_id = ? AND id = ?').run(projectId, sourceId);
        return res.changes;
      } finally {
        sqlite.pragma('foreign_keys = ON');
      }
    });
  }
}
