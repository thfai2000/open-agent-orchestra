<template>
  <div v-if="isHistoricalVersionRoute">
    <NuxtPage />
  </div>
  <div v-else>
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
              <div class="flex flex-col gap-2"><label class="text-sm font-medium">Git Auth Credential</label><Select v-model="editForm.githubTokenCredentialId" :options="gitCredOptions" optionLabel="optionLabel" optionValue="id" placeholder="None" showClear /></div>
            </template>
            <div class="flex flex-col gap-2 md:col-span-2">
              <label class="text-sm font-medium">GitHub Copilot Token / LLM API Key</label>
              <Select v-model="editForm.copilotTokenCredentialId" :options="modelAuthCredOptions" optionLabel="optionLabel" optionValue="id" placeholder="Use the default system token or API key" showClear />
              <small class="text-surface-400">Used for GitHub-provider sessions or as the API key / bearer token for custom providers. Leave blank to use `DEFAULT_LLM_API_KEY`, then `GITHUB_TOKEN` as a fallback.</small>
            </div>
            <div class="flex flex-col gap-2 md:col-span-2">
              <label class="text-sm font-medium">mcp.json.template</label>
              <Textarea v-model="editForm.mcpJsonTemplate" rows="8" class="font-mono text-sm" placeholder='{"mcpServers": {"example": {"command": "npx", "args": ["-y", "some-mcp-server"]}}}' />
              <small class="text-surface-400">The default OAO Platform MCP server is auto-included and authenticated as the current signed-in user via a short-lived JWT. Only add extra MCP servers here.</small>
            </div>
          </div>
          <Divider />
          <div class="flex flex-col gap-3">
            <div class="flex items-start justify-between gap-4">
              <div>
                <label class="text-sm font-medium">Tool Selection</label>
                <p class="text-xs text-surface-400 mt-1">Built-ins and MCP tools are grouped by provider. Changing the selection stores an explicit allowlist for this agent.</p>
              </div>
              <Button label="Refresh Catalog" icon="pi pi-refresh" severity="secondary" outlined size="small" :loading="toolCatalogPending" @click="refreshToolCatalog(true)" />
            </div>
            <Message v-if="toolCatalogError" severity="warn" :closable="false">{{ toolCatalogError }}</Message>
            <Message v-else-if="toolCatalogUnresolved.length > 0" severity="warn" :closable="false">
              Some previously selected tools are no longer discoverable: {{ toolCatalogUnresolved.join(', ') }}
            </Message>
            <div v-if="toolCatalogPending && !toolCatalog" class="text-sm text-surface-500">Inspecting tool catalog...</div>
            <div v-else-if="toolCatalogGroups.length > 0" class="flex flex-col gap-3">
              <div v-for="group in toolCatalogGroups" :key="group.key" class="rounded-lg border border-surface-200 p-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h4 class="font-medium">{{ group.label }}</h4>
                      <Tag :value="group.sourceLabel" :severity="group.sourceSeverity" />
                      <span class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-700 text-surface-300 text-[10px] leading-none align-middle">{{ group.tools.length }}</span>
                      <Tag v-if="group.error" value="Unavailable" severity="danger" />
                    </div>
                    <p v-if="group.description" class="text-xs text-surface-400 mt-1">{{ group.description }}</p>
                    <p v-if="group.authNote" class="text-xs text-surface-400 mt-1">{{ group.authNote }}</p>
                    <p v-if="group.error" class="text-xs text-red-500 mt-1">{{ group.error }}</p>
                  </div>
                </div>
                <div v-if="group.sections.length > 0" class="mt-4 flex flex-col gap-4">
                  <div v-for="section in group.sections" :key="`${group.key}:${section.label || 'tools'}`" class="flex flex-col gap-2">
                    <div v-if="section.label" class="text-[11px] font-semibold uppercase tracking-wide text-surface-500">{{ section.label }}</div>
                    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label v-for="tool in section.tools" :key="tool.name" class="flex items-start gap-3 rounded-md border border-surface-200 p-3">
                        <Checkbox v-model="selectedToolNames" :inputId="`${group.key}-${tool.name}`" :value="tool.name" />
                        <span class="flex-1">
                          <span class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-medium">{{ tool.label }}</span>
                            <Tag v-if="tool.requiresPermission" value="Write" severity="warn" />
                          </span>
                          <p v-if="tool.description" class="text-xs text-surface-400 mt-1">{{ tool.description }}</p>
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-surface-500">No tools discovered yet.</div>
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
            <span v-if="variableCount > 0" class="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">{{ variableCount }}</span>
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
                    <div v-if="agent.description"><span class="text-surface-500 text-sm">Description</span><p class="text-sm whitespace-pre-wrap">{{ agent.description }}</p></div>
                    <template v-if="agent.sourceType !== 'database'">
                      <div v-if="agent.gitRepoUrl"><span class="text-surface-500 text-sm">Repository</span><p class="font-mono text-sm break-all">{{ agent.gitRepoUrl }}</p></div>
                      <div v-if="agent.gitBranch"><span class="text-surface-500 text-sm">Branch</span><p class="font-mono text-sm">{{ agent.gitBranch }}</p></div>
                      <div v-if="agent.agentFilePath"><span class="text-surface-500 text-sm">Agent File</span><p class="font-mono text-sm">{{ agent.agentFilePath }}</p></div>
                      <div v-if="agent.skillsDirectory"><span class="text-surface-500 text-sm">Skills Directory</span><p class="font-mono text-sm">{{ agent.skillsDirectory }}</p></div>
                      <div>
                        <span class="text-surface-500 text-sm">Git Auth Credential</span>
                        <p v-if="resolvedGitCredential" class="text-sm">
                          <NuxtLink :to="credentialLink(resolvedGitCredential)" class="text-primary hover:underline">{{ resolvedGitCredential.optionLabel }}</NuxtLink>
                        </p>
                        <p v-else class="text-sm text-surface-400 italic">Not configured (falls back to system default)</p>
                      </div>
                    </template>
                  </div>
                </template>
              </Card>
              <Card>
                <template #content>
                  <div class="flex flex-col gap-3">
                    <div>
                      <span class="text-surface-500 text-sm">GitHub Copilot Token / LLM API Key</span>
                      <p v-if="resolvedCopilotCredential" class="text-sm">
                        <NuxtLink :to="credentialLink(resolvedCopilotCredential)" class="text-primary hover:underline">{{ resolvedCopilotCredential.optionLabel }}</NuxtLink>
                      </p>
                      <p v-else class="text-sm text-surface-400 italic">Not configured (falls back to server default)</p>
                    </div>
                    <div><span class="text-surface-500 text-sm">Status</span><p class="font-medium capitalize">{{ agent.status }}</p></div>
                    <div><span class="text-surface-500 text-sm">Scope</span><p class="font-medium capitalize">{{ agent.scope }}</p></div>
                    <div><span class="text-surface-500 text-sm">Selected Tools</span><p class="font-medium">{{ configuredToolCount }} enabled</p></div>
                    <div><span class="text-surface-500 text-sm">Last Session</span><p class="font-medium">{{ agent.lastSessionAt ? new Date(agent.lastSessionAt).toLocaleString() : 'Never' }}</p></div>
                    <div><span class="text-surface-500 text-sm">Created</span><p class="font-medium">{{ new Date(agent.createdAt).toLocaleString() }}</p></div>
                    <div v-if="agent.updatedAt"><span class="text-surface-500 text-sm">Updated</span><p class="font-medium">{{ new Date(agent.updatedAt).toLocaleString() }}</p></div>
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
            <div class="mt-4 flex flex-col gap-6">
              <div class="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Variable priority (highest wins): <strong>Execution</strong> &gt; <strong>Agent</strong> &gt; <strong>Workflow</strong> &gt; <strong>User</strong> &gt; <strong>Workspace</strong>.
                Use <code class="font-mono text-xs bg-blue-100 px-1 rounded" v-pre>{{ properties.KEY }}</code> in prompt templates.
                <div class="mt-1 text-xs text-blue-700">Workflow-scoped variables are configured on each workflow and only apply when this agent runs inside that workflow.</div>
              </div>

              <div>
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-sm font-semibold text-surface-700">Workspace Scope <span class="ml-1 text-xs font-normal text-surface-400">(lowest priority)</span></h3>
                  <NuxtLink :to="`/${ws}/variables`" class="text-xs text-primary hover:underline">Manage workspace variables →</NuxtLink>
                </div>
                <DataTable :value="workspaceVars" size="small" class="text-xs">
                  <template #empty><div class="py-3 text-center text-surface-400">No workspace variables.</div></template>
                  <Column field="key" header="Key" />
                  <Column field="variableType" header="Type" />
                  <Column field="description" header="Description" />
                </DataTable>
              </div>

              <div>
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-sm font-semibold text-surface-700">User Scope</h3>
                  <NuxtLink :to="`/${ws}/variables`" class="text-xs text-primary hover:underline">Manage user variables →</NuxtLink>
                </div>
                <DataTable :value="userVars" size="small" class="text-xs">
                  <template #empty><div class="py-3 text-center text-surface-400">No user variables.</div></template>
                  <Column field="key" header="Key" />
                  <Column field="variableType" header="Type" />
                  <Column field="description" header="Description" />
                </DataTable>
              </div>

              <div>
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-sm font-semibold text-surface-700">Agent Scope <span class="ml-1 text-xs font-normal text-surface-400">(overrides workflow, user, and workspace)</span></h3>
                  <Button label="Add Variable" icon="pi pi-plus" size="small" @click="openCreateAgentVar" />
                </div>

                <div v-if="agentVarFormVisible" class="mb-3 rounded-lg border border-surface-200 bg-surface-50 p-3">
                  <Message v-if="agentVarError" severity="error" :closable="false" class="mb-3">{{ agentVarError }}</Message>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium">Key *</label>
                      <InputText v-model="agentVarForm.key" placeholder="MY_KEY" :disabled="agentVarEditMode" class="font-mono text-sm" />
                    </div>
                    <div class="flex flex-col gap-1">
                      <label class="text-xs font-medium">Type</label>
                      <Select v-model="agentVarForm.variableType" :options="agentVarTypeOptions" optionLabel="label" optionValue="value" />
                    </div>
                    <div v-if="agentVarForm.variableType === 'credential'" class="flex flex-col gap-1 md:col-span-2">
                      <label class="text-xs font-medium">Credential Sub-Type</label>
                      <Select v-model="agentVarForm.credentialSubType" :options="credentialSubTypeOptions" optionLabel="label" optionValue="value" />
                    </div>
                    <div class="flex flex-col gap-1 md:col-span-2">
                      <label class="text-xs font-medium">{{ agentVarEditMode ? 'New Value' : 'Value' }}{{ agentVarEditMode ? '' : ' *' }}</label>
                      <Textarea v-model="agentVarForm.value" rows="4" :placeholder="agentVarEditMode ? 'Leave empty to keep the current stored value' : 'Stored encrypted'" />
                    </div>
                    <div class="flex flex-col gap-1 md:col-span-2">
                      <label class="text-xs font-medium">Description</label>
                      <InputText v-model="agentVarForm.description" placeholder="Optional description" />
                    </div>
                    <div class="md:col-span-2 flex items-center gap-2">
                      <Checkbox v-model="agentVarForm.injectAsEnvVariable" :binary="true" inputId="agentInjectEnv" />
                      <label for="agentInjectEnv" class="text-sm">Inject as environment variable</label>
                    </div>
                  </div>
                  <div class="mt-3 flex justify-end gap-2">
                    <Button label="Cancel" severity="secondary" size="small" @click="closeAgentVarForm" />
                    <Button label="Save" icon="pi pi-check" size="small" :loading="savingAgentVar" @click="handleSaveAgentVar" />
                  </div>
                </div>

                <DataTable :value="agentVars" size="small" class="text-xs">
                  <template #empty><div class="py-3 text-center text-surface-400">No agent variables. Click Add Variable to create one.</div></template>
                  <Column field="key" header="Key">
                    <template #body="{ data }"><code class="font-mono">{{ data.key }}</code></template>
                  </Column>
                  <Column header="Version" style="width: 90px">
                    <template #body="{ data }"><Tag :value="`v${data.version || 1}`" severity="secondary" /></template>
                  </Column>
                  <Column field="variableType" header="Type" style="width: 110px" />
                  <Column field="credentialSubType" header="Sub-Type" style="width: 160px">
                    <template #body="{ data }"><span>{{ data.variableType === 'credential' ? data.credentialSubType || 'secret_text' : '—' }}</span></template>
                  </Column>
                  <Column field="description" header="Description" />
                  <Column header="Inject ENV" style="width: 110px">
                    <template #body="{ data }"><Tag :value="data.injectAsEnvVariable ? 'Yes' : 'No'" :severity="data.injectAsEnvVariable ? 'success' : 'secondary'" /></template>
                  </Column>
                  <Column header="" style="width: 120px">
                    <template #body="{ data }">
                      <div class="flex gap-1">
                        <Button icon="pi pi-pencil" text size="small" @click="startEditAgentVar(data)" />
                        <Button icon="pi pi-times" text severity="danger" size="small" @click="handleDeleteAgentVar(data)" />
                      </div>
                    </template>
                  </Column>
                </DataTable>
              </div>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
    <div v-else class="text-center py-12 text-surface-400">Loading agent...</div>
  </div>
