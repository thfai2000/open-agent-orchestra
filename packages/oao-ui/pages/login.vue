<script setup lang="ts">
const { user, isAuthenticated } = useAuth();
onMounted(() => {
  if (isAuthenticated.value && user.value?.workspaceSlug) navigateTo(`/${user.value.workspaceSlug}/login`);
  else navigateTo('/default/login');
});
</script>
<template><div /></template>
