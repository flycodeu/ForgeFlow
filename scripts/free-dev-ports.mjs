import { execFileSync } from 'node:child_process';

const WEB_PORT = 5173;
const SERVER_PORT = Number(process.env.PORT ?? 8787);
const args = new Set(process.argv.slice(2));
const ports = args.has('--web')
  ? [WEB_PORT]
  : args.has('--server')
    ? [SERVER_PORT]
    : [WEB_PORT, SERVER_PORT];

for (const port of ports) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`无效的开发端口：${port}`);
  }
}

function windowsListeners() {
  const output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
  const listeners = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
    if (!match) continue;
    const portMatch = /:(\d+)$/.exec(match[1]);
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    const pid = Number(match[2]);
    if (!listeners.has(port)) listeners.set(port, new Set());
    listeners.get(port).add(pid);
  }
  return listeners;
}

function unixPids(port) {
  try {
    const output = execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' });
    return output.split(/\r?\n/).map(Number).filter(Number.isInteger);
  } catch {
    return [];
  }
}

function listenerPids(port) {
  if (process.platform === 'win32') return [...(windowsListeners().get(port) ?? [])];
  return unixPids(port);
}

function windowsProcessInfo(pid) {
  try {
    const script = [
      `$item = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"`,
      'if ($item) {',
      '  [pscustomobject]@{ parentProcessId = $item.ParentProcessId; commandLine = $item.CommandLine } | ConvertTo-Json -Compress',
      '}',
    ].join('; ');
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    return output ? JSON.parse(output) : undefined;
  } catch {
    return undefined;
  }
}

function windowsKillTarget(pid) {
  const child = windowsProcessInfo(pid);
  if (!child?.parentProcessId || !child.commandLine) return pid;

  const parent = windowsProcessInfo(child.parentProcessId);
  const command = child.commandLine.toLowerCase();
  const parentCommand = parent?.commandLine?.toLowerCase() ?? '';
  const workspace = process.cwd().toLowerCase();
  const isForgeFlowWatchChild = command.includes(workspace)
    && command.includes('tsx')
    && parentCommand.includes('tsx')
    && parentCommand.includes('watch')
    && parentCommand.includes('src/server.ts');

  return isForgeFlowWatchChild ? child.parentProcessId : pid;
}

function terminate(pid, port) {
  if (!Number.isInteger(pid) || pid <= 4 || pid === process.pid || pid === process.ppid) {
    throw new Error(`拒绝关闭端口 ${port} 的系统或当前进程 PID ${pid}`);
  }
  if (process.platform === 'win32') {
    const targetPid = windowsKillTarget(pid);
    try {
      execFileSync('taskkill.exe', ['/PID', String(targetPid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch (error) {
      if (!listenerPids(port).includes(pid)) return;
      throw new Error(`无法关闭占用端口 ${port} 的 PID ${pid}；请确认启动命令与旧进程使用同一 Windows 用户。`, {
        cause: error,
      });
    }
  } else {
    process.kill(pid, 'SIGTERM');
  }
}

const closed = [];
for (const port of [...new Set(ports)]) {
  const pids = listenerPids(port);
  for (const pid of pids) {
    terminate(pid, port);
    closed.push({ port, pid });
  }
}

let remaining = [...new Set(ports)].flatMap((port) => listenerPids(port).map((pid) => ({ port, pid })));
for (let attempt = 0; remaining.length && attempt < 10; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  remaining = [...new Set(ports)].flatMap((port) => listenerPids(port).map((pid) => ({ port, pid })));
}
if (remaining.length) {
  throw new Error(`开发端口仍被占用：${remaining.map(({ port, pid }) => `${port} (PID ${pid})`).join('、')}`);
}

if (closed.length) {
  console.log(`[dev] 已关闭旧开发进程：${closed.map(({ port, pid }) => `${port} (PID ${pid})`).join('、')}`);
} else {
  console.log(`[dev] 开发端口可用：${[...new Set(ports)].join('、')}`);
}
