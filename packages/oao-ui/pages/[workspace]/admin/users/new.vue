<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Admin' }, { label: 'Users', route: `/${ws}/admin/users` }, { label: 'Create User' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="mb-6">
      <h1 class="text-3xl font-bold">Create User</h1>
      <p class="text-muted-foreground text-sm mt-1">Add a new user to this workspace</p>
    </div>

    <Message v-if="error" severity="error" :closable="true" class="mb-4">{{ error }}</Message>

    <Card class="max-w-lg">
      <template #content>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Name</label>
            <InputText v-model="form.name" placeholder="Full name" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Email *</label>
            <InputText v-model="form.email" type="email" placeholder="user@example.com" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Password *</label>
            <Password v-model="form.password" toggleMask :feedback="false" />
          </div>
          <div class="flex flex-col gap-2">
            <label class="text-sm font-medium">Role</label>
            <Select v-model="form.role" :options="roleOptions" optionLabel="label" optionValue="value" />
          </div>
          <div class="flex gap-2 mt-2">
            <Button label="Create" icon="pi pi-check" :loading="saving" @click="handleCreate" />
            <NuxtLink :to="`/${ws}/admin/users`">
              <Button label="Cancel" severity="secondary" />
            </NuxtLink>
          </div>
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const ws = computed(() => (route.params.workspace as string) || 'default');

const saving = ref(false);
const error = ref('');

const roleOptions = [
  { label: 'Admin', value: 'workspace_admin' },
  { label: 'Creator', value: 'creator_user' },
  { label: 'Viewer', value: 'view_user' },
];

const form = reactive({ name: '', email: '', password: '', role: 'creator_user' });

async function handleCreate() {
  error.value = '';
  saving.value = true;
  try {
    await $fetch('/api/admin/users', { method: 'POST', headers, body: form });
    toast.add({ severity: 'success', summary: 'User created', life: 3000 });
    router.push(`/${ws.value}/admin/users`);
  } catch (e: any) {
    error.value = e?.data?.error || 'Failed to create user';
  } finally {
    saving.value = false;
  }
}
</script>
