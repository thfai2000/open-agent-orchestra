<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="conversation" class="space-y-6">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 class="text-3xl font-bold">{{ conversation.title }}</h1>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <Tag :value="conversation.status" :severity="conversation.status === 'active' ? 'success' : 'secondary'" />
            <Tag :value="agent?.name || conversation.agentNameSnapshot" severity="info" />
            <span class="text-xs text-surface-500">Created {{ new Date(conversation.createdAt).toLocaleString() }}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <NuxtLink :to="`/${ws}/conversations/new`">
            <Button label="New Conversation" icon="pi pi-plus" severity="secondary" />
          </NuxtLink>
          <NuxtLink v-if="agent?.id" :to="`/${ws}/agents/${agent.id}`">
            <Button label="View Agent" icon="pi pi-arrow-up-right" severity="secondary" />
          </NuxtLink>
        </div>
      </div>

      <Message v-if="agentWarning" severity="warn" :closable="false">{{ agentWarning }}</Message>

      <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div class="overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-sm">
          <div ref="messagesContainerRef" class="min-h-[28rem] max-h-[calc(100vh-20rem)] overflow-y-auto bg-surface-50 px-4 py-5 sm:px-6">
            <div v-if="localMessages.length === 0" class="py-16 text-center text-sm text-surface-400">
              No messages yet. Send the first message to start the conversation.
            </div>

            <div v-else class="space-y-4">
              <div v-for="message in localMessages" :key="message.id" :class="['flex', message.role === 'user' ? 'justify-end' : 'justify-start']">
                <div :class="[
                  'max-w-[90%] rounded-2xl px-4 py-3 shadow-sm',
                  message.role === 'user'
                    ? 'bg-primary-600 text-white'
                    : message.status === 'failed'
                      ? 'border border-red-200 bg-red-50 text-red-900'
                      : 'border border-surface-200 bg-white text-surface-900',
                ]">
                  <div class="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide" :class="message.role === 'user' ? 'text-primary-100' : 'text-surface-500'">
                    <span>{{ message.role === 'user' ? 'You' : 'Agent' }}</span>
                    <span>&middot;</span>
                    <span>{{ formatMessageTime(message.createdAt) }}</span>
                    <span v-if="message.status === 'pending'" class="inline-flex items-center gap-1">
                      <span class="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                      Responding
                    </span>
                  </div>

                  <div v-if="message.role === 'assistant'" class="mb-3 flex flex-wrap items-center gap-1.5">
                    <Tag v-if="getMessageAgentName(message)" :value="getMessageAgentName(message)" severity="info" class="text-xs" />
                    <Tag v-if="getMessageModel(message)" :value="getMessageModel(message)" severity="secondary" class="text-xs" />
                    <Tag v-if="getMessageReasoningEffort(message)" :value="`effort:${getMessageReasoningEffort(message)}`" severity="secondary" class="text-xs" />
                  </div>

                  <div v-if="message.role === 'assistant' && message.content" class="text-sm leading-6">
                    <MarkdownRenderer :content="message.content" theme="light" />
                  </div>
                  <p v-else-if="message.content" class="whitespace-pre-wrap text-sm leading-6">{{ message.content }}</p>
                  <p v-else class="text-sm italic" :class="message.role === 'user' ? 'text-primary-100' : 'text-surface-400'">{{ message.status === 'pending' ? 'Thinking…' : 'No content.' }}</p>

                  <div v-if="message.role === 'assistant' && getMessageReasoningText(message)" class="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                    <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Reasoning</p>
                    <MarkdownRenderer :content="getMessageReasoningText(message)" theme="light" />
                  </div>

                  <div v-if="message.role === 'assistant' && getMessageActivity(message).length > 0" class="mt-4 rounded-xl border border-surface-200 bg-surface-50 p-3">
                    <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-600">Activity</p>
                    <div class="space-y-2">
                      <div v-for="(event, index) in getMessageActivity(message)" :key="`${message.id}-activity-${index}`" class="rounded-lg border border-surface-200 bg-white px-3 py-2 text-xs text-surface-700">
                        <div class="flex items-center justify-between gap-3">
                          <span>{{ formatActivityLabel(event) }}</span>
                          <span class="text-surface-400">{{ formatActivityTime(event.timestamp) }}</span>
                        </div>
                        <pre v-if="event.args" class="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded bg-surface-950 px-2 py-1 text-[11px] text-surface-100">{{ formatArgs(event.args) }}</pre>
                        <pre v-else-if="event.result && event.type === 'tool_call_end'" class="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded bg-surface-950 px-2 py-1 text-[11px] text-surface-100">{{ formatArgs(event.result) }}</pre>
                      </div>
                    </div>
                  </div>

                  <p v-if="message.status === 'failed' && message.error" class="mt-3 text-xs font-medium text-red-700">{{ message.error }}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="border-t border-surface-200 bg-white p-4 sm:p-5">
            <div class="flex flex-col gap-3">
              <Textarea
                v-model="draft"
                rows="4"
                autoResize
                :disabled="!canCompose"
                placeholder="Ask the agent something..."
              />

              <Message v-if="staleModelName" severity="warn" :closable="false">
                The last saved turn override used {{ staleModelName }}, which is no longer active in this workspace. The next turn will use the workspace default model unless you choose another one.
              </Message>
              <Message v-else-if="modelOptions.length === 0" severity="warn" :closable="false">
                No active models are configured for this workspace. Add one in Admin &gt; Models before sending a new turn.
              </Message>

              <div class="rounded-xl border border-surface-200 bg-surface-50 px-3 py-3">
                <div class="flex flex-wrap items-end gap-3">
                  <div class="w-full sm:w-36">
                    <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-surface-500">Agent</label>
                    <Select
                      v-model="settingsForm.agentId"
                      :options="agentOptions"
                      optionLabel="name"
                      optionValue="id"
                      optionDisabled="disabled"
                      :disabled="!canChangeAgent"
                      placeholder="Select an agent"
                      @change="handleAgentChange"
                    />
                  </div>

                  <div class="w-full sm:w-32">
                    <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-surface-500">Model</label>
                    <Select
                      v-model="settingsForm.model"
                      :options="modelOptions"
                      optionLabel="label"
                      optionValue="value"
                      :disabled="!canAdjustTurnSettings || modelOptions.length === 0"
                      showClear
                      placeholder="Workspace default"
                    />
                  </div>

                  <div class="w-full sm:w-28">
                    <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-surface-500">Effort</label>
                    <Select
                      v-model="settingsForm.reasoningEffort"
                      :options="reasoningOptions"
                      optionLabel="label"
                      optionValue="value"
                      :disabled="!canAdjustTurnSettings"
                      showClear
                      placeholder="Model default"
                    />
                  </div>

                  <div class="min-w-[10rem] flex-1 lg:flex-none">
                    <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-surface-500">Tools</label>
                    <div class="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        :label="toolButtonLabel"
                        icon="pi pi-sitemap"
                        severity="secondary"
                        outlined
                        size="small"
                        :disabled="!conversation?.agentId"
                        :loading="toolCatalogPending"
                        @click="toggleToolsPopover"
                      />
                      <Button
                        label="Default"
                        severity="secondary"
                        text
                        size="small"
                        :disabled="!canAdjustTurnSettings || toolCatalogPending || !toolCatalog"
                        @click="resetToolSelection"
                      />
                    </div>
                  </div>
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-surface-500">
                  <span>{{ nextTurnModelSummary }}</span>
                  <span>&middot;</span>
                  <span>{{ nextTurnReasoningSummary }}</span>
                  <span>&middot;</span>
                  <span>{{ nextTurnToolSummary }}</span>
                  <span v-if="hasTurnSettingOverrides" class="rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-medium text-primary-700">Overrides active</span>
                </div>
              </div>

              <Popover ref="toolsPopover">
                <div class="w-[min(34rem,calc(100vw-2rem))] space-y-3">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p class="text-sm font-semibold text-surface-900">Tool Selection</p>
                      <p class="text-xs text-surface-500">Override the current agent defaults for the next turn.</p>
                    </div>
                    <div class="flex items-center gap-2">
                      <Button label="Use Agent Defaults" severity="secondary" text size="small" :disabled="!canAdjustTurnSettings || toolCatalogPending || !toolCatalog" @click="resetToolSelection" />
                      <Button label="Refresh" icon="pi pi-refresh" severity="secondary" outlined size="small" :disabled="!conversation?.agentId" :loading="toolCatalogPending" @click="refreshToolCatalog" />
                    </div>
                  </div>

                  <Message v-if="toolCatalogError" severity="warn" :closable="false">{{ toolCatalogError }}</Message>
                  <Message v-else-if="toolCatalogUnresolved.length > 0" severity="warn" :closable="false">
                    Some previously selected tools are no longer discoverable: {{ toolCatalogUnresolved.join(', ') }}
                  </Message>

                  <div class="text-xs text-surface-500">Selected tools: {{ settingsForm.selectedToolNames.length }}</div>

                  <div v-if="toolCatalogPending && !toolCatalog" class="text-sm text-surface-500">Inspecting tool catalog...</div>
                  <div v-else-if="toolCatalogGroups.length > 0" class="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
                    <details v-for="group in toolCatalogGroups" :key="group.key" open class="overflow-hidden rounded-xl border border-surface-200 bg-white">
                      <summary class="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-sm font-medium text-surface-900">
                        <i class="pi pi-folder text-[11px] text-surface-400"></i>
                        <span>{{ group.label }}</span>
                        <Tag :value="group.sourceLabel" :severity="group.sourceSeverity" class="text-xs" />
                        <span class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-700 text-surface-300 text-[10px] leading-none align-middle">{{ group.tools.length }}</span>
                        <Tag v-if="group.error" value="Unavailable" severity="danger" class="text-xs" />
                      </summary>

                      <div class="border-t border-surface-200 px-3 py-3">
                        <p v-if="group.description" class="text-xs text-surface-500">{{ group.description }}</p>
                        <p v-if="group.authNote" class="mt-1 text-xs text-surface-500">{{ group.authNote }}</p>
                        <p v-if="group.error" class="mt-1 text-xs text-red-600">{{ group.error }}</p>

                        <div v-if="group.sections.length > 0" class="mt-3 space-y-3">
                          <details
                            v-for="section in group.sections"
                            :key="`${group.key}:${section.label || 'tools'}`"
                            :open="true"
                            class="rounded-lg bg-surface-50"
                          >
                            <summary
                              v-if="section.label"
                              class="cursor-pointer list-none px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-surface-500"
                            >
                              {{ section.label }}
                            </summary>

                            <div :class="['space-y-2', section.label ? 'border-t border-surface-200 px-3 py-3' : '']">
                              <label v-for="tool in section.tools" :key="tool.name" class="flex items-start gap-3 rounded-lg border border-surface-200 bg-white px-3 py-2">
                                <Checkbox
                                  :modelValue="settingsForm.selectedToolNames.includes(tool.name)"
                                  :binary="true"
                                  :disabled="!canAdjustTurnSettings || toolCatalogPending"
                                  @update:modelValue="toggleTool(tool.name, $event)"
                                />
                                <span class="flex-1">
                                  <span class="flex flex-wrap items-center gap-2">
                                    <span class="block text-sm font-medium text-surface-900">{{ tool.label }}</span>
                                    <Tag v-if="tool.requiresPermission" value="Write" severity="warn" class="text-xs" />
                                  </span>
                                  <span class="block text-xs text-surface-500">{{ tool.description }}</span>
                                </span>
                              </label>
                            </div>
                          </details>
                        </div>
                      </div>
                    </details>
                  </div>
                  <div v-else class="text-sm text-surface-500">No tools discovered yet.</div>
                </div>
              </Popover>

              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="text-xs text-surface-500">
                  <span v-if="streamConnected" class="inline-flex items-center gap-1 text-green-600">
                    <span class="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                    Live stream connected
                  </span>
                  <span v-else>Realtime updates are temporarily disconnected. The turn will refresh when it completes.</span>
                </div>
                <Button label="Send" icon="pi pi-send" :loading="sending" :disabled="!canSend" @click="sendMessage" />
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <Card>
            <template #title>Details</template>
            <template #content>
              <div class="flex flex-col gap-3 text-sm">
                <div>
                  <span class="text-surface-500">Current Agent</span>
                  <p class="font-medium text-surface-900">{{ agent?.name || conversation.agentNameSnapshot || 'Not selected' }}</p>
                </div>
                <div>
                  <span class="text-surface-500">Last Message</span>
                  <p class="font-medium text-surface-900">{{ conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString() : 'None yet' }}</p>
                </div>
                <div>
                  <span class="text-surface-500">Messages</span>
                  <p class="font-medium text-surface-900">{{ localMessages.length }}</p>
                </div>
                <div>
                  <span class="text-surface-500">Selected Tools</span>
                  <p class="font-medium text-surface-900">{{ settingsForm.selectedToolNames.length }}</p>
                </div>
                <div>
                  <span class="text-surface-500">Next Turn</span>
                  <p class="font-medium text-surface-900">{{ nextTurnSummary }}</p>
                </div>
              </div>
            </template>
          </Card>

          <Card>
            <template #title>History</template>
            <template #content>
              <p class="text-sm text-surface-500">Open your full conversation list to switch threads or start a new conversation.</p>
              <NuxtLink :to="`/${ws}/conversations`" class="mt-3 inline-flex text-sm font-medium text-primary hover:underline">Back to Conversations</NuxtLink>
            </template>
          </Card>
        </div>
      </div>
    </div>

    <div v-else class="py-12 text-center text-surface-400">Loading conversation...</div>
  </div>
