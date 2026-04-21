<template>
  <div>
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
            <Tag :value="'v' + (workflow.version || 1)" severity="secondary" />
          </div>
          <div class="flex items-center gap-2 mt-3">
            <span class="text-xs font-medium text-surface-500 uppercase tracking-wide">History</span>
            <NuxtLink v-if="olderWorkflowVersion" :to="workflowVersionPath(olderWorkflowVersion.version)">
              <Button icon="pi pi-chevron-left" severity="secondary" outlined size="small" aria-label="Previous version" />
            </NuxtLink>
            <Button v-else icon="pi pi-chevron-left" severity="secondary" outlined size="small" disabled aria-label="Previous version" />
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
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Default Agent</label>
              <Select v-model="editForm.defaultAgentId" :options="agentOptions" optionLabel="name" optionValue="id" placeholder="None" showClear />
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
          <Tab value="steps">Steps ({{ steps.length }})</Tab>
          <Tab value="triggers">Triggers ({{ triggers.length }})</Tab>
          <Tab value="executions">Executions</Tab>
        </TabList>
        <TabPanels>
          <!-- Steps Tab -->
          <TabPanel value="steps">
            <div class="mt-4">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-medium">Workflow Steps</h3>
                <div class="flex gap-2">
                  <Button v-if="!editingSteps" label="Edit Steps" icon="pi pi-pencil" severity="secondary" size="small" @click="startEditSteps" />
                  <template v-else>
                    <Button label="Cancel" severity="secondary" size="small" @click="editingSteps = false" />
                    <Button label="Save Steps" icon="pi pi-check" size="small" :loading="savingSteps" @click="handleSaveSteps" />
                  </template>
                </div>
              </div>

              <!-- Read-only view -->
              <div v-if="!editingSteps" class="flex flex-col gap-4">
                <div v-for="(step, idx) in steps" :key="step.id" class="border border-surface-200 rounded-lg p-4">
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-3">
                      <span class="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold">{{ idx + 1 }}</span>
                      <span class="font-medium">{{ step.name || `Step ${step.stepOrder}` }}</span>
                    </div>
                    <div class="flex items-center gap-2 text-xs text-surface-400 flex-wrap">
                      <Tag v-if="step.agentId" value="Agent override" severity="info" class="text-xs" />
                      <Tag v-if="step.model" :value="step.model" severity="secondary" class="text-xs" />
                      <Tag v-if="step.reasoningEffort" :value="step.reasoningEffort" severity="secondary" class="text-xs" />
                      <Tag v-if="step.workerRuntime" :value="step.workerRuntime" severity="secondary" class="text-xs" />
                      <span>{{ step.timeoutSeconds }}s timeout</span>
                    </div>
                  </div>
                  <pre class="bg-surface-50 p-3 rounded text-sm whitespace-pre-wrap max-h-32 overflow-y-auto mt-2">{{ step.promptTemplate }}</pre>
                </div>
                <p v-if="steps.length === 0" class="text-center text-surface-400 py-4">No steps defined.</p>
              </div>

              <!-- Edit view -->
              <div v-else class="flex flex-col gap-4">
                <div v-for="(step, idx) in editStepsForm" :key="idx" class="border border-surface-200 rounded-lg p-4">
                  <div class="flex items-center justify-between mb-3">
                    <span class="font-medium">Step {{ idx + 1 }}</span>
                    <div class="flex gap-1">
                      <Button icon="pi pi-arrow-up" text rounded size="small" :disabled="idx === 0" @click="moveEditStep(idx, -1)" />
                      <Button icon="pi pi-arrow-down" text rounded size="small" :disabled="idx === editStepsForm.length - 1" @click="moveEditStep(idx, 1)" />
                      <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="editStepsForm.splice(idx, 1)" />
                    </div>
                  </div>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name *</label><InputText v-model="step.name" placeholder="Step name" /></div>
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Agent Override</label>
                      <Select v-model="step.agentId" :options="agentOptions" optionLabel="name" optionValue="id" placeholder="Use default" showClear />
                    </div>
                    <div class="flex flex-col gap-2 md:col-span-2"><label class="text-sm font-medium">Prompt Template *</label>
                      <Textarea v-model="step.promptTemplate" rows="6" placeholder="Use {{ precedent_output }} for previous step output" />
                      <details class="text-xs text-surface-500 mt-1 cursor-pointer">
                        <summary class="font-medium hover:text-primary select-none">Template Variables &amp; Functions Reference (click to expand)</summary>
                        <div class="mt-2 bg-surface-50 border border-surface-200 rounded-lg p-3 flex flex-col gap-2">
                          <p class="font-semibold text-surface-700">Variables</p>
                          <table class="w-full text-xs border-collapse">
                            <tbody>
                              <tr class="border-b border-surface-200"><td class="py-1 pr-3 font-mono text-primary-600 whitespace-nowrap" v-pre>{{ precedent_output }}</td><td class="py-1 text-surface-500">Output from the previous step (empty for step 1)</td></tr>
                              <tr class="border-b border-surface-200"><td class="py-1 pr-3 font-mono text-primary-600 whitespace-nowrap" v-pre>{{ properties.KEY }}</td><td class="py-1 text-surface-500">Property from merged 3-tier map (Workspace &lt; User &lt; Agent)</td></tr>
                              <tr class="border-b border-surface-200"><td class="py-1 pr-3 font-mono text-primary-600 whitespace-nowrap" v-pre>{{ credentials.KEY }}</td><td class="py-1 text-surface-500">Credential from merged 3-tier map (decrypted at runtime)</td></tr>
                              <tr class="border-b border-surface-200"><td class="py-1 pr-3 font-mono text-primary-600 whitespace-nowrap" v-pre>{{ env.KEY }}</td><td class="py-1 text-surface-500">Variables injected as environment variables</td></tr>
                              <tr><td class="py-1 pr-3 font-mono text-primary-600 whitespace-nowrap" v-pre>{{ inputs.KEY }}</td><td class="py-1 text-surface-500">Webhook parameters / manual run inputs</td></tr>
                            </tbody>
                          </table>
                          <p class="font-semibold text-surface-700 mt-2">Jinja2 Syntax</p>
                          <div v-pre class="font-mono bg-surface-100 rounded p-2 text-[11px] leading-relaxed text-surface-600">
                            <span class="text-blue-600">{% if</span> inputs.symbol <span class="text-blue-600">%}</span> Analyze <span class="text-primary-600">{{ inputs.symbol | upper }}</span> <span class="text-blue-600">{% else %}</span> Use default <span class="text-blue-600">{% endif %}</span><br/>
                            <span class="text-blue-600">{% for</span> item <span class="text-blue-600">in</span> properties.LIST.split(',') <span class="text-blue-600">%}</span> - <span class="text-primary-600">{{ item | trim }}</span> <span class="text-blue-600">{% endfor %}</span>
                          </div>
                          <p class="text-surface-400 mt-1">Filters: <span class="font-mono">upper</span>, <span class="font-mono">lower</span>, <span class="font-mono">trim</span>, <span class="font-mono">default('val')</span>, <span class="font-mono">length</span>, <span class="font-mono">replace</span>, <span class="font-mono">split</span></p>
                        </div>
                      </details>
                    </div>
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Model Override</label>
                      <Select v-model="step.model" :options="modelOptions" optionLabel="name" optionValue="name" placeholder="Use default" showClear />
                    </div>
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Reasoning Effort</label>
                      <Select v-model="step.reasoningEffort" :options="reasoningOptions" optionLabel="label" optionValue="value" placeholder="Use default" showClear />
                    </div>
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Worker Runtime</label>
                      <Select v-model="step.workerRuntime" :options="[{ label: 'Static', value: 'static' }, { label: 'Ephemeral', value: 'ephemeral' }]" optionLabel="label" optionValue="value" placeholder="Use default" showClear />
                    </div>
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Timeout (seconds)</label><InputNumber v-model="step.timeoutSeconds" :min="10" :max="3600" /></div>
                  </div>
                </div>
                <Button label="Add Step" icon="pi pi-plus" severity="secondary" @click="addEditStep" />
              </div>
            </div>
          </TabPanel>

          <!-- Triggers Tab -->
          <TabPanel value="triggers">
            <div class="mt-4">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-medium">Triggers</h3>
                <div class="flex gap-2">
                  <Button label="Schedule" icon="pi pi-clock" severity="secondary" size="small" @click="addTrigger('time_schedule')" />
                  <Button label="Webhook" icon="pi pi-link" severity="secondary" size="small" @click="addTrigger('webhook')" />
                  <Button label="Event" icon="pi pi-bell" severity="secondary" size="small" @click="addTrigger('event')" />
                </div>
              </div>
              <DataTable :value="triggers" dataKey="id" stripedRows
                paginator :rows="10" :rowsPerPageOptions="[10, 20, 50]">
                <template #empty><div class="text-center py-8 text-surface-400">No triggers configured.</div></template>
                <Column header="Type" style="width: 140px">
                  <template #body="{ data }"><Tag :value="formatTriggerType(data.triggerType)" /></template>
                </Column>
                <Column header="Active" style="width: 80px">
                  <template #body="{ data }"><Tag :value="data.isActive ? 'Yes' : 'No'" :severity="data.isActive ? 'success' : 'secondary'" /></template>
                </Column>
                <Column header="Configuration">
                  <template #body="{ data }"><span class="text-sm font-mono">{{ formatTriggerConfig(data) }}</span></template>
                </Column>
                <Column header="Last Fired" style="width: 160px">
                  <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.lastFiredAt ? new Date(data.lastFiredAt).toLocaleString() : 'Never' }}</span></template>
                </Column>
                <Column header="" style="width: 100px">
                  <template #body="{ data }">
                    <div class="flex gap-1">
                      <Button icon="pi pi-pencil" text rounded size="small" @click="startEditTrigger(data)" />
                      <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="handleDeleteTrigger(data.id)" />
                    </div>
                  </template>
                </Column>
              </DataTable>

              <!-- Trigger edit dialog -->
              <Dialog v-model:visible="editingTrigger" header="Edit Trigger" :style="{ width: '500px' }" modal>
                <div class="flex flex-col gap-3">
                  <template v-if="editTriggerForm.triggerType === 'time_schedule'">
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Cron Expression</label><InputText v-model="editTriggerForm.configuration.cron" placeholder="0 9 * * 1-5" /></div>
                  </template>
                  <template v-if="editTriggerForm.triggerType === 'webhook'">
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Path</label><InputText v-model="editTriggerForm.configuration.path" /></div>
                    <div class="flex flex-col gap-2">
                      <label class="text-sm font-medium">Parameters</label>
                      <div v-for="(p, pi) in (editTriggerForm.configuration.parameters || [])" :key="pi" class="flex gap-2 items-center">
                        <InputText v-model="p.name" placeholder="param_name" class="flex-1" />
                        <InputText v-model="p.description" placeholder="description" class="flex-1" />
                        <Checkbox v-model="p.required" :binary="true" /><label class="text-sm">Req</label>
                        <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="editTriggerForm.configuration.parameters.splice(pi, 1)" />
                      </div>
                      <Button label="Add Param" icon="pi pi-plus" text size="small" @click="editTriggerForm.configuration.parameters = [...(editTriggerForm.configuration.parameters || []), { name: '', required: false, description: '' }]" />
                    </div>
                  </template>
                  <template v-if="editTriggerForm.triggerType === 'event'">
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Event Name</label><InputText v-model="editTriggerForm.configuration.eventName" /></div>
                  </template>
                  <template v-if="editTriggerForm.triggerType === 'exact_datetime'">
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Date &amp; Time</label><InputText v-model="editTriggerForm.configuration.datetime" type="datetime-local" /></div>
                  </template>
                  <div class="flex items-center gap-2"><Checkbox v-model="editTriggerForm.isActive" :binary="true" inputId="trigActive" /><label for="trigActive" class="text-sm">Active</label></div>
                </div>
                <template #footer>
                  <Button label="Cancel" severity="secondary" @click="editingTrigger = false" />
                  <Button label="Save" icon="pi pi-check" :loading="savingTrigger" @click="handleSaveTrigger" />
                </template>
              </Dialog>
            </div>
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
        </TabPanels>
      </Tabs>
    </div>
    <div v-else class="text-center py-12 text-surface-400">Loading workflow...</div>
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
const wfId = computed(() => route.params.id as string);

