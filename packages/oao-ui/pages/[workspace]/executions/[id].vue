<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="execution">
      <!-- Header -->
      <div class="flex items-start justify-between mb-6">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-3xl font-bold">Execution {{ execution.id.substring(0, 8) }}…</h1>
            <!-- Visual status indicator ball -->
            <span v-if="execution.status === 'running'" class="w-3 h-3 rounded-full bg-green-500 animate-pulse" title="Running"></span>
            <span v-else-if="execution.status === 'pending'" class="w-3 h-3 rounded-full bg-yellow-400 animate-pulse" title="Pending"></span>
            <span v-else-if="execution.status === 'failed'" class="w-3 h-3 rounded-full bg-red-500" title="Failed"></span>
            <span v-else-if="execution.status === 'completed'" class="w-3 h-3 rounded-full bg-green-500" title="Completed"></span>
            <span v-else-if="execution.status === 'cancelled'" class="w-3 h-3 rounded-full bg-surface-400" title="Cancelled"></span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 mt-1">
            <Tag :value="execution.status" :severity="statusSeverity(execution.status)" />
            <Tag :value="'v' + (execution.workflowVersion || '?')" severity="secondary" />
            <Tag v-if="workflowName" :value="workflowName" severity="info" />
            <Tag v-if="execution.triggerMetadata?.retryOf" value="Retry" severity="warn" />
            <span v-if="streamConnected" class="inline-flex items-center gap-1 text-xs text-green-600">
              <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Live
            </span>
          </div>
        </div>
        <div class="flex gap-2">
          <Button v-if="execution.status === 'running' || execution.status === 'pending'" label="Cancel" icon="pi pi-times" severity="secondary" size="small" :loading="cancelling" @click="handleCancel" />
          <Button v-if="execution.status === 'failed'" label="Retry" icon="pi pi-refresh" severity="warn" size="small" :loading="retrying" @click="handleRetry" />
        </div>
      </div>

      <!-- Retry result -->
      <Message v-if="retryResult" severity="info" :closable="true" class="mb-4">
        Retry execution created!
        <NuxtLink :to="`/${ws}/executions/${retryResult.id}`" class="text-primary hover:underline ml-2">View →</NuxtLink>
      </Message>

      <!-- Styled execution metadata -->
      <div class="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div class="rounded-xl border border-surface-200 bg-gradient-to-b from-white to-surface-50 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">Triggered</p>
          <p class="mt-1 text-sm font-semibold text-surface-900">{{ formatTriggerType(execution.triggerMetadata?.type) }}</p>
        </div>
        <div class="rounded-xl border border-surface-200 bg-gradient-to-b from-white to-surface-50 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">Workflow</p>
          <div class="mt-1 text-sm font-semibold text-surface-900">
            <NuxtLink v-if="workflowVersionPath" :to="workflowVersionPath" class="text-primary hover:underline">{{ workflowName || execution.workflowId.substring(0, 8) + '…' }}</NuxtLink>
            <span v-else>—</span>
          </div>
        </div>
        <div class="rounded-xl border border-surface-200 bg-gradient-to-b from-white to-surface-50 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">Runtime</p>
          <p class="mt-1 text-sm font-semibold capitalize text-surface-900">{{ snapshotConfig?.workerRuntime || 'static' }}</p>
        </div>
        <div class="rounded-xl border border-surface-200 bg-gradient-to-b from-white to-surface-50 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">Started</p>
          <p class="mt-1 text-sm font-semibold text-surface-900">{{ execution.startedAt ? new Date(execution.startedAt).toLocaleString() : '—' }}</p>
        </div>
        <div class="rounded-xl border border-surface-200 bg-gradient-to-b from-white to-surface-50 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">Duration</p>
          <p class="mt-1 text-sm font-semibold text-surface-900">{{ duration }}</p>
        </div>
        <div class="rounded-xl border border-surface-200 bg-gradient-to-b from-white to-surface-50 px-4 py-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">Steps</p>
          <p class="mt-1 text-sm font-semibold text-surface-900">{{ execution.currentStep || 0 }} / {{ execution.totalSteps || steps.length }}</p>
        </div>
      </div>

      <div class="mb-6">
        <h2 class="text-lg font-semibold mb-2">Versions Used</h2>
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-surface-600">
          <span class="flex items-center gap-1">
            <span class="text-surface-400">Workflow:</span>
            <NuxtLink v-if="workflowVersionPath" :to="workflowVersionPath" class="text-primary hover:underline">
              {{ workflowName || execution.workflowId.substring(0, 8) + '…' }} v{{ execution.workflowVersion || '?' }}
            </NuxtLink>
            <span v-else>v{{ execution.workflowVersion || '?' }}</span>
          </span>
          <span v-for="entry in stepVersionDetails" :key="entry.stepId" class="flex items-center gap-1">
            <span class="text-surface-400">{{ entry.stepName }}:</span>
            <NuxtLink v-if="entry.path" :to="entry.path" class="text-primary hover:underline">
              {{ entry.agentName }} v{{ entry.version }}
            </NuxtLink>
            <span v-else>{{ entry.agentName }} v{{ entry.version }}</span>
          </span>
        </div>
      </div>

      <!-- Retry info -->
      <Message v-if="execution.triggerMetadata?.retryOf" severity="warn" :closable="false" class="mb-4">
        Retry of execution:
        <NuxtLink :to="`/${ws}/executions/${execution.triggerMetadata.retryOf}`" class="text-primary hover:underline ml-1">{{ execution.triggerMetadata.retryOf.substring(0, 8) }}…</NuxtLink>
      </Message>

      <!-- Error -->
      <Message v-if="execution.error" severity="error" :closable="false" class="mb-4">{{ execution.error }}</Message>

      <!-- GitHub Actions–style Step Timeline -->
      <h2 class="text-xl font-semibold mb-4">Steps</h2>
      <div class="border border-surface-200 rounded-lg overflow-hidden">
        <div v-for="(step, idx) in steps" :key="step.id" class="border-b border-surface-200 last:border-b-0">
          <!-- Step Header (clickable) -->
          <div
            class="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-50 transition-colors"
            :class="{ 'bg-surface-50': selectedStepId === step.id }"
            @click="toggleStep(step.id)"
          >
            <!-- Step status icon -->
            <div class="flex-shrink-0">
              <span v-if="step.status === 'completed'" class="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600">
                <i class="pi pi-check text-xs"></i>
              </span>
              <span v-else-if="step.status === 'running'" class="flex items-center justify-center w-6 h-6 rounded-full bg-yellow-100 text-yellow-600">
                <i class="pi pi-spin pi-spinner text-xs"></i>
              </span>
              <span v-else-if="step.status === 'failed'" class="flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600">
                <i class="pi pi-times text-xs"></i>
              </span>
              <span v-else-if="step.status === 'skipped'" class="flex items-center justify-center w-6 h-6 rounded-full bg-surface-200 text-surface-500">
                <i class="pi pi-forward text-xs"></i>
              </span>
              <span v-else class="flex items-center justify-center w-6 h-6 rounded-full bg-surface-100 text-surface-400">
                <i class="pi pi-circle text-xs"></i>
              </span>
            </div>

            <!-- Step name + agent version badge -->
            <div class="flex-1 min-w-0">
              <p class="font-medium text-sm truncate">
                {{ getStepName(step, idx) }}
                <NuxtLink
                  v-if="getAgentVersionPath(step)"
                  :to="getAgentVersionPath(step)!"
                  class="ml-1 text-xs text-primary hover:underline"
                  @click.stop
                >({{ step.agentSnapshot?.name || 'Agent' }} v{{ step.agentVersion }})</NuxtLink>
                <span v-else-if="step.agentVersion" class="ml-1 text-xs text-surface-400">({{ step.agentSnapshot?.name || 'Agent' }} v{{ step.agentVersion }})</span>
              </p>
            </div>

            <!-- Duration + status -->
            <div class="flex items-center gap-3 flex-shrink-0">
              <span v-if="step.status === 'running'" class="text-xs text-yellow-600 font-medium">Running…</span>
              <span v-if="stepDuration(step)" class="text-xs text-surface-400 font-mono">{{ stepDuration(step) }}</span>
              <Tag :value="step.status" :severity="statusSeverity(step.status)" class="text-xs" />
              <i :class="selectedStepId === step.id ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" class="text-surface-400 text-sm"></i>
            </div>
          </div>

          <!-- Expanded Step Content -->
          <div v-if="selectedStepId === step.id" class="border-t border-surface-200 bg-slate-950">
            <!-- Agent snapshot info bar -->
            <div v-if="step.agentSnapshot" class="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800 px-4 py-2 text-xs text-slate-400">
              <span>Agent: <strong class="text-slate-100">{{ step.agentSnapshot.name }}</strong></span>
              <span>Version: <strong class="text-slate-100">v{{ step.agentSnapshot.version || step.agentVersion || '?' }}</strong></span>
              <span v-if="step.agentSnapshot.sourceType">Source: <strong class="text-slate-100">{{ step.agentSnapshot.sourceType }}</strong></span>
            </div>
            <!-- Step detail tabs -->
            <div class="flex flex-wrap gap-2 border-b border-slate-800 bg-slate-900/80 px-3 pt-3">
              <button
                v-for="tab in stepTabs"
                :key="tab.id"
                class="rounded-t-lg border px-4 py-2 text-xs font-semibold transition-colors"
                :class="activeTab === tab.id ? 'border-white bg-white text-slate-950 shadow-sm' : 'border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100'"
                @click="activeTab = tab.id"
              >
                {{ tab.label }}
                <span v-if="tab.id === 'logs' && getStepLogs(step).length > 0" class="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[10px] leading-none text-slate-200 align-middle">{{ getStepLogs(step).length }}</span>
              </button>
            </div>

            <!-- Tab: Output -->
            <div v-if="activeTab === 'output'" class="max-h-[500px] overflow-y-auto p-4">
              <div v-if="!step.output" class="text-xs text-slate-500">
                {{ step.status === 'running' ? 'Step in progress…' : step.status === 'pending' ? 'Waiting…' : 'No output.' }}
              </div>
              <div v-else class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <MarkdownRenderer :content="step.output" theme="dark" />
              </div>
            </div>

            <!-- Tab: Process Logs (tool calls, events) -->
            <div v-if="activeTab === 'logs'" class="max-h-[500px] overflow-y-auto font-mono text-xs">
              <div v-if="getStepLogs(step).length === 0" class="p-4 text-slate-500">
                {{ step.status === 'pending' ? 'Waiting for step to start…' : step.status === 'running' ? 'Waiting for events…' : 'No process logs recorded.' }}
              </div>
              <div v-else>
                <div
                  v-for="(log, li) in getStepLogs(step)"
                  :key="li"
                  class="flex gap-2 border-b border-slate-800 px-4 py-1 text-slate-100 hover:bg-slate-900"
                >
                  <span class="w-20 flex-shrink-0 text-slate-500">{{ formatLogTime(log.timestamp) }}</span>
                  <span v-if="log.type === 'tool_call_start'" class="text-blue-400">
                    <i class="pi pi-wrench mr-1"></i>Tool call: <span class="text-blue-300 font-semibold">{{ log.tool }}</span>
                    <span v-if="log.args" class="ml-2 text-slate-500">{{ formatArgs(log.args) }}</span>
                  </span>
                  <span v-else-if="log.type === 'tool_call_end'" class="text-green-400">
                    <i class="pi pi-check-circle mr-1"></i>Tool completed: {{ log.tool }}
                    <span v-if="log.result !== undefined" class="ml-1 text-slate-400">({{ log.result ? 'success' : 'failed' }})</span>
                  </span>
                  <span v-else-if="log.type === 'turn_start'" class="text-purple-400">
                    <i class="pi pi-play mr-1"></i>Turn started
                  </span>
                  <span v-else-if="log.type === 'turn_end'" class="text-purple-400">
                    <i class="pi pi-stop mr-1"></i>Turn ended
                  </span>
                  <span v-else-if="log.type === 'info'" class="text-slate-300">
                    <i class="pi pi-info-circle mr-1"></i>{{ log.message }}
                  </span>
                  <span v-else class="text-slate-400">{{ log.type }}: {{ log.message || log.content }}</span>
                </div>
              </div>
            </div>

            <!-- Tab: Reasoning / LLM Response (streamed delta messages) -->
            <div v-if="activeTab === 'reasoning'" class="max-h-[500px] overflow-y-auto p-4">
              <div v-if="!getReasoningText(step)" class="text-xs text-slate-500">
                {{ step.status === 'running' ? 'Waiting for model response…' : 'No reasoning content available.' }}
              </div>
              <div v-else class="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                <MarkdownRenderer :content="getReasoningText(step)" theme="dark" />
              </div>
            </div>

            <!-- Tab: Prompt -->
            <div v-if="activeTab === 'prompt'" class="max-h-[500px] overflow-y-auto p-4">
              <div v-if="!step.resolvedPrompt" class="text-xs text-slate-500">
                {{ step.status === 'pending' ? 'Prompt not yet resolved.' : 'No prompt data.' }}
              </div>
              <pre v-else class="whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs leading-relaxed text-slate-200">{{ step.resolvedPrompt }}</pre>
            </div>

            <!-- Tab: Trace -->
            <div v-if="activeTab === 'trace'" class="max-h-[500px] overflow-y-auto p-4">
              <div v-if="!step.reasoningTrace" class="text-xs text-slate-500">No trace data.</div>
              <div v-else>
                <div class="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span v-if="getTraceVal(step.reasoningTrace, 'model')">Model: <strong class="text-slate-200">{{ getTraceVal(step.reasoningTrace, 'model') }}</strong></span>
                  <span v-if="getTraceVal(step.reasoningTrace, 'reasoningEffort')">Effort: <strong class="text-slate-200">{{ getTraceVal(step.reasoningTrace, 'reasoningEffort') }}</strong></span>
                  <span v-if="getTraceVal(step.reasoningTrace, 'workerRuntime')">Runtime: <strong class="text-slate-200">{{ getTraceVal(step.reasoningTrace, 'workerRuntime') }}</strong></span>
                  <span v-if="getTraceVal(step.reasoningTrace, 'promptTokens')">Prompt Tokens: <strong class="text-slate-200">{{ getTraceVal(step.reasoningTrace, 'promptTokens') }}</strong></span>
                  <span v-if="getTraceVal(step.reasoningTrace, 'completionTokens')">Completion Tokens: <strong class="text-slate-200">{{ getTraceVal(step.reasoningTrace, 'completionTokens') }}</strong></span>
                </div>
                <div v-if="getToolCalls(step.reasoningTrace).length > 0" class="flex flex-col gap-1">
                  <div v-for="(tc, ti) in getToolCalls(step.reasoningTrace)" :key="ti" class="rounded bg-slate-900 p-2 text-xs">
                    <p class="font-medium text-blue-300"><i class="pi pi-wrench mr-1"></i>{{ tc.tool || tc.name }}</p>
                    <pre v-if="tc.args" class="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-slate-400">{{ typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args, null, 2) }}</pre>
                  </div>
                </div>
              </div>
            </div>

            <!-- Error -->
            <div v-if="step.error" class="border-t border-slate-800 bg-red-950 px-4 py-3 text-xs text-red-300">
              <i class="pi pi-exclamation-triangle mr-1"></i>{{ step.error }}
            </div>
          </div>
        </div>
        <p v-if="steps.length === 0" class="text-center text-surface-400 py-8">No steps available.</p>
      </div>
    </div>
    <div v-else class="text-center py-12 text-surface-400">Loading execution...</div>
  </div>