</template>

<script setup lang="ts">
import { useConversationStream } from '~/composables/useConversationStream';

interface ConversationLiveEvent {
  type: 'info' | 'message_delta' | 'reasoning' | 'reasoning_delta' | 'tool_call_start' | 'tool_call_end' | 'turn_start' | 'turn_end';
  timestamp: string;
  content?: string;
  message?: string;
  reasoningId?: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  success?: boolean;
}

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

interface ModelOption {
  label: string;
  value: string;
  description?: string | null;
  provider?: string | null;
}

interface LocalConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  status: 'pending' | 'completed' | 'failed';
  content: string;
  createdAt: string;
  updatedAt: string;
  error?: string | null;
  model?: string | null;
  metadata?: Record<string, any> | null;
  _optimistic?: boolean;
}

const reasoningOptions = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'XHigh', value: 'xhigh' },
];

const builtinToolLabels: Record<string, { label: string; description: string }> = {
  schedule_next_workflow_execution: {
    label: 'Schedule Next Workflow Execution',
    description: 'Create or update an exact datetime trigger for a workflow.',
  },
  manage_webhook_trigger: {
    label: 'Manage Webhook Trigger',
    description: 'Create, update, or delete workflow webhooks.',
  },
  record_decision: {
    label: 'Record Decision',
    description: 'Persist structured decision logs for audit and review.',
  },
  memory_store: {
    label: 'Store Memory',
    description: 'Save important observations into long-term memory.',
  },
  memory_retrieve: {
    label: 'Retrieve Memory',
    description: 'Search previously stored semantic memories.',
  },
  edit_workflow: {
    label: 'Edit Workflow',
    description: 'Modify workflow steps and triggers.',
  },
  read_variables: {
    label: 'Read Variables',
    description: 'Read agent, user, or workspace variables.',
  },
  edit_variables: {
    label: 'Edit Variables',
    description: 'Create, update, or delete variables.',
  },
  simple_http_request: {
    label: 'Simple HTTP Request',
    description: 'Make outbound HTTP requests through the platform tool.',
  },
};

