<template>
  <div class="space-y-6">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink :href="`/${ws}`">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Rate Limits</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="mt-4 space-y-1">
      <h1 class="text-3xl font-bold">Rate Limits</h1>
      <p class="text-muted-foreground text-sm">Manage workspace defaults, personal overrides, and historical credit usage totals calculated from stored cost snapshots.</p>
    </div>

    <div class="rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300">
      <p><strong>How limits are applied:</strong> user-level limits override workspace defaults. Daily, weekly, and monthly usage totals are calculated from historical usage rows that keep the model credit cost captured at execution time.</p>
    </div>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card v-if="isAdmin">
        <CardHeader>
          <CardTitle>Workspace Default Rate Limits</CardTitle>
          <CardDescription>Fallback limits applied to workspace users who do not set their own overrides.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label>Daily Credit Limit</Label>
            <Input v-model="workspaceForm.dailyCreditLimit" type="text" placeholder="Unlimited" />
          </div>
          <div class="space-y-2">
            <Label>Weekly Credit Limit</Label>
            <Input v-model="workspaceForm.weeklyCreditLimit" type="text" placeholder="Unlimited" />
          </div>
          <div class="space-y-2">
            <Label>Monthly Credit Limit</Label>
            <Input v-model="workspaceForm.monthlyCreditLimit" type="text" placeholder="Unlimited" />
          </div>
          <div class="flex items-center gap-3">
            <Button @click="saveWorkspaceLimits">Save Workspace Limits</Button>
            <span v-if="workspaceMessage" class="text-sm text-muted-foreground">{{ workspaceMessage }}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My Rate Limits</CardTitle>
          <CardDescription>Optional personal overrides for your account. Leave a field empty to inherit the workspace default.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label>Daily Credit Limit</Label>
            <Input v-model="userForm.dailyCreditLimit" type="text" placeholder="Use workspace default" />
          </div>
          <div class="space-y-2">
            <Label>Weekly Credit Limit</Label>
            <Input v-model="userForm.weeklyCreditLimit" type="text" placeholder="Use workspace default" />
          </div>
          <div class="space-y-2">
            <Label>Monthly Credit Limit</Label>
            <Input v-model="userForm.monthlyCreditLimit" type="text" placeholder="Use workspace default" />
          </div>
          <div class="flex items-center gap-3">
            <Button @click="saveUserLimits">Save My Limits</Button>
            <span v-if="userMessage" class="text-sm text-muted-foreground">{{ userMessage }}</span>
          </div>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>My Usage Summary</CardTitle>
        <CardDescription>Usage totals for the current day, calendar week, and calendar month.</CardDescription>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div class="rounded-lg border border-border p-4">
            <p class="text-sm text-muted-foreground">Today's Credits</p>
            <p class="text-2xl font-bold">{{ todayCredits }}</p>
            <p class="text-sm text-muted-foreground">Limit: {{ formatLimit(effectiveDailyLimit) }}</p>
          </div>
          <div class="rounded-lg border border-border p-4">
            <p class="text-sm text-muted-foreground">This Week's Credits</p>
            <p class="text-2xl font-bold">{{ weekCredits }}</p>
            <p class="text-sm text-muted-foreground">Limit: {{ formatLimit(effectiveWeeklyLimit) }}</p>
          </div>
          <div class="rounded-lg border border-border p-4">
            <p class="text-sm text-muted-foreground">This Month's Credits</p>
            <p class="text-2xl font-bold">{{ monthCredits }}</p>
            <p class="text-sm text-muted-foreground">Limit: {{ formatLimit(effectiveMonthlyLimit) }}</p>
          </div>
        </div>

        <div v-if="modelUsage.length > 0" class="mt-6 space-y-3">
          <div>
            <h2 class="text-lg font-semibold">Credits by Model</h2>
            <p class="text-sm text-muted-foreground">Last 30 days, summed across stored cost snapshots for each model.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Sessions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="usage in modelUsage" :key="usage.modelName">
                <TableCell class="font-medium">{{ usage.modelName }}</TableCell>
                <TableCell>{{ usage.totalCredits }}</TableCell>
                <TableCell>{{ usage.totalSessions }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div v-else class="mt-6 py-8 text-center text-sm text-muted-foreground">No credit usage recorded yet.</div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
interface RateLimitSettings {
  dailyCreditLimit: string | null;
  weeklyCreditLimit: string | null;
  monthlyCreditLimit: string | null;
}

interface UsageTotal {
  totalCredits: string;
  totalSessions: number;
}

interface UsageResponse {
  todayUsage: UsageTotal;
  weekUsage: UsageTotal;
  monthUsage: UsageTotal;
  modelUsage: Array<{ modelName: string; totalCredits: string; totalSessions: number }>;
}

const { user, authHeaders } = useAuth();
const route = useRoute();
const headers = authHeaders();
const ws = computed(() => (route.params.workspace as string) || 'default');
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');

const emptySettings: RateLimitSettings = {
  dailyCreditLimit: null,
  weeklyCreditLimit: null,
  monthlyCreditLimit: null,
};

const { data: settingsData, refresh: refreshSettings } = await useFetch('/api/quota/settings', { headers });
const { data: usageData, refresh: refreshUsage } = await useFetch('/api/quota/usage?days=30', { headers });

const workspaceSettings = computed<RateLimitSettings>(() => ((settingsData.value as { workspaceSettings?: RateLimitSettings })?.workspaceSettings ?? emptySettings));
const userSettings = computed<RateLimitSettings>(() => ((settingsData.value as { userSettings?: RateLimitSettings })?.userSettings ?? emptySettings));

const workspaceForm = reactive({
  dailyCreditLimit: '',
  weeklyCreditLimit: '',
  monthlyCreditLimit: '',
});

const userForm = reactive({
  dailyCreditLimit: '',
  weeklyCreditLimit: '',
  monthlyCreditLimit: '',
});

const workspaceMessage = ref('');
const userMessage = ref('');

function syncForm(target: { dailyCreditLimit: string; weeklyCreditLimit: string; monthlyCreditLimit: string }, settings: RateLimitSettings) {
  target.dailyCreditLimit = settings.dailyCreditLimit ?? '';
  target.weeklyCreditLimit = settings.weeklyCreditLimit ?? '';
  target.monthlyCreditLimit = settings.monthlyCreditLimit ?? '';
}

watch(workspaceSettings, (settings) => {
  syncForm(workspaceForm, settings);
}, { immediate: true });

watch(userSettings, (settings) => {
  syncForm(userForm, settings);
}, { immediate: true });

const todayCredits = computed(() => (usageData.value as UsageResponse | undefined)?.todayUsage?.totalCredits ?? '0');
const weekCredits = computed(() => (usageData.value as UsageResponse | undefined)?.weekUsage?.totalCredits ?? '0');
const monthCredits = computed(() => (usageData.value as UsageResponse | undefined)?.monthUsage?.totalCredits ?? '0');
const modelUsage = computed(() => (usageData.value as UsageResponse | undefined)?.modelUsage ?? []);

const effectiveDailyLimit = computed(() => userSettings.value.dailyCreditLimit ?? workspaceSettings.value.dailyCreditLimit ?? null);
const effectiveWeeklyLimit = computed(() => userSettings.value.weeklyCreditLimit ?? workspaceSettings.value.weeklyCreditLimit ?? null);
const effectiveMonthlyLimit = computed(() => userSettings.value.monthlyCreditLimit ?? workspaceSettings.value.monthlyCreditLimit ?? null);

function formatLimit(value: string | null) {
  return value || 'Unlimited';
}

async function saveWorkspaceLimits() {
  workspaceMessage.value = '';
  await $fetch('/api/admin/quota', {
    method: 'PUT',
    headers,
    body: {
      dailyCreditLimit: workspaceForm.dailyCreditLimit || null,
      weeklyCreditLimit: workspaceForm.weeklyCreditLimit || null,
      monthlyCreditLimit: workspaceForm.monthlyCreditLimit || null,
    },
  });
  await refreshSettings();
  workspaceMessage.value = 'Workspace limits saved.';
}

async function saveUserLimits() {
  userMessage.value = '';
  await $fetch('/api/quota/settings', {
    method: 'PUT',
    headers,
    body: {
      dailyCreditLimit: userForm.dailyCreditLimit || null,
      weeklyCreditLimit: userForm.weeklyCreditLimit || null,
      monthlyCreditLimit: userForm.monthlyCreditLimit || null,
    },
  });
  await Promise.all([refreshSettings(), refreshUsage()]);
  userMessage.value = 'Personal limits saved.';
}
</script>