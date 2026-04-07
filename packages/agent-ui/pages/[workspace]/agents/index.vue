<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Agents</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex items-center justify-between mt-4 mb-6">
      <div>
        <h1 class="text-3xl font-bold">Agents</h1>
        <p class="text-muted-foreground text-sm mt-1">Git-hosted AI agent definitions with Copilot SDK integration</p>
      </div>
      <NuxtLink :to="`/${ws}/agents/new`">
        <Button>+ Create Agent</Button>
      </NuxtLink>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <NuxtLink v-for="agent in agents" :key="agent.id" :to="`/${ws}/agents/${agent.id}`" class="block">
        <Card class="hover:border-primary/40 transition h-full">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardTitle class="text-lg">{{ agent.name }}</CardTitle>
              <div class="flex items-center gap-2">
                <Badge v-if="agent.scope === 'workspace'" variant="outline" class="text-xs">Workspace</Badge>
                <Badge :variant="agent.status === 'active' ? 'default' : agent.status === 'paused' ? 'secondary' : 'destructive'">
                  {{ agent.status }}
                </Badge>
              </div>
            </div>
            <CardDescription v-if="agent.description">{{ agent.description }}</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-4 text-xs text-muted-foreground">
              <span class="truncate max-w-[250px] font-mono">{{ agent.gitRepoUrl }}</span>
              <span v-if="agent.lastSessionAt" class="ml-auto whitespace-nowrap">Last: {{ new Date(agent.lastSessionAt).toLocaleDateString() }}</span>
            </div>
          </CardContent>
        </Card>
      </NuxtLink>
    </div>
    <p v-if="agents.length === 0" class="text-muted-foreground text-center py-8">
      No agents registered yet. Click "Create Agent" to get started.
    </p>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');

const { data } = await useFetch('/api/agents', { headers });
const agents = computed(() => data.value?.agents ?? []);
</script>
