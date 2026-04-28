/**
 * RBAC v2.0.0 — Functionality Catalog
 *
 * Functionalities are platform-defined permission flags. Administrators
 * cannot mint new keys at runtime; they assemble these into roles which
 * are bound to user-groups. Each flag uses the `<resource>:<action>`
 * convention. The wildcard `*` is reserved for super-admin.
 */

export interface FunctionalityDef {
  key: string;
  resource: string;
  action: string;
  label: string;
  description: string;
  category: string;
}

const SUPER = '*';

export const FUNCTIONALITY_CATALOG: FunctionalityDef[] = [
  // ─── Super flag ─────────────────────────────────────────────────
  { key: SUPER, resource: '*', action: '*', label: 'Super Admin (all permissions)', description: 'Grants every functionality, including future ones.', category: 'super' },

  // ─── Agents ─────────────────────────────────────────────────────
  { key: 'agents:read', resource: 'agents', action: 'read', label: 'View agents', description: 'See the agent list and individual agent details.', category: 'agents' },
  { key: 'agents:create', resource: 'agents', action: 'create', label: 'Create agents', description: 'Create new agents (user-scoped or workspace-scoped).', category: 'agents' },
  { key: 'agents:update', resource: 'agents', action: 'update', label: 'Update agents', description: 'Edit agent definitions, settings, and skills.', category: 'agents' },
  { key: 'agents:delete', resource: 'agents', action: 'delete', label: 'Delete agents', description: 'Remove agents and all their data.', category: 'agents' },
  { key: 'agents:share-workspace', resource: 'agents', action: 'share-workspace', label: 'Share agents workspace-wide', description: 'Create or modify workspace-scoped agents (visible to all workspace users).', category: 'agents' },

  // ─── Workflows ──────────────────────────────────────────────────
  { key: 'workflows:read', resource: 'workflows', action: 'read', label: 'View workflows', description: 'See workflows and their step definitions.', category: 'workflows' },
  { key: 'workflows:create', resource: 'workflows', action: 'create', label: 'Create workflows', description: 'Define new workflows.', category: 'workflows' },
  { key: 'workflows:update', resource: 'workflows', action: 'update', label: 'Update workflows', description: 'Edit workflow steps, agents, triggers.', category: 'workflows' },
  { key: 'workflows:delete', resource: 'workflows', action: 'delete', label: 'Delete workflows', description: 'Remove workflows and their execution history.', category: 'workflows' },
  { key: 'workflows:run', resource: 'workflows', action: 'run', label: 'Manually run workflows', description: 'Trigger workflow executions on demand.', category: 'workflows' },
  { key: 'workflows:share-workspace', resource: 'workflows', action: 'share-workspace', label: 'Share workflows workspace-wide', description: 'Create or modify workspace-scoped workflows.', category: 'workflows' },

  // ─── Executions ─────────────────────────────────────────────────
  { key: 'executions:read', resource: 'executions', action: 'read', label: 'View executions', description: 'See execution history and step outputs.', category: 'executions' },
  { key: 'executions:cancel', resource: 'executions', action: 'cancel', label: 'Cancel executions', description: 'Stop running executions.', category: 'executions' },

  // ─── Conversations ──────────────────────────────────────────────
  { key: 'conversations:read', resource: 'conversations', action: 'read', label: 'View conversations', description: 'See conversation threads (own + shared).', category: 'conversations' },
  { key: 'conversations:create', resource: 'conversations', action: 'create', label: 'Start conversations', description: 'Open new conversations with agents.', category: 'conversations' },
  { key: 'conversations:delete', resource: 'conversations', action: 'delete', label: 'Delete conversations', description: 'Remove conversation history.', category: 'conversations' },

  // ─── Triggers ───────────────────────────────────────────────────
  { key: 'triggers:read', resource: 'triggers', action: 'read', label: 'View triggers', description: 'See triggers attached to workflows.', category: 'triggers' },
  { key: 'triggers:manage', resource: 'triggers', action: 'manage', label: 'Manage triggers', description: 'Create, update, or delete workflow triggers.', category: 'triggers' },

  // ─── Variables ──────────────────────────────────────────────────
  { key: 'variables:read', resource: 'variables', action: 'read', label: 'View variables', description: 'See variable names and metadata (values masked for credentials).', category: 'variables' },
  { key: 'variables:manage:user', resource: 'variables', action: 'manage:user', label: 'Manage own variables', description: 'Create / update / delete user-scoped variables.', category: 'variables' },
  { key: 'variables:manage:workspace', resource: 'variables', action: 'manage:workspace', label: 'Manage workspace variables', description: 'Create / update / delete workspace-scoped variables.', category: 'variables' },

  // ─── Models ─────────────────────────────────────────────────────
  { key: 'models:read', resource: 'models', action: 'read', label: 'View models', description: 'See registered LLM models and their settings.', category: 'models' },
  { key: 'models:manage', resource: 'models', action: 'manage', label: 'Manage models', description: 'Add / configure / sync the model registry.', category: 'models' },

  // ─── Agent Instances ────────────────────────────────────────────
  { key: 'instances:read', resource: 'instances', action: 'read', label: 'View agent instances', description: 'See active static and ephemeral agent instances.', category: 'instances' },
  { key: 'instances:manage', resource: 'instances', action: 'manage', label: 'Manage agent instances', description: 'Terminate or reconfigure running agent instances.', category: 'instances' },

  // ─── Endpoints (PATs / API tokens) ──────────────────────────────
  { key: 'endpoints:read', resource: 'endpoints', action: 'read', label: 'View own API tokens', description: 'List Personal Access Tokens issued to the current user.', category: 'endpoints' },
  { key: 'endpoints:manage', resource: 'endpoints', action: 'manage', label: 'Manage own API tokens', description: 'Issue / revoke Personal Access Tokens for the current user.', category: 'endpoints' },

  // ─── System Events ──────────────────────────────────────────────
  { key: 'events:read', resource: 'events', action: 'read', label: 'View system events', description: 'See workspace-scoped audit trail of system events.', category: 'observability' },

  // ─── Admin: Users & Workspaces ──────────────────────────────────
  { key: 'admin:users:read', resource: 'admin', action: 'users:read', label: 'View workspace users', description: 'See user list, roles, and group memberships.', category: 'admin' },
  { key: 'admin:users:manage', resource: 'admin', action: 'users:manage', label: 'Manage workspace users', description: 'Invite, edit, deactivate users; assign group memberships.', category: 'admin' },
  { key: 'admin:workspaces:manage', resource: 'admin', action: 'workspaces:manage', label: 'Manage workspaces', description: 'Create / rename / delete workspaces (super-admin scope).', category: 'admin' },

  // ─── Admin: RBAC ────────────────────────────────────────────────
  { key: 'admin:rbac:read', resource: 'admin', action: 'rbac:read', label: 'View RBAC config', description: 'See roles, functionality bindings, and group → role assignments.', category: 'admin' },
  { key: 'admin:rbac:manage', resource: 'admin', action: 'rbac:manage', label: 'Manage RBAC config', description: 'Create / edit / delete roles, bind functionalities, assign roles to user-groups.', category: 'admin' },

  // ─── Admin: Auth Providers ──────────────────────────────────────
  { key: 'admin:auth-providers:read', resource: 'admin', action: 'auth-providers:read', label: 'View auth providers', description: 'See configured auth providers (LDAP, database).', category: 'admin' },
  { key: 'admin:auth-providers:manage', resource: 'admin', action: 'auth-providers:manage', label: 'Manage auth providers', description: 'Configure LDAP servers, password reset settings, etc.', category: 'admin' },
];

