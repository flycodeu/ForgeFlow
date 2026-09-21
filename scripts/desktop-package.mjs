import { cp, copyFile, mkdir, access, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'apps/desktop/dist/ForgeFlow');
const profile = process.argv.includes('--release') ? 'release' : 'debug';
const binary = join(root, 'apps/desktop/src-tauri/target', profile, 'forgeflow-desktop.exe');
await access(binary);
await access(join(root, 'apps/desktop/runtime/node.exe'));
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await copyFile(binary, join(target, 'ForgeFlow.exe'));
await cp(join(root, 'apps/desktop/runtime'), join(target, 'runtime'), { recursive: true });
await copyFile(join(root, 'apps/desktop/README.md'), join(target, 'README.md'));
console.log(`Portable ${profile} package: ${target}`);
