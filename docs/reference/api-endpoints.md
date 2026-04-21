# API Reference

All routes are served by **OAO-API** (Hono v4.6) at port `4002`. The OAO-UI proxies all `/api/*` requests to the API server.

::: tip Interactive API Explorer
The live OpenAPI spec is available at [`/api/openapi.json`](http://localhost:4002/api/openapi.json) and the Swagger UI at [`/api/docs`](http://localhost:4002/api/docs) on any running OAO-API instance. The spec documented here mirrors the OpenAPI definition — both are maintained as a single source of truth.
:::

## Authentication

All endpoints (except `POST /api/auth/login`, `POST /api/auth/register`, and `GET /api/auth/providers`) require a Bearer token:

```http
Authorization: Bearer <token>
```

**Two token types** are supported:

| Type | Format | Expiry | Use Case |
|------|--------|--------|----------|
| JWT | Base64 string | 7 days | Browser sessions (from `/api/auth/login`) |
| PAT | `oao_` prefix | Configurable (1–365 days or none) | CI/CD, scripts, webhook auth |

### Quick Start — Obtain a JWT

```bash
# Login
curl -X POST http://localhost:4002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@oao.local", "password": "your-password"}'

# Use the returned token
curl http://localhost:4002/api/agents \
  -H "Authorization: Bearer <token>"
```

## Pagination

All list endpoints accept query parameters:

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | integer | 1 | — | Page number (1-indexed) |
| `limit` | integer | 50 | 200 | Items per page |

Response shape:

```json
{
  "<items>": [...],
  "total": 142,
  "page": 1,
  "limit": 50
}
```

## Error Handling

All errors return JSON with an `error` field:

```json
{ "error": "Agent not found" }
```

Zod validation errors (HTTP 400) include additional detail:

```json
{
  "error": "Validation failed",
  "issues": [
    { "path": ["name"], "message": "String must contain at least 1 character(s)" }
  ]
}
```

## Rate Limiting

| Scope | Limit |
|-------|-------|
| General API | 100 requests/minute |
| Auth endpoints (`/api/auth/*`) | 10 requests/minute |
| Credit usage | Configurable per workspace/user (daily/weekly/monthly) |

---

## Auth

### `POST /api/auth/register`

Register a new user account.

**Auth**: None

```bash
curl -X POST http://localhost:4002/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "securePass123",
    "name": "Jane Smith",
    "workspaceSlug": "default"
  }'
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string (email) | Yes | Max 255 chars |
| `password` | string | Yes | 8–100 chars |
| `name` | string | Yes | 1–100 chars |
| `workspaceSlug` | string | No | Target workspace (default: `"default"`) |

**Responses**: `201` User created + JWT · `404` Workspace not found · `409` Email already registered

---

### `POST /api/auth/login`

Authenticate and receive a JWT token.

**Auth**: None

```bash
curl -X POST http://localhost:4002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@oao.local", "password": "your-password"}'
```

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string (email) | Yes | |
| `password` | string | Yes | |
| `provider` | `"database"` \| `"ldap"` | No | Auto-detected if omitted |

**Response** `200`

```json
{
  "user": { "userId": "uuid", "email": "...", "name": "...", "role": "creator_user", "workspaceId": "uuid" },
  "token": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**Responses**: `200` Success · `400` Invalid provider · `401` Invalid credentials

---

### `GET /api/auth/me`

Get current user info. **Auth**: JWT/PAT

### `PUT /api/auth/change-password`

Change password (database users only; LDAP users receive HTTP 400). **Auth**: JWT

| Field | Type | Required |
|-------|------|----------|
| `currentPassword` | string | Yes |
| `newPassword` | string (8–100) | Yes |

### `GET /api/auth/providers`

List enabled auth providers for a workspace. **Auth**: None

| Query | Type | Description |
|-------|------|-------------|
| `workspace` | string | Workspace slug |

---

## Auth Providers (Admin)

Manage LDAP and database authentication providers. Requires `workspace_admin` or `super_admin` role.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth-providers` | List auth providers |
| `POST` | `/api/auth-providers` | Create auth provider |
| `GET` | `/api/auth-providers/:id` | Get detail (sensitive fields redacted) |
| `PUT` | `/api/auth-providers/:id` | Update (config is **merged**, not replaced) |
| `DELETE` | `/api/auth-providers/:id` | Delete provider |
| `POST` | `/api/auth-providers/test-connection` | Dry-run LDAP bind + search |

**Create Auth Provider**

```bash
curl -X POST http://localhost:4002/api/auth-providers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ldap",
    "name": "Corporate AD",
    "config": {
      "url": "ldaps://ad.corp.example.com:636",
      "bindDN": "cn=oao-svc,ou=Services,dc=corp,dc=example,dc=com",
      "bindCredentials": "service-password",
      "searchBase": "ou=Users,dc=corp,dc=example,dc=com",
      "searchFilter": "(mail={{username}})",
      "usernameAttribute": "mail",
      "nameAttribute": "cn"
    }
  }'
```

---

## Agents

### `GET /api/agents`

List agents visible to the current user (own user-scoped + all workspace-scoped). **Auth**: JWT/PAT

| Query | Type | Description |
|-------|------|-------------|
| `page` | integer | Page number |
| `limit` | integer | Items per page (max 100) |

### `POST /api/agents`

Create an AI agent. **Auth**: JWT/PAT · **Role**: `creator_user`+

```bash
# GitHub-hosted agent
curl -X POST http://localhost:4002/api/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Market Analyst",
    "sourceType": "github_repo",
    "gitRepoUrl": "https://github.com/org/agents",
    "agentFilePath": "agents/market-analyst.md",
    "skillsPaths": ["skills/finance.md", "skills/reporting.md"],
    "scope": "workspace",
    "builtinToolsEnabled": [
      "simple_http_request", "record_decision", "memory_store", "memory_retrieve"
    ]
  }'
