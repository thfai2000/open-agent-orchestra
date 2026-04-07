<template>
  <div>
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem><BreadcrumbLink href="/">Home</BreadcrumbLink></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem><BreadcrumbPage>Model Management</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>

    <div class="flex items-center justify-between mt-4 mb-8">
      <h1 class="text-3xl font-bold">Model Management</h1>
      <Dialog v-model:open="showAddDialog">
        <Button @click="showAddDialog = true">+ Add Model</Button>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Model</DialogTitle></DialogHeader>
          <div class="space-y-4 mt-4">
            <div>
              <Label>Model Name</Label>
              <Input v-model="form.name" placeholder="e.g. gpt-4.1" />
            </div>
            <div>
              <Label>Provider</Label>
              <Input v-model="form.provider" placeholder="e.g. github" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea v-model="form.description" placeholder="Model description" rows="2" />
            </div>
            <div>
              <Label>Credit Cost per Session</Label>
              <Input v-model="form.creditCost" type="text" placeholder="1.00" />
            </div>
            <div class="flex items-center gap-2">
              <Switch :checked="form.isActive" @update:checked="(val: boolean) => form.isActive = val" />
              <Label>Active</Label>
            </div>
            <Button @click="createModel" class="w-full" :disabled="!form.name">Create Model</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>

    <Card>
      <CardContent class="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Credit Cost</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Description</TableHead>
              <TableHead class="w-[160px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="m in modelList" :key="m.id">
              <TableCell class="font-medium">{{ m.name }}</TableCell>
              <TableCell>{{ m.provider }}</TableCell>
              <TableCell>
                <div v-if="editingId === m.id" class="flex items-center gap-1">
                  <Input v-model="editCreditCost" class="h-8 w-20" />
                  <Button size="sm" variant="ghost" class="h-8 px-2" @click="saveCreditCost(m.id)">✓</Button>
                  <Button size="sm" variant="ghost" class="h-8 px-2" @click="editingId = null">✕</Button>
                </div>
                <button v-else class="hover:underline cursor-pointer" @click="startEditCreditCost(m)">{{ m.creditCost }}</button>
              </TableCell>
              <TableCell>
                <Badge :variant="m.isActive ? 'default' : 'secondary'">{{ m.isActive ? 'Active' : 'Inactive' }}</Badge>
              </TableCell>
              <TableCell class="text-muted-foreground text-sm max-w-[200px] truncate">{{ m.description || '—' }}</TableCell>
              <TableCell class="flex items-center gap-1">
                <Button size="sm" variant="ghost" class="h-8"
                  @click="toggleActive(m.id, !m.isActive)">
                  {{ m.isActive ? 'Disable' : 'Enable' }}
                </Button>
                <Button size="sm" variant="ghost" class="h-8 text-destructive" @click="deleteModel(m.id)">Delete</Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-if="modelList.length === 0" class="text-muted-foreground py-4">No models configured. Add your first model above.</p>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
interface ModelRecord {
  id: string;
  name: string;
  provider: string;
  description: string | null;
  creditCost: string;
  isActive: boolean;
  createdAt: string;
}

const { authHeaders } = useAuth();
const headers = authHeaders();

const { data: modelsData, refresh } = await useFetch('/api/admin/models', { headers });
const modelList = computed(() => (modelsData.value as { models: ModelRecord[] })?.models ?? []);

const showAddDialog = ref(false);
const form = reactive({ name: '', provider: 'github', description: '', creditCost: '1.00', isActive: true });
const editingId = ref<string | null>(null);
const editCreditCost = ref('');

async function createModel() {
  await $fetch('/api/admin/models', {
    method: 'POST',
    headers,
    body: { name: form.name, provider: form.provider, description: form.description, creditCost: form.creditCost, isActive: form.isActive },
  });
  Object.assign(form, { name: '', provider: 'github', description: '', creditCost: '1.00', isActive: true });
  showAddDialog.value = false;
  await refresh();
}

function startEditCreditCost(m: ModelRecord) {
  editingId.value = m.id;
  editCreditCost.value = m.creditCost;
}

async function saveCreditCost(id: string) {
  await $fetch(`/api/admin/models/${id}`, {
    method: 'PUT',
    headers,
    body: { creditCost: editCreditCost.value },
  });
  editingId.value = null;
  await refresh();
}

async function toggleActive(id: string, isActive: boolean) {
  await $fetch(`/api/admin/models/${id}`, {
    method: 'PUT',
    headers,
    body: { isActive },
  });
  await refresh();
}

async function deleteModel(id: string) {
  if (!confirm('Delete this model?')) return;
  await $fetch(`/api/admin/models/${id}`, {
    method: 'DELETE',
    headers,
  });
  await refresh();
}
</script>
