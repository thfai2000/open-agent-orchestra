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
        <div class="flex items-center gap-2">
          <h1 class="text-3xl font-bold">{{ isNew ? 'Create Model' : (form.displayName || form.name || 'Edit Model') }}</h1>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 mt-1">
          <Tag v-if="!isNew" :value="isCatalogRow ? 'GitHub Catalog (managed)' : 'Custom'" :severity="isCatalogRow ? 'info' : 'warn'" />
          <Tag v-if="form.publisher" :value="form.publisher" />
          <Tag v-if="!isNew && form.lastSyncedAt" :value="`Last synced ${new Date(form.lastSyncedAt).toLocaleString()}`" severity="secondary" />
        </div>
        <p class="text-muted-foreground text-sm mt-1">
          {{ isCatalogRow
            ? 'GitHub-managed catalog row — only Active toggle, credit cost, and reasoning-effort whitelist are editable. Re-sync replaces other fields.'
            : 'Configure model name, provider routing, credentials, and credit costs.' }}
        </p>
      </div>
      <div class="flex gap-2">
        <Button label="Back to Models" severity="secondary" icon="pi pi-arrow-left" @click="goBack" />
      </div>
    </div>

    <Message v-if="loadError" severity="error" :closable="false" class="mb-4">{{ loadError }}</Message>

    <Card v-if="!loadError">
      <template #content>
        <Message v-if="formError" severity="error" :closable="false" class="mb-4">{{ formError }}</Message>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Model Name *</label>
            <InputText v-model="form.name" placeholder="gpt-4.1" :disabled="isCatalogRow" />
            <small class="text-surface-400">Sent as the `model` value when OAO starts a Copilot session.</small>
          </div>
          <div v-if="isCatalogRow" class="flex flex-col gap-2">
            <label class="text-sm font-medium">Catalog Display Name</label>
            <InputText v-model="form.displayName" disabled />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Provider Mode *</label>
            <Select v-model="form.providerType" :options="providerModeOptions" optionLabel="label" optionValue="value" :disabled="isCatalogRow" />
            <small class="text-surface-400">GitHub uses Copilot CLI auth. Custom uses an explicit ProviderConfig.</small>
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Provider Label</label>
            <InputText v-model="form.provider" placeholder="github" :disabled="isCatalogRow" />
            <small class="text-surface-400">Display label for tables, reporting, and audit trails.</small>
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Credit Cost per Step</label>
            <InputText v-model="form.creditCost" placeholder="1.00" />
            <small class="text-surface-400">Credits consumed per agent step using this model.</small>
          </div>
          <div class="flex flex-col gap-2 md:col-span-2">
            <label class="text-sm font-medium">Supported Reasoning Efforts</label>
            <MultiSelect v-model="form.supportedReasoningEfforts" :options="reasoningEffortOptions" optionLabel="label" optionValue="value" placeholder="Select supported reasoning efforts" />
            <small class="text-surface-400">
              Limits the reasoning-effort dropdown wherever this model is selected. Empty list hides the selector entirely.
              For example, gpt-5-mini accepts low/medium/high — leave xhigh out so it can't be sent.
            </small>
          </div>
          <div class="flex flex-col gap-2 md:col-span-2">
            <label class="text-sm font-medium">Description</label>
            <Textarea v-model="form.description" rows="3" placeholder="Optional notes for operators" :disabled="isCatalogRow" />
          </div>
          <div v-if="isCatalogRow && form.summary" class="flex flex-col gap-2 md:col-span-2">
            <label class="text-sm font-medium">Catalog Summary</label>
            <Textarea :modelValue="form.summary" rows="2" disabled />
          </div>

          <template v-if="isCustomProvider && !isCatalogRow">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium">Custom Provider Type *</label>
              <Select v-model="form.customProviderType" :options="customProviderTypeOptions" optionLabel="label" optionValue="value" placeholder="Select provider" />
              <small class="text-surface-400">Defines the wire format (OpenAI / Azure OpenAI / Anthropic).</small>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium">Authentication Mode *</label>
              <Select v-model="form.customAuthType" :options="customAuthTypeOptions" optionLabel="label" optionValue="value" />
              <small class="text-surface-400">Controls whether OAO passes the agent's secret as `apiKey` or `bearerToken` (the SDK gives bearerToken precedence over apiKey).</small>
            </div>
            <div class="flex flex-col gap-2 md:col-span-2">
              <label class="text-sm font-medium">Base URL *</label>
              <InputText v-model="form.customBaseUrl" placeholder="https://api.openai.com/v1" />
              <small class="text-surface-400">Required by ProviderConfig. Use the provider's REST endpoint root.</small>
            </div>
            <div v-if="showWireApiField" class="flex flex-col gap-2">
              <label class="text-sm font-medium">Wire API</label>
              <Select v-model="form.customWireApi" :options="customWireApiOptions" optionLabel="label" optionValue="value" placeholder="Provider default" showClear />
              <small class="text-surface-400">OpenAI/Azure only. Choose `responses` for the new Responses API; otherwise leave blank.</small>
            </div>
            <div v-if="requiresAzureApiVersion" class="flex flex-col gap-2">
              <label class="text-sm font-medium">Azure API Version *</label>
              <InputText v-model="form.customAzureApiVersion" placeholder="2024-10-21" />
            </div>
          </template>
        </div>

        <div class="flex items-center gap-2 mt-4">
          <Checkbox v-model="form.isActive" :binary="true" inputId="model-active" />
          <label for="model-active" class="text-sm">Active (selectable in agents and conversations)</label>
        </div>

        <div class="flex justify-between gap-2 mt-6">
          <Button v-if="!isNew && !isCatalogRow" label="Delete" severity="danger" outlined icon="pi pi-trash" @click="confirmDelete" />
          <span v-else></span>
          <div class="flex gap-2">
            <Button label="Cancel" severity="secondary" @click="goBack" />
            <Button :label="isNew ? 'Create Model' : 'Save Changes'" icon="pi pi-check" :loading="saving" @click="handleSubmit" />
          </div>
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const confirm = useConfirm();
const ws = computed(() => (route.params.workspace as string) || 'default');
const modelId = computed(() => route.params.id as string);
const isNew = computed(() => modelId.value === 'new');

