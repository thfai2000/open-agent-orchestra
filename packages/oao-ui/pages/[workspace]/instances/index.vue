<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Agent Instances' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Agent Instances</h1>
        <p class="text-surface-500 text-sm mt-1">Running and recent Copilot agent sessions</p>
      </div>
      <Button label="Cleanup Stale" icon="pi pi-broom" severity="secondary" :loading="cleaning" @click="handleCleanup" />
    </div>

    <DataTable :value="instances" stripedRows dataKey="id" :loading="pending"
      paginator :rows="20" :rowsPerPageOptions="[10, 20, 50, 100]">
      <template #empty><div class="text-center py-8 text-surface-400">No active agent instances.</div></template>
      <Column header="Name" style="min-width: 160px">
        <template #body="{ data }">
          <span class="font-medium text-sm">{{ data.name }}</span>
        </template>
      </Column>
      <Column header="Type" style="width: 120px">
        <template #body="{ data }"><Tag :value="data.instanceType" :severity="data.instanceType === 'static' ? 'info' : 'warn'" /></template>
      </Column>
      <Column header="Status" style="width: 110px">
        <template #body="{ data }"><Tag :value="data.status" :severity="getStatusSeverity(data.status)" /></template>
      </Column>
      <Column header="Hostname" style="min-width: 140px">
        <template #body="{ data }"><span class="text-sm font-mono text-surface-500">{{ data.hostname || '—' }}</span></template>
      </Column>
      <Column header="Current Step" style="width: 140px">
        <template #body="{ data }">
          <span v-if="data.currentStepExecutionId" class="text-xs font-mono text-surface-400">{{ data.currentStepExecutionId.substring(0, 12) }}…</span>
          <span v-else class="text-sm text-surface-400">—</span>
        </template>
      </Column>
      <Column header="Last Heartbeat" style="width: 170px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.lastHeartbeatAt ? new Date(data.lastHeartbeatAt).toLocaleString() : '—' }}</span></template>
      </Column>
      <Column header="Created" style="width: 170px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ new Date(data.createdAt).toLocaleString() }}</span></template>
      </Column>
      <Column header="" style="width: 60px">
        <template #body="{ data }">
          <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="handleTerminate(data.id)" />
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const confirm = useConfirm();
const ws = computed(() => (route.params.workspace as string) || 'default');

const cleaning = ref(false);

const { data: instData, pending, refresh } = await useFetch('/api/agent-instances', { headers });
const instances = computed(() => (instData.value as any)?.instances ?? []);

function getStatusSeverity(s: string) { return { idle: 'success', busy: 'warn', offline: 'secondary', terminated: 'danger' }[s] || 'secondary'; }

async function handleCleanup() {
  cleaning.value = true;
  try {
    await $fetch('/api/agent-instances/cleanup', { method: 'POST', headers });
    toast.add({ severity: 'success', summary: 'Cleaned up', life: 3000 });
    await refresh();
  } catch { toast.add({ severity: 'error', summary: 'Failed', life: 5000 }); }
  finally { cleaning.value = false; }
}

function handleTerminate(id: string) {
  confirm.require({
    message: 'Terminate this instance?', header: 'Confirm', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' }, acceptProps: { label: 'Terminate', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/agent-instances/${id}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Terminated', life: 3000 });
      await refresh();
    },
  });
}
</script>
