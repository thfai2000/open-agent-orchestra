<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Executions' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold">Workflow Executions</h1>
        <p class="text-muted-foreground text-sm mt-1">Execution history across all workflows
          <span v-if="streamConnected" class="inline-flex items-center gap-1 text-xs text-green-600 ml-2">
            <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Live
          </span>
        </p>
      </div>
    </div>

    <DataTable :value="executions" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
      stripedRows :loading="pending" dataKey="id" :rowsPerPageOptions="[10, 20, 50, 100]"
      @update:rows="onRowsChange">
      <template #empty><div class="text-center py-8 text-surface-400">No executions yet.</div></template>
      <Column header="ID" style="width: 120px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/executions/${data.id}`" class="text-primary font-mono text-sm hover:underline">{{ data.id.substring(0, 8) }}&hellip;</NuxtLink>
        </template>
      </Column>
      <Column header="Workflow" style="min-width: 150px">
        <template #body="{ data }"><span class="text-sm">{{ data.workflowName || data.workflowId?.substring(0, 8) + '\u2026' }}</span></template>
      </Column>
      <Column header="Version" style="width: 80px">
        <template #body="{ data }"><span class="font-mono text-sm">v{{ data.workflowVersion || '?' }}</span></template>
      </Column>
      <Column header="Trigger" style="width: 120px">
        <template #body="{ data }">
          <Tag :value="formatTriggerType(data.triggerMetadata?.type || 'manual')" severity="secondary" />
        </template>
      </Column>
      <Column header="Status" style="width: 110px">
        <template #body="{ data }"><Tag :value="data.status" :severity="getStatusSeverity(data.status)" /></template>
      </Column>
      <Column header="Progress" style="width: 100px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.currentStep ?? 0 }}/{{ data.totalSteps ?? '?' }}</span></template>
      </Column>
      <Column header="Started" style="width: 170px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.startedAt ? new Date(data.startedAt).toLocaleString() : '\u2014' }}</span></template>
      </Column>
      <Column header="Completed" style="width: 170px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.completedAt ? new Date(data.completedAt).toLocaleString() : '\u2014' }}</span></template>
      </Column>
      <Column header="" style="width: 60px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/executions/${data.id}`"><Button icon="pi pi-arrow-right" text rounded size="small" /></NuxtLink>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');

const page = ref(1);
const limit = ref(20);

const { data, pending, refresh } = await useFetch(
  computed(() => `/api/executions?page=${page.value}&limit=${limit.value}`),
  { headers, watch: [page, limit] },
);
const executions = computed(() => (data.value as any)?.executions ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

// ─── Real-time Updates ───────────────────────────────────────────────
const { connected: streamConnected, on: onStreamEvent } = useExecutionListStream();

// Refresh listing when executions are created or change status
onStreamEvent('execution.created', () => { refresh(); });
onStreamEvent('execution.started', () => { refresh(); });
onStreamEvent('execution.completed', () => { refresh(); });
onStreamEvent('execution.failed', () => { refresh(); });
onStreamEvent('execution.cancelled', () => { refresh(); });

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }
function formatTriggerType(t: string) { return { time_schedule: 'Schedule', webhook: 'Webhook', event: 'Event', manual: 'Manual', exact_datetime: 'Exact Time' }[t] || t; }
function getStatusSeverity(s: string) { return { completed: 'success', running: 'warn', pending: 'warn', failed: 'danger', cancelled: 'secondary' }[s] || 'secondary'; }
</script>
