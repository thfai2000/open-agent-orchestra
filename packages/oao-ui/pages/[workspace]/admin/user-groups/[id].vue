<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="loadError" class="py-12 text-center text-red-500">{{ loadError }}</div>
    <template v-else>
      <div class="flex items-center justify-between mb-6">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-3xl font-bold">{{ groupForm.name || '—' }}</h1>
            <Tag :value="`${members.length} member${members.length === 1 ? '' : 's'}`" severity="info" />
          </div>
          <p v-if="group?.description" class="text-muted-foreground text-sm mt-1">{{ group.description }}</p>
        </div>
        <div class="flex gap-2">
          <Button label="Save" icon="pi pi-check" :loading="saving" :disabled="!isDirty" @click="saveGroup" />
          <Button label="Delete Group" icon="pi pi-trash" severity="danger" outlined @click="confirmDelete" />
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card class="lg:col-span-1">
          <template #title>Group details</template>
          <template #content>
            <div class="flex flex-col gap-3">
              <label class="text-sm font-medium">Name</label>
              <InputText v-model="groupForm.name" />
              <label class="text-sm font-medium mt-2">Description</label>
              <Textarea v-model="groupForm.description" rows="3" />
              <label class="text-sm font-medium mt-2">Roles
                <span class="text-xs text-surface-400 font-normal block mt-0.5">Functionality flags inherited by every member.</span>
              </label>
              <MultiSelect
                v-model="groupForm.roleIds"
                :options="availableRoles"
                option-label="name"
                option-value="id"
                placeholder="Select roles"
                display="chip"
                filter
              />
              <label class="text-sm font-medium mt-2">AD Group DNs
                <span class="text-xs text-surface-400 font-normal block mt-0.5">On LDAP login, users with any of these DNs in <code>memberOf</code> are auto-added.</span>
              </label>
              <Chips v-model="groupForm.adGroupDns" placeholder="CN=Engineers,OU=..." :allow-duplicate="false" />
            </div>
          </template>
        </Card>

        <Card class="lg:col-span-2">
          <template #title>Members</template>
          <template #content>
            <div class="flex gap-2 mb-4">
              <Select
                v-model="addUserId"
                :options="addableUsers"
                option-label="label"
                option-value="id"
                placeholder="Select a user to add"
                filter
                class="flex-1"
              />
              <Button label="Add" icon="pi pi-user-plus" :disabled="!addUserId" @click="addMember" />
            </div>

            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <span class="p-input-icon-left flex-1 max-w-sm">
                <i class="pi pi-search" />
                <InputText v-model="memberFilters.global.value" placeholder="Search members by name, email, role…" class="w-full pl-8" />
              </span>
              <Button
                label="Remove selected"
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                :disabled="selectedMembers.length === 0"
                @click="confirmRemoveSelected"
              />
            </div>

            <DataTable
              v-model:selection="selectedMembers"
              :value="members"
              stripedRows
              dataKey="id"
              paginator
              :rows="10"
              :rowsPerPageOptions="[10, 25, 50, 100]"
              :globalFilterFields="['name', 'email', 'role', 'authProvider']"
              v-model:filters="memberFilters"
              :filterDisplay="undefined"
            >
              <template #empty><div class="text-center py-8 text-surface-400">No members yet.</div></template>
              <Column selectionMode="multiple" headerStyle="width: 3rem" />
              <Column header="Name" field="name" style="min-width: 160px">
                <template #body="{ data }"><span class="font-medium">{{ data.name || data.email }}</span></template>
              </Column>
              <Column header="Email" field="email" style="min-width: 200px">
                <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.email }}</span></template>
              </Column>
              <Column header="Role" field="role" style="width: 130px">
                <template #body="{ data }"><Tag :value="formatRole(data.role)" :severity="roleSeverity(data.role)" /></template>
              </Column>
              <Column header="Provider" field="authProvider" style="width: 130px">
                <template #body="{ data }"><Tag :value="data.authProvider === 'ldap' ? 'LDAP' : 'DB'" severity="secondary" /></template>
              </Column>
              <Column header="" style="width: 60px">
                <template #body="{ data }">
                  <Button icon="pi pi-times" text rounded size="small" @click="confirmRemoveMember(data)" />
                </template>
              </Column>
            </DataTable>
          </template>
        </Card>
      </div>
    </template>

    <ConfirmDialog />
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
const groupId = computed(() => route.params.id as string);

const loadError = ref('');
const saving = ref(false);
const group = ref<any>(null);
const members = ref<any[]>([]);
const groupForm = reactive<{ name: string; description: string; roleIds: string[]; adGroupDns: string[] }>({
  name: '', description: '', roleIds: [], adGroupDns: [],
});
const availableRoles = ref<any[]>([]);
const addUserId = ref<string | null>(null);
const selectedMembers = ref<any[]>([]);
const memberFilters = ref<Record<string, { value: string; matchMode: string }>>({
  global: { value: '', matchMode: 'contains' },
});

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Admin' },
  { label: 'User Groups', route: `/${ws.value}/admin/user-groups` },
  { label: group.value?.name || 'Group' },
]);

// All users in the workspace — used to populate the "add member" dropdown excluding existing members.
const { data: usersData } = await useFetch('/api/admin/users?limit=200', { headers });
const allUsers = computed<any[]>(() => (usersData.value as any)?.users ?? []);
const addableUsers = computed(() =>
  allUsers.value
    .filter((u) => !members.value.some((m) => m.id === u.id))
    .map((u) => ({ id: u.id, label: `${u.name || u.email} <${u.email}>` })),
);

