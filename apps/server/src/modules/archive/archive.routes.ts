import type { FastifyInstance } from 'fastify';
import type { ArchiveDocumentInput, ArchiveDocumentUpdateInput, WorkEventInput } from '@forgeflow/contracts';
import type { AuthService } from '../security/auth.service.js';
import type { ArchiveService } from './archive.service.js';

export function registerArchiveRoutes(app: FastifyInstance, archive: ArchiveService, auth: AuthService) {
  type ProjectParams = { projectId: string };
  type DocumentParams = ProjectParams & { documentId: string };
  const base = '/api/projects/:projectId/archive';
  app.get<{ Params: ProjectParams }>(`${base}/documents`, async (request) => {
    await auth.require(request, 'project:read', true);
    await auth.require(request, 'spec:read', true);
    return archive.listDocuments(request.params.projectId);
  });
  app.get<{ Params: DocumentParams }>(`${base}/documents/:documentId`, async (request) => {
    await auth.require(request, 'project:read', true);
    await auth.require(request, 'spec:read', true);
    return archive.getDocument(request.params.projectId, request.params.documentId);
  });
  app.get<{ Params: DocumentParams }>(`${base}/documents/:documentId/revisions`, async (request) => {
    await auth.require(request, 'project:read', true);
    await auth.require(request, 'spec:read', true);
    return archive.getDocumentHistory(request.params.projectId, request.params.documentId);
  });
  app.post<{ Params: ProjectParams; Body: ArchiveDocumentInput }>(`${base}/documents`, { bodyLimit: 2_100_000 }, async (request, reply) => {
    const principal = await auth.require(request, 'spec:write', true);
    return reply.code(201).send(archive.createDocument(request.params.projectId, request.body, principal));
  });
  app.patch<{ Params: DocumentParams; Body: ArchiveDocumentUpdateInput }>(`${base}/documents/:documentId`, { bodyLimit: 2_100_000 }, async (request) => {
    const principal = await auth.require(request, 'spec:write', true);
    return archive.updateDocument(request.params.projectId, request.params.documentId, request.body, principal);
  });
  app.get<{ Params: ProjectParams; Querystring: { before?: string; limit?: string; workId?: string } }>(`${base}/events`, async (request) => {
    await auth.require(request, 'project:read', true);
    await auth.require(request, 'spec:read', true);
    return archive.listEvents(request.params.projectId, { before: request.query.before === undefined ? undefined : Number(request.query.before),
      limit: request.query.limit === undefined ? undefined : Number(request.query.limit), workId: request.query.workId });
  });
  app.post<{ Params: ProjectParams; Body: WorkEventInput }>(`${base}/events`, async (request, reply) => {
    const principal = await auth.require(request, 'spec:write', true);
    const result = archive.appendEvent(request.params.projectId, request.body, principal);
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
  app.get<{ Params: ProjectParams }>(`${base}/export`, async (request, reply) => {
    await auth.require(request, 'project:read', true);
    await auth.require(request, 'spec:read', true);
    await auth.require(request, 'task:read', true);
    const snapshot = archive.exportProject(request.params.projectId);
    return reply.header('Content-Disposition', 'attachment; filename="forgeflow-project-archive.json"').send(snapshot);
  });
}
