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
          <Tab value="steps">Steps <span v-if="snapshotSteps.length > 0" class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-700 text-surface-300 text-[10px] leading-none align-middle">{{ snapshotSteps.length }}</span></Tab>
          <Tab value="triggers">Triggers <span v-if="snapshotTriggers.length > 0" class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-700 text-surface-300 text-[10px] leading-none align-middle">{{ snapshotTriggers.length }}</span></Tab>
          <Tab value="overview">Overview</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="steps">
            <div class="mt-4 flex flex-col gap-4">
              <div v-for="(step, idx) in snapshotSteps" :key="step.id || `${idx}-${step.stepOrder}`" class="border border-surface-200 rounded-lg p-4">
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
                <pre class="bg-surface-50 p-3 rounded text-sm whitespace-pre-wrap max-h-40 overflow-y-auto mt-2">{{ step.promptTemplate }}</pre>
              </div>
              <p v-if="snapshotSteps.length === 0" class="text-center text-surface-400 py-4">No steps were stored in this version snapshot.</p>
            </div>
          </TabPanel>

          <TabPanel value="triggers">
            <div class="mt-4">
              <DataTable :value="snapshotTriggers" dataKey="id" stripedRows>
                <template #empty><div class="text-center py-8 text-surface-400">No triggers were stored in this version snapshot.</div></template>
                <Column header="Type" style="width: 140px">
                  <template #body="{ data }"><Tag :value="formatTriggerType(data.triggerType)" /></template>
                </Column>
                <Column header="Active" style="width: 100px">
                  <template #body="{ data }"><Tag :value="data.isActive ? 'Yes' : 'No'" :severity="data.isActive ? 'success' : 'secondary'" /></template>
                </Column>
                <Column header="Configuration">
                  <template #body="{ data }"><span class="text-sm font-mono break-all">{{ formatTriggerConfiguration(data) }}</span></template>
                </Column>
                <Column header="Created" style="width: 180px">
                  <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.createdAt ? new Date(data.createdAt).toLocaleDateString() : '—' }}</span></template>
                </Column>
              </DataTable>
            </div>
          </TabPanel>

          <TabPanel value="overview">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Card>
                <template #content>
                  <div class="flex flex-col gap-3">
                    <div><span class="text-surface-500 text-sm">Workflow Agent</span><p class="font-medium">{{ snapshotWorkflow.defaultAgentId || 'None' }}</p></div>
                    <div><span class="text-surface-500 text-sm">Default Model</span><p class="font-medium">{{ snapshotWorkflow.defaultModel || 'None' }}</p></div>
                    <div><span class="text-surface-500 text-sm">Reasoning Effort</span><p class="font-medium">{{ snapshotWorkflow.defaultReasoningEffort || 'None' }}</p></div>
                  </div>
                </template>
              </Card>
              <Card>
                <template #content>
                  <div class="flex flex-col gap-3">
                    <div><span class="text-surface-500 text-sm">Worker Runtime</span><p class="font-medium">{{ snapshotWorkflow.workerRuntime || 'static' }}</p></div>
                    <div><span class="text-surface-500 text-sm">Step Timeout</span><p class="font-medium">{{ snapshotWorkflow.stepAllocationTimeoutSeconds || '—' }} seconds</p></div>
                    <div><span class="text-surface-500 text-sm">Created</span><p class="font-medium">{{ snapshotWorkflow.createdAt ? new Date(snapshotWorkflow.createdAt).toLocaleString() : '—' }}</p></div>
                  </div>
                </template>
              </Card>
            </div>
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
const activeTab = ref('steps');

const { data: versionData } = await useFetch<any>(computed(() => `/api/workflows/${workflowId.value}/versions/${versionNumber.value}`), { headers });
const { data: versionsData } = await useFetch<any>(computed(() => `/api/workflows/${workflowId.value}/versions?limit=100`), { headers });

const versionRecord = computed(() => versionData.value?.version ?? null);
const versions = computed(() => (versionsData.value?.versions ?? []).slice().sort((left: any, right: any) => right.version - left.version));
const snapshotWorkflow = computed(() => versionRecord.value?.snapshot?.workflow ?? null);
const snapshotSteps = computed(() => versionRecord.value?.snapshot?.steps ?? []);
const snapshotTriggers = computed(() => versionRecord.value?.snapshot?.triggers ?? []);
const latestPath = computed(() => `/${ws.value}/workflows/${workflowId.value}`);

const currentVersionIndex = computed(() => versions.value.findIndex((entry: any) => entry.version === versionNumber.value));
const newerVersion = computed(() => currentVersionIndex.value > 0 ? versions.value[currentVersionIndex.value - 1] : null);
const olderVersion = computed(() => currentVersionIndex.value >= 0 ? versions.value[currentVersionIndex.value + 1] ?? null : null);
const isLatestVersion = computed(() => versions.value.some((entry: any) => entry.version === versionNumber.value && entry.isLatest));

// If the user lands on a /v/<n> URL that is in fact the current latest version,
// redirect them to the editable detail page so the Edit/Manual Run buttons are
// available. Older snapshots stay read-only as before.
watch(isLatestVersion, (latest) => {
  if (latest) {
    router.replace(latestPath.value);
  }
}, { immediate: true });

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Workflows', route: `/${ws.value}/workflows` },
  { label: snapshotWorkflow.value?.name || 'Loading...', route: latestPath.value },
  { label: `v${versionNumber.value}` },
]);

function navigateToVersion(version?: number) {
  if (!version) return;
  const target = versions.value.find((entry: any) => entry.version === version);
  if (target?.isLatest) {
    router.push(latestPath.value);
  } else {
    router.push(`/${ws.value}/workflows/${workflowId.value}/v/${version}`);
  }
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'unknown time';
  return new Date(value).toLocaleString();
}
</script>