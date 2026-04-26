<template>
  <div class="min-h-[80vh] flex items-center justify-center">
    <div class="w-full max-w-md">
      <Card>
        <template #title>
          <div class="text-center">
            <img src="/logo.png" alt="OAO" class="w-16 h-16 rounded-full mx-auto mb-3" />
            <h1 class="text-2xl font-bold">Forgot Password</h1>
            <p class="text-surface-500 text-sm mt-1">Enter your email to receive a reset link</p>
          </div>
        </template>
        <template #content>
          <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>
          <Message v-if="!allowPasswordReset" severity="warn" :closable="false" class="mb-4">
            Password reset is disabled for this workspace. Contact your workspace administrator.
          </Message>
          <Message v-if="sent" severity="success" :closable="false" class="mb-4">
            If that email is registered, a reset link has been sent. Check your inbox.
          </Message>

          <form v-if="!sent && allowPasswordReset" @submit.prevent="handleSubmit" class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <label for="email" class="text-sm font-medium">Email</label>
              <InputText id="email" v-model="email" type="email" required placeholder="you@example.com" />
            </div>
            <Button type="submit" :label="loading ? 'Sending...' : 'Send Reset Link'" :loading="loading" class="w-full" />
          </form>

          <p class="text-sm text-surface-500 text-center mt-6">
            <NuxtLink :to="`/${workspaceSlug}/login`" class="text-primary font-medium hover:underline">Back to Sign In</NuxtLink>
          </p>
        </template>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const workspaceSlug = computed(() => (route.params.workspace as string) || 'default');

const email = ref('');
const error = ref('');
const sent = ref(false);
const loading = ref(false);
const allowPasswordReset = ref(true);

onMounted(async () => {
  try {
    const res = await $fetch<{ allowPasswordReset: boolean }>(`/api/auth/providers?workspace=${workspaceSlug.value}`);
    allowPasswordReset.value = res.allowPasswordReset ?? true;
  } catch { /* keep the form available when provider metadata is unavailable */ }
});

async function handleSubmit() {
  if (!allowPasswordReset.value) return;
  error.value = '';
  loading.value = true;
  try {
    await $fetch('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: email.value, workspace: workspaceSlug.value },
    });
    sent.value = true;
  } catch (e: any) {
    error.value = e?.data?.error || 'An error occurred. Please try again.';
  } finally {
    loading.value = false;
  }
}
</script>