```

```bash
# Database-source agent (markdown stored in DB)
curl -X POST http://localhost:4002/api/agents \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Quick Helper",
    "sourceType": "database",
    "files": [
      { "filePath": "agent.md", "content": "# Quick Helper\nYou are a helpful assistant." }
    ]
  }'
```

**Request Body**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | 1–100 chars (required) |
| `description` | string | — | Up to 1000 chars |
| `sourceType` | `"github_repo"` \| `"database"` | `"github_repo"` | Agent source |
| `gitRepoUrl` | string (URL) | — | Required for `github_repo` |
| `gitBranch` | string | `"main"` | Git branch to clone |
| `agentFilePath` | string | — | Path to agent markdown in repo |
| `skillsPaths` | string[] | `[]` | Explicit skill file paths (max 20) |
| `skillsDirectory` | string | — | Auto-discover `.md` files in directory |
| `githubToken` | string | — | Inline Git token (prefer `githubTokenCredentialId`) |
| `githubTokenCredentialId` | uuid | — | Reference to credential variable |
| `copilotTokenCredentialId` | uuid | — | Copilot auth credential reference |
| `scope` | `"user"` \| `"workspace"` | `"user"` | `workspace` requires admin role |
| `builtinToolsEnabled` | string[] | all tools | Subset of built-in tools to enable |
| `mcpJsonTemplate` | string | — | Jinja2 template for MCP config (max 50KB) |
| `files` | object[] | `[]` | Initial files for `database` source agents |

**Built-in Tool Names**: `schedule_next_workflow_execution`, `manage_webhook_trigger`, `record_decision`, `memory_store`, `memory_retrieve`, `edit_workflow`, `read_variables`, `edit_variables`, `simple_http_request`

### `GET /api/agents/:id`

Get agent detail. **Auth**: JWT/PAT

### `GET /api/agents/:id/versions`

List agent version history, including the current live version and stored historical snapshots. **Auth**: JWT/PAT

### `GET /api/agents/:id/versions/:version`

Get a specific agent version snapshot, including files and agent-scoped variables for that version. **Auth**: JWT/PAT

### `PUT /api/agents/:id`

Partial update. Setting `githubTokenCredentialId` automatically clears any inline token and vice versa. **Auth**: JWT/PAT · **Role**: `creator_user`+

### `DELETE /api/agents/:id`

Delete agent. **Auth**: JWT/PAT · **Role**: `creator_user`+

---

## Agent Files

For agents with `sourceType: "database"` — manage instruction and skill markdown files.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agent-files/:agentId` | List files |
| `POST` | `/api/agent-files/:agentId` | Create file (`filePath` + `content`) |
| `PUT` | `/api/agent-files/:agentId/:fileId` | Update file |
| `DELETE` | `/api/agent-files/:agentId/:fileId` | Delete file |

```bash
curl -X POST http://localhost:4002/api/agent-files/$AGENT_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filePath": "skills/reporting.md", "content": "# Reporting Skill\n..."}'
```

