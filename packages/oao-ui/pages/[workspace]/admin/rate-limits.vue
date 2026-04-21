<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Admin' }, { label: 'Rate Limits & Quotas' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Rate Limits & Quotas</h1>
        <p class="text-surface-500 text-sm mt-1">Configure daily credit limits and view usage</p>
      </div>
    </div>

    <!-- Settings Card -->
    <Card class="mb-6">
      <template #title>Quota Settings</template>
      <template #content>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="flex flex-col gap-2"><label class="text-sm font-medium">Daily Credit Limit</label>
            <InputNumber v-model="settings.dailyCreditLimit" :min="0" />
          </div>
          <div class="flex flex-col gap-2"><label class="text-sm font-medium">Max Concurrent Executions</label>
            <InputNumber v-model="settings.maxConcurrentExecutions" :min="1" />
          </div>
          <div class="flex flex-col gap-2"><label class="text-sm font-medium">Max Step Timeout (seconds)</label>
            <InputNumber v-model="settings.maxStepTimeout" :min="10" />
          </div>
        </div>
        <div class="flex justify-end mt-4">
          <Button label="Save Settings" icon="pi pi-check" :loading="savingSettings" @click="handleSaveSettings" />
        </div>
      </template>
    </Card>

    <!-- Usage Summary -->
    <Card>
      <template #title>Usage (Last 30 days)</template>
      <template #content>
        <DataTable :value="usage" stripedRows :loading="loadingUsage">
          <template #empty><div class="text-center py-8 text-surface-400">No usage data.</div></template>
          <Column header="Date" style="width: 140px">
            <template #body="{ data }"><span class="text-sm font-mono">{{ data.date }}</span></template>
          </Column>
          <Column header="Agent">
            <template #body="{ data }"><span class="text-sm">{{ data.agentName || data.agentId?.substring(0, 8) + '…' }}</span></template>
          </Column>
          <Column header="Tokens Used" style="width: 140px">
            <template #body="{ data }"><span class="text-sm font-mono">{{ (data.tokensUsed || 0).toLocaleString() }}</span></template>
          </Column>
          <Column header="Credits" style="width: 120px">
            <template #body="{ data }"><span class="text-sm font-mono">{{ Number(data.creditsUsed || 0).toFixed(2) }}</span></template>
          </Column>
        </DataTable>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');

const savingSettings = ref(false);
const loadingUsage = ref(false);

const settings = reactive({ dailyCreditLimit: 100, maxConcurrentExecutions: 5, maxStepTimeout: 600 });

const { data: settingsData } = await useFetch('/api/quota/settings', { headers });
watch(settingsData, (d) => {
  if (d) Object.assign(settings, (d as any).settings || d);
}, { immediate: true });

const { data: usageData, pending: loadingUsagePending } = await useFetch('/api/quota/usage?days=30', { headers });
const usage = computed(() => (usageData.value as any)?.usage ?? []);
watchEffect(() => { loadingUsage.value = loadingUsagePending.value; });

async function handleSaveSettings() {
  savingSettings.value = true;
  try {
    await $fetch('/api/quota/settings', { method: 'PUT', headers, body: settings });
    toast.add({ severity: 'success', summary: 'Settings saved', life: 3000 });
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  } finally {
    savingSettings.value = false;
  }
}
</script>
