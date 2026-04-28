<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Workflows', route: `/${ws}/workflows` }, { label: 'Create Workflow' }]" class="mb-4 -ml-1">
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
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Workflow Agent</label>
              <Select v-model="form.defaultAgentId" :options="agentOptions" optionLabel="name" optionValue="id" placeholder="Select agent" showClear />
              <small class="text-surface-400">The agent that will run this workflow's steps (each step can override).</small>
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
          <div class="flex flex-col gap-5">
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <button
                v-for="triggerType in triggerTypes"
                :key="triggerType.type"
                type="button"
                class="rounded-xl border border-surface-200 bg-white p-4 text-left transition-colors hover:border-primary/40 hover:bg-surface-50"
                @click="addTrigger(triggerType)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-surface-900">{{ triggerType.label }}</p>
                    <p class="mt-1 text-xs text-surface-500">{{ triggerType.description }}</p>
                  </div>
                  <Tag :value="triggerType.category" severity="secondary" class="text-[11px]" />
                </div>
                <p v-if="triggerType.notes" class="mt-3 text-xs text-surface-400">{{ triggerType.notes }}</p>
              </button>
            </div>

            <div v-if="form.triggers.length === 0" class="rounded-xl border border-dashed border-surface-300 px-4 py-6 text-center text-sm text-surface-400">
              No triggers added yet. Choose one of the trigger types above to start wiring workflow execution.
            </div>

            <div v-for="(trigger, idx) in form.triggers" :key="`${trigger.triggerType}-${idx}`" class="rounded-xl border border-surface-200 bg-white p-5">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <Tag :value="formatTriggerType(trigger.triggerType)" severity="info" />
                    <Tag :value="trigger.isActive === false ? 'Inactive' : 'Active'" :severity="trigger.isActive === false ? 'secondary' : 'success'" />
                  </div>
                  <p class="mt-2 text-sm text-surface-500">{{ formatTriggerConfiguration(trigger) }}</p>
                </div>
                <div class="flex items-center gap-3">
                  <label class="flex items-center gap-2 text-sm text-surface-600">
                    <Checkbox v-model="trigger.isActive" :binary="true" />
                    Active
                  </label>
                  <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="form.triggers.splice(idx, 1)" />
                </div>
              </div>

              <div class="mt-4">
                <WorkflowTriggerFields :trigger="trigger" :credential-options="workflowCredentialOptions" />
              </div>
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
import { createTriggerDraft, formatTriggerConfiguration, formatTriggerType } from '~/utils/triggers';

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
const { data: modelsData } = await useFetch('/api/models', { headers });
const { data: triggerTypesData } = await useFetch('/api/triggers/types', { headers });
const { data: userVarsData } = await useFetch('/api/variables?scope=user', { headers });
const { data: wsVarsData } = await useFetch('/api/variables?scope=workspace', { headers });
const agentOptions = computed(() => (agentsData.value as any)?.agents ?? []);
const modelOptions = computed(() => (modelsData.value as any)?.models ?? []);
const triggerTypes = computed(() => (triggerTypesData.value as any)?.types ?? []);
const { buildCredentialOptions } = useAgentCredentialOptions();
const workflowCredentialOptions = computed(() => buildCredentialOptions([
  { scope: 'user', scopeLabel: 'User', variables: (userVarsData.value as any)?.variables ?? [] },
  { scope: 'workspace', scopeLabel: 'Workspace', variables: (wsVarsData.value as any)?.variables ?? [] },
]));

function addStep() {
  form.steps.push({ name: `Step ${form.steps.length + 1}`, promptTemplate: '', agentId: null, model: null, reasoningEffort: null, workerRuntime: null, timeoutSeconds: 300 });
}

function moveStep(idx: number, dir: number) {
  const newIdx = idx + dir;
  [form.steps[idx], form.steps[newIdx]] = [form.steps[newIdx], form.steps[idx]];
}

function addTrigger(triggerType: any) {
  form.triggers.push(createTriggerDraft(triggerType));
}

async function handleCreate() {
  error.value = '';
  saving.value = true;
  try {
    await nextTick();
    const labels = labelsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const steps = form.steps.map((s, i) => ({
      name: s.name, promptTemplate: s.promptTemplate, stepOrder: i + 1,
      agentId: s.agentId || undefined, model: s.model || undefined,
      reasoningEffort: s.reasoningEffort || undefined, workerRuntime: s.workerRuntime || undefined,
      timeoutSeconds: s.timeoutSeconds,
    }));
    const body = {
      name: form.name,
      description: form.description || undefined,
      labels,
      defaultAgentId: form.defaultAgentId || undefined,
      defaultModel: form.defaultModel || undefined,
      defaultReasoningEffort: form.defaultReasoningEffort || undefined,
      workerRuntime: form.workerRuntime,
      stepAllocationTimeoutSeconds: form.stepAllocationTimeoutSeconds,
      scope: form.scope,
      steps,
      triggers: form.triggers,
    };
    await $fetch('/api/workflows', { method: 'POST', headers, body });
    toast.add({ severity: 'success', summary: 'Success', detail: 'Workflow created', life: 3000 });
    router.push(`/${ws.value}/workflows`);
  } catch (e: any) {
    error.value = e?.data?.error || 'Failed to create workflow.';
  } finally {
    saving.value = false;
  }
}
</script>