</template>

<script setup lang="ts">
import { useToast } from 'primevue/usetoast';
import { useExecutionStream } from '~/composables/useExecutionStream';
import { formatTriggerType } from '~/utils/triggers';

const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');
const execId = computed(() => route.params.id as string);
const toast = useToast();

const selectedStepId = ref<string | null>(null);
const activeTab = ref('output');
const retrying = ref(false);
const cancelling = ref(false);
const retryResult = ref<any>(null);

const stepTabs = [
  { id: 'output', label: 'Output' },
  { id: 'logs', label: 'Process Logs' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'trace', label: 'Trace' },
];

// ─── Data Fetching ────────────────────────────────────────────────────

const { data: execData, refresh: refreshExec } = await useFetch<any>(computed(() => `/api/executions/${execId.value}`), { headers });
const execution = computed(() => execData.value?.execution ?? null);
const steps = computed(() => execData.value?.steps ?? []);
const snapshotConfig = computed(() => {
  const snap = execution.value?.workflowSnapshot as any;
  return snap?.workflow ?? null;
});
const workflowName = computed(() => snapshotConfig.value?.name || execData.value?.workflow?.name || null);
const workflowVersionPath = computed(() => {
  if (!execution.value?.workflowId) return null;
  if (!execution.value?.workflowVersion) return `/${ws.value}/workflows/${execution.value.workflowId}`;
  return `/${ws.value}/workflows/${execution.value.workflowId}/v/${execution.value.workflowVersion}`;
});
const stepVersionDetails = computed(() => steps.value.flatMap((step: any, index: number) => {
  const version = step?.agentVersion || step?.agentSnapshot?.version;
  if (!version) return [];

  return [{
    stepId: step.id,
    stepName: getStepName(step, index),
    agentName: step?.agentSnapshot?.name || 'Agent',
    version,
    path: getAgentVersionPath(step),
  }];
}));

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Executions', route: `/${ws.value}/executions` },
  { label: execution.value ? execution.value.id.substring(0, 8) + '…' : 'Loading...' },
]);

