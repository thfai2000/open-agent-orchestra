<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Agents', route: `/${ws}/agents` }, { label: 'Create Agent' }]" class="mb-4 -ml-1">
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
        <template #title>Tool Selection</template>
        <template #content>
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium">mcp.json.template</label>
              <Textarea v-model="form.mcpJsonTemplate" rows="8" class="font-mono text-sm" placeholder='{"mcpServers": {"example": {"command": "npx", "args": ["-y", "some-mcp-server"]}}}' />
              <small class="text-surface-400">The default OAO Platform MCP server is auto-included and authenticated as the current signed-in user via a short-lived JWT. Only add extra MCP servers here.</small>
            </div>

            <div class="flex items-start justify-between gap-4">
              <div>
                <label class="text-sm font-medium">Available Tools</label>
                <p class="mt-1 text-xs text-surface-400">Built-ins and MCP tools are grouped by provider. Changing the selection stores an explicit allowlist when this agent is created.</p>
              </div>
              <Button label="Refresh Catalog" icon="pi pi-refresh" severity="secondary" outlined size="small" :loading="toolCatalogPending" @click="refreshToolCatalog(true)" />
            </div>

            <Message v-if="toolCatalogError" severity="warn" :closable="false">{{ toolCatalogError }}</Message>
            <Message v-else-if="toolCatalogUnresolved.length > 0" severity="warn" :closable="false">
              Some previously selected tools are no longer discoverable: {{ toolCatalogUnresolved.join(', ') }}
            </Message>

            <div class="text-sm text-surface-500">Selected Tools: {{ selectedToolNames.length }}</div>

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
                    <p v-if="group.description" class="mt-1 text-xs text-surface-400">{{ group.description }}</p>
                    <p v-if="group.authNote" class="mt-1 text-xs text-surface-400">{{ group.authNote }}</p>
                    <p v-if="group.error" class="mt-1 text-xs text-red-500">{{ group.error }}</p>
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
                          <p v-if="tool.description" class="mt-1 text-xs text-surface-400">{{ tool.description }}</p>
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-surface-500">No tools discovered yet.</div>
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
import { buildExplicitAgentToolSelection } from '~/composables/useAgentToolSelection';

const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');
const { buildCredentialOptions, filterGitAuthCredentialOptions, filterCopilotCredentialOptions } = useAgentCredentialOptions();

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
  defaultSelectedToolNames: string[];
  effectiveSelectedToolNames: string[];
  unresolvedSelectedToolNames: string[];
  groups: ToolCatalogGroup[];
}

const form = reactive({
  name: '', description: '', sourceType: 'github_repo', scope: 'user',
  gitRepoUrl: '', gitBranch: 'main', agentFilePath: 'agent.md', skillsDirectory: 'skills/',
  githubTokenCredentialId: null as string | null, copilotTokenCredentialId: null as string | null,
  mcpJsonTemplate: '',
});
const dbFileContent = ref('');
const error = ref('');
const saving = ref(false);

const availableTools = [
  'schedule_next_workflow_execution', 'manage_webhook_trigger', 'record_decision',
  'memory_store', 'memory_retrieve', 'edit_workflow', 'read_variables', 'edit_variables', 'simple_http_request',
];

const toolCatalog = ref<ToolCatalogResponse | null>(null);
const toolCatalogPending = ref(false);
const toolCatalogError = ref('');
const toolCatalogRequestId = ref(0);
const toolCatalogRefreshTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const selectedToolNames = ref<string[]>([...availableTools]);
const initialSelectedToolNames = ref<string[]>([...availableTools]);
const initialToolSelectionPayload = ref<unknown>([...availableTools]);

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

const toolCatalogUnresolved = computed(() => toolCatalog.value?.unresolvedSelectedToolNames ?? []);
const toolCatalogHasErrors = computed(() => (toolCatalog.value?.groups ?? []).some((group) => Boolean(group.error)));
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

function applyToolSelectionSnapshot(names: string[]) {
  const normalizedNames = Array.from(new Set(names)).sort((left, right) => left.localeCompare(right));
  selectedToolNames.value = normalizedNames;
  initialSelectedToolNames.value = [...normalizedNames];
}

async function refreshToolCatalog(immediate = false) {
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
    const catalog = await $fetch<ToolCatalogResponse>('/api/agents/tool-catalog', {
      method: 'POST',
      headers,
      body: {
        mcpJsonTemplate: form.mcpJsonTemplate.trim() ? form.mcpJsonTemplate : null,
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

// Load credentials for selects
const { data: userVars } = await useFetch('/api/variables?scope=user', { headers });
const { data: wsVars } = await useFetch('/api/variables?scope=workspace', { headers });

const credOptions = computed(() => buildCredentialOptions([
  { scope: 'user', scopeLabel: 'User', variables: (userVars.value as any)?.variables ?? [] },
  { scope: 'workspace', scopeLabel: 'Workspace', variables: (wsVars.value as any)?.variables ?? [] },
]));
const gitCredOptions = computed(() => filterGitAuthCredentialOptions(credOptions.value));
const copilotCredOptions = computed(() => filterCopilotCredentialOptions(credOptions.value));

watch(() => form.mcpJsonTemplate, () => {
  void refreshToolCatalog(false);
});

onMounted(() => {
  void refreshToolCatalog(true);
});

onBeforeUnmount(() => {
  if (toolCatalogRefreshTimer.value) {
    clearTimeout(toolCatalogRefreshTimer.value);
  }
});

async function handleCreate() {
  error.value = '';
  saving.value = true;
  try {
    if (toolSelectionDirty.value && (toolCatalogError.value || toolCatalogHasErrors.value)) {
      error.value = 'Resolve tool catalog errors before creating this agent with a custom tool selection.';
      return;
    }

    const body: any = {
      name: form.name, description: form.description, sourceType: form.sourceType,
      scope: form.scope,
      builtinToolsEnabled: toolSelectionDirty.value
        ? buildExplicitAgentToolSelection(selectedToolNames.value)
        : initialToolSelectionPayload.value,
      mcpJsonTemplate: form.mcpJsonTemplate.trim() ? form.mcpJsonTemplate : undefined,
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
