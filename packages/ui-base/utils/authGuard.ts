/**
 * Create an auth middleware that redirects unauthenticated users to login
 * and validates workspace access for authenticated users.
 * Pass the list of public page suffixes (e.g., ['/login', '/register']).
 * With workspace URL pattern /<workspace>/..., checks path suffix.
 */
export function createAuthGuard(publicSuffixes: string[]) {
  return (to: { path: string }) => {
    const path = to.path.replace(/\/+$/, '') || '/';

    // Root index is a redirect page — always public
    if (path === '' || path === '/') return;

    // Extract workspace slug from the path (first segment)
    const segments = path.split('/').filter(Boolean);
    const urlWorkspace = segments[0] || 'default';

    // Check if the path ends with a public suffix (e.g., /default/login, /myworkspace/register)
    for (const suffix of publicSuffixes) {
      if (path.endsWith(suffix)) {
        // If user is already authenticated on a public page, redirect to their workspace
        const token = import.meta.server
          ? useCookie('token')
          : useState<string | null>('auth-token');
        if (token.value) {
          const userState = import.meta.server
            ? useCookie('user')
            : useState<Record<string, unknown> | null>('auth-user');
          const userData = parseUserData(userState.value);
          if (userData?.workspaceSlug) {
            return navigateTo(`/${userData.workspaceSlug}`);
          }
        }
        return;
      }
    }

    const token = import.meta.server
      ? useCookie('token')
      : useState<string | null>('auth-token');

    if (!token.value) {
      return navigateTo(`/${urlWorkspace}/login`);
    }

    // Validate workspace access — user should only access their own workspace
    const userState = import.meta.server
      ? useCookie('user')
      : useState<Record<string, unknown> | null>('auth-user');
    const userData = parseUserData(userState.value);

    if (userData?.workspaceSlug) {
      // super_admin can access all workspaces
      if (userData.role === 'super_admin') return;

      // Redirect to correct workspace if URL workspace doesn't match
      if (urlWorkspace !== userData.workspaceSlug) {
        const restOfPath = segments.slice(1).join('/');
        const target = restOfPath
          ? `/${userData.workspaceSlug}/${restOfPath}`
          : `/${userData.workspaceSlug}`;
        return navigateTo(target);
      }
    }
  };
}

function parseUserData(raw: unknown): { workspaceSlug?: string; role?: string } | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw as { workspaceSlug?: string; role?: string };
}
