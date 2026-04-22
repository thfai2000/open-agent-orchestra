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
            <div class="mt-4 flex flex-col gap-4">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 class="text-lg font-semibold text-surface-900">Triggers</h3>
                  <p class="mt-1 text-sm text-surface-500">Open the trigger catalog from the right, or edit an existing trigger directly inside its card.</p>
                </div>
                <Button label="Add Trigger" icon="pi pi-plus" @click="openTriggerPanel" />
              </div>

              <div class="overflow-hidden rounded-2xl">
                <div class="flex flex-col gap-4 md:flex-row md:items-start">
                  <div class="min-w-0 flex-1">
                    <div v-if="triggers.length === 0" class="rounded-xl border border-dashed border-surface-300 px-4 py-6 text-center text-sm text-surface-400">
                      No triggers configured yet. Use Add Trigger to open the trigger catalog for this workflow.
                    </div>

                    <div v-for="trigger in triggers" :key="trigger.id" class="rounded-xl border border-surface-200 bg-white p-5">
                      <template v-if="editingTriggerId === trigger.id">
                        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div class="flex flex-wrap items-center gap-2">
                              <Tag :value="formatTriggerType(editTriggerForm.triggerType)" severity="info" />
                              <Tag value="Editing" severity="warn" />
                            </div>
                            <p class="mt-2 text-sm text-surface-500">This trigger card is now the edit form. Save or cancel here before switching to another trigger.</p>
                          </div>
                          <label class="flex items-center gap-2 text-sm text-surface-600">
                            <Checkbox v-model="editTriggerForm.isActive" :binary="true" />
                            Active
                          </label>
                        </div>

                        <div class="mt-4">
                          <WorkflowTriggerFields :trigger="editTriggerForm" :credential-options="workflowCredentialOptions" />
                        </div>

                        <div class="mt-5 flex flex-wrap justify-end gap-2">
                          <Button label="Cancel" severity="secondary" @click="cancelInlineTriggerEdit" />
                          <Button label="Save Trigger" icon="pi pi-check" :loading="savingTrigger" @click="handleSaveEditedTrigger" />
                        </div>
                      </template>

                      <template v-else>
                        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <div class="flex flex-wrap items-center gap-2">
                              <Tag :value="formatTriggerType(trigger.triggerType)" severity="info" />
                              <Tag :value="trigger.isActive ? 'Active' : 'Inactive'" :severity="trigger.isActive ? 'success' : 'secondary'" />
                              <Tag
                                v-if="trigger.runtimeSummary?.status"
                                :value="String(trigger.runtimeSummary.status)"
                                :severity="trigger.runtimeSummary?.lastError ? 'danger' : 'secondary'"
                              />
                            </div>
                            <p class="mt-2 text-sm text-surface-600">{{ formatTriggerConfiguration(trigger) }}</p>
                            <p v-if="formatTriggerRuntimeSummary(trigger)" class="mt-2 text-xs text-surface-400">{{ formatTriggerRuntimeSummary(trigger) }}</p>
                            <p class="mt-2 text-xs text-surface-400">Last fired: {{ trigger.lastFiredAt ? new Date(trigger.lastFiredAt).toLocaleString() : 'Never' }}</p>
                            <p
                              v-if="triggerConnectivityResults[trigger.id]"
                              class="mt-2 text-xs"
                              :class="triggerConnectivityResults[trigger.id].ok ? 'text-emerald-600' : 'text-rose-600'"
                            >
                              {{ formatTriggerConnectivityResult(triggerConnectivityResults[trigger.id]) }}
                            </p>
                          </div>
                          <div class="flex flex-wrap items-center gap-2">
                            <Button
                              label="Test Connectivity"
                              icon="pi pi-link"
                              text
                              size="small"
                              :loading="testingTriggerId === trigger.id"
                              @click="handleTestTriggerConnectivity(trigger.id)"
                            />
                            <Button label="Edit" icon="pi pi-pencil" text size="small" @click="startEditTrigger(trigger)" />
                            <Button label="Delete" icon="pi pi-trash" text severity="danger" size="small" @click="handleDeleteTrigger(trigger.id)" />
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>

                  <div
                    class="w-full md:shrink-0 md:transition-[width,opacity] md:duration-300 md:ease-out"
                    :class="triggerPanelOpen ? 'opacity-100 md:w-[26rem]' : 'pointer-events-none hidden opacity-0 md:block md:w-0'"
                  >
                    <div class="rounded-2xl border border-surface-200 bg-white shadow-sm">
                      <div class="flex items-center justify-between border-b border-surface-200 px-4 py-3">
                        <div>
                          <p class="text-sm font-semibold text-surface-900">
                            {{ triggerPanelStep === 'catalog' ? 'Add Trigger' : `Add ${formatTriggerType(createTriggerForm.triggerType)}` }}
                          </p>
                          <p class="mt-1 text-xs text-surface-500">
                            {{ triggerPanelStep === 'catalog' ? 'Choose a trigger type from the scrollable catalog.' : 'Configure the selected trigger, then save it into the workflow.' }}
                          </p>
                        </div>
                        <div class="flex items-center gap-2">
                          <Button
                            v-if="triggerPanelStep === 'form'"
                            icon="pi pi-arrow-left"
                            text
                            rounded
                            size="small"
                            aria-label="Back to trigger catalog"
                            @click="showTriggerCatalog"
                          />
                          <Button icon="pi pi-times" text rounded size="small" aria-label="Close trigger panel" @click="closeTriggerPanel" />
                        </div>
                      </div>

                      <div v-if="triggerPanelStep === 'catalog'" class="max-h-[72vh] overflow-y-auto p-4">
                        <div class="flex flex-col gap-3">
                          <button
                            v-for="triggerType in triggerTypes"
                            :key="triggerType.type"
                            type="button"
                            class="rounded-xl border border-surface-200 bg-surface-50 p-4 text-left transition-colors hover:border-primary/40 hover:bg-white"
                            @click="selectTriggerType(triggerType)"
                          >
                            <div class="flex items-start justify-between gap-3">
                              <div>
                                <p class="text-sm font-semibold text-surface-900">{{ triggerType.label }}</p>
                                <p class="mt-1 text-xs leading-5 text-surface-500">{{ triggerType.description }}</p>
                              </div>
                              <Tag :value="triggerType.category" severity="secondary" class="text-[11px]" />
                            </div>
                            <p v-if="triggerType.notes" class="mt-3 text-xs leading-5 text-surface-400">{{ triggerType.notes }}</p>
                          </button>
                        </div>
                      </div>

                      <div v-else class="max-h-[72vh] overflow-y-auto p-4">
                        <div class="flex items-center justify-between gap-3">
                          <p class="text-sm text-surface-500">{{ formatTriggerConfiguration(createTriggerForm) }}</p>
                          <label class="flex items-center gap-2 text-sm text-surface-600">
                            <Checkbox v-model="createTriggerForm.isActive" :binary="true" />
                            Active
                          </label>
                        </div>

                        <div class="mt-4">
                          <WorkflowTriggerFields :trigger="createTriggerForm" :credential-options="workflowCredentialOptions" />
                        </div>

                        <div class="mt-5 flex flex-wrap justify-end gap-2">
                          <Button label="Cancel" severity="secondary" @click="closeTriggerPanel" />
                          <Button label="Save Trigger" icon="pi pi-check" :loading="savingTrigger" @click="handleCreateTrigger" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
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
import {
  createTriggerDraft,
  formatTriggerConfiguration,
  formatTriggerRuntimeSummary,
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
const steps = computed(() => (wfData.value as any)?.steps ?? []);

const { data: triggersData, refresh: refreshTriggers } = await useFetch(computed(() => `/api/triggers?workflowId=${wfId.value}`), { headers });
const triggers = computed(() => (triggersData.value as any)?.triggers ?? []);
const { data: triggerTypesData } = await useFetch('/api/triggers/types', { headers });
const triggerTypes = computed(() => (triggerTypesData.value as any)?.types ?? []);
const { data: userVarsData } = await useFetch('/api/variables?scope=user', { headers });
const { data: wsVarsData } = await useFetch('/api/variables?scope=workspace', { headers });
const { buildCredentialOptions } = useAgentCredentialOptions();
const workflowCredentialOptions = computed(() => buildCredentialOptions([
  { scope: 'user', scopeLabel: 'User', variables: (userVarsData.value as any)?.variables ?? [] },
  { scope: 'workspace', scopeLabel: 'Workspace', variables: (wsVarsData.value as any)?.variables ?? [] },
]));

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
    await Promise.all([refreshWf(), refreshWorkflowVersions()]);
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed to save steps', life: 5000 });
  } finally {
    savingSteps.value = false;
  }
}

