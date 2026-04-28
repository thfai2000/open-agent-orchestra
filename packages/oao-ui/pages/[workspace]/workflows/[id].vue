<template>
  <div v-if="isHistoricalVersionRoute || isNestedRoute">
    <NuxtPage />
  </div>
  <div v-else>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Workflows', route: `/${ws}/workflows` }, { label: workflow?.name || 'Loading...' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="workflow">
      <!-- Header -->
      <div class="flex items-start justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">{{ workflow.name }}</h1>
          <div class="flex items-center gap-2 mt-2">
            <Tag :value="workflow.isActive ? 'Active' : 'Inactive'" :severity="workflow.isActive ? 'success' : 'secondary'" />
            <Tag :value="workflow.scope === 'workspace' ? 'Workspace' : 'Personal'" severity="info" />
          </div>
          <div class="flex items-center gap-2 mt-3 text-sm">
            <span class="text-surface-500">Version:</span>
            <NuxtLink v-if="olderWorkflowVersion" :to="workflowVersionPath(olderWorkflowVersion.version)">
              <Button icon="pi pi-chevron-left" severity="secondary" outlined size="small" aria-label="Previous version" />
            </NuxtLink>
            <Button v-else icon="pi pi-chevron-left" severity="secondary" outlined size="small" disabled aria-label="Previous version" />
            <span class="font-medium text-surface-700">v{{ workflow.version || 1 }} <span class="text-surface-500">(latest)</span></span>
            <Button icon="pi pi-chevron-right" severity="secondary" outlined size="small" disabled aria-label="Next version" />
          </div>
          <p v-if="workflow.description" class="text-surface-500 mt-2">{{ workflow.description }}</p>
          <div class="flex flex-wrap items-center gap-x-3 mt-2 text-xs text-surface-400">
            <span>Owner: {{ workflow.ownerName || 'Unknown' }}</span>
            <span>&middot;</span>
            <span v-if="workflow.lastExecutionAt">Last run {{ new Date(workflow.lastExecutionAt).toLocaleString() }}</span>
            <span v-else class="italic">Never run</span>
          </div>
          <div v-if="(workflow.labels || []).length > 0" class="flex gap-1 mt-2">
            <Tag v-for="l in workflow.labels" :key="l" :value="l" severity="secondary" class="text-xs" />
          </div>
        </div>
        <div class="flex gap-2">
          <Button label="Manual Run" icon="pi pi-play" size="small" severity="success" @click="showRunDialog = true" />
          <Button :label="workflow.isActive ? 'Deactivate' : 'Activate'" severity="secondary" size="small" @click="toggleActive" />
          <Button label="Edit" icon="pi pi-pencil" severity="secondary" size="small" @click="startEdit" v-if="!editingWorkflow" />
          <Button label="Delete" icon="pi pi-trash" severity="danger" size="small" @click="confirmDeleteWorkflow" />
        </div>
      </div>

      <!-- Manual Run Dialog -->
      <Dialog v-model:visible="showRunDialog" header="Manual Run" :style="{ width: '500px' }" modal>
        <div v-if="webhookParams.length > 0" class="flex flex-col gap-3">
          <div v-for="param in webhookParams" :key="param.name" class="flex flex-col gap-2">
            <label class="text-sm font-medium">{{ param.name }} <span v-if="param.required" class="text-red-500">*</span></label>
            <InputText v-model="runInputs[param.name]" :placeholder="param.description || param.name" />
          </div>
        </div>
        <p v-else class="text-surface-400">No parameters. The workflow will run with empty inputs.</p>
        <template #footer>
          <Button label="Cancel" severity="secondary" @click="showRunDialog = false" />
          <Button label="Start Run" icon="pi pi-play" severity="success" :loading="triggering" @click="handleManualRun" />
        </template>
      </Dialog>

      <!-- Trigger result -->
      <Message v-if="triggerResult" severity="success" :closable="true" class="mb-4">
        Workflow run accepted!
        <NuxtLink v-if="triggerResult.executionId" :to="`/${ws}/executions/${triggerResult.executionId}`" class="text-primary hover:underline ml-2">View Execution &rarr;</NuxtLink>
      </Message>

      <!-- Edit Form -->
      <Card v-if="editingWorkflow" class="mb-6">
        <template #title>Edit Workflow</template>
        <template #content>
          <Message v-if="editError" severity="error" :closable="false" class="mb-4">{{ editError }}</Message>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name *</label><InputText v-model="editForm.name" /></div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Description</label><InputText v-model="editForm.description" /></div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Workflow Agent</label>
              <Select v-model="editForm.defaultAgentId" :options="agentOptions" optionLabel="name" optionValue="id" placeholder="None" showClear />
              <small class="text-surface-400">The agent that will run this workflow's steps (each step can override).</small>
            </div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Default Model</label>
              <Select v-model="editForm.defaultModel" :options="modelOptions" optionLabel="name" optionValue="name" placeholder="None" showClear />
            </div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Default Reasoning Effort</label>
              <Select v-model="editForm.defaultReasoningEffort" :options="reasoningOptions" optionLabel="label" optionValue="value" showClear placeholder="None" />
            </div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Worker Runtime</label>
              <Select v-model="editForm.workerRuntime" :options="[{ label: 'Static', value: 'static' }, { label: 'Ephemeral', value: 'ephemeral' }]" optionLabel="label" optionValue="value" />
            </div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Step Timeout (seconds)</label>
              <InputNumber v-model="editForm.stepAllocationTimeoutSeconds" :min="10" :max="3600" />
            </div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Labels</label>
              <InputText v-model="editLabelsInput" placeholder="Comma-separated" />
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-4">
            <Button label="Cancel" severity="secondary" @click="editingWorkflow = false" />
            <Button label="Save" icon="pi pi-check" :loading="savingEdit" @click="handleSaveEdit" />
          </div>
        </template>
      </Card>

      <!-- Tabs -->
      <Tabs :value="activeTab" @update:value="activeTab = $event">
        <TabList>
          <Tab value="visual">Flows</Tab>
          <Tab value="executions">Executions</Tab>
          <Tab value="variables">Variables</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="visual">
            <Tabs :value="flowsSubTab" @update:value="flowsSubTab = $event" class="mt-2">
              <TabList>
                <Tab value="visual">Visual Editor</Tab>
                <Tab value="yaml">YAML Editor</Tab>
              </TabList>
              <TabPanels>
                <TabPanel value="visual">
                  <WorkflowVisualEditor
                    :workflow-id="wfId"
                    class="mt-4"
                    @saved="handleVisualEditorSaved"
                    @triggers-changed="handleVisualEditorTriggersChanged"
                  />
                </TabPanel>
                <TabPanel value="yaml">
                  <WorkflowYamlEditor
                    v-if="flowsSubTab === 'yaml'"
                    :workflow-id="wfId"
                    class="mt-4"
                    @saved="handleVisualEditorSaved"
                    @triggers-changed="handleVisualEditorTriggersChanged"
                  />
                </TabPanel>
              </TabPanels>
            </Tabs>
          </TabPanel>

          <!-- Executions Tab -->
          <TabPanel value="executions">
            <div class="mt-4">
              <DataTable :value="wfExecutions" dataKey="id" stripedRows paginator :rows="10" :rowsPerPageOptions="[10, 20, 50]">
                <template #empty><div class="text-center py-8 text-surface-400">No executions for this workflow yet.</div></template>
                <Column header="ID" style="width: 120px">
                  <template #body="{ data }">
                    <NuxtLink :to="`/${ws}/executions/${data.id}`" class="text-primary font-mono text-sm hover:underline">{{ data.id.substring(0, 8) }}&hellip;</NuxtLink>
                  </template>
                </Column>
                <Column header="Status">
                  <template #body="{ data }"><Tag :value="data.status" :severity="getStatusSeverity(data.status)" /></template>
                </Column>
                <Column header="Progress" style="width: 100px">
                  <template #body="{ data }"><span class="text-sm">{{ data.currentStep ?? 0 }}/{{ data.totalSteps ?? '?' }}</span></template>
                </Column>
                <Column header="Trigger">
                  <template #body="{ data }"><Tag :value="formatTriggerType(data.triggerMetadata?.type || 'manual')" severity="secondary" /></template>
                </Column>
                <Column header="Started">
                  <template #body="{ data }"><span class="text-sm">{{ data.startedAt ? new Date(data.startedAt).toLocaleString() : '\u2014' }}</span></template>
                </Column>
                <Column header="Completed">
                  <template #body="{ data }"><span class="text-sm">{{ data.completedAt ? new Date(data.completedAt).toLocaleString() : '\u2014' }}</span></template>
                </Column>
                <Column header="" style="width: 60px">
                  <template #body="{ data }">
                    <NuxtLink :to="`/${ws}/executions/${data.id}`"><Button icon="pi pi-arrow-right" text rounded size="small" /></NuxtLink>
                  </template>
                </Column>
              </DataTable>
            </div>
          </TabPanel>
          <!-- Variables Tab -->
          <TabPanel value="variables">
            <div class="mt-4 flex flex-col gap-6">
              <!-- Priority hint -->
              <div class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Variable priority (highest wins): <strong>Execution</strong> &gt; <strong>Agent</strong> &gt; <strong>Workflow</strong> &gt; <strong>User</strong> &gt; <strong>Workspace</strong>.
                Use <code class="font-mono text-xs bg-blue-100 px-1 rounded" v-pre>{{ properties.KEY }}</code> in prompt templates.
              </div>

              <!-- Workspace scope (read-only hint) -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-sm font-semibold text-surface-700">Workspace Scope <span class="ml-1 text-xs font-normal text-surface-400">(lowest priority)</span></h3>
                  <NuxtLink :to="`/${ws}/variables`" class="text-xs text-primary hover:underline">Manage workspace variables →</NuxtLink>
                </div>
                <DataTable :value="wsVariables" size="small" class="text-xs">
                  <template #empty><div class="py-3 text-center text-surface-400">No workspace variables.</div></template>
                  <Column field="key" header="Key" />
                  <Column field="type" header="Type" />
                  <Column field="description" header="Description" />
                </DataTable>
              </div>

              <!-- User scope (read-only hint) -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-sm font-semibold text-surface-700">User Scope</h3>
                  <NuxtLink :to="`/${ws}/variables`" class="text-xs text-primary hover:underline">Manage user variables →</NuxtLink>
                </div>
                <DataTable :value="userVariables" size="small" class="text-xs">
                  <template #empty><div class="py-3 text-center text-surface-400">No user variables.</div></template>
                  <Column field="key" header="Key" />
                  <Column field="type" header="Type" />
                  <Column field="description" header="Description" />
                </DataTable>
              </div>

              <!-- Workflow scope (editable) -->
              <div>
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-sm font-semibold text-surface-700">Workflow Scope <span class="ml-1 text-xs font-normal text-surface-400">(overrides user & workspace)</span></h3>
                  <Button label="Add Variable" icon="pi pi-plus" size="small" @click="wfVarFormVisible = true; resetWfVarForm()" />
                </div>

                <!-- Add/edit form -->
                <div v-if="wfVarFormVisible" class="mb-3 rounded-lg border border-surface-200 bg-surface-50 p-3">
                  <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium">Key *</label>
                      <InputText v-model="wfVarForm.key" placeholder="MY_KEY" :disabled="wfVarEditMode" class="font-mono text-sm" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium">Type</label>
                      <Select v-model="wfVarForm.type" :options="varTypeOptions" optionLabel="label" optionValue="value" />
                    </div>
                    <div class="col-span-2 flex flex-col gap-1">
                      <label class="text-xs font-medium">Value</label>
                      <InputText v-model="wfVarForm.value" :placeholder="wfVarForm.type === 'credential' ? 'Stored encrypted' : 'Value'" />
                    </div>
                    <div class="col-span-2 flex flex-col gap-1">
                      <label class="text-xs font-medium">Description</label>
                      <InputText v-model="wfVarForm.description" placeholder="Optional description" />
                    </div>
                  </div>
                  <div class="mt-3 flex justify-end gap-2">
                    <Button label="Cancel" severity="secondary" size="small" @click="wfVarFormVisible = false" />
                    <Button label="Save" icon="pi pi-check" size="small" :loading="savingWfVar" @click="handleSaveWfVar" />
                  </div>
                </div>

                <DataTable :value="wfVariables" size="small" class="text-xs">
                  <template #empty><div class="py-3 text-center text-surface-400">No workflow variables. Click Add Variable to create one.</div></template>
                  <Column field="key" header="Key">
                    <template #body="{ data }"><code class="font-mono">{{ data.key }}</code></template>
                  </Column>
                  <Column field="type" header="Type" style="width: 100px" />
                  <Column field="description" header="Description" />
                  <Column header="" style="width: 80px">
                    <template #body="{ data }">
                      <div class="flex gap-1">
                        <Button icon="pi pi-pencil" text size="small" @click="startEditWfVar(data)" />
                        <Button icon="pi pi-times" text severity="danger" size="small" @click="handleDeleteWfVar(data.key)" />
                      </div>
                    </template>
                  </Column>
                </DataTable>
              </div>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
    <div v-else class="text-center py-12 text-surface-400">Loading workflow...</div>
  </div>
