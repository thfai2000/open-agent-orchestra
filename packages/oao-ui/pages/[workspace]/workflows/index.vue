<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Workflows' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold">Workflows</h1>
        <p class="text-muted-foreground text-sm mt-1">Automated multi-step AI workflow definitions</p>
      </div>
      <div class="flex items-center gap-2">
        <SelectButton v-model="viewMode" :options="viewOptions" optionLabel="label" optionValue="value" :allowEmpty="false" />
        <NuxtLink :to="`/${ws}/workflows/new`">
          <Button label="Create Workflow" icon="pi pi-plus" />
        </NuxtLink>
      </div>
    </div>

    <!-- Cards view -->
    <div v-if="viewMode === 'cards'">
      <div v-if="!pending && workflows.length === 0" class="text-center py-12 text-surface-400">
        No workflows yet. Click "Create Workflow" to get started.
      </div>
      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <NuxtLink v-for="wf in workflows" :key="wf.id" :to="`/${ws}/workflows/${wf.id}`"
          class="block rounded-lg border border-surface-700 bg-surface-900/40 p-4 hover:border-primary-500 transition-colors">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full" :class="wf.isActive ? 'bg-green-500' : 'bg-surface-500'" />
                <h3 class="font-semibold text-base truncate">{{ wf.name }}</h3>
              </div>
              <div class="flex flex-wrap items-center gap-1.5 mt-1">
                <Tag :value="wf.isActive ? 'Active' : 'Inactive'" :severity="wf.isActive ? 'success' : 'secondary'" class="text-[10px]" />
                <Tag :value="wf.scope === 'workspace' ? 'Workspace' : 'Personal'" severity="info" class="text-[10px]" />
                <Tag :value="`v${wf.version || 1}`" severity="secondary" class="text-[10px] font-mono" />
              </div>
            </div>
          </div>
          <p v-if="wf.description" class="text-xs text-surface-400 mt-2 line-clamp-2">{{ wf.description }}</p>

          <!-- Sparkline of recent executions -->
          <div v-if="wf.recentExecutions && wf.recentExecutions.length" class="mt-3 flex items-end gap-0.5 h-6">
            <div v-for="(ex, idx) in wf.recentExecutions" :key="idx"
              class="w-2 rounded-sm"
              :class="execColor(ex.status)"
              :style="{ height: execHeight(ex.durationMs) + '%' }"
              :title="`${ex.status} · ${formatDuration(ex.durationMs)}`" />
          </div>
          <div v-else class="mt-3 text-[10px] text-surface-500">No executions yet</div>

          <div class="flex items-center justify-between mt-3 text-xs text-surface-400">
            <span>
              <i class="pi pi-bolt mr-1" />
              {{ (wf.labels || []).length ? (wf.labels || []).join(', ') : 'No labels' }}
            </span>
            <span>
              {{ wf.lastExecutionAt ? `Last: ${new Date(wf.lastExecutionAt).toLocaleDateString()}` : 'Never run' }}
            </span>
          </div>
        </NuxtLink>
      </div>
    </div>

    <!-- Table view -->
    <DataTable v-else :value="workflows" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
      stripedRows :loading="pending" dataKey="id" :rowsPerPageOptions="[10, 20, 50, 100]"
      @update:rows="onRowsChange">
      <template #empty><div class="text-center py-8 text-surface-400">No workflows yet. Click "Create Workflow" to get started.</div></template>
      <Column field="name" header="Name" style="min-width: 200px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/workflows/${data.id}`" class="text-primary font-medium hover:underline">{{ data.name }}</NuxtLink>
          <p v-if="data.description" class="text-xs text-surface-400 mt-0.5 truncate max-w-[300px]">{{ data.description }}</p>
        </template>
      </Column>
      <Column header="Status" style="width: 100px">
        <template #body="{ data }"><Tag :value="data.isActive ? 'Active' : 'Inactive'" :severity="data.isActive ? 'success' : 'secondary'" /></template>
      </Column>
      <Column header="Scope" style="width: 110px">
        <template #body="{ data }"><Tag :value="data.scope === 'workspace' ? 'Workspace' : 'Personal'" severity="info" /></template>
      </Column>
      <Column header="Labels" style="min-width: 150px">
        <template #body="{ data }">
          <div class="flex gap-1 flex-wrap">
            <Tag v-for="l in (data.labels || [])" :key="l" :value="l" severity="secondary" class="text-xs" />
          </div>
        </template>
      </Column>
      <Column header="Version" style="width: 80px">
        <template #body="{ data }"><span class="font-mono text-sm">v{{ data.version || 1 }}</span></template>
      </Column>
      <Column header="Last Run" style="width: 140px">
        <template #body="{ data }">
          <span class="text-sm text-surface-500">{{ data.lastExecutionAt ? new Date(data.lastExecutionAt).toLocaleDateString() : 'Never' }}</span>
        </template>
      </Column>
      <Column header="" style="width: 60px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/workflows/${data.id}`"><Button icon="pi pi-arrow-right" text rounded size="small" /></NuxtLink>
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

const viewMode = ref<'cards' | 'table'>('cards');
const viewOptions = [
  { label: 'Cards', value: 'cards' },
  { label: 'Table', value: 'table' },
];

const page = ref(1);
const limit = ref(20);

const { data, pending } = await useFetch(
  computed(() => `/api/workflows?page=${page.value}&limit=${limit.value}&include=executionStats`),
  { headers, watch: [page, limit] },
);
const workflows = computed<any[]>(() => (data.value as any)?.workflows ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }

function execColor(status: string) {
  switch (status) {
    case 'completed': return 'bg-green-500';
    case 'failed': return 'bg-red-500';
    case 'running': return 'bg-blue-500 animate-pulse';
    case 'pending': return 'bg-yellow-500';
    case 'cancelled': return 'bg-surface-500';
    default: return 'bg-surface-600';
  }
}
function execHeight(durationMs: number | null | undefined) {
  if (!durationMs || durationMs <= 0) return 20;
  // log-scale: 1s→40%, 10s→60%, 60s→80%, 600s→100%
  const seconds = durationMs / 1000;
  const pct = 20 + Math.min(80, Math.log10(seconds + 1) * 30);
  return Math.round(pct);
}
function formatDuration(ms: number | null | undefined) {
  if (!ms) return '–';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
</script>