const activeTab = ref('steps');
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
const { data: workflowVersionsData } = await useFetch(computed(() => `/api/workflows/${wfId.value}/versions?limit=100`), { headers });
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
const steps = computed(() => (wfData.value as any)?.steps ?? []);

const { data: triggersData, refresh: refreshTriggers } = await useFetch(computed(() => `/api/triggers?workflowId=${wfId.value}`), { headers });
const triggers = computed(() => (triggersData.value as any)?.triggers ?? []);

const { data: execsData, refresh: refreshExecs } = await useFetch(computed(() => `/api/executions?workflowId=${wfId.value}&limit=50`), { headers });
const wfExecutions = computed(() => (execsData.value as any)?.executions ?? []);

const { data: agentsData } = await useFetch('/api/agents', { headers });
const agentOptions = computed(() => (agentsData.value as any)?.agents ?? []);

const { data: modelsData } = await useFetch('/api/admin/models', { headers });
const modelOptions = computed(() => (modelsData.value as any)?.models ?? []);

const webhookTrigger = computed(() => triggers.value.find((t: any) => t.triggerType === 'webhook'));
const webhookParams = computed(() => webhookTrigger.value?.configuration?.parameters ?? []);

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
    await refreshWf();
  } catch (e: any) {
    editError.value = e?.data?.error || 'Failed to save.';
  } finally {
    savingEdit.value = false;
  }
}

