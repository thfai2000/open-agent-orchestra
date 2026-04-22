<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Agents', route: `/${ws}/agents` }, { label: agent?.name || 'Loading...' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="agent">
      <!-- Header -->
      <div class="flex items-start justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">{{ agent.name }}</h1>
          <div class="flex items-center gap-2 mt-2">
            <Tag :value="agent.status" :severity="agent.status === 'active' ? 'success' : agent.status === 'paused' ? 'warn' : 'danger'" />
            <Tag :value="agent.scope === 'workspace' ? 'Workspace' : 'Personal'" severity="info" />
            <Tag :value="agent.sourceType === 'database' ? 'Database' : 'Git'" severity="secondary" />
          </div>
          <div class="flex items-center gap-2 mt-3 text-sm">
            <span class="text-surface-500">Version:</span>
            <NuxtLink v-if="olderAgentVersion" :to="agentVersionPath(olderAgentVersion.version)">
              <Button icon="pi pi-chevron-left" severity="secondary" outlined size="small" aria-label="Previous version" />
            </NuxtLink>
            <Button v-else icon="pi pi-chevron-left" severity="secondary" outlined size="small" disabled aria-label="Previous version" />
            <span class="font-medium text-surface-700">v{{ agent.version || 1 }} <span class="text-surface-500">(latest)</span></span>
            <Button icon="pi pi-chevron-right" severity="secondary" outlined size="small" disabled aria-label="Next version" />
          </div>
          <p v-if="agent.description" class="text-surface-500 mt-2">{{ agent.description }}</p>
        </div>
        <div class="flex gap-2">
          <NuxtLink v-if="agent.status === 'active'" :to="`/${ws}/conversations/new?agentId=${agent.id}`">
            <Button label="Start Conversation" icon="pi pi-comments" severity="secondary" size="small" />
          </NuxtLink>
          <Button v-else label="Start Conversation" icon="pi pi-comments" severity="secondary" size="small" disabled />
          <Button :label="agent.status === 'active' ? 'Pause' : 'Activate'" :icon="agent.status === 'active' ? 'pi pi-pause' : 'pi pi-play'" severity="secondary" size="small" @click="toggleStatus" />
          <Button label="Edit" icon="pi pi-pencil" severity="secondary" size="small" @click="editing = true" v-if="!editing" />
          <Button label="Delete" icon="pi pi-trash" severity="danger" size="small" @click="confirmDelete" />
        </div>
      </div>

      <!-- Edit Form -->
      <Card v-if="editing" class="mb-6">
        <template #title>Edit Agent</template>
        <template #content>
          <Message v-if="editError" severity="error" :closable="false" class="mb-4">{{ editError }}</Message>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name *</label><InputText v-model="editForm.name" /></div>
            <div class="flex flex-col gap-2"><label class="text-sm font-medium">Description</label><InputText v-model="editForm.description" /></div>
            <template v-if="agent.sourceType !== 'database'">
              <div class="flex flex-col gap-2"><label class="text-sm font-medium">Repo URL</label><InputText v-model="editForm.gitRepoUrl" /></div>
              <div class="flex flex-col gap-2"><label class="text-sm font-medium">Branch</label><InputText v-model="editForm.gitBranch" /></div>
              <div class="flex flex-col gap-2"><label class="text-sm font-medium">Agent File Path</label><InputText v-model="editForm.agentFilePath" /></div>
              <div class="flex flex-col gap-2"><label class="text-sm font-medium">Skills Directory</label><InputText v-model="editForm.skillsDirectory" /></div>
            </template>
          </div>
          <Divider />
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Built-in Tools</label>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div v-for="tool in availableTools" :key="tool" class="flex items-center gap-2">
                <Checkbox v-model="editForm.builtinToolsEnabled" :inputId="'edit-'+tool" :value="tool" />
                <label :for="'edit-'+tool" class="text-sm">{{ formatToolName(tool) }}</label>
              </div>
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-4">
            <Button label="Cancel" severity="secondary" @click="editing = false" />
            <Button label="Save" icon="pi pi-check" :loading="savingEdit" @click="handleSaveEdit" />
          </div>
        </template>
      </Card>

      <!-- Tabs -->
      <Tabs :value="activeTab" @update:value="activeTab = $event">
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="files">
            Files
            <span v-if="agentFiles.length > 0" class="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">{{ agentFiles.length }}</span>
          </Tab>
          <Tab value="variables">
            Variables
            <span v-if="mergedVars.length > 0" class="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">{{ mergedVars.length }}</span>
          </Tab>
        </TabList>
        <TabPanels>
          <!-- Overview Tab -->
          <TabPanel value="overview">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Card>
                <template #content>
                  <div class="flex flex-col gap-3">
                    <div><span class="text-surface-500 text-sm">Source Type</span><p class="font-medium">{{ agent.sourceType === 'database' ? 'Database' : 'GitHub Repository' }}</p></div>
                    <div v-if="agent.gitRepoUrl"><span class="text-surface-500 text-sm">Repository</span><p class="font-mono text-sm">{{ agent.gitRepoUrl }}</p></div>
                    <div v-if="agent.gitBranch"><span class="text-surface-500 text-sm">Branch</span><p class="font-mono text-sm">{{ agent.gitBranch }}</p></div>
                    <div v-if="agent.agentFilePath"><span class="text-surface-500 text-sm">Agent File</span><p class="font-mono text-sm">{{ agent.agentFilePath }}</p></div>
                  </div>
                </template>
              </Card>
              <Card>
                <template #content>
                  <div class="flex flex-col gap-3">
                    <div><span class="text-surface-500 text-sm">Built-in Tools</span><p class="font-medium">{{ agent.builtinToolsEnabled?.length ?? 0 }} enabled</p></div>
                    <div><span class="text-surface-500 text-sm">Last Session</span><p class="font-medium">{{ agent.lastSessionAt ? new Date(agent.lastSessionAt).toLocaleString() : 'Never' }}</p></div>
                    <div><span class="text-surface-500 text-sm">Created</span><p class="font-medium">{{ new Date(agent.createdAt).toLocaleString() }}</p></div>
                  </div>
                </template>
              </Card>
            </div>
          </TabPanel>

          <!-- Files Tab -->
          <TabPanel value="files">
            <div class="mt-4">
              <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-medium">Agent Files</h3>
                <Button label="Add File" icon="pi pi-plus" size="small" @click="showFileForm = true" v-if="agent.sourceType === 'database'" />
              </div>

              <Card v-if="showFileForm" class="mb-4">
                <template #content>
                  <div class="flex flex-col gap-3">
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">File Path</label><InputText v-model="fileForm.filePath" placeholder="skills/my-skill.md" /></div>
                    <div class="flex flex-col gap-2"><label class="text-sm font-medium">Content</label><Textarea v-model="fileForm.content" rows="8" /></div>
                    <div class="flex justify-end gap-2">
                      <Button label="Cancel" severity="secondary" size="small" @click="showFileForm = false; fileForm.filePath = ''; fileForm.content = ''" />
                      <Button label="Create File" icon="pi pi-check" size="small" :loading="savingFile" @click="handleCreateFile" />
                    </div>
                  </div>
                </template>
              </Card>

              <DataTable :value="agentFiles" dataKey="id" stripedRows>
                <template #empty><div class="text-center py-8 text-surface-400">No files yet.</div></template>
                <Column field="filePath" header="Path" style="min-width: 200px">
                  <template #body="{ data }"><span class="font-mono text-sm">{{ data.filePath }}</span></template>
                </Column>
                <Column header="Size">
                  <template #body="{ data }"><span class="text-sm text-surface-500">{{ (data.content?.length ?? 0).toLocaleString() }} chars</span></template>
                </Column>
                <Column header="Updated">
                  <template #body="{ data }"><span class="text-sm text-surface-500">{{ new Date(data.updatedAt || data.createdAt).toLocaleDateString() }}</span></template>
                </Column>
                <Column header="" style="width: 120px">
                  <template #body="{ data }">
                    <div class="flex gap-1">
                      <Button icon="pi pi-pencil" text rounded size="small" @click="startEditFile(data)" />
                      <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="handleDeleteFile(data.id)" />
                    </div>
                  </template>
                </Column>
              </DataTable>

              <!-- Edit file dialog -->
              <Dialog v-model:visible="editingFile" header="Edit File" :style="{ width: '600px' }" modal>
                <div class="flex flex-col gap-3">
                  <div class="flex flex-col gap-2"><label class="text-sm font-medium">Path</label><InputText v-model="editFileForm.filePath" /></div>
                  <div class="flex flex-col gap-2"><label class="text-sm font-medium">Content</label><Textarea v-model="editFileForm.content" rows="12" /></div>
                </div>
                <template #footer>
                  <Button label="Cancel" severity="secondary" @click="editingFile = false" />
                  <Button label="Save" icon="pi pi-check" :loading="savingFile" @click="handleSaveFile" />
                </template>
              </Dialog>
            </div>
          </TabPanel>

          <!-- Variables Tab -->
          <TabPanel value="variables">
            <div class="mt-4">
              <div class="flex items-center justify-between mb-4">
                <div>
                  <h3 class="text-lg font-medium">Effective Variables</h3>
                  <p class="text-surface-400 text-xs mt-1">Consolidated view across all scopes. Agent &gt; User &gt; Workspace priority (higher overrides lower).</p>
                </div>
                <div class="flex gap-2 items-center">
                  <NuxtLink :to="`/${ws}/variables`">
                    <Button label="Manage Variables" icon="pi pi-external-link" severity="secondary" size="small" />
                  </NuxtLink>
                </div>
              </div>

              <Message severity="info" :closable="false" class="mb-4 text-xs">
                <i class="pi pi-info-circle mr-1"></i>
                To add or edit variables, go to the <NuxtLink :to="`/${ws}/variables`" class="text-primary font-medium hover:underline">Variables</NuxtLink> page where you can manage Workspace, User, and Agent-scoped variables.
              </Message>

              <DataTable :value="mergedVars" dataKey="_uid" stripedRows>
                <template #empty><div class="text-center py-8 text-surface-400">No variables configured across any scope for this agent.</div></template>
                <Column field="key" header="Key" style="min-width: 160px">
                  <template #body="{ data }"><span class="font-mono text-sm">{{ data.key }}</span></template>
                </Column>
                <Column field="variableType" header="Type" style="width: 110px">
                  <template #body="{ data }"><Tag :value="data.variableType" :severity="data.variableType === 'credential' ? 'warn' : 'info'" /></template>
                </Column>
                <Column header="Effective Scope" style="width: 150px">
                  <template #body="{ data }">
                    <Tag :value="scopeLabel(data._effectiveScope)" :severity="scopeSeverity(data._effectiveScope)" />
                  </template>
                </Column>
                <Column header="Defined In" style="width: 200px">
                  <template #body="{ data }">
                    <div class="flex flex-wrap gap-1">
                      <Tag v-for="s in data._definedScopes" :key="s" :value="scopeLabel(s)" :severity="scopeSeverity(s)" class="text-[10px]" :class="{ 'opacity-40 line-through': s !== data._effectiveScope }" />
                    </div>
                  </template>
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
    <div v-else class="text-center py-12 text-surface-400">Loading agent...</div>
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
const agentId = computed(() => route.params.id as string);
const { buildCredentialOptions, filterGitAuthCredentialOptions, filterCopilotCredentialOptions } = useAgentCredentialOptions();