const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');
const conversationId = computed(() => route.params.id as string);

const draft = ref('');
const sending = ref(false);
const switchingAgent = ref(false);
const localMessages = ref<LocalConversationMessage[]>([]);
const messagesContainerRef = ref<HTMLElement | null>(null);
const pendingAssistantClientId = ref<string | null>(null);
const toolsPopover = ref();
const staleModelName = ref<string | null>(null);

const settingsForm = reactive({
  agentId: '',
  model: null as string | null,
  reasoningEffort: null as string | null,
  selectedToolNames: [] as string[],
});

const toolCatalog = ref<ToolCatalogResponse | null>(null);
const toolCatalogPending = ref(false);
const toolCatalogError = ref('');
const toolCatalogRequestId = ref(0);

const { data, refresh: refreshConversation } = await useFetch<any>(computed(() => `/api/conversations/${conversationId.value}`), { headers });
const { data: agentsData } = await useFetch<any>('/api/agents?limit=200', { headers });
const { data: modelsData } = await useFetch<any>('/api/models', { headers });

const lastResolvedConversationPayload = ref<any | null>(null);
const resolvedConversationPayload = computed(() => data.value?.conversation ? data.value : lastResolvedConversationPayload.value);

const conversation = computed(() => resolvedConversationPayload.value?.conversation ?? null);
const agent = computed(() => resolvedConversationPayload.value?.agent ?? null);

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Conversations', route: `/${ws.value}/conversations` },
  { label: conversation.value?.title || 'Loading...' },
]);

