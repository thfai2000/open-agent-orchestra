<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href="/executions">Executions</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>{{ execution?.id?.substring(0, 8) || 'Loading' }}…</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div v-if="execution" class="space-y-6 mt-4">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Execution {{ execution.id.substring(0, 8) }}…</h1>
        <div class="flex items-center gap-3">
          <Button v-if="execution.status === 'failed'" variant="outline" :disabled="retrying" @click="handleRetry">{{ retrying ? 'Retrying…' : 'Retry from Failed Step' }}</Button>
          <Badge :variant="execution.status === 'completed' ? 'default' : execution.status === 'failed' ? 'destructive' : 'secondary'" class="uppercase text-xs px-3 py-1">{{ execution.status }}</Badge>
        </div>
      </div>

      <div v-if="retryResult" class="p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
        Retry execution created! Execution ID: {{ retryResult.id?.substring(0, 8) }}…
        <NuxtLink :to="`/${ws}/executions/${retryResult.id}`" class="text-primary hover:underline ml-2">View →</NuxtLink>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent class="pt-4">
            <p class="text-xs text-muted-foreground">Triggered By</p>
            <p class="font-medium">{{ formatTriggerType(execution.triggerMetadata?.type) }}</p>
            <p v-if="trigger" class="text-xs text-muted-foreground mt-1">{{ formatTriggerDetail(trigger) }}</p>
          </CardContent>
        </Card>
        <Card><CardContent class="pt-4"><p class="text-xs text-muted-foreground">Workflow Version</p><p class="font-medium font-mono">v{{ execution.workflowVersion || '?' }}</p></CardContent></Card>
        <Card><CardContent class="pt-4"><p class="text-xs text-muted-foreground">Started</p><p class="font-medium text-sm">{{ execution.startedAt ? new Date(execution.startedAt).toLocaleString() : '—' }}</p></CardContent></Card>
        <Card><CardContent class="pt-4"><p class="text-xs text-muted-foreground">Completed</p><p class="font-medium text-sm">{{ execution.completedAt ? new Date(execution.completedAt).toLocaleString() : '—' }}</p></CardContent></Card>
        <Card><CardContent class="pt-4"><p class="text-xs text-muted-foreground">Steps</p><p class="font-medium">{{ execution.currentStep || 0 }} / {{ execution.totalSteps || steps.length }}</p></CardContent></Card>
      </div>

      <div v-if="execution.triggerMetadata?.retryOf" class="p-3 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-sm">
        <span class="font-medium">Retry of:</span>
        <NuxtLink :to="`/${ws}/executions/${execution.triggerMetadata.retryOf}`" class="text-primary hover:underline ml-1">{{ String(execution.triggerMetadata.retryOf).substring(0, 8) }}…</NuxtLink>
      </div>

      <Card v-if="workflow">
        <CardContent class="pt-4">
          <p class="text-xs text-muted-foreground">Workflow</p>
          <NuxtLink :to="`/${ws}/workflows/${workflow.id}`" class="font-medium hover:text-primary">{{ workflow.name }}</NuxtLink>
        </CardContent>
      </Card>

      <div v-if="execution.error" class="p-4 rounded-lg border border-destructive bg-destructive/10">
        <p class="font-medium text-destructive">Error</p>
        <p class="text-sm mt-1">{{ execution.error }}</p>
      </div>

      <h2 class="text-xl font-bold">Step Execution Trace</h2>
      <div class="space-y-4">
        <Card v-for="(step, idx) in steps" :key="step.id">
          <div class="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30" @click="toggleStep(step.id)">
            <div class="flex items-center gap-3">
              <span class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                :class="{
                  'bg-green-100 text-green-700': step.status === 'completed',
                  'bg-red-100 text-red-700': step.status === 'failed',
                  'bg-yellow-100 text-yellow-700': step.status === 'running',
                  'bg-gray-100 text-gray-500': step.status === 'pending' || step.status === 'skipped',
                }">{{ idx + 1 }}</span>
              <div>
                <p class="font-semibold">Step {{ step.stepOrder }}</p>
                <p class="text-xs text-muted-foreground">{{ step.id.substring(0, 8) }}…</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span v-if="step.startedAt && step.completedAt" class="text-xs text-muted-foreground">{{ ((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000).toFixed(1) }}s</span>
              <Badge :variant="step.status === 'completed' ? 'default' : step.status === 'failed' ? 'destructive' : 'secondary'" class="uppercase text-xs">{{ step.status }}</Badge>
              <span class="text-muted-foreground text-xs">{{ expandedSteps.has(step.id) ? '▼' : '▶' }}</span>
            </div>
          </div>

          <CardContent v-if="expandedSteps.has(step.id)" class="border-t border-border space-y-3">
            <div v-if="step.resolvedPrompt">
              <p class="text-xs font-medium text-muted-foreground mb-1">Resolved Prompt</p>
              <pre class="bg-muted p-3 rounded text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">{{ step.resolvedPrompt }}</pre>
            </div>
            <div v-if="step.output">
              <p class="text-xs font-medium text-muted-foreground mb-1">Output</p>
              <pre class="bg-muted p-3 rounded text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">{{ step.output }}</pre>
            </div>
            <div v-if="step.reasoningTrace">
              <p class="text-xs font-medium text-muted-foreground mb-1">Reasoning Trace</p>
              <div class="space-y-2">
                <div v-if="getTraceModel(step.reasoningTrace)" class="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Model: <strong>{{ getTraceModel(step.reasoningTrace) }}</strong></span>
                  <span v-if="getTraceReasoningEffort(step.reasoningTrace)">| Reasoning: <strong>{{ getTraceReasoningEffort(step.reasoningTrace) }}</strong></span>
                </div>
                <div v-if="getTraceToolCalls(step.reasoningTrace).length" class="space-y-2">
                  <p class="text-xs font-medium text-blue-600">Tool Calls</p>
                  <Card v-for="(call, i) in getTraceToolCalls(step.reasoningTrace)" :key="i" class="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                    <CardContent class="pt-3 text-xs">
                      <div class="flex items-center gap-2 mb-1">
                        <span class="font-mono font-bold text-blue-700 dark:text-blue-300">{{ call.tool || call.name || 'unknown' }}</span>
                        <span v-if="call.duration" class="text-muted-foreground">({{ call.duration }}ms)</span>
                      </div>
                      <div v-if="call.input || call.arguments || call.params || call.args" class="mt-1">
                        <span class="text-muted-foreground">Input:</span>
                        <pre class="mt-1 whitespace-pre-wrap text-[11px]">{{ JSON.stringify(call.input || call.arguments || call.params || call.args, null, 2) }}</pre>
                      </div>
                      <div v-if="call.output || call.result" class="mt-1">
                        <span class="text-muted-foreground">Output:</span>
                        <pre class="mt-1 whitespace-pre-wrap text-[11px] max-h-32 overflow-y-auto">{{ JSON.stringify(call.output || call.result, null, 2) }}</pre>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <pre v-else class="bg-muted p-3 rounded text-xs whitespace-pre-wrap max-h-64 overflow-y-auto">{{ JSON.stringify(step.reasoningTrace, null, 2) }}</pre>
              </div>
            </div>
            <div v-if="step.error" class="p-3 rounded border border-destructive bg-destructive/10">
              <p class="text-xs text-destructive">{{ step.error }}</p>
            </div>
            <div class="flex gap-4 text-xs text-muted-foreground">
              <span v-if="step.startedAt">Started: {{ new Date(step.startedAt).toLocaleString() }}</span>
              <span v-if="step.completedAt">Completed: {{ new Date(step.completedAt).toLocaleString() }}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    <p v-else class="text-muted-foreground mt-4">Execution not found.</p>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const executionId = route.params.id as string;
const ws = computed(() => (route.params.workspace as string) || 'default');

const { authHeaders } = useAuth();
const headers = authHeaders();

const { data } = await useFetch(`/api/executions/${executionId}`, { headers });

const execution = computed(() => data.value?.execution);
const steps = computed(() => data.value?.steps ?? []);
const workflow = computed(() => data.value?.workflow);
const trigger = computed(() => data.value?.trigger);

function formatTriggerType(type?: string): string {
  if (!type) return 'unknown';
  const labels: Record<string, string> = {
    time_schedule: 'Repeatable Schedule',
    exact_datetime: 'Exact Datetime',
    webhook: 'Webhook',
    event: 'Event',
    manual: 'Manual',
  };
  return labels[type] || type;
}

function formatTriggerDetail(t: any): string {
  const cfg = t?.configuration || {};
  if (cfg.cron) return `cron: ${cfg.cron}`;
  if (cfg.datetime) return `at: ${new Date(cfg.datetime).toLocaleString()}`;
  if (cfg.path) return `path: ${cfg.path}`;
  if (cfg.eventType || cfg.eventName) return `event: ${cfg.eventType || cfg.eventName}`;
  return '';
}

const expandedSteps = ref(new Set<string>());

function toggleStep(id: string) {
  if (expandedSteps.value.has(id)) {
    expandedSteps.value.delete(id);
  } else {
    expandedSteps.value.add(id);
  }
}

function getTraceToolCalls(trace: unknown): Array<Record<string, unknown>> {
  if (!trace) return [];
  if (Array.isArray(trace)) return trace;
  if (typeof trace === 'object' && trace !== null) {
    const t = trace as Record<string, unknown>;
    if (Array.isArray(t.toolCalls)) return t.toolCalls;
    if (Array.isArray(t.tool_calls)) return t.tool_calls;
    if (Array.isArray(t.calls)) return t.calls;
  }
  return [];
}

function getTraceModel(trace: unknown): string | null {
  if (typeof trace === 'object' && trace !== null) {
    return (trace as Record<string, unknown>).model as string ?? null;
  }
  return null;
}

function getTraceReasoningEffort(trace: unknown): string | null {
  if (typeof trace === 'object' && trace !== null) {
    return (trace as Record<string, unknown>).reasoningEffort as string ?? null;
  }
  return null;
}

// Retry failed execution
const retrying = ref(false);
const retryResult = ref<any>(null);

async function handleRetry() {
  retrying.value = true;
  retryResult.value = null;
  try {
    const res = await $fetch<{ execution: any }>(`/api/executions/${executionId}/retry`, {
      method: 'POST',
      headers,
    });
    retryResult.value = res.execution;
  } catch (e: any) {
    alert(e?.data?.error || 'Failed to retry execution');
  } finally {
    retrying.value = false;
  }
}
</script>
