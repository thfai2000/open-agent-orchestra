<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbLink href="/plugins">Plugins</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>{{ plugin?.name || 'Plugin' }}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div v-if="plugin" class="space-y-6 mt-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-3xl font-bold">{{ plugin.name }}</h1>
          <p v-if="plugin.description" class="text-muted-foreground mt-1">{{ plugin.description }}</p>
        </div>
        <div class="flex items-center gap-3">
          <Badge :variant="plugin.isAllowed ? 'default' : 'secondary'">
            {{ plugin.isAllowed ? 'Allowed' : 'Not Allowed' }}
          </Badge>
          <template v-if="isAdmin">
            <Button variant="outline" @click="toggleAllowed">
              {{ plugin.isAllowed ? 'Disallow' : 'Allow' }}
            </Button>
            <Button variant="outline" @click="handleSync" :disabled="syncing">
              {{ syncing ? 'Syncing...' : 'Sync Manifest' }}
            </Button>
            <Button variant="destructive" size="sm" @click="handleDelete">Delete</Button>
          </template>
        </div>
      </div>

      <!-- Edit Form (Admin) -->
      <Card v-if="editing && isAdmin" class="border-primary/30">
        <CardHeader><CardTitle>Edit Plugin</CardTitle></CardHeader>
        <CardContent>
          <div v-if="editError" class="mb-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ editError }}</div>
          <form @submit.prevent="handleSave" class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="space-y-2">
                <Label>Name *</Label>
                <Input v-model="editForm.name" required />
              </div>
              <div class="space-y-2">
                <Label>Git Repository URL *</Label>
                <Input v-model="editForm.gitRepoUrl" type="url" required />
              </div>
              <div class="space-y-2">
                <Label>Git Branch</Label>
                <Input v-model="editForm.gitBranch" />
              </div>
              <div class="space-y-2">
                <Label>GitHub Token (leave blank to keep)</Label>
                <Input v-model="editForm.githubToken" type="password" placeholder="ghp_..." />
              </div>
            </div>
            <div class="space-y-2">
              <Label>Description</Label>
              <Textarea v-model="editForm.description" rows="2" />
            </div>
            <div class="flex gap-3 pt-2">
              <Button type="submit" :disabled="saving">{{ saving ? 'Saving...' : 'Save' }}</Button>
              <Button variant="outline" type="button" @click="editing = false">Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <!-- Configuration Cards -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle class="text-base">Configuration</CardTitle></CardHeader>
          <CardContent>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between"><dt class="text-muted-foreground">Git Repo</dt><dd class="font-mono text-xs truncate max-w-[250px]">{{ plugin.gitRepoUrl }}</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Branch</dt><dd class="font-mono text-xs">{{ plugin.gitBranch || 'main' }}</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Created</dt><dd>{{ new Date(plugin.createdAt).toLocaleDateString() }}</dd></div>
              <div class="flex justify-between"><dt class="text-muted-foreground">Updated</dt><dd>{{ new Date(plugin.updatedAt).toLocaleDateString() }}</dd></div>
            </dl>
            <Button v-if="isAdmin" variant="ghost" size="sm" class="mt-3" @click="startEdit">Edit</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle class="text-base">Manifest Summary</CardTitle></CardHeader>
          <CardContent>
            <div v-if="manifest">
              <dl class="space-y-2 text-sm">
                <div class="flex justify-between"><dt class="text-muted-foreground">Plugin Name</dt><dd class="font-mono text-xs">{{ manifest.name }}</dd></div>
                <div class="flex justify-between"><dt class="text-muted-foreground">Version</dt><dd>{{ manifest.version }}</dd></div>
                <div class="flex justify-between"><dt class="text-muted-foreground">Tools</dt><dd>{{ manifest.tools?.length ?? 0 }}</dd></div>
                <div class="flex justify-between"><dt class="text-muted-foreground">Skills</dt><dd>{{ manifest.skills?.length ?? 0 }}</dd></div>
                <div class="flex justify-between"><dt class="text-muted-foreground">MCP Servers</dt><dd>{{ manifest.mcpServers?.length ?? 0 }}</dd></div>
              </dl>
            </div>
            <p v-else class="text-sm text-muted-foreground">No manifest cached. Click "Sync Manifest" to fetch.</p>
          </CardContent>
        </Card>
      </div>

      <!-- Tools Section -->
      <Card v-if="manifest?.tools?.length">
        <CardHeader>
          <CardTitle>Tools ({{ manifest.tools.length }})</CardTitle>
          <CardDescription>Script-based tools provided by this plugin</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-2">
            <div v-for="tool in manifest.tools" :key="tool.name" class="p-3 rounded-lg border border-border">
              <div class="flex items-center gap-3">
                <Badge variant="outline" class="text-[10px]">tool</Badge>
                <p class="font-mono font-semibold text-sm">{{ tool.name }}</p>
              </div>
              <p class="text-xs text-muted-foreground mt-1">{{ tool.description }}</p>
              <p class="text-xs text-muted-foreground font-mono mt-1">{{ tool.scriptPath }}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Skills Section -->
      <Card v-if="manifest?.skills?.length">
        <CardHeader>
          <CardTitle>Skills ({{ manifest.skills.length }})</CardTitle>
          <CardDescription>Skill markdown files injected into agent system message</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-2">
            <div v-for="skill in manifest.skills" :key="skill" class="p-3 rounded-lg border border-border flex items-center gap-3">
              <Badge variant="outline" class="text-[10px]">skill</Badge>
              <p class="font-mono text-sm">{{ skill }}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- MCP Servers Section -->
      <Card v-if="manifest?.mcpServers?.length">
        <CardHeader>
          <CardTitle>MCP Servers ({{ manifest.mcpServers.length }})</CardTitle>
          <CardDescription>MCP server processes spawned during agent sessions</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="space-y-2">
            <div v-for="mcp in manifest.mcpServers" :key="mcp.name" class="p-3 rounded-lg border border-border">
              <div class="flex items-center gap-3">
                <Badge variant="outline" class="text-[10px]">mcp</Badge>
                <p class="font-semibold text-sm">{{ mcp.name }}</p>
              </div>
              <p v-if="mcp.description" class="text-xs text-muted-foreground mt-1">{{ mcp.description }}</p>
              <p class="text-xs text-muted-foreground font-mono mt-1">{{ mcp.command }} {{ mcp.args?.join(' ') }}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    <p v-else class="text-muted-foreground mt-4">Plugin not found.</p>
  </div>
