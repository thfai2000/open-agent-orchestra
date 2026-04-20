<template>
  <div></div>
</template>

<script setup lang="ts">
const route = useRoute();
const ws = (route.params.workspace as string) || 'default';
navigateTo(`/${ws}/admin/rate-limits`, { replace: true });
</script>
