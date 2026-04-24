<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Admin' }, { label: 'Mail Settings' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold">Mail Settings</h1>
        <p class="text-muted-foreground text-sm mt-1">Configure SMTP settings for password reset and system emails</p>
      </div>
    </div>

    <Message v-if="saveError" severity="error" :closable="false" class="mb-4">{{ saveError }}</Message>
    <Message v-if="saveSuccess" severity="success" :closable="false" class="mb-4">Mail settings saved successfully.</Message>

    <div class="max-w-lg flex flex-col gap-4">
      <div class="rounded-lg border border-surface-200 bg-white p-5 flex flex-col gap-4">
        <p class="text-sm font-semibold text-surface-600">SMTP Server</p>
        <div class="flex gap-3">
          <div class="flex-1 flex flex-col gap-2">
            <label class="text-sm font-medium">Host *</label>
            <InputText v-model="form.host" placeholder="smtp.example.com" />
          </div>
          <div class="w-28 flex flex-col gap-2">
            <label class="text-sm font-medium">Port *</label>
            <InputNumber v-model="form.port" :min="1" :max="65535" :useGrouping="false" />
          </div>
        </div>
        <div class="flex items-center gap-3">
          <ToggleSwitch v-model="form.secure" />
          <span class="text-sm">Use TLS/SSL</span>
        </div>
      </div>

      <div class="rounded-lg border border-surface-200 bg-white p-5 flex flex-col gap-4">
        <p class="text-sm font-semibold text-surface-600">Authentication (optional)</p>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">SMTP Username</label>
          <InputText v-model="form.user" placeholder="user@example.com" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">SMTP Password</label>
          <Password v-model="form.password" :feedback="false" toggleMask fluid placeholder="Leave blank to keep existing" />
        </div>
      </div>

      <div class="rounded-lg border border-surface-200 bg-white p-5 flex flex-col gap-4">
        <p class="text-sm font-semibold text-surface-600">Sender Identity</p>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">From Address *</label>
          <InputText v-model="form.fromAddress" type="email" placeholder="noreply@example.com" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="text-sm font-medium">From Name</label>
          <InputText v-model="form.fromName" placeholder="OAO Platform" />
        </div>
      </div>

      <div class="flex justify-end">
        <Button label="Save Mail Settings" icon="pi pi-check" :loading="saving" @click="handleSave" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { user } = useAuth();
const ws = computed(() => user.value?.workspaceSlug || 'default');
const headers = authHeaders();

const form = reactive({
  host: '',
  port: 587,
  secure: false,
  user: '',
  password: '',
  fromAddress: '',
  fromName: 'OAO Platform',
});

const saving = ref(false);
const saveError = ref('');
const saveSuccess = ref(false);

onMounted(async () => {
  try {
    const res = await $fetch<{ mailSettings: Record<string, unknown>; configured: boolean }>('/api/admin/mail-settings', { headers });
    if (res.configured && res.mailSettings) {
      const s = res.mailSettings;
      form.host = (s.host as string) || '';
      form.port = (s.port as number) || 587;
      form.secure = (s.secure as boolean) || false;
      form.user = (s.user as string) || '';
      form.fromAddress = (s.fromAddress as string) || '';
      form.fromName = (s.fromName as string) || 'OAO Platform';
    }
  } catch { /* ignore */ }
});

async function handleSave() {
  saveError.value = '';
  saveSuccess.value = false;
  if (!form.host || !form.port || !form.fromAddress) {
    saveError.value = 'Host, port, and from address are required.';
    return;
  }
  saving.value = true;
  try {
    const payload: Record<string, unknown> = { host: form.host, port: form.port, secure: form.secure, fromAddress: form.fromAddress, fromName: form.fromName };
    if (form.user) payload.user = form.user;
    if (form.password) payload.password = form.password;
    await $fetch('/api/admin/mail-settings', { method: 'PUT', headers, body: payload });
    saveSuccess.value = true;
  } catch (e: any) {
    saveError.value = e?.data?.error || 'Failed to save mail settings.';
  } finally {
    saving.value = false;
  }
}
</script>
