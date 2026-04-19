<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink :href="`/${ws}`">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink :href="`/${ws}/variables`">Variables</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>New Variable</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="max-w-3xl space-y-6 mt-4">
      <div>
        <h1 class="text-3xl font-bold">Create Variable</h1>
        <p class="text-muted-foreground text-sm mt-1">Create a credential or property variable using the same in-page workflow as the rest of the platform.</p>
      </div>

      <div v-if="formError" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{{ formError }}</div>

      <form class="space-y-6" @submit.prevent="handleSubmit">
        <Card>
          <CardHeader>
            <CardTitle>Classification</CardTitle>
            <CardDescription>Choose where this variable applies and how it should be treated at runtime.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div class="space-y-2">
                <Label>Scope *</Label>
                <select v-model="form.scope" class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="user">User</option>
                  <option value="agent">Agent</option>
                  <option v-if="isAdmin" value="workspace">Workspace</option>
                </select>
              </div>
              <div class="space-y-2">
                <Label>Type *</Label>
                <select v-model="form.variableType" class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="credential">Credential</option>
                  <option value="property">Property</option>
                </select>
              </div>
            </div>

            <div v-if="form.scope === 'agent'" class="space-y-2">
              <Label>Agent *</Label>
              <select v-model="form.agentId" class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" required>
                <option value="" disabled>Select an agent…</option>
                <option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.name }}</option>
              </select>
            </div>

            <div v-if="form.variableType === 'credential'" class="space-y-2">
              <Label>Credential Type *</Label>
              <select v-model="form.credentialSubType" class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="secret_text">Secret Text</option>
                <option value="github_token">GitHub Token</option>
                <option value="github_app">GitHub App</option>
                <option value="user_account">User Account</option>
                <option value="private_key">Private Key</option>
                <option value="certificate">Certificate</option>
              </select>
              <p class="text-xs text-muted-foreground">{{ CREDENTIAL_SUB_TYPE_HINTS[form.credentialSubType] }}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
            <CardDescription>Keys must be uppercase snake case so they can be referenced consistently in prompts and environment variables.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="space-y-2">
              <Label>Key *</Label>
              <Input v-model="form.key" required pattern="^[A-Z_][A-Z0-9_]*$" class="font-mono" placeholder="API_KEY" />
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
            <CardTitle>Stored Value</CardTitle>
            <CardDescription>Values are encrypted at rest. Complex credential types are serialized automatically before storage.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-4">
            <template v-if="form.variableType === 'credential' && form.credentialSubType === 'github_app'">
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="space-y-2">
                  <Label>App ID *</Label>
                  <Input v-model="subFields.appId" placeholder="123456" />
                </div>
                <div class="space-y-2">
                  <Label>Installation ID *</Label>
                  <Input v-model="subFields.installationId" placeholder="789012" />
                </div>
              </div>
              <div class="space-y-2">
                <Label>Private Key (PEM) *</Label>
                <Textarea v-model="subFields.privateKey" rows="6" class="font-mono text-xs" placeholder="-----BEGIN PRIVATE KEY-----" />
              </div>
            </template>

            <template v-else-if="form.variableType === 'credential' && form.credentialSubType === 'user_account'">
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div class="space-y-2">
                  <Label>Username *</Label>
                  <Input v-model="subFields.username" placeholder="user@example.com" />
                </div>
                <div class="space-y-2">
                  <Label>Password / Secret *</Label>
                  <Input v-model="subFields.password" type="password" placeholder="Secret" />
                </div>
              </div>
            </template>

            <template v-else-if="form.variableType === 'credential' && form.credentialSubType === 'private_key'">
              <div class="space-y-2">
                <Label>Private Key *</Label>
                <Textarea v-model="subFields.key" rows="6" class="font-mono text-xs" placeholder="-----BEGIN PRIVATE KEY-----" />
              </div>
              <div class="space-y-2">
                <Label>Passphrase</Label>
                <Input v-model="subFields.passphrase" type="password" placeholder="Optional passphrase" />
              </div>
            </template>

            <template v-else-if="form.variableType === 'credential' && form.credentialSubType === 'certificate'">
              <div class="space-y-2">
                <Label>Certificate *</Label>
                <Textarea v-model="subFields.certificate" rows="5" class="font-mono text-xs" placeholder="-----BEGIN CERTIFICATE-----" />
              </div>
              <div class="space-y-2">
                <Label>Private Key</Label>
                <Textarea v-model="subFields.key" rows="5" class="font-mono text-xs" placeholder="-----BEGIN PRIVATE KEY-----" />
              </div>
              <div class="space-y-2">
                <Label>Passphrase</Label>
                <Input v-model="subFields.passphrase" type="password" placeholder="Optional passphrase" />
              </div>
            </template>

            <template v-else-if="form.variableType === 'property'">
              <div class="space-y-2">
                <Label>Property Value *</Label>
                <Textarea v-model="form.value" rows="4" class="font-mono text-sm" placeholder="Can be referenced with {{ Properties.KEY_NAME }}" />
              </div>
            </template>

            <template v-else>
              <div class="space-y-2">
                <Label>Credential Value *</Label>
                <Input v-model="form.value" type="password" :placeholder="form.credentialSubType === 'github_token' ? 'ghp_xxxxxxxxxxxx' : 'Secret value'" />
              </div>
            </template>
          </CardContent>
        </Card>

        <div class="flex gap-3">
          <Button type="submit" :disabled="submitting">{{ submitting ? 'Creating…' : 'Create Variable' }}</Button>
          <NuxtLink :to="`/${ws}/variables`">
            <Button variant="outline" type="button">Cancel</Button>
          </NuxtLink>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useVariableEditor, type VariableScope } from '~/composables/useVariableEditor';

