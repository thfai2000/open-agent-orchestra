<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href="/agents">Agents</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>{{ agent?.name || 'Agent' }}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div v-if="agent" class="space-y-6 mt-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold">{{ agent.name }}</h1>
          <p v-if="agent.description && !editing" class="text-muted-foreground mt-1">{{ agent.description }}</p>
        </div>
        <div class="flex items-center gap-3">
          <Button v-if="!editing" @click="startEdit">✏️ Edit Agent</Button>
          <Button variant="outline" @click="toggleStatus"
            :class="agent.status === 'active' ? 'border-yellow-500 text-yellow-600' : 'border-green-500 text-green-600'">
            {{ agent.status === 'active' ? 'Pause' : 'Activate' }}
          </Button>
          <Button variant="destructive" size="sm" @click="handleDelete">Delete</Button>
          <Badge :variant="agent.status === 'active' ? 'default' : agent.status === 'paused' ? 'secondary' : 'destructive'">
            {{ agent.status }}
          </Badge>
          <Badge v-if="agent.scope === 'workspace'" variant="outline">Workspace</Badge>
          <Badge v-else variant="outline" class="text-muted-foreground">Personal</Badge>
        </div>
      </div>

      <!-- Inline Edit Form -->
      <Card v-if="editing" class="border-primary/30">
        <CardHeader><CardTitle>Edit Agent</CardTitle></CardHeader>
        <CardContent>
          <div v-if="editError" class="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ editError }}</div>
          <form @submit.prevent="handleSave" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label>Name *</Label>
                <Input v-model="editForm.name" required />
              </div>
              <div class="space-y-2">
                <Label>Git Repository URL *</Label>
                <Input v-model="editForm.gitRepoUrl" type="url" required />
              </div>
              <div class="space-y-2">
                <Label>Git Branch</Label>
                <Input v-model="editForm.gitBranch" />
              </div>
              <div class="space-y-2">
                <Label>Agent File Path *</Label>
                <Input v-model="editForm.agentFilePath" required />
              </div>
            </div>
            <div class="space-y-2">
              <Label>Description</Label>
              <Textarea v-model="editForm.description" rows="2" />
            </div>
            <div class="space-y-2">
              <Label>GitHub Token (leave blank to keep current)</Label>
              <Input v-model="editForm.githubToken" type="password" class="max-w-md" placeholder="ghp_..." />
            </div>
            <div class="flex gap-3 pt-2">
              <Button type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Save Changes' }}</Button>
              <Button variant="outline" type="button" @click="editing = false">Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <!-- View Configuration -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle class="text-base">Configuration</CardTitle></CardHeader>
          <CardContent>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between"><dt class="text-muted-foreground">Git Repo</dt><dd class="font-mono text-xs truncate max-w-[250px]">{{ agent.gitRepoUrl }}</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Branch</dt><dd class="font-mono text-xs">{{ agent.gitBranch || 'main' }}</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Agent File</dt><dd class="font-mono text-xs">{{ agent.agentFilePath }}</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Last Session</dt><dd>{{ agent.lastSessionAt ? new Date(agent.lastSessionAt).toLocaleString() : 'Never' }}</dd></div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle class="text-base">Info</CardTitle></CardHeader>
          <CardContent>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between"><dt class="text-muted-foreground">ID</dt><dd class="font-mono text-xs">{{ agent.id?.substring(0, 8) }}…</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Scope</dt><dd><Badge :variant="agent.scope === 'workspace' ? 'default' : 'secondary'">{{ agent.scope === 'workspace' ? 'Workspace' : 'Personal' }}</Badge></dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Created</dt><dd>{{ new Date(agent.createdAt).toLocaleDateString() }}</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Updated</dt><dd>{{ new Date(agent.updatedAt).toLocaleDateString() }}</dd></div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <!-- Built-in Tools Section -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Built-in Tools</CardTitle>
              <CardDescription>Toggle which built-in tools this agent can use during Copilot sessions.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label v-for="tool in BUILTIN_TOOLS" :key="tool.name"
              class="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-muted/50 cursor-pointer">
              <Checkbox :checked="isToolEnabled(tool.name)" @update:checked="toggleBuiltinTool(tool.name, $event)" />
              <div>
                <p class="text-sm font-medium">{{ tool.label }}</p>
                <p class="text-xs text-muted-foreground">{{ tool.description }}</p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      <!-- Agent Variables Section -->
      <Card>
        <CardHeader>
          <div class="flex items-center justify-between">
            <div>
              <CardTitle>Agent Variables</CardTitle>
              <CardDescription>Agent-level variables available to all workflow steps using this agent. They override user-level variables with the same key.</CardDescription>
            </div>
            <Button size="sm" @click="showVarForm = true">+ Add Variable</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="showVarForm" class="mb-4 p-4 rounded-lg border border-border bg-muted/30">
            <div v-if="varError" class="mb-3 p-2 rounded-md bg-destructive/10 text-destructive text-sm">{{ varError }}</div>
            <form @submit.prevent="handleAddVar" class="space-y-3">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <Label class="text-xs">Key (UPPER_SNAKE_CASE) *</Label>
                  <Input v-model="varForm.key" required pattern="^[A-Z_][A-Z0-9_]*$" class="font-mono" placeholder="API_KEY" />
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Value *</Label>
                  <Input v-model="varForm.value" type="password" required placeholder="Secret value (encrypted at rest)" />
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <Label class="text-xs">Type *</Label>
                  <select v-model="varForm.variableType"
                    class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                    <option value="credential">Credential (secret, masked)</option>
                    <option value="property">Property (can be used in prompts)</option>
                  </select>
                </div>
                <div class="space-y-1.5">
                  <Label class="text-xs">Description</Label>
                  <Input v-model="varForm.description" placeholder="What is this variable for?" />
                </div>
              </div>
              <div class="flex items-center gap-3">
                <Switch :checked="varForm.injectAsEnvVariable" @update:checked="varForm.injectAsEnvVariable = $event" />
                <Label class="text-xs">Inject as .env variable in Copilot session workspace</Label>
              </div>
              <div v-if="varForm.variableType === 'property'" class="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300">
                💡 <strong>Tip:</strong> Properties can be referenced in agent prompt templates using <code class="bg-blue-100 dark:bg-blue-900 px-1 rounded">{{ propertyHint }}</code>
              </div>
              <div class="flex gap-2">
                <Button type="submit" size="sm" :disabled="savingVar">{{ savingVar ? 'Saving...' : 'Save Variable' }}</Button>
                <Button variant="outline" size="sm" type="button" @click="showVarForm = false">Cancel</Button>
              </div>
            </form>
          </div>

          <div class="space-y-2">
            <div v-for="v in agentVariables" :key="v.id"
              class="p-3 rounded-lg border border-border flex items-center justify-between">
              <div class="flex items-center gap-3">
                <Badge :variant="v.variableType === 'credential' ? 'destructive' : 'secondary'" class="text-[10px]">{{ v.variableType }}</Badge>
                <div>
                  <p class="font-mono font-semibold text-sm">{{ v.key }}</p>
                  <p v-if="v.description" class="text-xs text-muted-foreground">{{ v.description }}</p>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <Badge v-if="v.injectAsEnvVariable" variant="outline" class="text-[10px]">.env</Badge>
                <span class="text-xs text-muted-foreground font-mono">••••••••</span>
                <Button variant="ghost" size="sm" class="text-destructive h-7 text-xs" @click="handleDeleteVar(v.id, v.key)">Delete</Button>
              </div>
            </div>
            <p v-if="agentVariables.length === 0 && !showVarForm" class="text-muted-foreground text-sm">No agent-level variables stored.</p>
          </div>
        </CardContent>
      </Card>

      <!-- MCP Servers Section -->
      <Card>
        <CardHeader><CardTitle>MCP Servers</CardTitle></CardHeader>
        <CardContent>
          <div v-for="mcp in mcpServers" :key="mcp.id" class="p-3 rounded-lg border border-border mb-2 flex items-center justify-between">
            <div>
              <p class="font-semibold text-sm">{{ mcp.name }}</p>
              <p v-if="mcp.description" class="text-xs text-muted-foreground">{{ mcp.description }}</p>
              <p class="text-xs text-muted-foreground font-mono mt-1">{{ mcp.command }} {{ (mcp.args || []).join(' ') }}</p>
            </div>
            <Badge :variant="mcp.isEnabled ? 'default' : 'secondary'">{{ mcp.isEnabled ? 'Enabled' : 'Disabled' }}</Badge>
          </div>
          <p v-if="mcpServers.length === 0" class="text-muted-foreground text-sm">No MCP servers configured.</p>
        </CardContent>
      </Card>

      <!-- Plugins Section -->
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Plugins</CardTitle>
            <CardDescription>Enable or disable available plugins for this agent. Plugins add tools, skills, and MCP servers to Copilot sessions.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div v-if="pluginsLoading" class="text-muted-foreground text-sm">Loading plugins...</div>
          <div class="space-y-2">
            <div v-for="p in agentPlugins" :key="p.id"
              class="p-3 rounded-lg border border-border flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div>
                  <p class="font-semibold text-sm">{{ p.name }}</p>
                  <p v-if="p.description" class="text-xs text-muted-foreground">{{ p.description }}</p>
                  <div class="flex gap-2 mt-1">
                    <Badge v-if="(p.manifestCache as any)?.tools?.length" variant="outline" class="text-[10px]">
                      {{ (p.manifestCache as any).tools.length }} tools
                    </Badge>
                    <Badge v-if="(p.manifestCache as any)?.skills?.length" variant="outline" class="text-[10px]">
                      {{ (p.manifestCache as any).skills.length }} skills
                    </Badge>
                    <Badge v-if="(p.manifestCache as any)?.mcpServers?.length" variant="outline" class="text-[10px]">
                      {{ (p.manifestCache as any).mcpServers.length }} MCP servers
                    </Badge>
                  </div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <Switch :checked="p.isEnabled" @update:checked="togglePlugin(p.id, $event)" />
                <Badge :variant="p.isEnabled ? 'default' : 'secondary'" class="w-16 justify-center">
                  {{ p.isEnabled ? 'On' : 'Off' }}
                </Badge>
              </div>
            </div>
          </div>
          <p v-if="agentPlugins.length === 0 && !pluginsLoading" class="text-muted-foreground text-sm">
            No plugins available. Admin must register and allow plugins first.
          </p>
        </CardContent>
      </Card>
    </div>
    <p v-else class="text-muted-foreground mt-4">Agent not found.</p>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const ws = computed(() => (route.params.workspace as string) || 'default');
