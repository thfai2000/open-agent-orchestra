<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Variables' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Variables</h1>
        <p class="text-surface-500 text-sm mt-1">Manage scoped variables for agents and workflows</p>
      </div>
      <Button label="Create Variable" icon="pi pi-plus" @click="showCreate = true" />
    </div>

    <!-- Scope filter -->
    <div class="flex gap-2 mb-4">
      <SelectButton v-model="scope" :options="scopeOptions" optionLabel="label" optionValue="value" />
    </div>

    <DataTable :value="filteredVars" stripedRows dataKey="id"
      paginator :rows="20" :rowsPerPageOptions="[10, 20, 50, 100]">
      <template #empty><div class="text-center py-8 text-surface-400">No variables found. Select a scope or create one.</div></template>
      <Column header="Key" sortable field="key" style="min-width: 160px">
        <template #body="{ data }"><span class="font-medium font-mono">{{ data.key }}</span></template>
      </Column>
      <Column header="Scope" style="width: 120px">
        <template #body="{ data }"><Tag :value="data._scope" :severity="scopeSeverity(data._scope)" /></template>
      </Column>
      <Column header="Type" style="width: 120px">
        <template #body="{ data }"><Tag :value="data.variableType" :severity="data.variableType === 'credential' ? 'warn' : 'secondary'" /></template>
      </Column>
      <Column header="Sub-Type" style="width: 140px">
        <template #body="{ data }"><span class="text-sm">{{ data.credentialSubType || '\u2014' }}</span></template>
      </Column>
      <Column header="Description" style="min-width: 180px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.description || '\u2014' }}</span></template>
      </Column>
      <Column header="Inject ENV" style="width: 100px">
        <template #body="{ data }"><Tag :value="data.injectAsEnvVariable ? 'Yes' : 'No'" :severity="data.injectAsEnvVariable ? 'success' : 'secondary'" /></template>
      </Column>
      <Column header="" style="width: 100px">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button icon="pi pi-pencil" text rounded size="small" @click="startEdit(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="handleDelete(data)" />
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- Create Dialog -->
    <Dialog v-model:visible="showCreate" header="Create Variable" :style="{ width: '550px' }" modal>
      <Message v-if="formError" severity="error" :closable="false" class="mb-3">{{ formError }}</Message>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Scope *</label>
          <Select v-model="form.scope" :options="[{ label: 'User', value: 'user' }, { label: 'Workspace', value: 'workspace' }, { label: 'Agent', value: 'agent' }]" optionLabel="label" optionValue="value" />
        </div>
        <div v-if="form.scope === 'agent'" class="flex flex-col gap-2"><label class="text-sm font-medium">Agent *</label>
          <Select v-model="form.agentId" :options="agentOptions" optionLabel="name" optionValue="id" placeholder="Select agent" />
        </div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Key *</label>
          <InputText v-model="form.key" placeholder="MY_SECRET_KEY" />
          <small class="text-surface-400">Must match: A-Z, 0-9, underscores</small>
        </div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Value *</label><Textarea v-model="form.value" rows="3" /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Type</label>
          <Select v-model="form.variableType" :options="[{ label: 'Credential', value: 'credential' }, { label: 'Property', value: 'property' }]" optionLabel="label" optionValue="value" />
        </div>
        <div v-if="form.variableType === 'credential'" class="flex flex-col gap-2"><label class="text-sm font-medium">Credential Sub-Type</label>
          <Select v-model="form.credentialSubType" :options="credSubTypes" optionLabel="label" optionValue="value" />
        </div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Description</label><InputText v-model="form.description" /></div>
        <div class="flex items-center gap-2"><Checkbox v-model="form.injectAsEnvVariable" :binary="true" inputId="injectEnv" /><label for="injectEnv" class="text-sm">Inject as environment variable</label></div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showCreate = false" />
        <Button label="Create" icon="pi pi-check" :loading="saving" @click="handleCreate" />
      </template>
    </Dialog>

    <!-- Edit Dialog -->
    <Dialog v-model:visible="showEdit" header="Edit Variable" :style="{ width: '500px' }" modal>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Key</label><InputText :model-value="editForm.key" disabled /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">New Value</label><Textarea v-model="editForm.value" rows="3" placeholder="Enter new value (leave empty to keep current)" /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Description</label><InputText v-model="editForm.description" /></div>
        <div class="flex items-center gap-2"><Checkbox v-model="editForm.injectAsEnvVariable" :binary="true" inputId="editInjectEnv" /><label for="editInjectEnv" class="text-sm">Inject as environment variable</label></div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showEdit = false" />
        <Button label="Save" icon="pi pi-check" :loading="saving" @click="handleUpdate" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const confirm = useConfirm();
const ws = computed(() => (route.params.workspace as string) || 'default');

const scope = ref('workspace');
const showCreate = ref(false);
const showEdit = ref(false);
const saving = ref(false);
const formError = ref('');

