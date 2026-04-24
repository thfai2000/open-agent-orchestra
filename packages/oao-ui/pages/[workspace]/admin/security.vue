<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Admin' }, { label: 'Security' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold">Workspace Security</h1>
        <p class="text-muted-foreground text-sm mt-1">Control registration and access settings for this workspace</p>
      </div>
    </div>

    <Message v-if="saveError" severity="error" :closable="false" class="mb-4">{{ saveError }}</Message>
    <Message v-if="saveSuccess" severity="success" :closable="false" class="mb-4">Settings saved successfully.</Message>

    <div class="max-w-lg">
      <div class="rounded-lg border border-surface-200 bg-white p-5 flex flex-col gap-4">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="font-medium text-sm">Allow User Registration</p>
            <p class="text-surface-500 text-xs mt-0.5">When enabled, users can create their own accounts from the login page.</p>
          </div>
          <ToggleSwitch v-model="allowRegistration" :disabled="saving" />
        </div>
      </div>

      <div class="mt-4 flex justify-end">
        <Button label="Save" icon="pi pi-check" :loading="saving" @click="handleSave" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { user } = useAuth();
const ws = computed(() => user.value?.workspaceSlug || 'default');
const headers = authHeaders();

const allowRegistration = ref(true);
const saving = ref(false);
const saveError = ref('');
const saveSuccess = ref(false);

onMounted(async () => {
  try {
    const res = await $fetch<{ allowRegistration: boolean }>('/api/admin/security', { headers });
    allowRegistration.value = res.allowRegistration;
  } catch { /* ignore */ }
});

async function handleSave() {
  saveError.value = '';
  saveSuccess.value = false;
  saving.value = true;
  try {
    await $fetch('/api/admin/security', {
      method: 'PUT',
      headers,
      body: { allowRegistration: allowRegistration.value },
    });
    saveSuccess.value = true;
  } catch (e: any) {
    saveError.value = e?.data?.error || 'Failed to save settings.';
  } finally {
    saving.value = false;
  }
}
</script>