const activeTab = ref('overview');
const editing = ref(false);
const editError = ref('');
const savingEdit = ref(false);

// Load agent
const { data: agentData, refresh: refreshAgent } = await useFetch(computed(() => `/api/agents/${agentId.value}`), { headers });
const agent = computed(() => (agentData.value as any)?.agent ?? null);
const { data: agentVersionsData, refresh: refreshAgentVersions } = await useFetch(computed(() => `/api/agents/${agentId.value}/versions?limit=100`), { headers });
const agentVersions = computed(() => (agentVersionsData.value as any)?.versions ?? []);
const olderAgentVersion = computed(() => {
  const currentVersion = agent.value?.version;
  if (!currentVersion) return null;
  const currentIndex = agentVersions.value.findIndex((entry: any) => entry.version === currentVersion);
  if (currentIndex === -1) return null;
  return agentVersions.value[currentIndex + 1] ?? null;
});

function agentVersionPath(version: number | string) {
  return `/${ws.value}/agents/${agentId.value}/v/${version}`;
}

// Load files
const { data: filesData, refresh: refreshFiles } = await useFetch(computed(() => `/api/agent-files/${agentId.value}`), { headers });
const agentFiles = computed(() => (filesData.value as any)?.files ?? []);

// Load variables (all 3 scopes)
const { data: varsData, refresh: refreshVars } = await useFetch(computed(() => `/api/variables?scope=agent&agentId=${agentId.value}`), { headers });
const agentVars = computed(() => (varsData.value as any)?.variables ?? []);
const { data: wsVarsData } = await useFetch('/api/variables?scope=workspace', { headers });
const workspaceVars = computed(() => (wsVarsData.value as any)?.variables ?? []);
const { data: userVarsData } = await useFetch('/api/variables?scope=user', { headers });
const userVars = computed(() => (userVarsData.value as any)?.variables ?? []);

