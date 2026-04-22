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
                  'max-w-[85%] rounded-2xl px-4 py-3 shadow-sm',
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

                  <div v-if="message.role === 'assistant' && message.content" class="text-sm leading-6">
                    <MarkdownRenderer :content="message.content" theme="light" />
                  </div>
                  <p v-else-if="message.content" class="whitespace-pre-wrap text-sm leading-6">{{ message.content }}</p>
                  <p v-else class="text-sm italic" :class="message.role === 'user' ? 'text-primary-100' : 'text-surface-400'">{{ message.status === 'pending' ? 'Thinking…' : 'No content.' }}</p>

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
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="text-xs text-surface-500">
                  <span v-if="streamConnected" class="inline-flex items-center gap-1 text-green-600">
                    <span class="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                    Live stream connected
                  </span>
                  <span v-else>Responses are delivered when the agent finishes the turn.</span>
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
                  <span class="text-surface-500">Agent</span>
                  <p class="font-medium text-surface-900">{{ agent?.name || conversation.agentNameSnapshot }}</p>
                </div>
                <div>
                  <span class="text-surface-500">Last Message</span>
                  <p class="font-medium text-surface-900">{{ conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString() : 'None yet' }}</p>
                </div>
                <div>
                  <span class="text-surface-500">Messages</span>
                  <p class="font-medium text-surface-900">{{ localMessages.length }}</p>
                </div>
              </div>
            </template>
          </Card>

          <Card>
            <template #title>History</template>
            <template #content>
              <p class="text-sm text-surface-500">Open your full conversation list to switch agents or resume another thread.</p>
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

interface LocalConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  status: 'pending' | 'completed' | 'failed';
  content: string;
  createdAt: string;
  updatedAt: string;
  error?: string | null;
  model?: string | null;
  _optimistic?: boolean;
}

const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');
const conversationId = computed(() => route.params.id as string);

const draft = ref('');
const sending = ref(false);
const localMessages = ref<LocalConversationMessage[]>([]);
const messagesContainerRef = ref<HTMLElement | null>(null);
const pendingAssistantClientId = ref<string | null>(null);

const { data, refresh: refreshConversation } = await useFetch<any>(computed(() => `/api/conversations/${conversationId.value}`), { headers });
const conversation = computed(() => data.value?.conversation ?? null);
const agent = computed(() => data.value?.agent ?? null);

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Conversations', route: `/${ws.value}/conversations` },
  { label: conversation.value?.title || 'Loading...' },
]);

watch(() => data.value?.messages, (messages) => {
  localMessages.value = ((messages ?? []) as any[]).map((message) => ({
    id: message.id,
    role: message.role,
    status: message.status,
    content: message.content || '',
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    error: message.error,
    model: message.model,
  }));
  pendingAssistantClientId.value = null;
  scrollToBottom(false);
}, { immediate: true });

const canCompose = computed(() => !!conversation.value && conversation.value.status === 'active' && (!agent.value || agent.value.status === 'active'));
const hasPendingAssistant = computed(() => localMessages.value.some((message) => message.role === 'assistant' && message.status === 'pending'));
const canSend = computed(() => canCompose.value && !sending.value && !hasPendingAssistant.value && !!draft.value.trim());
const streamEnabled = computed(() => !!conversation.value);
const { connected: streamConnected, on: onStreamEvent } = useConversationStream(conversationId, { enabled: streamEnabled });

const agentWarning = computed(() => {
  if (!conversation.value) return '';
  if (!agent.value) {
    return `The original agent for this conversation is no longer available. You can still read the transcript, but new messages are disabled.`;
  }
  if (agent.value.status !== 'active') {
    return `Agent ${agent.value.name} is currently ${agent.value.status}. Activate it before sending a new message.`;
  }
  if (conversation.value.status !== 'active') {
    return 'This conversation is archived and cannot receive new messages.';
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
    });
  }

  scrollToBottom();
});

onStreamEvent('conversation.message.delta', (event: any) => {
  const messageId = event.messageId;
  const delta = event.data?.delta || '';
  if (!messageId || !delta) return;

  const target = localMessages.value.find((message) => message.id === messageId)
    ?? localMessages.value.find((message) => message.id === pendingAssistantClientId.value);
  if (!target) return;

  if (target.id !== messageId) target.id = messageId;
  target.content += delta;
  target.updatedAt = new Date().toISOString();
  scrollToBottom();
});

onStreamEvent('conversation.message.completed', async (event: any) => {
  const messageId = event.messageId;
  const target = localMessages.value.find((message) => message.id === messageId)
    ?? localMessages.value.find((message) => message.id === pendingAssistantClientId.value);
  if (target) {
    target.id = messageId;
    target.status = 'completed';
    if (event.data?.content) target.content = event.data.content;
    target.model = event.data?.model || target.model;
    target.updatedAt = new Date().toISOString();
  }

  pendingAssistantClientId.value = null;
  await refreshConversation();
  scrollToBottom();
});

onStreamEvent('conversation.message.failed', async (event: any) => {
  const messageId = event.messageId;
  const target = localMessages.value.find((message) => message.id === messageId)
    ?? localMessages.value.find((message) => message.id === pendingAssistantClientId.value);
  if (target) {
    target.id = messageId || target.id;
    target.status = 'failed';
    target.error = event.data?.error || 'Response failed.';
    target.updatedAt = new Date().toISOString();
  }

  pendingAssistantClientId.value = null;
  toast.add({ severity: 'error', summary: 'Conversation Failed', detail: event.data?.error || 'Failed to receive assistant response.', life: 5000 });
  await refreshConversation();
  scrollToBottom();
});

function formatMessageTime(value: string) {
  return new Date(value).toLocaleString();
}

function scrollToBottom(smooth = true) {
  nextTick(() => {
    messagesContainerRef.value?.scrollTo({
      top: messagesContainerRef.value.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  });
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
    _optimistic: true,
  });
  localMessages.value.push({
    id: assistantMessageId,
    role: 'assistant',
    status: 'pending',
    content: '',
    createdAt: now,
    updatedAt: now,
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
      body: { content },
    });

    await refreshConversation();
  } catch (e: any) {
    const message = e?.data?.error || 'Failed to send message.';
    const target = localMessages.value.find((entry) => entry.id === pendingAssistantClientId.value);
    if (target) {
      target.status = 'failed';
      target.error = message;
    }
    toast.add({ severity: 'error', summary: 'Send Failed', detail: message, life: 5000 });
    await refreshConversation();
  } finally {
    sending.value = false;
  }
}
</script>