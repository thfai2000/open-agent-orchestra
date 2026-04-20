<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Settings' }, { label: 'Change Password' }]" class="mb-4">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <h1 class="text-2xl font-semibold mb-6">Change Password</h1>

    <Card class="max-w-md">
      <template #content>
        <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>
        <Message v-if="success" severity="success" :closable="false" class="mb-4">Password updated successfully.</Message>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-2"><label class="text-sm font-medium">Current Password</label><Password v-model="form.currentPassword" toggleMask :feedback="false" /></div>
          <div class="flex flex-col gap-2"><label class="text-sm font-medium">New Password</label><Password v-model="form.newPassword" toggleMask /></div>
          <div class="flex flex-col gap-2"><label class="text-sm font-medium">Confirm New Password</label><Password v-model="form.confirmPassword" toggleMask :feedback="false" /></div>
          <Button label="Update Password" icon="pi pi-check" :loading="saving" @click="handleSubmit" />
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');

const error = ref('');
const success = ref(false);
const saving = ref(false);
const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });

async function handleSubmit() {
  error.value = '';
  success.value = false;
  if (form.newPassword !== form.confirmPassword) { error.value = 'Passwords do not match.'; return; }
  if (form.newPassword.length < 8) { error.value = 'Password must be at least 8 characters.'; return; }
  saving.value = true;
  try {
    await $fetch('/api/auth/change-password', { method: 'PUT', headers, body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
    success.value = true;
    Object.assign(form, { currentPassword: '', newPassword: '', confirmPassword: '' });
  } catch (e: any) {
    error.value = e?.data?.error || 'Failed to change password.';
  } finally {
    saving.value = false;
  }
}
</script>
