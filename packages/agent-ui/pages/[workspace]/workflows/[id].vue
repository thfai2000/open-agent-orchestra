<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href="/workflows">Workflows</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>{{ workflow?.name || 'Loading…' }}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div v-if="workflow" class="space-y-6 mt-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold">{{ workflow.name }}</h1>
          <div class="flex items-center gap-3 mt-1.5">
            <Badge variant="outline" class="font-mono">v{{ workflow.version }}</Badge>
            <Badge :variant="workflow.isActive ? 'default' : 'secondary'">{{ workflow.isActive ? 'Active' : 'Inactive' }}</Badge>
            <Badge v-if="workflow.scope === 'workspace'" variant="outline">Workspace</Badge>
            <Badge v-else variant="outline" class="text-muted-foreground">Personal</Badge>
            <Badge v-for="label in (workflow.labels || [])" :key="label" variant="secondary" class="text-xs">{{ label }}</Badge>
            <span class="text-sm text-muted-foreground">Owner: {{ workflow.ownerName || 'Unknown' }}</span>
            <span v-if="workflow.lastExecutionAt" class="text-sm text-muted-foreground">
              Last Run: {{ new Date(workflow.lastExecutionAt).toLocaleString() }}
              <Badge :variant="workflow.lastExecutionStatus === 'completed' ? 'default' : workflow.lastExecutionStatus === 'failed' ? 'destructive' : 'secondary'" class="ml-1">{{ workflow.lastExecutionStatus }}</Badge>
            </span>
            <span v-else class="text-sm text-muted-foreground italic">Never run</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <Button v-if="!editingWorkflow" variant="outline" size="sm" @click="startEditWorkflow">Edit Workflow</Button>
          <Button size="sm" class="bg-green-600 hover:bg-green-700" :disabled="triggering" @click="showRunDialog = true">{{ triggering ? 'Running…' : 'Run Now' }}</Button>
          <Button variant="outline" size="sm" @click="toggleActive">{{ workflow.isActive ? 'Deactivate' : 'Activate' }}</Button>
        </div>
      </div>

      <!-- Run Dialog -->
      <Dialog v-model:open="showRunDialog">
        <DialogContent class="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Manual Run</DialogTitle>
            <DialogDescription>Provide initial context for the first step. This will be available as <code class="bg-muted px-1 rounded text-xs">{{ precedent_output }}</code> in step 1's prompt template (Jinja2).</DialogDescription>
          </DialogHeader>
          <Textarea v-model="manualRunInput" rows="4" placeholder="Enter initial context or instructions for this run..." />
          <DialogFooter>
            <Button variant="outline" @click="showRunDialog = false; manualRunInput = ''">Cancel</Button>
            <Button class="bg-green-600 hover:bg-green-700" :disabled="triggering" @click="handleManualTrigger">{{ triggering ? 'Triggering…' : 'Start Run' }}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <!-- Trigger Result -->
      <div v-if="triggerResult" class="p-3 rounded-md bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-sm">
        Workflow triggered! Execution ID: {{ triggerResult.id?.substring(0, 8) }}…
        <NuxtLink :to="`/${ws}/executions/${triggerResult.id}`" class="text-primary hover:underline ml-2">View →</NuxtLink>
      </div>

      <!-- Edit Workflow Form -->
      <Card v-if="editingWorkflow">
        <CardHeader><CardTitle>Edit Workflow</CardTitle></CardHeader>
        <CardContent>
          <div v-if="editWfError" class="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ editWfError }}</div>
          <form @submit.prevent="handleSaveWorkflow" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-2"><Label>Name *</Label><Input v-model="editWfForm.name" required /></div>
              <div class="space-y-2"><Label>Description</Label><Input v-model="editWfForm.description" /></div>
            </div>
            <Separator />
            <div class="space-y-2">
              <Label class="text-sm">Labels</Label>
              <div class="flex flex-wrap gap-2 mb-2">
                <Badge v-for="(label, idx) in editWfForm.labels" :key="idx" variant="secondary" class="gap-1">
                  {{ label }}
                  <button type="button" class="ml-1 text-muted-foreground hover:text-foreground" @click="editWfForm.labels.splice(idx, 1)">&times;</button>
                </Badge>
              </div>
              <div class="flex gap-2">
                <Input v-model="editNewLabel" placeholder="Add label…" class="max-w-xs" @keydown.enter.prevent="addEditLabel" />
                <Button type="button" variant="outline" size="sm" @click="addEditLabel">Add</Button>
              </div>
              <p class="text-xs text-muted-foreground">Tags for organizing and filtering workflows. Max 10 labels.</p>
            </div>
            <Separator />
            <div>
              <h3 class="text-sm font-semibold mb-1">Workflow Defaults</h3>
              <p class="text-xs text-muted-foreground mb-3">Steps inherit these unless overridden.</p>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div class="space-y-1">
                  <Label class="text-xs">Default Agent</Label>
                  <select v-model="editWfForm.defaultAgentId" class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">None</option>
                    <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
                  </select>
                </div>
                <div class="space-y-1">
                  <Label class="text-xs">Default Model</Label>
                  <select v-model="editWfForm.defaultModel" class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">None</option>
                    <option v-for="m in availableModels" :key="m.id" :value="m.name">{{ m.name }}</option>
                  </select>
                </div>
                <div class="space-y-1">
                  <Label class="text-xs">Default Reasoning</Label>
                  <select v-model="editWfForm.defaultReasoningEffort" class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="">None</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </div>
              </div>
            </div>
            <div class="flex gap-3 pt-2">
              <Button type="submit" :disabled="savingWf">{{ savingWf ? 'Saving…' : 'Save Changes' }}</Button>
              <Button variant="outline" type="button" @click="editingWorkflow = false">Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <!-- View Workflow Details -->
      <div v-else>
        <p v-if="workflow.description" class="text-muted-foreground mb-4">{{ workflow.description }}</p>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardHeader class="pb-2"><CardTitle class="text-sm text-muted-foreground">Default Agent</CardTitle></CardHeader><CardContent><p class="font-medium">{{ workflow.defaultAgentId ? (agentNameMap[workflow.defaultAgentId] || workflow.defaultAgentId.substring(0, 8) + '…') : '—' }}</p></CardContent></Card>
          <Card><CardHeader class="pb-2"><CardTitle class="text-sm text-muted-foreground">Default Model</CardTitle></CardHeader><CardContent><p class="font-medium">{{ workflow.defaultModel || '—' }}</p></CardContent></Card>
          <Card><CardHeader class="pb-2"><CardTitle class="text-sm text-muted-foreground">Default Reasoning</CardTitle></CardHeader><CardContent><p class="font-medium capitalize">{{ workflow.defaultReasoningEffort || '—' }}</p></CardContent></Card>
        </div>
      </div>

      <!-- Steps -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <CardTitle>Steps</CardTitle>
            <Button v-if="!editingSteps" variant="outline" size="sm" @click="startEditSteps">Edit Steps</Button>
          </div>
        </CardHeader>
        <CardContent>
          <!-- View mode -->
          <div v-if="!editingSteps" class="space-y-3">
            <Card v-for="(step, idx) in steps" :key="step.id" class="bg-muted/20">
              <CardContent class="pt-4">
                <div class="flex items-center gap-3 mb-2">
                  <span class="text-xl font-bold text-muted-foreground">{{ idx + 1 }}</span>
                  <h3 class="font-semibold">{{ step.name }}</h3>
                  <div class="flex items-center gap-2 ml-auto">
                    <Badge v-if="step.model" variant="secondary">{{ step.model }}</Badge>
                    <Badge v-if="step.reasoningEffort" variant="outline">{{ step.reasoningEffort }}</Badge>
                    <span class="text-xs text-muted-foreground">{{ step.timeoutSeconds }}s</span>
                  </div>
                </div>
                <p class="text-xs text-muted-foreground mb-2">Agent: {{ step.agentId ? (agentNameMap[step.agentId] || step.agentId.substring(0, 8) + '…') : 'Workflow Default' }}</p>
                <div class="bg-muted p-3 rounded text-xs font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{{ step.promptTemplate }}</div>
              </CardContent>
            </Card>
            <p v-if="steps.length === 0" class="text-muted-foreground text-sm">No steps defined.</p>
          </div>

          <!-- Edit mode -->
          <div v-else class="space-y-3">
            <div v-if="editStepError" class="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ editStepError }}</div>
            <Card v-for="(step, idx) in editStepForm" :key="idx" class="bg-muted/20">
              <CardContent class="pt-4 space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium">Step {{ idx + 1 }}</span>
                  <Button v-if="editStepForm.length > 1" variant="ghost" size="sm" class="text-destructive h-7 text-xs" @click="editStepForm.splice(idx, 1)">Remove</Button>
                </div>
                <Input v-model="step.name" required placeholder="Step name" />
                <Textarea v-model="step.promptTemplate" rows="3" required class="font-mono text-xs" placeholder="Jinja2 prompt template: {{ precedent_output }}, {{ properties.KEY }}, {{ credentials.KEY }}" />
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div class="space-y-1">
                    <Label class="text-xs">Agent</Label>
                    <select v-model="step.agentId" class="w-full px-2 py-1.5 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="">{{ workflow?.defaultAgentId ? 'Use Default' : 'Select…' }}</option>
                      <option v-for="a in agents" :key="a.id" :value="a.id">{{ a.name }}</option>
                    </select>
                  </div>
                  <div class="space-y-1">
                    <Label class="text-xs">Model</Label>
                    <select v-model="step.model" class="w-full px-2 py-1.5 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="">{{ workflow?.defaultModel ? 'Use Default' : 'None' }}</option>
                      <option v-for="m in availableModels" :key="m.id" :value="m.name">{{ m.name }}</option>
                    </select>
                  </div>
                  <div class="space-y-1">
                    <Label class="text-xs">Reasoning</Label>
                    <select v-model="step.reasoningEffort" class="w-full px-2 py-1.5 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="">{{ workflow?.defaultReasoningEffort ? 'Use Default' : 'None' }}</option>
                      <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                    </select>
                  </div>
                  <div class="space-y-1">
                    <Label class="text-xs">Timeout (s)</Label>
                    <Input v-model.number="step.timeoutSeconds" type="number" min="30" max="3600" class="text-xs" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Button variant="ghost" size="sm" @click="editStepForm.push({ name: '', promptTemplate: '', agentId: '', model: '', reasoningEffort: '', timeoutSeconds: 300 })">+ Add Step</Button>
            <div class="flex gap-2 pt-2">
              <Button :disabled="savingSteps" @click="handleSaveSteps">{{ savingSteps ? 'Saving…' : 'Save Steps' }}</Button>
              <Button variant="outline" @click="editingSteps = false">Cancel</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Triggers -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Triggers</CardTitle>
              <CardDescription>All workflows can be started manually. Add triggers for automated execution.</CardDescription>
            </div>
            <Button variant="outline" size="sm" @click="showTriggerForm = true">+ Add Trigger</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Card v-if="showTriggerForm" class="mb-4 bg-muted/20">
            <CardContent class="pt-4">
              <div v-if="triggerError" class="mb-3 p-2 rounded-md bg-destructive/10 text-destructive text-sm">{{ triggerError }}</div>
              <form @submit.prevent="handleAddTrigger" class="space-y-3">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <Label class="text-xs">Trigger Type *</Label>
                    <select v-model="triggerForm.triggerType" required class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="time_schedule">Repeatable Schedule (Cron)</option>
                      <option value="exact_datetime">Exact Datetime</option>
                      <option value="webhook">Webhook</option>
                      <option value="event">Event</option>
                    </select>
                  </div>
                  <div v-if="triggerForm.triggerType === 'time_schedule'" class="space-y-1">
                    <Label class="text-xs">Cron Expression *</Label>
                    <Input v-model="triggerForm.cron" class="font-mono" placeholder="0 9 * * 1-5" />
                    <p class="text-xs text-muted-foreground">e.g. "0 9 * * 1-5" = 9 AM weekdays</p>
                  </div>
                  <div v-if="triggerForm.triggerType === 'exact_datetime'" class="space-y-1">
                    <Label class="text-xs">Datetime (ISO 8601) *</Label>
                    <Input v-model="triggerForm.datetime" type="datetime-local" />
                    <p class="text-xs text-muted-foreground">The trigger fires once at this exact datetime and then deactivates.</p>
                  </div>
                  <div v-if="triggerForm.triggerType === 'webhook'" class="space-y-1">
                    <Label class="text-xs">Webhook Path *</Label>
                    <Input v-model="triggerForm.webhookPath" class="font-mono" placeholder="/my-webhook" />
                  </div>
                  <div v-if="triggerForm.triggerType === 'event'" class="space-y-1">
                    <Label class="text-xs">Event Name *</Label>
                    <select v-model="triggerForm.eventType" class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                      <option value="">Select event...</option>
                      <option v-for="name in eventNames" :key="name" :value="name">{{ name }}</option>
                    </select>
                  </div>
                </div>
                <!-- Event Conditions -->
                <div v-if="triggerForm.triggerType === 'event'" class="space-y-2">
                  <div class="flex items-center justify-between">
                    <Label class="text-xs">Event Data Conditions (optional)</Label>
                    <Button variant="ghost" size="sm" class="h-6 text-xs" type="button" @click="triggerForm.conditions.push({ key: '', value: '' })">+ Add Condition</Button>
                  </div>
                  <div v-for="(cond, ci) in triggerForm.conditions" :key="ci" class="flex gap-2 items-center">
                    <Input v-model="cond.key" placeholder="Key (e.g. scope)" class="flex-1 text-xs" />
                    <span class="text-xs text-muted-foreground">=</span>
                    <Input v-model="cond.value" placeholder="Value (e.g. workspace)" class="flex-1 text-xs" />
                    <Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-destructive" type="button" @click="triggerForm.conditions.splice(ci, 1)">×</Button>
                  </div>
                  <p class="text-xs text-muted-foreground">Only fire when event data matches all conditions. Common keys: agentId, agentName, scope</p>
                </div>
                <div class="flex gap-2">
                  <Button type="submit" size="sm" :disabled="savingTrigger">{{ savingTrigger ? 'Saving…' : 'Add Trigger' }}</Button>
                  <Button variant="outline" size="sm" type="button" @click="showTriggerForm = false">Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div class="space-y-2">
            <div v-for="trigger in triggers" :key="trigger.id"
              class="p-3 rounded-lg border border-border flex items-center justify-between">
              <div class="flex items-center gap-3">
                <Badge variant="secondary" class="uppercase text-xs">{{ formatTriggerType(trigger.triggerType || trigger.type) }}</Badge>
                <span class="text-sm font-mono">{{ formatTriggerConfig(trigger) }}</span>
              </div>
              <div class="flex items-center gap-3">
                <Badge :variant="trigger.isActive ? 'default' : 'secondary'">{{ trigger.isActive ? 'Enabled' : 'Disabled' }}</Badge>
                <Button variant="ghost" size="sm" class="text-destructive text-xs h-7" @click="handleDeleteTrigger(trigger.id)">Delete</Button>
              </div>
            </div>
            <p v-if="triggers.length === 0 && !showTriggerForm" class="text-muted-foreground text-sm">No automated triggers configured.</p>
          </div>
        </CardContent>
      </Card>
    </div>
    <p v-else class="text-muted-foreground mt-4">Workflow not found.</p>
  </div>
