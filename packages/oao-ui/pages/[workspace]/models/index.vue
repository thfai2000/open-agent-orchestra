<template>
  <div>
    <Breadcrumb :model="breadcrumbItems" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold">Models</h1>
        <p class="text-muted-foreground text-sm mt-1">
          Models available to your agents and conversations. Use <span class="font-semibold">GitHub Provider</span> for Copilot-managed models or <span class="font-semibold">Custom Provider</span> for OpenAI / Azure / Anthropic compatible endpoints.
        </p>
      </div>
      <NuxtLink :to="`/${ws}/models/new`">
        <Button label="Create Model" icon="pi pi-plus" />
      </NuxtLink>
    </div>

    <DataTable v-if="models.length > 0" :value="models" stripedRows dataKey="id"
      :rowClass="() => 'cursor-pointer'"
      @rowClick="(e: any) => goToModel(e.data?.id)">
      <Column header="Model" style="min-width: 240px">
        <template #body="{ data }">
          <div>
            <NuxtLink :to="`/${ws}/models/${data.id}`" class="font-medium text-primary hover:underline">{{ data.displayName || data.name }}</NuxtLink>
            <div class="text-xs text-surface-500 font-mono">{{ data.name }}</div>
            <div v-if="data.summary || data.description" class="text-xs text-surface-400 mt-1 line-clamp-2">{{ data.summary || data.description }}</div>
          </div>
        </template>
      </Column>
      <Column header="Provider" style="min-width: 200px">
        <template #body="{ data }">
          <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2">
              <Tag :value="data.publisher || data.provider || '—'" />
              <Tag :value="data.providerType === 'custom' ? 'Custom' : 'GitHub'" :severity="data.providerType === 'custom' ? 'warn' : 'info'" />
            </div>
            <div v-if="data.providerType === 'custom'" class="text-xs text-surface-400">
              {{ data.customProviderType || 'custom' }} · {{ data.customAuthType || 'none' }}
            </div>
          </div>
        </template>
      </Column>
      <Column header="Reasoning Efforts" style="min-width: 200px">
        <template #body="{ data }">
          <div class="flex flex-wrap gap-1">
            <Tag v-for="effort in (data.supportedReasoningEfforts ?? [])" :key="effort" :value="effort" severity="info" class="text-[10px]" />
            <span v-if="!(data.supportedReasoningEfforts ?? []).length" class="text-xs text-surface-400">none</span>
          </div>
        </template>
      </Column>
      <Column header="Enabled" style="width: 100px">
        <template #body="{ data }">
          <ToggleSwitch :modelValue="data.isActive" @update:modelValue="(value: boolean) => toggleActive(data, value)" @click.stop />
        </template>
      </Column>
      <Column header="Credit / Step" style="width: 130px">
        <template #body="{ data }"><span class="text-sm font-mono">{{ data.creditCost ?? '—' }}</span></template>
      </Column>
    </DataTable>
    <div v-else class="py-12 text-center text-surface-400">
      No models yet. Click <span class="font-semibold">Create Model</span> to add one.
    </div>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');

const { data, refresh } = await useFetch('/api/models', { headers });
const models = computed<any[]>(() => (data.value as any)?.models ?? []);

const breadcrumbItems = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Models' },
]);

function goToModel(id?: string) {
  if (id) router.push(`/${ws.value}/models/${id}`);
}

async function toggleActive(model: any, value: boolean) {
  try {
    await $fetch(`/api/models/${model.id}`, { method: 'PUT', headers, body: { isActive: value } });
    await refresh();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 4000 });
  }
}
</script>