</template>

<script setup lang="ts">
import {
  formatTriggerType,
} from '~/utils/triggers';

const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const confirm = useConfirm();
const ws = computed(() => (route.params.workspace as string) || 'default');
const wfId = computed(() => route.params.id as string);
const isHistoricalVersionRoute = computed(() => Boolean(route.params.version));
// Detect any nested child route under /workflows/[id]/* (e.g. /graph, /v/[version]).
// When present, defer to <NuxtPage /> so the child page renders without
// the workflow detail UI also rendering above it.
const isNestedRoute = computed(() => {
  const parts = (route.path || '').split('/').filter(Boolean);
  // Expected base path: [workspace, 'workflows', id] → length 3. Anything longer is a child route.
  return parts.length > 3;
});

const activeTab = ref(['executions', 'variables'].includes(route.query.tab as string) ? route.query.tab as string : 'visual');
const flowsSubTab = ref<'visual' | 'yaml'>(route.query.flow === 'yaml' ? 'yaml' : 'visual');
const editingWorkflow = ref(false);
const editError = ref('');
const savingEdit = ref(false);
const editLabelsInput = ref('');
const showRunDialog = ref(false);
const triggering = ref(false);
const triggerResult = ref<any>(null);
const runInputs = reactive<Record<string, string>>({});

