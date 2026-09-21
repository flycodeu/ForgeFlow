import { timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../../shared/api-error.js';

export type RuntimeOptions = { desktopSecret?: string; instanceId?: string; webDist?: string; dataPath?: string; storageOverride?: boolean; openStorage?: () => void };
const cookieName = 'forgeflow_desktop';
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
function matches(actual: unknown, expected: string) {
  return typeof actual === 'string' && Buffer.byteLength(actual) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function registerRuntime(app: FastifyInstance, options: RuntimeOptions, authenticateAi?: (request: FastifyRequest) => unknown) {
  const { desktopSecret, instanceId, webDist } = options;
  if (desktopSecret && (desktopSecret.length < 32 || !instanceId)) throw new Error('Invalid desktop runtime identity');
  app.addHook('preValidation', async (request, reply) => {
    let host: URL;
    try { host = new URL(`http://${request.headers.host}`); }
    catch { throw new ApiError(403, 'INVALID_HOST', '仅允许本机访问'); }
    if (!loopback.has(host.hostname) || host.username || host.password || host.pathname !== '/') {
      throw new ApiError(403, 'INVALID_HOST', '仅允许本机访问');
    }
    const origin = request.headers.origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (!loopback.has(parsed.hostname) || parsed.protocol !== 'http:'
          || (desktopSecret && parsed.host !== host.host)) throw new Error();
      } catch { throw new ApiError(403, 'INVALID_ORIGIN', '拒绝来自其他站点的请求'); }
    }
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer');
    if (!desktopSecret) return;
    const path = request.url.split('?')[0]!;
    if (!(path.startsWith('/api/') || path === '/mcp' || path.startsWith('/mcp/'))) return;
    if (matches(request.headers['x-forgeflow-desktop'], desktopSecret)
      || matches(request.cookies[cookieName], desktopSecret)) return;
    const aiRoute = path === '/mcp' || path.startsWith('/mcp/') || path === '/api/projects' || path.startsWith('/api/projects/') || path.startsWith('/api/features/');
    // Verify credentials here; handlers still enforce each operation's scopes.
    // Never let Bearer credentials enter owner bootstrap or native system routes.
    if (aiRoute && authenticateAi && request.headers.authorization?.startsWith('Bearer ffai_')) {
      authenticateAi(request); return;
    }
    throw new ApiError(401, 'DESKTOP_SESSION_REQUIRED', '桌面连接已失效，请从托盘重新打开');
  });
  app.get('/api/runtime/identity', async () => ({ protocolVersion: 1, mode: desktopSecret ? 'desktop' : 'web', instanceId: instanceId ?? null }));
  app.get('/api/runtime/storage', async () => ({ desktop: !!desktopSecret, dataPath: desktopSecret ? options.dataPath ?? null : null, canManage: !!options.openStorage, override: !!options.storageOverride }));
  if (desktopSecret) {
    app.post('/api/runtime/storage/open', async () => {
      if (!options.openStorage) throw new ApiError(503, 'HOST_UNAVAILABLE', '请从桌面托盘打开数据存储设置');
      options.openStorage(); return { opened: true };
    });
    app.post('/api/runtime/session', async (request, reply) => {
      if (!matches(request.headers['x-forgeflow-desktop'], desktopSecret)) throw new ApiError(401, 'DESKTOP_SESSION_REQUIRED', '需要本机运行凭证');
      reply.setCookie(cookieName, desktopSecret, { httpOnly: true, sameSite: 'strict', path: '/', secure: false });
      return { ready: true };
    });
    app.post('/api/runtime/shutdown', async (request, reply) => {
      if (!matches(request.headers['x-forgeflow-desktop'], desktopSecret)) throw new ApiError(403, 'FORBIDDEN', '仅宿主可以关闭服务');
      reply.send({ stopping: true });
      setImmediate(() => { void app.close(); });
    });
  }
  if (webDist) {
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
    app.get('/*', async (request, reply) => {
      const root = await realpath(webDist);
      let pathname: string;
      try { pathname = decodeURIComponent(request.url.split('?')[0]!); }
      catch { throw new ApiError(400, 'INVALID_PATH', '路径无效'); }
      if (pathname !== '/' && !pathname.startsWith('/assets/') && pathname !== '/favicon.ico') return reply.code(404).send();
      const file = resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
      try {
        const actual = await realpath(file);
        const child = relative(root, actual);
        if (child.startsWith('..') || isAbsolute(child) || !(await stat(actual)).isFile() || !types[extname(actual)]) return reply.code(404).send();
        reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
        return reply.type(types[extname(actual)]!).header('Cache-Control', 'no-cache').send(await readFile(actual));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send();
        throw error;
      }
    });
  }
}