// ─── Live Streaming ───────────────────────────────────────────────────

const isLive = computed(() => execution.value?.status === 'running' || execution.value?.status === 'pending');
const { connected: streamConnected, on: onStreamEvent } = useExecutionStream(execId, { enabled: isLive });

// Accumulate live events per step
const liveEventsMap = ref<Record<string, any[]>>({});

onStreamEvent('step.started', () => {
  refreshExec();
});

onStreamEvent('step.progress', (data: any) => {
  const stepId = data.stepExecutionId;
  if (!stepId) return;
  const newEvents = data.data?.events || [];
  if (!liveEventsMap.value[stepId]) liveEventsMap.value[stepId] = [];
  liveEventsMap.value[stepId].push(...newEvents);
});

onStreamEvent('step.completed', () => {
  refreshExec();
});

onStreamEvent('step.failed', () => {
  refreshExec();
});

onStreamEvent('execution.completed', () => {
  refreshExec();
});

onStreamEvent('execution.failed', () => {
  refreshExec();
});

onStreamEvent('execution.cancelled', () => {
  refreshExec();
});

// Also poll for updates when live (as a fallback every 5s)
let pollTimer: ReturnType<typeof setInterval> | null = null;
watch(isLive, (live) => {
  if (live) {
    pollTimer = setInterval(() => refreshExec(), 5000);
  } else {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
}, { immediate: true });

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer);
});

