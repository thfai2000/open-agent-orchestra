#!/usr/bin/env python3
"""Write fixed Vue files for OAO UI bug fixes."""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(BASE, "packages", "oao-ui")

files = {}

# ─── variables/index.vue ───
files["pages/[workspace]/variables/index.vue"] = r'''<template>
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
'''

# ─── events/index.vue ───
files["pages/[workspace]/events/index.vue"] = r'''<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Events' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">System Events</h1>
        <p class="text-surface-500 text-sm mt-1">Audit trail of system events and triggers</p>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-end gap-3 mb-4">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-500">Event Name</label>
        <Select v-model="filterName" :options="eventNames" placeholder="All" showClear class="w-48" />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-500">Scope</label>
        <Select v-model="filterScope" :options="['workspace', 'user']" placeholder="All" showClear class="w-36" />
      </div>
      <Button label="Refresh" icon="pi pi-refresh" severity="secondary" size="small" @click="refresh()" />
    </div>

    <DataTable :value="events" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
      stripedRows :loading="pending" dataKey="id" :rowsPerPageOptions="[10, 20, 50, 100]"
      @update:rows="onRowsChange">
      <template #empty><div class="text-center py-8 text-surface-400">No events found.</div></template>
      <Column header="Event Name" style="min-width: 160px">
        <template #body="{ data }"><Tag :value="data.eventName" /></template>
      </Column>
      <Column header="Scope" style="width: 100px">
        <template #body="{ data }"><Tag :value="data.eventScope || '\u2014'" severity="secondary" /></template>
      </Column>
      <Column header="Data" style="min-width: 200px">
        <template #body="{ data }"><span class="text-xs font-mono text-surface-500">{{ truncPayload(data.eventData) }}</span></template>
      </Column>
      <Column header="Actor" style="width: 130px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.actorId ? data.actorId.substring(0, 8) + '\u2026' : '\u2014' }}</span></template>
      </Column>
      <Column header="Time" style="width: 170px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ new Date(data.createdAt).toLocaleString() }}</span></template>
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
const filterName = ref<string | null>(null);
const filterScope = ref<string | null>(null);

const queryStr = computed(() => {
  const params = new URLSearchParams({ page: String(page.value), limit: String(limit.value) });
  if (filterName.value) params.set('eventName', filterName.value);
  if (filterScope.value) params.set('eventScope', filterScope.value);
  return params.toString();
});

const { data, pending, refresh } = await useFetch(computed(() => `/api/events?${queryStr.value}`), { headers, watch: [page, filterName, filterScope, limit] });
const events = computed(() => (data.value as any)?.events ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

const { data: namesData } = await useFetch('/api/events/names', { headers });
const eventNames = computed(() => (namesData.value as any)?.names ?? []);

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }
function truncPayload(p: any) {
  if (!p) return '\u2014';
  const s = typeof p === 'string' ? p : JSON.stringify(p);
  return s.length > 100 ? s.substring(0, 100) + '\u2026' : s;
}
</script>
'''

# ─── executions/index.vue ───
files["pages/[workspace]/executions/index.vue"] = r'''<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Executions' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Workflow Executions</h1>
        <p class="text-surface-500 text-sm mt-1">Execution history across all workflows</p>
      </div>
    </div>

    <DataTable :value="executions" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
      stripedRows :loading="pending" dataKey="id" :rowsPerPageOptions="[10, 20, 50, 100]"
      @update:rows="onRowsChange">
      <template #empty><div class="text-center py-8 text-surface-400">No executions yet.</div></template>
      <Column header="ID" style="width: 120px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/executions/${data.id}`" class="text-primary font-mono text-sm hover:underline">{{ data.id.substring(0, 8) }}&hellip;</NuxtLink>
        </template>
      </Column>
      <Column header="Workflow" style="min-width: 150px">
        <template #body="{ data }"><span class="text-sm">{{ data.workflowName || data.workflowId?.substring(0, 8) + '\u2026' }}</span></template>
      </Column>
      <Column header="Version" style="width: 80px">
        <template #body="{ data }"><span class="font-mono text-sm">v{{ data.workflowVersion || '?' }}</span></template>
      </Column>
      <Column header="Trigger" style="width: 120px">
        <template #body="{ data }">
          <Tag :value="formatTriggerType(data.triggerMetadata?.type || 'manual')" severity="secondary" />
        </template>
      </Column>
      <Column header="Status" style="width: 110px">
        <template #body="{ data }"><Tag :value="data.status" :severity="getStatusSeverity(data.status)" /></template>
      </Column>
      <Column header="Progress" style="width: 100px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.currentStep ?? 0 }}/{{ data.totalSteps ?? '?' }}</span></template>
      </Column>
      <Column header="Started" style="width: 170px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.startedAt ? new Date(data.startedAt).toLocaleString() : '\u2014' }}</span></template>
      </Column>
      <Column header="Completed" style="width: 170px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.completedAt ? new Date(data.completedAt).toLocaleString() : '\u2014' }}</span></template>
      </Column>
      <Column header="" style="width: 60px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/executions/${data.id}`"><Button icon="pi pi-arrow-right" text rounded size="small" /></NuxtLink>
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
  computed(() => `/api/executions?page=${page.value}&limit=${limit.value}`),
  { headers, watch: [page, limit] },
);
const executions = computed(() => (data.value as any)?.executions ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }
function formatTriggerType(t: string) { return { time_schedule: 'Schedule', webhook: 'Webhook', event: 'Event', manual: 'Manual', exact_datetime: 'Exact Time' }[t] || t; }
function getStatusSeverity(s: string) { return { completed: 'success', running: 'warn', pending: 'warn', failed: 'danger', cancelled: 'secondary' }[s] || 'secondary'; }
</script>
'''

