<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="versionRecord && snapshotWorkflow">
      <div class="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 class="text-2xl font-semibold">{{ snapshotWorkflow.name }}</h1>
          <div class="flex flex-wrap items-center gap-2 mt-2">
            <Tag :value="snapshotWorkflow.isActive ? 'Active' : 'Inactive'" :severity="snapshotWorkflow.isActive ? 'success' : 'secondary'" />
            <Tag :value="snapshotWorkflow.scope === 'workspace' ? 'Workspace' : 'Personal'" severity="info" />
            <Tag value="Read-only" severity="warn" />
          </div>
          <div class="flex items-center gap-2 mt-3 text-sm">
            <span class="text-surface-500">Version:</span>
            <Button icon="pi pi-chevron-left" severity="secondary" outlined size="small" :disabled="!olderVersion" aria-label="Previous version" @click="navigateToVersion(olderVersion?.version)" />
            <span class="font-medium text-surface-700">v{{ versionRecord.version }}<span v-if="isLatestVersion" class="text-surface-500"> (latest)</span></span>
            <Button icon="pi pi-chevron-right" severity="secondary" outlined size="small" :disabled="!newerVersion" aria-label="Next version" @click="navigateToVersion(newerVersion?.version)" />
          </div>
          <p v-if="snapshotWorkflow.description" class="text-surface-500 mt-2">{{ snapshotWorkflow.description }}</p>
          <div class="flex flex-wrap items-center gap-x-3 mt-3 text-xs text-surface-400">
            <span>Captured {{ formatDateTime(versionRecord.createdAt) }}</span>
            <span v-if="versionRecord.changedBy">by {{ versionRecord.changedBy }}</span>
            <span v-if="(snapshotWorkflow.labels || []).length > 0">Labels: {{ snapshotWorkflow.labels.join(', ') }}</span>
          </div>
        </div>
        <div class="flex gap-2">
          <NuxtLink :to="latestPath">
            <Button label="Latest" severity="secondary" size="small" />
          </NuxtLink>
        </div>
      </div>

      <Message severity="warn" :closable="false" class="mb-6">
        Historical workflow versions are read-only. Use the latest page to edit steps, triggers, or run the workflow.
      </Message>

      <Tabs :value="activeTab" @update:value="activeTab = $event">
        <TabList>
          <Tab value="general">General</Tab>
          <Tab value="variables">Variables <span v-if="snapshotVariables.length > 0" class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-700 text-surface-300 text-[10px] leading-none align-middle">{{ snapshotVariables.length }}</span></Tab>
          <Tab value="flows">Flows <span v-if="snapshotNodes.length > 0" class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-700 text-surface-300 text-[10px] leading-none align-middle">{{ snapshotNodes.length }}</span></Tab>
        </TabList>
        <TabPanels>
          <!-- General \u2014 read-only label/value list mirroring the edit page form -->
          <TabPanel value="general">
            <div class="mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Name</span><span class="text-sm">{{ snapshotWorkflow.name }}</span></div>
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Description</span><span class="text-sm">{{ snapshotWorkflow.description || '\u2014' }}</span></div>
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Workflow Agent</span><span class="text-sm font-mono">{{ snapshotWorkflow.defaultAgentId || 'None' }}</span></div>
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Default Model</span><span class="text-sm">{{ snapshotWorkflow.defaultModel || 'None' }}</span></div>
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Reasoning Effort</span><span class="text-sm">{{ snapshotWorkflow.defaultReasoningEffort || 'None' }}</span></div>
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Worker Runtime</span><span class="text-sm">{{ snapshotWorkflow.workerRuntime || 'static' }}</span></div>
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Step Timeout</span><span class="text-sm">{{ snapshotWorkflow.stepAllocationTimeoutSeconds || '\u2014' }} seconds</span></div>
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Labels</span>
                <div class="flex flex-wrap gap-1">
                  <Tag v-for="l in (snapshotWorkflow.labels || [])" :key="l" :value="l" severity="secondary" class="text-xs" />
                  <span v-if="!(snapshotWorkflow.labels || []).length" class="text-sm text-surface-400">\u2014</span>
                </div>
              </div>
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Created</span><span class="text-sm">{{ snapshotWorkflow.createdAt ? new Date(snapshotWorkflow.createdAt).toLocaleString() : '\u2014' }}</span></div>
              <div class="flex flex-col gap-1"><span class="text-xs font-medium text-surface-500">Active at snapshot</span><Tag :value="snapshotWorkflow.isActive ? 'Yes' : 'No'" :severity="snapshotWorkflow.isActive ? 'success' : 'secondary'" class="self-start" /></div>
            </div>
          </TabPanel>

          <!-- Variables \u2014 read-only list of workflow-scoped variables at this version -->
          <TabPanel value="variables">
            <div class="mt-2">
              <DataTable :value="snapshotVariables" size="small" stripedRows>
                <template #empty>
                  <div class="py-6 text-center text-sm text-surface-400">
                    No workflow-scoped variables were captured in this version snapshot.
                  </div>
                </template>
                <Column header="Key" style="width: 240px">
                  <template #body="{ data }"><code class="font-mono text-xs">{{ data.key }}</code></template>
                </Column>
                <Column header="Type" style="width: 120px">
                  <template #body="{ data }"><Tag :value="data.type" severity="secondary" class="text-xs" /></template>
                </Column>
                <Column header="Value">
                  <template #body="{ data }">
                    <span v-if="data.masked" class="text-xs text-surface-400">\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (credential)</span>
                    <span v-else class="text-xs font-mono break-all">{{ formatVarValue(data.value) }}</span>
                  </template>
                </Column>
                <Column header="Description">
                  <template #body="{ data }"><span class="text-xs text-surface-500">{{ data.description || '\u2014' }}</span></template>
                </Column>
              </DataTable>
            </div>
          </TabPanel>

          <TabPanel value="flows">
            <div class="mt-4 flex items-center justify-end mb-2">
              <SelectButton
                :modelValue="flowsSubTab"
                :options="[
                  { label: 'Visual', value: 'visual', icon: 'pi pi-sitemap' },
                  { label: 'YAML', value: 'yaml', icon: 'pi pi-code' },
                ]"
                optionLabel="label"
                optionValue="value"
                size="small"
                @update:modelValue="(val) => { if (val) flowsSubTab = val }"
              >
                <template #option="slotProps">
                  <i :class="slotProps.option.icon" class="text-xs mr-1"></i>
                  <span class="text-xs">{{ slotProps.option.label }}</span>
                </template>
              </SelectButton>
            </div>
            <!-- Read-only visual + YAML views use the same components as the
                 editor page so visual presentation is consistent. -->
            <WorkflowVisualEditor
              v-if="flowsSubTab === 'visual'"
              :workflow-id="workflowId"
              :readonly="true"
              :version-data="versionGraphPayload"
            />
            <WorkflowYamlEditor
              v-else
              :workflow-id="workflowId"
              :readonly="true"
              :version-data="versionGraphPayload"
            />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
    <div v-else class="text-center py-12 text-surface-400">Loading workflow version...</div>
  </div>
