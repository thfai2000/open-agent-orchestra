<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home', route: `/${ws}` }, { label: 'Admin' }, { label: 'Settings' }]" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold">Workspace Settings</h1>
        <p class="text-muted-foreground text-sm mt-1">Access controls, agent lifecycle tunables, and security guardrails for this workspace</p>
      </div>
    </div>

    <Message v-if="loadError" severity="error" :closable="false" class="mb-4">{{ loadError }}</Message>
    <Message v-if="saveError" severity="error" :closable="false" class="mb-4">{{ saveError }}</Message>
    <Message v-if="saveSuccess" severity="success" :closable="false" class="mb-4">Settings saved successfully.</Message>

    <div v-if="loading" class="py-8 text-sm text-surface-400">Loading settings...</div>

    <div v-else class="max-w-3xl flex flex-col gap-8">
      <!-- ─── Section: Access ─────────────────────────────────────── -->
      <section>
        <h2 class="text-lg font-semibold mb-1">Access</h2>
        <p class="text-surface-500 text-xs mb-3">Who can sign up and recover passwords for this workspace.</p>
        <div class="rounded-lg border border-surface-200 bg-white p-5 flex flex-col gap-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-medium text-sm">Allow User Registration</p>
              <p class="text-surface-500 text-xs mt-0.5">When enabled, users can create their own accounts from the login page.</p>
            </div>
            <ToggleSwitch v-model="form.allowRegistration" :disabled="saving" />
          </div>
          <Divider />
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-medium text-sm">Allow Forgot Password</p>
              <p class="text-surface-500 text-xs mt-0.5">When enabled, database-authenticated users can request password reset emails.</p>
            </div>
            <ToggleSwitch v-model="form.allowPasswordReset" :disabled="saving" />
          </div>
        </div>
      </section>

      <!-- ─── Section: Agent Lifecycle ────────────────────────────── -->
      <section>
        <h2 class="text-lg font-semibold mb-1">Agent Lifecycle</h2>
        <p class="text-surface-500 text-xs mb-3">Tune how long agent instance records linger before automatic cleanup. Values are in milliseconds.</p>
        <div class="rounded-lg border border-surface-200 bg-white p-5 flex flex-col gap-4">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <p class="font-medium text-sm">Ephemeral Agent Keep-Alive</p>
              <p class="text-surface-500 text-xs mt-0.5">How long terminated ephemeral agents (workflow workers) remain queryable after completing. Range: 1 minute (60000) – 7 days. Default: 1h ({{ formatMs(3600000) }}).</p>
            </div>
            <div class="flex flex-col items-end">
              <InputNumber v-model="form.ephemeralKeepAliveMs" :min="60000" :max="604800000" :disabled="saving" :step="60000" suffix=" ms" :show-buttons="false" :input-style="{ width: '12rem' }" />
              <span class="text-surface-400 text-[11px] mt-1">{{ formatMs(form.ephemeralKeepAliveMs) }}</span>
            </div>
          </div>
          <Divider />
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <p class="font-medium text-sm">Stale Static Agent Cleanup Period</p>
              <p class="text-surface-500 text-xs mt-0.5">How long a static agent can go without a heartbeat before its row is removed. Range: 1 minute – 30 days. Default: 24h ({{ formatMs(86400000) }}).</p>
            </div>
            <div class="flex flex-col items-end">
              <InputNumber v-model="form.staticCleanupIntervalMs" :min="60000" :max="2592000000" :disabled="saving" :step="60000" suffix=" ms" :show-buttons="false" :input-style="{ width: '12rem' }" />
              <span class="text-surface-400 text-[11px] mt-1">{{ formatMs(form.staticCleanupIntervalMs) }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- ─── Section: Security Guardrails ──────────────────────── -->
      <section>
        <h2 class="text-lg font-semibold mb-1">Security Guardrails</h2>
        <p class="text-surface-500 text-xs mb-3">Always-on protections that limit what running agents can read.</p>
        <div class="rounded-lg border border-surface-200 bg-white p-5 flex flex-col gap-4">
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1">
              <p class="font-medium text-sm flex items-center gap-2">
                Block credential reads via agent tools
                <span class="inline-flex items-center justify-center px-1.5 h-4 rounded-full bg-emerald-500/15 text-emerald-700 text-[10px] font-semibold">Recommended</span>
              </p>
              <p class="text-surface-500 text-xs mt-0.5">
                When enabled, tools such as <code>read_variables</code>, <code>workflow_get_variable</code>, and
                <code>workflow_list_variables</code> never return credential variables — not even masked.
                Credentials are still rendered server-side via <code v-pre>{{ credentials.KEY }}</code> Jinja2 tags
                in prompts, MCP configs, and HTTP request bodies. Disabling this is strongly discouraged.
              </p>
            </div>
            <ToggleSwitch v-model="form.disallowCredentialAccessViaTools" :disabled="saving" />
          </div>
        </div>
      </section>

      <div class="flex justify-end">
        <Button label="Save changes" icon="pi pi-check" :loading="saving" @click="handleSave" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { user, authHeaders } = useAuth();
const ws = computed(() => user.value?.workspaceSlug || 'default');
const headers = authHeaders();

interface Settings {
  allowRegistration: boolean;
  allowPasswordReset: boolean;
  ephemeralKeepAliveMs: number;
  staticCleanupIntervalMs: number;
  disallowCredentialAccessViaTools: boolean;
}

const form = reactive<Settings>({
  allowRegistration: true,
  allowPasswordReset: true,
  ephemeralKeepAliveMs: 3_600_000,
  staticCleanupIntervalMs: 86_400_000,
  disallowCredentialAccessViaTools: true,
});

const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const saveError = ref('');
const saveSuccess = ref(false);

function formatMs(ms: number): string {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 ? ' ' + (h % 24) + 'h' : ''}`;
}

onMounted(async () => {
  try {
    const res = await $fetch<Settings>('/api/admin/settings', { headers });
    form.allowRegistration = res.allowRegistration;
    form.allowPasswordReset = res.allowPasswordReset;
    form.ephemeralKeepAliveMs = res.ephemeralKeepAliveMs;
    form.staticCleanupIntervalMs = res.staticCleanupIntervalMs;
    form.disallowCredentialAccessViaTools = res.disallowCredentialAccessViaTools;
  } catch (e: any) {
    loadError.value = e?.data?.error || 'Failed to load workspace settings.';
  } finally {
    loading.value = false;
  }
});

async function handleSave() {
  saveError.value = '';
  saveSuccess.value = false;
  saving.value = true;
  try {
    await $fetch('/api/admin/settings', {
      method: 'PUT',
      headers,
      body: {
        allowRegistration: form.allowRegistration,
        allowPasswordReset: form.allowPasswordReset,
        ephemeralKeepAliveMs: form.ephemeralKeepAliveMs,
        staticCleanupIntervalMs: form.staticCleanupIntervalMs,
        disallowCredentialAccessViaTools: form.disallowCredentialAccessViaTools,
      },
    });
    saveSuccess.value = true;
  } catch (e: any) {
    saveError.value = e?.data?.error || 'Failed to save settings.';
  } finally {
    saving.value = false;
  }
}
</script>