---

## Workflows

### `GET /api/workflows`

List workflows. Filter by labels (AND logic). **Auth**: JWT/PAT

| Query | Type | Description |
|-------|------|-------------|
| `labels` | string | Comma-separated (e.g. `"finance,daily"`) — matches all |
| `page`, `limit` | integer | Pagination |

### `POST /api/workflows`

Create a workflow with steps and optional triggers in a single atomic transaction. **Auth**: JWT/PAT · **Role**: `creator_user`+

```bash
curl -X POST http://localhost:4002/api/workflows \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Daily Market Report",
    "description": "Analyze markets and generate reports",
    "labels": ["finance", "daily"],
    "defaultAgentId": "agent-uuid",
    "defaultModel": "gpt-4o",
    "workerRuntime": "static",
    "steps": [
      {
        "name": "Gather Data",
        "promptTemplate": "Analyze the latest market data for {{ properties.SECTOR }}. Focus on key trends.",
        "stepOrder": 1,
        "model": "gpt-4o-mini",
        "timeoutSeconds": 120
      },
      {
        "name": "Generate Report",
        "promptTemplate": "Based on this analysis:\n\n{{ precedent_output }}\n\nWrite a detailed report.",
        "stepOrder": 2,
        "model": "gpt-4o",
        "reasoningEffort": "high",
        "timeoutSeconds": 300
      }
    ],
    "triggers": [
      { "triggerType": "time_schedule", "configuration": { "cronExpression": "0 8 * * 1-5" } }
    ]
  }'
```

**Workflow Fields**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | 1–200 chars (required) |
| `description` | string | — | Up to 1000 chars |
| `labels` | string[] | `[]` | Up to 10 labels, 50 chars each |
| `defaultAgentId` | uuid | — | Default agent for all steps |
| `defaultModel` | string | — | Default model for all steps |
| `defaultReasoningEffort` | `"high"` \| `"medium"` \| `"low"` | — | Default reasoning level |
| `workerRuntime` | `"static"` \| `"ephemeral"` | `"static"` | Execution isolation level |
| `stepAllocationTimeoutSeconds` | integer | 300 | Wait for worker readiness (15–3600) |
| `scope` | `"user"` \| `"workspace"` | `"user"` | Visibility scope |
| `steps` | StepSchema[] | — | 1–20 ordered steps (required) |
| `triggers` | TriggerSchema[] | — | Optional triggers |

**Step Schema**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | 1–200 chars (required) |
| `promptTemplate` | string | — | Jinja2 template (required) |
| `stepOrder` | integer | — | Execution order (required) |
| `agentId` | uuid | — | Override default agent |
| `model` | string | — | Override default model |
| `reasoningEffort` | `"high"` \| `"medium"` \| `"low"` | — | Override reasoning level |
| `workerRuntime` | `"static"` \| `"ephemeral"` | — | Override runtime |
| `timeoutSeconds` | integer | 300 | Step timeout (30–3600s) |

### `GET /api/workflows/labels`

List all distinct labels. **Auth**: JWT/PAT

### `GET /api/workflows/:id`

Get workflow with steps, triggers, owner, last execution. **Auth**: JWT/PAT

### `GET /api/workflows/:id/versions`

List workflow version history, including the current live version and stored historical snapshots. **Auth**: JWT/PAT

### `GET /api/workflows/:id/versions/:version`

Get a specific workflow version snapshot, including the workflow config, steps, and triggers captured for that version. **Auth**: JWT/PAT

### `PUT /api/workflows/:id`

Partial update. Automatically increments `version`. **Auth**: JWT/PAT · **Role**: `creator_user`+

### `PUT /api/workflows/:id/steps`

Atomically replace all workflow steps. **Auth**: JWT/PAT · **Role**: `creator_user`+

### `DELETE /api/workflows/:id`

Delete workflow. **Auth**: JWT/PAT · **Role**: `creator_user`+

### `POST /api/workflows/:id/run`

Manually trigger workflow execution. If the workflow has a webhook trigger with defined parameters, `inputs` are validated. **Auth**: JWT/PAT · **Role**: `creator_user`+

```bash
curl -X POST http://localhost:4002/api/workflows/$WF_ID/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"issue_url": "https://github.com/org/repo/issues/42"}}'
```

**Response**: `202 Accepted`

---

## Executions

### `GET /api/executions`

