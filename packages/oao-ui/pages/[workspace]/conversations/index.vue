<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Conversations' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="mb-6 flex items-center justify-between gap-4">
      <div>
        <h1 class="text-3xl font-bold">Conversations</h1>
        <p class="text-muted-foreground text-sm mt-1">Chat history across your agents in this workspace.</p>
      </div>
      <NuxtLink :to="`/${ws}/conversations/new`">
        <Button label="New Conversation" icon="pi pi-plus" />
      </NuxtLink>
    </div>

    <DataTable
      :value="conversationRows"
      paginator
      :rows="limit"
      :totalRecords="total"
      lazy
      stripedRows
      dataKey="id"
      :loading="pending"
      :rowsPerPageOptions="[10, 20, 50, 100]"
      @page="onPage($event)"
      @update:rows="onRowsChange"
    >
      <template #empty>
        <div class="py-8 text-center text-surface-400">No conversations yet. Start one with an agent to begin chatting.</div>
      </template>

      <Column field="title" header="Conversation" style="min-width: 240px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/conversations/${data.id}`" class="font-medium text-primary hover:underline">{{ data.title }}</NuxtLink>
        </template>
      </Column>

      <Column header="Status" style="width: 120px">
        <template #body="{ data }">
          <Tag :value="data.status" :severity="data.status === 'active' ? 'success' : 'secondary'" />
        </template>
      </Column>

      <Column header="Messages" style="width: 100px">
        <template #body="{ data }">
          <span class="text-sm text-surface-600">{{ data.messageCount || 0 }}</span>
        </template>
      </Column>

      <Column header="Last Message" style="width: 180px">
        <template #body="{ data }">
          <span :title="data.lastMessageAt ? new Date(data.lastMessageAt).toString() : ''" class="text-sm text-surface-500">{{ data.lastMessageAt ? new Date(data.lastMessageAt).toLocaleString() : 'No messages yet' }}</span>
        </template>
      </Column>

      <Column header="Created" style="width: 180px">
        <template #body="{ data }">
          <span :title="new Date(data.createdAt).toString()" class="text-sm text-surface-500">{{ new Date(data.createdAt).toLocaleString() }}</span>
        </template>
      </Column>

      <Column header="" style="width: 60px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/conversations/${data.id}`">
            <Button icon="pi pi-arrow-right" text rounded size="small" />
          </NuxtLink>
        </template>
      </Column>
    </DataTable>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');

const page = ref(1);
const limit = ref(20);

const { data, pending } = await useFetch(
  computed(() => `/api/conversations?page=${page.value}&limit=${limit.value}`),
  { headers, watch: [page, limit] },
);

const conversationRows = computed(() => (data.value as any)?.conversations ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

function onPage(event: any) {
  page.value = event.page + 1;
}

function onRowsChange(newRows: number) {
  limit.value = newRows;
  page.value = 1;
}
</script>