# ─── agents/index.vue ───
files["pages/[workspace]/agents/index.vue"] = r'''<template>
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
'''

# ─── workflows/index.vue ───
files["pages/[workspace]/workflows/index.vue"] = r'''<template>
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
'''

# ─── admin/users.vue ───
files["pages/[workspace]/admin/users.vue"] = r'''<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Admin' }, { label: 'Users' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">User Management</h1>
        <p class="text-surface-500 text-sm mt-1">Manage workspace users and roles</p>
      </div>
      <Button label="Create User" icon="pi pi-plus" @click="showCreate = true" />
    </div>

    <DataTable :value="users" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
      stripedRows :loading="pending" dataKey="id" :rowsPerPageOptions="[10, 20, 50, 100]"
      @update:rows="onRowsChange">
      <template #empty><div class="text-center py-8 text-surface-400">No users found.</div></template>
      <Column header="Name" style="min-width: 150px">
        <template #body="{ data }"><span class="font-medium">{{ data.name || data.email }}</span></template>
      </Column>
      <Column header="Email" style="min-width: 200px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.email }}</span></template>
      </Column>
      <Column header="Role" style="width: 120px">
        <template #body="{ data }">
          <Select :model-value="data.role" :options="roleOptions" optionLabel="label" optionValue="value"
            @update:model-value="updateRole(data.id, $event)" class="w-28" />
        </template>
      </Column>
      <Column header="Joined" style="width: 150px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ new Date(data.createdAt).toLocaleDateString() }}</span></template>
      </Column>
    </DataTable>

    <!-- Create User Dialog -->
    <Dialog v-model:visible="showCreate" header="Create User" :style="{ width: '450px' }" modal>
      <Message v-if="createError" severity="error" :closable="false" class="mb-3">{{ createError }}</Message>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name</label><InputText v-model="form.name" /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Email *</label><InputText v-model="form.email" type="email" /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Password *</label><Password v-model="form.password" toggleMask :feedback="false" /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Role</label>
          <Select v-model="form.role" :options="roleOptions" optionLabel="label" optionValue="value" />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showCreate = false" />
        <Button label="Create" icon="pi pi-check" :loading="saving" @click="handleCreate" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');

const page = ref(1);
const limit = ref(50);
const showCreate = ref(false);
const saving = ref(false);
const createError = ref('');

const roleOptions = [{ label: 'Admin', value: 'admin' }, { label: 'Member', value: 'member' }, { label: 'Viewer', value: 'viewer' }];
const form = reactive({ name: '', email: '', password: '', role: 'member' });

const { data, pending, refresh } = await useFetch(computed(() => `/api/admin/users?page=${page.value}&limit=${limit.value}`), { headers, watch: [page, limit] });
const users = computed(() => (data.value as any)?.users ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }

async function handleCreate() {
  createError.value = '';
  saving.value = true;
  try {
    await $fetch('/api/admin/users', { method: 'POST', headers, body: form });
    showCreate.value = false;
    toast.add({ severity: 'success', summary: 'User created', life: 3000 });
    Object.assign(form, { name: '', email: '', password: '', role: 'member' });
    await refresh();
  } catch (e: any) {
    createError.value = e?.data?.error || 'Failed';
  } finally {
    saving.value = false;
  }
}

async function updateRole(userId: string, role: string) {
  try {
    await $fetch(`/api/admin/users/${userId}/role`, { method: 'PUT', headers, body: { role } });
    toast.add({ severity: 'success', summary: 'Role updated', life: 3000 });
    await refresh();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  }
}
</script>
'''

# Write all files
for rel_path, content in files.items():
    full_path = os.path.join(UI, rel_path)
    with open(full_path, 'w') as f:
        f.write(content.lstrip('\n'))
    lines = content.strip().count('\n') + 1
    print(f"  Written: {rel_path} ({lines} lines)")

print("\nDone writing listing page fixes!")