// Merge variables: Agent > User > Workspace priority
const mergedVars = computed(() => {
  const map = new Map<string, any>();
  // Workspace (lowest priority)
  for (const v of workspaceVars.value) {
    map.set(v.key, { ...v, _effectiveScope: 'workspace', _definedScopes: ['workspace'], _uid: `ws-${v.id}` });
  }
  // User (medium priority)
  for (const v of userVars.value) {
    const existing = map.get(v.key);
    if (existing) {
      map.set(v.key, { ...v, _effectiveScope: 'user', _definedScopes: [...existing._definedScopes, 'user'], _uid: `usr-${v.id}` });
    } else {
      map.set(v.key, { ...v, _effectiveScope: 'user', _definedScopes: ['user'], _uid: `usr-${v.id}` });
    }
  }
  // Agent (highest priority)
  for (const v of agentVars.value) {
    const existing = map.get(v.key);
    if (existing) {
      map.set(v.key, { ...v, _effectiveScope: 'agent', _definedScopes: [...existing._definedScopes, 'agent'], _uid: `ag-${v.id}` });
    } else {
      map.set(v.key, { ...v, _effectiveScope: 'agent', _definedScopes: ['agent'], _uid: `ag-${v.id}` });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
});

function scopeLabel(s: string) { return { workspace: 'Workspace', user: 'User', agent: 'Agent' }[s] || s; }
function scopeSeverity(s: string) { return { workspace: 'secondary', user: 'info', agent: 'success' }[s] || 'secondary'; }

// Edit form
const editForm = reactive({
  name: '', description: '', gitRepoUrl: '', gitBranch: '', agentFilePath: '', skillsDirectory: '',
  builtinToolsEnabled: [] as string[],
});

const availableTools = [
  'schedule_next_workflow_execution', 'manage_webhook_trigger', 'record_decision',
  'memory_store', 'memory_retrieve', 'edit_workflow', 'read_variables', 'edit_variables', 'simple_http_request',
];

function formatToolName(t: string) { return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

watch(agent, (a) => {
  if (a) Object.assign(editForm, {
    name: a.name, description: a.description || '', gitRepoUrl: a.gitRepoUrl || '',
    gitBranch: a.gitBranch || '', agentFilePath: a.agentFilePath || '', skillsDirectory: a.skillsDirectory || '',
    builtinToolsEnabled: [...(a.builtinToolsEnabled || [])],
  });
}, { immediate: true });

async function handleSaveEdit() {
  editError.value = '';
  savingEdit.value = true;
  try {
    const body: Record<string, unknown> = {
      name: editForm.name.trim(),
      description: editForm.description.trim(),
      builtinToolsEnabled: [...editForm.builtinToolsEnabled],
    };

    if (agent.value?.sourceType !== 'database') {
      const gitRepoUrl = editForm.gitRepoUrl.trim();
      const gitBranch = editForm.gitBranch.trim();
      const agentFilePath = editForm.agentFilePath.trim();
      const skillsDirectory = editForm.skillsDirectory.trim();

      if (gitRepoUrl) body.gitRepoUrl = gitRepoUrl;
      if (gitBranch) body.gitBranch = gitBranch;
      if (agentFilePath) body.agentFilePath = agentFilePath;
      body.skillsDirectory = skillsDirectory || null;
    }

    await $fetch(`/api/agents/${agentId.value}`, { method: 'PUT', headers, body });
    toast.add({ severity: 'success', summary: 'Saved', detail: 'Agent updated', life: 3000 });
    editing.value = false;
    await Promise.all([refreshAgent(), refreshAgentVersions()]);
  } catch (e: any) {
    editError.value = e?.data?.details?.[0]?.message || e?.data?.error || 'Failed to save.';
  } finally {
    savingEdit.value = false;
  }
}

async function toggleStatus() {
  const newStatus = agent.value.status === 'active' ? 'paused' : 'active';
  await $fetch(`/api/agents/${agentId.value}`, { method: 'PUT', headers, body: { status: newStatus } });
  toast.add({ severity: 'success', summary: 'Updated', detail: `Agent ${newStatus}`, life: 3000 });
  await Promise.all([refreshAgent(), refreshAgentVersions()]);
}

function confirmDelete() {
  confirm.require({
    message: `Are you sure you want to delete "${agent.value.name}"?`,
    header: 'Confirm Delete',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/agents/${agentId.value}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', detail: 'Agent removed', life: 3000 });
      router.push(`/${ws.value}/agents`);
    },
  });
}

// File management
const showFileForm = ref(false);
const fileForm = reactive({ filePath: '', content: '' });
const savingFile = ref(false);
const editingFile = ref(false);
const editFileForm = reactive({ id: '', filePath: '', content: '' });

async function handleCreateFile() {
  savingFile.value = true;
  try {
    await $fetch(`/api/agent-files/${agentId.value}`, { method: 'POST', headers, body: fileForm });
    toast.add({ severity: 'success', summary: 'Created', detail: 'File added', life: 3000 });
    showFileForm.value = false;
    fileForm.filePath = ''; fileForm.content = '';
    await Promise.all([refreshFiles(), refreshAgent(), refreshAgentVersions()]);
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  } finally {
    savingFile.value = false;
  }
}

function startEditFile(f: any) {
  Object.assign(editFileForm, { id: f.id, filePath: f.filePath, content: f.content || '' });
  editingFile.value = true;
}

async function handleSaveFile() {
  savingFile.value = true;
  try {
    await $fetch(`/api/agent-files/${agentId.value}/${editFileForm.id}`, { method: 'PUT', headers, body: { filePath: editFileForm.filePath, content: editFileForm.content } });
    toast.add({ severity: 'success', summary: 'Saved', detail: 'File updated', life: 3000 });
    editingFile.value = false;
    await Promise.all([refreshFiles(), refreshAgent(), refreshAgentVersions()]);
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Error', detail: e?.data?.error || 'Failed', life: 5000 });
  } finally {
    savingFile.value = false;
  }
}

async function handleDeleteFile(fileId: string) {
  confirm.require({
    message: 'Delete this file?', header: 'Confirm', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' }, acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/agent-files/${agentId.value}/${fileId}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', detail: 'File removed', life: 3000 });
      await Promise.all([refreshFiles(), refreshAgent(), refreshAgentVersions()]);
    },
  });
}

// (Variables are managed on the dedicated Variables page)
</script>
