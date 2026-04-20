<template>
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