const scopeOptions = [
  { label: 'Workspace', value: 'workspace' },
  { label: 'User', value: 'user' },
  { label: 'Agent', value: 'agent' },
];

const credSubTypes = [
  { label: 'Secret Text', value: 'secret_text' },
  { label: 'GitHub Token', value: 'github_token' },
  { label: 'GitHub App', value: 'github_app' },
  { label: 'User Account', value: 'user_account' },
  { label: 'Private Key', value: 'private_key' },
  { label: 'Certificate', value: 'certificate' },
];

const form = reactive({
  scope: 'workspace' as string, agentId: null as string | null,
  key: '', value: '', variableType: 'credential', credentialSubType: 'secret_text',
  description: '', injectAsEnvVariable: false,
});
const editForm = reactive({ id: '', key: '', value: '', description: '', injectAsEnvVariable: false, _scope: '', agentId: null as string | null });

// Fetch variables for each scope
const { data: wsVarsData, refresh: refreshWs } = await useFetch('/api/variables?scope=workspace', { headers });
const { data: userVarsData, refresh: refreshUser } = await useFetch('/api/variables?scope=user', { headers });

const { data: agentsData } = await useFetch('/api/agents', { headers });
const agentOptions = computed(() => (agentsData.value as any)?.agents ?? []);

const agentVarsMap = ref<Record<string, any[]>>({});

async function loadAgentVars() {
  const map: Record<string, any[]> = {};
  for (const agent of agentOptions.value) {
    try {
      const res = await $fetch<any>(`/api/variables?scope=agent&agentId=${agent.id}`, { headers });
      map[agent.id] = (res?.variables ?? []).map((v: any) => ({ ...v, _scope: 'agent', _agentName: agent.name }));
    } catch { /* skip */ }
  }
  agentVarsMap.value = map;
}

onMounted(() => { if (agentOptions.value.length > 0) loadAgentVars(); });
watch(agentOptions, (a) => { if (a.length > 0) loadAgentVars(); });

const wsVars = computed(() => ((wsVarsData.value as any)?.variables ?? []).map((v: any) => ({ ...v, _scope: 'workspace' })));
const userVars = computed(() => ((userVarsData.value as any)?.variables ?? []).map((v: any) => ({ ...v, _scope: 'user' })));
const agentVars = computed(() => Object.values(agentVarsMap.value).flat());

const filteredVars = computed(() => {
  if (scope.value === 'agent') return agentVars.value;
  if (scope.value === 'user') return userVars.value;
  return wsVars.value;
});

function scopeSeverity(s: string) { return { user: 'info', workspace: 'success', agent: 'warn' }[s] || 'secondary'; }

async function refreshAll() {
  await Promise.all([refreshWs(), refreshUser(), loadAgentVars()]);
}

async function handleCreate() {
  formError.value = '';
  saving.value = true;
  try {
    const body: any = {
      key: form.key, value: form.value, variableType: form.variableType,
      credentialSubType: form.credentialSubType, description: form.description,
      injectAsEnvVariable: form.injectAsEnvVariable, scope: form.scope,
    };
    if (form.scope === 'agent') body.agentId = form.agentId;
    await $fetch('/api/variables', { method: 'POST', headers, body });
    showCreate.value = false;
    toast.add({ severity: 'success', summary: 'Created', life: 3000 });
    Object.assign(form, { key: '', value: '', variableType: 'credential', credentialSubType: 'secret_text', description: '', injectAsEnvVariable: false, agentId: null });
    await refreshAll();
  } catch (e: any) {
    formError.value = e?.data?.error || 'Failed to create variable';
  } finally {
    saving.value = false;
  }
}

function startEdit(v: any) {
  Object.assign(editForm, { id: v.id, key: v.key, value: '', description: v.description || '', injectAsEnvVariable: v.injectAsEnvVariable || false, _scope: v._scope, agentId: v.agentId || null });
  showEdit.value = true;
}

async function handleUpdate() {
  saving.value = true;
  try {
    const body: any = { description: editForm.description, injectAsEnvVariable: editForm.injectAsEnvVariable, scope: editForm._scope };
    if (editForm.value) body.value = editForm.value;
    if (editForm.agentId) body.agentId = editForm.agentId;
    await $fetch(`/api/variables/${editForm.id}`, { method: 'PUT', headers, body });
    showEdit.value = false;
    toast.add({ severity: 'success', summary: 'Updated', life: 3000 });
    await refreshAll();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  } finally {
    saving.value = false;
  }
}

function handleDelete(v: any) {
  confirm.require({
    message: `Delete variable "${v.key}"?`, header: 'Confirm', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' }, acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      const params = new URLSearchParams({ scope: v._scope });
      if (v.agentId) params.set('agentId', v.agentId);
      await $fetch(`/api/variables/${v.id}?${params.toString()}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', life: 3000 });
      await refreshAll();
    },
  });
}
</script>
