<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Events' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">System Events</h1>
        <p class="text-surface-500 text-sm mt-1">Audit trail of system events and triggers</p>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-500">Event Name</label>
        <MultiSelect v-model="filterName" :options="eventNames" placeholder="All" :showClear="true" :filter="true" display="chip" class="w-72" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-500">Scope</label>
        <MultiSelect v-model="filterScope" :options="['workspace', 'user']" placeholder="All" :showClear="true" display="chip" class="w-56" />
      </div>
      <Button label="Refresh" icon="pi pi-refresh" severity="secondary" size="small" @click="refresh()" />
    </div>

    <DataTable :value="events" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
      stripedRows :loading="pending" dataKey="id" :rowsPerPageOptions="[10, 20, 50, 100]"
      @update:rows="onRowsChange">
      <template #empty><div class="text-center py-8 text-surface-400">No events found.</div></template>
      <Column header="Event Name" style="min-width: 160px">
        <template #body="{ data }"><Tag :value="data.eventName" :title="data.eventName" /></template>
      </Column>
      <Column header="Scope" style="width: 100px">
        <template #body="{ data }"><Tag :value="data.eventScope || '—'" :title="data.eventScope || ''" severity="secondary" /></template>
      </Column>
      <Column header="Data" style="min-width: 200px">
        <template #body="{ data }"><span :title="typeof data.eventData === 'string' ? data.eventData : JSON.stringify(data.eventData)" class="text-xs font-mono text-surface-500">{{ truncPayload(data.eventData) }}</span></template>
      </Column>
      <Column header="Actor" style="width: 130px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.actorId ? data.actorId.substring(0, 8) + '\u2026' : '\u2014' }}</span></template>
      </Column>
      <Column header="Time" style="width: 170px">
        <template #body="{ data }"><span :title="new Date(data.createdAt).toString()" class="text-sm text-surface-500">{{ new Date(data.createdAt).toLocaleString() }}</span></template>
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
const filterName = ref<string[]>([]);
const filterScope = ref<string[]>([]);

const queryStr = computed(() => {
  const params = new URLSearchParams({ page: String(page.value), limit: String(limit.value) });
  if (filterName.value && filterName.value.length) params.set('eventName', filterName.value.join(','));
  if (filterScope.value && filterScope.value.length) params.set('eventScope', filterScope.value.join(','));
  return params.toString();
});

const { data, pending, refresh } = await useFetch(computed(() => `/api/events?${queryStr.value}`), { headers, watch: [page, filterName, filterScope, limit] });
const events = computed(() => (data.value as any)?.events ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

const { data: namesData } = await useFetch('/api/events/names', { headers });
const eventNames = computed(() => (namesData.value as any)?.eventNames ?? []);

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }
function truncPayload(p: any) {
  if (!p) return '\u2014';
  const s = typeof p === 'string' ? p : JSON.stringify(p);
  return s.length > 100 ? s.substring(0, 100) + '\u2026' : s;
}
</script>
