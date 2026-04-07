<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>User Management</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <h1 class="text-3xl font-bold mt-4 mb-8">User Management</h1>

    <Card>
      <CardHeader>
        <CardTitle>All Users</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created</TableHead>
              <TableHead class="w-[140px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="u in userList" :key="u.id">
              <TableCell class="font-medium">{{ u.name }}</TableCell>
              <TableCell>{{ u.email }}</TableCell>
              <TableCell>
                <Badge :variant="u.role === 'admin' ? 'default' : 'secondary'">
                  {{ u.role === 'admin' ? 'Admin' : 'Creator' }}
                </Badge>
              </TableCell>
              <TableCell class="text-muted-foreground text-sm">{{ new Date(u.createdAt).toLocaleDateString() }}</TableCell>
              <TableCell>
                <Select :model-value="u.role" @update:model-value="(val: string) => updateRole(u.id, val)">
                  <SelectTrigger class="h-8 w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Creator</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-if="userList.length === 0" class="text-muted-foreground py-4">No users found.</p>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
const { authHeaders } = useAuth();
const headers = authHeaders();

const { data: usersData, refresh } = await useFetch('/api/admin/users', { headers });
const userList = computed(() => (usersData.value as { users: Array<{ id: string; name: string; email: string; role: string; createdAt: string }> })?.users ?? []);

async function updateRole(userId: string, newRole: string) {
  await $fetch(`/api/admin/users/${userId}/role`, {
    method: 'PUT',
    headers,
    body: { role: newRole },
  });
  await refresh();
}
</script>