// ─── Step name resolution ─────────────────────────────────────────────

const snapshotSteps = computed(() => {
  const snap = execution.value?.workflowSnapshot as any;
  return snap?.steps ?? [];
});

function getStepName(step: any, idx: number | string): string {
  const snapStep = snapshotSteps.value.find((s: any) => s.id === step.workflowStepId);
  if (snapStep?.name) return snapStep.name;
  const numericIdx = typeof idx === 'string' ? Number(idx) : idx;
  return `Step ${step.stepOrder || numericIdx + 1}`;
}

function getAgentVersionPath(step: any): string | null {
  const agentId = step?.agentSnapshot?.id;
  const version = step?.agentVersion || step?.agentSnapshot?.version;
  if (!agentId || !version) return null;
  return `/${ws.value}/agents/${agentId}/v/${version}`;
}

// ─── Step logs (from liveOutput + streamed events) ─────────────────────

function getStepLogs(step: any): any[] {
  const dbLogs = (step.liveOutput || []).filter((e: any) => e.type !== 'message_delta');
  const streamedLogs = (liveEventsMap.value[step.id] || []).filter((e: any) => e.type !== 'message_delta');

  const seen = new Set(dbLogs.map((e: any) => `${e.timestamp}:${e.type}`));
  const merged = [...dbLogs];
  for (const e of streamedLogs) {
    const key = `${e.timestamp}:${e.type}`;
    if (!seen.has(key)) {
      merged.push(e);
      seen.add(key);
    }
  }
  return merged;
}