const providerModeOptions = [
  { label: 'GitHub Provider', value: 'github' },
  { label: 'Custom Provider', value: 'custom' },
];
const customProviderTypeOptions = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Azure OpenAI', value: 'azure' },
  { label: 'Anthropic', value: 'anthropic' },
];
const customAuthTypeOptions = [
  { label: 'None (no auth header)', value: 'none' },
  { label: 'API Key (sent as apiKey)', value: 'api_key' },
  { label: 'Bearer Token (sent as bearerToken)', value: 'bearer_token' },
];
const customWireApiOptions = [
  { label: 'Completions', value: 'completions' },
  { label: 'Responses', value: 'responses' },
];
const reasoningEffortOptions = [
  { label: 'Minimal', value: 'minimal' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'XHigh', value: 'xhigh' },
];

const saving = ref(false);
const formError = ref('');
const loadError = ref('');

const form = reactive({
  name: '',
  displayName: '',
  publisher: '',
  summary: '',
  catalogSource: 'custom' as 'custom' | 'github_catalog',
  lastSyncedAt: null as string | null,
  provider: 'github',
  providerType: 'github' as 'github' | 'custom',
  customProviderType: null as 'openai' | 'azure' | 'anthropic' | null,
  customBaseUrl: '',
  customAuthType: 'none' as 'none' | 'api_key' | 'bearer_token',
  customWireApi: null as 'completions' | 'responses' | null,
  customAzureApiVersion: '',
  description: '',
  creditCost: '1.00',
  isActive: true,
  supportedReasoningEfforts: ['low', 'medium', 'high'] as string[],
});

const isCatalogRow = computed(() => form.catalogSource === 'github_catalog');
const isCustomProvider = computed(() => form.providerType === 'custom');
const showWireApiField = computed(() => form.customProviderType === 'openai' || form.customProviderType === 'azure');
const requiresAzureApiVersion = computed(() => form.customProviderType === 'azure');

const breadcrumbItems = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Models', route: `/${ws.value}/models` },
  { label: isNew.value ? 'Create Model' : (form.displayName || form.name || 'Edit') },
]);

watch(() => form.providerType, (providerType) => {
  if (isCatalogRow.value) return;
  if (providerType === 'custom') {
    if (!form.provider || form.provider === 'github') {
      form.provider = form.customProviderType || 'custom';
    }
    return;
  }
  form.provider = 'github';
  form.customProviderType = null;
  form.customBaseUrl = '';
  form.customAuthType = 'none';
  form.customWireApi = null;
  form.customAzureApiVersion = '';
});

