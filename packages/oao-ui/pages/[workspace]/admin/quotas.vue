<script setup lang="ts">
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');

await navigateTo(`/${ws.value}/admin/rate-limits`, { redirectCode: 301 });
</script>
