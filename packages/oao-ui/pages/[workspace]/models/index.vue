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
      <div class="flex gap-2">
        <Button label="Sync GitHub Catalog" icon="pi pi-sync" outlined :loading="syncing" @click="openSyncDialog" />
        <NuxtLink :to="`/${ws}/models/new`">
          <Button label="Create Model" icon="pi pi-plus" />
        </NuxtLink>
      </div>
    </div>

    <DataTable v-if="models.length > 0" :value="models" stripedRows dataKey="id"
      :rowClass="() => 'cursor-pointer'"
      @rowClick="(e) => goToModel(e.data?.id)">
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
              <Tag v-if="data.catalogSource === 'github_catalog'" value="Catalog" severity="secondary" class="text-[10px]" />
            </div>
            <div v-if="data.providerType === 'custom'" class="text-xs text-surface-400">
              {{ data.customProviderType || 'custom' }} · {{ data.customAuthType || 'none' }}
            </div>
          </div>
        </template>
      </Column>
      <Column header="Tokens (in / out)" style="width: 150px">
        <template #body="{ data }">
          <span class="text-xs font-mono">{{ data.maxInputTokens ? `${(data.maxInputTokens/1000).toFixed(0)}K` : '—' }} / {{ data.maxOutputTokens ? `${(data.maxOutputTokens/1000).toFixed(0)}K` : '—' }}</span>
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
          <ToggleSwitch :modelValue="data.isActive" @update:modelValue="(value) => toggleActive(data, value)" @click.stop />
        </template>
      </Column>
      <Column header="Credit / Step" style="width: 130px">
        <template #body="{ data }"><span class="text-sm font-mono">{{ data.creditCost ?? '—' }}</span></template>
      </Column>
      <Column header="Last Synced" style="width: 160px">
        <template #body="{ data }">
          <span class="text-xs text-surface-400">{{ data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString() : '—' }}</span>
        </template>
      </Column>
    </DataTable>
    <div v-else class="py-12 text-center text-surface-400">
      No models yet. Click <span class="font-semibold">Create Model</span> to add one, or <span class="font-semibold">Sync GitHub Catalog</span> to import the public list.
    </div>

    <Dialog v-model:visible="syncDialogVisible" header="Sync GitHub Models Catalog" :style="{ width: '36rem' }" modal>
      <div class="flex flex-col gap-3">
        <p class="text-sm text-surface-400">
          Pulls the catalog and upserts each model into your personal registry. New rows are inserted <span class="font-semibold">disabled</span> so you opt them in explicitly.
          <span class="font-semibold">isActive</span> and <span class="font-semibold">creditCost</span> are never overwritten on resync.
        </p>
        <label class="text-sm font-medium">GitHub Token Credential</label>
        <Select
          v-model="selectedCredentialOption"
          :options="githubTokenCredentials"
          option-label="key"
          data-key="value"
          option-value="value"
          placeholder="Select a github_token credential (or use server env fallback)"
          :show-clear="true"
        >
          <template #option="{ option }">
            <div class="flex flex-col">
              <span class="font-mono text-sm">{{ option.key }}
                <Tag :value="option.scope === 'workspace' ? 'workspace' : 'user'" :severity="option.scope === 'workspace' ? 'warn' : 'info'" class="ml-2 align-middle" />
              </span>
              <span class="text-xs text-surface-400">{{ option.description || 'No description' }}</span>
            </div>
          </template>
        </Select>
        <p class="text-xs text-surface-500">
          Pick a credential whose sub-type is <span class="font-mono">github_token</span> (or generic <span class="font-mono">secret_text</span>) from your
          <span class="font-mono">user</span> or <span class="font-mono">workspace</span> variables.
          If left blank, the server falls back to <span class="font-mono">DEFAULT_LLM_API_KEY</span> / <span class="font-mono">GITHUB_TOKEN</span>.
        </p>
        <label class="text-sm font-medium mt-2">Catalog URL</label>
        <InputText v-model="syncUrl" placeholder="https://models.github.ai/catalog/models" />
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="syncDialogVisible = false" />
        <Button label="Run Sync" icon="pi pi-sync" :loading="syncing" @click="runSync" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');

