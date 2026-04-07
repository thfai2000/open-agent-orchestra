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
      <NuxtLink to="/workflows/new">
        <Button>+ Create Workflow</Button>
      </NuxtLink>
    </div>

    <div class="space-y-3">
      <NuxtLink v-for="wf in workflows" :key="wf.id" :to="`/workflows/${wf.id}`" class="block">
        <Card class="hover:border-primary/40 transition">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardTitle class="text-lg">{{ wf.name }}</CardTitle>
              <div class="flex items-center gap-2">
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
    <p v-if="workflows.length === 0" class="text-muted-foreground text-center py-8">
      No workflows created yet. Click "Create Workflow" to get started.
    </p>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();

const { data } = await useFetch('/api/workflows', { headers });
const workflows = computed(() => data.value?.workflows ?? []);
</script>