async function toggleActive() {
  await $fetch(`/api/workflows/${wfId.value}`, { method: 'PUT', headers, body: { isActive: !workflow.value.isActive } });
  toast.add({ severity: 'success', summary: 'Updated', life: 3000 });
  await refreshWf();
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

// ─── Steps editing ───
const editingSteps = ref(false);
const savingSteps = ref(false);
const editStepsForm = ref<any[]>([]);

function startEditSteps() {
  editStepsForm.value = steps.value.map((s: any) => ({
    name: s.name, promptTemplate: s.promptTemplate, agentId: s.agentId || null,
    model: s.model || null, reasoningEffort: s.reasoningEffort || null,
    workerRuntime: s.workerRuntime || null, timeoutSeconds: s.timeoutSeconds || 300,
  }));
  editingSteps.value = true;
}

function moveEditStep(idx: number, dir: number) {
  const arr = editStepsForm.value;
  const newIdx = idx + dir;
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
}

function addEditStep() {
  editStepsForm.value.push({
    name: `Step ${editStepsForm.value.length + 1}`, promptTemplate: '', agentId: null,
    model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 300,
  });
}

async function handleSaveSteps() {
  savingSteps.value = true;
  try {
    const stepsPayload = editStepsForm.value.map((s, i) => ({
      name: s.name, promptTemplate: s.promptTemplate, stepOrder: i + 1,
      agentId: s.agentId || undefined, model: s.model || undefined,
      reasoningEffort: s.reasoningEffort || undefined,
      workerRuntime: s.workerRuntime || undefined,
      timeoutSeconds: s.timeoutSeconds,
    }));
    await $fetch(`/api/workflows/${wfId.value}/steps`, { method: 'PUT', headers, body: { steps: stepsPayload } });
    toast.add({ severity: 'success', summary: 'Steps saved', life: 3000 });
    editingSteps.value = false;
    await refreshWf();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed to save steps', life: 5000 });
  } finally {
    savingSteps.value = false;
  }
}

// ─── Triggers CRUD ───
const editingTrigger = ref(false);
const savingTrigger = ref(false);
const editTriggerForm = reactive({ id: '', triggerType: '', configuration: {} as any, isActive: true });

function formatTriggerType(t: string) {
  return { time_schedule: 'Schedule', exact_datetime: 'Exact Time', webhook: 'Webhook', event: 'Event', manual: 'Manual' }[t] || t;
}

function formatTriggerConfig(t: any) {
  if (t.triggerType === 'time_schedule') return t.configuration?.cron || '';
  if (t.triggerType === 'webhook') return t.configuration?.path || '';
  if (t.triggerType === 'event') return t.configuration?.eventName || '';
  if (t.triggerType === 'exact_datetime') return t.configuration?.datetime || '';
  return JSON.stringify(t.configuration);
}

function getStatusSeverity(s: string) {
  return { completed: 'success', running: 'warn', pending: 'warn', failed: 'danger', cancelled: 'secondary' }[s] || 'secondary';
}

function randomWebhookPath() {
  const r = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 10);
  return `/wh-${r}`;
}