const reasoningOptions = [
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
];

// Load data
const { data: wfData, refresh: refreshWf } = await useFetch(computed(() => `/api/workflows/${wfId.value}`), { headers });
const workflow = computed(() => (wfData.value as any)?.workflow ?? null);
const { data: workflowVersionsData, refresh: refreshWorkflowVersions } = await useFetch(computed(() => `/api/workflows/${wfId.value}/versions?limit=100`), { headers });
const workflowVersions = computed(() => (workflowVersionsData.value as any)?.versions ?? []);
const olderWorkflowVersion = computed(() => {
  const currentVersion = workflow.value?.version;
  if (!currentVersion) return null;
  const currentIndex = workflowVersions.value.findIndex((entry: any) => entry.version === currentVersion);
  if (currentIndex === -1) return null;
  return workflowVersions.value[currentIndex + 1] ?? null;
});

function workflowVersionPath(version: number | string) {
  return `/${ws.value}/workflows/${wfId.value}/v/${version}`;
}

const { data: triggersData, refresh: refreshTriggers } = await useFetch(computed(() => `/api/triggers?workflowId=${wfId.value}`), { headers });
const triggers = computed(() => (triggersData.value as any)?.triggers ?? []);

const { data: execsData, refresh: refreshExecs } = await useFetch(computed(() => `/api/executions?workflowId=${wfId.value}&limit=50`), { headers });
const wfExecutions = computed(() => (execsData.value as any)?.executions ?? []);