</template>

<script setup lang="ts">
import {
  buildExplicitAgentToolSelection,
  countAgentSelectedTools,
  extractAgentSelectedToolNames,
} from '~/composables/useAgentToolSelection';

const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const confirm = useConfirm();
const ws = computed(() => (route.params.workspace as string) || 'default');
const agentId = computed(() => route.params.id as string);
const isHistoricalVersionRoute = computed(() => Boolean(route.params.version));
const { buildCredentialOptions, filterGitAuthCredentialOptions, filterCopilotCredentialOptions, findCredentialOption } = useAgentCredentialOptions();

const agentTabs = ['overview', 'files', 'variables'];
const activeTab = ref<string | number>(agentTabs.includes(route.query.tab as string) ? route.query.tab as string : 'overview');
const editing = ref(false);
const editError = ref('');
const savingEdit = ref(false);
const configuredToolCount = computed(() => countAgentSelectedTools(agent.value?.builtinToolsEnabled));

type ToolCatalogSource = 'builtin' | 'platform' | 'stored_mcp' | 'template_mcp';

interface ToolCatalogTool {
  name: string;
  label?: string;
  description?: string;
  group?: string | null;
  requiresPermission?: boolean;
}

interface ToolCatalogGroup {
  key: string;
  label: string;
  source: ToolCatalogSource;
  description?: string | null;
  authNote?: string | null;
  error?: string;
  tools: ToolCatalogTool[];
}

