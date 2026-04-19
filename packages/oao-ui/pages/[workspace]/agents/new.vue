<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink :href="`/${ws}`">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink :href="`/${ws}/agents`">Agents</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>New Agent</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <h1 class="text-3xl font-bold mt-4 mb-6">Create New Agent</h1>

    <div class="max-w-3xl space-y-6">
      <div v-if="formError" class="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ formError }}</div>

      <form @submit.prevent="handleSubmit" class="space-y-6">
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
                <select
                  v-model="form.scope"
                  class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="user">Personal (owned by you)</option>
                  <option v-if="isAdmin" value="workspace">Workspace (shared, admin-managed)</option>
                </select>
              </div>
            </div>
            <div class="space-y-2">
              <Label for="description">Description</Label>
              <Textarea id="description" v-model="form.description" rows="2" placeholder="What does this agent do?" />
              <p class="text-xs text-muted-foreground">This field is for UI display only. It is not used as the main agent instruction content.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent File Sources</CardTitle>
            <CardDescription>Choose whether the agent is loaded from a Git repository or stored directly in the platform database.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <label
                :class="['flex flex-col items-center gap-2 p-4 rounded-lg border-2 cursor-pointer transition', form.sourceType === 'github_repo' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50']"
                @click="form.sourceType = 'github_repo'"
              >
                <span class="text-2xl">🐙</span>
                <span class="font-medium text-sm">GitHub Repository</span>
                <span class="text-xs text-muted-foreground text-center">Clone agent files from a Git repository at execution time.</span>
              </label>
              <label
                :class="['flex flex-col items-center gap-2 p-4 rounded-lg border-2 cursor-pointer transition', form.sourceType === 'database' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50']"
                @click="form.sourceType = 'database'"
              >
                <span class="text-2xl">💾</span>
                <span class="font-medium text-sm">Database Storage</span>
                <span class="text-xs text-muted-foreground text-center">Store the agent instruction and skill files directly in OAO.</span>
              </label>
            </div>

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
                  <Input v-model="form.agentFilePath" required placeholder=".github/agents/my-agent.md" />
                </div>
                <div class="space-y-2">
                  <Label>Skills Directory</Label>
                  <Input v-model="form.skillsDirectory" placeholder=".github/skills/" />
                  <p class="text-xs text-muted-foreground">Loads every markdown file in that directory as an agent skill.</p>
                </div>
              </div>
              <div class="space-y-2">
                <Label>Git Authentication</Label>
                <select
                  v-model="form.githubTokenCredentialId"
                  class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring max-w-xl"
                >
                  <option value="">No Authentication (Public Repo)</option>
                  <option v-for="cred in gitAuthCredentials" :key="cred.id" :value="cred.id">{{ cred.optionLabel }}</option>
                </select>
                <p class="text-xs text-muted-foreground">Uses credential variables only. Git checkout automatically applies the selected credential subtype, such as GitHub Token, GitHub App, or User Account.</p>
              </div>
            </div>

            <div v-if="form.sourceType === 'database'" class="space-y-4 pt-2">
              <div class="rounded-lg border border-border overflow-hidden">
                <div class="p-4 border-b border-border bg-muted/20">
                  <h3 class="text-sm font-semibold">Agent/Skill File Content</h3>
                  <p class="text-xs text-muted-foreground mt-1">Create the main agent instruction file and any optional skill files now. The first root-level markdown file becomes the main instruction file.</p>
                </div>
                <div class="p-4 space-y-4">
                  <div v-for="(file, index) in form.databaseFiles" :key="`${index}-${file.filePath}`" class="rounded-lg border border-border p-3 space-y-3">
                    <div class="flex items-center justify-between gap-3">
                      <p class="text-sm font-medium">{{ index === 0 ? 'Main File' : `Additional File ${index + 1}` }}</p>
                      <Button v-if="form.databaseFiles.length > 1" type="button" variant="ghost" size="sm" class="text-destructive" @click.prevent="removeDatabaseFile(index)">Remove</Button>
                    </div>
                    <div class="space-y-1.5">
                      <Label class="text-xs">File Path *</Label>
                      <Input v-model="file.filePath" class="font-mono" placeholder="agent.md or skills/research.md" />
                    </div>
                    <div class="space-y-1.5">
                      <Label class="text-xs">Content *</Label>
                      <Textarea v-model="file.content" rows="8" class="font-mono text-xs" placeholder="# Agent Instructions&#10;&#10;Describe the agent behavior here..." />
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" @click.prevent="addDatabaseFile">+ Add File</Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Copilot Authentication</CardTitle>
            <CardDescription>Select the credential used for GitHub Copilot SDK sessions. This is separate from Git authentication used for repository checkout.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-2">
              <Label>Copilot Authentication</Label>
              <select
                v-model="form.copilotTokenCredentialId"
                class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring max-w-xl"
              >
                <option value="">Use system default (GITHUB_TOKEN env var)</option>
                <option v-for="cred in copilotCredentials" :key="cred.id" :value="cred.id">{{ cred.optionLabel }}</option>
              </select>
              <p class="text-xs text-muted-foreground">Copilot authentication accepts credential variables only. Use a GitHub Token credential when you want this agent to override the system default token.</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Built-in Tools</CardTitle>
            <CardDescription>Select which built-in tools this agent can use during Copilot sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex gap-2 mb-3">
              <Button type="button" variant="outline" size="sm" @click.prevent="selectAllBuiltinTools">Select All</Button>
              <Button type="button" variant="outline" size="sm" @click.prevent="deselectAllBuiltinTools">Deselect All</Button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label v-for="tool in BUILTIN_TOOLS" :key="tool.name" class="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-muted/50 cursor-pointer">
                <Checkbox :checked="form.builtinToolsEnabled.includes(tool.name)" @update:checked="toggleBuiltinTool(tool.name, $event)" />
                <div>
                  <p class="text-sm font-medium">{{ tool.label }}</p>
                  <p class="text-xs text-muted-foreground">{{ tool.description }}</p>
                </div>
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>MCP JSON Template</CardTitle>
            <CardDescription>Jinja2 template that renders to a <code class="bg-muted px-1 rounded text-xs">mcp.json</code> configuration. Use <code v-pre class="bg-muted px-1 rounded text-xs">{{ properties.KEY }}</code> and <code v-pre class="bg-muted px-1 rounded text-xs">{{ credentials.KEY }}</code> for substitution.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            <Textarea v-model="form.mcpJsonTemplate" rows="10" class="font-mono text-xs" :placeholder="mcpTemplatePlaceholder" />
            <div class="p-3 rounded-md bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-700 dark:text-blue-300 space-y-1">
              <p><strong>Jinja2 Variables:</strong></p>
              <p><code v-pre class="bg-blue-100 dark:bg-blue-900 px-1 rounded">{{ properties.KEY }}</code> — Agent, user, and workspace properties</p>
              <p><code v-pre class="bg-blue-100 dark:bg-blue-900 px-1 rounded">{{ credentials.KEY }}</code> — Agent, user, and workspace credentials</p>
              <p>The rendered output must be valid JSON with a <code class="bg-blue-100 dark:bg-blue-900 px-1 rounded">mcpServers</code> object.</p>
            </div>
          </CardContent>
        </Card>

        <div class="flex gap-3">
          <Button type="submit" :disabled="submitting">{{ submitting ? 'Creating...' : 'Create Agent' }}</Button>
          <NuxtLink :to="`/${ws}/agents`">
            <Button variant="outline" type="button">Cancel</Button>
          </NuxtLink>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAgentCredentialOptions } from '~/composables/useAgentCredentialOptions';

