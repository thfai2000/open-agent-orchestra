<template>
  <div class="min-h-screen bg-background text-foreground">
    <!-- Top bar (always visible) -->
    <header class="h-14 border-b border-border bg-card flex items-center justify-between px-4 fixed top-0 left-0 right-0 z-30">
      <div class="flex items-center gap-3">
        <button v-if="isAuthenticated" @click="sidebarOpen = !sidebarOpen" class="p-1.5 rounded-md hover:bg-muted">
          <span class="text-lg">☰</span>
        </button>
        <NuxtLink :to="`/${ws}`" class="text-lg font-bold text-primary">OAO</NuxtLink>
      </div>
      <div class="flex items-center gap-4">
        <template v-if="isAuthenticated">
          <span class="text-sm text-muted-foreground hidden sm:inline">{{ user?.name }} <span class="text-xs">({{ roleLabel }})</span></span>
          <button @click="logout" class="text-sm text-muted-foreground hover:text-foreground transition">Logout</button>
        </template>
        <template v-else>
          <NuxtLink :to="`/${ws}/login`" class="text-sm text-muted-foreground hover:text-foreground transition">Login</NuxtLink>
        </template>
      </div>
    </header>

    <div class="pt-14 flex">
      <!-- Sidebar overlay (mobile) -->
      <div v-if="sidebarOpen && isAuthenticated" class="fixed inset-0 bg-black/30 z-20 lg:hidden" @click="sidebarOpen = false" />

      <!-- Sidebar -->
      <aside v-if="isAuthenticated"
        :class="[
          'fixed top-14 bottom-0 z-20 w-56 bg-card border-r border-border flex flex-col transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-56',
        ]">
        <nav class="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Main</p>
          <NuxtLink v-for="item in mainNav" :key="item.to" :to="item.to"
            :class="['flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition',
              isActiveRoute(item.to) ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted']"
            @click="closeMobileSidebar">
            <span>{{ item.icon }}</span><span>{{ item.label }}</span>
          </NuxtLink>

          <template v-if="isAdmin">
            <Separator class="my-3" />
            <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Admin</p>
            <NuxtLink v-for="item in adminNav" :key="item.to" :to="item.to"
              :class="['flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition',
                isActiveRoute(item.to) ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted']"
              @click="closeMobileSidebar">
              <span>{{ item.icon }}</span><span>{{ item.label }}</span>
            </NuxtLink>
          </template>

          <template v-if="user?.role === 'super_admin'">
            <Separator class="my-3" />
            <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">System</p>
            <NuxtLink :to="`/${ws}/workspaces`"
              :class="['flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition',
                isActiveRoute(`/${ws}/workspaces`) ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted']"
              @click="closeMobileSidebar">
              <span>🏢</span><span>Workspaces</span>
            </NuxtLink>
          </template>
        </nav>

        <!-- Sidebar footer -->
        <div class="border-t border-border px-3 py-3">
          <div class="text-xs text-muted-foreground truncate">{{ user?.name }}</div>
          <div class="text-[10px] text-muted-foreground">{{ roleLabel }}</div>
        </div>
      </aside>

      <!-- Main content -->
      <main :class="['flex-1 min-h-[calc(100vh-3.5rem)] transition-all duration-200',
        isAuthenticated ? 'lg:ml-56' : '']">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <NuxtPage />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const { user, isAuthenticated, logout } = useAuth();
const route = useRoute();
const sidebarOpen = ref(false);

const ws = computed(() => user.value?.workspaceSlug || (route.params.workspace as string) || 'default');
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');
const roleLabel = computed(() => {
  const r = user.value?.role;
  if (r === 'super_admin') return 'Super Admin';
  if (r === 'workspace_admin') return 'Admin';
  if (r === 'view_user') return 'Viewer';
  return 'Creator';
});

const mainNav = computed(() => [
  { to: `/${ws.value}`, icon: '🏠', label: 'Dashboard' },
  { to: `/${ws.value}/agents`, icon: '🤖', label: 'Agents' },
  { to: `/${ws.value}/workflows`, icon: '⚡', label: 'Workflows' },
  { to: `/${ws.value}/executions`, icon: '📋', label: 'Executions' },
  { to: `/${ws.value}/instances`, icon: '🖥️', label: 'Instances' },
  { to: `/${ws.value}/events`, icon: '📡', label: 'Events' },
  { to: `/${ws.value}/variables`, icon: '🔑', label: 'Variables' },
  { to: `/${ws.value}/plugins`, icon: '🧩', label: 'Plugins' },
  { to: `/${ws.value}/admin/quotas`, icon: '📊', label: 'Quotas' },
  { to: `/${ws.value}/settings/change-password`, icon: '⚙️', label: 'Settings' },
]);

const adminNav = computed(() => [
  { to: `/${ws.value}/admin/users`, icon: '👥', label: 'Users' },
  { to: `/${ws.value}/admin/models`, icon: '🧠', label: 'Models' },
]);

function isActiveRoute(path: string) {
  if (path === `/${ws.value}`) return route.path === path;
  return route.path.startsWith(path);
}

function closeMobileSidebar() {
  if (window.innerWidth < 1024) sidebarOpen.value = false;
}
</script>

<style>
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --card: 0 0% 100%;
  --card-foreground: 222.2 84% 4.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 222.2 84% 4.9%;
  --primary: 262.1 83.3% 57.8%;
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222.2 47.4% 11.2%;
  --muted: 210 40% 96%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 210 40% 98%;
  --border: 214.3 31.8% 91.4%;
  --input: 214.3 31.8% 91.4%;
  --ring: 262.1 83.3% 57.8%;
  --radius: 0.5rem;
}
</style>