const initialRoleIds = ref<string[]>([]);

async function loadGroup() {
  try {
    const res = await $fetch<{ group: any; members: any[]; roles?: any[] }>(`/api/user-groups/${groupId.value}`, { headers });
    group.value = res.group;
    members.value = res.members;
    groupForm.name = res.group.name;
    groupForm.description = res.group.description || '';
    groupForm.adGroupDns = Array.isArray(res.group.adGroupDns) ? [...res.group.adGroupDns] : [];
    groupForm.roleIds = (res.roles ?? []).map((r: any) => r.id);
    initialRoleIds.value = [...groupForm.roleIds];
  } catch (e: any) {
    loadError.value = e?.data?.error || 'Failed to load group';
  }
}

async function loadRoles() {
  try {
    const res = await $fetch<{ roles: any[] }>('/api/roles', { headers });
    availableRoles.value = res.roles;
  } catch { /* user may lack admin:rbac:read — leave empty */ }
}

await loadGroup();
await loadRoles();

const isDirty = computed(() => {
  if (!group.value) return false;
  if (groupForm.name !== group.value.name) return true;
  if ((groupForm.description || '') !== (group.value.description || '')) return true;
  const origDns: string[] = Array.isArray(group.value.adGroupDns) ? group.value.adGroupDns : [];
  if (groupForm.adGroupDns.length !== origDns.length) return true;
  if (groupForm.adGroupDns.some((d, i) => d !== origDns[i])) return true;
  if (groupForm.roleIds.length !== initialRoleIds.value.length) return true;
  if ([...groupForm.roleIds].sort().join(',') !== [...initialRoleIds.value].sort().join(',')) return true;
  return false;
});

async function saveGroup() {
  saving.value = true;
  try {
    await $fetch(`/api/user-groups/${groupId.value}`, {
      method: 'PUT',
      headers,
      body: {
        name: groupForm.name.trim(),
        description: groupForm.description.trim() || null,
        adGroupDns: groupForm.adGroupDns,
      },
    });
    // Roles are managed via a separate endpoint so super-admins without the
    // group-edit perm can still manage role bindings independently.
    try {
      await $fetch(`/api/user-groups/${groupId.value}/roles`, {
        method: 'PUT',
        headers,
        body: { roleIds: groupForm.roleIds },
      });
    } catch (e: any) {
      // permission failure is non-fatal here
      void e;
    }
    toast.add({ severity: 'success', summary: 'Saved', life: 2000 });
    await loadGroup();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Failed', detail: e?.data?.error || 'Error', life: 4000 });
  } finally {
    saving.value = false;
  }
}

async function addMember() {
  if (!addUserId.value) return;
  try {
    await $fetch(`/api/user-groups/${groupId.value}/members`, { method: 'POST', headers, body: { userId: addUserId.value } });
    addUserId.value = null;
    await loadGroup();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Failed to add', detail: e?.data?.error || 'Error', life: 4000 });
  }
}

async function removeMember(userId: string) {
  try {
    await $fetch(`/api/user-groups/${groupId.value}/members/${userId}`, { method: 'DELETE', headers });
    await loadGroup();
  } catch (e: any) {
    toast.add({ severity: 'error', summary: 'Failed to remove', detail: e?.data?.error || 'Error', life: 4000 });
  }
}

function confirmRemoveMember(member: any) {
  confirm.require({
    message: `Remove ${member.name || member.email} from this group?`,
    header: 'Confirm Remove',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Remove', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    accept: () => removeMember(member.id),
  });
}

function confirmRemoveSelected() {
  const targets = [...selectedMembers.value];
  if (targets.length === 0) return;
  confirm.require({
    message: `Remove ${targets.length} member${targets.length === 1 ? '' : 's'} from this group?`,
    header: 'Confirm Batch Remove',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Remove', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    accept: async () => {
      let failed = 0;
      for (const m of targets) {
        try {
          await $fetch(`/api/user-groups/${groupId.value}/members/${m.id}`, { method: 'DELETE', headers });
        } catch {
          failed += 1;
        }
      }
      selectedMembers.value = [];
      await loadGroup();
      if (failed > 0) {
        toast.add({ severity: 'error', summary: `${failed} removal${failed === 1 ? '' : 's'} failed`, life: 4000 });
      } else {
        toast.add({ severity: 'success', summary: `Removed ${targets.length} member${targets.length === 1 ? '' : 's'}`, life: 2000 });
      }
    },
  });
}

function confirmDelete() {
  confirm.require({
    message: `Delete group "${group.value?.name}"?`,
    header: 'Confirm Delete',
    icon: 'pi pi-exclamation-triangle',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary' },
    accept: async () => {
      try {
        await $fetch(`/api/user-groups/${groupId.value}`, { method: 'DELETE', headers });
        toast.add({ severity: 'success', summary: 'Deleted', life: 2000 });
        router.push(`/${ws.value}/admin/user-groups`);
      } catch (e: any) {
        toast.add({ severity: 'error', summary: 'Delete failed', detail: e?.data?.error || 'Error', life: 4000 });
      }
    },
  });
}

function formatRole(role: string) {
  return { super_admin: 'Super Admin', workspace_admin: 'Admin', creator_user: 'Creator', view_user: 'Viewer' }[role] || role;
}
function roleSeverity(role: string) {
  return { super_admin: 'danger', workspace_admin: 'warn', creator_user: 'info', view_user: 'secondary' }[role] || 'secondary';
}
</script>