const { data: agentsData } = await useFetch('/api/agents', { headers });
const agentOptions = computed(() => (agentsData.value as any)?.agents ?? []);

const { data: modelsData } = await useFetch('/api/models', { headers });
const modelOptions = computed(() => (modelsData.value as any)?.models ?? []);

const webhookTrigger = computed(() => triggers.value.find((t: any) => t.triggerType === 'webhook'));
const webhookParams = computed(() => webhookTrigger.value?.configuration?.parameters ?? []);

watch(activeTab, (tab) => {
  router.replace({ query: { ...route.query, tab } });
});

watch(flowsSubTab, (flow) => {
  router.replace({ query: { ...route.query, flow } });
});

async function handleVisualEditorSaved() {
  await Promise.all([refreshWf(), refreshWorkflowVersions()]);
}

async function handleVisualEditorTriggersChanged() {
  await Promise.all([refreshTriggers(), refreshWf(), refreshWorkflowVersions()]);
}

// Edit workflow form
const editForm = reactive({
  name: '', description: '', defaultAgentId: null as string | null,
  defaultModel: null as string | null, defaultReasoningEffort: null as string | null,
  workerRuntime: 'static', stepAllocationTimeoutSeconds: 300,
});

watch(workflow, (w) => {
  if (w) {
    Object.assign(editForm, {
      name: w.name, description: w.description || '',
      defaultAgentId: w.defaultAgentId, defaultModel: w.defaultModel,
      defaultReasoningEffort: w.defaultReasoningEffort,
      workerRuntime: w.workerRuntime || 'static',
      stepAllocationTimeoutSeconds: w.stepAllocationTimeoutSeconds || 300,
    });
    editLabelsInput.value = (w.labels || []).join(', ');
  }
}, { immediate: true });