const agentOptions = computed(() => {
  const list = ((agentsData.value?.agents ?? []) as any[]).map((entry) => ({
    ...entry,
    disabled: entry.status !== 'active',
  }));

  if (agent.value && !list.some((entry) => entry.id === agent.value.id)) {
    list.unshift({ ...agent.value, disabled: agent.value.status !== 'active' });
  }

  return list;
});

const modelOptions = computed<ModelOption[]>(() => (((modelsData.value?.models ?? []) as any[]).map((model) => ({
  label: model.name,
  value: model.name,
  description: model.description || null,
  provider: model.provider || null,
}))));
const availableModelNames = computed(() => modelOptions.value.map((model) => model.value));
const toolButtonLabel = computed(() => toolCatalogPending.value ? 'Loading Tools' : `Tools (${settingsForm.selectedToolNames.length})`);
const nextTurnModelSummary = computed(() => {
  if (settingsForm.model) return `Model: ${settingsForm.model}`;
  if (modelOptions.value.length > 0) return 'Model: workspace default';
  return 'Model: unavailable';
});
const nextTurnReasoningSummary = computed(() => settingsForm.reasoningEffort ? `Effort: ${settingsForm.reasoningEffort}` : 'Effort: model default');
const nextTurnToolSummary = computed(() => `Tools: ${settingsForm.selectedToolNames.length}`);
const nextTurnSummary = computed(() => [nextTurnModelSummary.value, nextTurnReasoningSummary.value, nextTurnToolSummary.value].join(' • '));

const toolCatalogUnresolved = computed(() => toolCatalog.value?.unresolvedSelectedToolNames ?? []);
const toolCatalogDefaultSelectedToolNames = computed(() => toolCatalog.value?.defaultSelectedToolNames ?? []);
const toolNameLabels = computed(() => {
  const labels: Record<string, string> = {};

  for (const [toolName, meta] of Object.entries(builtinToolLabels)) {
    labels[toolName] = meta.label;
  }

  for (const group of toolCatalog.value?.groups ?? []) {
    for (const tool of group.tools ?? []) {
      labels[tool.name] = tool.label || labels[tool.name] || tool.name;
    }
  }

  return labels;
});