</template>

<script setup lang="ts">
interface EditStep {
  name: string;
  promptTemplate: string;
  agentId: string;
  model: string;
  reasoningEffort: string;
  timeoutSeconds: number;
}

const route = useRoute();
const workflowId = route.params.id as string;
const ws = computed(() => (route.params.workspace as string) || 'default');

const { authHeaders } = useAuth();
const headers = authHeaders();

const { data: wfData, refresh: refreshWf } = await useFetch(`/api/workflows/${workflowId}`, { headers });
const { data: trigData, refresh: refreshTriggers } = await useFetch(`/api/triggers?workflowId=${workflowId}`, { headers });
const { data: agentsData } = await useFetch('/api/agents', { headers });

const { data: namesData } = await useFetch('/api/events/names', { headers });
const eventNames = computed(() => (namesData.value as any)?.eventNames ?? []);

const { data: modelsData } = await useFetch('/api/quota/models', { headers });
const availableModels = computed(() => (modelsData.value as any)?.models ?? []);

const workflow = computed(() => wfData.value?.workflow);
const steps = computed(() => wfData.value?.steps ?? []);
const triggers = computed(() => trigData.value?.triggers ?? []);
const agents = computed(() => agentsData.value?.agents ?? []);

const agentNameMap = computed(() => {
  const map: Record<string, string> = {};
  for (const a of agents.value) map[a.id] = a.name;
  return map;
});