interface ToolCatalogResponse {
  selectionMode: 'legacy' | 'explicit';
  effectiveSelectedToolNames: string[];
  unresolvedSelectedToolNames: string[];
  groups: ToolCatalogGroup[];
}

const toolCatalog = ref<ToolCatalogResponse | null>(null);
const toolCatalogPending = ref(false);
const toolCatalogError = ref('');
const selectedToolNames = ref<string[]>([]);
const initialSelectedToolNames = ref<string[]>([]);
const initialToolSelectionPayload = ref<unknown>([]);
const toolCatalogRequestId = ref(0);
const toolCatalogRefreshTimer = ref<ReturnType<typeof setTimeout> | null>(null);

const toolCatalogHasErrors = computed(() => (toolCatalog.value?.groups ?? []).some((group) => Boolean(group.error)));
const toolCatalogUnresolved = computed(() => toolCatalog.value?.unresolvedSelectedToolNames ?? []);
const toolSelectionDirty = computed(() => {
  const current = [...selectedToolNames.value].sort();
  const initial = [...initialSelectedToolNames.value].sort();
  return JSON.stringify(current) !== JSON.stringify(initial);
});

const toolCatalogGroups = computed(() => {
  const builtinGroupOrder = ['Workflow', 'Knowledge', 'Variables', 'Network'];

  return (toolCatalog.value?.groups ?? []).map((group) => {
    const tools = (group.tools ?? []).map((tool) => ({
      name: tool.name,
      label: tool.label || formatToolName(tool.name),
      description: tool.description || '',
      group: tool.group || null,
      requiresPermission: Boolean(tool.requiresPermission),
    }));

    const sections = group.source === 'builtin'
      ? builtinGroupOrder
          .map((sectionLabel) => ({
            label: sectionLabel,
            tools: tools.filter((tool) => tool.group === sectionLabel),
          }))
          .filter((section) => section.tools.length > 0)
      : [{ label: null, tools }];

    return {
      ...group,
      tools,
      sections,
      sourceLabel: sourceLabel(group.source),
      sourceSeverity: sourceSeverity(group.source),
    };
  });
});

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
const variableCount = computed(() => workspaceVars.value.length + userVars.value.length + agentVars.value.length);
const credentialOptions = computed(() => buildCredentialOptions([
  { scope: 'agent', scopeLabel: 'Agent', variables: agentVars.value },
  { scope: 'user', scopeLabel: 'User', variables: userVars.value },
  { scope: 'workspace', scopeLabel: 'Workspace', variables: workspaceVars.value },
]));
const gitCredOptions = computed(() => filterGitAuthCredentialOptions(credentialOptions.value, editForm.githubTokenCredentialId));
const modelAuthCredOptions = computed(() => filterCopilotCredentialOptions(credentialOptions.value, editForm.copilotTokenCredentialId));
const resolvedCopilotCredential = computed(() => findCredentialOption(credentialOptions.value, agent.value?.copilotTokenCredentialId));
const resolvedGitCredential = computed(() => findCredentialOption(credentialOptions.value, agent.value?.githubTokenCredentialId));

