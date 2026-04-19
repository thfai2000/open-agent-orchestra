# API Endpoints

All routes are served by OAO-API (Hono v4.6) at port 4002. OAO-UI proxies all `/api/*` requests to the API.

**Authentication**: JWT tokens signed with HS256, 7-day expiry, or Personal Access Tokens (PAT). Include in headers: `Authorization: Bearer <token>`

PATs use `oao_` prefix (e.g., `Authorization: Bearer oao_abc123...`). PATs have fine-grained scopes controlling access.

## Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Register new user (optional `workspaceSlug`, defaults to `default`) |
| POST | `/api/auth/login` | No | Login with `email`, `password`, optional `provider` (`database`/`ldap`). Returns JWT |
| GET | `/api/auth/me` | JWT | Current user info + workspace |
| PUT | `/api/auth/change-password` | JWT | Change password (database users only, LDAP users get 400) |
| GET | `/api/auth/providers` | No | List enabled auth providers for a workspace (query: `?workspace=slug`) |

## Auth Providers (Admin)

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/auth-providers` | admin | List auth providers for current workspace |
| POST | `/api/auth-providers` | admin | Create auth provider (type, name, config) |
| GET | `/api/auth-providers/:id` | admin | Get single auth provider (sensitive fields redacted) |
| PUT | `/api/auth-providers/:id` | admin | Update auth provider (config is merged, not replaced) |
| DELETE | `/api/auth-providers/:id` | admin | Delete auth provider |
| POST | `/api/auth-providers/test-connection` | admin | Test LDAP connection (dry-run bind + search) |

## Agents

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/agents` | Any | List agents in workspace |
| POST | `/api/agents` | creator+ | Create agent |
| GET | `/api/agents/:id` | Any | Agent detail (workspace-scoped) |
| PUT | `/api/agents/:id` | creator+ | Update agent |
| DELETE | `/api/agents/:id` | creator+ | Delete agent |

## Workflows

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/workflows` | Any | List workflows in workspace. Query: `?labels=a,b` filters by labels (AND logic) |
| GET | `/api/workflows/labels` | Any | List all distinct labels in workspace |
| POST | `/api/workflows` | creator+ | Create workflow with steps + triggers |
| GET | `/api/workflows/:id` | Any | Workflow detail with steps |
| PUT | `/api/workflows/:id` | creator+ | Update workflow (name, description, labels, defaults) |
| DELETE | `/api/workflows/:id` | creator+ | Delete workflow |
| POST | `/api/workflows/:id/run` | creator+ | Manual run — validates inputs against webhook trigger parameters, enqueues execution directly |

## Executions

| Method | Path | Description |
|---|---|---|
| GET | `/api/executions` | List executions (paginated) |
| GET | `/api/executions/active` | Check for active executions for a workflow |
| GET | `/api/executions/:id` | Execution detail with step results |
| GET | `/api/executions/:id/steps/:stepId/live` | Live intermediate output for a running step |
| POST | `/api/executions/:id/cancel` | Cancel running execution |
| POST | `/api/executions/:id/retry` | Retry from failed step |

## Variables

| Method | Path | Description |
|---|---|---|
| GET | `/api/variables?scope=user` | List user variables |
| GET | `/api/variables?scope=workspace` | List workspace variables |
| GET | `/api/variables?agentId=...` | List agent variables |
| POST | `/api/variables` | Create variable (body.scope: agent/user/workspace) |
| PUT | `/api/variables/:id` | Update variable |
| DELETE | `/api/variables/:id?scope=...` | Delete variable |

## Triggers

| Method | Path | Description |
|---|---|---|
| GET | `/api/triggers?workflowId=...` | List triggers for workflow |
| POST | `/api/triggers` | Create trigger |
| PUT | `/api/triggers/:id` | Update trigger |
| DELETE | `/api/triggers/:id` | Delete trigger |

## Agent Files

For agents with `sourceType: database`:

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/agent-files/:agentId` | Any | List files for agent |
| POST | `/api/agent-files/:agentId` | creator+ | Create file |
| PUT | `/api/agent-files/:agentId/:fileId` | creator+ | Update file content |
| DELETE | `/api/agent-files/:agentId/:fileId` | creator+ | Delete file |

## System Events

| Method | Path | Description |
|---|---|---|
| GET | `/api/events` | List system events (paginated) |
| GET | `/api/events/names` | Available event names |

## Admin

Requires `workspace_admin` or `super_admin` role.

| Method | Path | Description |
|---|---|---|
| GET | `/api/admin/users` | List workspace users |
| PUT | `/api/admin/users/:id/role` | Change user role |
| GET/POST/PUT/DELETE | `/api/admin/models[/:id]` | Model CRUD (workspace-scoped) |
| GET/PUT | `/api/admin/quota` | Workspace rate limit settings |
| GET | `/api/admin/usage/summary` | Workspace credit usage breakdown |

## Rate Limits

| Method | Path | Description |
|---|---|---|
| GET | `/api/quota/models` | Active models (for dropdowns) |
| GET/PUT | `/api/quota/settings` | User rate limit settings |
| GET | `/api/quota/usage` | Credit usage stats (daily/weekly/monthly + model breakdown) |

## Workspaces

Requires `super_admin` role.

| Method | Path | Description |
|---|---|---|
| GET | `/api/workspaces` | List all workspaces |
| POST | `/api/workspaces` | Create workspace |
| GET | `/api/workspaces/:id` | Workspace detail + members |
| PUT | `/api/workspaces/:id` | Update workspace |
| DELETE | `/api/workspaces/:id` | Delete (non-default, 0 members only) |
| PUT | `/api/workspaces/:id/members/:userId` | Move user + set role |

## Personal Access Tokens

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/tokens/scopes` | JWT | List available PAT scopes |
| POST | `/api/tokens` | JWT | Create PAT (returns raw token once) |
| GET | `/api/tokens` | JWT | List user's PATs |
| DELETE | `/api/tokens/:id` | JWT | Revoke PAT |

## Webhooks

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/webhooks/:path` | HMAC-SHA256 or PAT (`webhook:trigger`) | Receive webhook events. Validates parameters defined on the trigger. |

## Supervisor

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/supervisor/emergency-stop` | admin | Pause all active agents |
| POST | `/api/supervisor/resume-all` | admin | Resume all paused agents |
| GET | `/api/supervisor/status` | admin | System-wide supervisor status |