function formatTriggerConfig(trigger: any): string {
  const cfg = trigger.configuration || trigger.config || {};
  if (cfg.cron) return `cron: ${cfg.cron}`;
  if (cfg.datetime) return `datetime: ${new Date(cfg.datetime).toLocaleString()}`;
  if (cfg.path) return `path: ${cfg.path}`;
  if (cfg.eventType) return `event: ${cfg.eventType}`;
  return '—';
}

function formatTriggerType(type: string): string {
  const labels: Record<string, string> = {
    time_schedule: 'Repeatable Schedule',
    exact_datetime: 'Exact Datetime',
    webhook: 'Webhook',
    event: 'Event',
    manual: 'Manual',
  };
  return labels[type] || type;
}

// ── Workflow Edit ────────────────────────────────────────────────
const editingWorkflow = ref(false);
const savingWf = ref(false);
const editWfError = ref('');
const editNewLabel = ref('');
const editWfForm = reactive({
  name: '',
  description: '',
  labels: [] as string[],
  defaultAgentId: '',
  defaultModel: '',
  defaultReasoningEffort: '',
});

function startEditWorkflow() {
  Object.assign(editWfForm, {
    name: workflow.value?.name || '',
    description: workflow.value?.description || '',
    labels: [...(workflow.value?.labels || [])],
    defaultAgentId: workflow.value?.defaultAgentId || '',
    defaultModel: workflow.value?.defaultModel || '',
    defaultReasoningEffort: workflow.value?.defaultReasoningEffort || '',
  });
  editNewLabel.value = '';
  editWfError.value = '';
  editingWorkflow.value = true;
}

