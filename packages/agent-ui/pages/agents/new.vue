<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href="/agents">Agents</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>New Agent</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <h1 class="text-3xl font-bold mt-4 mb-6">Create New Agent</h1>

    <Card class="max-w-2xl">
      <CardContent class="pt-6">
        <div v-if="formError" class="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ formError }}</div>
        <form @submit.prevent="handleSubmit" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="name">Name *</Label>
              <Input id="name" v-model="form.name" required placeholder="My Trading Agent" />
            </div>
            <div class="space-y-2">
              <Label for="gitRepoUrl">Git Repository URL *</Label>
              <Input id="gitRepoUrl" v-model="form.gitRepoUrl" type="url" required placeholder="https://github.com/user/repo" />
            </div>
            <div class="space-y-2">
              <Label for="gitBranch">Git Branch</Label>
              <Input id="gitBranch" v-model="form.gitBranch" placeholder="main" />
            </div>
            <div class="space-y-2">
              <Label for="agentFilePath">Agent File Path *</Label>
              <Input id="agentFilePath" v-model="form.agentFilePath" required placeholder=".github/agents/trading.md" />
            </div>
          </div>
          <div class="space-y-2">
            <Label for="description">Description</Label>
            <Textarea id="description" v-model="form.description" rows="2" placeholder="What does this agent do?" />
          </div>
          <div class="space-y-2">
            <Label for="githubToken">GitHub Token (optional, encrypted at rest)</Label>
            <Input id="githubToken" v-model="form.githubToken" type="password" class="max-w-md" placeholder="ghp_..." />
          </div>
          <div class="flex gap-3 pt-2">
            <Button type="submit" :disabled="submitting">
              {{ submitting ? 'Creating...' : 'Create Agent' }}
            </Button>
            <NuxtLink to="/agents">
              <Button variant="outline" type="button">Cancel</Button>
            </NuxtLink>
          </div>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();
const router = useRouter();

const submitting = ref(false);
const formError = ref('');
const form = reactive({
  name: '',
  description: '',
  gitRepoUrl: '',
  gitBranch: 'main',
  agentFilePath: '',
  githubToken: '',
});

async function handleSubmit() {
  formError.value = '';
  submitting.value = true;
  try {
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      gitRepoUrl: form.gitRepoUrl,
      gitBranch: form.gitBranch,
      agentFilePath: form.agentFilePath,
    };
    if (form.githubToken) body.githubToken = form.githubToken;

    const res = await $fetch<{ agent: { id: string } }>('/api/agents', { method: 'POST', headers, body });
    router.push(`/agents/${res.agent.id}`);
  } catch (e: any) {
    formError.value = e?.data?.error || 'Failed to create agent';
  } finally {
    submitting.value = false;
  }
}
</script>
