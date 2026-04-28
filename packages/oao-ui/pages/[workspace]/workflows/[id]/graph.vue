<template>
  <div class="py-8 text-sm text-surface-400">Opening Visual Editor...</div>
</template>

<script setup lang="ts">
const route = useRoute();
await navigateTo(
  `/${route.params.workspace as string}/workflows/${route.params.id as string}?tab=visual`,
  { replace: true },
);
</script>