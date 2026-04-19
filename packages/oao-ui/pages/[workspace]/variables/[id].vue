<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink :href="`/${ws}`">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink :href="`/${ws}/variables`">Variables</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>{{ variable?.key || 'Variable' }}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div v-if="loadError" class="max-w-3xl mt-4">
      <Card>
        <CardContent class="py-10 text-center text-sm text-muted-foreground">Unable to load this variable.</CardContent>
      </Card>
    </div>

    <div v-else-if="variable" class="max-w-3xl space-y-6 mt-4">
      <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 class="text-3xl font-bold">{{ variable.key }}</h1>
          <div class="flex flex-wrap items-center gap-1.5 mt-1">
            <Badge :variant="variable.variableType === 'property' ? 'outline' : 'secondary'">{{ formatVariableType(variable.variableType) }}</Badge>
            <Badge variant="outline">{{ formatVariableScopeLabel(form.scope) }}</Badge>
            <Badge v-if="variable.variableType === 'credential' && variable.credentialSubType && variable.credentialSubType !== 'secret_text'" variant="outline">{{ formatCredentialSubType(variable.credentialSubType) }}</Badge>
            <Badge v-if="form.injectAsEnvVariable" variant="outline">Environment</Badge>
          </div>
          <p class="text-muted-foreground text-sm mt-2">Stored values remain encrypted. Replace the value only when you need to rotate or change it.</p>
        </div>
        <Button v-if="canManageVariables" variant="destructive" @click="handleDelete">Delete Variable</Button>
      </div>

      <div v-if="formError" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{{ formError }}</div>
      <div v-if="saveMessage" class="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{{ saveMessage }}</div>

      <form class="space-y-6" @submit.prevent="handleSave">
        <Card>
          <CardHeader>
            <CardTitle>Variable Details</CardTitle>
            <CardDescription>Scope, type, and key stay fixed after creation so references remain stable.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div class="space-y-2">
                <Label>Scope</Label>
                <div class="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">{{ formatVariableScopeLabel(form.scope) }}</div>
              </div>
              <div class="space-y-2">
                <Label>Type</Label>
                <div class="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {{ variable.variableType === 'credential' ? 'Credential' : 'Property' }}
                  <span v-if="variable.variableType === 'credential'" class="ml-2 text-muted-foreground">{{ formatCredentialSubType(variable.credentialSubType) }}</span>
                </div>
              </div>
            </div>

            <div v-if="form.scope === 'agent'" class="space-y-2">
              <Label>Agent</Label>
              <div class="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">{{ selectedAgentName }}</div>
            </div>

            <div class="space-y-2">
              <Label>Key</Label>
              <Input :model-value="form.key" class="font-mono" disabled />
            </div>

            <div class="space-y-2">
              <Label>Description</Label>
              <Textarea v-model="form.description" rows="3" placeholder="Describe what this variable is used for." />
            </div>

            <div class="flex items-center gap-2">
              <Switch :checked="form.injectAsEnvVariable" @update:checked="form.injectAsEnvVariable = Boolean($event)" />
              <Label class="text-sm">Inject as an environment variable during agent execution</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Replace Stored Value</CardTitle>
            <CardDescription>Leave every field blank to keep the current encrypted value unchanged.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <template v-if="form.variableType === 'credential' && form.credentialSubType === 'github_app'">
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="space-y-2">
                  <Label>App ID</Label>
                  <Input v-model="subFields.appId" placeholder="Enter a new App ID" />
                </div>
                <div class="space-y-2">
                  <Label>Installation ID</Label>
                  <Input v-model="subFields.installationId" placeholder="Enter a new Installation ID" />
                </div>
              </div>
              <div class="space-y-2">
                <Label>Private Key (PEM)</Label>
                <Textarea v-model="subFields.privateKey" rows="6" class="font-mono text-xs" placeholder="Paste a full replacement key" />
              </div>
            </template>

            <template v-else-if="form.variableType === 'credential' && form.credentialSubType === 'user_account'">
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="space-y-2">
                  <Label>Username</Label>
                  <Input v-model="subFields.username" placeholder="Enter a new username" />
                </div>
                <div class="space-y-2">
                  <Label>Password / Secret</Label>
                  <Input v-model="subFields.password" type="password" placeholder="Enter a new secret" />
                </div>
              </div>
            </template>

            <template v-else-if="form.variableType === 'credential' && form.credentialSubType === 'private_key'">
              <div class="space-y-2">
                <Label>Private Key</Label>
                <Textarea v-model="subFields.key" rows="6" class="font-mono text-xs" placeholder="Paste a full replacement key" />
              </div>
              <div class="space-y-2">
                <Label>Passphrase</Label>
                <Input v-model="subFields.passphrase" type="password" placeholder="Optional new passphrase" />
              </div>
            </template>

            <template v-else-if="form.variableType === 'credential' && form.credentialSubType === 'certificate'">
              <div class="space-y-2">
                <Label>Certificate</Label>
                <Textarea v-model="subFields.certificate" rows="5" class="font-mono text-xs" placeholder="Paste a full replacement certificate" />
              </div>
              <div class="space-y-2">
                <Label>Private Key</Label>
                <Textarea v-model="subFields.key" rows="5" class="font-mono text-xs" placeholder="Optional replacement private key" />
              </div>
              <div class="space-y-2">
                <Label>Passphrase</Label>
                <Input v-model="subFields.passphrase" type="password" placeholder="Optional new passphrase" />
              </div>
            </template>

            <template v-else-if="form.variableType === 'property'">
              <div class="space-y-2">
                <Label>Replacement Property Value</Label>
                <Textarea v-model="form.value" rows="4" class="font-mono text-sm" placeholder="Leave empty to keep the current property value" />
              </div>
            </template>

            <template v-else>
              <div class="space-y-2">
                <Label>Replacement Credential Value</Label>
                <Input v-model="form.value" type="password" :placeholder="form.credentialSubType === 'github_token' ? 'ghp_xxxxxxxxxxxx' : 'Leave empty to keep the current secret'" />
              </div>
            </template>

            <p class="text-xs text-muted-foreground">Updated {{ formatDate(variable.updatedAt) }}</p>
          </CardContent>
        </Card>

        <div class="flex gap-3">
          <Button type="submit" :disabled="submitting">{{ submitting ? 'Saving…' : 'Save Changes' }}</Button>
          <NuxtLink :to="`/${ws}/variables`">
            <Button variant="outline" type="button">Back to Variables</Button>
          </NuxtLink>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVariableEditor, type VariableScope, type VariableSummary, type VariableType } from '~/composables/useVariableEditor';

