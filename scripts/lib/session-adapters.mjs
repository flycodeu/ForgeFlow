import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export function belongsToWorkspace(cwd, root) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return false;
  const child = relative(resolve(root), resolve(cwd));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

// Best-effort redaction, not a promise to recognise arbitrary secrets in prose.
export function redact(text) {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[已隐藏私钥]')
    .replace(/\b(?:sk-(?:proj-|ant-)?[\w-]{12,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|AKIA[A-Z0-9]{16})\b/g, '[已隐藏凭证]')
    .replace(/(\b(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\b["']?\s*[=:]\s*["']?)(?:Bearer\s+)?[^\s"',;}]+/gi, '$1[已隐藏凭证]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[已隐藏凭证]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏凭证]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[已隐藏凭证]@');
}

const visibleText = (content) => typeof content === 'string' ? content : Array.isArray(content)
  ? content.filter((part) => ['text', 'input_text', 'output_text'].includes(part?.type) && typeof part.text === 'string').map((part) => part.text).join('\n') : '';
const safeTool = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : 'tool';
const meta = (name, detail = '') => ({ title: name, content: detail || name, type: 'PROGRESS' });

export function adaptRecord(kind, row, context) {
  const next = { ...context };
  let entries = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('UNSUPPORTED_FORMAT');
  if (kind === 'codex') {
    const p = row.payload;
    if (row.type === 'session_meta') {
      if (typeof p?.cwd !== 'string' || typeof (p.id ?? p.session_id) !== 'string') throw new Error('UNSUPPORTED_SESSION_METADATA');
      next.cwd = p.cwd; next.sessionId = hash(p.id ?? p.session_id);
      entries = [meta('会话开始')];
    } else if (row.type === 'turn_context') {
      if (typeof p?.cwd === 'string') next.cwd = p.cwd;
    } else if (row.type === 'response_item') {
      if (!p || typeof p.type !== 'string') throw new Error('UNSUPPORTED_RESPONSE_ITEM');
      if (!['message', 'function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output', 'reasoning', 'compaction',
        'local_shell_call', 'web_search_call', 'image_generation_call', 'computer_call', 'computer_call_output', 'tool_search_call', 'tool_search_output',
        'mcp_list_tools', 'mcp_approval_request', 'mcp_call'].includes(p.type)) throw new Error('UNSUPPORTED_RESPONSE_ITEM');
      if (p.type === 'message' && ['user', 'assistant'].includes(p.role)
        && (!p.channel || ['final', 'commentary'].includes(p.channel))
        && (!p.phase || ['commentary', 'final_answer'].includes(p.phase))) {
        const content = visibleText(p.content);
        if (content) entries = [{ title: p.role === 'user' ? '用户消息' : '回复', content, type: 'NOTE' }];
      } else if (['function_call', 'custom_tool_call'].includes(p.type)) entries = [meta(`工具调用：${safeTool(p.name)}`)];
      else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) entries = [meta('工具返回', '工具已返回；不采集参数或输出，不据此推断成功。')];
      // Reasoning, compaction, encrypted payloads and non-visible roles are intentionally ignored.
    } else if (row.type === 'event_msg') {
      const labels = { task_started: '执行开始', task_complete: '本轮结束', turn_aborted: '本轮中断' };
      if (labels[p?.type]) entries = [meta(labels[p.type])];
    } else if (!['compacted', 'checkpoint'].includes(row.type)) throw new Error('UNSUPPORTED_CODEX_RECORD');
  } else if (kind === 'claude') {
    if (typeof row.cwd === 'string') next.cwd = row.cwd;
    if (typeof row.sessionId === 'string') next.sessionId = hash(row.sessionId);
    if (['user', 'assistant'].includes(row.type)) {
      if (!row.message || !['user', 'assistant'].includes(row.message.role)) throw new Error('UNSUPPORTED_CLAUDE_MESSAGE');
      const content = visibleText(row.message.content);
      if (content && !row.isMeta) entries.push({ title: row.type === 'user' ? '用户消息' : '回复', content, type: 'NOTE' });
      if (Array.isArray(row.message.content)) for (const item of row.message.content) {
        if (item?.type === 'tool_use') entries.push(meta(`工具调用：${safeTool(item.name)}`));
        if (item?.type === 'tool_result') entries.push(meta('工具返回', item.is_error === true ? '工具报告错误；未采集输出。' : '工具已返回；未采集输出，不推断验证通过。'));
      }
    } else if (!['system', 'progress', 'summary', 'file-history-snapshot', 'queue-operation', 'last-prompt', 'custom-title', 'agent-name', 'agent-color', 'tag', 'saved_hook_context'].includes(row.type)) throw new Error('UNSUPPORTED_CLAUDE_RECORD');
  } else throw new Error('UNSUPPORTED_SOURCE');
  if (!next.sessionId || !next.cwd) {
    if (entries.length) throw new Error('SESSION_METADATA_MISSING');
    return { context: next, entries: [] };
  }
  return { context: next, entries: entries.map((entry) => ({ ...entry, content: redact(entry.content),
    ...(typeof row.timestamp === 'string' && !Number.isNaN(Date.parse(row.timestamp)) ? { occurredAt: new Date(row.timestamp).toISOString() } : {}) })) };
}
