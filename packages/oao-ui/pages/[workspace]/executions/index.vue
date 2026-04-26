<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Executions' }]" class="mb-4 -ml-1">
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

    <div class="flex flex-wrap items-center gap-3 mb-3">
      <label class="text-sm text-surface-500">Status:</label>
      <MultiSelect
        v-model="selectedStatuses"
        :options="statusOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="All statuses"
        :maxSelectedLabels="5"
        size="small"
        class="min-w-64"
        @change="onStatusChange"
      />
      <Button v-if="selectedStatuses.length !== statusOptions.length" label="Reset" icon="pi pi-refresh" text size="small" @click="resetStatusFilter" />
    </div>

    <DataTable :value="executions" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
      stripedRows :loading="pending" dataKey="id" :rowsPerPageOptions="[10, 20, 50, 100]"
      @update:rows="onRowsChange">
      <template #empty><div class="text-center py-8 text-surface-400">No executions match the selected filters.</div></template>
      <Column header="ID" style="width: 120px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/executions/${data.id}`" :title="data.id" class="text-primary font-mono text-sm hover:underline">{{ data.id.substring(0, 8) }}&hellip;</NuxtLink>
        </template>
      </Column>
      <Column header="Workflow" style="min-width: 150px">
        <template #body="{ data }"><span :title="data.workflowName || data.workflowId" class="text-sm">{{ data.workflowName || data.workflowId?.substring(0, 8) + '\u2026' }}</span></template>
      </Column>
      <Column header="Version" style="width: 80px">
        <template #body="{ data }"><span class="font-mono text-sm">v{{ data.workflowVersion || '?' }}</span></template>
      </Column>
      <Column header="Trigger" style="width: 120px">
        <template #body="{ data }">
          <Tag :value="formatTriggerType(data.triggerMetadata?.type || 'manual')" :title="data.triggerMetadata?.type || 'manual'" severity="secondary" />
        </template>
      </Column>
      <Column header="Status" style="width: 150px">
        <template #body="{ data }">
          <div class="flex flex-col gap-1">
            <Tag :value="data.status" :title="data.status" :severity="getStatusSeverity(data.status)" />
            <span v-if="data.quotaWait" class="inline-flex items-center gap-1 text-xs font-medium text-yellow-700">
              <i class="pi pi-clock text-[10px]"></i>Waiting for quota
            </span>
          </div>
        </template>
      </Column>
      <Column header="Progress" style="width: 100px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.currentStep ?? 0 }}/{{ data.totalSteps ?? '?' }}</span></template>
      </Column>
      <Column header="Started" style="width: 170px">
        <template #body="{ data }"><span :title="data.startedAt ? new Date(data.startedAt).toString() : ''" class="text-sm text-surface-500">{{ data.startedAt ? new Date(data.startedAt).toLocaleString() : '\u2014' }}</span></template>
      </Column>
      <Column header="Completed" style="width: 170px">
        <template #body="{ data }"><span :title="data.completedAt ? new Date(data.completedAt).toString() : ''" class="text-sm text-surface-500">{{ data.completedAt ? new Date(data.completedAt).toLocaleString() : '\u2014' }}</span></template>
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
import { formatTriggerType } from '~/utils/triggers';

const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');

const page = ref(1);
const limit = ref(20);

const statusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'Running', value: 'running' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
];
const selectedStatuses = ref<string[]>(statusOptions.map((o) => o.value));

const listUrl = computed(() => {
  const params = new URLSearchParams();
  params.set('page', String(page.value));
  params.set('limit', String(limit.value));
  // Only send the status filter when a strict subset of statuses is selected.
  if (selectedStatuses.value.length > 0 && selectedStatuses.value.length < statusOptions.length) {
    params.set('status', selectedStatuses.value.join(','));
  }
  return `/api/executions?${params.toString()}`;
});

const { data, pending, refresh } = await useFetch(listUrl, { headers, watch: [page, limit, selectedStatuses] });
const executions = computed(() => (data.value as any)?.executions ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

// ─── Real-time Updates ───────────────────────────────────────────────
const { connected: streamConnected, on: onStreamEvent } = useExecutionListStream();

// Refresh listing when executions are created or change status
onStreamEvent('execution.created', () => { refresh(); });
onStreamEvent('execution.started', () => { refresh(); });
onStreamEvent('execution.status', () => { refresh(); });
onStreamEvent('step.quota_waiting', () => { refresh(); });
onStreamEvent('step.allocation_waiting', () => { refresh(); });
onStreamEvent('execution.completed', () => { refresh(); });
onStreamEvent('execution.failed', () => { refresh(); });
onStreamEvent('execution.cancelled', () => { refresh(); });

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }
function onStatusChange() { page.value = 1; }
function resetStatusFilter() { selectedStatuses.value = statusOptions.map((o) => o.value); page.value = 1; }
function getStatusSeverity(s: string) { return { completed: 'success', running: 'warn', pending: 'warn', failed: 'danger', cancelled: 'secondary' }[s] || 'secondary'; }
</script>
