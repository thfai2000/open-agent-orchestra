# RBAC

Open Agent Orchestra (OAO) uses role-based access control (RBAC) to manage permissions within each workspace.

## Built-in Roles

```mermaid
graph TB
    SA[super_admin<br/>Platform-wide access] --> WA[workspace_admin<br/>Manage own workspace]
    WA --> CU[creator_user<br/>Create & manage own resources]
    CU --> VU[view_user<br/>Read-only access]

    style SA fill:#E91E63,color:#fff
    style WA fill:#FF9800,color:#fff
    style CU fill:#2196F3,color:#fff
    style VU fill:#9E9E9E,color:#fff
```

### Role Scope

| Role | Scope | Description |
|---|---|---|
| `super_admin` | **Platform-wide** | Full access across all workspaces. Can create/delete workspaces and move users between them. |
| `workspace_admin` | **Own workspace only** | Full control over resources, users, and settings within their assigned workspace. Cannot access other workspaces. |
| `creator_user` | **Own workspace only** | Create and manage own agents and workflows. Read access to workspace-scoped resources. |
| `view_user` | **Own workspace only** | Read-only access to agents, workflows, and executions in the workspace. |

> **Important:** `workspace_admin` can only manage agents, workflows, users, models, and settings **within the workspace they belong to**. They cannot see or manage other workspaces — that requires `super_admin`.

## Permission Matrix

| Permission | `super_admin` | `workspace_admin` | `creator_user` | `view_user` |
|---|:---:|:---:|:---:|:---:|
| **Agents** — Create/edit/delete | ✅ All workspaces | ✅ Own workspace | ✅ Own only | ❌ |
| **Agents** — View | ✅ | ✅ Own workspace | ✅ | ✅ |
| **Workflows** — Create/edit/delete | ✅ All workspaces | ✅ Own workspace | ✅ Own only | ❌ |
| **Workflows** — View & run | ✅ | ✅ Own workspace | ✅ | ✅ |
| **Variables** — User scope | ✅ | ✅ Own workspace | ✅ Own only | Read own |
| **Variables** — Workspace scope | ✅ | ✅ Own workspace | Read only | Read only |
| **Variables** — Agent scope | ✅ | ✅ Own workspace | Own agents | Read only |
| **Admin** — Users & roles | ✅ All workspaces | ✅ Own workspace | ❌ | ❌ |
| **Admin** — Models | ✅ All workspaces | ✅ Own workspace | ❌ | ❌ |
| **Admin** — Quota settings | ✅ All workspaces | ✅ Own workspace | ❌ | ❌ |
| **Admin** — Plugins | ✅ All workspaces | ✅ Own workspace | ❌ | ❌ |
| **Admin** — Security | ✅ All workspaces | ✅ Own workspace | ❌ | ❌ |
| **Workspaces** — CRUD | ✅ | ❌ | ❌ | ❌ |
| **Workspaces** — Move users | ✅ | ❌ | ❌ | ❌ |

## Role Assignment

- New users register as `creator_user` by default
- `workspace_admin` and `super_admin` can change roles via **Admin → Users** (within their workspace)
- `super_admin` role can only be set at the database level (not via UI role selector)

## Workspace-Scoped Resources

When admins create agents or workflows with `scope: workspace`, they become visible to all members of **that workspace**:
- Only `workspace_admin` or `super_admin` can create/edit/delete workspace-scoped resources
- `creator_user` and `view_user` can view and use workspace-scoped agents in their workflows
- A `workspace_admin` has no access to resources in other workspaces