function getReasoningText(step: any): string {
  const dbDeltas = (step.liveOutput || []).filter((e: any) => e.type === 'message_delta');
  const streamedDeltas = (liveEventsMap.value[step.id] || []).filter((e: any) => e.type === 'message_delta');

  const seen = new Set(dbDeltas.map((e: any) => `${e.timestamp}:${e.content}`));
  const allDeltas = [...dbDeltas];
  for (const e of streamedDeltas) {
    const key = `${e.timestamp}:${e.content}`;
    if (!seen.has(key)) {
      allDeltas.push(e);
      seen.add(key);
    }
  }

  return allDeltas.map((e: any) => e.content || '').join('');
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toggleStep(id: string) {
  if (selectedStepId.value === id) {
    selectedStepId.value = null;
  } else {
    selectedStepId.value = id;
    activeTab.value = 'output';
  }
}

function statusSeverity(s: string) {
  return { completed: 'success', running: 'warn', pending: 'secondary', failed: 'danger', skipped: 'secondary', cancelled: 'secondary' }[s] || 'secondary';
}

function stepDuration(step: any): string | null {
  if (!step.startedAt) return null;
  const end = step.completedAt ? new Date(step.completedAt) : new Date();
  const start = new Date(step.startedAt);
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

const duration = computed(() => {
  if (!execution.value?.startedAt) return '—';
  const end = execution.value.completedAt ? new Date(execution.value.completedAt) : new Date();
  const start = new Date(execution.value.startedAt);
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
});

function formatLogTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ts; }
}

