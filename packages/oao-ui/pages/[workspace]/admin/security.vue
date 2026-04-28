<template>
  <div class="py-8 text-sm text-surface-400">Redirecting to Settings…</div>
</template>
<script setup lang="ts">
// /admin/security has been merged into /admin/settings as of v3.1.
const route = useRoute();
const router = useRouter();
onMounted(() => {
  const ws = (route.params.workspace as string) || 'default';
  router.replace(`/${ws}/admin/settings`);
});
</script>