function addEditLabel() {
  const label = editNewLabel.value.trim();
  if (label && !editWfForm.labels.includes(label) && editWfForm.labels.length < 10) {
    editWfForm.labels.push(label);
  }
  editNewLabel.value = '';
}

async function handleSaveWorkflow() {
  editWfError.value = '';
  savingWf.value = true;
  try {
    await $fetch(`/api/workflows/${workflowId}`, {
      method: 'PUT',
      headers,
      body: {
        name: editWfForm.name,
        description: editWfForm.description || undefined,
        labels: editWfForm.labels,
        defaultAgentId: editWfForm.defaultAgentId || null,
        defaultModel: editWfForm.defaultModel || null,
        defaultReasoningEffort: editWfForm.defaultReasoningEffort || null,
      },
    });
    editingWorkflow.value = false;
    await refreshWf();
  } catch (e: any) {
    editWfError.value = e?.data?.error || 'Failed to save workflow';
  } finally {
    savingWf.value = false;
  }
}

// ── Manual Run ──────────────────────────────────────────────────
const triggering = ref(false);
const triggerResult = ref<any>(null);
const showRunDialog = ref(false);
const manualRunInput = ref('');

async function handleManualTrigger() {
  triggering.value = true;
  triggerResult.value = null;
  try {
    const res = await $fetch<{ execution: any }>(`/api/workflows/${workflowId}/trigger`, {
      method: 'POST',
      headers,
      body: manualRunInput.value ? { userInput: manualRunInput.value } : {},
    });
    triggerResult.value = res.execution;
    showRunDialog.value = false;
    manualRunInput.value = '';
  } catch (e: any) {
    alert(e?.data?.error || 'Failed to trigger workflow');
  } finally {
    triggering.value = false;
  }
}