interface AgentSummary {
  id: string;
  name: string;
}

const { authHeaders, user } = useAuth();
const route = useRoute();
const router = useRouter();
const headers = authHeaders();
const ws = computed(() => (route.params.workspace as string) || 'default');
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');

const {
  CREDENTIAL_SUB_TYPE_HINTS,
  createEmptyVariableForm,
  createEmptyVariableSubFields,
  serializeVariableValue,
} = useVariableEditor();

const { data: agentsData } = await useFetch('/api/agents', { headers });
const agents = computed<AgentSummary[]>(() => (agentsData.value?.agents ?? []) as AgentSummary[]);

const submitting = ref(false);
const formError = ref('');
const form = reactive(createEmptyVariableForm());
const subFields = reactive(createEmptyVariableSubFields());

watch(() => form.scope, (scope) => {
  if (scope !== 'agent') form.agentId = '';
});

watch(() => form.variableType, (variableType) => {
  if (variableType === 'property') form.credentialSubType = 'secret_text';
  form.value = '';
  Object.assign(subFields, createEmptyVariableSubFields());
});

watch(() => form.credentialSubType, () => {
  form.value = '';
  Object.assign(subFields, createEmptyVariableSubFields());
});

async function handleSubmit() {
  formError.value = '';
  submitting.value = true;

  try {
    const serialized = serializeVariableValue({
      variableType: form.variableType,
      credentialSubType: form.credentialSubType,
      rawValue: form.value,
      subFields,
      required: true,
    });

    if (serialized.error || !serialized.value) {
      formError.value = serialized.error || 'A variable value is required.';
      return;
    }

    const response = await $fetch<{ scope: VariableScope; variable: { id: string } }>('/api/variables', {
      method: 'POST',
      headers,
      body: {
        scope: form.scope,
        agentId: form.scope === 'agent' ? form.agentId : undefined,
        key: form.key,
        value: serialized.value,
        description: form.description || undefined,
        variableType: form.variableType,
        credentialSubType: form.variableType === 'credential' ? form.credentialSubType : 'secret_text',
        injectAsEnvVariable: form.injectAsEnvVariable,
      },
    });

    await router.push({
      path: `/${ws.value}/variables/${response.variable.id}`,
      query: { scope: response.scope },
    });
  } catch (error: any) {
    formError.value = error?.data?.error || 'Failed to create variable';
  } finally {
    submitting.value = false;
  }
}
</script>