<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Workflows</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex items-center justify-between mt-4 mb-6">
      <div>
        <h1 class="text-3xl font-bold">Workflows</h1>
        <p class="text-muted-foreground text-sm mt-1">Multi-step AI workflows with scheduled and manual triggers</p>
      </div>
      <NuxtLink :to="`/${ws}/workflows/new`">
        <Button>+ Create Workflow</Button>
      </NuxtLink>
    </div>

    <!-- Label filter -->
    <div v-if="allLabels.length > 0" class="mb-4 flex flex-wrap items-center gap-2">
      <span class="text-sm text-muted-foreground mr-1">Filter by label:</span>
      <Badge
        v-for="label in allLabels" :key="label"
        :variant="selectedLabels.includes(label) ? 'default' : 'outline'"
        class="cursor-pointer select-none"
        @click="toggleLabel(label)"
      >
        {{ label }}
      </Badge>
      <button v-if="selectedLabels.length > 0" class="text-xs text-muted-foreground hover:text-foreground ml-2" @click="selectedLabels = []">Clear</button>
    </div>

    <div class="space-y-3">
      <NuxtLink v-for="wf in filteredWorkflows" :key="wf.id" :to="`/${ws}/workflows/${wf.id}`" class="block">
        <Card class="hover:border-primary/40 transition">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardTitle class="text-lg">{{ wf.name }}</CardTitle>
              <div class="flex items-center gap-2">
                <Badge v-for="label in (wf.labels || [])" :key="label" variant="secondary" class="text-xs">{{ label }}</Badge>
                <Badge v-if="wf.scope === 'workspace'" variant="outline" class="text-xs">Workspace</Badge>
                <Badge variant="outline" class="font-mono">v{{ wf.version }}</Badge>
                <Badge :variant="wf.isActive ? 'default' : 'secondary'">{{ wf.isActive ? 'Active' : 'Inactive' }}</Badge>
              </div>
            </div>
            <CardDescription v-if="wf.description">{{ wf.description }}</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Owner: {{ wf.ownerName || 'Unknown' }}</span>
              <span v-if="wf.lastExecutionAt">Last Run: {{ new Date(wf.lastExecutionAt).toLocaleString() }}</span>
              <span v-else class="italic">Never run</span>
            </div>
          </CardContent>
        </Card>
      </NuxtLink>
    </div>
    <p v-if="filteredWorkflows.length === 0 && workflows.length > 0" class="text-muted-foreground text-center py-8">
      No workflows match the selected labels.
    </p>
    <p v-if="workflows.length === 0" class="text-muted-foreground text-center py-8">
      No workflows created yet. Click "Create Workflow" to get started.
    </p>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');

const { data } = await useFetch('/api/workflows', { headers });
const workflows = computed(() => data.value?.workflows ?? []);

const { data: labelsData } = await useFetch('/api/workflows/labels', { headers });
const allLabels = computed(() => (labelsData.value as any)?.labels ?? []);

const selectedLabels = ref<string[]>([]);

function toggleLabel(label: string) {
  if (selectedLabels.value.includes(label)) {
    selectedLabels.value = selectedLabels.value.filter(l => l !== label);
  } else {
    selectedLabels.value = [...selectedLabels.value, label];
  }
}

const filteredWorkflows = computed(() => {
  if (selectedLabels.value.length === 0) return workflows.value;
  return workflows.value.filter((wf: any) =>
    selectedLabels.value.every(label => (wf.labels || []).includes(label)),
  );
});
</script>
