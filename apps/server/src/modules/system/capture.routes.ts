import { dirname, join, resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../security/auth.service.js';
import type { WorkspaceService } from '../workspace/workspace.service.js';
import { ApiError } from '../../shared/api-error.js';

type CaptureConfig = { version: 1; enabled: boolean; projectId: string; workspaceRoot: string; serverUrl: string; sources: Array<{ kind: 'codex' | 'claude'; directory: string }>; includeHistory?: boolean; since?: string };
type CaptureState = { configured: boolean; config: CaptureConfig | null; pendingCount?: number; blockedCount?: number; lastError?: string | null };
type CaptureModule = {
  captureStatus(directory: string): Promise<CaptureState>;
  configureCapture(directory: string, config: CaptureConfig): Promise<unknown>;
  pollCapture(directory: string): Promise<unknown>;
  flushCapture(directory: string, options: { headers?: Record<string, string>; force?: boolean; maxItems?: number }): Promise<unknown>;
};
const configSchema = z.object({ enabled: z.boolean(), workspaceRoot: z.string().min(1).max(2048),
  sources: z.array(z.object({ kind: z.enum(['codex', 'claude']), directory: z.string().min(1).max(2048) }).strict()).max(8), includeHistory: z.boolean().default(false) }).strict();

export function registerCaptureRoutes(app: FastifyInstance, auth: AuthService, workspace: WorkspaceService, databasePath: string, desktopSecret?: string) {
  const directory = resolve(dirname(databasePath), 'capture');
  const stateDir = (id: string) => join(directory, id);
  let modulePromise: Promise<CaptureModule> | undefined;
  const bridge = () => modulePromise ??= import(new URL('../../../../../scripts/lib/session-capture.mjs', import.meta.url).href) as Promise<CaptureModule>;
  let serverUrl = '';
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  const locks = new Set<string>();
  const errors = new Map<string, string>();
  async function exclusive<T>(id: string, action: () => Promise<T>) {
    if (locks.has(id)) throw new ApiError(409, 'CAPTURE_BUSY', '正在同步，请稍后重试');
    locks.add(id);
    try { return await action(); } finally { locks.delete(id); }
  }
  async function execute(id: string, force = false) {
    if (process.env.FORGEFLOW_STORAGE_PENDING === '1') return;
    if (!serverUrl) throw new ApiError(503, 'CAPTURE_OFFLINE', '服务未开始监听');
    const module = await bridge();
    let status = await module.captureStatus(stateDir(id));
    if (!status.config?.enabled) return status;
    if (status.config.serverUrl !== serverUrl) {
      await module.configureCapture(stateDir(id), { ...status.config, serverUrl });
    }
    await module.pollCapture(stateDir(id));
    await module.flushCapture(stateDir(id), { force, maxItems: 50, headers: desktopSecret ? { 'X-ForgeFlow-Desktop': desktopSecret } : {} });
    status = await module.captureStatus(stateDir(id));
    errors.delete(id);
    return status;
  }
  async function background() {
    try {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (stopping) break;
        if (!entry.isDirectory() || !z.uuid().safeParse(entry.name).success || locks.has(entry.name)) continue;
        try {
          workspace.getProject(entry.name); // Deleted projects must never keep collecting.
          await exclusive(entry.name, () => execute(entry.name));
        } catch (cause) { errors.set(entry.name, cause instanceof Error ? cause.message : '自动采集失败'); }
      }
    } finally { if (!stopping) { timer = setTimeout(() => { running = background(); }, 5000); timer.unref(); } }
  }
  app.addHook('onListen', async () => {
    const address = app.server.address();
    if (address && typeof address !== 'string') serverUrl = `http://127.0.0.1:${address.port}`;
    timer = setTimeout(() => { running = background(); }, 5000); timer.unref();
  });
  app.addHook('onClose', async () => { stopping = true; if (timer) clearTimeout(timer); await running; });
  type Params = { projectId: string };
  const base = '/api/projects/:projectId/capture';
  async function validateProject(id: string) {
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_INPUT', '项目标识无效');
    workspace.getProject(id);
  }
  app.get<{ Params: Params }>(base, async (request) => {
    await auth.require(request, 'owner', true); await validateProject(request.params.projectId);
    const result = await (await bridge()).captureStatus(stateDir(request.params.projectId));
    return { ...result, lastError: errors.get(request.params.projectId) ?? result.lastError ?? null, running: locks.has(request.params.projectId) };
  });
  app.put<{ Params: Params }>(base, async (request) => {
    await auth.require(request, 'owner', true); await validateProject(request.params.projectId);
    const input = configSchema.safeParse(request.body);
    if (!input.success) throw new ApiError(400, 'INVALID_INPUT', '采集设置无效');
    return exclusive(request.params.projectId, async () => {
      const module = await bridge();
      try {
        await module.configureCapture(stateDir(request.params.projectId), { version: 1, ...input.data, projectId: request.params.projectId, serverUrl: serverUrl || 'http://127.0.0.1:8787' });
      } catch (cause) { throw new ApiError(400, 'INVALID_CAPTURE_CONFIG', cause instanceof Error ? cause.message : '采集设置无效'); }
      return module.captureStatus(stateDir(request.params.projectId));
    });
  });
  app.post<{ Params: Params }>(`${base}/sync`, async (request) => {
    await auth.require(request, 'owner', true); await validateProject(request.params.projectId);
    return exclusive(request.params.projectId, () => execute(request.params.projectId, true));
  });
}
