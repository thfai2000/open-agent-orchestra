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

    <Card class="max-w-2xl">
      <CardContent class="pt-6">
        <div v-if="formError" class="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ formError }}</div>
        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="name">Name *</Label>
              <Input id="name" v-model="form.name" required placeholder="My Trading Agent" />
            </div>
            <div class="space-y-2">
              <Label for="gitRepoUrl">Git Repository URL *</Label>
              <Input id="gitRepoUrl" v-model="form.gitRepoUrl" type="url" required placeholder="https://github.com/user/repo" />
            </div>
            <div class="space-y-2">
              <Label for="gitBranch">Git Branch</Label>
              <Input id="gitBranch" v-model="form.gitBranch" placeholder="main" />
            </div>
            <div class="space-y-2">
              <Label for="agentFilePath">Agent File Path *</Label>
              <Input id="agentFilePath" v-model="form.agentFilePath" required placeholder=".github/agents/trading.md" />
            </div>
          </div>
          <div class="space-y-2">
            <Label for="description">Description</Label>
            <Textarea id="description" v-model="form.description" rows="2" placeholder="What does this agent do?" />
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
          <div class="space-y-2">
            <Label for="githubToken">GitHub Token (optional, encrypted at rest)</Label>
            <Input id="githubToken" v-model="form.githubToken" type="password" class="max-w-md" placeholder="ghp_..." />
          </div>

          <!-- Built-in Tools -->
          <div class="space-y-3">
            <Label>Built-in Tools</Label>
            <p class="text-xs text-muted-foreground">Select which built-in tools this agent can use during Copilot sessions.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label v-for="tool in BUILTIN_TOOLS" :key="tool.name" class="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-muted/50 cursor-pointer">
                <Checkbox :checked="form.builtinToolsEnabled.includes(tool.name)" @update:checked="toggleTool(tool.name, $event)" />
                <div>
                  <p class="text-sm font-medium">{{ tool.label }}</p>
                  <p class="text-xs text-muted-foreground">{{ tool.description }}</p>
                </div>
              </label>
            </div>
          </div>

          <div class="flex gap-3 pt-2">
            <Button type="submit" :disabled="submitting">
              {{ submitting ? 'Creating...' : 'Create Agent' }}
            </Button>
            <NuxtLink :to="`/${ws}/agents`">
              <Button variant="outline" type="button">Cancel</Button>
            </NuxtLink>
          </div>
        </form>
      </CardContent>
    </Card>
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
  { name: 'schedule_next_wakeup', label: 'Schedule Next Wakeup', description: 'Self-scheduling via cron triggers' },
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
  gitRepoUrl: '',
  gitBranch: 'main',
  agentFilePath: '',
  githubToken: '',
  scope: 'user' as 'user' | 'workspace',
  builtinToolsEnabled: BUILTIN_TOOLS.map(t => t.name),
});

function toggleTool(name: string, checked: boolean | string) {
  if (checked) {
    if (!form.builtinToolsEnabled.includes(name)) form.builtinToolsEnabled.push(name);
  } else {
    form.builtinToolsEnabled = form.builtinToolsEnabled.filter(t => t !== name);
  }
}

async function handleSubmit() {
  formError.value = '';
  submitting.value = true;
  try {
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      gitRepoUrl: form.gitRepoUrl,
      gitBranch: form.gitBranch,
      agentFilePath: form.agentFilePath,
      scope: form.scope,
      builtinToolsEnabled: form.builtinToolsEnabled,
    };
    if (form.githubToken) body.githubToken = form.githubToken;

    const res = await $fetch<{ agent: { id: string } }>('/api/agents', { method: 'POST', headers, body });
    router.push(`/${ws.value}/agents/${res.agent.id}`);
  } catch (e: any) {
    formError.value = e?.data?.error || 'Failed to create agent';
  } finally {
    submitting.value = false;
  }
}
</script>
