<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Executions</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <h1 class="text-3xl font-bold mt-4 mb-6">Workflow Executions</h1>

    <Card>
      <CardContent class="pt-6">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border">
                <th class="text-left py-3 px-4 font-medium">Execution ID</th>
                <th class="text-left py-3 px-4 font-medium">Workflow</th>
                <th class="text-center py-3 px-4 font-medium">Version</th>
                <th class="text-left py-3 px-4 font-medium">Trigger</th>
                <th class="text-center py-3 px-4 font-medium">Status</th>
                <th class="text-left py-3 px-4 font-medium">Started</th>
                <th class="text-left py-3 px-4 font-medium">Completed</th>
                <th class="text-left py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="exec in executions" :key="exec.id" class="border-b border-border hover:bg-muted/50">
                <td class="py-3 px-4 font-mono text-xs">{{ exec.id.substring(0, 8) }}…</td>
                <td class="py-3 px-4">{{ exec.workflowId?.substring(0, 8) }}…</td>
                <td class="py-3 px-4 text-center">
                  <Badge v-if="exec.workflowVersion" variant="outline" class="font-mono text-xs">v{{ exec.workflowVersion }}</Badge>
                  <span v-else class="text-muted-foreground">—</span>
                </td>
                <td class="py-3 px-4 text-xs">
                  <Badge variant="secondary">{{ formatTriggerType(exec.triggerMetadata?.type || 'manual') }}</Badge>
                  <Badge v-if="exec.triggerMetadata?.retryOf" variant="outline" class="ml-1 text-amber-600">retry</Badge>
                </td>
                <td class="py-3 px-4 text-center">
                  <Badge :variant="exec.status === 'completed' ? 'default' : exec.status === 'failed' ? 'destructive' : 'secondary'">{{ exec.status }}</Badge>
                </td>
                <td class="py-3 px-4 text-muted-foreground text-xs">{{ exec.startedAt ? new Date(exec.startedAt).toLocaleString() : '—' }}</td>
                <td class="py-3 px-4 text-muted-foreground text-xs">{{ exec.completedAt ? new Date(exec.completedAt).toLocaleString() : '—' }}</td>
                <td class="py-3 px-4">
                  <NuxtLink :to="`/${ws}/executions/${exec.id}`"><Button variant="ghost" size="sm" class="text-xs h-7">Detail →</Button></NuxtLink>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="executions.length === 0" class="text-center text-muted-foreground py-8">No executions yet.</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');

const { data } = await useFetch('/api/executions?limit=50', { headers });
const executions = computed(() => data.value?.executions ?? []);

function formatTriggerType(type: string): string {
  const labels: Record<string, string> = {
    time_schedule: 'Repeatable Schedule',
    exact_datetime: 'Exact Datetime',
    webhook: 'Webhook',
    event: 'Event',
    manual: 'Manual',
  };
  return labels[type] || type;
}
</script>