const toolCatalogGroups = computed(() => {
  const builtinGroupOrder = ['Workflow', 'Knowledge', 'Variables', 'Network'];

  return (toolCatalog.value?.groups ?? []).map((group) => {
    const tools = (group.tools ?? []).map((tool) => ({
      name: tool.name,
      label: tool.label || builtinToolLabels[tool.name]?.label || tool.name,
      description: tool.description || builtinToolLabels[tool.name]?.description || 'Conversation tool.',
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
      sourceLabel: {
        builtin: 'Built-in',
        platform: 'OAO Platform',
        stored_mcp: 'Stored MCP',
        template_mcp: 'Template MCP',
      }[group.source],
      sourceSeverity: {
        builtin: 'info',
        platform: 'success',
        stored_mcp: 'secondary',
        template_mcp: 'warn',
      }[group.source],
    };
  });
});

function applyToolSelectionSnapshot(names: string[]) {
  settingsForm.selectedToolNames = Array.from(new Set(names)).sort((left, right) => left.localeCompare(right));
}

async function refreshToolCatalog() {
  if (!conversation.value?.agentId) {
    toolCatalog.value = null;
    toolCatalogError.value = '';
    settingsForm.selectedToolNames = [];
    return;
  }

  const requestId = ++toolCatalogRequestId.value;
  toolCatalogPending.value = true;
  toolCatalogError.value = '';

  try {
    const catalog = await $fetch<ToolCatalogResponse>(`/api/conversations/${conversationId.value}/tool-catalog`, {
      headers,
    });

    if (requestId !== toolCatalogRequestId.value) return;
    toolCatalog.value = catalog;
    applyToolSelectionSnapshot(catalog.effectiveSelectedToolNames);
  } catch (e: any) {
    if (requestId !== toolCatalogRequestId.value) return;
    toolCatalog.value = null;
    toolCatalogError.value = e?.data?.error || 'Failed to inspect the conversation tool catalog.';
    settingsForm.selectedToolNames = [];
  } finally {
    if (requestId === toolCatalogRequestId.value) {
      toolCatalogPending.value = false;
    }
  }
}

watch(() => resolvedConversationPayload.value?.messages, (messages) => {
  localMessages.value = ((messages ?? []) as any[]).map((message) => ({
    id: message.id,
    role: message.role,
    status: message.status,
    content: message.content || '',
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    error: message.error,
    model: message.model,
    metadata: normalizeMetadata(message.metadata),
  }));
  pendingAssistantClientId.value = null;
  scrollToBottom(false);
}, { immediate: true });

watch(() => data.value, (payload) => {
  if (payload?.conversation) {
    lastResolvedConversationPayload.value = payload;
  }

  const resolvedPayload = payload?.conversation ? payload : lastResolvedConversationPayload.value;
  if (!resolvedPayload) return;

  settingsForm.agentId = resolvedPayload.conversation?.agentId || '';
  staleModelName.value = null;
  settingsForm.model = typeof resolvedPayload.settings?.model === 'string' ? resolvedPayload.settings.model : null;
  settingsForm.reasoningEffort = typeof resolvedPayload.settings?.reasoningEffort === 'string' ? resolvedPayload.settings.reasoningEffort : null;
}, { immediate: true });

watch([() => settingsForm.model, availableModelNames], ([model, activeModels]) => {
  if (!model) return;
  if (activeModels.includes(model)) {
    staleModelName.value = null;
    return;
  }

  staleModelName.value = model;
  settingsForm.model = null;
}, { immediate: true });

watch(() => conversation.value?.agentId, () => {
  void refreshToolCatalog();
}, { immediate: true });

function getRequestErrorMessage(error: any, fallback: string) {
  return error?.data?.error
    || error?.data?.message
    || error?.statusMessage
    || error?.message
    || fallback;
}

async function refreshConversationSafely() {
  try {
    await refreshConversation();
  } catch {
    toast.add({
      severity: 'warn',
      summary: 'Conversation refresh failed',
      detail: 'Showing the last available conversation state.',
      life: 5000,
    });
  }
}

const hasPendingAssistant = computed(() => localMessages.value.some((message) => message.role === 'assistant' && message.status === 'pending'));
const canChangeAgent = computed(() => !!conversation.value && conversation.value.status === 'active' && !hasPendingAssistant.value && !switchingAgent.value);
const canAdjustTurnSettings = computed(() => canChangeAgent.value && !!conversation.value?.agentId && !!agent.value && agent.value.status === 'active');
const canCompose = computed(() => !!conversation.value && conversation.value.status === 'active' && !!conversation.value.agentId && !!agent.value && agent.value.status === 'active' && !switchingAgent.value);
const canSend = computed(() => canCompose.value && !sending.value && !hasPendingAssistant.value && !!draft.value.trim());
const streamEnabled = computed(() => !!conversation.value);
const { connected: streamConnected, on: onStreamEvent } = useConversationStream(conversationId, { enabled: streamEnabled });

const hasTurnSettingOverrides = computed(() => {
  const currentDefaultTools = [...toolCatalogDefaultSelectedToolNames.value].sort();
  const selectedTools = [...settingsForm.selectedToolNames].sort();
  return !!settingsForm.model
    || !!settingsForm.reasoningEffort
    || JSON.stringify(currentDefaultTools) !== JSON.stringify(selectedTools);
});

const agentWarning = computed(() => {
  if (!conversation.value) return '';
  if (conversation.value.status !== 'active') {
    return 'This conversation is archived and cannot receive new messages.';
  }
  if (!agent.value) {
    return 'The original agent for this conversation is no longer available. Choose a new active agent in Turn Settings to continue.';
  }
  if (agent.value.status !== 'active') {
    return `Agent ${agent.value.name} is currently ${agent.value.status}. Switch to an active agent or reactivate it before sending a new message.`;
  }
  return '';
});

onStreamEvent('conversation.message.started', (event: any) => {
  const messageId = event.messageId;
  if (!messageId) return;

  const pendingMessage = pendingAssistantClientId.value
    ? localMessages.value.find((message) => message.id === pendingAssistantClientId.value)
    : localMessages.value.find((message) => message.role === 'assistant' && message.status === 'pending');

  if (pendingMessage) {
    pendingMessage.id = messageId;
    pendingMessage._optimistic = false;
  } else {
    localMessages.value.push({
      id: messageId,
      role: 'assistant',
      status: 'pending',
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    });
  }

  const target = localMessages.value.find((message) => message.id === messageId);
  if (!target) return;

  pendingAssistantClientId.value = messageId;

  applyStartedMetadata(target, event.data);
  appendLiveEvent(target, {
    type: 'info',
    timestamp: event.timestamp || new Date().toISOString(),
    message: event.data?.reasoningEffort
      ? `Session started with ${event.data.model || 'default model'} and ${event.data.reasoningEffort} reasoning.`
      : `Session started with ${event.data?.model || 'default model'}.`,
  });
  scrollToBottom();
});

onStreamEvent('conversation.message.delta', (event: any) => {
  const messageId = event.messageId;
  const delta = event.data?.delta || '';
  if (!messageId || !delta) return;

  const target = getLiveTargetMessage(messageId);
  if (!target) return;

  target.content += delta;
  target.updatedAt = new Date().toISOString();
  appendLiveEvent(target, {
    type: 'message_delta',
    timestamp: event.timestamp || new Date().toISOString(),
    content: delta,
  });
  scrollToBottom();
});

onStreamEvent('conversation.message.reasoning', (event: any) => {
  const messageId = event.messageId;
  if (!messageId || !event.data?.content) return;
  const target = getLiveTargetMessage(messageId);
  if (!target) return;

  appendLiveEvent(target, {
    type: 'reasoning',
    timestamp: event.timestamp || new Date().toISOString(),
    reasoningId: event.data?.reasoningId,
    content: event.data?.content,
  });
  target.updatedAt = new Date().toISOString();
  scrollToBottom();
});

onStreamEvent('conversation.message.reasoning_delta', (event: any) => {
  const messageId = event.messageId;
  const delta = event.data?.delta || '';
  if (!messageId || !delta) return;
  const target = getLiveTargetMessage(messageId);
  if (!target) return;

  appendLiveEvent(target, {
    type: 'reasoning_delta',
    timestamp: event.timestamp || new Date().toISOString(),
    reasoningId: event.data?.reasoningId,
    content: delta,
  });
  target.updatedAt = new Date().toISOString();
  scrollToBottom();
});

onStreamEvent('conversation.tool.execution_start', (event: any) => {
  const messageId = event.messageId;
  if (!messageId) return;
  const target = getLiveTargetMessage(messageId);
  if (!target) return;

  appendLiveEvent(target, {
    type: 'tool_call_start',
    timestamp: event.timestamp || new Date().toISOString(),
    tool: event.data?.toolName,
    args: event.data?.arguments,
  });
  target.updatedAt = new Date().toISOString();
  scrollToBottom();
});

onStreamEvent('conversation.tool.execution_complete', (event: any) => {
  const messageId = event.messageId;
  if (!messageId) return;
  const target = getLiveTargetMessage(messageId);
  if (!target) return;

  appendLiveEvent(target, {
    type: 'tool_call_end',
    timestamp: event.timestamp || new Date().toISOString(),
    tool: event.data?.toolName,
    result: event.data?.result,
    success: event.data?.success,
  });
  target.updatedAt = new Date().toISOString();
  scrollToBottom();
});

onStreamEvent('conversation.turn.started', (event: any) => {
  const messageId = event.messageId;
  if (!messageId) return;
  const target = getLiveTargetMessage(messageId);
  if (!target) return;

  appendLiveEvent(target, {
    type: 'turn_start',
    timestamp: event.timestamp || new Date().toISOString(),
  });
  target.updatedAt = new Date().toISOString();
  scrollToBottom();
});

onStreamEvent('conversation.turn.completed', (event: any) => {
  const messageId = event.messageId;
  if (!messageId) return;
  const target = getLiveTargetMessage(messageId);
  if (!target) return;

  appendLiveEvent(target, {
    type: 'turn_end',
    timestamp: event.timestamp || new Date().toISOString(),
  });
  target.updatedAt = new Date().toISOString();
  scrollToBottom();
});

onStreamEvent('conversation.message.completed', async (event: any) => {
  const messageId = event.messageId;
  const target = getLiveTargetMessage(messageId);
  if (target) {
    target.id = messageId;
    target.status = 'completed';
    if (event.data?.content) target.content = event.data.content;
    target.model = event.data?.model || target.model;
    const metadata = ensureMetadata(target);
    if (typeof event.data?.model === 'string') metadata.model = event.data.model;
    target.updatedAt = new Date().toISOString();
  }

  pendingAssistantClientId.value = null;
  await refreshConversationSafely();
  scrollToBottom();
});

onStreamEvent('conversation.message.failed', async (event: any) => {
  const messageId = event.messageId;
  const target = getLiveTargetMessage(messageId);
  if (target) {
    target.id = messageId || target.id;
    target.status = 'failed';
    target.error = event.data?.error || 'Response failed.';
    target.updatedAt = new Date().toISOString();
  }

  pendingAssistantClientId.value = null;
  toast.add({ severity: 'error', summary: 'Conversation Failed', detail: event.data?.error || 'Failed to receive assistant response.', life: 5000 });
  await refreshConversationSafely();
  scrollToBottom();
});

function normalizeMetadata(metadata: unknown): Record<string, any> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  return { ...(metadata as Record<string, any>) };
}

function ensureMetadata(message: LocalConversationMessage): Record<string, any> {
  if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) {
    message.metadata = {};
  }
  return message.metadata as Record<string, any>;
}