interface DatabaseFileDraft {
  filePath: string;
  content: string;
}

const { authHeaders, user } = useAuth();
const headers = authHeaders();
const router = useRouter();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');

const { buildCredentialOptions, filterGitAuthCredentialOptions, filterCopilotCredentialOptions } = useAgentCredentialOptions();

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
  { name: 'simple_http_request', label: 'Simple HTTP Request', description: 'Curl-like HTTP requests with Jinja2 templating on all arguments' },
] as const;

function createDatabaseFile(filePath = '', content = ''): DatabaseFileDraft {
  return { filePath, content };
}

const form = reactive({
  name: '',
  description: '',
  sourceType: 'github_repo' as 'github_repo' | 'database',
  gitRepoUrl: '',
  gitBranch: 'main',
  agentFilePath: '',
  skillsDirectory: '',
  githubTokenCredentialId: '',
  copilotTokenCredentialId: '',
  scope: 'user' as 'user' | 'workspace',
  builtinToolsEnabled: [...BUILTIN_TOOLS.map((tool) => tool.name)],
  mcpJsonTemplate: '',
  databaseFiles: [createDatabaseFile('agent.md', '')] as DatabaseFileDraft[],
});

const mcpTemplatePlaceholder = `{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": {
        "API_KEY": "{{ credentials.API_KEY }}"
      }
    }
  }
}`;