function formatArgs(args: any): string {
  if (!args) return '';
  try {
    const str = typeof args === 'string' ? args : JSON.stringify(args);
    return str.length > 80 ? str.substring(0, 80) + '…' : str;
  } catch { return ''; }
}

function getTraceVal(trace: any, key: string) {
  if (!trace) return null;
  const t = typeof trace === 'string' ? JSON.parse(trace) : trace;
  return t[key] ?? null;
}

function getToolCalls(trace: any) {
  if (!trace) return [];
  const t = typeof trace === 'string' ? JSON.parse(trace) : trace;
  return t.toolCalls ?? t.tool_calls ?? [];
}

async function handleRetry() {
  retrying.value = true;
  try {
    const res = await $fetch<any>(`/api/executions/${execId.value}/retry`, { method: 'POST', headers });
    retryResult.value = res;
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Retry failed', life: 5000 });
  } finally {
    retrying.value = false;
  }
}

async function handleCancel() {
  cancelling.value = true;
  try {
    await $fetch<any>(`/api/executions/${execId.value}/cancel`, { method: 'POST', headers });
    refreshExec();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Cancel failed', life: 5000 });
  } finally {
    cancelling.value = false;
  }
}

// Auto-expand the running step
watch(steps, (newSteps) => {
  if (!selectedStepId.value) {
    const running = newSteps.find((s: any) => s.status === 'running');
    if (running) selectedStepId.value = running.id;
  }
}, { immediate: true });
</script>
