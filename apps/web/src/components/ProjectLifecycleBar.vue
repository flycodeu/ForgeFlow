<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ProjectLifecycle, ProjectLifecycleStage } from '@forgeflow/contracts';
import { api } from '../api-client';

const props = defineProps<{ projectId: string; refreshKey?: string }>();
const emit = defineEmits<{ navigate: [target: ProjectLifecycleStage['target']] }>();

const lifecycle = ref<ProjectLifecycle | null>(null);
const loading = ref(true);
const failed = ref(false);

const currentIndex = computed(() => lifecycle.value?.stages.findIndex((stage) => stage.key === lifecycle.value?.currentStage) ?? -1);

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
  return { NOT_STARTED: '未开始', IN_PROGRESS: '进行中', FORMED: '已形成', ISSUE: '存在问题' }[status];
}

onMounted(loadLifecycle);
watch(() => [props.projectId, props.refreshKey], loadLifecycle);
</script>

<template>
  <section class="lifecycle" aria-label="项目研发流程">
    <header>
      <div>
        <strong>研发流程</strong>
        <span>状态由调研、设计、能力项、实施任务与 AI执行的真实数据推导</span>
      </div>
      <small v-if="lifecycle">当前：{{ lifecycle.stages.find(stage => stage.key === lifecycle?.currentStage)?.label }}</small>
    </header>
    <div v-if="loading" class="lifecycle-loading">正在汇总项目状态…</div>
    <div v-else-if="failed" class="lifecycle-loading issue">暂时无法读取研发流程</div>
    <div v-else-if="lifecycle" class="lifecycle-steps">
      <button
        v-for="(stage, index) in lifecycle.stages"
        :key="stage.key"
        type="button"
        :class="['lifecycle-step', stage.status.toLowerCase(), { current: stage.key === lifecycle.currentStage, traversed: index <= currentIndex }]"
        :aria-current="stage.key === lifecycle.currentStage ? 'step' : undefined"
        @click="emit('navigate', stage.target)"
      >
        <span class="step-track"><i></i></span>
        <strong>{{ stage.label }}</strong>
        <small>{{ stage.summary }}</small>
        <em>{{ statusLabel(stage.status) }}</em>
      </button>
    </div>
  </section>
</template>

<style scoped>
.lifecycle { margin: 0 0 18px; padding: 16px 18px 14px; border: 1px solid #d9e2e8; background: #fff; box-shadow: 0 8px 24px rgba(24, 45, 58, .05); }
.lifecycle header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 14px; }
.lifecycle header div { display: flex; align-items: baseline; gap: 12px; }
.lifecycle header strong { color: #12242e; font-size: 15px; }
.lifecycle header span, .lifecycle header small { color: #61717a; font-size: 13px; }
.lifecycle-steps { display: grid; grid-template-columns: repeat(8, minmax(92px, 1fr)); overflow-x: auto; padding: 0 2px 2px; }
.lifecycle-step { position: relative; min-width: 92px; padding: 20px 10px 8px; border: 0; background: transparent; color: #42545e; text-align: left; cursor: pointer; }
.step-track { position: absolute; top: 6px; right: 0; left: 0; height: 2px; background: #dce4e8; }
.step-track i { position: absolute; top: -5px; left: 4px; width: 12px; height: 12px; border: 3px solid #fff; border-radius: 50%; background: #bec9cf; box-shadow: 0 0 0 1px #b9c6cc; }
.lifecycle-step:first-child .step-track { left: 4px; }
.lifecycle-step:last-child .step-track { right: calc(100% - 10px); }
.lifecycle-step.formed .step-track, .lifecycle-step.in_progress .step-track, .lifecycle-step.traversed .step-track { background: #187b67; }
.lifecycle-step.formed .step-track i { background: #187b67; box-shadow: 0 0 0 1px #187b67; }
.lifecycle-step.in_progress .step-track i, .lifecycle-step.current .step-track i { width: 15px; height: 15px; top: -6px; left: 2px; background: #f0a23a; box-shadow: 0 0 0 2px rgba(240, 162, 58, .25); }
.lifecycle-step.issue .step-track i { background: #bd4b55; box-shadow: 0 0 0 1px #bd4b55; }
.lifecycle-step strong { display: block; font-size: 14px; color: #1b303b; white-space: nowrap; }
.lifecycle-step small { display: block; min-height: 36px; margin-top: 4px; color: #677982; font-size: 12.5px; line-height: 1.4; }
.lifecycle-step em { display: inline-block; margin-top: 5px; padding: 2px 7px; background: #eef3f4; color: #53666f; font-size: 12px; font-style: normal; }
.lifecycle-step.current { background: #f6faf9; }
.lifecycle-step.current strong { color: #116b5a; }
.lifecycle-step.current em { background: #e3f1ed; color: #116b5a; font-weight: 700; }
.lifecycle-step.issue em { background: #fae9eb; color: #a73945; }
.lifecycle-loading { padding: 12px; background: #f4f7f8; color: #657780; font-size: 14px; }
.lifecycle-loading.issue { color: #a73945; }
@media (max-width: 980px) { .lifecycle-steps { grid-template-columns: repeat(8, minmax(120px, 1fr)); } .lifecycle header span { display: none; } }
</style>