const agentId = route.params.id as string;

const BUILTIN_TOOLS = [
  { name: 'schedule_next_wakeup', label: 'Schedule Next Wakeup', description: 'Self-scheduling via cron triggers' },
  { name: 'manage_webhook_trigger', label: 'Manage Webhook Trigger', description: 'Webhook lifecycle management' },
  { name: 'record_decision', label: 'Record Decision', description: 'Audit trail for agent decisions' },
  { name: 'memory_store', label: 'Memory Store', description: 'Store semantic memories (pgvector)' },
  { name: 'memory_retrieve', label: 'Memory Retrieve', description: 'Retrieve memories via similarity search' },
  { name: 'edit_workflow', label: 'Edit Workflow', description: 'Edit triggers and steps' },
  { name: 'read_variables', label: 'Read Variables', description: 'Read properties and credentials' },
  { name: 'edit_variables', label: 'Edit Variables', description: 'Create/update/delete variables' },
];

const { data: agentData, refresh: refreshAgent } = await useFetch(`/api/agents/${agentId}`, { headers });
const { data: varData, refresh: refreshVars } = await useFetch(`/api/variables?agentId=${agentId}`, { headers });
const { data: mcpData } = await useFetch(`/api/mcp-servers?agentId=${agentId}`, { headers });
const { data: pluginData, pending: pluginsLoading, refresh: refreshPlugins } = await useFetch(`/api/plugins/agent/${agentId}`, { headers });