// ── Toggle active ───────────────────────────────────────────────
async function toggleActive() {
  try {
    await $fetch(`/api/workflows/${workflowId}`, {
      method: 'PUT',
      headers,
      body: { isActive: !workflow.value?.isActive },
    });
    await refreshWf();
  } catch {
    alert('Failed to update workflow');
  }
}

// ── Step editing ────────────────────────────────────────────────
const editingSteps = ref(false);
const savingSteps = ref(false);
const editStepError = ref('');
const editStepForm = ref<EditStep[]>([]);

function startEditSteps() {
  editStepForm.value = steps.value.map((s: any) => ({
    name: s.name,
    promptTemplate: s.promptTemplate,
    agentId: s.agentId || '',
    model: s.model || '',
    reasoningEffort: s.reasoningEffort || '',
    timeoutSeconds: s.timeoutSeconds || 300,
  }));
  editStepError.value = '';
  editingSteps.value = true;
}

async function handleSaveSteps() {
  editStepError.value = '';
  savingSteps.value = true;
  try {
    await $fetch(`/api/workflows/${workflowId}/steps`, {
      method: 'PUT',
      headers,
      body: {
        steps: editStepForm.value.map((s, i) => ({
          name: s.name,
          promptTemplate: s.promptTemplate,
          stepOrder: i + 1,
          agentId: s.agentId || undefined,
          model: s.model || undefined,
          reasoningEffort: s.reasoningEffort || undefined,
          timeoutSeconds: s.timeoutSeconds,
        })),
      },
    });
    editingSteps.value = false;
    await refreshWf();
  } catch (e: any) {
    editStepError.value = e?.data?.error || 'Failed to save steps';
  } finally {
    savingSteps.value = false;
  }
}