List executions (paginated). **Auth**: JWT/PAT

| Query | Type | Description |
|-------|------|-------------|
| `workflowId` | uuid | Filter by workflow |
| `status` | `pending` \| `running` \| `completed` \| `failed` \| `cancelled` | Filter by status |
| `page`, `limit` | integer | Pagination |

### `GET /api/executions/active`

Check for pending/running executions for a workflow. Useful to prevent double-submit. **Auth**: JWT/PAT

| Query | Type | Required |
|-------|------|----------|
| `workflowId` | uuid | Yes |

### `GET /api/executions/:id`

Execution detail with step results, workflow snapshot, and trigger info. **Auth**: JWT/PAT

**Response** `200`

```json
{
  "execution": {
    "id": "uuid", "status": "completed", "currentStep": 2,
    "workflowSnapshot": { "...frozen workflow config..." },
    "createdAt": "...", "startedAt": "...", "completedAt": "..."
  },
  "steps": [
    {
      "id": "uuid", "status": "completed",
      "output": "Generated report content...",
      "reasoningTrace": { "toolCalls": [...], "reasoning": "..." }
    }
  ],
  "workflow": { "id": "uuid", "name": "Daily Market Report" },
  "trigger": { "triggerType": "time_schedule" }
}
```

### `GET /api/executions/:id/steps/:stepId/live`

Get intermediate output for a running step. **Auth**: JWT/PAT

### `GET /api/executions/stream/all`

SSE stream for all workspace executions. **Auth**: JWT/PAT

```bash
curl -N http://localhost:4002/api/executions/stream/all \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: text/event-stream"
```

### `GET /api/executions/:id/stream`

SSE stream for a single execution. **Auth**: JWT/PAT

### `POST /api/executions/:id/cancel`

Cancel a pending or running execution. **Auth**: JWT/PAT

### `POST /api/executions/:id/retry`

Retry from the last failed step — does not restart the entire workflow. **Auth**: JWT/PAT

---

## Variables

Variables use a 3-tier scoping system with priority: **Agent > User > Workspace**. All values are encrypted at rest with AES-256-GCM. Credential values are never returned in API responses.

### `GET /api/variables`

**Auth**: JWT/PAT

| Query | Type | Description |
|-------|------|-------------|
| `scope` | `"agent"` \| `"user"` \| `"workspace"` | Variable scope |
| `agentId` | uuid | Required when scope is `"agent"` |

### `POST /api/variables`

**Auth**: JWT/PAT · **Role**: `creator_user`+

```bash
# Create an agent-scoped credential
curl -X POST http://localhost:4002/api/variables \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "agent",
    "agentId": "agent-uuid",
    "key": "GITHUB_TOKEN",
    "value": "ghp_xxxxxxxxxxxx",
    "variableType": "credential",
    "credentialSubType": "github_token",
    "description": "GitHub API access for market data"
  }'
```

```bash
# Create a workspace-scoped property
curl -X POST http://localhost:4002/api/variables \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "workspace",
    "key": "REPORT_SECTOR",
    "value": "technology",
    "variableType": "property",
    "description": "Default market sector for reports"
  }'
```

**Request Body**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `key` | string | — | `UPPER_SNAKE_CASE` (1–100 chars, required) |
| `value` | string | — | Plaintext value, encrypted at rest (required) |
| `scope` | `"agent"` \| `"user"` \| `"workspace"` | `"agent"` | Variable scope |
| `agentId` | uuid | — | Required when scope is `"agent"` |
| `variableType` | `"property"` \| `"credential"` | `"credential"` | Type determines access pattern |
| `credentialSubType` | string | `"secret_text"` | `secret_text`, `github_token`, `github_app`, `user_account`, `private_key`, `certificate` |
| `injectAsEnvVariable` | boolean | `false` | Write to `.env` file for agent process |
| `description` | string | — | Up to 300 chars |

### `GET /api/variables/:id`

Get variable detail (value redacted for credentials). **Auth**: JWT/PAT

### `PUT /api/variables/:id`

Update variable. **Auth**: JWT/PAT · **Role**: `creator_user`+

### `DELETE /api/variables/:id`

Delete variable. **Auth**: JWT/PAT · **Role**: `creator_user`+

---

## Triggers

### `GET /api/triggers`

**Auth**: JWT/PAT · **Required query**: `workflowId`

### `POST /api/triggers`

**Auth**: JWT/PAT · **Role**: `creator_user`+