function getLiveEvents(message: LocalConversationMessage): ConversationLiveEvent[] {
  const metadata = normalizeMetadata(message.metadata);
  if (!Array.isArray(metadata.liveOutput)) return [];
  return metadata.liveOutput.filter((event: any) => event && typeof event === 'object' && typeof event.type === 'string');
}

function buildReasoningText(events: ConversationLiveEvent[]): string {
  const reasoningBlocks = new Map<string, string>();
  const order: string[] = [];

  for (const event of events) {
    if ((event.type !== 'reasoning' && event.type !== 'reasoning_delta') || !event.reasoningId) continue;

    if (!reasoningBlocks.has(event.reasoningId)) {
      reasoningBlocks.set(event.reasoningId, '');
      order.push(event.reasoningId);
    }

    if (event.type === 'reasoning') {
      reasoningBlocks.set(event.reasoningId, event.content || '');
    } else {
      reasoningBlocks.set(event.reasoningId, `${reasoningBlocks.get(event.reasoningId) || ''}${event.content || ''}`);
    }
  }

  return order
    .map((reasoningId) => (reasoningBlocks.get(reasoningId) || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function appendLiveEvent(message: LocalConversationMessage, event: ConversationLiveEvent) {
  const metadata = ensureMetadata(message);
  const current = getLiveEvents(message);
  current.push(event);
  metadata.liveOutput = current;
  metadata.reasoningText = buildReasoningText(current);
}

function applyStartedMetadata(message: LocalConversationMessage, data: any) {
  const metadata = ensureMetadata(message);
  if (typeof data?.agentId === 'string') metadata.agentId = data.agentId;
  if (typeof data?.agentName === 'string') metadata.agentName = data.agentName;
  if (typeof data?.model === 'string') {
    metadata.model = data.model;
    message.model = data.model;
  }
  if (typeof data?.reasoningEffort === 'string') metadata.reasoningEffort = data.reasoningEffort;
  if (Array.isArray(data?.enabledToolNames)) metadata.enabledToolNames = [...data.enabledToolNames];
  if (Array.isArray(data?.enabledBuiltinTools)) metadata.enabledBuiltinTools = [...data.enabledBuiltinTools];
}

function getLiveTargetMessage(messageId: string) {
  return localMessages.value.find((message) => message.id === messageId)
    ?? localMessages.value.find((message) => message.id === pendingAssistantClientId.value);
}

function getMessageModel(message: LocalConversationMessage): string {
  const metadata = normalizeMetadata(message.metadata);
  if (typeof metadata.model === 'string' && metadata.model) return metadata.model;
  return message.model || '';
}

function getMessageReasoningEffort(message: LocalConversationMessage): string {
  const metadata = normalizeMetadata(message.metadata);
  return typeof metadata.reasoningEffort === 'string' ? metadata.reasoningEffort : '';
}

function getMessageAgentName(message: LocalConversationMessage): string {
  const metadata = normalizeMetadata(message.metadata);
  return typeof metadata.agentName === 'string' ? metadata.agentName : '';
}

function getMessageReasoningText(message: LocalConversationMessage): string {
  const metadata = normalizeMetadata(message.metadata);
  if (typeof metadata.reasoningText === 'string' && metadata.reasoningText) {
    return metadata.reasoningText;
  }
  return buildReasoningText(getLiveEvents(message));
}

function getMessageActivity(message: LocalConversationMessage): ConversationLiveEvent[] {
  return getLiveEvents(message).filter((event) => !['message_delta', 'reasoning', 'reasoning_delta'].includes(event.type));
}

function formatActivityLabel(event: ConversationLiveEvent): string {
  switch (event.type) {
    case 'info':
      return event.message || 'Session update';
    case 'turn_start':
      return 'Assistant turn started';
    case 'turn_end':
      return 'Assistant turn completed';
    case 'tool_call_start':
      return `Using tool: ${prettyToolName(event.tool)}`;
    case 'tool_call_end':
      return `${prettyToolName(event.tool)} ${event.success === false ? 'failed' : 'completed'}`;
    default:
      return event.type;
  }
}

function prettyToolName(name?: string) {
  if (!name) return 'Unknown Tool';
  return toolNameLabels.value[name] || builtinToolLabels[name]?.label || name;
}

function formatActivityTime(value: string) {
  return new Date(value).toLocaleTimeString();
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleString();
}

function formatArgs(value: unknown) {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function scrollToBottom(smooth = true) {
  nextTick(() => {
    messagesContainerRef.value?.scrollTo({
      top: messagesContainerRef.value?.scrollHeight || 0,
      behavior: smooth ? 'smooth' : 'auto',
    });
  });
}

function toggleTool(toolName: string, enabled: boolean) {
  if (enabled) {
    if (!settingsForm.selectedToolNames.includes(toolName)) {
      settingsForm.selectedToolNames = [...settingsForm.selectedToolNames, toolName];
    }
    return;
  }

  settingsForm.selectedToolNames = settingsForm.selectedToolNames.filter((entry) => entry !== toolName);
}

function resetToolSelection() {
  applyToolSelectionSnapshot(toolCatalogDefaultSelectedToolNames.value);
}

function toggleToolsPopover(event: Event) {
  toolsPopover.value?.toggle(event);
}

async function handleAgentChange() {
  const nextAgentId = settingsForm.agentId;
  const currentAgentId = conversation.value?.agentId || '';
  if (!nextAgentId || nextAgentId === currentAgentId) return;

  switchingAgent.value = true;
  try {
    await $fetch(`/api/conversations/${conversationId.value}`, {
      method: 'PATCH',
      headers,
      body: { agentId: nextAgentId },
    });
    await refreshConversation();
    await refreshToolCatalog();
  } catch (e: any) {
    settingsForm.agentId = currentAgentId;
    toast.add({ severity: 'error', summary: 'Agent Switch Failed', detail: e?.data?.error || 'Failed to switch conversation agent.', life: 5000 });
  } finally {
    switchingAgent.value = false;
  }
}

async function sendMessage() {
  const content = draft.value.trim();
  if (!content || !canSend.value) return;

  const userMessageId = `tmp-user-${Date.now()}`;
  const assistantMessageId = `tmp-assistant-${Date.now()}`;
  const now = new Date().toISOString();

  localMessages.value.push({
    id: userMessageId,
    role: 'user',
    status: 'completed',
    content,
    createdAt: now,
    updatedAt: now,
    metadata: {
      agentId: conversation.value?.agentId,
      agentName: agent.value?.name || conversation.value?.agentNameSnapshot,
      model: settingsForm.model,
      reasoningEffort: settingsForm.reasoningEffort,
      enabledToolNames: [...settingsForm.selectedToolNames],
      enabledBuiltinTools: settingsForm.selectedToolNames.filter((toolName) => Object.hasOwn(builtinToolLabels, toolName)),
    },
    _optimistic: true,
  });
  localMessages.value.push({
    id: assistantMessageId,
    role: 'assistant',
    status: 'pending',
    content: '',
    createdAt: now,
    updatedAt: now,
    metadata: {
      agentId: conversation.value?.agentId,
      agentName: agent.value?.name || conversation.value?.agentNameSnapshot,
      model: settingsForm.model,
      reasoningEffort: settingsForm.reasoningEffort,
      enabledToolNames: [...settingsForm.selectedToolNames],
      enabledBuiltinTools: settingsForm.selectedToolNames.filter((toolName) => Object.hasOwn(builtinToolLabels, toolName)),
      liveOutput: [],
      reasoningText: '',
    },
    _optimistic: true,
  });
  pendingAssistantClientId.value = assistantMessageId;
  draft.value = '';
  scrollToBottom();

  sending.value = true;
  try {
    await $fetch(`/api/conversations/${conversationId.value}/messages`, {
      method: 'POST',
      headers,
      body: {
        content,
        model: settingsForm.model || undefined,
        reasoningEffort: settingsForm.reasoningEffort || undefined,
        enabledToolNames: toolCatalog.value ? [...settingsForm.selectedToolNames] : undefined,
      },
    });

    await refreshConversationSafely();
  } catch (e: any) {
    const message = getRequestErrorMessage(e, 'Failed to send message.');
    const target = localMessages.value.find((entry) => entry.id === pendingAssistantClientId.value)
      ?? localMessages.value.find((entry) => entry.role === 'assistant' && entry.status === 'pending');
    if (target) {
      target.status = 'failed';
      target.error = message;
      target.updatedAt = new Date().toISOString();
    }
    toast.add({ severity: 'error', summary: 'Send Failed', detail: message, life: 5000 });
    await refreshConversationSafely();
  } finally {
    sending.value = false;
  }
}
</script>