// ─── Triggers CRUD ───
const triggerPanelOpen = ref(false);
const triggerPanelStep = ref<'catalog' | 'form'>('catalog');
const editingTriggerId = ref<string | null>(null);
const savingTrigger = ref(false);
const testingTriggerId = ref<string | null>(null);
const createTriggerForm = reactive({ triggerType: '', configuration: {} as any, isActive: true });
const editTriggerForm = reactive({ id: '', triggerType: '', configuration: {} as any, isActive: true });
const triggerConnectivityResults = reactive<Record<string, { ok: boolean; message?: string; summary?: string }>>({});

function getStatusSeverity(s: string) {
  return { completed: 'success', running: 'warn', pending: 'warn', failed: 'danger', cancelled: 'secondary' }[s] || 'secondary';
}

function resetCreateTriggerForm() {
  Object.assign(createTriggerForm, { triggerType: '', configuration: {}, isActive: true });
}

function resetEditTriggerForm() {
  Object.assign(editTriggerForm, { id: '', triggerType: '', configuration: {}, isActive: true });
}

function openTriggerPanel() {
  editingTriggerId.value = null;
  resetEditTriggerForm();
  resetCreateTriggerForm();
  triggerPanelStep.value = 'catalog';
  triggerPanelOpen.value = true;
}

