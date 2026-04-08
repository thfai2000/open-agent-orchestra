# API Routes

All routes under `/api/` are served by the Agent API (Hono, port 4002).

## Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | No | Register new user (optional `workspaceSlug`, defaults to `default`) |
| POST | `/api/auth/login` | No | Login, returns JWT with workspace context |
| GET | `/api/auth/me` | JWT | Current user info + workspace |

## Agents

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/agents` | JWT | Any | List agents in workspace |
| POST | `/api/agents` | JWT | creator_user+ | Create agent |
| GET | `/api/agents/:id` | JWT | Any | Agent detail (workspace-scoped) |
| PUT | `/api/agents/:id` | JWT | creator_user+ | Update agent |
| DELETE | `/api/agents/:id` | JWT | creator_user+ | Delete agent |

## Workflows

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/workflows` | JWT | Any | List workflows in workspace |
| POST | `/api/workflows` | JWT | creator_user+ | Create workflow with steps + triggers |
| GET | `/api/workflows/:id` | JWT | Any | Workflow detail with steps |
| PUT | `/api/workflows/:id` | JWT | creator_user+ | Update workflow |
| DELETE | `/api/workflows/:id` | JWT | creator_user+ | Delete workflow |

## Executions

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/executions` | JWT | List executions (paginated) |
| GET | `/api/executions/:id` | JWT | Execution detail with steps |
| POST | `/api/executions/:id/cancel` | JWT | Cancel running execution |
| POST | `/api/executions/:id/retry` | JWT | Retry from failed step |

## Variables

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/variables?scope=user` | JWT | List user variables |
| GET | `/api/variables?scope=workspace` | JWT | List workspace variables |
| GET | `/api/variables?agentId=...` | JWT | List agent variables |
| POST | `/api/variables` | JWT | Create variable (body.scope: agent/user/workspace) |
| PUT | `/api/variables/:id` | JWT | Update variable (body.scope) |
| DELETE | `/api/variables/:id?scope=...` | JWT | Delete variable |

## Triggers

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/triggers?workflowId=...` | JWT | List triggers |
| POST | `/api/triggers` | JWT | Create trigger |
| PUT | `/api/triggers/:id` | JWT | Update trigger |
| DELETE | `/api/triggers/:id` | JWT | Delete trigger |

## Agent Files (database source agents)

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/agent-files/:agentId` | JWT | Any | List files for agent |
| POST | `/api/agent-files/:agentId` | JWT | creator_user+ | Create file (database source only) |
| PUT | `/api/agent-files/:agentId/:fileId` | JWT | creator_user+ | Update file content |
| DELETE | `/api/agent-files/:agentId/:fileId` | JWT | creator_user+ | Delete file |

## Plugins

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/plugins` | JWT | Any | List plugins in workspace |
| POST | `/api/plugins` | JWT | admin+ | Install plugin from Git |
| GET | `/api/plugins/:id` | JWT | Any | Plugin detail |
| PUT | `/api/plugins/:id` | JWT | admin+ | Update plugin |
| DELETE | `/api/plugins/:id` | JWT | admin+ | Delete plugin |
| POST | `/api/plugins/:id/sync` | JWT | admin+ | Re-sync from Git |
| GET | `/api/plugins/agent/:agentId` | JWT | Any | Plugins enabled for agent |
| PUT | `/api/plugins/agent/:agentId` | JWT | creator_user+ | Toggle plugin for agent |

## Admin (workspace_admin / super_admin)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/admin/users` | JWT admin | List workspace users |
| PUT | `/api/admin/users/:id/role` | JWT admin | Change user role |
| GET/POST/PUT/DELETE | `/api/admin/models[/:id]` | JWT admin | Model CRUD (workspace-scoped) |
| GET/PUT | `/api/admin/quota-settings` | JWT admin | Workspace quota settings |
| GET | `/api/admin/credit-stats` | JWT admin | Workspace credit usage breakdown |

## Quota

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/quota/settings` | JWT | User quota (workspace defaults + user overrides) |
| GET | `/api/quota/usage` | JWT | User credit usage with daily/model/month breakdown |

## Workspaces (super_admin only)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/workspaces` | JWT super_admin | List all workspaces |
| POST | `/api/workspaces` | JWT super_admin | Create workspace |
| GET | `/api/workspaces/:id` | JWT super_admin | Workspace detail + members |
| PUT | `/api/workspaces/:id` | JWT super_admin | Update workspace |
| DELETE | `/api/workspaces/:id` | JWT super_admin | Delete (non-default, 0 members) |
| PUT | `/api/workspaces/:id/members/:userId` | JWT super_admin | Move user + set role |

## Webhooks

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/webhooks/:path` | HMAC | Receive webhook events |

## MCP Servers

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/mcp-servers?agentId=...` | JWT | List MCP configs |
| POST | `/api/mcp-servers` | JWT | Add MCP server config |
| PUT | `/api/mcp-servers/:id` | JWT | Update config |
| DELETE | `/api/mcp-servers/:id` | JWT | Delete config |
