export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role?: string;
  workspaceId?: string | null;
  workspaceSlug?: string | null;
}

/**
 * Core auth composable shared between Trading UI and Agent UI.
 * Handles token/user state management, cookies, and auth headers.
 */
export function useAuthCore() {
  const tokenCookie = useCookie('token', { maxAge: 60 * 60 * 24 * 7 });
  const userCookie = useCookie('user', { maxAge: 60 * 60 * 24 * 7 });

  const token = useState<string | null>('auth-token', () => tokenCookie.value || null);
  const user = useState<AuthUser | null>('auth-user', () => {
    if (userCookie.value) {
      try {
        return typeof userCookie.value === 'string'
          ? JSON.parse(userCookie.value)
          : userCookie.value;
      } catch {
        return null;
      }
    }
    return null;
  });
  const isAuthenticated = computed(() => !!token.value);

  function setAuth(t: string, u: AuthUser) {
    token.value = t;
    user.value = u;
    tokenCookie.value = t;
    userCookie.value = JSON.stringify(u);
  }

  function logout() {
    token.value = null;
    user.value = null;
    tokenCookie.value = null;
    userCookie.value = null;
    navigateTo('/login');
  }

  function authHeaders(): Record<string, string> {
    if (token.value) return { Authorization: `Bearer ${token.value}` };
    return {};
  }

  return { token, user, isAuthenticated, setAuth, logout, authHeaders };
}
