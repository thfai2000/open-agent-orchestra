# Workspaces & RBAC

## Multi-Tenant Workspace Isolation

Every entity (agents, workflows, plugins, models, variables, quota settings, credit usage) is scoped to a **workspace**. Users belong to exactly one workspace. Data is fully isolated between workspaces via `workspaceId` foreign keys with cascade delete.

### Default Workspace

On first deployment, a "Default Workspace" (slug: `default`) is automatically created via seed. It cannot be deleted.

### Workspace Management

Only `super_admin` users can:
- Create new workspaces (POST `/api/workspaces`)
- List all workspaces with member counts
- View workspace details and members
- Move users between workspaces
- Delete non-default workspaces (must have 0 members)

## RBAC — Built-in Roles

| Role | Scope | Permissions |
|---|---|---|
| `super_admin` | Platform-wide | All workspace_admin permissions + create/delete workspaces, move users between workspaces |
| `workspace_admin` | Workspace | Manage users/roles within workspace, manage models, quota settings, workspace variables, all CRUD |
| `creator_user` | Workspace | Create/edit/delete agents, workflows, triggers, user/agent variables, run workflows |
| `view_user` | Workspace | Read-only access to agents, workflows, executions, variables (cannot create/modify) |

### Role Assignment

- New users register as `creator_user` by default
- `workspace_admin` and `super_admin` can change roles via Admin > Users page
- `super_admin` role can only be set at the database level (not via UI role selector)

## Variable Priority System

Variables are merged at execution time with the following priority (higher overrides lower for the same key):

1. **Agent variables** (highest priority) — scoped to a specific agent
2. **User variables** — scoped to the user who owns the workflow
3. **Workspace variables** (lowest priority) — shared across all users in the workspace

This applies to all three variable maps: credentials, properties, and env variables.

### Variable Types

| Type | Usage |
|---|---|
| `credential` | Injected into Copilot session as available credentials |
| `property` | Referenced in prompts via `{{ Properties.KEY_NAME }}` syntax |

### Env Variable Injection

Any variable (regardless of type) can be flagged as "Inject as Env Variable". These are written to the agent workspace's `.env` file before execution.

## URL Isolation

All UI routes are prefixed with the workspace slug:

```
/<workspace-slug>/login
/<workspace-slug>/register
/<workspace-slug>/agents
/<workspace-slug>/workflows
/<workspace-slug>/executions
/<workspace-slug>/variables
/<workspace-slug>/plugins
/<workspace-slug>/admin/users
/<workspace-slug>/admin/models
/<workspace-slug>/admin/quotas
/<workspace-slug>/workspaces    (super_admin only)
```

The root URL (`/`) redirects to `/<user's workspace slug>` if authenticated, or `/default/login` if not.
