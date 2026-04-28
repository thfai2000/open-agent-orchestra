<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="!editingId" class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold">Roles</h1>
        <p class="text-muted-foreground text-sm mt-1">
          Roles bundle <strong>functionality flags</strong> that grant access to specific platform actions. Bind roles to user-groups
          under <NuxtLink :to="`/${ws}/admin/user-groups`" class="underline">User Groups</NuxtLink>.
        </p>
      </div>
      <Button label="Create Role" icon="pi pi-plus" :disabled="!canEdit" @click="openCreate" />
    </div>

    <div v-if="pageError" class="mb-6">
      <Message severity="error" :closable="false">{{ pageError }}</Message>
      <div class="mt-3">
        <Button label="Retry" icon="pi pi-refresh" severity="secondary" @click="loadPage" />
      </div>
    </div>

    <div v-else-if="pageLoading && !editingId" class="py-12 text-center text-surface-400">Loading roles...</div>

    <DataTable v-else-if="!editingId" :value="roles" stripedRows dataKey="id" :rowClass="() => 'cursor-pointer'" @rowClick="(e) => editingId = e.data.id">
      <template #empty><div class="text-center py-8 text-surface-400">No roles yet.</div></template>
      <Column header="Name" style="min-width: 220px">
        <template #body="{ data }">
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ data.name }}</span>
            <Tag v-if="data.isSystem" value="System" severity="info" />
            <Tag v-if="data.workspaceId === null" value="Global" severity="secondary" />
          </div>
          <div class="text-xs text-surface-500 mt-1">{{ data.description }}</div>
        </template>
      </Column>
      <Column header="Functionalities" style="width: 160px">
        <template #body="{ data }"><Tag :value="`${data.functionalityCount} flag${data.functionalityCount === 1 ? '' : 's'}`" /></template>
      </Column>
      <Column header="Bound Groups" style="width: 140px">
        <template #body="{ data }"><Tag :value="`${data.groupCount}`" severity="success" /></template>
      </Column>
      <Column header="Created" style="width: 140px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ new Date(data.createdAt).toLocaleDateString() }}</span></template>
      </Column>
    </DataTable>

    <!-- Edit pane -->
    <div v-else>
      <Button icon="pi pi-arrow-left" label="Back to roles" text @click="closeEdit" class="mb-4" />
      <div v-if="detailLoading" class="py-12 text-center text-surface-400">Loading role...</div>
      <div v-else-if="currentRole">
        <h2 class="text-2xl font-bold mb-1">{{ currentRole.role.name }}</h2>
        <div class="flex flex-wrap items-center gap-1.5 mt-1 mb-4">
          <Tag v-if="currentRole.role.isSystem" value="System role" severity="info" />
          <Tag v-if="currentRole.role.workspaceId === null" value="Global" severity="secondary" />
          <Tag :value="`${selectedKeys.length} flag${selectedKeys.length === 1 ? '' : 's'}`" />
        </div>
        <p v-if="currentRole.role.description" class="text-sm text-surface-400 mb-4">{{ currentRole.role.description }}</p>

        <h3 class="text-lg font-semibold mb-2">Functionalities</h3>
        <p class="text-sm text-surface-400 mb-4">Tick the actions this role can perform. <span v-if="!canEdit">You need <code>admin:rbac:manage</code> to edit.</span></p>

        <div v-for="(group, cat) in groupedFunctionalities" :key="cat" class="mb-6">
          <h4 class="text-md font-semibold mb-2 capitalize">{{ cat }}</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pl-2">
            <label v-for="f in group" :key="f.key" class="flex items-start gap-2 cursor-pointer">
              <Checkbox v-model="selectedKeys" :inputId="f.key" :value="f.key" :disabled="!canEdit" />
              <div>
                <div class="text-sm font-medium">{{ f.label }} <code class="text-xs text-surface-500">{{ f.key }}</code></div>
                <div v-if="f.description" class="text-xs text-surface-500">{{ f.description }}</div>
              </div>
            </label>
          </div>
        </div>

        <div class="flex justify-end gap-2 sticky bottom-0 bg-surface-900 py-3">
          <Button label="Reset" severity="secondary" @click="resetSelection" />
          <Button label="Save" icon="pi pi-check" :loading="saving" :disabled="!canEdit" @click="saveBindings" />
        </div>
      </div>
      <div v-else class="py-12 text-center text-surface-400">Role not found.</div>
    </div>

    <Dialog v-model:visible="createDialogVisible" header="Create Role" :style="{ width: '32rem' }" modal>
      <div class="flex flex-col gap-3">
        <label class="text-sm font-medium">Name</label>
        <InputText v-model="newRole.name" placeholder="e.g. Approver" />
        <label class="text-sm font-medium mt-2">Description</label>
        <Textarea v-model="newRole.description" rows="3" />
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" @click="createDialogVisible = false" />
        <Button label="Create" icon="pi pi-check" :loading="creating" @click="submitCreate" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
