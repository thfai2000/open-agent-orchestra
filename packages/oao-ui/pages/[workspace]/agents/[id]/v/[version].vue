<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="versionRecord && snapshotAgent">
      <div class="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 class="text-2xl font-semibold">{{ snapshotAgent.name }}</h1>
          <div class="flex flex-wrap items-center gap-2 mt-2">
            <Tag :value="snapshotAgent.status" :severity="snapshotAgent.status === 'active' ? 'success' : snapshotAgent.status === 'paused' ? 'warn' : 'danger'" />
            <Tag :value="snapshotAgent.scope === 'workspace' ? 'Workspace' : 'Personal'" severity="info" />
            <Tag :value="snapshotAgent.sourceType === 'database' ? 'Database' : 'Git'" severity="secondary" />
            <Tag :value="`v${versionRecord.version}`" severity="secondary" />
            <Tag value="Read-only" severity="warn" />
          </div>
          <p v-if="snapshotAgent.description" class="text-surface-500 mt-2">{{ snapshotAgent.description }}</p>
          <p class="text-xs text-surface-400 mt-3">
            Snapshot captured {{ formatDateTime(versionRecord.createdAt) }}
            <span v-if="versionRecord.changedBy">by {{ versionRecord.changedBy }}</span>
          </p>
        </div>
        <div class="flex gap-2">
          <Button icon="pi pi-chevron-left" severity="secondary" outlined size="small" :disabled="!olderVersion" aria-label="Previous version" @click="navigateToVersion(olderVersion?.version)" />
          <Button icon="pi pi-chevron-right" severity="secondary" outlined size="small" :disabled="!newerVersion" aria-label="Next version" @click="navigateToVersion(newerVersion?.version)" />
          <NuxtLink :to="latestPath">
            <Button label="Latest" severity="secondary" size="small" />
          </NuxtLink>
        </div>
      </div>

      <Message severity="warn" :closable="false" class="mb-6">
        Historical agent versions are read-only. Use the latest page to edit the current agent.
      </Message>

      <Tabs :value="activeTab" @update:value="activeTab = $event">
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="files">Files <span v-if="snapshotFiles.length > 0" class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-700 text-surface-300 text-[10px] leading-none align-middle">{{ snapshotFiles.length }}</span></Tab>
          <Tab value="variables">Variables <span v-if="snapshotVariables.length > 0" class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-700 text-surface-300 text-[10px] leading-none align-middle">{{ snapshotVariables.length }}</span></Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="overview">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Card>
                <template #content>
                  <div class="flex flex-col gap-3">
                    <div><span class="text-surface-500 text-sm">Source Type</span><p class="font-medium">{{ snapshotAgent.sourceType === 'database' ? 'Database' : 'GitHub Repository' }}</p></div>
                    <div v-if="snapshotAgent.gitRepoUrl"><span class="text-surface-500 text-sm">Repository</span><p class="font-mono text-sm break-all">{{ snapshotAgent.gitRepoUrl }}</p></div>
                    <div v-if="snapshotAgent.gitBranch"><span class="text-surface-500 text-sm">Branch</span><p class="font-mono text-sm">{{ snapshotAgent.gitBranch }}</p></div>
                    <div v-if="snapshotAgent.agentFilePath"><span class="text-surface-500 text-sm">Agent File</span><p class="font-mono text-sm">{{ snapshotAgent.agentFilePath }}</p></div>
                  </div>
                </template>
              </Card>
              <Card>
                <template #content>
                  <div class="flex flex-col gap-3">
                    <div><span class="text-surface-500 text-sm">Built-in Tools</span><p class="font-medium">{{ snapshotAgent.builtinToolsEnabled?.length ?? 0 }} enabled</p></div>
                    <div><span class="text-surface-500 text-sm">Last Session</span><p class="font-medium">{{ snapshotAgent.lastSessionAt ? new Date(snapshotAgent.lastSessionAt).toLocaleString() : 'Never' }}</p></div>
                    <div><span class="text-surface-500 text-sm">Created</span><p class="font-medium">{{ snapshotAgent.createdAt ? new Date(snapshotAgent.createdAt).toLocaleString() : '—' }}</p></div>
                  </div>
                </template>
              </Card>
            </div>
          </TabPanel>

          <TabPanel value="files">
            <div class="mt-4">
              <DataTable :value="snapshotFiles" dataKey="id" stripedRows>
                <template #empty><div class="text-center py-8 text-surface-400">No files were stored in this version snapshot.</div></template>
                <Column field="filePath" header="Path" style="min-width: 220px">
                  <template #body="{ data }"><span class="font-mono text-sm">{{ data.filePath }}</span></template>
                </Column>
                <Column header="Size" style="width: 140px">
                  <template #body="{ data }"><span class="text-sm text-surface-500">{{ (data.content?.length ?? 0).toLocaleString() }} chars</span></template>
                </Column>
                <Column header="Updated" style="width: 180px">
                  <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : '—' }}</span></template>
                </Column>
              </DataTable>
            </div>
          </TabPanel>

          <TabPanel value="variables">
            <div class="mt-4">
              <Message severity="info" :closable="false" class="mb-4 text-xs">
                This snapshot stores agent-scoped variables only. Workspace and user variables continue to live outside the agent version history.
              </Message>
              <DataTable :value="snapshotVariables" dataKey="id" stripedRows>
                <template #empty><div class="text-center py-8 text-surface-400">No agent-scoped variables were stored in this version snapshot.</div></template>
                <Column field="key" header="Key" style="min-width: 180px">
                  <template #body="{ data }"><span class="font-mono text-sm">{{ data.key }}</span></template>
                </Column>
                <Column field="variableType" header="Type" style="width: 120px">
                  <template #body="{ data }"><Tag :value="data.variableType" :severity="data.variableType === 'credential' ? 'warn' : 'info'" /></template>
                </Column>
                <Column header="Inject As Env" style="width: 140px">
                  <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.injectAsEnvVariable ? 'Yes' : 'No' }}</span></template>
                </Column>
                <Column field="description" header="Description">
                  <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.description || '—' }}</span></template>
                </Column>
              </DataTable>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
    <div v-else class="text-center py-12 text-surface-400">Loading agent version...</div>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();

