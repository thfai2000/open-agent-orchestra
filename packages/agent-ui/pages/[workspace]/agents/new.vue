<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href="/agents">Agents</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>New Agent</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <h1 class="text-3xl font-bold mt-4 mb-6">Create New Agent</h1>

    <div class="max-w-3xl space-y-6">
      <div v-if="formError" class="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ formError }}</div>

      <form @submit.prevent="handleSubmit" class="space-y-6">
        <!-- Basic Info -->
        <Card>
          <CardHeader><CardTitle>Basic Info</CardTitle></CardHeader>
          <CardContent class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label for="name">Name *</Label>
                <Input id="name" v-model="form.name" required placeholder="My Agent" />
              </div>
              <div class="space-y-2">
                <Label>Scope</Label>
                <select v-model="form.scope"
                  class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="user">Personal (owned by you)</option>
                  <option v-if="isAdmin" value="workspace">Workspace (shared, admin-managed)</option>
                </select>
              </div>
            </div>
            <div class="space-y-2">
              <Label for="description">Description</Label>
              <Textarea id="description" v-model="form.description" rows="2" placeholder="What does this agent do?" />
            </div>
          </CardContent>
        </Card>

        <!-- Agent Source -->
        <Card>
          <CardHeader>
            <CardTitle>Agent Files Source</CardTitle>
            <CardDescription>Choose how the agent's instruction and skill files are provided.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <label
                :class="['flex flex-col items-center gap-2 p-4 rounded-lg border-2 cursor-pointer transition',
                  form.sourceType === 'github_repo' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50']"
                @click="form.sourceType = 'github_repo'">
                <span class="text-2xl">🐙</span>
                <span class="font-medium text-sm">GitHub Repository</span>
                <span class="text-xs text-muted-foreground text-center">Clone agent files from a Git repository</span>
              </label>
              <label
                :class="['flex flex-col items-center gap-2 p-4 rounded-lg border-2 cursor-pointer transition',
                  form.sourceType === 'database' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50']"
                @click="form.sourceType = 'database'">
                <span class="text-2xl">💾</span>
                <span class="font-medium text-sm">Database Storage</span>
                <span class="text-xs text-muted-foreground text-center">Create and edit agent files directly in the platform</span>
              </label>
            </div>

            <!-- GitHub Repo Fields -->
            <div v-if="form.sourceType === 'github_repo'" class="space-y-4 pt-2">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label>Git Repository URL *</Label>
                  <Input v-model="form.gitRepoUrl" type="url" required placeholder="https://github.com/user/repo" />
                </div>
                <div class="space-y-2">
                  <Label>Git Branch</Label>
                  <Input v-model="form.gitBranch" placeholder="main" />
                </div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label>Agent File Path *</Label>
                  <Input v-model="form.agentFilePath" required placeholder=".github/agents/trading.md" />
                </div>
                <div class="space-y-2">
                  <Label>Skills Directory</Label>
                  <Input v-model="form.skillsDirectory" placeholder="skills/" />
                  <p class="text-xs text-muted-foreground">Loads all .md files from this directory as skills.</p>
                </div>
              </div>
              <div class="space-y-2">
                <Label>GitHub Token (optional, encrypted at rest)</Label>
                <Input v-model="form.githubToken" type="password" class="max-w-md" placeholder="ghp_..." />
              </div>
            </div>

            <!-- Database Source Info -->
            <div v-if="form.sourceType === 'database'" class="p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
              <p>💡 After creating the agent, you can manage agent files (instructions, skills) directly from the agent detail page using the built-in file editor.</p>
            </div>
          </CardContent>
        </Card>

        <!-- Built-in Tools -->
        <Card>
          <CardHeader>
            <CardTitle>Built-in Tools</CardTitle>
            <CardDescription>Select which built-in tools this agent can use during Copilot sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label v-for="tool in BUILTIN_TOOLS" :key="tool.name" class="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-muted/50 cursor-pointer">
                <Checkbox :checked="form.builtinToolsEnabled.includes(tool.name)" @update:checked="toggleTool(tool.name, $event)" />
                <div>
                  <p class="text-sm font-medium">{{ tool.label }}</p>
                  <p class="text-xs text-muted-foreground">{{ tool.description }}</p>
                </div>
              </label>
            </div>
          </CardContent>
        </Card>

        <!-- Plugins (optional at creation, can be toggled on detail page) -->
        <Card v-if="availablePlugins.length > 0">
          <CardHeader>
            <CardTitle>Plugins</CardTitle>
            <CardDescription>Enable plugins for this agent. You can also manage plugins from the agent detail page after creation.</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="space-y-2">
              <div v-for="p in availablePlugins" :key="p.id"
                class="p-3 rounded-lg border border-border flex items-center justify-between">
                <div>
                  <p class="font-semibold text-sm">{{ p.name }}</p>
                  <p v-if="p.description" class="text-xs text-muted-foreground">{{ p.description }}</p>
                </div>
                <Switch :checked="form.enabledPlugins.includes(p.id)" @update:checked="togglePlugin(p.id, $event)" />
              </div>
            </div>
          </CardContent>
        </Card>

        <div class="flex gap-3">
          <Button type="submit" :disabled="submitting">
            {{ submitting ? 'Creating...' : 'Create Agent' }}
          </Button>
          <NuxtLink :to="`/${ws}/agents`">
            <Button variant="outline" type="button">Cancel</Button>
          </NuxtLink>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
