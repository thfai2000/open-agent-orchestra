<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Workflows' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Workflows</h1>
        <p class="text-surface-500 text-sm mt-1">Automated multi-step AI workflow definitions</p>
      </div>
      <NuxtLink :to="`/${ws}/workflows/new`">
        <Button label="Create Workflow" icon="pi pi-plus" />
      </NuxtLink>
    </div>

    <DataTable :value="workflows" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
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

const page = ref(1);
const limit = ref(20);

const { data, pending } = await useFetch(
  computed(() => `/api/workflows?page=${page.value}&limit=${limit.value}`),
  { headers, watch: [page, limit] },
);
const workflows = computed(() => (data.value as any)?.workflows ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }
</script>
