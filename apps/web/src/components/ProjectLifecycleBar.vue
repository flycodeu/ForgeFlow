<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { ProjectLifecycle, ProjectLifecycleStage } from '@forgeflow/contracts';
import { api } from '../api-client';

const props = defineProps<{ projectId: string; refreshKey?: string }>();
const emit = defineEmits<{ navigate: [target: ProjectLifecycleStage['target']] }>();

const lifecycle = ref<ProjectLifecycle | null>(null);
const loading = ref(true);
const failed = ref(false);

async function loadLifecycle() {
  loading.value = true;
  failed.value = false;
  try {
    lifecycle.value = await api<ProjectLifecycle>(`/api/projects/${props.projectId}/lifecycle`);
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

function statusLabel(status: ProjectLifecycleStage['status']) {
  return { NOT_STARTED: '暂无', IN_PROGRESS: '进行中', FORMED: '已记录', ISSUE: '需调整' }[status];
}

onMounted(loadLifecycle);
watch(() => [props.projectId, props.refreshKey], loadLifecycle);
</script>

<template>
  <section class="lifecycle" aria-label="项目资料与实施状态">
    <header>
      <div class="lifecycle-title">
        <strong>项目状态</strong>
      </div>
      <div v-if="lifecycle" class="current-stage-badge">
        当前：{{ lifecycle.stages.find(stage => stage.key === lifecycle?.currentStage)?.label }}
      </div>
    </header>
    <div v-if="loading" class="lifecycle-loading">正在读取项目研发状态…</div>
    <div v-else-if="failed" class="lifecycle-loading issue">暂时无法读取研发流程</div>
    <div v-else-if="lifecycle" class="lifecycle-steps">
      <button
        v-for="stage in lifecycle.stages"
        :key="stage.key"
        type="button"
        :class="['lifecycle-step', stage.status.toLowerCase(), { current: stage.key === lifecycle.currentStage }]"
        :aria-current="stage.key === lifecycle.currentStage ? 'step' : undefined"
        @click="emit('navigate', stage.target)"
      >
        <strong>{{ stage.label }}</strong>
        <em>{{ statusLabel(stage.status) }}</em>
      </button>
    </div>
  </section>
</template>

<style scoped>
.lifecycle { container-type: inline-size; margin: 0 0 20px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.lifecycle header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.lifecycle-title strong { color: var(--ink); font-size: 13px; font-weight: 600; }
.current-stage-badge { color: var(--muted); font-size: 12px; }
.lifecycle-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.lifecycle-step { display: flex; align-items: center; justify-content: space-between; min-width: 0; min-height: 34px; padding: 6px 10px; border: 0; border-radius: 4px; background: transparent; color: var(--ink-secondary); text-align: left; cursor: pointer; }
.lifecycle-step:hover { background: var(--surface-subtle); }
.lifecycle-step strong { overflow: hidden; font-size: 12px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.lifecycle-step em { flex-shrink: 0; margin-left: 6px; color: var(--muted); font-size: 11px; font-style: normal; }
.lifecycle-step.current { background: var(--primary-subtle); }
.lifecycle-step.current strong, .lifecycle-step.current em { color: var(--primary); }
.lifecycle-step.issue em { color: var(--danger-ink); }
.lifecycle-loading { padding: 12px; color: var(--muted); font-size: 13px; }
.lifecycle-loading.issue { color: var(--danger-ink); }
@container (max-width: 660px) { .lifecycle-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