const ws = computed(() => (route.params.workspace as string) || 'default');
const agentId = computed(() => route.params.id as string);
const versionNumber = computed(() => Number(route.params.version));
const activeTab = ref('overview');

const { data: versionData } = await useFetch<any>(computed(() => `/api/agents/${agentId.value}/versions/${versionNumber.value}`), { headers });
const { data: versionsData } = await useFetch<any>(computed(() => `/api/agents/${agentId.value}/versions?limit=100`), { headers });

const versionRecord = computed(() => versionData.value?.version ?? null);
const versions = computed(() => (versionsData.value?.versions ?? []).slice().sort((left: any, right: any) => right.version - left.version));
const snapshotAgent = computed(() => versionRecord.value?.snapshot?.agent ?? null);
const snapshotFiles = computed(() => versionRecord.value?.snapshot?.files ?? []);
const snapshotVariables = computed(() => versionRecord.value?.snapshot?.variables ?? []);
const latestPath = computed(() => `/${ws.value}/agents/${agentId.value}`);

const currentVersionIndex = computed(() => versions.value.findIndex((entry: any) => entry.version === versionNumber.value));
const newerVersion = computed(() => currentVersionIndex.value > 0 ? versions.value[currentVersionIndex.value - 1] : null);
const olderVersion = computed(() => currentVersionIndex.value >= 0 ? versions.value[currentVersionIndex.value + 1] ?? null : null);

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Agents', route: `/${ws.value}/agents` },
  { label: snapshotAgent.value?.name || 'Loading...', route: latestPath.value },
  { label: `v${versionNumber.value}` },
]);

function navigateToVersion(version?: number) {
  if (!version) return;
  router.push(`/${ws.value}/agents/${agentId.value}/v/${version}`);
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return 'unknown time';
  return new Date(value).toLocaleString();
}
</script>