```bash
# Cron trigger (weekdays at 8 AM)
curl -X POST http://localhost:4002/api/triggers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "wf-uuid",
    "triggerType": "time_schedule",
    "configuration": { "cronExpression": "0 8 * * 1-5" }
  }'

# Webhook trigger with parameters
curl -X POST http://localhost:4002/api/triggers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "wf-uuid",
    "triggerType": "webhook",
    "configuration": {
      "webhookPath": "jira-task-created",
      "parameters": ["issue_key", "assignee", "summary"]
    }
  }'

# Event trigger (fires when agent.created event occurs)
curl -X POST http://localhost:4002/api/triggers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "wf-uuid",
    "triggerType": "event",
    "configuration": {
      "eventName": "agent.created",
      "conditions": { "scope": "workspace" }
    }
  }'
```

**Trigger Types**

| Type | Configuration | Description |
|------|---------------|-------------|
| `time_schedule` | `{ cronExpression: "0 8 * * *" }` | Cron-based schedule |
| `exact_datetime` | `{ datetime: "2026-06-01T10:00:00Z" }` | One-time execution |
| `webhook` | `{ webhookPath: "...", parameters: [...] }` | HTTP webhook (HMAC or PAT auth) |
| `event` | `{ eventName: "...", conditions: {...} }` | System event with data matching |

### `PUT /api/triggers/:id`

Update trigger. **Auth**: JWT/PAT · **Role**: `creator_user`+

### `DELETE /api/triggers/:id`

Delete trigger. **Auth**: JWT/PAT · **Role**: `creator_user`+

---

## Webhooks

### `POST /api/webhooks/:registrationId`

Receive an external webhook event and trigger the associated workflow.

**Authentication** (one of):
- **HMAC-SHA256**: `X-Signature` header with `sha256=HMAC(secret, timestamp.body)` + `X-Timestamp`
- **PAT**: Bearer token with `webhook:trigger` scope

**Security features**: 5-minute replay protection, event ID deduplication, parameter validation.

```bash
# HMAC-signed webhook
TIMESTAMP=$(date +%s)
BODY='{"issue_key": "PROJ-123", "assignee": "jane", "summary": "Fix login bug"}'
SIGNATURE="sha256=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')"

curl -X POST http://localhost:4002/api/webhooks/$REGISTRATION_ID \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIGNATURE" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Webhook-Event-Id: evt-$(uuidgen)" \
  -d "$BODY"
```

```bash
# PAT-authenticated webhook
curl -X POST http://localhost:4002/api/webhooks/$REGISTRATION_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer oao_xxxxx" \
  -d '{"issue_key": "PROJ-123", "assignee": "jane", "summary": "Fix login bug"}'
```

**Response**: `202 Accepted`

---

## MCP Servers

Manage Model Context Protocol server configurations per agent.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mcp-servers?agentId=...` | List MCP configs for agent |
| `POST` | `/api/mcp-servers` | Create MCP server config |
| `PUT` | `/api/mcp-servers/:id` | Update config |
| `DELETE` | `/api/mcp-servers/:id` | Delete config |

```bash
curl -X POST http://localhost:4002/api/mcp-servers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-uuid",
    "name": "GitHub MCP",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "envMapping": { "GITHUB_TOKEN": "GITHUB_TOKEN" },
    "writeTools": ["create_issue", "create_pull_request"]
  }'
```

**Request Body**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agentId` | uuid | — | Target agent (required) |
| `name` | string | — | Display name (required) |
| `command` | string | — | MCP server command (required) |
| `args` | string[] | `[]` | Command arguments |
| `envMapping` | object | `{}` | `{ ENV_VAR: "CREDENTIAL_KEY" }` — maps env vars to credential variables |
| `writeTools` | string[] | `[]` | Tools that require human approval |
| `isEnabled` | boolean | `true` | Enable/disable |

---

## Personal Access Tokens

### `GET /api/tokens/scopes`

List available PAT scopes. **Auth**: JWT

**Available Scopes**

| Scope | Description |
|-------|-------------|
| `webhook:trigger` | Trigger webhook endpoints |
| `api:read` | Read access to API resources |
| `api:write` | Write access to API resources |
| `api:agents` | Manage agents |
| `api:workflows` | Manage workflows |
| `api:executions` | Manage executions |
| `api:variables` | Manage variables |
| `api:triggers` | Manage triggers |
| `api:admin` | Admin operations |

### `POST /api/tokens`

