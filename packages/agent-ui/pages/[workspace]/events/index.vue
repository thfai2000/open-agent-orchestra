<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Events</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex items-center justify-between mt-4 mb-6">
      <div>
        <h1 class="text-3xl font-bold">System Events</h1>
        <p class="text-muted-foreground text-sm mt-1">Audit log of all system events in your workspace</p>
      </div>
    </div>

    <!-- Filters -->
    <Card class="mb-6">
      <CardContent class="pt-4">
        <div class="flex flex-wrap items-end gap-4">
          <div class="space-y-1">
            <Label class="text-xs">Event Name</Label>
            <select v-model="filterName"
              class="w-56 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">All Events</option>
              <option v-for="name in eventNames" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>
          <div class="space-y-1">
            <Label class="text-xs">Event Scope</Label>
            <select v-model="filterScope"
              class="w-40 px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">All Scopes</option>
              <option value="workspace">Workspace</option>
              <option value="user">User</option>
            </select>
          </div>
          <Button variant="outline" size="sm" @click="filterName = ''; filterScope = ''">Clear Filters</Button>
        </div>
      </CardContent>
    </Card>

    <!-- Events Table -->
    <Card>
      <CardContent class="pt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-[180px]">Time</TableHead>
              <TableHead class="w-[200px]">Event</TableHead>
              <TableHead class="w-[100px]">Scope</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="event in events" :key="event.id">
              <TableCell class="text-xs text-muted-foreground whitespace-nowrap">
                {{ new Date(event.createdAt).toLocaleString() }}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" class="font-mono text-xs">{{ event.eventName }}</Badge>
              </TableCell>
              <TableCell>
                <Badge :variant="event.eventScope === 'workspace' ? 'default' : 'outline'" class="text-xs">
                  {{ event.eventScope }}
                </Badge>
              </TableCell>
              <TableCell class="max-w-md">
                <div v-if="event.eventData" class="text-xs font-mono text-muted-foreground truncate max-w-md" :title="JSON.stringify(event.eventData, null, 2)">
                  {{ formatEventData(event.eventData) }}
                </div>
                <span v-else class="text-xs text-muted-foreground">—</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <p v-if="events.length === 0" class="text-muted-foreground text-center py-8 text-sm">
          No events found matching the current filters.
        </p>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex items-center justify-between mt-4 pt-4 border-t">
          <span class="text-xs text-muted-foreground">Page {{ page }} of {{ totalPages }}</span>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" :disabled="page <= 1" @click="page--">Previous</Button>
            <Button variant="outline" size="sm" :disabled="page >= totalPages" @click="page++">Next</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();

const filterName = ref('');
const filterScope = ref('');
const page = ref(1);
const limit = 50;

const queryParams = computed(() => {
  const params = new URLSearchParams();
  params.set('page', String(page.value));
  params.set('limit', String(limit));
  if (filterName.value) params.set('eventName', filterName.value);
  if (filterScope.value) params.set('eventScope', filterScope.value);
  return params.toString();
});

const { data: eventsData } = await useFetch(
  computed(() => `/api/events?${queryParams.value}`),
  { headers, watch: [queryParams] },
);

const { data: namesData } = await useFetch('/api/events/names', { headers });

const events = computed(() => eventsData.value?.events ?? []);
const totalPages = computed(() => {
  const total = (eventsData.value as any)?.total ?? 0;
  return Math.max(1, Math.ceil(total / limit));
});
const eventNames = computed(() => namesData.value?.eventNames ?? []);

// Reset page when filters change
watch([filterName, filterScope], () => { page.value = 1; });

function formatEventData(data: any): string {
  if (!data) return '—';
  const entries = Object.entries(data);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
}
</script>
