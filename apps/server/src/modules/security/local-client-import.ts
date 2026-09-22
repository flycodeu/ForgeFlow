import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { ApiError } from '../../shared/api-error.js';

const run = promisify(execFile);

export async function importLocalClient(client: 'codex' | 'claude-desktop', token: string, url: string) {
  if (process.platform !== 'win32') throw new ApiError(400, 'LOCAL_CLIENT_UNSUPPORTED', '当前只支持 Windows 本机导入');
  if (!/^ffai_[A-Za-z0-9_-]+$/.test(token) || !/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/mcp$/.test(url)) {
    throw new ApiError(400, 'INVALID_INPUT', '本机连接参数无效');
  }
  if (client === 'codex') {
    const configPath = join(homedir(), '.codex', 'config.toml');
    const script = `$ErrorActionPreference = 'Stop'
& codex mcp get forgeflow 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { exit 17 }
$previous = [Environment]::GetEnvironmentVariable('FORGEFLOW_MCP_TOKEN', 'User')
try {
  [Environment]::SetEnvironmentVariable('FORGEFLOW_MCP_TOKEN', $env:FORGEFLOW_IMPORT_TOKEN, 'User')
  & codex mcp add forgeflow --url $env:FORGEFLOW_IMPORT_URL --bearer-token-env-var FORGEFLOW_MCP_TOKEN | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Codex configuration failed' }
} catch {
  [Environment]::SetEnvironmentVariable('FORGEFLOW_MCP_TOKEN', $previous, 'User')
  exit 18
}`;
    try {
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, FORGEFLOW_IMPORT_TOKEN: token, FORGEFLOW_IMPORT_URL: url },
        windowsHide: true, timeout: 30000,
      });
    } catch (cause) {
      const code = (cause as { code?: number }).code;
      if (code === 17) throw new ApiError(409, 'LOCAL_CLIENT_EXISTS', 'Codex 已存在 forgeflow 连接，请先检查或移除旧连接');
      throw new ApiError(503, 'LOCAL_CLIENT_IMPORT_FAILED', 'Codex 本机导入失败，请使用上方命令手动接入');
    }
    return { client: 'Codex', configPath };
  }

  const configPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  let config: Record<string, unknown> = {};
  let existing = false;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    existing = true;
    if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Invalid configuration');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ApiError(422, 'LOCAL_CLIENT_CONFIG_INVALID', 'Claude Desktop 配置无法解析，请先修复原配置');
    }
  }
  const servers = config.mcpServers ?? {};
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new ApiError(422, 'LOCAL_CLIENT_CONFIG_INVALID', 'Claude Desktop 的 mcpServers 配置无效');
  }
  if (Object.hasOwn(servers, 'forgeflow')) throw new ApiError(409, 'LOCAL_CLIENT_EXISTS', 'Claude Desktop 已存在 forgeflow 连接，请先检查旧配置');
  const dir = dirname(configPath);
  await mkdir(dir, { recursive: true });
  if (existing) await copyFile(configPath, `${configPath}.bak-${Date.now()}-${randomUUID()}`);
  const temp = `${configPath}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, JSON.stringify({ ...config, mcpServers: { ...servers, forgeflow: {
      url, headers: { Authorization: `Bearer ${token}` },
    } } }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, configPath);
  } finally { await rm(temp, { force: true }); }
  return { client: 'Claude Desktop', configPath };
}
