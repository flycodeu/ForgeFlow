import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isDebug = process.argv.includes('--debug');
const profile = isDebug ? 'debug' : 'release';
const skipCargo = process.argv.includes('--skip-cargo');

function step(num, title) {
  console.log(`\n\x1b[1;36m[ForgeFlow Desktop Packaging] Step ${num}: ${title}\x1b[0m`);
}

function runCommand(command, args, cwd = root, extraEnv = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  const isWindows = process.platform === 'win32';
  const executable = isWindows && !command.endsWith('.exe') && !command.endsWith('.cmd') ? `${command}.cmd` : command;
  const result = spawnSync(executable, args, {
    cwd,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.error && executable.endsWith('.cmd')) {
    // Fallback if .cmd doesn't exist
    const fallback = spawnSync(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    });
    if (fallback.error) throw fallback.error;
    if (fallback.status !== 0) {
      throw new Error(`Command failed with exit code ${fallback.status}: ${command} ${args.join(' ')}`);
    }
    return;
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${command} ${args.join(' ')}`);
  }
}

try {
  console.log('\x1b[1;32m========================================================\x1b[0m');
  console.log(`\x1b[1;32m  ForgeFlow 桌面端完整统一打包流水线 (Profile: ${profile})  \x1b[0m`);
  console.log('\x1b[1;32m========================================================\x1b[0m');

  // 1. 构建 Web 前端与 Server 核心包
  step(1, '构建 Web 与 Server 工作空间 (pnpm build)');
  runCommand('pnpm', ['build']);

  // 2. 准备生产运行时环境 (包含 Node 依赖、Migrations、服务脚本及 better-sqlite3 烟雾测试)
  step(2, '装配桌面端生产运行时 (desktop:prepare)');
  runCommand('node', ['scripts/desktop-prepare.mjs']);

  // 3. 编译 Tauri Rust 桌面可执行文件
  step(3, `编译 Tauri 桌面端主程序 (Profile: ${profile})`);
  if (!skipCargo) {
    const cargoArgs = ['build', '--locked', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml'];
    if (!isDebug) {
      cargoArgs.push('--release');
    }
    runCommand('cargo', cargoArgs);
  } else {
    console.log('(--skip-cargo specified, skipping cargo build)');
  }

  // 4. 打包便携版目录 (apps/desktop/dist/ForgeFlow)
  step(4, '组装便携版运行目录 (desktop:package)');
  const packageArgs = ['scripts/desktop-package.mjs'];
  if (!isDebug) {
    packageArgs.push('--release');
  }
  runCommand('node', packageArgs);

  // 5. 编译 Windows 安装程序 (NSIS Setup .exe)
  step(5, '编译 Windows 安装向导 (installer:build)');
  runCommand('node', ['scripts/installer-build.mjs']);

  // 6. 校验与输出结果摘要
  step(6, '打包完成与安装包校验');
  const pkgJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const version = pkgJson.version;
  const installerPath = join(root, 'apps/desktop/dist', `ForgeFlow-Setup-${version}.exe`);
  const installerStat = await stat(installerPath);
  const fileBytes = await readFile(installerPath);
  const sha256 = createHash('sha256').update(fileBytes).digest('hex');

  const mb = (installerStat.size / (1024 * 1024)).toFixed(2);
  console.log('\n\x1b[1;32m✓ 桌面端全流程打包完成！\x1b[0m');
  console.log(`- 便携版目录:   ${join(root, 'apps/desktop/dist/ForgeFlow')}`);
  console.log(`- 官方安装程序: ${installerPath}`);
  console.log(`- 文件体积:     ${mb} MB (${installerStat.size} 字节)`);
  console.log(`- SHA256:       ${sha256}`);
  console.log('\x1b[1;33m提示: 该安装包已内置就地覆盖升级逻辑，支持在已有安装路径上直接更新。\x1b[0m\n');
} catch (err) {
  console.error('\n\x1b[1;31m✖ 桌面端打包失败:\x1b[0m', err.message || err);
  process.exit(1);
}
