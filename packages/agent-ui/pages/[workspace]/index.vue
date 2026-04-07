<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbPage>Home</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <h1 class="text-3xl font-bold mt-4 mb-8">Dashboard</h1>

    <!-- Summary Cards -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <Card>
        <CardHeader class="pb-2"><CardTitle class="text-sm text-muted-foreground">Total Agents</CardTitle></CardHeader>
        <CardContent><p class="text-3xl font-bold">{{ agents.length }}</p></CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2"><CardTitle class="text-sm text-muted-foreground">Active Workflows</CardTitle></CardHeader>
        <CardContent><p class="text-3xl font-bold">{{ workflows.length }}</p></CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2"><CardTitle class="text-sm text-muted-foreground">Today's Credits</CardTitle></CardHeader>
        <CardContent><p class="text-3xl font-bold">{{ todayCredits }}</p></CardContent>
      </Card>
      <Card>
        <CardHeader class="pb-2"><CardTitle class="text-sm text-muted-foreground">This Month's Credits</CardTitle></CardHeader>
        <CardContent><p class="text-3xl font-bold">{{ monthCredits }}</p></CardContent>
      </Card>
    </div>

    <!-- Charts Row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <!-- Daily Credit Usage Chart -->
      <Card>
        <CardHeader><CardTitle>Daily Credit Usage (Last 30 Days)</CardTitle></CardHeader>
        <CardContent>
          <div v-if="dailyUsage.length > 0" class="h-48">
            <canvas ref="dailyChartCanvas" class="w-full h-full" />
          </div>
          <p v-else class="text-muted-foreground py-8 text-center">No usage data yet.</p>
        </CardContent>
      </Card>

      <!-- Model Usage Breakdown -->
      <Card>
        <CardHeader><CardTitle>Credits by Model (Last 30 Days)</CardTitle></CardHeader>
        <CardContent>
          <div v-if="modelUsage.length > 0" class="space-y-3">
            <div v-for="mu in modelUsage" :key="mu.modelName" class="flex items-center gap-3">
              <div class="flex-1">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-sm font-medium">{{ mu.modelName }}</span>
                  <span class="text-sm text-muted-foreground">{{ mu.totalCredits }} credits</span>
                </div>
                <div class="w-full bg-secondary rounded-full h-2">
                  <div class="bg-primary rounded-full h-2 transition-all" :style="{ width: getModelBarWidth(mu.totalCredits) + '%' }" />
                </div>
              </div>
              <Badge variant="secondary" class="text-xs">{{ mu.totalSessions }} sessions</Badge>
            </div>
          </div>
          <p v-else class="text-muted-foreground py-8 text-center">No model usage data yet.</p>
        </CardContent>
      </Card>
    </div>

    <!-- Recent Executions -->
    <Card>
      <CardHeader><CardTitle>Recent Executions</CardTitle></CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div v-for="exec in executions" :key="exec.id"
            class="p-4 rounded-lg border border-border flex items-center justify-between">
            <div>
              <p class="font-semibold">{{ exec.workflowId?.substring(0, 8) }}…</p>
              <p class="text-sm text-muted-foreground">Started {{ new Date(exec.startedAt || exec.createdAt).toLocaleString() }}</p>
            </div>
            <div class="flex items-center gap-3">
              <Badge :variant="exec.status === 'completed' ? 'default' : exec.status === 'failed' ? 'destructive' : 'secondary'" class="uppercase">{{ exec.status }}</Badge>
              <NuxtLink :to="`/${ws}/executions/${exec.id}`"><Button variant="ghost" size="sm" class="text-xs h-7">View →</Button></NuxtLink>
            </div>
          </div>
          <p v-if="executions.length === 0" class="text-muted-foreground">No executions yet.</p>
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

const { data: agentsData } = await useFetch('/api/agents', { headers });
const { data: workflowsData } = await useFetch('/api/workflows', { headers });
const { data: execData } = await useFetch('/api/executions?limit=10', { headers });
const { data: usageData } = await useFetch('/api/quota/usage?days=30', { headers });

const agents = computed(() => (agentsData.value as { agents: unknown[] })?.agents ?? []);
const workflows = computed(() => (workflowsData.value as { workflows: unknown[] })?.workflows ?? []);
const executions = computed(() => (execData.value as { executions: Array<{ id: string; workflowId: string; status: string; startedAt: string; createdAt: string }> })?.executions ?? []);

const todayCredits = computed(() => (usageData.value as { todayUsage: { totalCredits: string } })?.todayUsage?.totalCredits ?? '0');
const monthCredits = computed(() => (usageData.value as { monthUsage: { totalCredits: string } })?.monthUsage?.totalCredits ?? '0');
const dailyUsage = computed(() => (usageData.value as { dailyUsage: Array<{ date: string; totalCredits: string; totalSessions: number }> })?.dailyUsage ?? []);
const modelUsage = computed(() => (usageData.value as { modelUsage: Array<{ modelName: string; totalCredits: string; totalSessions: number }> })?.modelUsage ?? []);

// Chart rendering
const dailyChartCanvas = ref<HTMLCanvasElement | null>(null);

function getModelBarWidth(credits: string): number {
  const maxCredits = Math.max(...modelUsage.value.map((m: { totalCredits: string }) => Number(m.totalCredits)), 1);
  return (Number(credits) / maxCredits) * 100;
}

function drawDailyChart() {
  const canvas = dailyChartCanvas.value;
  if (!canvas || dailyUsage.value.length === 0) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padding = { top: 10, right: 10, bottom: 30, left: 50 };
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const data = dailyUsage.value;
  const values = data.map((d: { totalCredits: string }) => Number(d.totalCredits));
  const maxVal = Math.max(...values, 1);

  ctx.clearRect(0, 0, w, h);

  // Draw bars
  const barWidth = Math.max(chartW / data.length - 2, 2);
  ctx.fillStyle = 'hsl(262, 83%, 58%)';
  data.forEach((d: { date: string; totalCredits: string }, i: number) => {
    const x = padding.left + (i / data.length) * chartW + 1;
    const barH = (Number(d.totalCredits) / maxVal) * chartH;
    ctx.fillRect(x, padding.top + chartH - barH, barWidth, barH);
  });

  // Draw axes
  ctx.strokeStyle = 'hsl(215, 16%, 47%)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartH);
  ctx.lineTo(padding.left + chartW, padding.top + chartH);
  ctx.stroke();

  // Y-axis labels
  ctx.fillStyle = 'hsl(215, 16%, 47%)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const val = ((maxVal * i) / 4).toFixed(0);
    const y = padding.top + chartH - (i / 4) * chartH;
    ctx.fillText(val, padding.left - 5, y + 3);
  }

  // X-axis labels (show a few dates)
  ctx.textAlign = 'center';
  const step = Math.max(Math.floor(data.length / 5), 1);
  data.forEach((d: { date: string }, i: number) => {
    if (i % step === 0 || i === data.length - 1) {
      const x = padding.left + (i / data.length) * chartW + barWidth / 2;
      ctx.fillText(d.date.substring(5), x, padding.top + chartH + 15);
    }
  });
}

onMounted(() => {
  nextTick(() => drawDailyChart());
});

watch(dailyUsage, () => {
  nextTick(() => drawDailyChart());
});
</script>
