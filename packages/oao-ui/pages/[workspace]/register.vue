<template>
  <div class="min-h-[80vh] flex items-center justify-center">
    <div class="w-full max-w-md">
      <Card>
        <template #title>
          <div class="text-center">
            <img src="/logo.png" alt="OAO" class="w-16 h-16 rounded-full mx-auto mb-3" />
            <h1 class="text-2xl font-bold">Create Account</h1>
            <p class="text-surface-500 text-sm mt-1">Register for OAO</p>
          </div>
        </template>
        <template #content>
          <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>
          <Message v-if="success" severity="success" :closable="false" class="mb-4">{{ success }}</Message>

          <form @submit.prevent="handleRegister" class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <label for="name" class="text-sm font-medium">Name</label>
              <InputText id="name" v-model="form.name" required placeholder="Your name" />
            </div>
            <div class="flex flex-col gap-2">
              <label for="email" class="text-sm font-medium">Email</label>
              <InputText id="email" v-model="form.email" type="email" required placeholder="you@example.com" />
            </div>
            <div class="flex flex-col gap-2">
              <label for="password" class="text-sm font-medium">Password</label>
              <Password id="password" v-model="form.password" required placeholder="••••••••" toggleMask fluid />
            </div>
            <Button type="submit" :label="loading ? 'Creating...' : 'Create Account'" :loading="loading" class="w-full" />
          </form>

          <p class="text-sm text-surface-500 text-center mt-6">
            Already have an account?
            <NuxtLink :to="`/${workspaceSlug}/login`" class="text-primary font-medium hover:underline">Sign in</NuxtLink>
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

const form = reactive({ name: '', email: '', password: '' });
const error = ref('');
const success = ref('');
const loading = ref(false);

async function handleRegister() {
  error.value = '';
  success.value = '';
  loading.value = true;
  try {
    const res = await $fetch<{ token: string; user: any }>('/api/auth/register', {
      method: 'POST',
      body: { name: form.name, email: form.email, password: form.password, workspaceSlug: workspaceSlug.value },
    });
    setAuth(res.token, res.user);
    await nextTick();
    router.push(`/${res.user.workspaceSlug || workspaceSlug.value}`);
  } catch (e: any) {
    error.value = e?.data?.error || 'Registration failed.';
  } finally {
    loading.value = false;
  }
}
</script>
