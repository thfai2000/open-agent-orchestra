<template>
  <div class="min-h-screen bg-surface-50">
    <NuxtLoadingIndicator color="repeating-linear-gradient(to right,#7c3aed 0%,#a78bfa 50%,#7c3aed 100%)" :height="3" :throttle="0" :duration="3000" />
    <Toast />
    <ConfirmDialog />

    <!-- Topbar -->
    <header class="h-14 bg-white bg-surface-0 border-b border-surface-200 flex items-center justify-between px-4 fixed top-0 left-0 right-0 z-40 backdrop-blur-sm">
      <div class="flex items-center gap-3">
        <button v-if="isAuthenticated" @click="sidebarOpen = !sidebarOpen" class="lg:hidden p-2 rounded-lg hover:bg-surface-100 transition">
          <i class="pi pi-bars text-surface-600"></i>
        </button>
        <NuxtLink :to="`/${ws}`" class="flex items-center gap-2">
          <img src="/logo.png" alt="OAO" class="w-7 h-7 rounded-full" />
          <span class="text-xl font-bold text-primary">OAO</span>
          <span class="text-xs text-surface-400 hidden sm:inline">Open Agent Orchestra</span>
        </NuxtLink>
      </div>
      <div class="flex items-center gap-3">
        <template v-if="isAuthenticated">
          <Button type="button" text rounded :label="user?.name || ''" icon="pi pi-user" @click="toggleUserMenu" size="small" severity="secondary" />
          <Menu ref="userMenu" :model="userMenuItems" :popup="true" />
        </template>
        <template v-else>
          <NuxtLink :to="`/${ws}/login`">
            <Button label="Login" size="small" />
          </NuxtLink>
        </template>
      </div>
    </header>

    <div class="pt-14 flex">
      <!-- Mobile overlay -->
      <div v-if="sidebarOpen && isAuthenticated" class="fixed inset-0 bg-black/30 z-30 lg:hidden" @click="sidebarOpen = false" />

      <!-- Sidebar -->
      <aside v-if="isAuthenticated"
        :class="['fixed top-14 bottom-0 z-30 w-60 bg-white bg-surface-0 border-r border-surface-200 flex flex-col transition-transform duration-200 overflow-y-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0']">
        <nav class="flex-1 py-4 px-3">
          <div class="mb-4">
            <span class="text-xs font-semibold text-surface-400 uppercase tracking-wider px-3">Main</span>
            <div class="mt-2 flex flex-col gap-0.5">
              <NuxtLink v-for="item in mainNav" :key="item.to" :to="item.to"
                :class="['flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                  isActiveRoute(item.to) ? 'bg-primary-50 text-primary-700 font-medium' : 'text-surface-600 hover:text-surface-900 hover:bg-surface-100']"
                @click="closeMobileSidebar">
                <i :class="[item.icon, 'text-base']"></i>
                <span>{{ item.label }}</span>
              </NuxtLink>
            </div>
          </div>
          <template v-if="isAdmin">
            <Divider />
            <div class="mb-4">
              <span class="text-xs font-semibold text-surface-400 uppercase tracking-wider px-3">Admin</span>
              <div class="mt-2 flex flex-col gap-0.5">
                <NuxtLink v-for="item in adminNav" :key="item.to" :to="item.to"
                  :class="['flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                    isActiveRoute(item.to) ? 'bg-primary-50 text-primary-700 font-medium' : 'text-surface-600 hover:text-surface-900 hover:bg-surface-100']"
                  @click="closeMobileSidebar">
                  <i :class="[item.icon, 'text-base']"></i>
                  <span>{{ item.label }}</span>
                </NuxtLink>
              </div>
            </div>
          </template>
          <template v-if="user?.role === 'super_admin'">
            <Divider />
            <div>
              <span class="text-xs font-semibold text-surface-400 uppercase tracking-wider px-3">System</span>
              <div class="mt-2 flex flex-col gap-0.5">
                <NuxtLink :to="`/${ws}/workspaces`"
                  :class="['flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                    isActiveRoute(`/${ws}/workspaces`) ? 'bg-primary-50 text-primary-700 font-medium' : 'text-surface-600 hover:text-surface-900 hover:bg-surface-100']"
                  @click="closeMobileSidebar">
                  <i class="pi pi-building text-base"></i>
                  <span>Workspaces</span>
                </NuxtLink>
              </div>
            </div>
          </template>
        </nav>
        <div class="border-t border-surface-200 px-4 py-3 text-xs text-surface-400">
          <div class="font-medium text-surface-500">Open Agent Orchestra</div>
          <div>v{{ appVersion }}</div>
        </div>
      </aside>

      <!-- Main content -->
      <main :class="['flex-1 min-w-0 min-h-[calc(100vh-3.5rem)] overflow-hidden transition-all duration-200', isAuthenticated ? 'lg:ml-60' : '']">
        <div class="max-w-7xl min-w-0 mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <NuxtPage />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const { user, isAuthenticated, logout } = useAuth();
