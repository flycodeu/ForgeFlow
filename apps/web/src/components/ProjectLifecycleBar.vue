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
  return { NOT_STARTED: '未开始', IN_PROGRESS: '进行中', FORMED: '已完成', ISSUE: '需调整' }[status];
}

onMounted(loadLifecycle);
watch(() => [props.projectId, props.refreshKey], loadLifecycle);
</script>

<template>
  <section class="lifecycle" aria-label="项目研发流程">
    <header>
      <div class="lifecycle-title">
        <span class="lifecycle-icon">⚡</span>
        <strong>研发交付流程</strong>
      </div>
      <div v-if="lifecycle" class="current-stage-badge">
        <span class="stage-pulse"></span>
        当前阶段：{{ lifecycle.stages.find(stage => stage.key === lifecycle?.currentStage)?.label }}
      </div>
    </header>
    <div v-if="loading" class="lifecycle-loading">正在读取项目研发状态…</div>
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
        <span class="step-track"><i class="node-dot"></i></span>
        <strong>{{ stage.label }}</strong>
        <small>{{ stage.summary }}</small>
        <em>{{ statusLabel(stage.status) }}</em>
      </button>
    </div>
  </section>
</template>

<style scoped>
.lifecycle {
  margin: 0 0 20px;
  padding: 18px 22px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
.lifecycle header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.lifecycle-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lifecycle-icon {
  font-size: 14px;
}
.lifecycle-title strong {
  color: #0f172a;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.current-stage-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 10px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 9999px;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 600;
}
.stage-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);
  animation: pulseDot 1.8s infinite;
}
@keyframes pulseDot {
  0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.5); }
  70% { box-shadow: 0 0 0 6px rgba(37, 99, 235, 0); }
  100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
}
.lifecycle-steps {
  display: grid;
  grid-template-columns: repeat(8, minmax(92px, 1fr));
  overflow-x: auto;
  padding: 0 2px 4px;
  gap: 6px;
}
.lifecycle-step {
  position: relative;
  min-width: 92px;
  padding: 22px 10px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #475569;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}
.lifecycle-step:hover {
  background: #f8fafc;
}
.step-track {
  position: absolute;
  top: 7px;
  right: 0;
  left: 0;
  height: 2px;
  background: #e2e8f0;
}
.step-track .node-dot {
  position: absolute;
  top: -5px;
  left: 8px;
  width: 12px;
  height: 12px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background: #cbd5e1;
  box-shadow: 0 0 0 1px #94a3b8;
  transition: all 0.2s;
}
.lifecycle-step:first-child .step-track {
  left: 8px;
}
.lifecycle-step:last-child .step-track {
  right: calc(100% - 14px);
}
.lifecycle-step.formed .step-track,
.lifecycle-step.in_progress .step-track,
.lifecycle-step.traversed .step-track {
  background: #2563eb;
}
.lifecycle-step.formed .step-track .node-dot {
  background: #2563eb;
  box-shadow: 0 0 0 1px #2563eb;
}
.lifecycle-step.in_progress .step-track .node-dot,
.lifecycle-step.current .step-track .node-dot {
  width: 14px;
  height: 14px;
  top: -6px;
  left: 7px;
  background: #2563eb;
  border-color: #ffffff;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.25);
}
.lifecycle-step.issue .step-track .node-dot {
  background: #f43f5e;
  box-shadow: 0 0 0 1px #f43f5e;
}
.lifecycle-step strong {
  display: block;
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}
.lifecycle-step small {
  display: block;
  min-height: 34px;
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}
.lifecycle-step em {
  display: inline-block;
  margin-top: 6px;
  padding: 2px 7px;
  background: #f1f5f9;
  border-radius: 4px;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  font-style: normal;
}
.lifecycle-step.current {
  background: #eff6ff;
}
.lifecycle-step.current strong {
  color: #1d4ed8;
}
.lifecycle-step.current em {
  background: #dbeafe;
  color: #1d4ed8;
}
.lifecycle-step.issue em {
  background: #ffe4e6;
  color: #e11d48;
}
.lifecycle-loading {
  padding: 14px;
  background: #f8fafc;
  border-radius: 8px;
  color: #64748b;
  font-size: 13.5px;
  text-align: center;
}
.lifecycle-loading.issue {
  color: #e11d48;
}
@media (max-width: 980px) {
  .lifecycle-steps {
    grid-template-columns: repeat(8, minmax(110px, 1fr));
  }
}
</style>
