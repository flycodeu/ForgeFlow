<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api-client';
const state = ref<{ desktop: boolean; dataPath: string | null; canManage: boolean; override: boolean } | null>(null);
const error = ref(''); const busy = ref(false);
onMounted(async () => { try { state.value = await api('/api/runtime/storage'); } catch { error.value = '无法读取存储位置'; } });
async function open() { busy.value = true; error.value = ''; try { await api('/api/runtime/storage/open', { method: 'POST' }); } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法打开存储设置'; } finally { busy.value = false; } }
</script>
<template>
  <section class="surface storage-card" aria-labelledby="storage-heading">
    <div><h2 id="storage-heading">数据存储</h2><p v-if="!state && !error">正在读取存储位置…</p><p v-if="state?.desktop">当前位置</p><code v-if="state?.desktop">{{ state.dataPath || '尚未读取' }}</code><p v-else-if="state">浏览器开发模式。请在 Windows 桌面版中管理数据目录。</p><p v-if="state?.override">当前目录由启动环境指定。</p><p v-if="error" role="alert">{{ error }}</p></div>
    <button v-if="state?.desktop" class="secondary-button" :disabled="busy || !state.canManage" @click="open">管理存储位置</button>
  </section>
</template>
<style scoped>
.storage-card{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:22px;margin-bottom:24px}.storage-card h2{font-size:17px;margin:0 0 10px;color:var(--ink);}.storage-card p{font-size:13px;color:var(--muted);margin:8px 0}.storage-card code{display:block;overflow-wrap:anywhere;font-size:13px;color:var(--ink);background:var(--surface-subtle);padding:6px 10px;border-radius:4px;border:1px solid var(--line);}.storage-card>div{min-width:0}.storage-card button{flex-shrink:0}@media(max-width:700px){.storage-card{flex-direction:column;padding:16px}}
</style>