Create a PAT. **The raw token is returned only once.** **Auth**: JWT

```bash
curl -X POST http://localhost:4002/api/tokens \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI/CD Pipeline",
    "scopes": ["api:read", "api:workflows", "api:executions"],
    "expiresInDays": 90
  }'
```

**Response** `201`

```json
{
  "token": "oao_abc123def456...",
  "pat": { "id": "uuid", "name": "CI/CD Pipeline", "tokenPrefix": "oao_abc1", "scopes": [...] }
}
```

::: warning
Store the `token` value securely — it cannot be retrieved again.
:::

### `GET /api/tokens`

List user's PATs (token values are not included). **Auth**: JWT

### `DELETE /api/tokens/:id`

Revoke a PAT. **Auth**: JWT

---

## Admin

Requires `workspace_admin` or `super_admin` role.

### Users

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | List workspace users (paginated) |
| `POST` | `/api/admin/users` | Create user (`email`, `password`, `name`, `role`) |
| `GET` | `/api/admin/users/:id` | Get user detail |
| `PUT` | `/api/admin/users/:id/role` | Change role (`workspace_admin`, `creator_user`, `view_user`) |

### Models

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/models` | List workspace models |
| `POST` | `/api/admin/models` | Create model (`name`, `provider`, `creditCost`, `isActive`) |
| `PUT` | `/api/admin/models/:id` | Update model |
| `DELETE` | `/api/admin/models/:id` | Delete model |

```bash
curl -X POST http://localhost:4002/api/admin/models \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "gpt-4o", "provider": "github", "creditCost": "2.00"}'
```

### Quotas

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/quota` | Get workspace quota settings |
| `PUT` | `/api/admin/quota` | Update workspace credit limits |
| `GET` | `/api/admin/usage/summary` | Credit usage by day, model, user |

---

## Workspaces

Requires `super_admin` role.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces` | List all workspaces (with member counts) |
| `POST` | `/api/workspaces` | Create workspace (`name`, `slug`, `description`) |
| `GET` | `/api/workspaces/:id` | Get workspace + members |
| `PUT` | `/api/workspaces/:id` | Update workspace |
| `DELETE` | `/api/workspaces/:id` | Delete (non-default, 0 members only) |
| `PUT` | `/api/workspaces/:id/members/:userId` | Move user to workspace + set role |

```bash
curl -X POST http://localhost:4002/api/workspaces \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Finance Team", "slug": "finance", "description": "Finance department workspace"}'
```

---

## Quota (User)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/quota/settings` | Get rate limit settings (user + workspace defaults) |
| `PUT` | `/api/quota/settings` | Update own credit limits |
| `GET` | `/api/quota/usage` | Credit usage stats (daily/weekly/monthly + model breakdown) |
| `GET` | `/api/quota/models` | Active models for dropdowns |

---

## System Events

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/events` | List events (paginated, filterable) |
| `GET` | `/api/events/names` | List predefined event names |

**Query Filters**

| Param | Type | Description |
|-------|------|-------------|
| `eventName` | string | Filter by event name |
| `eventScope` | `"workspace"` \| `"user"` | Filter by scope |
| `from` | date | Start date (inclusive) |
| `to` | date | End date (inclusive) |

---

## Supervisor

Requires `workspace_admin` or `super_admin` role.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/supervisor/emergency-stop` | Pause all active agents |
| `POST` | `/api/supervisor/resume-all` | Resume all paused agents |
| `GET` | `/api/supervisor/status` | Agent status counts + details |

```bash
# Emergency stop
curl -X POST http://localhost:4002/api/supervisor/emergency-stop \
  -H "Authorization: Bearer $TOKEN"

# Resume
curl -X POST http://localhost:4002/api/supervisor/resume-all \
  -H "Authorization: Bearer $TOKEN"
```

---

## Agent Instances

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agent-instances` | List instances (filter by `type`, `status`) |
| `GET` | `/api/agent-instances/:id` | Get instance detail |
| `DELETE` | `/api/agent-instances/:id` | Remove instance record |
| `POST` | `/api/agent-instances/cleanup` | Remove stale terminated/offline instances |

---

## System

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check (returns `{ status, service, version }`) |
| `GET` | `/metrics` | None | Prometheus metrics (text format) |
| `GET` | `/api/openapi.json` | None | OpenAPI 3.0.3 specification |
| `GET` | `/api/docs` | None | Interactive Swagger UI |
