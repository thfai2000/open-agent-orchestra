<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Settings' }, { label: 'API Tokens' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">API Tokens</h1>
        <p class="text-surface-500 text-sm mt-1">Create and manage personal API tokens</p>
      </div>
      <Button label="Create Token" icon="pi pi-plus" @click="showCreate = true" />
    </div>

    <!-- Show new token -->
    <Message v-if="newToken" severity="warn" :closable="true" class="mb-4" @close="newToken = ''">
      <div>
        <p class="font-medium mb-1">Copy your token now — it won't be shown again:</p>
        <code class="bg-surface-100 p-2 rounded text-sm block break-all select-all">{{ newToken }}</code>
      </div>
    </Message>

    <DataTable :value="tokens" stripedRows dataKey="id" :loading="pending">
      <template #empty><div class="text-center py-8 text-surface-400">No API tokens yet.</div></template>
      <Column header="Name" style="min-width: 150px">
        <template #body="{ data }"><span class="font-medium">{{ data.name }}</span></template>
      </Column>
      <Column header="Scopes" style="min-width: 200px">
        <template #body="{ data }">
          <div class="flex flex-wrap gap-1">
            <Tag v-for="s in (data.scopes || [])" :key="s" :value="s" severity="secondary" class="text-xs" />
          </div>
        </template>
      </Column>
      <Column header="Last Used" style="width: 160px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.lastUsedAt ? new Date(data.lastUsedAt).toLocaleString() : 'Never' }}</span></template>
      </Column>
      <Column header="Expires" style="width: 140px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : 'Never' }}</span></template>
      </Column>
      <Column header="Created" style="width: 140px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ new Date(data.createdAt).toLocaleDateString() }}</span></template>
      </Column>
      <Column header="" style="width: 60px">
        <template #body="{ data }">
          <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="handleDelete(data.id)" />
        </template>
      </Column>
    </DataTable>

    <!-- Create Dialog -->
    <Dialog v-model:visible="showCreate" header="Create API Token" :style="{ width: '500px' }" modal>
      <Message v-if="formError" severity="error" :closable="false" class="mb-3">{{ formError }}</Message>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name *</label><InputText v-model="form.name" placeholder="My API Token" /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Scopes</label>
          <div class="flex flex-wrap gap-2">
            <div v-for="s in availableScopes" :key="s" class="flex items-center gap-1">
              <Checkbox v-model="form.scopes" :inputId="'scope_' + s" :value="s" /><label :for="'scope_' + s" class="text-sm">{{ s }}</label>
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Expires In (days, 0 = never)</label>
          <InputNumber v-model="form.expiresInDays" :min="0" :max="365" />
        </div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showCreate = false" />
        <Button label="Create" icon="pi pi-check" :loading="saving" @click="handleCreate" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const confirm = useConfirm();
const ws = computed(() => (route.params.workspace as string) || 'default');

const showCreate = ref(false);
const saving = ref(false);
const formError = ref('');
const newToken = ref('');

const form = reactive({ name: '', scopes: [] as string[], expiresInDays: 30 });

const { data: tokensData, pending, refresh } = await useFetch('/api/tokens', { headers });
const tokens = computed(() => (tokensData.value as any)?.tokens ?? []);

const { data: scopesData } = await useFetch('/api/tokens/scopes', { headers });
const availableScopes = computed(() => (scopesData.value as any)?.scopes ?? ['read', 'write', 'admin']);

async function handleCreate() {
  formError.value = '';
  saving.value = true;
  try {
    const res = await $fetch<any>('/api/tokens', { method: 'POST', headers, body: form });
    newToken.value = res.token || res.key || '';
    showCreate.value = false;
    toast.add({ severity: 'success', summary: 'Token created', life: 3000 });
    Object.assign(form, { name: '', scopes: [], expiresInDays: 30 });
    await refresh();
  } catch (e: any) {
    formError.value = e?.data?.error || 'Failed';
  } finally {
    saving.value = false;
  }
}

function handleDelete(id: string) {
  confirm.require({
    message: 'Revoke this token?', header: 'Confirm', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' }, acceptProps: { label: 'Revoke', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/tokens/${id}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Token revoked', life: 3000 });
      await refresh();
    },
  });
}
</script>