const runtimeConfig = useRuntimeConfig();
const route = useRoute();
const router = useRouter();
const sidebarOpen = ref(false);
const userMenu = ref();

const ws = computed(() => user.value?.workspaceSlug || (route.params.workspace as string) || 'default');
const isAdmin = computed(() => user.value?.role === 'workspace_admin' || user.value?.role === 'super_admin');
const appVersion = computed(() => runtimeConfig.public.appVersion || '0.0.0');

const roleLabel = computed(() => {
  const map: Record<string, string> = { super_admin: 'Super Admin', workspace_admin: 'Admin', creator_user: 'Creator', view_user: 'Viewer' };
  return map[user.value?.role || ''] || 'User';
});

const mainNav = computed(() => [
  { to: `/${ws.value}`, icon: 'pi pi-home', label: 'Dashboard' },
  { to: `/${ws.value}/agents`, icon: 'pi pi-microchip-ai', label: 'Agents' },
  { to: `/${ws.value}/conversations`, icon: 'pi pi-comments', label: 'Conversations' },
  { to: `/${ws.value}/workflows`, icon: 'pi pi-sitemap', label: 'Workflows' },
  { to: `/${ws.value}/executions`, icon: 'pi pi-play-circle', label: 'Executions' },
  { to: `/${ws.value}/instances`, icon: 'pi pi-server', label: 'Instances' },
  { to: `/${ws.value}/events`, icon: 'pi pi-bell', label: 'Events' },
  { to: `/${ws.value}/variables`, icon: 'pi pi-key', label: 'Variables' },
  { to: `/${ws.value}/models`, icon: 'pi pi-box', label: 'Models' },
]);

const adminNav = computed(() => [
  { to: `/${ws.value}/admin/users`, icon: 'pi pi-users', label: 'Users' },
  { to: `/${ws.value}/admin/user-groups`, icon: 'pi pi-id-card', label: 'User Groups' },
  { to: `/${ws.value}/admin/roles`, icon: 'pi pi-key', label: 'Roles' },
  { to: `/${ws.value}/admin/auth-providers`, icon: 'pi pi-lock', label: 'Auth Providers' },
  { to: `/${ws.value}/admin/settings`, icon: 'pi pi-shield', label: 'Settings' },
  { to: `/${ws.value}/admin/rate-limits`, icon: 'pi pi-gauge', label: 'Rate Limits' },
  ...(user.value?.role === 'super_admin' ? [{ to: `/${ws.value}/admin/mail-settings`, icon: 'pi pi-envelope', label: 'Mail Settings' }] : []),
]);

const userMenuItems = computed(() => [
  { label: user.value?.name || 'User', disabled: true, class: 'font-semibold' },
  { label: `${user.value?.email} (${roleLabel.value})`, disabled: true, class: 'text-xs' },
  { separator: true },
  { label: 'Change Password', icon: 'pi pi-key', command: () => router.push(`/${ws.value}/settings/change-password`) },
  { label: 'Access Tokens', icon: 'pi pi-ticket', command: () => router.push(`/${ws.value}/settings/tokens`) },
  { separator: true },
  { label: 'Logout', icon: 'pi pi-sign-out', command: () => logout() },
]);

function toggleUserMenu(event: Event) { userMenu.value.toggle(event); }
function isActiveRoute(path: string) { return path === `/${ws.value}` ? route.path === path : route.path.startsWith(path); }
function closeMobileSidebar() { if (typeof window !== 'undefined' && window.innerWidth < 1024) sidebarOpen.value = false; }
</script>

<style>
.p-datatable,
.p-datatable-wrapper {
  max-width: 100%;
}

.p-datatable-wrapper {
  overflow-x: hidden;
}

.p-datatable table,
.p-datatable-table {
  table-layout: fixed;
  width: 100%;
}

.p-datatable .p-datatable-thead > tr > th,
.p-datatable .p-datatable-tbody > tr > td {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.p-datatable .p-datatable-tbody > tr > td > *,
.p-datatable .p-datatable-tbody > tr > td a,
.p-datatable .p-datatable-tbody > tr > td span,
.p-datatable .p-datatable-tbody > tr > td p {
  max-width: 100%;
}

.p-datatable .p-datatable-tbody > tr > td a,
.p-datatable .p-datatable-tbody > tr > td span:not(.p-tag):not(.p-button-icon),
.p-datatable .p-datatable-tbody > tr > td p {
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}

.p-datatable .p-tag {
  max-width: 100%;
  overflow: hidden;
}

.p-datatable .p-tag-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
