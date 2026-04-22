<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Conversations', route: `/${ws}/conversations` }, { label: 'New Conversation' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="mb-6">
      <h1 class="text-3xl font-bold">Start Conversation</h1>
      <p class="text-muted-foreground text-sm mt-1">Choose an active agent and create a dedicated conversation thread.</p>
    </div>

    <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>

    <Card v-if="availableAgents.length > 0">
      <template #title>Conversation Setup</template>
      <template #content>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Agent *</label>
            <Select
              v-model="form.agentId"
              :options="availableAgents"
              optionLabel="name"
              optionValue="id"
              placeholder="Select an agent"
            />
            <small class="text-surface-400">Only active agents can start a new conversation.</small>
          </div>

          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Title</label>
            <InputText v-model="form.title" placeholder="Optional conversation title" />
            <small class="text-surface-400">Leave blank to auto-generate a title from the selected agent.</small>
          </div>
        </div>

        <div v-if="selectedAgent" class="mt-5 rounded-xl border border-surface-200 bg-surface-50 p-4">
          <div class="flex flex-wrap items-center gap-2">
            <Tag :value="selectedAgent.scope === 'workspace' ? 'Workspace' : 'Personal'" severity="info" />
            <Tag :value="selectedAgent.sourceType === 'database' ? 'Database' : 'Git'" severity="secondary" />
            <Tag :value="selectedAgent.status" :severity="selectedAgent.status === 'active' ? 'success' : 'secondary'" />
          </div>
          <p v-if="selectedAgent.description" class="mt-3 text-sm text-surface-600">{{ selectedAgent.description }}</p>
          <div class="mt-3 flex flex-wrap gap-4 text-xs text-surface-500">
            <span>Version: v{{ selectedAgent.version || 1 }}</span>
            <span>Last Session: {{ selectedAgent.lastSessionAt ? new Date(selectedAgent.lastSessionAt).toLocaleString() : 'Never' }}</span>
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-2">
          <NuxtLink :to="`/${ws}/conversations`">
            <Button label="Cancel" severity="secondary" />
          </NuxtLink>
          <Button label="Create Conversation" icon="pi pi-comments" :loading="saving" :disabled="!form.agentId" @click="createConversation" />
        </div>
      </template>
    </Card>

    <Card v-else>
      <template #content>
        <div class="py-8 text-center">
          <p class="text-surface-500">No active agents are available for conversation yet.</p>
          <NuxtLink :to="`/${ws}/agents`" class="mt-3 inline-block text-primary hover:underline">Open Agents</NuxtLink>
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const ws = computed(() => (route.params.workspace as string) || 'default');

const saving = ref(false);
const error = ref('');

const form = reactive({
  agentId: '',
  title: '',
});

const { data: agentsData } = await useFetch('/api/agents?limit=200', { headers });
const availableAgents = computed(() => ((agentsData.value as any)?.agents ?? []).filter((agent: any) => agent.status === 'active'));
const selectedAgent = computed(() => availableAgents.value.find((agent: any) => agent.id === form.agentId) ?? null);

watch(availableAgents, (agents) => {
  const requestedAgentId = typeof route.query.agentId === 'string' ? route.query.agentId : '';
  if (requestedAgentId && agents.some((agent: any) => agent.id === requestedAgentId)) {
    form.agentId = requestedAgentId;
    return;
  }

  if (!form.agentId && agents[0]?.id) {
    form.agentId = agents[0].id;
  }
}, { immediate: true });

async function createConversation() {
  if (!form.agentId) return;

  error.value = '';
  saving.value = true;
  try {
    const result = await $fetch<any>('/api/conversations', {
      method: 'POST',
      headers,
      body: {
        agentId: form.agentId,
        title: form.title.trim() || undefined,
      },
    });

    router.push(`/${ws.value}/conversations/${result.conversation.id}`);
  } catch (e: any) {
    error.value = e?.data?.error || 'Failed to create conversation.';
  } finally {
    saving.value = false;
  }
}
</script>