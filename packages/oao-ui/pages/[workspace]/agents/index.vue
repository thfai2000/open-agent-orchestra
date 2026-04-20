<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Agents' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Agents</h1>
        <p class="text-surface-500 text-sm mt-1">Git-hosted AI agent definitions with Copilot SDK integration</p>
      </div>
      <NuxtLink :to="`/${ws}/agents/new`">
        <Button label="Create Agent" icon="pi pi-plus" />
      </NuxtLink>
    </div>

    <DataTable :value="agents" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
      stripedRows :loading="pending" dataKey="id" :rowsPerPageOptions="[10, 20, 50, 100]"
      @update:rows="onRowsChange">
      <template #empty>
        <div class="text-center py-8 text-surface-400">No agents yet. Click "Create Agent" to get started.</div>
      </template>
      <Column field="name" header="Name" style="min-width: 200px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/agents/${data.id}`" class="text-primary font-medium hover:underline">{{ data.name }}</NuxtLink>
          <p v-if="data.description" class="text-xs text-surface-400 mt-0.5 truncate max-w-[300px]">{{ data.description }}</p>
        </template>
      </Column>
      <Column field="status" header="Status" style="width: 100px">
        <template #body="{ data }">
          <Tag :value="data.status" :severity="data.status === 'active' ? 'success' : data.status === 'paused' ? 'warn' : 'danger'" />
        </template>
      </Column>
      <Column header="Source" style="width: 120px">
        <template #body="{ data }">
          <Tag :value="data.sourceType === 'database' ? 'Database' : 'Git'" severity="secondary" />
        </template>
      </Column>
      <Column header="Scope" style="width: 120px">
        <template #body="{ data }">
          <Tag :value="data.scope === 'workspace' ? 'Workspace' : 'Personal'" severity="info" />
        </template>
      </Column>
      <Column header="Tools" style="width: 80px">
        <template #body="{ data }">{{ data.builtinToolsEnabled?.length ?? 0 }}</template>
      </Column>
      <Column header="Last Session" style="width: 140px">
        <template #body="{ data }">
          <span class="text-sm text-surface-500">{{ data.lastSessionAt ? new Date(data.lastSessionAt).toLocaleDateString() : 'Never' }}</span>
        </template>
      </Column>
      <Column header="" style="width: 60px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/agents/${data.id}`">
            <Button icon="pi pi-arrow-right" text rounded size="small" />
          </NuxtLink>
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
  computed(() => `/api/agents?page=${page.value}&limit=${limit.value}`),
  { headers, watch: [page, limit] },
);
const agents = computed(() => (data.value as any)?.agents ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }
</script>
