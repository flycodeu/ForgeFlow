<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api-client';
const props = defineProps<{ projectId: string }>();
type State = { configured: boolean; config: { enabled: boolean; workspaceRoot: string; sources: { kind: string; directory: string }[]; includeHistory?: boolean } | null;
  pendingCount: number; blockedCount: number; delivered: number; queueBytes: number; lastError?: string | null; lastPollAt?: string | null; lastSuccessAt?: string | null; filesSeen?: number; running?: boolean;
  diagnostics?: { name: string; message: string }[] };
const state = ref<State | null>(null); const busy = ref(false); const error = ref(''); const notice = ref('');
const enabled = ref(false); const workspaceRoot = ref(''); const codex = ref(''); const claude = ref(''); const includeHistory = ref(false);
const base = `/api/projects/${props.projectId}/capture`;
async function load() {
  busy.value = true; error.value = '';
  try {
    state.value = await api<State>(base);
    const config = state.value.config;
    enabled.value = config?.enabled ?? false; workspaceRoot.value = config?.workspaceRoot ?? '';
    codex.value = config?.sources.find(s => s.kind === 'codex')?.directory ?? ''; claude.value = config?.sources.find(s => s.kind === 'claude')?.directory ?? '';
    includeHistory.value = config?.includeHistory ?? false;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取采集状态'; }
  finally { busy.value = false; }
}
async function save() {
  busy.value = true; error.value = ''; notice.value = '';
  try {
    state.value = await api<State>(base, { method: 'PUT', body: JSON.stringify({ enabled: enabled.value, workspaceRoot: workspaceRoot.value,
      sources: [...(codex.value.trim() ? [{ kind: 'codex', directory: codex.value.trim() }] : []), ...(claude.value.trim() ? [{ kind: 'claude', directory: claude.value.trim() }] : [])], includeHistory: includeHistory.value }) });
    notice.value = enabled.value ? '已启用，后台会按项目目录匹配会话' : '已暂停；待传记录仍保留在本机';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败'; }
  finally { busy.value = false; }
}
async function sync() {
  busy.value = true; error.value = ''; notice.value = '';
  try { state.value = await api<State>(`${base}/sync`, { method: 'POST' }); notice.value = '本次同步已结束，请查看待传数量与问题'; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '同步失败'; }
  finally { busy.value = false; }
}
function toggle(event: Event) { if ((event.target as HTMLDetailsElement).open && !state.value && !busy.value) void load(); }
</script>
<template>
  <details class="capture-settings" @toggle="toggle">
    <summary>自动采集与重试 <span v-if="state">{{ state.config?.enabled ? '已启用' : '已暂停' }}<template v-if="state.pendingCount"> · {{ state.pendingCount }} 条待传</template></span></summary>
    <div class="capture-body">
      <div v-if="state" class="capture-status"><span>待传 {{ state.pendingCount }}</span><span>需处理 {{ state.blockedCount }}</span><span>已送达 {{ state.delivered }}</span><button type="button" :disabled="busy" @click="load">刷新</button><button type="button" :disabled="busy || !state.config?.enabled" @click="sync">重试同步</button></div>
      <p v-if="error || state?.lastError" class="capture-error" role="alert">{{ error || state?.lastError }}</p><p v-if="notice" role="status">{{ notice }}</p>
      <form @submit.prevent="save">
        <label class="capture-check"><input v-model="enabled" type="checkbox" :disabled="busy" />启用本项目的自动采集</label>
        <label>项目工作目录<input v-model="workspaceRoot" required :disabled="busy" placeholder="例如 D:\Projects\my-app" /></label>
        <label>Codex 会话目录<input v-model="codex" :disabled="busy" placeholder="选择该客户端实际保存 JSONL 会话的目录，可留空" /></label>
        <label>Claude Code 会话目录<input v-model="claude" :disabled="busy" placeholder="选择该客户端实际保存 JSONL 会话的目录，可留空" /></label>
        <label class="capture-check"><input v-model="includeHistory" type="checkbox" :disabled="busy || state?.configured" />首次接入时包含已有历史</label>
        <button type="submit" class="capture-save primary-button" :disabled="busy">{{ busy ? '处理中…' : '保存设置' }}</button>
      </form>
      <ul v-if="state?.diagnostics?.length"><li v-for="item in state.diagnostics.slice(0, 8)" :key="item.name">{{ item.message }}</li></ul>
    </div>
  </details>
</template>
<style scoped>
.capture-settings { border-bottom: 1px solid var(--line); margin-bottom: 16px; }
.capture-settings summary { cursor: pointer; padding: 14px 0; font-weight: 600; color: var(--ink); }
.capture-settings summary span { float: right; color: var(--muted); font-size: 12px; font-weight: 400; }
.capture-body { padding-bottom: 18px; }
.capture-status { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-bottom: 12px; font-size: 13px; color: var(--muted); }
.capture-body form { display: grid; gap: 12px; max-width: 720px; }
.capture-body label { display: grid; gap: 6px; font-size: 13px; color: var(--ink); font-weight: 500; }
.capture-body input:not([type=checkbox]) { width: 100%; min-width: 0; padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); }
.capture-body .capture-check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
.capture-check input { width: auto; accent-color: var(--primary); }
.capture-body p { font-size: 12px; color: var(--muted); line-height: 1.6; margin: 0; }
.capture-body .capture-error { color: var(--danger, #dc2626); margin-bottom: 12px; }
.capture-body button { padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--surface); color: var(--ink-secondary); font-size: 13px; cursor: pointer; transition: all 0.15s; }
.capture-body button:hover { background: var(--surface-subtle); }
.capture-body .capture-save { justify-self: start; background: var(--primary); color: #fff; border-color: var(--primary); font-weight: 600; }
.capture-body .capture-save:hover { background: var(--primary-hover); }
.capture-body button:disabled { opacity: .5; cursor: not-allowed; }
.capture-body ul { font-size: 12px; color: var(--muted); padding-left: 18px; }
</style>
