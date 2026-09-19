import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { openDatabase } from '../../db/client.js';
import {
  aiRuns, features, modules, projects, specificationRevisions, specifications, taskAuthorizations, tasks,
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

  updateFeature(projectId: string, featureId: string, values: Partial<typeof features.$inferInsert>) {
    return this.connection.db.update(features).set(values)
      .where(and(eq(features.projectId, projectId), eq(features.id, featureId))).run().changes;
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

  updateTask(projectId: string, featureId: string, taskId: string, values: Partial<typeof tasks.$inferInsert>) {
    return this.connection.db.update(tasks).set(values)
      .where(and(eq(tasks.projectId, projectId), eq(tasks.featureId, featureId), eq(tasks.id, taskId))).run().changes;
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

  findFeatureSpecification(projectId: string, featureId: string) {
    return this.connection.db.select().from(specifications)
      .where(and(eq(specifications.projectId, projectId), eq(specifications.featureId, featureId))).get();
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
}
