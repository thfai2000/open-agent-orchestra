<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>User Management</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex items-center justify-between mt-4 mb-6">
      <h1 class="text-3xl font-bold">User Management</h1>
      <Button @click="showAddDialog = true">+ Add User</Button>
    </div>

    <!-- Add User Dialog -->
    <Dialog v-model:open="showAddDialog">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>Create a new user in this workspace.</DialogDescription>
        </DialogHeader>
        <div v-if="addError" class="p-2 rounded-md bg-destructive/10 text-destructive text-sm">{{ addError }}</div>
        <form @submit.prevent="handleAddUser" class="space-y-3">
          <div class="space-y-1.5">
            <Label>Name *</Label>
            <Input v-model="addForm.name" required placeholder="John Doe" />
          </div>
          <div class="space-y-1.5">
            <Label>Email *</Label>
            <Input v-model="addForm.email" type="email" required placeholder="user@example.com" />
          </div>
          <div class="space-y-1.5">
            <Label>Password *</Label>
            <Input v-model="addForm.password" type="password" required placeholder="Min 8 characters" />
          </div>
          <div class="space-y-1.5">
            <Label>Role</Label>
            <select v-model="addForm.role"
              class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="creator_user">Creator</option>
              <option value="view_user">Viewer</option>
              <option value="workspace_admin">Admin</option>
            </select>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" @click="showAddDialog = false">Cancel</Button>
            <Button type="submit" :disabled="addingUser">{{ addingUser ? 'Adding...' : 'Add User' }}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Edit Role Dialog -->
    <Dialog v-model:open="showRoleDialog">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Role</DialogTitle>
          <DialogDescription>Update role for {{ editingUser?.name }} ({{ editingUser?.email }})</DialogDescription>
        </DialogHeader>
        <div v-if="roleError" class="p-2 rounded-md bg-destructive/10 text-destructive text-sm">{{ roleError }}</div>
        <div class="space-y-3">
          <div class="space-y-1.5">
            <Label>Role</Label>
            <select v-model="newRole"
              class="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="creator_user">Creator</option>
              <option value="view_user">Viewer</option>
              <option value="workspace_admin">Admin</option>
            </select>
          </div>
          <div class="flex justify-end gap-2">
            <Button variant="outline" @click="showRoleDialog = false">Cancel</Button>
            <Button :disabled="savingRole" @click="handleUpdateRole">{{ savingRole ? 'Saving...' : 'Save' }}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <Card>
      <CardHeader>
        <CardTitle>Workspace Users</CardTitle>
        <CardDescription>Manage users and their roles in this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created</TableHead>
              <TableHead class="w-[100px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="u in userList" :key="u.id">
              <TableCell class="font-medium">{{ u.name }}</TableCell>
              <TableCell class="text-muted-foreground">{{ u.email }}</TableCell>
              <TableCell>
                <Badge :variant="u.role === 'super_admin' || u.role === 'workspace_admin' ? 'default' : 'secondary'">
                  {{ roleLabel(u.role) }}
                </Badge>
              </TableCell>
              <TableCell class="text-muted-foreground text-sm">{{ new Date(u.createdAt).toLocaleDateString() }}</TableCell>
              <TableCell class="text-right">
                <Button v-if="u.role !== 'super_admin'" variant="ghost" size="sm" @click="openRoleDialog(u)">
                  Edit Role
                </Button>
                <span v-else class="text-xs text-muted-foreground">—</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-if="userList.length === 0" class="text-muted-foreground py-4 text-center">No users found.</p>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();

const { data: usersData, refresh } = await useFetch('/api/admin/users', { headers });
const userList = computed(() => (usersData.value as { users: Array<{ id: string; name: string; email: string; role: string; createdAt: string }> })?.users ?? []);

// ── Add User ─────────────────────────────────────────────────────
const showAddDialog = ref(false);
const addingUser = ref(false);
const addError = ref('');
const addForm = reactive({ name: '', email: '', password: '', role: 'creator_user' });

async function handleAddUser() {
  addError.value = '';
  addingUser.value = true;
  try {
    await $fetch('/api/admin/users', {
      method: 'POST',
      headers,
      body: { name: addForm.name, email: addForm.email, password: addForm.password, role: addForm.role },
    });
    showAddDialog.value = false;
    Object.assign(addForm, { name: '', email: '', password: '', role: 'creator_user' });
    await refresh();
  } catch (e: any) {
    addError.value = e?.data?.error || 'Failed to add user';
  } finally {
    addingUser.value = false;
  }
}

// ── Edit Role ────────────────────────────────────────────────────
const showRoleDialog = ref(false);
const savingRole = ref(false);
const roleError = ref('');
const editingUser = ref<{ id: string; name: string; email: string; role: string } | null>(null);
const newRole = ref('creator_user');

function openRoleDialog(u: { id: string; name: string; email: string; role: string }) {
  editingUser.value = u;
  newRole.value = u.role;
  roleError.value = '';
  showRoleDialog.value = true;
}

async function handleUpdateRole() {
  if (!editingUser.value) return;
  roleError.value = '';
  savingRole.value = true;
  try {
    await $fetch(`/api/admin/users/${editingUser.value.id}/role`, {
      method: 'PUT',
      headers,
      body: { role: newRole.value },
    });
    showRoleDialog.value = false;
    await refresh();
  } catch (e: any) {
    roleError.value = e?.data?.error || 'Failed to update role';
  } finally {
    savingRole.value = false;
  }
}

function roleLabel(role: string) {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'workspace_admin') return 'Admin';
  if (role === 'view_user') return 'Viewer';
  return 'Creator';
}
</script>
