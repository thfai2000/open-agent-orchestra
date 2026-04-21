<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="userData">
      <div class="mb-6">
        <h1 class="text-3xl font-bold">Edit User</h1>
        <p class="text-muted-foreground text-sm mt-1">{{ userData.email }}</p>
      </div>

      <Message v-if="error" severity="error" :closable="true" class="mb-4">{{ error }}</Message>
      <Message v-if="success" severity="success" :closable="true" class="mb-4">{{ success }}</Message>

      <Card class="max-w-lg">
        <template #content>
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium">Name</label>
              <InputText :model-value="userData.name" disabled />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium">Email</label>
              <InputText :model-value="userData.email" disabled />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium">Role *</label>
              <Select v-model="selectedRole" :options="roleOptions" optionLabel="label" optionValue="value" :disabled="userData.role === 'super_admin'" />
              <small v-if="userData.role === 'super_admin'" class="text-surface-400">Super Admin role cannot be changed.</small>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium">Joined</label>
              <p class="text-sm text-surface-500">{{ new Date(userData.createdAt).toLocaleString() }}</p>
            </div>
            <div class="flex gap-2 mt-2">
              <Button label="Save" icon="pi pi-check" :loading="saving" :disabled="userData.role === 'super_admin' || selectedRole === userData.role" @click="handleSave" />
              <NuxtLink :to="`/${ws}/admin/users`">
                <Button label="Cancel" severity="secondary" />
              </NuxtLink>
            </div>
          </div>
        </template>
      </Card>
    </div>
    <div v-else class="text-center py-12 text-surface-400">Loading user...</div>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');
const userId = computed(() => route.params.id as string);

const saving = ref(false);
const error = ref('');
const success = ref('');

const roleOptions = [
  { label: 'Admin', value: 'workspace_admin' },
  { label: 'Creator', value: 'creator_user' },
  { label: 'Viewer', value: 'view_user' },
];

const { data } = await useFetch<any>(computed(() => `/api/admin/users/${userId.value}`), { headers });
const userData = computed(() => data.value?.user ?? null);
const selectedRole = ref(userData.value?.role || 'creator_user');

watch(userData, (u) => {
  if (u) selectedRole.value = u.role;
}, { immediate: true });

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Admin' },
  { label: 'Users', route: `/${ws.value}/admin/users` },
  { label: userData.value?.name || userData.value?.email || 'Edit' },
]);

async function handleSave() {
  error.value = '';
  success.value = '';
  saving.value = true;
  try {
    await $fetch(`/api/admin/users/${userId.value}/role`, { method: 'PUT', headers, body: { role: selectedRole.value } });
    success.value = 'Role updated successfully.';
    toast.add({ severity: 'success', summary: 'Role updated', life: 3000 });
  } catch (e: any) {
    error.value = e?.data?.error || 'Failed to update role';
  } finally {
    saving.value = false;
  }
}
</script>