const agentVarFormVisible = ref(false);
const agentVarEditMode = ref(false);
const savingAgentVar = ref(false);
const agentVarError = ref('');
const agentVarTypeOptions = [
  { label: 'Credential', value: 'credential' },
  { label: 'Property', value: 'property' },
];
const credentialSubTypeOptions = [
  { label: 'Secret Text', value: 'secret_text' },
  { label: 'GitHub Token', value: 'github_token' },
  { label: 'GitHub App', value: 'github_app' },
  { label: 'User Account', value: 'user_account' },
  { label: 'Private Key', value: 'private_key' },
  { label: 'Certificate', value: 'certificate' },
];
const agentVarForm = reactive({
  id: '',
  key: '',
  value: '',
  variableType: 'credential',
  credentialSubType: 'secret_text',
  description: '',
  injectAsEnvVariable: false,
});

watch(() => route.query.tab, (tab) => {
  const nextTab = typeof tab === 'string' && agentTabs.includes(tab) ? tab : 'overview';
  if (nextTab !== activeTab.value) activeTab.value = nextTab;
});

watch(activeTab, (tab) => {
  const nextQuery = { ...route.query } as Record<string, string | string[] | undefined>;
  if (tab === 'overview') delete nextQuery.tab;
  else nextQuery.tab = String(tab);
  router.replace({ query: nextQuery });
});

