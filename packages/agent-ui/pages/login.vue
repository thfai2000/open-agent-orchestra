<template>
  <div class="flex items-center justify-center min-h-screen">
    <p class="text-muted-foreground">Redirecting to login...</p>
  </div>
</template>

<script setup lang="ts">
const { user, isAuthenticated } = useAuth();

onMounted(() => {
  if (isAuthenticated.value && user.value?.workspaceSlug) {
    navigateTo(`/${user.value.workspaceSlug}`);
  } else {
    navigateTo('/default/login');
  }
});
</script>