function startEdit() { editingWorkflow.value = true; }

async function handleSaveEdit() {
  editError.value = '';
  savingEdit.value = true;
  try {
    const labels = editLabelsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    await $fetch(`/api/workflows/${wfId.value}`, { method: 'PUT', headers, body: { ...editForm, labels } });
    toast.add({ severity: 'success', summary: 'Saved', detail: 'Workflow updated', life: 3000 });
    editingWorkflow.value = false;
    await Promise.all([refreshWf(), refreshWorkflowVersions()]);
  } catch (e: any) {
    editError.value = e?.data?.error || 'Failed to save.';
  } finally {
    savingEdit.value = false;
  }
}

async function toggleActive() {
  await $fetch(`/api/workflows/${wfId.value}`, { method: 'PUT', headers, body: { isActive: !workflow.value.isActive } });
  toast.add({ severity: 'success', summary: 'Updated', life: 3000 });
  await Promise.all([refreshWf(), refreshWorkflowVersions()]);
}

function confirmDeleteWorkflow() {
  confirm.require({
    message: `Delete "${workflow.value.name}"?`, header: 'Confirm Delete', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' }, acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/workflows/${wfId.value}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', life: 3000 });
      router.push(`/${ws.value}/workflows`);
    },
  });
}

// Manual run
async function handleManualRun() {
  triggering.value = true;
  try {
    const res = await $fetch<any>(`/api/workflows/${wfId.value}/run`, { method: 'POST', headers, body: { inputs: { ...runInputs } } });
    triggerResult.value = res;
    showRunDialog.value = false;
    toast.add({ severity: 'success', summary: 'Run started', life: 3000 });
    setTimeout(() => refreshExecs(), 2000);
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  } finally {
    triggering.value = false;
  }
}

function getStatusSeverity(s: string) {
  return { completed: 'success', running: 'warn', pending: 'warn', failed: 'danger', cancelled: 'secondary' }[s] || 'secondary';
}

// ── Variables tab ─────────────────────────────────────────────────────────
const { data: wfVarsData, refresh: refreshWfVars } = await useFetch(
  computed(() => `/api/workflow-graph/${wfId.value}/variables`),
  { headers }
);
const wfVariables = computed(() => (wfVarsData.value as any)?.variables ?? []);

const { data: wsVarsData } = await useFetch('/api/variables?scope=workspace', { headers });
const wsVariables = computed(() => (wsVarsData.value as any)?.variables ?? []);

const { data: userVarsData } = await useFetch('/api/variables?scope=user', { headers });
const userVariables = computed(() => (userVarsData.value as any)?.variables ?? []);

const wfVarFormVisible = ref(false);
const wfVarEditMode = ref(false);
const savingWfVar = ref(false);
const wfVarForm = reactive({ key: '', type: 'property', value: '', description: '' });
const varTypeOptions = [
  { label: 'Property', value: 'property' },
  { label: 'Credential', value: 'credential' },
  { label: 'Short Memory', value: 'short_memory' },
];

function resetWfVarForm() {
  Object.assign(wfVarForm, { key: '', type: 'property', value: '', description: '' });
  wfVarEditMode.value = false;
}

function startEditWfVar(variable: any) {
  Object.assign(wfVarForm, { key: variable.key, type: variable.type || 'property', value: variable.value ?? '', description: variable.description || '' });
  wfVarEditMode.value = true;
  wfVarFormVisible.value = true;
}

async function handleSaveWfVar() {
  if (!wfVarForm.key.trim()) return;
  savingWfVar.value = true;
  try {
    await $fetch(`/api/workflow-graph/${wfId.value}/variables`, {
      method: 'PUT', headers,
      body: { key: wfVarForm.key, value: wfVarForm.value, type: wfVarForm.type, description: wfVarForm.description || undefined },
    });
    toast.add({ severity: 'success', summary: 'Variable saved', life: 3000 });
    wfVarFormVisible.value = false;
    resetWfVarForm();
    await refreshWfVars();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  } finally {
    savingWfVar.value = false;
  }
}

async function handleDeleteWfVar(key: string) {
  confirm.require({
    message: `Delete variable "${key}"?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/workflow-graph/${wfId.value}/variables/${key}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', life: 3000 });
      await refreshWfVars();
    },
  });
}
</script>