function credentialLink(option?: { scope?: string; id?: string } | null) {
  if (!option?.scope || !option?.id) return `/${ws.value}/variables`;
  if (option.scope === 'agent') return `/${ws.value}/agents/${agentId.value}?tab=variables`;
  return `/${ws.value}/variables/${option.scope}/${option.id}`;
}

function resetAgentVarForm() {
  Object.assign(agentVarForm, {
    id: '',
    key: '',
    value: '',
    variableType: 'credential',
    credentialSubType: 'secret_text',
    description: '',
    injectAsEnvVariable: false,
  });
  agentVarEditMode.value = false;
  agentVarError.value = '';
}

function closeAgentVarForm() {
  agentVarFormVisible.value = false;
  resetAgentVarForm();
}

function openCreateAgentVar() {
  resetAgentVarForm();
  agentVarFormVisible.value = true;
}

function startEditAgentVar(variable: any) {
  Object.assign(agentVarForm, {
    id: variable.id,
    key: variable.key,
    value: '',
    variableType: variable.variableType || 'credential',
    credentialSubType: variable.credentialSubType || 'secret_text',
    description: variable.description || '',
    injectAsEnvVariable: variable.injectAsEnvVariable === true,
  });
  agentVarEditMode.value = true;
  agentVarError.value = '';
  agentVarFormVisible.value = true;
}

