<template>
  <div class="min-h-[80vh] flex items-center justify-center">
    <div class="w-full max-w-md">
      <Card>
        <template #title>
          <div class="text-center">
            <img src="/logo.png" alt="OAO" class="w-16 h-16 rounded-full mx-auto mb-3" />
            <h1 class="text-2xl font-bold">OAO Login</h1>
            <p class="text-surface-500 text-sm mt-1">Sign in to your account</p>
          </div>
        </template>
        <template #content>
          <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>

          <div v-if="providers.length > 1" class="mb-4">
            <label class="block text-sm font-medium mb-2">Authentication Method</label>
            <SelectButton v-model="selectedProvider" :options="providers" optionLabel="label" optionValue="type" class="w-full" />
          </div>

          <form @submit.prevent="handleLogin" class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <label for="identifier" class="text-sm font-medium">{{ identifierLabel }}</label>
              <InputText
                id="identifier"
                v-model="form.identifier"
                :type="identifierInputType"
                required
                :placeholder="identifierPlaceholder"
              />
            </div>
            <div class="flex flex-col gap-2">
              <label for="password" class="text-sm font-medium">Password</label>
              <Password id="password" v-model="form.password" :feedback="false" required placeholder="••••••••" toggleMask fluid />
              <div v-if="showForgotPassword" class="text-right">
                <NuxtLink :to="`/${workspaceSlug}/forgot-password`" class="text-xs text-primary hover:underline">Forgot password?</NuxtLink>
              </div>
            </div>
            <Button type="submit" :label="loading ? 'Signing in...' : 'Sign In'" :loading="loading" class="w-full" />
          </form>

          <p v-if="allowRegistration" class="text-sm text-surface-500 text-center mt-6">
            Don't have an account?
            <NuxtLink :to="`/${workspaceSlug}/register`" class="text-primary font-medium hover:underline">Create one</NuxtLink>
          </p>
        </template>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
const { setAuth } = useAuth();
const router = useRouter();
const route = useRoute();
const workspaceSlug = computed(() => (route.params.workspace as string) || 'default');

const form = reactive({ identifier: '', password: '' });
const error = ref('');
const loading = ref(false);
const selectedProvider = ref('database');
const providers = ref<Array<{ type: string; name: string; label: string }>>([]);
const allowRegistration = ref(true);
const allowPasswordReset = ref(true);

const identifierLabel = computed(() => selectedProvider.value === 'ldap' ? 'Username or Email' : 'Email');
const identifierPlaceholder = computed(() => selectedProvider.value === 'ldap' ? 'username or email' : 'you@example.com');
const identifierInputType = computed(() => selectedProvider.value === 'ldap' ? 'text' : 'email');
const showForgotPassword = computed(() => selectedProvider.value === 'database' && allowPasswordReset.value);

onMounted(async () => {
  try {
    const res = await $fetch<{ providers: Array<{ type: string; name: string }>; allowRegistration: boolean; allowPasswordReset: boolean }>(`/api/auth/providers?workspace=${workspaceSlug.value}`);
    providers.value = res.providers.map(p => ({
      ...p,
      label: p.type === 'ldap' ? 'Active Directory' : 'Built-in Database',
    }));
    allowRegistration.value = res.allowRegistration ?? true;
    allowPasswordReset.value = res.allowPasswordReset ?? true;
    if (providers.value.length > 0) selectedProvider.value = providers.value[0].type;
  } catch {
    providers.value = [{ type: 'database', name: 'Database', label: 'Built-in Database' }];
  }
});

async function handleLogin() {
  error.value = '';
  loading.value = true;
  try {
    const res = await $fetch<{ token: string; user: any }>('/api/auth/login', {
      method: 'POST',
      body: { identifier: form.identifier, password: form.password, provider: selectedProvider.value },
    });
    setAuth(res.token, res.user);
    await nextTick();
    router.push(`/${res.user.workspaceSlug || workspaceSlug.value}`);
  } catch (e: any) {
    const status = e?.status || e?.statusCode;
    const msg = e?.data?.error || e?.statusMessage || '';
    if (status === 401) error.value = 'Invalid credentials.';
    else if (status === 400) error.value = msg || 'Authentication error.';
    else error.value = 'Cannot reach OAO API. Please check that the service is running.';
  } finally {
    loading.value = false;
  }
}
</script>
