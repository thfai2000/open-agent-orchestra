<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="variable">
      <div class="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 class="text-2xl font-semibold">{{ variable.key }}</h1>
          <div class="flex flex-wrap items-center gap-2 mt-2">
            <Tag :value="scopeLabel(validScope)" :severity="scopeSeverity(validScope)" />
            <Tag :value="variable.variableType" :severity="variable.variableType === 'credential' ? 'warn' : 'info'" />
            <Tag :value="variable.credentialSubType || 'secret_text'" severity="secondary" />
          </div>
          <div class="flex items-center gap-2 mt-3 text-sm">
            <span class="text-surface-500">Version:</span>
            <NuxtLink v-if="olderVersion" :to="versionPath(olderVersion.version)">
              <Button icon="pi pi-chevron-left" severity="secondary" outlined size="small" aria-label="Previous version" />
            </NuxtLink>
            <Button v-else icon="pi pi-chevron-left" severity="secondary" outlined size="small" disabled aria-label="Previous version" />
            <span class="font-medium text-surface-700">v{{ variable.version || 1 }} <span class="text-surface-500">(latest)</span></span>
            <Button icon="pi pi-chevron-right" severity="secondary" outlined size="small" disabled aria-label="Next version" />
          </div>
          <p v-if="variable.description" class="text-surface-500 mt-2">{{ variable.description }}</p>
        </div>
        <div class="flex gap-2">
          <Button label="Delete" icon="pi pi-trash" severity="danger" size="small" @click="confirmDelete" />
        </div>
      </div>

      <Message severity="info" :closable="false" class="mb-6 text-sm">
        Variable values are not shown after creation. Save a new value here when you want to rotate or replace the stored value.
      </Message>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <template #content>
            <div class="flex flex-col gap-3">
              <div>
                <span class="text-surface-500 text-sm">Scope</span>
                <p class="font-medium">{{ scopeLabel(validScope) }}</p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Type</span>
                <p class="font-medium">{{ variable.variableType }}</p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Sub-Type</span>
                <p class="font-medium">{{ variable.credentialSubType || 'secret_text' }}</p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Inject As Env</span>
                <p class="font-medium">{{ variable.injectAsEnvVariable ? 'Yes' : 'No' }}</p>
              </div>
              <div v-if="validScope === 'agent' && variable.agentId">
                <span class="text-surface-500 text-sm">Agent</span>
                <p class="font-medium">
                  <NuxtLink :to="`/${ws}/agents/${variable.agentId}`" class="text-primary hover:underline">
                    {{ shortId(variable.agentId) }}
                  </NuxtLink>
                </p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Created</span>
                <p class="font-medium">{{ formatDateTime(variable.createdAt) }}</p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Updated</span>
                <p class="font-medium">{{ formatDateTime(variable.updatedAt) }}</p>
              </div>
            </div>
          </template>
        </Card>

        <Card>
          <template #content>
            <Message v-if="saveError" severity="error" :closable="false" class="mb-4">{{ saveError }}</Message>
            <div class="flex flex-col gap-4">
              <div class="flex flex-col gap-2">
                <label class="text-sm font-medium">New Value</label>
                <Textarea v-model="editForm.value" rows="5" placeholder="Leave empty to keep the current stored value" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-sm font-medium">Description</label>
                <InputText v-model="editForm.description" />
              </div>
              <div class="flex items-center gap-2">
                <Checkbox v-model="editForm.injectAsEnvVariable" :binary="true" inputId="injectAsEnvVariable" />
                <label for="injectAsEnvVariable" class="text-sm">Inject as environment variable</label>
              </div>
              <div class="flex justify-end">
                <Button label="Save" icon="pi pi-check" :loading="saving" @click="handleSave" />
              </div>
            </div>
          </template>
        </Card>
      </div>
    </div>

    <div v-else class="text-center py-12 text-surface-400">Loading variable...</div>
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
const variableId = computed(() => route.params.id as string);
const rawScope = computed(() => route.params.scope as string);
const validScope = computed(() => ['workspace', 'user', 'agent'].includes(rawScope.value) ? rawScope.value as 'workspace' | 'user' | 'agent' : 'workspace');

const saveError = ref('');
const saving = ref(false);

const { data: variableData, refresh: refreshVariable } = await useFetch<any>(computed(() => `/api/variables/${variableId.value}?scope=${validScope.value}`), { headers });
const { data: versionsData, refresh: refreshVersions } = await useFetch<any>(computed(() => `/api/variables/${variableId.value}/versions?scope=${validScope.value}&limit=100`), { headers });

const variable = computed(() => variableData.value?.variable ?? null);
const versions = computed(() => (versionsData.value?.versions ?? []).slice().sort((left: any, right: any) => right.version - left.version));
const olderVersion = computed(() => {
  const currentVersion = variable.value?.version;
  if (!currentVersion) return null;
  const currentIndex = versions.value.findIndex((entry: any) => entry.version === currentVersion);
  if (currentIndex === -1) return null;
  return versions.value[currentIndex + 1] ?? null;
});

const editForm = reactive({
  value: '',
  description: '',
  injectAsEnvVariable: false,
});

watch(variable, (nextValue) => {
  if (!nextValue) return;
  editForm.value = '';
  editForm.description = nextValue.description || '';
  editForm.injectAsEnvVariable = nextValue.injectAsEnvVariable === true;
}, { immediate: true });

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Variables', route: `/${ws.value}/variables` },
  { label: variable.value?.key || 'Loading...' },
]);

function scopeLabel(scope: 'workspace' | 'user' | 'agent') {
  return { workspace: 'Workspace', user: 'User', agent: 'Agent' }[scope];
}

function scopeSeverity(scope: 'workspace' | 'user' | 'agent') {
  return { workspace: 'success', user: 'info', agent: 'warn' }[scope];
}

function versionPath(version: number | string) {
  return `/${ws.value}/variables/${validScope.value}/${variableId.value}/v/${version}`;
}

function shortId(value: string) {
  return `${value.slice(0, 8)}...`;
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

async function handleSave() {
  saveError.value = '';
  saving.value = true;

  try {
    const body: Record<string, unknown> = {
      scope: validScope.value,
      description: editForm.description,
      injectAsEnvVariable: editForm.injectAsEnvVariable,
    };
    if (editForm.value) body.value = editForm.value;

    await $fetch(`/api/variables/${variableId.value}`, { method: 'PUT', headers, body });
    editForm.value = '';
    toast.add({ severity: 'success', summary: 'Saved', detail: 'Variable updated', life: 3000 });
    await Promise.all([refreshVariable(), refreshVersions()]);
  } catch (error: any) {
    saveError.value = error?.data?.error || 'Failed to update variable';
  } finally {
    saving.value = false;
  }
}

function confirmDelete() {
  if (!variable.value) return;

  confirm.require({
    message: `Delete variable "${variable.value.key}"?`,
    header: 'Confirm Delete',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/variables/${variableId.value}?scope=${validScope.value}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', detail: 'Variable removed', life: 3000 });
      router.push(`/${ws.value}/variables`);
    },
  });
}
</script>