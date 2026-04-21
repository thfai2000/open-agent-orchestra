<template>
  <div>
    <Breadcrumb :model="breadcrumbs" class="mb-4 -ml-1">
      <template #item="{ item }">
        <NuxtLink v-if="item.route" :to="item.route" class="text-primary hover:underline">{{ item.label }}</NuxtLink>
        <span v-else>{{ item.label }}</span>
      </template>
    </Breadcrumb>

    <div v-if="versionRecord && snapshot">
      <div class="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 class="text-2xl font-semibold">{{ snapshot.key }}</h1>
          <div class="flex flex-wrap items-center gap-2 mt-2">
            <Tag :value="scopeLabel(validScope)" :severity="scopeSeverity(validScope)" />
            <Tag :value="snapshot.variableType" :severity="snapshot.variableType === 'credential' ? 'warn' : 'info'" />
            <Tag :value="snapshot.credentialSubType || 'secret_text'" severity="secondary" />
            <Tag value="Read-only" severity="warn" />
            <Tag v-if="snapshot.isDeleted" value="Deleted" severity="danger" />
          </div>
          <div class="flex items-center gap-2 mt-3 text-sm">
            <span class="text-surface-500">Version:</span>
            <Button icon="pi pi-chevron-left" severity="secondary" outlined size="small" :disabled="!olderVersion" aria-label="Previous version" @click="navigateToVersion(olderVersion?.version)" />
            <span class="font-medium text-surface-700">v{{ versionRecord.version }}<span v-if="isLatestVersion" class="text-surface-500"> (latest)</span></span>
            <Button icon="pi pi-chevron-right" severity="secondary" outlined size="small" :disabled="!newerVersion" aria-label="Next version" @click="navigateToVersion(newerVersion?.version)" />
          </div>
          <p v-if="snapshot.description" class="text-surface-500 mt-2">{{ snapshot.description }}</p>
          <p class="text-xs text-surface-400 mt-3">
            Snapshot captured {{ formatDateTime(versionRecord.createdAt) }}
            <span v-if="versionRecord.changedBy">by {{ versionRecord.changedBy }}</span>
          </p>
        </div>
        <div class="flex gap-2">
          <NuxtLink v-if="hasLiveVersion" :to="latestPath">
            <Button label="Latest" severity="secondary" size="small" />
          </NuxtLink>
          <Button v-else label="Deleted" severity="secondary" size="small" disabled />
        </div>
      </div>

      <Message severity="warn" :closable="false" class="mb-6">
        Historical variable versions are read-only. Use the latest page to edit the current variable.
      </Message>

      <Message v-if="snapshot.isDeleted" severity="error" :closable="false" class="mb-6 text-sm">
        This version represents the variable state that was deleted.
      </Message>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <template #content>
            <div class="flex flex-col gap-3">
              <div>
                <span class="text-surface-500 text-sm">Scope</span>
                <p class="font-medium">{{ scopeLabel(validScope) }}</p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Type</span>
                <p class="font-medium">{{ snapshot.variableType }}</p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Sub-Type</span>
                <p class="font-medium">{{ snapshot.credentialSubType || 'secret_text' }}</p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Inject As Env</span>
                <p class="font-medium">{{ snapshot.injectAsEnvVariable ? 'Yes' : 'No' }}</p>
              </div>
              <div v-if="validScope === 'agent'">
                <span class="text-surface-500 text-sm">Agent</span>
                <p class="font-medium">
                  <NuxtLink :to="`/${ws}/agents/${snapshot.scopeId}`" class="text-primary hover:underline">
                    {{ shortId(snapshot.scopeId) }}
                  </NuxtLink>
                </p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Description</span>
                <p class="font-medium">{{ snapshot.description || '—' }}</p>
              </div>
            </div>
          </template>
        </Card>

        <Card>
          <template #content>
            <div class="flex flex-col gap-3">
              <div>
                <span class="text-surface-500 text-sm">Created</span>
                <p class="font-medium">{{ formatDateTime(snapshot.createdAt) }}</p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Updated</span>
                <p class="font-medium">{{ formatDateTime(snapshot.updatedAt) }}</p>
              </div>
              <div>
                <span class="text-surface-500 text-sm">Workspace</span>
                <p class="font-medium">{{ snapshot.workspaceId ? shortId(snapshot.workspaceId) : '—' }}</p>
              </div>
              <div v-if="snapshot.deletedAt">
                <span class="text-surface-500 text-sm">Deleted At</span>
                <p class="font-medium">{{ formatDateTime(snapshot.deletedAt) }}</p>
              </div>
            </div>
          </template>
        </Card>
      </div>
    </div>

    <div v-else class="text-center py-12 text-surface-400">Loading variable version...</div>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();

const ws = computed(() => (route.params.workspace as string) || 'default');
const variableId = computed(() => route.params.id as string);
const versionNumber = computed(() => Number(route.params.version));
const rawScope = computed(() => route.params.scope as string);
const validScope = computed(() => ['workspace', 'user', 'agent'].includes(rawScope.value) ? rawScope.value as 'workspace' | 'user' | 'agent' : 'workspace');

const { data: versionData } = await useFetch<any>(computed(() => `/api/variables/${variableId.value}/versions/${versionNumber.value}?scope=${validScope.value}`), { headers });
const { data: versionsData } = await useFetch<any>(computed(() => `/api/variables/${variableId.value}/versions?scope=${validScope.value}&limit=100`), { headers });

const versionRecord = computed(() => versionData.value?.version ?? null);
const snapshot = computed(() => versionRecord.value?.snapshot ?? null);
const versions = computed(() => (versionsData.value?.versions ?? []).slice().sort((left: any, right: any) => right.version - left.version));
const latestPath = computed(() => `/${ws.value}/variables/${validScope.value}/${variableId.value}`);
const hasLiveVersion = computed(() => versions.value.some((entry: any) => entry.isLatest && !entry.isDeleted));

const currentVersionIndex = computed(() => versions.value.findIndex((entry: any) => entry.version === versionNumber.value));
const newerVersion = computed(() => currentVersionIndex.value > 0 ? versions.value[currentVersionIndex.value - 1] : null);
const olderVersion = computed(() => currentVersionIndex.value >= 0 ? versions.value[currentVersionIndex.value + 1] ?? null : null);
const isLatestVersion = computed(() => versions.value.some((entry: any) => entry.version === versionNumber.value && entry.isLatest));

const breadcrumbs = computed(() => [
  { label: 'Home', route: `/${ws.value}` },
  { label: 'Variables', route: `/${ws.value}/variables` },
  { label: snapshot.value?.key || 'Loading...', route: hasLiveVersion.value ? latestPath.value : `/${ws.value}/variables` },
  { label: `v${versionNumber.value}` },
]);

function scopeLabel(scope: 'workspace' | 'user' | 'agent') {
  return { workspace: 'Workspace', user: 'User', agent: 'Agent' }[scope];
}

function scopeSeverity(scope: 'workspace' | 'user' | 'agent') {
  return { workspace: 'success', user: 'info', agent: 'warn' }[scope];
}

function navigateToVersion(version?: number) {
  if (!version) return;
  router.push(`/${ws.value}/variables/${validScope.value}/${variableId.value}/v/${version}`);
}

function shortId(value: string) {
  return `${value.slice(0, 8)}...`;
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}
</script>