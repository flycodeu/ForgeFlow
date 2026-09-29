<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api } from '../api-client';

type UpdateState = { phase: 'unavailable' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'; currentVersion: string; latestVersion?: string; notes?: string; received?: number; total?: number; error?: string };
const state = ref<UpdateState | null>(null);
const error = ref('');
const busy = ref(false);
let timer: number | undefined;
let autoInstall = false;
async function read() {
  try {
    state.value = await api<UpdateState>('/api/runtime/update');
    if (state.value.phase === 'ready' && autoInstall) {
      autoInstall = false;
      await install();
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取版本状态'; }
}
async function check() {
  busy.value = true; error.value = '';
  try { state.value = await api<UpdateState>('/api/runtime/update/check', { method: 'POST' }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '检查版本失败'; await read(); }
  finally { busy.value = false; }
}
async function update() {
  busy.value = true; error.value = ''; autoInstall = true;
  try { state.value = await api<UpdateState>('/api/runtime/update/download', { method: 'POST' }); }
  catch (cause) { autoInstall = false; error.value = cause instanceof Error ? cause.message : '下载失败'; await read(); }
  finally { busy.value = false; }
}
async function install() {
  busy.value = true; error.value = '';
  try { state.value = await api<UpdateState>('/api/runtime/update/install', { method: 'POST' }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '启动安装失败'; await read(); }
  finally { busy.value = false; }
}
onMounted(() => { void read(); timer = window.setInterval(() => { if (state.value?.phase === 'downloading' || state.value?.phase === 'installing') void read(); }, 500); });
onUnmounted(() => { if (timer !== undefined) window.clearInterval(timer); });
</script>

<template>
  <section class="surface update-card" aria-labelledby="update-heading">
    <div class="update-heading"><div><h2 id="update-heading">应用版本</h2><p>当前版本 <strong>v{{ state?.currentVersion ?? '读取中' }}</strong></p></div><span class="version-chip">ForgeFlow</span></div>
    <div v-if="state?.phase === 'unavailable'" class="update-message">应用内更新仅适用于 Windows 安装版。</div>
    <div v-else-if="state?.phase === 'current'" class="update-message">已是最新版本 v{{ state.latestVersion }}。</div>
    <div v-else-if="state?.phase === 'available' || state?.phase === 'ready'" class="update-message">发现新版本 <strong>v{{ state.latestVersion }}</strong><p v-if="state.notes">{{ state.notes }}</p></div>
    <div v-else-if="state?.phase === 'downloading' || state?.phase === 'installing'" class="update-progress" role="status" aria-live="polite">
      <div class="update-progress-caption"><strong>{{ state.phase === 'installing' ? '正在安装并重启…' : '正在下载更新…' }}</strong><span v-if="state.phase === 'downloading' && state.total">{{ Math.min(100, Math.floor((state.received ?? 0) / state.total * 100)) }}%</span></div>
      <div class="update-progress-track" :class="{ installing: state.phase === 'installing' }"><span :style="{ width: state.phase === 'installing' ? '100%' : `${state.total ? Math.min(100, (state.received ?? 0) / state.total * 100) : 0}%` }"></span></div>
      <small v-if="state.phase === 'downloading' && state.total">{{ ((state.received ?? 0) / 1048576).toFixed(1) }} / {{ (state.total / 1048576).toFixed(1) }} MB · 下载完成后自动校验并安装</small>
      <small v-else>程序会自动关闭，安装完成后重新打开。项目数据保存在独立目录。</small>
    </div>
    <p v-if="error || state?.error" class="update-error" role="alert">{{ error || state?.error }}</p>
    <div class="update-actions"><button class="secondary-button" type="button" :disabled="busy || !state || ['checking','downloading','installing'].includes(state.phase)" @click="check">{{ state?.phase === 'checking' ? '检查中…' : '检查更新' }}</button><button v-if="state?.phase === 'available'" class="primary-button" type="button" :disabled="busy" @click="update">更新到 v{{ state.latestVersion }}</button><button v-if="state?.phase === 'ready'" class="primary-button" type="button" :disabled="busy" @click="install">安装并重启</button></div>
  </section>
</template>

<style scoped>
.update-card{padding:22px;margin-bottom:18px}.update-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.update-heading h2{margin:0 0 8px;font-size:17px}.update-heading p,.update-message{margin:0;color:var(--muted);font-size:13px}.update-heading p strong,.update-message strong{color:var(--ink)}.version-chip{padding:4px 9px;border-radius:5px;background:var(--primary-subtle);color:var(--primary);font-size:11px;font-weight:700;white-space:nowrap}.update-message,.update-progress{margin-top:18px}.update-message p{margin:6px 0 0;white-space:pre-wrap}.update-actions{display:flex;gap:8px;margin-top:18px}.update-progress-caption{display:flex;justify-content:space-between;font-size:13px}.update-progress-track{height:8px;margin:9px 0 7px;background:var(--surface-subtle);border-radius:99px;overflow:hidden}.update-progress-track span{display:block;height:100%;background:var(--primary);border-radius:inherit;transition:width .2s}.update-progress-track.installing span{animation:pulse 1.2s ease-in-out infinite alternate}.update-progress small{color:var(--muted)}.update-error{color:var(--danger);font-size:12px;margin:12px 0 0}@keyframes pulse{from{opacity:.45}to{opacity:1}}@media(max-width:600px){.update-card{padding:16px}.update-heading{flex-direction:column}}
</style>