function closeTriggerPanel() {
  triggerPanelOpen.value = false;
  triggerPanelStep.value = 'catalog';
  resetCreateTriggerForm();
}

function showTriggerCatalog() {
  triggerPanelStep.value = 'catalog';
  resetCreateTriggerForm();
}

function selectTriggerType(triggerType: any) {
  Object.assign(createTriggerForm, createTriggerDraft(triggerType));
  triggerPanelStep.value = 'form';
}

function startEditTrigger(trigger: any) {
  closeTriggerPanel();
  editingTriggerId.value = trigger.id;
  Object.assign(editTriggerForm, {
    id: trigger.id,
    triggerType: trigger.triggerType,
    configuration: JSON.parse(JSON.stringify(trigger.configuration)),
    isActive: trigger.isActive !== false,
  });
}

function cancelInlineTriggerEdit() {
  editingTriggerId.value = null;
  resetEditTriggerForm();
}

async function handleCreateTrigger() {
  savingTrigger.value = true;
  try {
    await $fetch('/api/triggers', {
      method: 'POST',
      headers,
      body: {
        workflowId: wfId.value,
        triggerType: createTriggerForm.triggerType,
        configuration: createTriggerForm.configuration,
        isActive: createTriggerForm.isActive,
      },
    });
    toast.add({ severity: 'success', summary: 'Trigger added', life: 3000 });
    closeTriggerPanel();
    await Promise.all([refreshTriggers(), refreshWf(), refreshWorkflowVersions()]);
  } catch (e: any) {
    const details = Array.isArray(e?.data?.issues)
      ? e.data.issues.map((issue: any) => issue.message).filter(Boolean).join('; ')
      : '';
    toast.add({ severity: 'error', summary: 'Error', detail: details || e?.data?.error || 'Failed', life: 5000 });
  } finally {
    savingTrigger.value = false;
  }
}

async function handleSaveEditedTrigger() {
  if (!editingTriggerId.value) {
    return;
  }

  savingTrigger.value = true;
  try {
    await $fetch(`/api/triggers/${editingTriggerId.value}`, {
      method: 'PUT',
      headers,
      body: {
        triggerType: editTriggerForm.triggerType,
        configuration: editTriggerForm.configuration,
        isActive: editTriggerForm.isActive,
      },
    });
    toast.add({ severity: 'success', summary: 'Trigger saved', life: 3000 });
    cancelInlineTriggerEdit();
    await Promise.all([refreshTriggers(), refreshWf(), refreshWorkflowVersions()]);
  } catch (e: any) {
    const details = Array.isArray(e?.data?.issues)
      ? e.data.issues.map((issue: any) => issue.message).filter(Boolean).join('; ')
      : '';
    toast.add({ severity: 'error', summary: 'Error', detail: details || e?.data?.error || 'Failed', life: 5000 });
  } finally {
    savingTrigger.value = false;
  }
}

function formatTriggerConnectivityResult(result: { ok: boolean; message?: string; summary?: string }) {
  return result.summary || result.message || (result.ok ? 'Connectivity test passed.' : 'Connectivity test failed.');
}

async function handleTestTriggerConnectivity(triggerId: string) {
  testingTriggerId.value = triggerId;
  try {
    const result = await $fetch<any>(`/api/triggers/${triggerId}/test`, {
      method: 'POST',
      headers,
    });
    triggerConnectivityResults[triggerId] = {
      ok: result?.ok !== false,
      message: result?.message,
      summary: result?.summary,
    };
    toast.add({
      severity: result?.ok === false ? 'error' : 'success',
      summary: result?.ok === false ? 'Connectivity Failed' : 'Connectivity OK',
      detail: result?.summary || result?.message || 'Connectivity test completed.',
      life: 5000,
    });
  } catch (e: any) {
    const message = e?.data?.summary || e?.data?.message || e?.data?.error || 'Connectivity test failed.';
    triggerConnectivityResults[triggerId] = { ok: false, message };
    toast.add({ severity: 'error', summary: 'Connectivity Failed', detail: message, life: 5000 });
  } finally {
    testingTriggerId.value = null;
  }
}

async function handleDeleteTrigger(id: string) {
  confirm.require({
    message: 'Delete this trigger?', header: 'Confirm', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' }, acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/triggers/${id}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', life: 3000 });
      await Promise.all([refreshTriggers(), refreshWf(), refreshWorkflowVersions()]);
    },
  });
}
</script>
