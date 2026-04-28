<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold">User Groups</h1>
        <p class="text-muted-foreground text-sm mt-1">
          Organize users into groups for bulk role assignment and shared resource scoping. Groups don't grant roles by themselves —
          manage the available role bundles under <NuxtLink :to="`/${ws}/admin/roles`" class="underline">Admin → Roles</NuxtLink>.
        </p>
      </div>
      <Button label="Create Group" icon="pi pi-plus" @click="openCreate" />
    </div>

    <DataTable :value="groups" stripedRows dataKey="id" :rowClass="() => 'cursor-pointer'" @rowClick="(e) => router.push(`/${ws}/admin/user-groups/${e.data.id}`)">
      <template #empty><div class="text-center py-8 text-surface-400">No user groups yet. Click Create Group to get started.</div></template>
      <Column header="Name" style="min-width: 200px">
        <template #body="{ data }"><NuxtLink :to="`/${ws}/admin/user-groups/${data.id}`" class="font-medium text-primary hover:underline">{{ data.name }}</NuxtLink></template>
      </Column>
      <Column header="Description" style="min-width: 280px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.description || '—' }}</span></template>
      </Column>
      <Column header="Members" style="width: 120px">
        <template #body="{ data }"><Tag :value="`${data.memberCount} member${data.memberCount === 1 ? '' : 's'}`" severity="info" /></template>
      </Column>
      <Column header="Created" style="width: 140px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ new Date(data.createdAt).toLocaleDateString() }}</span></template>
      </Column>
    </DataTable>

    <Dialog v-model:visible="createDialogVisible" header="Create User Group" :style="{ width: '32rem' }" modal>
      <div class="flex flex-col gap-3">
        <label class="text-sm font-medium">Name</label>
        <InputText v-model="newGroup.name" placeholder="e.g. Engineers" />
        <label class="text-sm font-medium mt-2">Description (optional)</label>
        <Textarea v-model="newGroup.description" rows="3" placeholder="What this group represents" />
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="createDialogVisible = false" />
        <Button label="Create" icon="pi pi-check" :loading="creating" @click="submitCreate" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Admin' },
  { label: 'User Groups' },
]);

const { data, refresh } = await useFetch('/api/user-groups', { headers });
const groups = computed<any[]>(() => (data.value as any)?.groups ?? []);

const createDialogVisible = ref(false);
const creating = ref(false);
const newGroup = reactive({ name: '', description: '' });

function openCreate() {
  newGroup.name = '';
  newGroup.description = '';
  createDialogVisible.value = true;
}

async function submitCreate() {
  if (!newGroup.name.trim()) return;
  creating.value = true;
  try {
    await $fetch('/api/user-groups', {
      method: 'POST',
      headers,
      body: { name: newGroup.name.trim(), description: newGroup.description.trim() || undefined },
    });
    toast.add({ severity: 'success', summary: 'Created', life: 2000 });
    createDialogVisible.value = false;
    await refresh();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Failed', detail: e?.data?.error || 'Error', life: 4000 });
  } finally {
    creating.value = false;
  }
}
</script>