async function addTrigger(type: string) {
  const config: any = {};
  if (type === 'time_schedule') config.cron = '';
  if (type === 'webhook') { config.path = randomWebhookPath(); config.parameters = []; }
  if (type === 'event') config.eventName = '';
  try {
    await $fetch('/api/triggers', { method: 'POST', headers, body: { workflowId: wfId.value, triggerType: type, configuration: config } });
    toast.add({ severity: 'success', summary: 'Trigger added', life: 3000 });
    await refreshTriggers();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  }
}

function startEditTrigger(t: any) {
  Object.assign(editTriggerForm, { id: t.id, triggerType: t.triggerType, configuration: JSON.parse(JSON.stringify(t.configuration)), isActive: t.isActive !== false });
  editingTrigger.value = true;
}

async function handleSaveTrigger() {
  savingTrigger.value = true;
  try {
    await $fetch(`/api/triggers/${editTriggerForm.id}`, { method: 'PUT', headers, body: { triggerType: editTriggerForm.triggerType, configuration: editTriggerForm.configuration, isActive: editTriggerForm.isActive } });
    toast.add({ severity: 'success', summary: 'Saved', life: 3000 });
    editingTrigger.value = false;
    await refreshTriggers();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  } finally {
    savingTrigger.value = false;
  }
}

async function handleDeleteTrigger(id: string) {
  confirm.require({
    message: 'Delete this trigger?', header: 'Confirm', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' }, acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/triggers/${id}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', life: 3000 });
      await refreshTriggers();
    },
  });
}
</script>
