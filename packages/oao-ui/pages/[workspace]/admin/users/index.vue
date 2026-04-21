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
        <h1 class="text-3xl font-bold">User Management</h1>
        <p class="text-muted-foreground text-sm mt-1">Manage workspace users and roles</p>
      </div>
      <NuxtLink :to="`/${ws}/admin/users/new`">
        <Button label="Create User" icon="pi pi-plus" />
      </NuxtLink>
    </div>

    <DataTable :value="users" paginator :rows="limit" :totalRecords="total" lazy @page="onPage($event)"
      stripedRows :loading="pending" dataKey="id" :rowsPerPageOptions="[10, 20, 50, 100]"
      @update:rows="onRowsChange">
      <template #empty><div class="text-center py-8 text-surface-400">No users found. Click Create User to get started.</div></template>
      <Column header="Name" style="min-width: 150px">
        <template #body="{ data }"><span class="font-medium">{{ data.name || data.email }}</span></template>
      </Column>
      <Column header="Email" style="min-width: 200px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ data.email }}</span></template>
      </Column>
      <Column header="Role" style="width: 150px">
        <template #body="{ data }"><Tag :value="formatRole(data.role)" :severity="roleSeverity(data.role)" /></template>
      </Column>
      <Column header="Joined" style="width: 150px">
        <template #body="{ data }"><span class="text-sm text-surface-500">{{ new Date(data.createdAt).toLocaleDateString() }}</span></template>
      </Column>
      <Column header="" style="width: 60px">
        <template #body="{ data }">
          <NuxtLink :to="`/${ws}/admin/users/${data.id}`">
            <Button icon="pi pi-pencil" text rounded size="small" />
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
const limit = ref(50);

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Admin' },
  { label: 'Users' },
]);

const { data, pending } = await useFetch(computed(() => `/api/admin/users?page=${page.value}&limit=${limit.value}`), { headers, watch: [page, limit] });
const users = computed(() => (data.value as any)?.users ?? []);
const total = computed(() => (data.value as any)?.total ?? 0);

function onPage(event: any) { page.value = event.page + 1; }
function onRowsChange(newRows: number) { limit.value = newRows; page.value = 1; }

function formatRole(role: string) {
  return { super_admin: 'Super Admin', workspace_admin: 'Admin', creator_user: 'Creator', view_user: 'Viewer' }[role] || role;
}

function roleSeverity(role: string) {
  return { super_admin: 'danger', workspace_admin: 'warn', creator_user: 'info', view_user: 'secondary' }[role] || 'secondary';
}
</script>
