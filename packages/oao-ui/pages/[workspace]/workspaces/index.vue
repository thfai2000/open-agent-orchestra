<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Workspaces' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Workspaces</h1>
        <p class="text-surface-500 text-sm mt-1">Manage your workspaces</p>
      </div>
      <Button label="Create Workspace" icon="pi pi-plus" @click="showCreate = true" />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <Card v-for="w in workspaces" :key="w.id" class="cursor-pointer hover:shadow-md transition-shadow" @click="navigateToWorkspace(w.slug)">
        <template #content>
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-semibold">{{ w.name }}</h3>
              <p class="text-sm text-surface-400 font-mono">{{ w.slug }}</p>
              <p v-if="w.description" class="text-sm text-surface-500 mt-1">{{ w.description }}</p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <Tag :value="w.slug === ws ? 'Current' : 'Other'" :severity="w.slug === ws ? 'success' : 'secondary'" />
              <div class="flex gap-1">
                <Button icon="pi pi-pencil" text rounded size="small" @click.stop="startEditWorkspace(w)" />
                <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click.stop="handleDelete(w)" v-if="w.slug !== 'default'" />
              </div>
            </div>
          </div>
          <div class="text-xs text-surface-400 mt-3">Created {{ new Date(w.createdAt).toLocaleDateString() }}</div>
        </template>
      </Card>
    </div>

    <p v-if="workspaces.length === 0" class="text-center text-surface-400 py-8">No workspaces found.</p>

    <Dialog v-model:visible="showCreate" header="Create Workspace" :style="{ width: '450px' }" modal>
      <Message v-if="formError" severity="error" :closable="false" class="mb-3">{{ formError }}</Message>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name *</label><InputText v-model="form.name" /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Slug *</label><InputText v-model="form.slug" placeholder="my-workspace" />
          <small class="text-surface-400">URL-friendly identifier (lowercase, hyphens only)</small>
        </div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Description</label><Textarea v-model="form.description" rows="2" /></div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showCreate = false" />
        <Button label="Create" icon="pi pi-check" :loading="saving" @click="handleCreate" />
      </template>
    </Dialog>

    <!-- Edit Workspace Dialog -->
    <Dialog v-model:visible="showEdit" header="Edit Workspace" :style="{ width: '450px' }" modal>
      <Message v-if="editFormError" severity="error" :closable="false" class="mb-3">{{ editFormError }}</Message>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name *</label><InputText v-model="editForm.name" /></div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">Slug</label>
          <InputText :model-value="editForm.slug" disabled />
          <small class="text-surface-400">Slug cannot be changed after creation</small>
        </div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Description</label><Textarea v-model="editForm.description" rows="2" /></div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="showEdit = false" />
        <Button label="Save" icon="pi pi-check" :loading="savingEdit" @click="handleSaveEdit" />
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
const confirm = useConfirm();
const ws = computed(() => (route.params.workspace as string) || 'default');

const showCreate = ref(false);
const saving = ref(false);
const formError = ref('');

const form = reactive({ name: '', slug: '', description: '' });

const showEdit = ref(false);
const savingEdit = ref(false);
const editFormError = ref('');
const editForm = reactive({ id: '', name: '', slug: '', description: '' });

const { data: wsData, refresh } = await useFetch('/api/workspaces', { headers });
const workspaces = computed(() => (wsData.value as any)?.workspaces ?? []);

function navigateToWorkspace(slug: string) {
  router.push(`/${slug}`);
}

async function handleCreate() {
  formError.value = '';
  saving.value = true;
  try {
    await $fetch('/api/workspaces', { method: 'POST', headers, body: form });
    showCreate.value = false;
    toast.add({ severity: 'success', summary: 'Workspace created', life: 3000 });
    Object.assign(form, { name: '', slug: '', description: '' });
    await refresh();
  } catch (e: any) {
    formError.value = e?.data?.error || 'Failed';
  } finally {
    saving.value = false;
  }
}

function startEditWorkspace(w: any) {
  Object.assign(editForm, { id: w.id, name: w.name, slug: w.slug, description: w.description || '' });
  editFormError.value = '';
  showEdit.value = true;
}

async function handleSaveEdit() {
  editFormError.value = '';
  savingEdit.value = true;
  try {
    await $fetch(`/api/workspaces/${editForm.id}`, { method: 'PUT', headers, body: { name: editForm.name, description: editForm.description } });
    showEdit.value = false;
    toast.add({ severity: 'success', summary: 'Workspace updated', life: 3000 });
    await refresh();
  } catch (e: any) {
    editFormError.value = e?.data?.error || 'Failed';
  } finally {
    savingEdit.value = false;
  }
}

function handleDelete(w: any) {
  confirm.require({
    message: `Delete workspace "${w.name}"? This cannot be undone.`, header: 'Confirm Delete', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' }, acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/workspaces/${w.id}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Workspace deleted', life: 3000 });
      await refresh();
    },
  });
}
</script>