async function handleSaveAgentVar() {
  agentVarError.value = '';

  if (!agentVarForm.key.trim()) {
    agentVarError.value = 'A variable key is required.';
    return;
  }

  if (!agentVarEditMode.value && !agentVarForm.value.trim()) {
    agentVarError.value = 'A variable value is required.';
    return;
  }

  savingAgentVar.value = true;
  try {
    if (agentVarEditMode.value) {
      const body: Record<string, unknown> = {
        scope: 'agent',
        variableType: agentVarForm.variableType,
        credentialSubType: agentVarForm.credentialSubType,
        description: agentVarForm.description.trim() || undefined,
        injectAsEnvVariable: agentVarForm.injectAsEnvVariable,
      };
      if (agentVarForm.value.trim()) body.value = agentVarForm.value;

      await $fetch(`/api/variables/${agentVarForm.id}`, { method: 'PUT', headers, body });
      toast.add({ severity: 'success', summary: 'Saved', detail: 'Agent variable updated', life: 3000 });
    } else {
      await $fetch('/api/variables', {
        method: 'POST',
        headers,
        body: {
          scope: 'agent',
          agentId: agentId.value,
          key: agentVarForm.key.trim(),
          value: agentVarForm.value,
          variableType: agentVarForm.variableType,
          credentialSubType: agentVarForm.credentialSubType,
          description: agentVarForm.description.trim() || undefined,
          injectAsEnvVariable: agentVarForm.injectAsEnvVariable,
        },
      });
      toast.add({ severity: 'success', summary: 'Created', detail: 'Agent variable added', life: 3000 });
    }

    closeAgentVarForm();
    await Promise.all([refreshVars(), refreshAgent(), refreshAgentVersions()]);
  } catch (e: any) {
    agentVarError.value = e?.data?.error || 'Failed to save agent variable.';
  } finally {
    savingAgentVar.value = false;
  }
}

