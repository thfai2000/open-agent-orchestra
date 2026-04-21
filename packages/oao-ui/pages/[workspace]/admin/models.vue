<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Admin' }, { label: 'Models' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold">Model Registry</h1>
        <p class="text-muted-foreground text-sm mt-1">Configure available AI models and credit costs</p>
      </div>
      <Button label="Add Model" icon="pi pi-plus" @click="showCreate = true" />
    </div>

    <DataTable :value="models" stripedRows dataKey="id" :loading="pending">
      <template #empty><div class="text-center py-8 text-surface-400">No models configured.</div></template>
      <Column header="Name" style="min-width: 180px">
        <template #body="{ data }"><span class="font-medium">{{ data.name }}</span></template>
      </Column>
      <Column header="Provider" style="width: 130px">
        <template #body="{ data }"><Tag :value="data.provider || '—'" /></template>
      </Column>
      <Column header="Status" style="width: 100px">
        <template #body="{ data }"><Tag :value="data.isActive ? 'Active' : 'Inactive'" :severity="data.isActive ? 'success' : 'secondary'" /></template>
      </Column>
      <Column header="Credit Cost / Step" style="width: 160px">
        <template #body="{ data }"><span class="text-sm font-mono">{{ data.creditCost ?? '—' }}</span></template>
      </Column>
      <Column header="" style="width: 100px">
        <template #body="{ data }">
          <div class="flex gap-1">
            <Button icon="pi pi-pencil" text rounded size="small" @click="startEdit(data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="handleDelete(data.id)" />
          </div>
        </template>
      </Column>
    </DataTable>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:visible="showCreate" :header="editId ? 'Edit Model' : 'Add Model'" :style="{ width: '500px' }" modal>
      <Message v-if="formError" severity="error" :closable="false" class="mb-3">{{ formError }}</Message>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Name *</label><InputText v-model="form.name" /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Provider</label><InputText v-model="form.provider" placeholder="e.g. github, openai" /></div>
        <div class="flex flex-col gap-2"><label class="text-sm font-medium">Credit Cost per Step</label>
          <InputText v-model="form.creditCost" placeholder="1.00" />
          <small class="text-surface-400">Credits consumed per agent step using this model</small>
        </div>
        <div class="flex items-center gap-2"><Checkbox v-model="form.isActive" :binary="true" inputId="active" /><label for="active" class="text-sm">Active</label></div>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="closeDialog" />
        <Button :label="editId ? 'Save' : 'Create'" icon="pi pi-check" :loading="saving" @click="handleSubmit" />
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
const editId = ref<string | null>(null);

const form = reactive({ name: '', provider: '', creditCost: '1.00', isActive: true });

const { data, pending, refresh } = await useFetch('/api/admin/models', { headers });
const models = computed(() => (data.value as any)?.models ?? []);

function startEdit(m: any) {
  editId.value = m.id;
  Object.assign(form, { name: m.name, provider: m.provider || '', creditCost: m.creditCost ?? '1.00', isActive: m.isActive !== false });
  showCreate.value = true;
}

function closeDialog() {
  showCreate.value = false;
  editId.value = null;
  Object.assign(form, { name: '', provider: '', creditCost: '1.00', isActive: true });
  formError.value = '';
}

async function handleSubmit() {
  formError.value = '';
  saving.value = true;
  try {
    if (editId.value) {
      await $fetch(`/api/admin/models/${editId.value}`, { method: 'PUT', headers, body: form });
    } else {
      await $fetch('/api/admin/models', { method: 'POST', headers, body: form });
    }
    toast.add({ severity: 'success', summary: editId.value ? 'Updated' : 'Created', life: 3000 });
    closeDialog();
    await refresh();
  } catch (e: any) {
    formError.value = e?.data?.error || 'Failed';
  } finally {
    saving.value = false;
  }
}

function handleDelete(id: string) {
  confirm.require({
    message: 'Delete this model?', header: 'Confirm', icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary' }, acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await $fetch(`/api/admin/models/${id}`, { method: 'DELETE', headers });
      toast.add({ severity: 'success', summary: 'Deleted', life: 3000 });
      await refresh();
    },
  });
}
</script>
