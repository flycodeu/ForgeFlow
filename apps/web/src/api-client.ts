import type { ApiErrorResponse } from '@forgeflow/contracts';

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function connectionMessage(status: number) {
  return `无法连接 ForgeFlow 后端服务（HTTP ${status}）。请确认使用 pnpm dev 启动完整服务，且 127.0.0.1:8787 正在监听。`;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers },
    });
  } catch {
    throw new ApiRequestError(0, '无法连接 ForgeFlow 后端服务。请确认使用 pnpm dev 启动完整服务。');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text.trim()) {
    if ([502, 503, 504].includes(response.status)) throw new ApiRequestError(response.status, connectionMessage(response.status));
    throw new ApiRequestError(response.status, response.ok
      ? 'ForgeFlow 后端返回了空响应，请检查服务日志。'
      : `ForgeFlow 后端请求失败（HTTP ${response.status}），但没有返回错误详情。`);
  }

  let result: T | ApiErrorResponse;
  try {
    result = JSON.parse(text) as T | ApiErrorResponse;
  } catch {
    if ([502, 503, 504].includes(response.status)) throw new ApiRequestError(response.status, connectionMessage(response.status));
    throw new ApiRequestError(response.status, response.ok
      ? 'ForgeFlow 后端返回了无法识别的响应，请检查服务日志。'
      : `ForgeFlow 后端请求失败（HTTP ${response.status}），且响应格式不正确。`);
  }

  if (!response.ok) {
    const problem = result as ApiErrorResponse;
    throw new ApiRequestError(response.status, problem.error?.message ?? `ForgeFlow 后端请求失败（HTTP ${response.status}）。`);
  }
  return result as T;
}