const { data, refresh } = await useFetch('/api/models/all', { headers });
const models = computed<any[]>(() => (data.value as any)?.models ?? []);

// Load github_token credentials from BOTH user-scope and workspace-scope variables
// for the sync dialog credential picker.
const { data: userVarsData } = await useFetch('/api/variables', { headers, query: { scope: 'user' } });
const { data: workspaceVarsData } = await useFetch('/api/variables', { headers, query: { scope: 'workspace' } });
const githubTokenCredentials = computed<Array<{ value: string; scope: 'user' | 'workspace'; key: string; description?: string | null }>>(() => {
  const userList = (userVarsData.value as any)?.variables ?? (userVarsData.value as any)?.data ?? [];
  const wsList = (workspaceVarsData.value as any)?.variables ?? (workspaceVarsData.value as any)?.data ?? [];
  // The Select binds on a composed value `"<scope>:<id>"` so both scopes can
  // share the dropdown without colliding ids and so we can post the right
  // `credentialScope` hint to the backend.
  const filterFn = (v: any) =>
    v.variableType === 'credential' &&
    (v.credentialSubType === 'github_token' || v.credentialSubType === 'secret_text' || !v.credentialSubType);
  return [
    ...userList.filter(filterFn).map((v: any) => ({ value: `user:${v.id}`, scope: 'user' as const, key: v.key, description: v.description })),
    ...wsList.filter(filterFn).map((v: any) => ({ value: `workspace:${v.id}`, scope: 'workspace' as const, key: v.key, description: v.description })),
  ];
});
const selectedCredentialOption = ref<string | null>(null);

const syncDialogVisible = ref(false);
const syncUrl = ref('https://models.github.ai/catalog/models');
const syncing = ref(false);

const breadcrumbItems = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Models' },
]);

function goToModel(id?: string) {
  if (id) router.push(`/${ws.value}/models/${id}`);
}

function openSyncDialog() {
  syncDialogVisible.value = true;
}

async function runSync() {
  syncing.value = true;
  try {
    // selectedCredentialOption is `"<scope>:<id>"` — split before posting.
    let credentialId: string | undefined;
    let credentialScope: 'user' | 'workspace' | undefined;
    if (selectedCredentialOption.value) {
      const [scope, id] = selectedCredentialOption.value.split(':');
      if (scope === 'user' || scope === 'workspace') {
        credentialScope = scope;
        credentialId = id;
      }
    }
    const result = await $fetch<any>('/api/models/sync-catalog', {
      method: 'POST',
      headers,
      body: {
        url: syncUrl.value || undefined,
        githubTokenCredentialId: credentialId,
        credentialScope,
      },
    });
    const r = result.result;
    toast.add({
      severity: 'success',
      summary: 'Catalog synced',
      detail: `Fetched ${r.fetched} · Inserted ${r.inserted} · Updated ${r.updated} · Skipped ${r.skipped}${r.errors.length ? ` · Errors ${r.errors.length}` : ''}`,
      life: 6000,
    });
    syncDialogVisible.value = false;
    await refresh();
  } catch (error: any) {
    toast.add({
      severity: 'error',
      summary: 'Catalog sync failed',
      detail: error?.data?.error || error?.message || 'Unknown error',
      life: 8000,
    });
  } finally {
    syncing.value = false;
  }
}

async function toggleActive(model: any, value: boolean) {
  try {
    await $fetch(`/api/models/${model.id}`, {
      method: 'PUT',
      headers,
      body: { isActive: value },
    });
    model.isActive = value;
    toast.add({ severity: 'success', summary: value ? 'Enabled' : 'Disabled', detail: model.name, life: 2000 });
  } catch (error: any) {
    toast.add({ severity: 'error', summary: 'Update failed', detail: error?.data?.error || error?.message, life: 5000 });
    await refresh();
  }
}
</script>
