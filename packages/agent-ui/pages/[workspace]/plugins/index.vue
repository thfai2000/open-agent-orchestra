<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Plugins</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex items-center justify-between mt-4 mb-6">
      <div>
        <h1 class="text-3xl font-bold">Plugins</h1>
        <p class="text-muted-foreground text-sm mt-1">Git-hosted plugin repositories that extend agent capabilities with tools, skills, and MCP servers</p>
      </div>
      <Button v-if="isAdmin" @click="showRegisterForm = true">+ Register Plugin</Button>
    </div>

    <!-- Register Plugin Form (Admin Only) -->
    <Card v-if="showRegisterForm && isAdmin" class="mb-6 border-primary/30">
      <CardHeader><CardTitle>Register New Plugin</CardTitle></CardHeader>
      <CardContent>
        <div v-if="formError" class="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ formError }}</div>
        <form @submit.prevent="handleRegister" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label>Name *</Label>
              <Input v-model="form.name" required placeholder="my-awesome-plugin" />
            </div>
            <div class="space-y-2">
              <Label>Git Repository URL *</Label>
              <Input v-model="form.gitRepoUrl" type="url" required placeholder="https://github.com/org/plugin-repo" />
            </div>
            <div class="space-y-2">
              <Label>Git Branch</Label>
              <Input v-model="form.gitBranch" placeholder="main" />
            </div>
            <div class="space-y-2">
              <Label>GitHub Token (optional, for private repos)</Label>
              <Input v-model="form.githubToken" type="password" placeholder="ghp_..." />
            </div>
          </div>
          <div class="space-y-2">
            <Label>Description</Label>
            <Textarea v-model="form.description" rows="2" placeholder="What does this plugin do?" />
          </div>
          <div class="flex items-center gap-3">
            <Switch :checked="form.isAllowed" @update:checked="form.isAllowed = $event" />
            <Label class="text-sm">Allow for users immediately</Label>
          </div>
          <div class="flex gap-3 pt-2">
            <Button type="submit" :disabled="saving">{{ saving ? 'Registering...' : 'Register Plugin' }}</Button>
            <Button variant="outline" type="button" @click="showRegisterForm = false">Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <!-- Plugin List -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <NuxtLink v-for="plugin in pluginList" :key="plugin.id" :to="`/plugins/${plugin.id}`" class="block">
        <Card class="hover:border-primary/40 transition h-full">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between">
              <CardTitle class="text-lg">{{ plugin.name }}</CardTitle>
              <div class="flex gap-2">
                <Badge v-if="plugin.isAllowed" variant="default">Allowed</Badge>
                <Badge v-else variant="secondary">Not Allowed</Badge>
              </div>
            </div>
            <CardDescription v-if="plugin.description">{{ plugin.description }}</CardDescription>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-4 text-xs text-muted-foreground">
              <span class="truncate max-w-[250px] font-mono">{{ plugin.gitRepoUrl }}</span>
              <span class="ml-auto whitespace-nowrap font-mono">{{ plugin.gitBranch || 'main' }}</span>
            </div>
            <div v-if="plugin.manifestCache" class="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <Badge v-if="(plugin.manifestCache as any)?.tools?.length" variant="outline" class="text-[10px]">
                {{ (plugin.manifestCache as any).tools.length }} tools
              </Badge>
              <Badge v-if="(plugin.manifestCache as any)?.skills?.length" variant="outline" class="text-[10px]">
                {{ (plugin.manifestCache as any).skills.length }} skills
              </Badge>
              <Badge v-if="(plugin.manifestCache as any)?.mcpServers?.length" variant="outline" class="text-[10px]">
                {{ (plugin.manifestCache as any).mcpServers.length }} MCP servers
              </Badge>
              <span class="ml-auto">v{{ (plugin.manifestCache as any).version }}</span>
            </div>
          </CardContent>
        </Card>
      </NuxtLink>
    </div>
    <p v-if="pluginList.length === 0" class="text-muted-foreground text-center py-8">
      No plugins registered yet.{{ isAdmin ? ' Click "Register Plugin" to add one.' : '' }}
    </p>
  </div>
</template>

<script setup lang="ts">
const { authHeaders, user } = useAuth();
const headers = authHeaders();

const { data, refresh } = await useFetch('/api/plugins', { headers });
const pluginList = computed(() => (data.value as any)?.plugins ?? []);
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');

const showRegisterForm = ref(false);
const saving = ref(false);
const formError = ref('');
const form = reactive({
  name: '',
  description: '',
  gitRepoUrl: '',
  gitBranch: 'main',
  githubToken: '',
  isAllowed: false,
});

async function handleRegister() {
  formError.value = '';
  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      gitRepoUrl: form.gitRepoUrl,
      gitBranch: form.gitBranch || 'main',
      isAllowed: form.isAllowed,
    };
    if (form.githubToken) body.githubToken = form.githubToken;
    await $fetch('/api/plugins', { method: 'POST', headers, body });
    showRegisterForm.value = false;
    Object.assign(form, { name: '', description: '', gitRepoUrl: '', gitBranch: 'main', githubToken: '', isAllowed: false });
    await refresh();
  } catch (e: any) {
    formError.value = e?.data?.error || 'Failed to register plugin';
  } finally {
    saving.value = false;
  }
}
</script>
