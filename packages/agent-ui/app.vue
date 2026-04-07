<template>
  <div class="min-h-screen bg-background text-foreground">
    <nav class="border-b border-border bg-card">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center gap-8">
            <NuxtLink to="/" class="text-xl font-bold text-primary">🤖 Agent Orchestration</NuxtLink>
            <div v-if="isAuthenticated" class="hidden md:flex items-center gap-4">
              <NuxtLink to="/agents" class="text-sm text-muted-foreground hover:text-foreground transition">Agents</NuxtLink>
              <NuxtLink to="/workflows" class="text-sm text-muted-foreground hover:text-foreground transition">Workflows</NuxtLink>
              <NuxtLink to="/executions" class="text-sm text-muted-foreground hover:text-foreground transition">Executions</NuxtLink>
              <NuxtLink to="/variables" class="text-sm text-muted-foreground hover:text-foreground transition">Variables</NuxtLink>
              <NuxtLink to="/plugins" class="text-sm text-muted-foreground hover:text-foreground transition">Plugins</NuxtLink>
              <NuxtLink to="/admin/quotas" class="text-sm text-muted-foreground hover:text-foreground transition">Quotas</NuxtLink>
              <template v-if="user?.role === 'admin'">
                <span class="text-border">|</span>
                <NuxtLink to="/admin/users" class="text-sm text-muted-foreground hover:text-foreground transition">Users</NuxtLink>
                <NuxtLink to="/admin/models" class="text-sm text-muted-foreground hover:text-foreground transition">Models</NuxtLink>
              </template>
            </div>
          </div>
          <div class="hidden md:flex items-center gap-4">
            <template v-if="isAuthenticated">
              <span class="text-sm text-muted-foreground">{{ user?.name }} <span class="text-xs">({{ user?.role === 'admin' ? 'Admin' : 'Creator' }})</span></span>
              <button @click="logout" class="text-sm text-muted-foreground hover:text-foreground transition">Logout</button>
            </template>
            <template v-else>
              <NuxtLink to="/login" class="text-sm text-muted-foreground hover:text-foreground transition">Login</NuxtLink>
            </template>
          </div>
          <button v-if="isAuthenticated" @click="mobileMenuOpen = !mobileMenuOpen" class="md:hidden p-2 rounded-md hover:bg-muted">
            <span class="text-lg">☰</span>
          </button>
        </div>
      </div>
      <div v-if="mobileMenuOpen && isAuthenticated" class="md:hidden border-t border-border bg-card px-4 py-3 space-y-2">
        <NuxtLink to="/agents" class="block text-sm py-1.5 text-muted-foreground hover:text-foreground" @click="mobileMenuOpen = false">Agents</NuxtLink>
        <NuxtLink to="/workflows" class="block text-sm py-1.5 text-muted-foreground hover:text-foreground" @click="mobileMenuOpen = false">Workflows</NuxtLink>
        <NuxtLink to="/executions" class="block text-sm py-1.5 text-muted-foreground hover:text-foreground" @click="mobileMenuOpen = false">Executions</NuxtLink>
        <NuxtLink to="/variables" class="block text-sm py-1.5 text-muted-foreground hover:text-foreground" @click="mobileMenuOpen = false">Variables</NuxtLink>
        <NuxtLink to="/plugins" class="block text-sm py-1.5 text-muted-foreground hover:text-foreground" @click="mobileMenuOpen = false">Plugins</NuxtLink>
        <NuxtLink to="/admin/quotas" class="block text-sm py-1.5 text-muted-foreground hover:text-foreground" @click="mobileMenuOpen = false">Quotas</NuxtLink>
        <template v-if="user?.role === 'admin'">
          <hr class="border-border" />
          <NuxtLink to="/admin/users" class="block text-sm py-1.5 text-muted-foreground hover:text-foreground" @click="mobileMenuOpen = false">Users</NuxtLink>
          <NuxtLink to="/admin/models" class="block text-sm py-1.5 text-muted-foreground hover:text-foreground" @click="mobileMenuOpen = false">Models</NuxtLink>
        </template>
        <hr class="border-border" />
        <span class="block text-sm text-muted-foreground py-1">{{ user?.name }} <span class="text-xs">({{ user?.role === 'admin' ? 'Admin' : 'Creator' }})</span></span>
        <button @click="logout; mobileMenuOpen = false" class="text-sm text-destructive">Logout</button>
      </div>
    </nav>
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <NuxtPage />
    </main>
  </div>
</template>

<script setup lang="ts">
const { user, isAuthenticated, logout } = useAuth();
const mobileMenuOpen = ref(false);
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