</template>

<script setup lang="ts">
import { formatTriggerConfiguration, formatTriggerType } from '~/utils/triggers';

const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();

const ws = computed(() => (route.params.workspace as string) || 'default');
const workflowId = computed(() => route.params.id as string);
const versionNumber = computed(() => Number(route.params.version));
const activeTab = ref('general');
const flowsSubTab = ref<'visual' | 'yaml'>('visual');

function formatVarValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

const { data: versionData } = await useFetch<any>(computed(() => `/api/workflows/${workflowId.value}/versions/${versionNumber.value}`), { headers });
const { data: versionsData } = await useFetch<any>(computed(() => `/api/workflows/${workflowId.value}/versions?limit=100`), { headers });

const versionRecord = computed(() => versionData.value?.version ?? null);
const versions = computed(() => (versionsData.value?.versions ?? []).slice().sort((left: any, right: any) => right.version - left.version));
const snapshotWorkflow = computed(() => versionRecord.value?.snapshot?.workflow ?? null);
const snapshotSteps = computed(() => versionRecord.value?.snapshot?.steps ?? []);
const snapshotTriggers = computed(() => versionRecord.value?.snapshot?.triggers ?? []);
const snapshotNodes = computed(() => versionRecord.value?.snapshot?.nodes ?? []);
const snapshotVariables = computed(() => versionRecord.value?.snapshot?.variables ?? []);
const snapshotEdges = computed(() => versionRecord.value?.snapshot?.edges ?? []);

// GraphPayload-shaped snapshot fed into WorkflowYamlEditor in read-only mode so
// the historical YAML view uses the same component as the editable page.
const versionGraphPayload = computed(() => ({
  nodes: snapshotNodes.value,
  edges: snapshotEdges.value,
  triggers: snapshotTriggers.value,
}));
const latestPath = computed(() => `/${ws.value}/workflows/${workflowId.value}`);

const currentVersionIndex = computed(() => versions.value.findIndex((entry: any) => entry.version === versionNumber.value));
const newerVersion = computed(() => currentVersionIndex.value > 0 ? versions.value[currentVersionIndex.value - 1] : null);
const olderVersion = computed(() => currentVersionIndex.value >= 0 ? versions.value[currentVersionIndex.value + 1] ?? null : null);
const isLatestVersion = computed(() => versions.value.some((entry: any) => entry.version === versionNumber.value && entry.isLatest));

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Workflows', route: `/${ws.value}/workflows` },
  { label: snapshotWorkflow.value?.name || 'Loading...', route: latestPath.value },
  { label: `v${versionNumber.value}` },
]);

function navigateToVersion(version?: number) {
  if (!version) return;
  router.push(`/${ws.value}/workflows/${workflowId.value}/v/${version}`);
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'unknown time';
  return new Date(value).toLocaleString();
}
</script>