interface Role { id: string; workspaceId: string | null; name: string; description: string | null; isSystem: boolean; createdAt: string; functionalityCount: number; groupCount: number; }
interface Functionality { key: string; resource: string; action: string; label: string; description: string | null; category: string; isSystem: boolean; }
interface RoleDetail { role: Role & { workspaceId: string | null; isSystem: boolean }; functionalityKeys: string[]; functionalities: Functionality[]; }

const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');

const roles = ref<Role[]>([]);
const allFunctionalities = ref<Functionality[]>([]);
const editingId = ref<string | null>(null);
const currentRole = ref<RoleDetail | null>(null);
const selectedKeys = ref<string[]>([]);
const initialKeys = ref<string[]>([]);
const saving = ref(false);
const pageLoading = ref(false);
const detailLoading = ref(false);
const pageError = ref('');
const effectiveFlags = ref<Set<string>>(new Set());

const createDialogVisible = ref(false);
const creating = ref(false);
const newRole = reactive({ name: '', description: '' });

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Admin' },
  editingId.value ? { label: 'Roles', route: `/${ws.value}/admin/roles`, command: () => closeEdit() } : { label: 'Roles' },
  ...(editingId.value && currentRole.value ? [{ label: currentRole.value.role.name }] : []),
]);

const canEdit = computed(() => effectiveFlags.value.has('*') || effectiveFlags.value.has('admin:rbac:manage'));

const groupedFunctionalities = computed(() => {
  const groups: Record<string, Functionality[]> = {};
  for (const f of allFunctionalities.value) {
    (groups[f.category] ??= []).push(f);
  }
  return groups;
});

async function loadRoles() {
  const data = await $fetch<{ roles: Role[] }>('/api/roles', { baseURL: '/', headers });
  roles.value = data.roles;
}

async function loadFunctionalities() {
  const data = await $fetch<{ functionalities: Functionality[] }>('/api/functionalities', { baseURL: '/', headers });
  allFunctionalities.value = data.functionalities;
}

async function loadEffective() {
  try {
    const data = await $fetch<{ functionalityKeys: string[] }>('/api/roles/me/effective', { baseURL: '/', headers });
    effectiveFlags.value = new Set(data.functionalityKeys);
  } catch { /* viewer or auth issue */ }
}

async function loadRole(id: string) {
  detailLoading.value = true;
  pageError.value = '';
  try {
    const data = await $fetch<RoleDetail>(`/api/roles/${id}`, { baseURL: '/', headers });
    currentRole.value = data;
    selectedKeys.value = [...data.functionalityKeys];
    initialKeys.value = [...data.functionalityKeys];
  } catch (e: unknown) {
    pageError.value = (e as { data?: { error?: string } })?.data?.error ?? 'Failed to load role details.';
    currentRole.value = null;
    selectedKeys.value = [];
    initialKeys.value = [];
  } finally {
    detailLoading.value = false;
  }
}

watch(editingId, async (id) => {
  if (id) await loadRole(id);
  else {
    currentRole.value = null;
    selectedKeys.value = [];
    initialKeys.value = [];
    pageError.value = '';
  }
});

function closeEdit() { editingId.value = null; }
function resetSelection() { selectedKeys.value = [...initialKeys.value]; }

async function loadPage() {
  pageLoading.value = true;
  pageError.value = '';
  try {
    await Promise.all([loadRoles(), loadFunctionalities(), loadEffective()]);
  } catch (e: unknown) {
    pageError.value = (e as { data?: { error?: string } })?.data?.error ?? 'Failed to load roles.';
  } finally {
    pageLoading.value = false;
  }
}

async function saveBindings() {
  if (!editingId.value) return;
  saving.value = true;
  try {
    await $fetch(`/api/roles/${editingId.value}/functionalities`, {
      method: 'PUT', baseURL: '/', headers, body: { functionalityKeys: selectedKeys.value },
    });
    toast.add({ severity: 'success', summary: 'Saved', detail: 'Role functionalities updated', life: 3000 });
    initialKeys.value = [...selectedKeys.value];
    await loadRoles();
  } catch (e: unknown) {
    const msg = (e as { data?: { error?: string } })?.data?.error ?? 'Save failed';
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 });
  } finally { saving.value = false; }
}

function openCreate() { newRole.name = ''; newRole.description = ''; createDialogVisible.value = true; }
async function submitCreate() {
  creating.value = true;
  try {
    await $fetch('/api/roles', { method: 'POST', baseURL: '/', headers, body: newRole });
    createDialogVisible.value = false;
    await loadRoles();
    toast.add({ severity: 'success', summary: 'Created', life: 3000 });
  } catch (e: unknown) {
    const msg = (e as { data?: { error?: string } })?.data?.error ?? 'Create failed';
    toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 5000 });
  } finally { creating.value = false; }
}

onMounted(() => { void loadPage(); });
</script>
