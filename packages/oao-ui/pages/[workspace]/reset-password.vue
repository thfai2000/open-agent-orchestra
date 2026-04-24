<template>
  <div class="min-h-[80vh] flex items-center justify-center">
    <div class="w-full max-w-md">
      <Card>
        <template #title>
          <div class="text-center">
            <img src="/logo.png" alt="OAO" class="w-16 h-16 rounded-full mx-auto mb-3" />
            <h1 class="text-2xl font-bold">Reset Password</h1>
            <p class="text-surface-500 text-sm mt-1">Enter your new password below</p>
          </div>
        </template>
        <template #content>
          <Message v-if="error" severity="error" :closable="false" class="mb-4">{{ error }}</Message>
          <Message v-if="success" severity="success" :closable="false" class="mb-4">
            Password reset successfully!
            <NuxtLink :to="`/${workspaceSlug}/login`" class="text-primary font-medium hover:underline ml-1">Sign in now</NuxtLink>
          </Message>

          <form v-if="!success && token" @submit.prevent="handleSubmit" class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <label for="password" class="text-sm font-medium">New Password</label>
              <Password id="password" v-model="password" required placeholder="••••••••" toggleMask fluid />
            </div>
            <Button type="submit" :label="loading ? 'Resetting...' : 'Reset Password'" :loading="loading" class="w-full" />
          </form>

          <div v-if="!token" class="text-center text-surface-400 py-4">
            <p>Invalid reset link.</p>
          </div>

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
const token = computed(() => route.query.token as string | undefined);

const password = ref('');
const error = ref('');
const success = ref(false);
const loading = ref(false);

async function handleSubmit() {
  error.value = '';
  loading.value = true;
  try {
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: { token: token.value, password: password.value },
    });
    success.value = true;
  } catch (e: any) {
    error.value = e?.data?.error || 'Password reset failed. The link may be expired.';
  } finally {
    loading.value = false;
  }
}
</script>
