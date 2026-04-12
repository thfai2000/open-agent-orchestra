<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href="/workflows">Workflows</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>New Workflow</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <h1 class="text-3xl font-bold mt-4 mb-6">Create New Workflow</h1>

    <div v-if="formError" class="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ formError }}</div>

    <form @submit.prevent="handleCreate" class="space-y-6">
      <!-- Basic Info -->
      <Card>
        <CardHeader><CardTitle>Basic Info</CardTitle></CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label>Name *</Label>
            <Input v-model="form.name" required placeholder="Daily Market Analysis" />
          </div>
          <div class="space-y-2">
            <Label>Description</Label>
            <Textarea v-model="form.description" rows="2" placeholder="What does this workflow do?" />
          </div>
          <div class="space-y-2">
            <Label>Labels</Label>
            <div class="flex flex-wrap gap-2 mb-2">
              <Badge v-for="(label, idx) in form.labels" :key="idx" variant="secondary" class="gap-1">
                {{ label }}
                <button type="button" class="ml-1 text-muted-foreground hover:text-foreground" @click="form.labels.splice(idx, 1)">&times;</button>
              </Badge>
            </div>
            <div class="flex gap-2">
              <Input v-model="newLabel" placeholder="Add label…" class="max-w-xs" @keydown.enter.prevent="addLabel" />
              <Button type="button" variant="outline" size="sm" @click="addLabel">Add</Button>
            </div>
            <p class="text-xs text-muted-foreground">Tags for organizing and filtering workflows. Max 10 labels.</p>
          </div>
          <div class="space-y-2">
            <Label>Scope</Label>
            <select v-model="form.scope"
              class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring max-w-xs">
              <option value="user">Personal (owned by you)</option>
              <option v-if="isAdmin" value="workspace">Workspace (shared, admin-managed)</option>
            </select>
            <p class="text-xs text-muted-foreground">Scope cannot be changed after creation.</p>
          </div>
        </CardContent>
      </Card>

      <!-- Workflow Defaults -->
      <Card>
        <CardHeader>
          <CardTitle>Workflow Defaults</CardTitle>
          <CardDescription>Steps inherit these defaults unless overridden at the step level.</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="space-y-2">
              <Label>Default Agent</Label>
              <select v-model="form.defaultAgentId"
                class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">None</option>
                <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </div>
            <div class="space-y-2">
              <Label>Default Model</Label>
              <select v-model="form.defaultModel"
                class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">None</option>
                <option v-for="m in availableModels" :key="m.id" :value="m.name">{{ m.name }}</option>
              </select>
            </div>
            <div class="space-y-2">
              <Label>Default Reasoning Effort</Label>
              <select v-model="form.defaultReasoningEffort"
                class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="">None</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Steps -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Steps *</CardTitle>
              <CardDescription>Define the sequential steps for this workflow. Use Jinja2 templating: <code class="bg-muted px-1 rounded text-xs">{{ precedent_output }}</code> for previous step output, <code class="bg-muted px-1 rounded text-xs">{{ properties.KEY }}</code> and <code class="bg-muted px-1 rounded text-xs">{{ credentials.KEY }}</code> for variables.</CardDescription>
            </div>
            <Button variant="outline" size="sm" type="button" @click="addStep">+ Add Step</Button>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <Card v-for="(step, idx) in form.steps" :key="idx" class="bg-muted/20">
            <CardHeader class="pb-2">
              <div class="flex items-center justify-between">
                <CardTitle class="text-sm">Step {{ idx + 1 }}</CardTitle>
                <Button v-if="form.steps.length > 1" variant="ghost" size="sm" class="text-destructive h-7 text-xs" type="button" @click="form.steps.splice(idx, 1)">Remove</Button>
              </div>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="space-y-1.5">
                <Label class="text-xs">Step Name *</Label>
                <Input v-model="step.name" required placeholder="Step name" />
              </div>
              <div class="space-y-1.5">
                <Label class="text-xs">Prompt Template *</Label>
                <Textarea v-model="step.promptTemplate" rows="3" required class="font-mono text-xs"
                  placeholder="Jinja2 prompt template: {{ precedent_output }}, {{ properties.KEY }}, {{ credentials.KEY }}" />
              </div>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div class="space-y-1">
                  <Label class="text-xs">Agent</Label>
                  <select v-model="step.agentId" class="w-full px-2 py-1.5 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">{{ form.defaultAgentId ? 'Use Default' : 'Select...' }}</option>
                    <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
                  </select>
                </div>
                <div class="space-y-1">
                  <Label class="text-xs">Model</Label>
                  <select v-model="step.model" class="w-full px-2 py-1.5 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">{{ form.defaultModel ? 'Use Default' : 'None' }}</option>
                    <option v-for="m in availableModels" :key="m.id" :value="m.name">{{ m.name }}</option>
                  </select>
                </div>
                <div class="space-y-1">
                  <Label class="text-xs">Reasoning</Label>
                  <select v-model="step.reasoningEffort" class="w-full px-2 py-1.5 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">{{ form.defaultReasoningEffort ? 'Use Default' : 'None' }}</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div class="space-y-1">
                  <Label class="text-xs">Timeout (s)</Label>
                  <Input v-model.number="step.timeoutSeconds" type="number" min="30" max="3600" class="text-xs" />
                </div>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <!-- Triggers -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Triggers (optional)</CardTitle>
              <CardDescription>Add automated triggers. All workflows can also be started manually from the detail page.</CardDescription>
            </div>
            <Button variant="outline" size="sm" type="button" @click="addTrigger">+ Add Trigger</Button>
          </div>
        </CardHeader>
        <CardContent class="space-y-3">
          <Card v-for="(trigger, idx) in form.triggers" :key="idx" class="bg-muted/20">
            <CardContent class="pt-4">
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-medium">Trigger {{ idx + 1 }}</span>
                <Button variant="ghost" size="sm" class="text-destructive h-7 text-xs" type="button" @click="form.triggers.splice(idx, 1)">Remove</Button>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-1">
                  <Label class="text-xs">Type *</Label>
                  <select v-model="trigger.triggerType" class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="time_schedule">Repeatable Schedule (Cron)</option>
                    <option value="exact_datetime">Exact Datetime</option>
                    <option value="webhook">Webhook</option>
                    <option value="event">Event</option>
                  </select>
                </div>
                <div v-if="trigger.triggerType === 'time_schedule'" class="space-y-1">
                  <Label class="text-xs">Cron Expression *</Label>
                  <Input v-model="trigger.cron" class="font-mono" placeholder="0 9 * * 1-5" />
                  <p class="text-xs text-muted-foreground">e.g. "0 9 * * 1-5" = 9am weekdays</p>
                </div>
                <div v-if="trigger.triggerType === 'exact_datetime'" class="space-y-1">
                  <Label class="text-xs">Datetime *</Label>
                  <Input v-model="trigger.datetime" type="datetime-local" />
                  <p class="text-xs text-muted-foreground">Fires once at this exact datetime then deactivates.</p>
                </div>
                <div v-if="trigger.triggerType === 'webhook'" class="space-y-1">
                  <Label class="text-xs">Webhook Path *</Label>
                  <Input v-model="trigger.webhookPath" class="font-mono" placeholder="/my-webhook" />
                </div>
                <div v-if="trigger.triggerType === 'event'" class="space-y-1">
                  <Label class="text-xs">Event Name *</Label>
                  <select v-model="trigger.eventType" class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">Select event...</option>
                    <option v-for="name in eventNames" :key="name" :value="name">{{ name }}</option>
                  </select>
                </div>
              </div>
              <!-- Event Conditions -->
              <div v-if="trigger.triggerType === 'event'" class="mt-3 space-y-2">
                <div class="flex items-center justify-between">
                  <Label class="text-xs">Event Data Conditions (optional)</Label>
                  <Button variant="ghost" size="sm" class="h-6 text-xs" type="button" @click="trigger.conditions.push({ key: '', value: '' })">+ Add Condition</Button>
                </div>
                <div v-for="(cond, ci) in trigger.conditions" :key="ci" class="flex gap-2 items-center">
                  <Input v-model="cond.key" placeholder="Key (e.g. scope)" class="flex-1 text-xs" />
                  <span class="text-xs text-muted-foreground">=</span>
                  <Input v-model="cond.value" placeholder="Value (e.g. workspace)" class="flex-1 text-xs" />
                  <Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-destructive" type="button" @click="trigger.conditions.splice(ci, 1)">×</Button>
                </div>
                <p class="text-xs text-muted-foreground">Only fire when event data matches all conditions. Common keys: agentId, agentName, scope</p>
              </div>
            </CardContent>
          </Card>
          <p v-if="form.triggers.length === 0" class="text-muted-foreground text-sm">No triggers added. You can always start the workflow manually.</p>
        </CardContent>
      </Card>

      <div class="flex gap-3">
        <Button type="submit" :disabled="submitting">{{ submitting ? 'Creating...' : 'Create Workflow' }}</Button>
        <NuxtLink :to="`/${ws}/workflows`"><Button variant="outline" type="button">Cancel</Button></NuxtLink>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
