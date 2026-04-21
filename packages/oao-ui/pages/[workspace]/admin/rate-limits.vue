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
          <div class="flex flex-col gap-2"><label class="text-sm font-medium">Weekly Credit Limit</label>
            <InputNumber v-model="settings.weeklyCreditLimit" :min="0" />
          </div>
          <div class="flex flex-col gap-2"><label class="text-sm font-medium">Monthly Credit Limit</label>
            <InputNumber v-model="settings.monthlyCreditLimit" :min="0" />
          </div>
        </div>
        <div class="flex justify-end mt-4">
          <Button label="Save Settings" icon="pi pi-check" :loading="savingSettings" @click="handleSaveSettings" />
        </div>
      </template>
    </Card>

    <!-- Usage Summary -->
    <Card>
      <template #title>
        <div class="flex items-center justify-between gap-3">
          <span>Daily Credit Usage (Last 30 days)</span>
          <div class="flex flex-wrap gap-2">
            <Button
              v-for="option in usageScopeOptions"
              :key="option.value"
              :label="option.label"
              :severity="selectedUsageScope === option.value ? 'contrast' : 'secondary'"
              :outlined="selectedUsageScope !== option.value"
              size="small"
              @click="selectedUsageScope = option.value"
            />
          </div>
        </div>
      </template>
      <template #content>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="rounded-xl border border-surface-200 bg-surface-50 p-4">
            <p class="text-sm text-surface-500">Today</p>
            <p class="mt-1 text-2xl font-semibold">{{ usageSummary.today }}</p>
          </div>
          <div class="rounded-xl border border-surface-200 bg-surface-50 p-4">
            <p class="text-sm text-surface-500">This Week</p>
            <p class="mt-1 text-2xl font-semibold">{{ usageSummary.week }}</p>
          </div>
          <div class="rounded-xl border border-surface-200 bg-surface-50 p-4">
            <p class="text-sm text-surface-500">This Month</p>
            <p class="mt-1 text-2xl font-semibold">{{ usageSummary.month }}</p>
          </div>
        </div>

        <div v-if="loadingUsage" class="py-8 text-center text-surface-400">Loading usage…</div>
        <template v-else>
          <p class="mb-3 text-sm text-surface-500">Viewing {{ currentScopeLabel.toLowerCase() }} usage.</p>
          <CreditUsageChart :data="dailyUsage" :empty-message="`No usage data yet for ${currentScopeLabel.toLowerCase()}.`" />

          <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
            <div>
              <h2 class="text-lg font-semibold mb-3">Credits by Model</h2>
              <div v-if="modelUsage.length > 0" class="flex flex-col gap-3">
                <div v-for="entry in modelUsage" :key="entry.modelName" class="flex items-center gap-3">
                  <div class="flex-1">
                    <div class="mb-1 flex justify-between text-sm">
                      <span class="font-medium">{{ entry.modelName }}</span>
                      <span class="text-surface-500">{{ entry.totalCredits }} credits</span>
                    </div>
                    <ProgressBar :value="getModelPercent(entry.totalCredits)" :showValue="false" style="height: 6px" />
                  </div>
                  <Tag :value="`${entry.totalSessions} sessions`" severity="secondary" />
                </div>
              </div>
              <p v-else class="py-8 text-center text-surface-400">No model usage data.</p>
            </div>

            <div>
              <h2 class="text-lg font-semibold mb-3">Credits by User</h2>
              <DataTable :value="userUsage" stripedRows>
                <template #empty><div class="text-center py-8 text-surface-400">No user usage data.</div></template>
                <Column header="User">
                  <template #body="{ data }">
                    <div>
                      <p class="font-medium">{{ data.userName || data.userEmail || data.userId }}</p>
                      <p v-if="data.userEmail" class="text-xs text-surface-500">{{ data.userEmail }}</p>
                    </div>
                  </template>
                </Column>
                <Column header="Credits" style="width: 140px">
                  <template #body="{ data }"><span class="font-mono text-sm">{{ data.totalCredits }}</span></template>
                </Column>
                <Column header="Sessions" style="width: 120px">
                  <template #body="{ data }"><span class="font-mono text-sm">{{ data.totalSessions }}</span></template>
                </Column>
              </DataTable>
            </div>
          </div>
        </template>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders, user } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');

const savingSettings = ref(false);
const loadingUsage = ref(false);
const selectedUsageScope = ref<'user' | 'workspace' | 'platform'>('workspace');

const settings = reactive({ dailyCreditLimit: null as number | null, weeklyCreditLimit: null as number | null, monthlyCreditLimit: null as number | null });

const { data: settingsData } = await useFetch('/api/admin/quota', { headers });
watch(settingsData, (d) => {
  if (d) Object.assign(settings, (d as any).settings || {});
}, { immediate: true });

const usageScopeOptions = computed(() => {
  const options = [{ label: 'You', value: 'user' as const }, { label: 'Workspace', value: 'workspace' as const }];
  if (user.value?.role === 'super_admin') {
    options.push({ label: 'Platform', value: 'platform' as const });
  }
  return options;
});
const currentScopeLabel = computed(() => usageScopeOptions.value.find((option) => option.value === selectedUsageScope.value)?.label || 'Workspace');

const { data: usageData, pending: loadingUsagePending } = await useFetch(computed(() => `/api/quota/usage?days=30&scope=${selectedUsageScope.value}`), { headers });
const dailyUsage = computed(() => (usageData.value as any)?.dailyUsage ?? []);
const modelUsage = computed(() => (usageData.value as any)?.modelUsage ?? []);
const userUsage = computed(() => (usageData.value as any)?.userUsage ?? []);
const usageSummary = computed(() => ({
  today: (usageData.value as any)?.todayUsage?.totalCredits ?? '0',
  week: (usageData.value as any)?.weekUsage?.totalCredits ?? '0',
  month: (usageData.value as any)?.monthUsage?.totalCredits ?? '0',
}));
watchEffect(() => { loadingUsage.value = loadingUsagePending.value; });

function getModelPercent(credits: string): number {
  const max = Math.max(...modelUsage.value.map((entry: any) => Number(entry.totalCredits)), 1);
  return (Number(credits) / max) * 100;
}

async function handleSaveSettings() {
  savingSettings.value = true;
  try {
    await $fetch('/api/admin/quota', {
      method: 'PUT',
      headers,
      body: {
        dailyCreditLimit: settings.dailyCreditLimit != null ? String(settings.dailyCreditLimit) : null,
        weeklyCreditLimit: settings.weeklyCreditLimit != null ? String(settings.weeklyCreditLimit) : null,
        monthlyCreditLimit: settings.monthlyCreditLimit != null ? String(settings.monthlyCreditLimit) : null,
      },
    });
    toast.add({ severity: 'success', summary: 'Settings saved', life: 3000 });
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  } finally {
    savingSettings.value = false;
  }
}
</script>