// ── Trigger management ──────────────────────────────────────────
const showTriggerForm = ref(false);
const savingTrigger = ref(false);
const triggerError = ref('');
const triggerForm = reactive({ triggerType: 'time_schedule', cron: '', webhookPath: '', eventType: '', datetime: '', conditions: [] as Array<{ key: string; value: string }> });

async function handleAddTrigger() {
  triggerError.value = '';
  savingTrigger.value = true;
  try {
    const configuration: Record<string, unknown> = {};
    if (triggerForm.triggerType === 'time_schedule') configuration.cron = triggerForm.cron;
    if (triggerForm.triggerType === 'exact_datetime') configuration.datetime = new Date(triggerForm.datetime).toISOString();
    if (triggerForm.triggerType === 'webhook') configuration.path = triggerForm.webhookPath;
    if (triggerForm.triggerType === 'event') {
      configuration.eventName = triggerForm.eventType;
      if (triggerForm.conditions.length > 0) {
        const conds: Record<string, string> = {};
        for (const c of triggerForm.conditions) { if (c.key.trim()) conds[c.key.trim()] = c.value; }
        if (Object.keys(conds).length > 0) configuration.conditions = conds;
      }
    }

    await $fetch('/api/triggers', {
      method: 'POST',
      headers,
      body: { workflowId, triggerType: triggerForm.triggerType, configuration },
    });
    showTriggerForm.value = false;
    Object.assign(triggerForm, { triggerType: 'time_schedule', cron: '', webhookPath: '', eventType: '', datetime: '', conditions: [] });
    await refreshTriggers();
  } catch (e: any) {
    triggerError.value = e?.data?.error || 'Failed to add trigger';
  } finally {
    savingTrigger.value = false;
  }
}

async function handleDeleteTrigger(id: string) {
  if (!confirm('Delete this trigger?')) return;
  try {
    await $fetch(`/api/triggers/${id}`, { method: 'DELETE', headers });
    await refreshTriggers();
  } catch {
    alert('Failed to delete trigger');
  }
}
</script>