const agent = computed(() => agentData.value?.agent);
const agentVariables = computed(() => varData.value?.variables ?? []);
const mcpServers = computed(() => mcpData.value?.servers ?? []);
const agentPlugins = computed(() => (pluginData.value as any)?.plugins ?? []);

// ── Inline Edit ─────────────────────────────────────────────────
const editing = ref(false);
const saving = ref(false);
const editError = ref('');
const editForm = reactive({ name: '', description: '', gitRepoUrl: '', gitBranch: '', agentFilePath: '', githubToken: '' });

function startEdit() {
  Object.assign(editForm, {
    name: agent.value?.name || '', description: agent.value?.description || '',
    gitRepoUrl: agent.value?.gitRepoUrl || '', gitBranch: agent.value?.gitBranch || 'main',
    agentFilePath: agent.value?.agentFilePath || '', githubToken: '',
  });
  editError.value = '';
  editing.value = true;
}

async function handleSave() {
  editError.value = '';
  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      name: editForm.name, description: editForm.description || undefined,
      gitRepoUrl: editForm.gitRepoUrl, gitBranch: editForm.gitBranch, agentFilePath: editForm.agentFilePath,
    };
    if (editForm.githubToken) body.githubToken = editForm.githubToken;
    await $fetch(`/api/agents/${agentId}`, { method: 'PUT', headers, body });
    editing.value = false;
    await refreshAgent();
  } catch (e: any) { editError.value = e?.data?.error || 'Failed to save agent'; }
  finally { saving.value = false; }
}

