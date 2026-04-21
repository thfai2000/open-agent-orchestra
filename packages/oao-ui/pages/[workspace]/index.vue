<template>
  <div>
    <Breadcrumb :model="[{ label: 'Home' }]" class="mb-4 -ml-1">
      <template #item="{ item }"><span class="text-surface-500">{{ item.label }}</span></template>
    </Breadcrumb>

    <h1 class="text-2xl font-semibold mb-6">Dashboard</h1>

    <!-- Summary Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <Card v-for="stat in summaryStats" :key="stat.label">
        <template #content>
          <div class="flex items-center justify-between">
            <div>
              <p class="text-surface-500 text-sm">{{ stat.label }}</p>
              <p class="text-3xl font-bold mt-1">{{ stat.value }}</p>
            </div>
            <i :class="[stat.icon, 'text-3xl text-primary-300']"></i>
          </div>
        </template>
      </Card>
    </div>

    <!-- Charts Row -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <Card>
        <template #title>Daily Credit Usage (Last 30 Days)</template>
        <template #content>
          <div v-if="dailyUsage.length > 0" class="h-48">
            <canvas ref="dailyChartCanvas" class="w-full h-full" />
          </div>
          <p v-else class="text-surface-400 py-8 text-center">No usage data yet.</p>
        </template>
      </Card>
      <Card>
        <template #title>Credits by Model</template>
        <template #content>
          <div v-if="modelUsage.length > 0" class="flex flex-col gap-3">
            <div v-for="mu in modelUsage" :key="mu.modelName" class="flex items-center gap-3">
              <div class="flex-1">
                <div class="flex justify-between mb-1">
                  <span class="text-sm font-medium">{{ mu.modelName }}</span>
                  <span class="text-sm text-surface-500">{{ mu.totalCredits }} credits</span>
                </div>
                <ProgressBar :value="getModelPercent(mu.totalCredits)" :showValue="false" style="height: 6px" />
              </div>
              <Tag :value="`${mu.totalSessions} sessions`" severity="secondary" />
            </div>
          </div>
          <p v-else class="text-surface-400 py-8 text-center">No model usage data yet.</p>
        </template>
      </Card>
    </div>

    <!-- Recent Executions -->
    <Card>
      <template #title>Recent Executions</template>
      <template #content>
        <DataTable :value="executions" :rows="10" stripedRows>
          <template #empty>
            <div class="text-center py-8 text-surface-400">No executions yet.</div>
          </template>
          <Column header="Workflow" style="min-width: 200px">
            <template #body="{ data }">
              <span class="font-medium">{{ data.workflowName || data.workflowId?.substring(0, 8) + '…' }}</span>
            </template>
          </Column>
          <Column field="status" header="Status">
            <template #body="{ data }">
              <Tag :value="data.status" :severity="getStatusSeverity(data.status)" />
            </template>
          </Column>
          <Column header="Started">
            <template #body="{ data }">
              <span class="text-sm">{{ data.startedAt ? new Date(data.startedAt).toLocaleString() : '—' }}</span>
            </template>
          </Column>
          <Column header="">
            <template #body="{ data }">
              <NuxtLink :to="`/${ws}/executions/${data.id}`">
                <Button icon="pi pi-arrow-right" text rounded size="small" />
              </NuxtLink>
            </template>
          </Column>
        </DataTable>
      </template>
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

const agents = computed(() => (agentsData.value as any)?.agents ?? []);
const workflows = computed(() => (workflowsData.value as any)?.workflows ?? []);
const executions = computed(() => (execData.value as any)?.executions ?? []);
const todayCredits = computed(() => (usageData.value as any)?.todayUsage?.totalCredits ?? '0');
const monthCredits = computed(() => (usageData.value as any)?.monthUsage?.totalCredits ?? '0');
const dailyUsage = computed(() => (usageData.value as any)?.dailyUsage ?? []);
const modelUsage = computed(() => (usageData.value as any)?.modelUsage ?? []);

const summaryStats = computed(() => [
  { label: 'Total Agents', value: agents.value.length, icon: 'pi pi-microchip-ai' },
  { label: 'Active Workflows', value: workflows.value.length, icon: 'pi pi-sitemap' },
  { label: "Today's Credits", value: todayCredits.value, icon: 'pi pi-chart-bar' },
  { label: "Month's Credits", value: monthCredits.value, icon: 'pi pi-chart-line' },
]);

function getStatusSeverity(status: string): string {
  const map: Record<string, string> = {
    completed: 'success', active: 'success', running: 'warn', pending: 'warn',
    failed: 'danger', error: 'danger', paused: 'warn',
  };
  return map[status] || 'secondary';
}

function getModelPercent(credits: string): number {
  const max = Math.max(...modelUsage.value.map((m: any) => Number(m.totalCredits)), 1);
  return (Number(credits) / max) * 100;
}

// Chart
const dailyChartCanvas = ref<HTMLCanvasElement | null>(null);

function drawChart() {
  const canvas = dailyChartCanvas.value;
  if (!canvas || dailyUsage.value.length === 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  const pad = { top: 10, right: 10, bottom: 30, left: 50 };
  const cW = w - pad.left - pad.right, cH = h - pad.top - pad.bottom;
  const data = dailyUsage.value;
  const vals = data.map((d: any) => Number(d.totalCredits));
  const maxV = Math.max(...vals, 1);
  ctx.clearRect(0, 0, w, h);
  const barW = Math.max(cW / data.length - 2, 2);
  ctx.fillStyle = '#8b5cf6';
  data.forEach((d: any, i: number) => {
    const x = pad.left + (i / data.length) * cW + 1;
    const bH = (Number(d.totalCredits) / maxV) * cH;
    ctx.fillRect(x, pad.top + cH - bH, barW, bH);
  });
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + cH);
  ctx.lineTo(pad.left + cW, pad.top + cH);
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + cH - (i / 4) * cH;
    ctx.fillText(((maxV * i) / 4).toFixed(0), pad.left - 5, y + 3);
  }
  ctx.textAlign = 'center';
  const step = Math.max(Math.floor(data.length / 5), 1);
  data.forEach((d: any, i: number) => {
    if (i % step === 0 || i === data.length - 1) {
      const x = pad.left + (i / data.length) * cW + barW / 2;
      ctx.fillText(d.date.substring(5), x, pad.top + cH + 15);
    }
  });
}

onMounted(() => nextTick(() => drawChart()));
watch(dailyUsage, () => nextTick(() => drawChart()));
</script>