function handleDeleteAgentVar(variable: any) {
  confirm.require({
    message: `Delete variable "${variable.key}"?`,
    header: 'Confirm',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/variables/${variable.id}?scope=agent`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', detail: 'Agent variable removed', life: 3000 });
      await Promise.all([refreshVars(), refreshAgent(), refreshAgentVersions()]);
    },
  });
}

// Edit form
const editForm = reactive({
  name: '', description: '', gitRepoUrl: '', gitBranch: '', agentFilePath: '', skillsDirectory: '',
  githubTokenCredentialId: null as string | null,
  copilotTokenCredentialId: null as string | null,
  mcpJsonTemplate: '',
});

function formatToolName(t: string) { return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

function sourceLabel(source: ToolCatalogSource) {
  return {
    builtin: 'Built-in',
    platform: 'OAO Platform',
    stored_mcp: 'Stored MCP',
    template_mcp: 'Template MCP',
  }[source];
}

function sourceSeverity(source: ToolCatalogSource) {
  return {
    builtin: 'info',
    platform: 'success',
    stored_mcp: 'secondary',
    template_mcp: 'warn',
  }[source];
}

function applyToolSelectionSnapshot(names: string[]) {
  const normalizedNames = Array.from(new Set(names)).sort((left, right) => left.localeCompare(right));
  selectedToolNames.value = normalizedNames;
  initialSelectedToolNames.value = [...normalizedNames];
}

async function refreshToolCatalog(immediate = false) {
  if (!editing.value || !agent.value) return;

  if (toolCatalogRefreshTimer.value) {
    clearTimeout(toolCatalogRefreshTimer.value);
    toolCatalogRefreshTimer.value = null;
  }

  if (!immediate) {
    toolCatalogRefreshTimer.value = setTimeout(() => {
      void refreshToolCatalog(true);
    }, 500);
    return;
  }

  const requestId = ++toolCatalogRequestId.value;
  toolCatalogPending.value = true;
  toolCatalogError.value = '';

  try {
    const catalog = await $fetch<ToolCatalogResponse>(`/api/agents/${agentId.value}/tool-catalog`, {
      method: 'POST',
      headers,
      body: {
        mcpJsonTemplate: editForm.mcpJsonTemplate.trim() ? editForm.mcpJsonTemplate : null,
      },
    });

    if (requestId !== toolCatalogRequestId.value) return;
    toolCatalog.value = catalog;

    if (!toolSelectionDirty.value) {
      applyToolSelectionSnapshot(catalog.effectiveSelectedToolNames);
    }
  } catch (e: any) {
    if (requestId !== toolCatalogRequestId.value) return;
    toolCatalogError.value = e?.data?.error || 'Failed to inspect the tool catalog.';
  } finally {
    if (requestId === toolCatalogRequestId.value) {
      toolCatalogPending.value = false;
    }
  }
}

watch(agent, (a) => {
  if (a) Object.assign(editForm, {
    name: a.name, description: a.description || '', gitRepoUrl: a.gitRepoUrl || '',
    gitBranch: a.gitBranch || '', agentFilePath: a.agentFilePath || '', skillsDirectory: a.skillsDirectory || '',
    githubTokenCredentialId: a.githubTokenCredentialId || null,
    copilotTokenCredentialId: a.copilotTokenCredentialId || null,
    mcpJsonTemplate: a.mcpJsonTemplate || '',
  });
  initialToolSelectionPayload.value = a?.builtinToolsEnabled ?? [];
  applyToolSelectionSnapshot(extractAgentSelectedToolNames(a?.builtinToolsEnabled));
  toolCatalog.value = null;
  toolCatalogError.value = '';
}, { immediate: true });

watch(editing, (isEditing) => {
  if (isEditing) {
    void refreshToolCatalog(true);
    return;
  }

  if (toolCatalogRefreshTimer.value) {
    clearTimeout(toolCatalogRefreshTimer.value);
    toolCatalogRefreshTimer.value = null;
  }
});

watch(() => editForm.mcpJsonTemplate, () => {
  if (!editing.value) return;
  void refreshToolCatalog(false);
});

onBeforeUnmount(() => {
  if (toolCatalogRefreshTimer.value) {
    clearTimeout(toolCatalogRefreshTimer.value);
  }
});

async function handleSaveEdit() {
  editError.value = '';
  savingEdit.value = true;
  try {
    if (toolSelectionDirty.value && (toolCatalogError.value || toolCatalogHasErrors.value)) {
      editError.value = 'Resolve tool catalog errors before saving tool selection changes.';
      return;
    }

    const body: Record<string, unknown> = {
      name: editForm.name.trim(),
      description: editForm.description.trim(),
      builtinToolsEnabled: toolSelectionDirty.value
        ? buildExplicitAgentToolSelection(selectedToolNames.value)
        : initialToolSelectionPayload.value,
      mcpJsonTemplate: editForm.mcpJsonTemplate.trim() ? editForm.mcpJsonTemplate : null,
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
      body.githubTokenCredentialId = editForm.githubTokenCredentialId || null;
    }

    body.copilotTokenCredentialId = editForm.copilotTokenCredentialId || null;

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
</script>