interface StepForm { name: string; promptTemplate: string; agentId: string; model: string; reasoningEffort: string; timeoutSeconds: number; }
interface TriggerForm { triggerType: string; cron: string; webhookPath: string; eventType: string; datetime: string; conditions: Array<{ key: string; value: string }>; }

const { authHeaders, user } = useAuth();
const headers = authHeaders();
const router = useRouter();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');

const submitting = ref(false);
const formError = ref('');
const form = reactive({
  name: '',
  description: '',
  labels: [] as string[],
  defaultAgentId: '',
  defaultModel: '',
  defaultReasoningEffort: '',
  scope: 'user' as 'user' | 'workspace',
  steps: [{ name: '', promptTemplate: '', agentId: '', model: '', reasoningEffort: '', timeoutSeconds: 300 }] as StepForm[],
  triggers: [] as TriggerForm[],
});

const { data: agentsData } = await useFetch('/api/agents', { headers });
const agents = computed(() => agentsData.value?.agents ?? []);

const { data: namesData } = await useFetch('/api/events/names', { headers });
const eventNames = computed(() => (namesData.value as any)?.eventNames ?? []);

const { data: modelsData } = await useFetch('/api/quota/models', { headers });
const availableModels = computed(() => (modelsData.value as any)?.models ?? []);

