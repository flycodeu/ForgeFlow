import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AddressInfo } from 'node:net';
import type { AiScope } from '@forgeflow/contracts';
import { ApiError } from '../../shared/api-error.js';
import { AuthService, SESSION_COOKIE, SESSION_MAX_AGE } from './auth.service.js';
import { importLocalClient } from './local-client-import.js';

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_INPUT', '请求内容必须是 JSON 对象');
  return value as Record<string, unknown>;
}
function requiredString(body: Record<string, unknown>, field: string, max: number) {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, 'INVALID_INPUT', `${field} 无效`);
  return value.trim();
}
function setSession(reply: FastifyReply, secret: string) {
  reply.setCookie(SESSION_COOKIE, secret, { path: '/', httpOnly: true, sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production', maxAge: SESSION_MAX_AGE });
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  app.get('/api/auth/status', async () => auth.status());
  app.post('/api/auth/initialize', async (request, reply) => {
    const body = bodyObject(request.body);
    const username = requiredString(body, 'username', 64);
    const password = body.password;
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
      throw new ApiError(400, 'INVALID_INPUT', '密码须为 12–128 个字符');
    }
    const result = await auth.initialize(username, password);
    setSession(reply, result.secret);
    return reply.code(201).send({ identity: result.identity });
  });
  app.post('/api/auth/login', async (request, reply) => {
    const body = bodyObject(request.body);
    const username = requiredString(body, 'username', 64);
    if (typeof body.password !== 'string') throw new ApiError(400, 'INVALID_INPUT', '密码无效');
    const result = await auth.login(username, body.password);
    setSession(reply, result.secret);
    return { identity: result.identity };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    await auth.require(request, 'owner');
    auth.logout(request.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });
  app.get('/api/auth/me', async (request) => ({ identity: await auth.require(request, 'owner') }));
  app.get('/api/ai-tokens', async (request) => {
    await auth.require(request, 'owner', true);
    return auth.listTokens();
  });
  app.post('/api/ai-tokens', async (request, reply) => {
    await auth.require(request, 'owner', true);
    const body = bodyObject(request.body);
    const name = requiredString(body, 'name', 120);
    if (!Array.isArray(body.scopes) || !body.scopes.every((scope) => typeof scope === 'string')) {
      throw new ApiError(400, 'INVALID_INPUT', 'scopes 无效');
    }
    return reply.code(201).send(auth.createToken(name, body.scopes as AiScope[]));
  });
  app.post('/api/ai-tokens/import-local', async (request) => {
    await auth.require(request, 'owner', true);
    const body = bodyObject(request.body);
    if (body.client !== 'codex' && body.client !== 'claude-desktop') {
      throw new ApiError(400, 'INVALID_INPUT', '仅支持 Codex 或 Claude Desktop 本机导入');
    }
    const port = request.raw.socket.localPort ?? (app.server.address() as AddressInfo | null)?.port;
    if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new ApiError(503, 'LOCAL_CLIENT_UNAVAILABLE', '无法确定本机服务监听地址');
    }
    const secret = requiredString(body, 'token', 80);
    auth.requireActiveTokenSecret(secret);
    return importLocalClient(body.client, secret, `http://127.0.0.1:${port}/mcp`);
  });
  app.post<{ Params: { tokenId: string } }>('/api/ai-tokens/:tokenId/revoke', async (request) => {
    await auth.require(request, 'owner', true);
    return auth.revokeToken(request.params.tokenId);
  });
  app.post<{ Params: { tokenId: string } }>('/api/ai-tokens/:tokenId/rotate', async (request) => {
    await auth.require(request, 'owner', true);
    return auth.rotateToken(request.params.tokenId);
  });
  app.delete<{ Params: { tokenId: string } }>('/api/ai-tokens/:tokenId', async (request) => {
    await auth.require(request, 'owner', true);
    return auth.deleteToken(request.params.tokenId);
  });
  app.post<{ Params: { tokenId: string } }>('/api/ai-tokens/:tokenId/delete', async (request) => {
    await auth.require(request, 'owner', true);
    return auth.deleteToken(request.params.tokenId);
  });
}
