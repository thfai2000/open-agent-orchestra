#!/usr/bin/env python3
"""Write fixed workflow pages for OAO UI."""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(BASE, "packages", "oao-ui")

files = {}

# ─── workflows/new.vue ───
files["pages/[workspace]/workflows/new.vue"] = r'''<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Workflows', route: `/${ws}/workflows` }, { label: 'Create Workflow' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <h1 class="text-2xl font-semibold mb-6">Create Workflow</h1>
    <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>

    <div class="flex flex-col gap-6">
      <Card>
        <template #title>Basic Information</template>
        <template #content>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name *</label><InputText v-model="form.name" placeholder="My Workflow" /></div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Scope</label>
              <Select v-model="form.scope" :options="[{ label: 'Personal', value: 'user' }, { label: 'Workspace', value: 'workspace' }]" optionLabel="label" optionValue="value" />
            </div>
            <div class="flex flex-col gap-2 md:col-span-2"><label class="text-sm font-medium">Description</label><Textarea v-model="form.description" rows="2" /></div>
            <div class="flex flex-col gap-2 md:col-span-2">
              <label class="text-sm font-medium">Labels</label>
              <InputText v-model="labelsInput" placeholder="Comma-separated labels" />
              <small class="text-surface-400">e.g. production, daily, reports</small>
            </div>
          </div>
        </template>
      </Card>

      <Card>
        <template #title>Workflow Defaults</template>
        <template #content>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Default Agent</label>
              <Select v-model="form.defaultAgentId" :options="agentOptions" optionLabel="name" optionValue="id" placeholder="Select agent" showClear />
            </div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Default Model</label>
              <Select v-model="form.defaultModel" :options="modelOptions" optionLabel="name" optionValue="name" placeholder="Default" showClear />
            </div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Default Reasoning Effort</label>
              <Select v-model="form.defaultReasoningEffort" :options="reasoningOptions" optionLabel="label" optionValue="value" showClear placeholder="None" />
            </div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Worker Runtime</label>
              <Select v-model="form.workerRuntime" :options="[{ label: 'Static', value: 'static' }, { label: 'Ephemeral', value: 'ephemeral' }]" optionLabel="label" optionValue="value" />
            </div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Step Timeout (seconds)</label>
              <InputNumber v-model="form.stepAllocationTimeoutSeconds" :min="10" :max="3600" />
            </div>
          </div>
        </template>
      </Card>

      <Card>
        <template #title>Steps</template>
        <template #content>
          <div class="flex flex-col gap-4">
            <div v-for="(step, idx) in form.steps" :key="idx" class="border border-surface-200 rounded-lg p-4">
              <div class="flex items-center justify-between mb-3">
                <span class="font-medium">Step {{ idx + 1 }}</span>
                <div class="flex gap-1">
                  <Button icon="pi pi-arrow-up" text rounded size="small" :disabled="idx === 0" @click="moveStep(idx, -1)" />
                  <Button icon="pi pi-arrow-down" text rounded size="small" :disabled="idx === form.steps.length - 1" @click="moveStep(idx, 1)" />
                  <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="form.steps.splice(idx, 1)" />
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name *</label><InputText v-model="step.name" placeholder="Step name" /></div>
                <div class="flex flex-col gap-2"><label class="text-sm font-medium">Agent Override</label>
                  <Select v-model="step.agentId" :options="agentOptions" optionLabel="name" optionValue="id" placeholder="Use default" showClear />
                </div>
                <div class="flex flex-col gap-2 md:col-span-2"><label class="text-sm font-medium">Prompt Template *</label>
                  <Textarea v-model="step.promptTemplate" rows="6" placeholder="Use {{ precedent_output }} for previous step output, {{ inputs.PARAM }} for webhook params" />
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
            <Button label="Add Step" icon="pi pi-plus" severity="secondary" @click="addStep" />
          </div>
        </template>
      </Card>

      <Card>
        <template #title>Triggers</template>
        <template #content>
          <div class="flex flex-col gap-4">
            <div v-for="(trigger, idx) in form.triggers" :key="idx" class="border border-surface-200 rounded-lg p-4">
              <div class="flex items-center justify-between mb-3">
                <Tag :value="trigger.triggerType" />
                <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="form.triggers.splice(idx, 1)" />
              </div>
              <div class="flex flex-col gap-3">
                <template v-if="trigger.triggerType === 'time_schedule'">
                  <div class="flex flex-col gap-2"><label class="text-sm font-medium">Cron Expression</label><InputText v-model="trigger.configuration.cron" placeholder="0 9 * * 1-5" /></div>
                </template>
                <template v-if="trigger.triggerType === 'webhook'">
                  <div class="flex flex-col gap-2"><label class="text-sm font-medium">Webhook Path</label><InputText v-model="trigger.configuration.path" placeholder="/my-webhook" /></div>
                  <div class="flex flex-col gap-2">
                    <label class="text-sm font-medium">Parameters</label>
                    <div v-for="(p, pi) in (trigger.configuration.parameters || [])" :key="pi" class="flex gap-2 items-center">
                      <InputText v-model="p.name" placeholder="param_name" class="flex-1" />
                      <Checkbox v-model="p.required" :binary="true" /><label class="text-sm">Required</label>
                      <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="trigger.configuration.parameters!.splice(pi, 1)" />
                    </div>
                    <Button label="Add Parameter" icon="pi pi-plus" text size="small" @click="trigger.configuration.parameters = [...(trigger.configuration.parameters || []), { name: '', required: false, description: '' }]" />
                  </div>
                </template>
                <template v-if="trigger.triggerType === 'event'">
                  <div class="flex flex-col gap-2"><label class="text-sm font-medium">Event Name</label><InputText v-model="trigger.configuration.eventName" /></div>
                </template>
                <template v-if="trigger.triggerType === 'exact_datetime'">
                  <div class="flex flex-col gap-2"><label class="text-sm font-medium">Date &amp; Time</label><InputText v-model="trigger.configuration.datetime" type="datetime-local" /></div>
                </template>
              </div>
            </div>
            <div class="flex gap-2">
              <Button label="Schedule" icon="pi pi-clock" severity="secondary" size="small" @click="addTrigger('time_schedule')" />
              <Button label="Webhook" icon="pi pi-link" severity="secondary" size="small" @click="addTrigger('webhook')" />
              <Button label="Event" icon="pi pi-bell" severity="secondary" size="small" @click="addTrigger('event')" />
              <Button label="Exact Time" icon="pi pi-calendar" severity="secondary" size="small" @click="addTrigger('exact_datetime')" />
            </div>
          </div>
        </template>
      </Card>

      <div class="flex justify-end gap-2">
        <NuxtLink :to="`/${ws}/workflows`"><Button label="Cancel" severity="secondary" /></NuxtLink>
        <Button label="Create Workflow" icon="pi pi-check" :loading="saving" @click="handleCreate" />
      </div>
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

const error = ref('');
const saving = ref(false);
const labelsInput = ref('');

const reasoningOptions = [
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
];

const form = reactive({
  name: '', description: '', scope: 'user', defaultAgentId: null as string | null,
  defaultModel: null as string | null, defaultReasoningEffort: null as string | null,
  workerRuntime: 'static', stepAllocationTimeoutSeconds: 300,
  steps: [{ name: 'Step 1', promptTemplate: '', agentId: null as string | null, model: null as string | null, reasoningEffort: null as string | null, workerRuntime: null as string | null, timeoutSeconds: 300 }] as any[],
  triggers: [] as any[],
});

const { data: agentsData } = await useFetch('/api/agents', { headers });
const { data: modelsData } = await useFetch('/api/admin/models', { headers });
const agentOptions = computed(() => (agentsData.value as any)?.agents ?? []);
const modelOptions = computed(() => (modelsData.value as any)?.models ?? []);

function addStep() {
  form.steps.push({ name: `Step ${form.steps.length + 1}`, promptTemplate: '', agentId: null, model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 300 });
}

function moveStep(idx: number, dir: number) {
  const newIdx = idx + dir;
  [form.steps[idx], form.steps[newIdx]] = [form.steps[newIdx], form.steps[idx]];
}

function randomWebhookPath() {
  const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 10);
  return `/wh-${rand}`;
}

function addTrigger(type: string) {
  const config: any = {};
  if (type === 'time_schedule') config.cron = '';
  if (type === 'webhook') { config.path = randomWebhookPath(); config.parameters = []; }
  if (type === 'event') config.eventName = '';
  if (type === 'exact_datetime') config.datetime = '';
  form.triggers.push({ triggerType: type, configuration: config });
}

async function handleCreate() {
  error.value = '';
  saving.value = true;
  try {
    const labels = labelsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const steps = form.steps.map((s, i) => ({
      name: s.name, promptTemplate: s.promptTemplate, stepOrder: i + 1,
      agentId: s.agentId || undefined, model: s.model || undefined,
      reasoningEffort: s.reasoningEffort || undefined, workerRuntime: s.workerRuntime || undefined,
      timeoutSeconds: s.timeoutSeconds,
    }));
    await $fetch('/api/workflows', { method: 'POST', headers, body: { ...form, labels, steps, triggers: form.triggers } });
    toast.add({ severity: 'success', summary: 'Success', detail: 'Workflow created', life: 3000 });
    router.push(`/${ws.value}/workflows`);
  } catch (e: any) {
    error.value = e?.data?.error || 'Failed to create workflow.';
  } finally {
    saving.value = false;
  }
}
</script>
'''

# ─── workflows/[id].vue ───
files["pages/[workspace]/workflows/[id].vue"] = r'''<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Workflows', route: `/${ws}/workflows` }, { label: workflow?.name || 'Loading...' }]" class="mb-4">
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
'''

# Write all files
for rel_path, content in files.items():
    full_path = os.path.join(UI, rel_path)
    with open(full_path, 'w') as f:
        f.write(content.lstrip('\n'))
    lines = content.strip().count('\n') + 1
    print(f"  Written: {rel_path} ({lines} lines)")

print("\nDone writing workflow page fixes!")