const { data: userVarData } = await useFetch('/api/variables?scope=user', { headers });
const { data: wsVarData } = await useFetch('/api/variables?scope=workspace', { headers });

const credentialOptions = computed(() => buildCredentialOptions([
  {
    scope: 'user',
    scopeLabel: 'Personal',
    variables: ((userVarData.value as any)?.variables ?? []) as any[],
  },
  {
    scope: 'workspace',
    scopeLabel: 'Workspace',
    variables: ((wsVarData.value as any)?.variables ?? []) as any[],
  },
]));

const gitAuthCredentials = computed(() => filterGitAuthCredentialOptions(credentialOptions.value, form.githubTokenCredentialId || null));
const copilotCredentials = computed(() => filterCopilotCredentialOptions(credentialOptions.value, form.copilotTokenCredentialId || null));

watch(() => form.sourceType, (sourceType) => {
  if (sourceType === 'database' && form.databaseFiles.length === 0) {
    form.databaseFiles.push(createDatabaseFile('agent.md', ''));
  }
});

function replaceBuiltinTools(nextToolNames: string[]) {
  form.builtinToolsEnabled.splice(0, form.builtinToolsEnabled.length, ...nextToolNames);
}

function selectAllBuiltinTools() {
  replaceBuiltinTools(BUILTIN_TOOLS.map((tool) => tool.name));
}

function deselectAllBuiltinTools() {
  replaceBuiltinTools([]);
}

function toggleBuiltinTool(name: string, checked: boolean | string) {
  if (checked) {
    if (!form.builtinToolsEnabled.includes(name)) form.builtinToolsEnabled.push(name);
    return;
  }

  const index = form.builtinToolsEnabled.indexOf(name);
  if (index >= 0) form.builtinToolsEnabled.splice(index, 1);
}

function addDatabaseFile() {
  form.databaseFiles.push(createDatabaseFile('', ''));
}

function removeDatabaseFile(index: number) {
  form.databaseFiles.splice(index, 1);
  if (form.databaseFiles.length === 0) {
    form.databaseFiles.push(createDatabaseFile('agent.md', ''));
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
      builtinToolsEnabled: [...form.builtinToolsEnabled],
    };

    if (form.copilotTokenCredentialId) {
      body.copilotTokenCredentialId = form.copilotTokenCredentialId;
    }

    if (form.sourceType === 'github_repo') {
      body.gitRepoUrl = form.gitRepoUrl;
      body.gitBranch = form.gitBranch;
      body.agentFilePath = form.agentFilePath;
      if (form.skillsDirectory) body.skillsDirectory = form.skillsDirectory;
      if (form.githubTokenCredentialId) body.githubTokenCredentialId = form.githubTokenCredentialId;
    } else {
      const files = form.databaseFiles
        .map((file) => ({ filePath: file.filePath.trim(), content: file.content }))
        .filter((file) => file.filePath || file.content.trim());

      if (files.length === 0) {
        throw new Error('Add at least one agent or skill file when using Database Storage.');
      }

      if (files.some((file) => !file.filePath || !file.content.trim())) {
        throw new Error('Each database-stored file needs both a file path and content.');
      }

      body.files = files;
    }

    if (form.mcpJsonTemplate.trim()) {
      body.mcpJsonTemplate = form.mcpJsonTemplate;
    }

    const res = await $fetch<{ agent: { id: string } }>('/api/agents', { method: 'POST', headers, body });
    router.push(`/${ws.value}/agents/${res.agent.id}`);
  } catch (error: any) {
    formError.value = error?.data?.error || error?.message || 'Failed to create agent';
  } finally {
    submitting.value = false;
  }
}
</script>