const newLabel = ref('');
function addLabel() {
  const label = newLabel.value.trim();
  if (label && !form.labels.includes(label) && form.labels.length < 10) {
    form.labels.push(label);
  }
  newLabel.value = '';
}

function addStep() {
  form.steps.push({ name: '', promptTemplate: '', agentId: '', model: '', reasoningEffort: '', timeoutSeconds: 300 });
}
function addTrigger() {
  form.triggers.push({ triggerType: 'time_schedule', cron: '', webhookPath: '', eventType: '', datetime: '', conditions: [] });
}

async function handleCreate() {
  formError.value = '';
  submitting.value = true;
  try {
    const triggerPayloads = form.triggers.map((t) => {
      const configuration: Record<string, unknown> = {};
      if (t.triggerType === 'time_schedule') configuration.cron = t.cron;
      if (t.triggerType === 'exact_datetime') configuration.datetime = new Date(t.datetime).toISOString();
      if (t.triggerType === 'webhook') configuration.path = t.webhookPath;
      if (t.triggerType === 'event') {
        configuration.eventName = t.eventType;
        if (t.conditions.length > 0) {
          const conds: Record<string, string> = {};
          for (const c of t.conditions) { if (c.key.trim()) conds[c.key.trim()] = c.value; }
          if (Object.keys(conds).length > 0) configuration.conditions = conds;
        }
      }
      return { triggerType: t.triggerType, configuration };
    });

    const res = await $fetch<{ workflow: { id: string } }>('/api/workflows', {
      method: 'POST',
      headers,
      body: {
        name: form.name,
        description: form.description || undefined,
        labels: form.labels.length > 0 ? form.labels : undefined,
        defaultAgentId: form.defaultAgentId || undefined,
        defaultModel: form.defaultModel || undefined,
        defaultReasoningEffort: form.defaultReasoningEffort || undefined,
        scope: form.scope,
        steps: form.steps.map((s, i) => ({
          name: s.name, promptTemplate: s.promptTemplate, stepOrder: i + 1,
          agentId: s.agentId || undefined, model: s.model || undefined,
          reasoningEffort: s.reasoningEffort || undefined, timeoutSeconds: s.timeoutSeconds,
        })),
        triggers: triggerPayloads.length > 0 ? triggerPayloads : undefined,
      },
    });
    router.push(`/${ws.value}/workflows/${res.workflow.id}`);
  } catch (e: any) {
    formError.value = e?.data?.error || 'Failed to create workflow';
  } finally {
    submitting.value = false;
  }
}
</script>