interface AgentSummary {
  id: string;
  name: string;
}

type VariableDetail = VariableSummary & { scope: VariableScope; agentId?: string | null };

const { authHeaders, user } = useAuth();
const route = useRoute();
const router = useRouter();
const headers = authHeaders();
const ws = computed(() => (route.params.workspace as string) || 'default');
const canManageVariables = computed(() => user.value?.role !== 'view_user');

const {
  createEmptyVariableForm,
  createEmptyVariableSubFields,
  formatCredentialSubType,
  formatVariableScopeLabel,
  serializeVariableValue,
} = useVariableEditor();

const scopeQuery = computed(() => {
  const scope = route.query.scope;
  return scope === 'agent' || scope === 'user' || scope === 'workspace' ? scope : undefined;
});

const { data: agentsData } = await useFetch('/api/agents', { headers });
const agents = computed<AgentSummary[]>(() => (agentsData.value?.agents ?? []) as AgentSummary[]);

const variableId = computed(() => route.params.id as string);
const querySuffix = computed(() => (scopeQuery.value ? `?scope=${scopeQuery.value}` : ''));

const { data: variableData, error: loadError, refresh } = await useFetch<{ variable: VariableDetail }>(
  () => `/api/variables/${variableId.value}${querySuffix.value}`,
  { headers },
);

const variable = computed<VariableDetail | null>(() => variableData.value?.variable ?? null);

const formError = ref('');
const saveMessage = ref('');
const submitting = ref(false);
const form = reactive(createEmptyVariableForm());
const subFields = reactive(createEmptyVariableSubFields());

watch(
  variable,
  (current) => {
    if (!current) return;

    Object.assign(form, createEmptyVariableForm({
      scope: current.scope,
      agentId: current.agentId ?? '',
      key: current.key,
      value: '',
      description: current.description ?? '',
      variableType: current.variableType,
      credentialSubType: current.credentialSubType ?? 'secret_text',
      injectAsEnvVariable: current.injectAsEnvVariable,
    }));
    Object.assign(subFields, createEmptyVariableSubFields());
  },
  { immediate: true },
);

const selectedAgentName = computed(() => {
  if (!form.agentId) return 'Unknown agent';
  return agents.value.find((agent) => agent.id === form.agentId)?.name ?? 'Unknown agent';
});

function formatVariableType(variableType: VariableType): string {
  return variableType === 'credential' ? 'Credential' : 'Property';
}

function formatDate(dateValue?: string): string {
  if (!dateValue) return 'just now';
  return new Date(dateValue).toLocaleString();
}

async function handleSave() {
  formError.value = '';
  saveMessage.value = '';
  submitting.value = true;

  try {
    const serialized = serializeVariableValue({
      variableType: form.variableType,
      credentialSubType: form.credentialSubType,
      rawValue: form.value,
      subFields,
      required: false,
    });

    if (serialized.error) {
      formError.value = serialized.error;
      return;
    }

    const body: Record<string, unknown> = {
      scope: form.scope,
      description: form.description,
      injectAsEnvVariable: form.injectAsEnvVariable,
    };

    if (serialized.hasValue && serialized.value) body.value = serialized.value;

    await $fetch(`/api/variables/${variableId.value}`, {
      method: 'PUT',
      headers,
      body,
    });

    Object.assign(subFields, createEmptyVariableSubFields());
    form.value = '';
    saveMessage.value = 'Variable updated.';
    await refresh();
  } catch (error: any) {
    formError.value = error?.data?.error || 'Failed to update variable';
  } finally {
    submitting.value = false;
  }
}

async function handleDelete() {
  if (!variable.value) return;
  if (!confirm(`Delete variable "${variable.value.key}"?`)) return;

  try {
    const query = form.scope === 'agent' ? '' : `?scope=${form.scope}`;
    await $fetch(`/api/variables/${variableId.value}${query}`, {
      method: 'DELETE',
      headers,
    });
    await router.push(`/${ws.value}/variables`);
  } catch (error: any) {
    formError.value = error?.data?.error || 'Failed to delete variable';
  }
}
</script>