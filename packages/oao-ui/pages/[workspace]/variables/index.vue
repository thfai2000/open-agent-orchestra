<template>
  <div class="space-y-6">
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink :href="`/${ws}`">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Variables</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mt-4">
      <div>
        <h1 class="text-3xl font-bold">Variables</h1>
        <p class="text-muted-foreground text-sm mt-1">Manage credential and property variables with breadcrumb-based create and edit flows. Priority order is Agent &gt; User &gt; Workspace.</p>
      </div>
      <NuxtLink v-if="canManageVariables" :to="`/${ws}/variables/new`">
        <Button>+ Create Variable</Button>
      </NuxtLink>
    </div>

    <div class="rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300">
      <p>
        <strong>Tip:</strong> Properties can be referenced in prompts with
        <code class="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-mono dark:bg-blue-900" v-text="'{{ Properties.KEY_NAME }}'" />.
        Variables marked as environment variables are written into the agent execution environment.
      </p>
    </div>

    <Card v-if="isAdmin">
      <CardHeader>
        <CardTitle>Workspace Variables</CardTitle>
        <CardDescription>Shared defaults for everyone in the workspace. User and agent variables override these entries when keys overlap.</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="workspaceVariables.length" class="space-y-3">
          <div
            v-for="variable in workspaceVariables"
            :key="variable.id"
            class="flex flex-col gap-4 rounded-lg border border-border p-4 lg:flex-row lg:items-start lg:justify-between"
          >
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono font-semibold">{{ variable.key }}</span>
                <Badge :variant="variable.variableType === 'property' ? 'outline' : 'secondary'">{{ formatVariableType(variable.variableType) }}</Badge>
                <Badge v-if="variable.variableType === 'credential' && variable.credentialSubType && variable.credentialSubType !== 'secret_text'" variant="outline">{{ formatCredentialSubType(variable.credentialSubType) }}</Badge>
                <Badge v-if="variable.injectAsEnvVariable" variant="outline">Environment</Badge>
              </div>
              <p v-if="variable.description" class="text-sm text-muted-foreground">{{ variable.description }}</p>
              <p class="text-xs text-muted-foreground">Updated {{ formatDate(variable.updatedAt) }}</p>
            </div>
            <div class="flex items-center gap-2">
              <NuxtLink :to="variableDetailLocation(variable.id, 'workspace')">
                <Button variant="outline" size="sm">Edit</Button>
              </NuxtLink>
              <Button v-if="canManageVariables" variant="ghost" size="sm" class="text-destructive" @click="handleDelete(variable.id, variable.key, 'workspace')">Delete</Button>
            </div>
          </div>
        </div>
        <div v-else class="py-10 text-center text-sm text-muted-foreground">No workspace-level variables stored yet.</div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>User Variables</CardTitle>
        <CardDescription>Available across your workflow runs. Agent-scoped values with the same key win during execution.</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="userVariables.length" class="space-y-3">
          <div
            v-for="variable in userVariables"
            :key="variable.id"
            class="flex flex-col gap-4 rounded-lg border border-border p-4 lg:flex-row lg:items-start lg:justify-between"
          >
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono font-semibold">{{ variable.key }}</span>
                <Badge :variant="variable.variableType === 'property' ? 'outline' : 'secondary'">{{ formatVariableType(variable.variableType) }}</Badge>
                <Badge v-if="variable.variableType === 'credential' && variable.credentialSubType && variable.credentialSubType !== 'secret_text'" variant="outline">{{ formatCredentialSubType(variable.credentialSubType) }}</Badge>
                <Badge v-if="variable.injectAsEnvVariable" variant="outline">Environment</Badge>
              </div>
              <p v-if="variable.description" class="text-sm text-muted-foreground">{{ variable.description }}</p>
              <p class="text-xs text-muted-foreground">Updated {{ formatDate(variable.updatedAt) }}</p>
            </div>
            <div class="flex items-center gap-2">
              <NuxtLink :to="variableDetailLocation(variable.id, 'user')">
                <Button variant="outline" size="sm">Edit</Button>
              </NuxtLink>
              <Button v-if="canManageVariables" variant="ghost" size="sm" class="text-destructive" @click="handleDelete(variable.id, variable.key, 'user')">Delete</Button>
            </div>
          </div>
        </div>
        <div v-else class="py-10 text-center text-sm text-muted-foreground">No user-level variables stored yet.</div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Agent Variables</CardTitle>
        <CardDescription>Scoped to a single agent. These values override user and workspace variables during that agent's execution.</CardDescription>
      </CardHeader>
      <CardContent>
        <div v-if="allAgentVariables.length" class="space-y-6">
          <div v-for="agent in agents" :key="agent.id">
            <div v-if="varsByAgent[agent.id]?.length" class="space-y-3">
              <div class="flex items-center gap-2">
                <h2 class="text-sm font-semibold">{{ agent.name }}</h2>
                <Badge variant="secondary">{{ varsByAgent[agent.id].length }}</Badge>
              </div>
              <div
                v-for="variable in varsByAgent[agent.id]"
                :key="variable.id"
                class="flex flex-col gap-4 rounded-lg border border-border p-4 lg:flex-row lg:items-start lg:justify-between"
              >
                <div class="space-y-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono font-semibold">{{ variable.key }}</span>
                    <Badge :variant="variable.variableType === 'property' ? 'outline' : 'secondary'">{{ formatVariableType(variable.variableType) }}</Badge>
                    <Badge v-if="variable.variableType === 'credential' && variable.credentialSubType && variable.credentialSubType !== 'secret_text'" variant="outline">{{ formatCredentialSubType(variable.credentialSubType) }}</Badge>
                    <Badge v-if="variable.injectAsEnvVariable" variant="outline">Environment</Badge>
                  </div>
                  <p v-if="variable.description" class="text-sm text-muted-foreground">{{ variable.description }}</p>
                  <p class="text-xs text-muted-foreground">Updated {{ formatDate(variable.updatedAt) }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <NuxtLink :to="variableDetailLocation(variable.id, 'agent')">
                    <Button variant="outline" size="sm">Edit</Button>
                  </NuxtLink>
                  <Button v-if="canManageVariables" variant="ghost" size="sm" class="text-destructive" @click="handleDelete(variable.id, variable.key, 'agent')">Delete</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="py-10 text-center text-sm text-muted-foreground">No agent-level variables stored yet.</div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { useVariableEditor, type VariableScope, type VariableSummary, type VariableType } from '~/composables/useVariableEditor';

interface AgentSummary {
  id: string;
  name: string;
}

type VariableRecord = VariableSummary & { agentId?: string | null };

const { authHeaders, user } = useAuth();
const route = useRoute();
const headers = authHeaders();
const ws = computed(() => (route.params.workspace as string) || 'default');
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');
const canManageVariables = computed(() => user.value?.role !== 'view_user');

const { formatCredentialSubType } = useVariableEditor();

const { data: agentsData } = await useFetch('/api/agents', { headers });
const agents = computed<AgentSummary[]>(() => (agentsData.value?.agents ?? []) as AgentSummary[]);

const userVariables = ref<VariableRecord[]>([]);
const workspaceVariables = ref<VariableRecord[]>([]);
const allAgentVariables = ref<VariableRecord[]>([]);

const varsByAgent = computed<Record<string, VariableRecord[]>>(() => {
  const grouped: Record<string, VariableRecord[]> = {};

  for (const variable of allAgentVariables.value) {
    if (!variable.agentId) continue;
    if (!grouped[variable.agentId]) grouped[variable.agentId] = [];
    grouped[variable.agentId].push(variable);
  }

  return grouped;
});

function formatVariableType(variableType: VariableType): string {
  return variableType === 'credential' ? 'Credential' : 'Property';
}

function formatDate(dateValue?: string): string {
  if (!dateValue) return 'just now';
  return new Date(dateValue).toLocaleString();
}

function variableDetailLocation(id: string, scope: VariableScope) {
  return {
    path: `/${ws.value}/variables/${id}`,
    query: { scope },
  };
}

async function fetchAllVariables() {
  const [userResult, workspaceResult, agentResults] = await Promise.all([
    $fetch<{ variables: VariableRecord[] }>('/api/variables?scope=user', { headers }).catch(() => ({ variables: [] })),
    isAdmin.value
      ? $fetch<{ variables: VariableRecord[] }>('/api/variables?scope=workspace', { headers }).catch(() => ({ variables: [] }))
      : Promise.resolve({ variables: [] as VariableRecord[] }),
    Promise.all(
      agents.value.map(async (agent) => {
        const result = await $fetch<{ variables: VariableRecord[] }>(`/api/variables?agentId=${agent.id}`, { headers }).catch(() => ({ variables: [] as VariableRecord[] }));
        return result.variables.map((variable) => ({ ...variable, agentId: agent.id }));
      }),
    ),
  ]);

  userVariables.value = userResult.variables;
  workspaceVariables.value = workspaceResult.variables;
  allAgentVariables.value = agentResults.flat();
}

await fetchAllVariables();

async function handleDelete(id: string, key: string, scope: VariableScope) {
  if (!confirm(`Delete variable "${key}"?`)) return;

  try {
    const query = scope === 'agent' ? '' : `?scope=${scope}`;
    await $fetch(`/api/variables/${id}${query}`, {
      method: 'DELETE',
      headers,
    });
    await fetchAllVariables();
  } catch {
    alert('Failed to delete variable');
  }
}
</script>
