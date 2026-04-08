<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink :href="`/${ws}`">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Workspaces</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex items-center justify-between mt-4 mb-6">
      <div>
        <h1 class="text-3xl font-bold">Workspaces</h1>
        <p class="text-muted-foreground text-sm mt-1">Manage tenant workspaces (super admin only)</p>
      </div>
      <Button @click="showCreateDialog = true">+ Create Workspace</Button>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card v-for="w in workspaces" :key="w.id" class="relative">
        <CardHeader class="pb-2">
          <div class="flex items-center justify-between">
            <CardTitle class="text-lg">{{ w.name }}</CardTitle>
            <div class="flex items-center gap-2">
              <Badge v-if="w.isDefault" variant="default">Default</Badge>
              <Badge variant="outline" class="font-mono text-xs">/{{ w.slug }}</Badge>
            </div>
          </div>
          <CardDescription v-if="w.description">{{ w.description }}</CardDescription>
        </CardHeader>
        <CardContent>
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>{{ w.memberCount ?? 0 }} members</span>
            <span>Created: {{ new Date(w.createdAt).toLocaleDateString() }}</span>
          </div>
          <div class="flex gap-2 mt-3">
            <Button size="sm" variant="outline" @click="viewWorkspace(w)">View Members</Button>
            <Button v-if="!w.isDefault" size="sm" variant="destructive" @click="deleteWorkspace(w)">Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>
    <p v-if="workspaces.length === 0" class="text-muted-foreground text-center py-8">No workspaces found.</p>

    <!-- Create Workspace Dialog -->
    <Dialog v-model:open="showCreateDialog">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Workspace</DialogTitle>
          <DialogDescription>Create a new tenant workspace with a unique slug.</DialogDescription>
        </DialogHeader>
        <div class="space-y-4 py-2">
          <div v-if="createError" class="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{{ createError }}</div>
          <div>
            <Label for="ws-name">Name</Label>
            <Input id="ws-name" v-model="createForm.name" placeholder="My Workspace" />
          </div>
          <div>
            <Label for="ws-slug">Slug (URL path)</Label>
            <Input id="ws-slug" v-model="createForm.slug" placeholder="my-workspace" class="font-mono" />
            <p class="text-xs text-muted-foreground mt-1">Lowercase letters, numbers, and hyphens only.</p>
          </div>
          <div>
            <Label for="ws-desc">Description (optional)</Label>
            <Textarea id="ws-desc" v-model="createForm.description" rows="2" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCreateDialog = false">Cancel</Button>
          <Button :disabled="creating" @click="handleCreate">{{ creating ? 'Creating...' : 'Create' }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- View Members Dialog -->
    <Dialog v-model:open="showMembersDialog">
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>Members — {{ selectedWorkspace?.name }}</DialogTitle>
        </DialogHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="m in members" :key="m.id">
              <TableCell>{{ m.name }}</TableCell>
              <TableCell>{{ m.email }}</TableCell>
              <TableCell>
                <Badge :variant="m.role === 'workspace_admin' || m.role === 'super_admin' ? 'default' : 'secondary'">
                  {{ roleLabel(m.role) }}
                </Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-if="members.length === 0" class="text-muted-foreground text-center py-4">No members in this workspace.</p>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
const { authHeaders, user } = useAuth();
const headers = authHeaders();
const route = useRoute();
const ws = computed(() => (route.params.workspace as string) || 'default');

// Redirect non-super_admin
if (user.value?.role !== 'super_admin') {
  navigateTo(`/${ws.value}`);
}

interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isDefault: boolean;
  memberCount?: number;
  createdAt: string;
}

const { data, refresh } = await useFetch<{ workspaces: Workspace[] }>('/api/workspaces', { headers });
const workspaces = computed(() => data.value?.workspaces ?? []);

// Create dialog
const showCreateDialog = ref(false);
const creating = ref(false);
const createError = ref('');
const createForm = reactive({ name: '', slug: '', description: '' });

async function handleCreate() {
  createError.value = '';
  creating.value = true;
  try {
    await $fetch('/api/workspaces', {
      method: 'POST',
      headers,
      body: {
        name: createForm.name,
        slug: createForm.slug,
        description: createForm.description || undefined,
      },
    });
    showCreateDialog.value = false;
    createForm.name = '';
    createForm.slug = '';
    createForm.description = '';
    await refresh();
  } catch (e: any) {
    createError.value = e?.data?.error || 'Failed to create workspace';
  } finally {
    creating.value = false;
  }
}

// Members dialog
const showMembersDialog = ref(false);
const selectedWorkspace = ref<Workspace | null>(null);
const members = ref<Array<{ id: string; name: string; email: string; role: string }>>([]);

async function viewWorkspace(w: Workspace) {
  selectedWorkspace.value = w;
  showMembersDialog.value = true;
  try {
    const res = await $fetch<{ workspace: any; members: typeof members.value }>(`/api/workspaces/${w.id}`, { headers });
    members.value = res.members ?? [];
  } catch {
    members.value = [];
  }
}

async function deleteWorkspace(w: Workspace) {
  if (!confirm(`Delete workspace "${w.name}"? This will affect all members and data.`)) return;
  try {
    await $fetch(`/api/workspaces/${w.id}`, { method: 'DELETE', headers });
    await refresh();
  } catch (e: any) {
    alert(e?.data?.error || 'Failed to delete workspace');
  }
}

function roleLabel(role: string) {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'workspace_admin') return 'Admin';
  if (role === 'view_user') return 'Viewer';
  return 'Creator';
}
</script>
