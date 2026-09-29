import { createHash, verify } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

const releaseBase = 'https://github.com/flycodeu/ForgeFlow/releases';
const publicKey = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAohOeaeCwcaTlBoWOhjPG2RkMVt1rMyOh4KSAhnGOZpE=
-----END PUBLIC KEY-----`;
const maxInstallerBytes = 500 * 1024 * 1024;
type Manifest = { schema: 1; version: string; installer: { file: string; sha256: string; size: number }; notes: string; signature: string };
type UpdateState = { phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'; currentVersion: string; latestVersion?: string; notes?: string; received?: number; total?: number; error?: string };

export function newer(candidate: string, current: string) {
  const parse = (value: string) => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(Number) : null;
  const a = parse(candidate); const b = parse(current);
  if (!a || !b) throw new Error('版本格式无效');
  return a[0]! > b[0]! || a[0] === b[0] && (a[1]! > b[1]! || a[1] === b[1] && a[2]! > b[2]!);
}

export function verifyManifest(raw: string, key = publicKey): Manifest {
  if (raw.length > 65536) throw new Error('版本清单过大');
  const manifest = JSON.parse(raw) as Manifest;
  const { schema, version, installer, notes, signature } = manifest;
  if (schema !== 1 || !/^\d+\.\d+\.\d+$/.test(version)
    || installer?.file !== `ForgeFlow-Setup-${version}.exe`
    || !/^[a-f0-9]{64}$/.test(installer.sha256)
    || !Number.isSafeInteger(installer.size) || installer.size < 1 || installer.size > maxInstallerBytes
    || typeof notes !== 'string' || notes.length > 10000 || typeof signature !== 'string') throw new Error('版本清单格式无效');
  const payload = JSON.stringify({ schema, version, installer, notes });
  if (!verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64'))) throw new Error('版本清单签名校验失败');
  return manifest;
}

export class DesktopUpdateService {
  private state: UpdateState;
  private manifest: Manifest | null = null;
  private installerPath: string | null = null;
  private downloading: Promise<void> | null = null;
  constructor(version: string, private readonly requestInstall: (path: string) => void) {
    this.state = { phase: 'idle', currentVersion: version };
  }
  status() { return { ...this.state }; }
  async check() {
    if (this.downloading) throw new Error('更新包正在下载');
    this.state = { phase: 'checking', currentVersion: this.state.currentVersion };
    try {
      const response = await fetch(`${releaseBase}/latest/download/latest.json`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'ForgeFlow-Updater' } });
      if (!response.ok) throw new Error(response.status === 404 ? '暂无可用的正式发布版本' : `版本服务返回 HTTP ${response.status}`);
      const manifest = verifyManifest(await response.text());
      const { version, notes } = manifest;
      this.manifest = manifest;
      this.installerPath = null;
      this.state = { phase: newer(version, this.state.currentVersion) ? 'available' : 'current', currentVersion: this.state.currentVersion,
        latestVersion: version, notes };
      return this.status();
    } catch (error) {
      this.state = { phase: 'error', currentVersion: this.state.currentVersion, error: error instanceof Error ? error.message : '检查版本失败' };
      throw error;
    }
  }
  startDownload() {
    if (this.state.phase !== 'available' || !this.manifest || this.downloading) throw new Error('请先检查可用的新版本');
    const manifest = this.manifest;
    this.state = { ...this.state, phase: 'downloading', received: 0, total: manifest.installer.size };
    this.downloading = this.download(manifest).catch((error) => {
      this.state = { ...this.state, phase: 'error', error: error instanceof Error ? error.message : '下载失败' };
    }).finally(() => { this.downloading = null; });
    return this.status();
  }
  private async download(manifest: Manifest) {
    const directory = join(tmpdir(), 'ForgeFlow-updates');
    await mkdir(directory, { recursive: true });
    const destination = join(directory, manifest.installer.file);
    const partial = `${destination}.part`;
    await rm(partial, { force: true });
    try {
      const url = `${releaseBase}/download/v${manifest.version}/${manifest.installer.file}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60 * 1000), headers: { 'User-Agent': 'ForgeFlow-Updater' } });
      if (!response.ok || !response.body) throw new Error(`安装包下载失败（HTTP ${response.status}）`);
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > maxInstallerBytes) throw new Error('安装包超过允许大小');
      const hash = createHash('sha256');
      let received = 0;
      await pipeline(Readable.fromWeb(response.body as never), new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
        received += chunk.length;
        if (received > maxInstallerBytes || received > manifest.installer.size) { callback(new Error('安装包大小与清单不符')); return; }
        hash.update(chunk);
        this.state = { ...this.state, received };
        callback(null, chunk);
      } }), createWriteStream(partial, { flags: 'wx' }));
      if (received !== manifest.installer.size || hash.digest('hex') !== manifest.installer.sha256) throw new Error('安装包校验失败，请重试');
      await rm(destination, { force: true });
      await rename(partial, destination);
      this.installerPath = destination;
      this.state = { ...this.state, phase: 'ready', received, total: received };
    } catch (error) { await rm(partial, { force: true }); throw error; }
  }
  async install() {
    if (this.state.phase !== 'ready' || !this.installerPath || !this.manifest) throw new Error('更新包尚未准备好');
    if ((await stat(this.installerPath)).size !== this.manifest.installer.size
      || createHash('sha256').update(await readFile(this.installerPath)).digest('hex') !== this.manifest.installer.sha256) throw new Error('安装包校验失败');
    this.requestInstall(this.installerPath);
    this.state = { ...this.state, phase: 'installing' };
    return this.status();
  }
}
