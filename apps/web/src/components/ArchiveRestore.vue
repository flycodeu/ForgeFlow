<script setup lang="ts">
import { ref } from 'vue';
import type { ProjectDetail } from '@forgeflow/contracts';
import { api } from '../api-client';
const emit = defineEmits<{ close: []; restored: [id: string] }>();
const busy = ref(false);
const error = ref('');
const projectKey = ref('');
const name = ref('');
const filename = ref('');
type Preview = { sourceProject: { name: string; projectKey: string }; counts: Record<string, number>; warnings: string[]; digest: string };
const preview = ref<Preview | null>(null);
let archive: unknown;
const labels: Record<string, string> = { modules: '分组', features: '功能', capabilities: '功能明细', specifications: '设计文档', documents: '存档文档', events: '工作记录', tasks: '任务', runs: '执行记录', engineeringAssets: '工程资料', engineeringAssetRevisions: '工程历史', specificationRevisions: '设计历史', sources: '源码绑定', traceLinks: '关联', reviews: '评审', authorizations: '授权', sourceAnalyses: '源码分析' };
async function inspect(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  error.value = ''; preview.value = null; archive = undefined; busy.value = true;
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('存档不能超过 32 MB');
    const value = JSON.parse(await file.text());
    const result = await api<Preview>('/api/project-archives/preview', { method: 'POST', body: JSON.stringify({ archive: value }) });
    archive = value; preview.value = result; filename.value = file.name;
    projectKey.value = `${result.sourceProject.projectKey.slice(0, 23)}_RESTORED`; name.value = `${result.sourceProject.name}（恢复）`.slice(0, 120);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '无法读取存档'; }
  finally { busy.value = false; }
}
async function restore() {
  if (!preview.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const result = await api<ProjectDetail>('/api/project-archives/restore', { method: 'POST', body: JSON.stringify({ archive, projectKey: projectKey.value, name: name.value, expectedDigest: preview.value.digest }) });
    emit('restored', result.project.id);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '恢复失败'; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="dialog-backdrop" @click.self="!busy && emit('close')">
    <section class="dialog restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-heading" @keydown.esc="!busy && emit('close')">
      <div class="dialog-heading"><h2 id="restore-heading">恢复项目存档</h2><button type="button" aria-label="关闭" :disabled="busy" @click="emit('close')">×</button></div>
      <p>恢复为新项目，保留历史，不覆盖现有项目。不会恢复源码文件或系统凭证。</p>
      <label class="file-label">选择 ForgeFlow JSON 存档<input type="file" accept=".json,application/json" :disabled="busy" @change="inspect" /></label>
      <p v-if="error" role="alert" class="restore-error">{{ error }}</p>
      <p v-if="busy" role="status">正在处理，请勿关闭…</p>
      <form v-if="preview" class="form-stack" @submit.prevent="restore">
        <strong>{{ preview.sourceProject.name }}</strong><small>{{ filename }}</small>
        <dl class="restore-counts"><template v-for="(count, key) in preview.counts" :key="key"><div v-if="count"><dt>{{ labels[key] ?? key }}</dt><dd>{{ count }}</dd></div></template></dl>
        <ul v-if="preview.warnings.length"><li v-for="warning in preview.warnings" :key="warning">{{ warning }}</li></ul>
        <label for="restore-key">新项目标识</label><input id="restore-key" v-model="projectKey" pattern="[A-Za-z][A-Za-z0-9_-]{1,31}" maxlength="32" required :disabled="busy" />
        <label for="restore-name">新项目名称</label><input id="restore-name" v-model="name" maxlength="120" required :disabled="busy" />
        <div class="dialog-actions"><button class="secondary-button" type="button" :disabled="busy" @click="emit('close')">取消</button><button class="primary-button" :disabled="busy">恢复为新项目</button></div>
      </form>
    </section>
  </div>
</template>
<style scoped>
.restore-dialog { max-height: 85vh; overflow-y: auto; width: min(600px, calc(100vw - 32px)); }
.restore-dialog p { color: var(--text-secondary, #64736b); line-height: 1.6; }
.file-label { display: grid; gap: 10px; margin: 20px 0; }
.restore-counts { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 12px 0; }
.restore-counts div { display: flex; gap: 8px; }.restore-counts dt { color: var(--text-secondary, #64736b); }.restore-counts dd { margin: 0; font-weight: 600; }
.restore-error { color: #a33b32 !important; }.restore-dialog ul { padding-left: 20px; font-size: 13px; }
</style>