const { authHeaders, user } = useAuth();
const headers = authHeaders();
const router = useRouter();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');

const submitting = ref(false);
const formError = ref('');

const BUILTIN_TOOLS = [
  { name: 'schedule_next_workflow_execution', label: 'Schedule Next Workflow Execution', description: 'Self-scheduling via exact datetime triggers' },
  { name: 'manage_webhook_trigger', label: 'Manage Webhook Trigger', description: 'Webhook lifecycle management' },
  { name: 'record_decision', label: 'Record Decision', description: 'Audit trail for agent decisions' },
  { name: 'memory_store', label: 'Memory Store', description: 'Store semantic memories (pgvector)' },
  { name: 'memory_retrieve', label: 'Memory Retrieve', description: 'Retrieve memories via similarity search' },
  { name: 'edit_workflow', label: 'Edit Workflow', description: 'Edit triggers and steps' },
  { name: 'read_variables', label: 'Read Variables', description: 'Read properties and credentials' },
  { name: 'edit_variables', label: 'Edit Variables', description: 'Create/update/delete variables' },
];

const form = reactive({
  name: '',
  description: '',
  sourceType: 'github_repo' as 'github_repo' | 'database',
  gitRepoUrl: '',
  gitBranch: 'main',
  agentFilePath: '',
  skillsDirectory: '',
  githubToken: '',
  scope: 'user' as 'user' | 'workspace',
  builtinToolsEnabled: BUILTIN_TOOLS.map(t => t.name),
  enabledPlugins: [] as string[],
});

// Fetch available plugins
const { data: pluginsData } = await useFetch('/api/plugins', { headers });
const availablePlugins = computed(() => {
  const list = (pluginsData.value as any)?.plugins ?? [];
  return list.filter((p: any) => p.isAllowed);
});

function toggleTool(name: string, checked: boolean | string) {
  if (checked) {
    if (!form.builtinToolsEnabled.includes(name)) form.builtinToolsEnabled.push(name);
  } else {
    form.builtinToolsEnabled = form.builtinToolsEnabled.filter(t => t !== name);
  }
}

function togglePlugin(id: string, checked: boolean | string) {
  if (checked) {
    if (!form.enabledPlugins.includes(id)) form.enabledPlugins.push(id);
  } else {
    form.enabledPlugins = form.enabledPlugins.filter(p => p !== id);
  }
}

async function handleSubmit() {
  formError.value = '';
  submitting.value = true;
  try {
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      sourceType: form.sourceType,
      scope: form.scope,
      builtinToolsEnabled: form.builtinToolsEnabled,
    };
    if (form.sourceType === 'github_repo') {
      body.gitRepoUrl = form.gitRepoUrl;
      body.gitBranch = form.gitBranch;
      body.agentFilePath = form.agentFilePath;
      if (form.skillsDirectory) body.skillsDirectory = form.skillsDirectory;
      if (form.githubToken) body.githubToken = form.githubToken;
    }

    const res = await $fetch<{ agent: { id: string } }>('/api/agents', { method: 'POST', headers, body });

    // Enable selected plugins for new agent
    for (const pluginId of form.enabledPlugins) {
      try {
        await $fetch(`/api/plugins/agent/${res.agent.id}/${pluginId}`, {
          method: 'PUT',
          headers,
          body: { isEnabled: true },
        });
      } catch {
        // non-critical, plugins can be enabled later
      }
    }

    router.push(`/${ws.value}/agents/${res.agent.id}`);
  } catch (e: any) {
    formError.value = e?.data?.error || 'Failed to create agent';
  } finally {
    submitting.value = false;
  }
}
</script>
