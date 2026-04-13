<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Instances</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex items-center justify-between mt-4 mb-6">
      <h1 class="text-3xl font-bold">Agent Instances</h1>
      <div class="flex gap-2">
        <select v-model="typeFilter" class="text-sm border rounded px-2 py-1 bg-background">
          <option value="">All Types</option>
          <option value="static">Static</option>
          <option value="ephemeral">Ephemeral</option>
        </select>
        <select v-model="statusFilter" class="text-sm border rounded px-2 py-1 bg-background">
          <option value="">All Statuses</option>
          <option value="idle">Idle</option>
          <option value="busy">Busy</option>
          <option value="offline">Offline</option>
          <option value="terminated">Terminated</option>
        </select>
        <Button variant="outline" size="sm" @click="refresh()">Refresh</Button>
        <Button variant="destructive" size="sm" @click="cleanup()">Cleanup Old</Button>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent class="pt-4 pb-4 text-center">
          <p class="text-2xl font-bold">{{ summary.total }}</p>
          <p class="text-xs text-muted-foreground">Total Instances</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-4 pb-4 text-center">
          <p class="text-2xl font-bold text-green-600">{{ summary.idle }}</p>
          <p class="text-xs text-muted-foreground">Idle</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-4 pb-4 text-center">
          <p class="text-2xl font-bold text-blue-600">{{ summary.busy }}</p>
          <p class="text-xs text-muted-foreground">Busy</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="pt-4 pb-4 text-center">
          <p class="text-2xl font-bold text-red-600">{{ summary.offline }}</p>
          <p class="text-xs text-muted-foreground">Offline</p>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardContent class="pt-6">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border">
                <th class="text-left py-3 px-4 font-medium">Name</th>
                <th class="text-center py-3 px-4 font-medium">Type</th>
                <th class="text-center py-3 px-4 font-medium">Status</th>
                <th class="text-left py-3 px-4 font-medium">Hostname</th>
                <th class="text-left py-3 px-4 font-medium">Current Step</th>
                <th class="text-left py-3 px-4 font-medium">Last Heartbeat</th>
                <th class="text-left py-3 px-4 font-medium">Created</th>
                <th class="text-left py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="inst in filteredInstances" :key="inst.id" class="border-b border-border hover:bg-muted/50">
                <td class="py-3 px-4 font-mono text-xs">{{ inst.name }}</td>
                <td class="py-3 px-4 text-center">
                  <Badge :variant="inst.instanceType === 'static' ? 'default' : 'secondary'">
                    {{ inst.instanceType }}
                  </Badge>
                </td>
                <td class="py-3 px-4 text-center">
                  <Badge :variant="statusVariant(inst.status)">
                    {{ inst.status }}
                  </Badge>
                </td>
                <td class="py-3 px-4 text-xs text-muted-foreground">{{ inst.hostname || '—' }}</td>
                <td class="py-3 px-4 font-mono text-xs">
                  <NuxtLink v-if="inst.currentStepExecutionId" :to="`/${ws}/executions`" class="text-primary hover:underline">
                    {{ inst.currentStepExecutionId.substring(0, 8) }}…
                  </NuxtLink>
                  <span v-else class="text-muted-foreground">—</span>
                </td>
                <td class="py-3 px-4 text-muted-foreground text-xs">
                  {{ inst.lastHeartbeatAt ? timeAgo(inst.lastHeartbeatAt) : '—' }}
                </td>
                <td class="py-3 px-4 text-muted-foreground text-xs">
                  {{ new Date(inst.createdAt).toLocaleString() }}
                </td>
                <td class="py-3 px-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-xs h-7 text-destructive"
                    @click="removeInstance(inst.id)"
                    :disabled="inst.status === 'busy'"
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="filteredInstances.length === 0" class="text-center text-muted-foreground py-8">
            No agent instances found.
          </p>
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

const typeFilter = ref('');
const statusFilter = ref('');

const { data, refresh } = await useFetch('/api/agent-instances', { headers });
const instances = computed(() => (data.value as any)?.instances ?? []);

const filteredInstances = computed(() => {
  let result = instances.value;
  if (typeFilter.value) result = result.filter((i: any) => i.instanceType === typeFilter.value);
  if (statusFilter.value) result = result.filter((i: any) => i.status === statusFilter.value);
  return result;
});

const summary = computed(() => {
  const all = instances.value;
  return {
    total: all.length,
    idle: all.filter((i: any) => i.status === 'idle').length,
    busy: all.filter((i: any) => i.status === 'busy').length,
    offline: all.filter((i: any) => i.status === 'offline').length,
  };
});

function statusVariant(status: string) {
  if (status === 'idle') return 'default';
  if (status === 'busy') return 'secondary';
  if (status === 'offline') return 'destructive';
  return 'outline';
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function removeInstance(id: string) {
  if (!confirm('Remove this instance record?')) return;
  await $fetch(`/api/agent-instances/${id}`, { method: 'DELETE', headers });
  refresh();
}

async function cleanup() {
  const res = await $fetch<{ removed: number }>('/api/agent-instances/cleanup', { method: 'POST', headers });
  alert(`Cleaned up ${res.removed} old instances`);
  refresh();
}
</script>