watch(() => form.customProviderType, (providerType) => {
  if (isCatalogRow.value) return;
  if (form.providerType === 'custom' && (!form.provider || form.provider === 'github' || form.provider === 'custom')) {
    form.provider = providerType || 'custom';
  }
  if (providerType !== 'azure') form.customAzureApiVersion = '';
  if (providerType !== 'openai' && providerType !== 'azure') form.customWireApi = null;
});

async function loadModel() {
  if (isNew.value) return;
  try {
    // Use the new dedicated detail endpoint instead of listing all.
    const { model } = await $fetch<{ model: any }>(`/api/models/${modelId.value}`, { headers });
    const m = model;
    if (!m) {
      loadError.value = 'Model not found.';
      return;
    }
    Object.assign(form, {
      name: m.name,
      displayName: m.displayName || '',
      publisher: m.publisher || '',
      summary: m.summary || '',
      catalogSource: m.catalogSource || 'custom',
      lastSyncedAt: m.lastSyncedAt || null,
      provider: m.provider || 'github',
      providerType: m.providerType || 'github',
      customProviderType: m.customProviderType || null,
      customBaseUrl: m.customBaseUrl || '',
      customAuthType: m.customAuthType || 'none',
      customWireApi: m.customWireApi || null,
      customAzureApiVersion: m.customAzureApiVersion || '',
      description: m.description || '',
      creditCost: m.creditCost ?? '1.00',
      isActive: m.isActive !== false,
      supportedReasoningEfforts: Array.isArray(m.supportedReasoningEfforts) && m.supportedReasoningEfforts.length > 0
        ? [...m.supportedReasoningEfforts]
        : ['low', 'medium', 'high'],
    });
  } catch (e: any) {
    loadError.value = e?.data?.error || 'Failed to load model';
  }
}

await loadModel();

function goBack() {
  router.push(`/${ws.value}/models`);
}

function buildCreatePayload() {
  const provider = form.provider.trim() || (form.providerType === 'custom' ? form.customProviderType || 'custom' : 'github');
  return {
    name: form.name.trim(),
    provider,
    providerType: form.providerType,
    customProviderType: form.providerType === 'custom' ? form.customProviderType : null,
    customBaseUrl: form.providerType === 'custom' ? (form.customBaseUrl.trim() || null) : null,
    customAuthType: form.providerType === 'custom' ? form.customAuthType : 'none',
    customWireApi: form.providerType === 'custom' && showWireApiField.value ? form.customWireApi : null,
    customAzureApiVersion: form.providerType === 'custom' && requiresAzureApiVersion.value ? (form.customAzureApiVersion.trim() || null) : null,
    description: form.description.trim() || undefined,
    creditCost: form.creditCost.trim() || '1.00',
    isActive: form.isActive,
    supportedReasoningEfforts: form.supportedReasoningEfforts,
  };
}

function buildUpdatePayload() {
  // Catalog rows can only update isActive, creditCost, supportedReasoningEfforts.
  if (isCatalogRow.value) {
    return {
      isActive: form.isActive,
      creditCost: form.creditCost.trim() || '1.00',
      supportedReasoningEfforts: form.supportedReasoningEfforts,
    };
  }
  return buildCreatePayload();
}

async function handleSubmit() {
  formError.value = '';
  saving.value = true;
  try {
    if (isNew.value) {
      const created = await $fetch<{ model: any }>('/api/models', { method: 'POST', headers, body: buildCreatePayload() });
      toast.add({ severity: 'success', summary: 'Created', life: 3000 });
      router.push(`/${ws.value}/models/${created.model.id}`);
    } else {
      await $fetch(`/api/models/${modelId.value}`, { method: 'PUT', headers, body: buildUpdatePayload() });
      toast.add({ severity: 'success', summary: 'Saved', life: 3000 });
    }
  } catch (e: any) {
    formError.value = e?.data?.details?.[0]?.message || e?.data?.error || 'Failed';
  } finally {
    saving.value = false;
  }
}

function confirmDelete() {
  confirm.require({
    message: `Delete model "${form.name}"?`,
    header: 'Confirm Delete',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      try {
        await $fetch(`/api/models/${modelId.value}`, { method: 'DELETE', headers });
        toast.add({ severity: 'success', summary: 'Deleted', life: 3000 });
        router.push(`/${ws.value}/models`);
      } catch (e: any) {
        toast.add({ severity: 'error', summary: 'Delete Failed', detail: e?.data?.error || 'Error', life: 4000 });
      }
    },
  });
}
</script>
