import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { bootstrapPath, readStorageChoice } from './desktop-storage.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function localUrl(value, desktop = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('本机服务地址无效；未发送请求。'); }
  if (!(desktop ? url.hostname === '127.0.0.1' && url.protocol === 'http:'
    : ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port === '0') {
    throw new Error('本机服务地址必须是无凭证、路径和参数的回环地址；未发送请求。');
  }
  return url.origin;
}
function runtime(url, source, secret, instanceId) {
  // Keep the secret out of enumerable metadata, CLI status and JSON serialization.
  return { url, source, ...(instanceId ? { instanceId } : {}),
    getHeaders: () => secret ? { 'X-ForgeFlow-Desktop': secret } : {} };
}

export async function discoverArchiveRuntime({ env = process.env, fetch: fetcher = fetch, fallbackUrl = 'http://127.0.0.1:8787' } = {}) {
  if (env.FORGEFLOW_URL !== undefined) return runtime(localUrl(env.FORGEFLOW_URL), 'explicit');
  let dataPath = null; let configured = false;
  if (env.FORGEFLOW_DATA_DIR) { dataPath = resolve(env.FORGEFLOW_DATA_DIR); configured = true; }
  else if (env.FORGEFLOW_CONFIG_DIR || env.LOCALAPPDATA) {
    let choice;
    try { choice = await readStorageChoice({ env }); }
    catch { throw new Error('桌面存储配置无法读取；未连接其他实例，队列仍保留。'); }
    configured = Boolean(choice.dataPath);
    dataPath = choice.dataPath ?? bootstrapPath(env);
  }
  if (!dataPath) return runtime(localUrl(fallbackUrl), 'development');
  const descriptorPath = join(dataPath, 'runtime.json');
  let bytes;
  try {
    const info = await stat(descriptorPath);
    if (!info.isFile() || info.size > 16384) throw new Error('INVALID_DESCRIPTOR_SIZE');
    bytes = await readFile(descriptorPath);
    if (bytes.length > 16384) throw new Error('INVALID_DESCRIPTOR_SIZE');
  } catch (error) {
    if (error.code === 'ENOENT' && !configured) return runtime(localUrl(fallbackUrl), 'development');
    throw new Error('桌面运行信息无法读取；未连接其他实例，队列仍保留。');
  }
  let descriptor;
  try { descriptor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('桌面运行信息格式无效；未连接其他实例，队列仍保留。'); }
  if (descriptor?.protocol !== 1 || typeof descriptor.url !== 'string' || !uuid.test(descriptor.instanceId)
    || typeof descriptor.secret !== 'string' || !/^[a-f0-9]{64}$/i.test(descriptor.secret)) {
    throw new Error('桌面运行信息字段无效；未连接其他实例，队列仍保留。');
  }
  const url = localUrl(descriptor.url, true);
  let identity;
  try {
    const response = await fetcher(`${url}/api/runtime/identity`, { headers: { 'X-ForgeFlow-Desktop': descriptor.secret },
      signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (!response.ok) throw new Error('IDENTITY_AUTH_FAILED');
    identity = await response.json();
  } catch { throw new Error('桌面服务未就绪或身份验证失败；未回退其他实例，队列仍保留。'); }
  if (identity?.instanceId !== descriptor.instanceId || identity?.protocolVersion !== 1) {
    throw new Error('桌面服务身份不匹配；未连接其他实例，队列仍保留。');
  }
  return runtime(url, 'desktop', descriptor.secret, descriptor.instanceId);
}