</template>

<script setup lang="ts">
const { authHeaders, user } = useAuth();
const headers = authHeaders();
const route = useRoute();
const router = useRouter();
const ws = computed(() => (route.params.workspace as string) || 'default');
const pluginId = route.params.id as string;

const { data: pluginData, refresh } = await useFetch(`/api/plugins/${pluginId}`, { headers });

const plugin = computed(() => (pluginData.value as any)?.plugin);
const manifest = computed(() => plugin.value?.manifestCache as any);
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');

// ── Edit Form ───────────────────────────────────────────────────
const editing = ref(false);
const saving = ref(false);
const editError = ref('');
const editForm = reactive({ name: '', description: '', gitRepoUrl: '', gitBranch: '', githubToken: '' });

function startEdit() {
  Object.assign(editForm, {
    name: plugin.value?.name || '',
    description: plugin.value?.description || '',
    gitRepoUrl: plugin.value?.gitRepoUrl || '',
    gitBranch: plugin.value?.gitBranch || 'main',
    githubToken: '',
  });
  editError.value = '';
  editing.value = true;
}

async function handleSave() {
  editError.value = '';
  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      name: editForm.name,
      description: editForm.description || undefined,
      gitRepoUrl: editForm.gitRepoUrl,
      gitBranch: editForm.gitBranch,
    };
    if (editForm.githubToken) body.githubToken = editForm.githubToken;
    await $fetch(`/api/plugins/${pluginId}`, { method: 'PUT', headers, body });
    editing.value = false;
    await refresh();
  } catch (e: any) {
    editError.value = e?.data?.error || 'Failed to save';
  } finally {
    saving.value = false;
  }
}

// ── Actions ─────────────────────────────────────────────────────
const syncing = ref(false);

async function toggleAllowed() {
  try {
    await $fetch(`/api/plugins/${pluginId}`, {
      method: 'PUT',
      headers,
      body: { isAllowed: !plugin.value.isAllowed },
    });
    await refresh();
  } catch {
    alert('Failed to update plugin status');
  }
}

async function handleSync() {
  syncing.value = true;
  try {
    await $fetch(`/api/plugins/${pluginId}/sync`, { method: 'POST', headers });
    await refresh();
  } catch (e: any) {
    alert(e?.data?.error || 'Failed to sync manifest');
  } finally {
    syncing.value = false;
  }
}

async function handleDelete() {
  if (!confirm(`Delete plugin "${plugin.value?.name}"? This cannot be undone.`)) return;
  try {
    await $fetch(`/api/plugins/${pluginId}`, { method: 'DELETE', headers });
    router.push(`/${ws.value}/plugins`);
  } catch {
    alert('Failed to delete plugin');
  }
}
</script>
