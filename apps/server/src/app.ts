import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type { HealthResponse } from '@forgeflow/contracts';
import { openDatabase } from './db/client.js';
import { ApiError } from './shared/api-error.js';
import { AuthRepository } from './modules/security/auth.repository.js';
import { registerAuthRoutes } from './modules/security/auth.routes.js';
import { AuthService } from './modules/security/auth.service.js';
import { WorkspaceRepository } from './modules/workspace/workspace.repository.js';
import { registerWorkspaceRoutes } from './modules/workspace/workspace.routes.js';
import { WorkspaceService } from './modules/workspace/workspace.service.js';
import { registerMcpRoutes } from './modules/mcp/mcp.routes.js';

export function createApp(databasePath?: string) {
  const connection = openDatabase(databasePath);
  const { sqlite } = connection;
  const app = Fastify({ logger: true });
  app.register(cookie);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, ...error.details } });
    }
    const clientStatus = typeof error === 'object' && error !== null && 'statusCode' in error
      && typeof error.statusCode === 'number' ? error.statusCode : 500;
    const status = clientStatus >= 400 && clientStatus < 500 ? clientStatus : 500;
    if (status === 500) app.log.error(error);
    return reply.code(status).send({ error: {
      code: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_INPUT',
      message: status === 500 ? '服务器处理失败' : error instanceof Error ? error.message : '请求无效',
    } });
  });
  const auth = new AuthService(new AuthRepository(connection));
  const workspace = new WorkspaceService(new WorkspaceRepository(connection));
  registerAuthRoutes(app, auth);
  registerWorkspaceRoutes(app, workspace, auth);
  registerMcpRoutes(app, workspace, auth);

  app.addHook('onClose', async () => {
    sqlite.close();
  });

  app.get<{ Reply: HealthResponse }>('/api/health', async (_request, reply) => {
    try {
      const row = sqlite.prepare('SELECT 1 AS ok').get() as { ok: number };
      if (row.ok !== 1) throw new Error('Database probe returned an unexpected result');
      return { status: 'ok', service: 'forgeflow-server', database: 'ok' };
    } catch (error) {
      app.log.error(error, 'Database health check failed');
      return reply.code(503).send({ status: 'error', service: 'forgeflow-server', database: 'error' });
    }
  });

  return app;
}