/**
 * Default functionality bindings for the four system roles.
 * Customizable post-deployment via the admin UI.
 */
export const SYSTEM_ROLES: Array<{
  name: 'super_admin' | 'workspace_admin' | 'creator' | 'viewer';
  description: string;
  functionalities: string[];
}> = [
  {
    name: 'super_admin',
    description: 'Full access to every functionality across every workspace.',
    functionalities: [SUPER],
  },
  {
    name: 'workspace_admin',
    description: 'Manage everything inside a single workspace, including users, RBAC, and auth providers.',
    functionalities: [
      'agents:read', 'agents:create', 'agents:update', 'agents:delete', 'agents:share-workspace',
      'workflows:read', 'workflows:create', 'workflows:update', 'workflows:delete', 'workflows:run', 'workflows:share-workspace',
      'executions:read', 'executions:cancel',
      'conversations:read', 'conversations:create', 'conversations:delete',
      'triggers:read', 'triggers:manage',
      'variables:read', 'variables:manage:user', 'variables:manage:workspace',
      'models:read', 'models:manage',
      'instances:read', 'instances:manage',
      'endpoints:read', 'endpoints:manage',
      'events:read',
      'admin:users:read', 'admin:users:manage',
      'admin:rbac:read', 'admin:rbac:manage',
      'admin:auth-providers:read', 'admin:auth-providers:manage',
    ],
  },
  {
    name: 'creator',
    description: 'Build agents, workflows, and run conversations. Cannot manage users or RBAC.',
    functionalities: [
      'agents:read', 'agents:create', 'agents:update', 'agents:delete',
      'workflows:read', 'workflows:create', 'workflows:update', 'workflows:delete', 'workflows:run',
      'executions:read', 'executions:cancel',
      'conversations:read', 'conversations:create', 'conversations:delete',
      'triggers:read', 'triggers:manage',
      'variables:read', 'variables:manage:user',
      'models:read',
      'instances:read',
      'endpoints:read', 'endpoints:manage',
      'events:read',
    ],
  },
  {
    name: 'viewer',
    description: 'Read-only access to agents, workflows, executions, and conversations.',
    functionalities: [
      'agents:read',
      'workflows:read',
      'executions:read',
      'conversations:read', 'conversations:create',
      'triggers:read',
      'variables:read',
      'models:read',
      'instances:read',
      'endpoints:read',
      'events:read',
    ],
  },
];

export const SYSTEM_ROLE_NAMES = SYSTEM_ROLES.map((r) => r.name) as ReadonlyArray<string>;

const LEGACY_ROLE_TO_SYSTEM_ROLE = {
  super_admin: 'super_admin',
  workspace_admin: 'workspace_admin',
  creator_user: 'creator',
  view_user: 'viewer',
} as const;

const SYSTEM_ROLE_MAP = new Map(SYSTEM_ROLES.map((role) => [role.name, role] as const));

export function mapLegacyRoleToSystemRoleName(role: string | null | undefined) {
  if (!role) return null;
  return LEGACY_ROLE_TO_SYSTEM_ROLE[role as keyof typeof LEGACY_ROLE_TO_SYSTEM_ROLE] ?? null;
}

export function getSystemRoleDefaultFunctionalities(role: string | null | undefined): ReadonlyArray<string> {
  const systemRoleName = mapLegacyRoleToSystemRoleName(role);
  if (!systemRoleName) return [];
  return SYSTEM_ROLE_MAP.get(systemRoleName)?.functionalities ?? [];
}
