import { execFileSync, spawn } from 'node:child_process';

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) {
  throw new Error('无法定位 pnpm CLI，请通过 pnpm dev 启动开发环境。');
}

const services = [
  { name: 'server', packageName: '@forgeflow/server' },
  { name: 'web', packageName: '@forgeflow/web' },
];

const children = services.map((service) => ({
  ...service,
  process: spawn(process.execPath, [pnpmCli, '--filter', service.packageName, 'dev'], {
    stdio: 'inherit',
    windowsHide: true,
  }),
}));

let stopping = false;

function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // The process may already have exited after another child stopped.
    }
    return;
  }
  child.kill('SIGTERM');
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopProcessTree(child.process);
  process.exitCode = code;
}

for (const service of children) {
  service.process.on('error', (error) => {
    console.error(`[dev] ${service.name} 启动失败：`, error);
    stop(1);
  });
  service.process.on('exit', (code, signal) => {
    if (stopping) return;
    const reason = signal ? `signal ${signal}` : `exit ${code ?? 1}`;
    console.error(`[dev] ${service.name} 已退出（${reason}），正在关闭其余开发进程。`);
    stop(code && code > 0 ? code : 1);
  });
}

process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
process.on('exit', () => {
  for (const child of children) stopProcessTree(child.process);
});
