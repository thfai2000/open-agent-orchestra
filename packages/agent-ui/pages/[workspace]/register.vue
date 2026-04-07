<template>
  <div class="min-h-[80vh] flex items-center justify-center">
    <div class="w-full max-w-md p-8 rounded-lg border border-border bg-card">
      <h1 class="text-2xl font-bold text-center mb-2">Create Account</h1>
      <p class="text-sm text-muted-foreground text-center mb-6">
        Register for the Agent Orchestration Platform
      </p>

      <div v-if="error" class="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
        {{ error }}
      </div>

      <form @submit.prevent="handleRegister" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1.5">Name</label>
          <input
            v-model="form.name"
            type="text"
            required
            maxlength="100"
            class="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Your name"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1.5">Email</label>
          <input
            v-model="form.email"
            type="email"
            required
            class="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1.5">Password</label>
          <input
            v-model="form.password"
            type="password"
            required
            minlength="8"
            class="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Min. 8 characters"
          />
        </div>
        <button
          type="submit"
          :disabled="loading"
          class="w-full py-2 px-4 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition disabled:opacity-50"
        >
          {{ loading ? 'Creating account...' : 'Create Account' }}
        </button>
      </form>

      <p class="text-sm text-muted-foreground text-center mt-6">
        Already have an account?
        <NuxtLink :to="`/${workspaceSlug}/login`" class="text-primary hover:underline">Sign in</NuxtLink>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
const { setAuth } = useAuth();
const router = useRouter();
const route = useRoute();
const workspaceSlug = computed(() => (route.params.workspace as string) || 'default');
const form = reactive({ name: '', email: '', password: '' });
const error = ref('');
const loading = ref(false);

async function handleRegister() {
  error.value = '';
  loading.value = true;
  try {
    const res = await $fetch<{ token: string; user: { id: string; email: string; name: string; role: string; workspaceId: string; workspaceSlug: string } }>(
      '/api/auth/register',
      { method: 'POST', body: { ...form, workspaceSlug: workspaceSlug.value } },
    );
    setAuth(res.token, { ...res.user });
    await nextTick();
    router.push(`/${res.user.workspaceSlug || workspaceSlug.value}`);
  } catch (e: any) {
    const msg = e?.data?.error || e?.statusMessage || '';
    if (e?.status === 409) {
      error.value = 'This email is already registered. Try signing in instead.';
    } else {
      error.value = msg || 'Registration failed. Please try again.';
    }
  } finally {
    loading.value = false;
  }
}
</script>
