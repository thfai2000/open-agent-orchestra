<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Agents', route: `/${ws}/agents` }, { label: 'Create Agent' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <h1 class="text-2xl font-semibold mb-6">Create Agent</h1>
    <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>

    <div class="flex flex-col gap-6">
      <Card>
        <template #title>Basic Information</template>
        <template #content>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium">Name *</label>
              <InputText v-model="form.name" placeholder="My Agent" />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium">Scope</label>
              <Select v-model="form.scope" :options="[{ label: 'Personal', value: 'user' }, { label: 'Workspace', value: 'workspace' }]" optionLabel="label" optionValue="value" />
            </div>
            <div class="flex flex-col gap-2 md:col-span-2">
              <label class="text-sm font-medium">Description</label>
              <Textarea v-model="form.description" rows="3" placeholder="What does this agent do?" />
            </div>
          </div>
        </template>
      </Card>

      <Card>
        <template #title>Agent Source</template>
        <template #content>
          <div class="flex flex-col gap-4">
            <SelectButton v-model="form.sourceType" :options="[{ label: 'GitHub Repo', value: 'github_repo' }, { label: 'Database', value: 'database' }]" optionLabel="label" optionValue="value" />

            <template v-if="form.sourceType === 'github_repo'">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium">Repository URL *</label>
                  <InputText v-model="form.gitRepoUrl" placeholder="https://github.com/user/repo" />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium">Branch</label>
                  <InputText v-model="form.gitBranch" placeholder="main" />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium">Agent File Path</label>
                  <InputText v-model="form.agentFilePath" placeholder="agent.md" />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium">Skills Directory</label>
                  <InputText v-model="form.skillsDirectory" placeholder="skills/" />
                </div>
                <div class="flex flex-col gap-2">
                  <label class="text-sm font-medium">Git Auth Credential</label>
                  <Select v-model="form.githubTokenCredentialId" :options="gitCredOptions" optionLabel="optionLabel" optionValue="id" placeholder="None" showClear />
                </div>
              </div>
            </template>

            <template v-if="form.sourceType === 'database'">
              <div class="flex flex-col gap-2">
                <label class="text-sm font-medium">Agent Instruction (agent.md)</label>
                <Textarea v-model="dbFileContent" rows="8" placeholder="# Agent Instructions\n\nDescribe your agent here..." />
              </div>
            </template>
          </div>
        </template>
      </Card>

      <Card>
        <template #title>Copilot Authentication</template>
        <template #content>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Copilot Token Credential</label>
            <Select v-model="form.copilotTokenCredentialId" :options="copilotCredOptions" optionLabel="optionLabel" optionValue="id" placeholder="Use default GITHUB_TOKEN" showClear />
            <small class="text-surface-400">A GitHub Token credential for the Copilot SDK. Leave blank to use the system GITHUB_TOKEN.</small>
          </div>
        </template>
      </Card>

      <Card>
        <template #title>Built-in Tools</template>
        <template #content>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div v-for="tool in availableTools" :key="tool" class="flex items-center gap-2">
              <Checkbox v-model="form.builtinToolsEnabled" :inputId="tool" :value="tool" />
              <label :for="tool" class="text-sm">{{ formatToolName(tool) }}</label>
            </div>
          </div>
        </template>
      </Card>

      <div class="flex justify-end gap-2">
        <NuxtLink :to="`/${ws}/agents`"><Button label="Cancel" severity="secondary" /></NuxtLink>
        <Button label="Create Agent" icon="pi pi-check" :loading="saving" @click="handleCreate" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');
const { buildCredentialOptions, filterGitAuthCredentialOptions, filterCopilotCredentialOptions } = useAgentCredentialOptions();

const form = reactive({
  name: '', description: '', sourceType: 'github_repo', scope: 'user',
  gitRepoUrl: '', gitBranch: 'main', agentFilePath: 'agent.md', skillsDirectory: 'skills/',
  githubTokenCredentialId: null as string | null, copilotTokenCredentialId: null as string | null,
  builtinToolsEnabled: [] as string[],
});
const dbFileContent = ref('');
const error = ref('');
const saving = ref(false);

const availableTools = [
  'schedule_next_workflow_execution', 'manage_webhook_trigger', 'record_decision',
  'memory_store', 'memory_retrieve', 'edit_workflow', 'read_variables', 'edit_variables', 'simple_http_request',
];

function formatToolName(t: string) { return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

// Load credentials for selects
const { data: userVars } = await useFetch('/api/variables?scope=user', { headers });
const { data: wsVars } = await useFetch('/api/variables?scope=workspace', { headers });

const credOptions = computed(() => buildCredentialOptions([
  { scope: 'user', scopeLabel: 'User', variables: (userVars.value as any)?.variables ?? [] },
  { scope: 'workspace', scopeLabel: 'Workspace', variables: (wsVars.value as any)?.variables ?? [] },
]));
const gitCredOptions = computed(() => filterGitAuthCredentialOptions(credOptions.value));
const copilotCredOptions = computed(() => filterCopilotCredentialOptions(credOptions.value));

async function handleCreate() {
  error.value = '';
  saving.value = true;
  try {
    const body: any = {
      name: form.name, description: form.description, sourceType: form.sourceType,
      scope: form.scope, builtinToolsEnabled: form.builtinToolsEnabled,
      copilotTokenCredentialId: form.copilotTokenCredentialId || undefined,
    };
    if (form.sourceType === 'github_repo') {
      body.gitRepoUrl = form.gitRepoUrl;
      body.gitBranch = form.gitBranch || 'main';
      body.agentFilePath = form.agentFilePath || 'agent.md';
      body.skillsDirectory = form.skillsDirectory || undefined;
      body.githubTokenCredentialId = form.githubTokenCredentialId || undefined;
    } else {
      body.files = [{ filePath: 'agent.md', content: dbFileContent.value }];
    }
    await $fetch('/api/agents', { method: 'POST', headers, body });
    toast.add({ severity: 'success', summary: 'Success', detail: 'Agent created', life: 3000 });
    router.push(`/${ws.value}/agents`);
  } catch (e: any) {
    error.value = e?.data?.error || 'Failed to create agent.';
  } finally {
    saving.value = false;
  }
}
</script>