async function toggleStatus() {
  const newStatus = agent.value?.status === 'active' ? 'paused' : 'active';
  try { await $fetch(`/api/agents/${agentId}`, { method: 'PUT', headers, body: { status: newStatus } }); await refreshAgent(); }
  catch { alert('Failed to update agent status'); }
}

async function handleDelete() {
  if (!confirm(`Delete agent "${agent.value?.name}"? This cannot be undone.`)) return;
  try { await $fetch(`/api/agents/${agentId}`, { method: 'DELETE', headers }); router.push(`/${ws.value}/agents`); }
  catch { alert('Failed to delete agent'); }
}

// ── Variable management ─────────────────────────────────────────
const showVarForm = ref(false);
const savingVar = ref(false);
const varError = ref('');
const varForm = reactive({ key: '', value: '', description: '', variableType: 'credential' as string, injectAsEnvVariable: false });
const propertyHint = computed(() => `{{ Properties.${varForm.key || 'KEY_NAME'} }}`);

async function handleAddVar() {
  varError.value = '';
  savingVar.value = true;
  try {
    await $fetch('/api/variables', {
      method: 'POST', headers,
      body: { agentId, key: varForm.key, value: varForm.value, description: varForm.description || undefined, variableType: varForm.variableType, injectAsEnvVariable: varForm.injectAsEnvVariable },
    });
    showVarForm.value = false;
    Object.assign(varForm, { key: '', value: '', description: '', variableType: 'credential', injectAsEnvVariable: false });
    await refreshVars();
  } catch (e: any) { varError.value = e?.data?.error || 'Failed to save variable'; }
  finally { savingVar.value = false; }
}

async function handleDeleteVar(id: string, key: string) {
  if (!confirm(`Delete variable "${key}"?`)) return;
  try { await $fetch(`/api/variables/${id}`, { method: 'DELETE', headers }); await refreshVars(); }
  catch { alert('Failed to delete variable'); }
}

// ── Plugin management ───────────────────────────────────────────
async function togglePlugin(pluginId: string, enabled: boolean) {
  try {
    await $fetch(`/api/plugins/agent/${agentId}/${pluginId}`, {
      method: 'PUT',
      headers,
      body: { isEnabled: enabled },
    });
    await refreshPlugins();
  } catch {
    alert('Failed to update plugin');
  }
}

// ── Built-in Tools management ───────────────────────────────────
function isToolEnabled(name: string): boolean {
  const enabled = (agent.value as any)?.builtinToolsEnabled;
  if (!enabled || !Array.isArray(enabled)) return true; // default: all enabled
  return enabled.includes(name);
}

async function toggleBuiltinTool(name: string, checked: boolean | string) {
  const current: string[] = Array.isArray((agent.value as any)?.builtinToolsEnabled)
    ? [...(agent.value as any).builtinToolsEnabled]
    : BUILTIN_TOOLS.map(t => t.name);
  const updated = checked
    ? [...new Set([...current, name])]
    : current.filter(t => t !== name);
  try {
    await $fetch(`/api/agents/${agentId}`, { method: 'PUT', headers, body: { builtinToolsEnabled: updated } });
    await refreshAgent();
  } catch {
    alert('Failed to update built-in tools');
  }
}
</script>
