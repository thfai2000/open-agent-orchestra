<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Quota Settings</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <h1 class="text-3xl font-bold mt-4 mb-8">Quota Settings</h1>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Global Quota Settings (Admin Only) -->
      <Card v-if="isAdmin">
        <CardHeader>
          <CardTitle>Global Quota Limits</CardTitle>
          <p class="text-sm text-muted-foreground">Applied to all users who haven't set their own limits</p>
        </CardHeader>
        <CardContent class="space-y-4">
          <div>
            <Label>Daily Credit Limit</Label>
            <Input v-model="globalForm.dailyCreditLimit" type="text" placeholder="Unlimited" />
          </div>
          <div>
            <Label>Monthly Credit Limit</Label>
            <Input v-model="globalForm.monthlyCreditLimit" type="text" placeholder="Unlimited" />
          </div>
          <Button @click="saveGlobalQuota">Save Global Quota</Button>
        </CardContent>
      </Card>

      <!-- User Personal Quota Settings -->
      <Card>
        <CardHeader>
          <CardTitle>My Quota Limits</CardTitle>
          <p class="text-sm text-muted-foreground">Override global limits for your account. Leave empty to use global defaults.</p>
        </CardHeader>
        <CardContent class="space-y-4">
          <div>
            <Label>Daily Credit Limit</Label>
            <Input v-model="userForm.dailyCreditLimit" type="text" placeholder="Use global default" />
          </div>
          <div>
            <Label>Monthly Credit Limit</Label>
            <Input v-model="userForm.monthlyCreditLimit" type="text" placeholder="Use global default" />
          </div>
          <Button @click="saveUserQuota">Save My Quota</Button>
        </CardContent>
      </Card>
    </div>

    <!-- Usage Summary -->
    <Card class="mt-6">
      <CardHeader>
        <CardTitle>My Usage Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="p-4 rounded-lg border border-border">
            <p class="text-sm text-muted-foreground">Today's Credits Used</p>
            <p class="text-2xl font-bold">{{ todayCredits }}</p>
            <p v-if="effectiveDailyLimit" class="text-sm text-muted-foreground">/ {{ effectiveDailyLimit }} limit</p>
          </div>
          <div class="p-4 rounded-lg border border-border">
            <p class="text-sm text-muted-foreground">This Month's Credits Used</p>
            <p class="text-2xl font-bold">{{ monthCredits }}</p>
            <p v-if="effectiveMonthlyLimit" class="text-sm text-muted-foreground">/ {{ effectiveMonthlyLimit }} limit</p>
          </div>
        </div>

        <!-- Model Breakdown -->
        <div v-if="modelUsage.length > 0" class="mt-6">
          <h3 class="text-lg font-semibold mb-3">Credits by Model (Last 30 days)</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Sessions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="mu in modelUsage" :key="mu.modelName">
                <TableCell class="font-medium">{{ mu.modelName }}</TableCell>
                <TableCell>{{ mu.totalCredits }}</TableCell>
                <TableCell>{{ mu.totalSessions }}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { user, authHeaders } = useAuth();
const headers = authHeaders();
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');

// Load quota settings
const { data: settingsData } = await useFetch('/api/quota/settings', { headers });
const globalSettings = computed(() => (settingsData.value as { globalSettings: { dailyCreditLimit: string | null; monthlyCreditLimit: string | null } })?.globalSettings);
const userSettings = computed(() => (settingsData.value as { userSettings: { dailyCreditLimit: string | null; monthlyCreditLimit: string | null } })?.userSettings);

const globalForm = reactive({
  dailyCreditLimit: globalSettings.value?.dailyCreditLimit ?? '',
  monthlyCreditLimit: globalSettings.value?.monthlyCreditLimit ?? '',
});

const userForm = reactive({
  dailyCreditLimit: userSettings.value?.dailyCreditLimit ?? '',
  monthlyCreditLimit: userSettings.value?.monthlyCreditLimit ?? '',
});

// Load usage
const { data: usageData } = await useFetch('/api/quota/usage?days=30', { headers });
const todayCredits = computed(() => (usageData.value as { todayUsage: { totalCredits: string } })?.todayUsage?.totalCredits ?? '0');
const monthCredits = computed(() => (usageData.value as { monthUsage: { totalCredits: string } })?.monthUsage?.totalCredits ?? '0');
const modelUsage = computed(() => (usageData.value as { modelUsage: Array<{ modelName: string; totalCredits: string; totalSessions: number }> })?.modelUsage ?? []);

// Effective limits (user settings override global)
const effectiveDailyLimit = computed(() => userSettings.value?.dailyCreditLimit ?? globalSettings.value?.dailyCreditLimit ?? null);
const effectiveMonthlyLimit = computed(() => userSettings.value?.monthlyCreditLimit ?? globalSettings.value?.monthlyCreditLimit ?? null);

async function saveGlobalQuota() {
  await $fetch('/api/admin/quota', {
    method: 'PUT',
    headers,
    body: {
      dailyCreditLimit: globalForm.dailyCreditLimit || null,
      monthlyCreditLimit: globalForm.monthlyCreditLimit || null,
    },
  });
}

async function saveUserQuota() {
  await $fetch('/api/quota/settings', {
    method: 'PUT',
    headers,
    body: {
      dailyCreditLimit: userForm.dailyCreditLimit || null,
      monthlyCreditLimit: userForm.monthlyCreditLimit || null,
    },
  });
}
</script>
