import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { openDatabase } from '../../db/client.js';
import { features, modules, projects, specificationRevisions, specifications } from '../../db/schema.js';

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
