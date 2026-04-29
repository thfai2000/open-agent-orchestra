# API Reference

All routes are served by **OAO-API** (Hono v4.6) at port `4002`. The OAO-UI proxies all `/api/*` requests to the API server.

::: tip Interactive API Explorer
The live OpenAPI spec is available at [`/api/openapi.json`](http://localhost:4002/api/openapi.json) and the Swagger UI at [`/api/docs`](http://localhost:4002/api/docs) on any running OAO-API instance. The spec documented here mirrors the OpenAPI definition — both are maintained as a single source of truth.
:::

## Authentication

All endpoints (except `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/providers`, `POST /api/auth/forgot-password`, and `POST /api/auth/reset-password`) require a Bearer token:

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

**Responses**: `201` User created + JWT · `403` Registration disabled · `404` Workspace not found · `409` Email already registered

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
| `identifier` | string | Preferred | Email for database login, or username/email for LDAP login depending on provider config |
| `email` | string (email) | Legacy alias | Backward-compatible alias for `identifier` |
| `password` | string | Yes | |
| `provider` | `"database"` \| `"ldap"` | No | Auto-detected if omitted |

For LDAP logins, `identifier` does **not** need to be an email address. It should match the configured LDAP search filter placeholder (for example `uid`, `cn`, or `sAMAccountName`).

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

### `POST /api/auth/forgot-password`

Request a password reset email for a database user. **Auth**: None

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string (email) | Yes | Account email |
| `workspace` | string | No | Workspace slug (default: `default`) |

Returns a generic success message for unknown users. Returns `403` when password reset is disabled for the workspace.

### `POST /api/auth/reset-password`

Set a new database password using a reset token. **Auth**: None

| Field | Type | Required |
|-------|------|----------|
| `token` | string | Yes |
| `password` | string (8–100) | Yes |

### `GET /api/auth/providers`

List enabled auth providers and self-service auth policy for a workspace. **Auth**: None

| Query | Type | Description |
|-------|------|-------------|
| `workspace` | string | Workspace slug |

Response includes `providers`, `allowRegistration`, and `allowPasswordReset`.

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
| `copilotTokenCredentialId` | uuid | — | GitHub Copilot token / LLM API key credential reference |
| `scope` | `"user"` \| `"workspace"` | `"user"` | `workspace` requires admin role |
| `builtinToolsEnabled` | string[] or object | all tools | Legacy built-in array, or `{ "mode": "explicit", "names": [...] }` for a full tool allowlist |
| `mcpJsonTemplate` | string | — | Jinja2 template for MCP config (max 50KB) |
| `files` | object[] | `[]` | Initial files for `database` source agents |

**Built-in Tool Names**: `schedule_next_workflow_execution`, `manage_webhook_trigger`, `record_decision`, `memory_store`, `memory_retrieve`, `edit_workflow`, `read_variables`, `edit_variables`, `simple_http_request`

### `GET /api/agents/:id`

Get agent detail. **Auth**: JWT/PAT

### `POST /api/agents/tool-catalog`

Resolve the grouped tool catalog used by the create-agent page before an agent is saved. **Auth**: JWT/PAT

This endpoint:

- Includes built-in tools.
- Auto-includes the default OAO Platform MCP server.
- Renders an optional `mcpJsonTemplate` override and inspects its `mcpServers` entries.
- Uses the current user and workspace variables when rendering the preview.

**Request Body**

| Field | Type | Description |
|-------|------|-------------|
| `mcpJsonTemplate` | string or `null` | Optional unsaved template override to inspect |

### `POST /api/agents/:id/tool-catalog`

Resolve the grouped tool catalog used by the agent editor. **Auth**: JWT/PAT · **Role**: agent owner or admin

This endpoint:

- Includes built-in tools.
- Auto-includes the default OAO Platform MCP server.
- Inspects stored MCP server configs for the agent.
- Renders an optional `mcpJsonTemplate` override and inspects its `mcpServers` entries.

**Request Body**

| Field | Type | Description |
|-------|------|-------------|
| `mcpJsonTemplate` | string or `null` | Optional unsaved template override to inspect |

**Response** `200`

```json
{
  "selectionMode": "legacy",
  "defaultSelectedToolNames": ["record_decision", "oao_list_workflows"],
  "effectiveSelectedToolNames": ["record_decision", "oao_list_workflows"],
  "unresolvedSelectedToolNames": [],
  "groups": [
    {
      "key": "builtin:core",
      "label": "Built-in Tools",
      "source": "builtin",
      "tools": [{ "name": "record_decision", "label": "Record Decision" }]
    }
  ]
}
```

### `GET /api/agents/:id/versions`

List agent version history, including the current live version and stored historical snapshots. **Auth**: JWT/PAT

### `GET /api/agents/:id/versions/:version`

Get a specific agent version snapshot, including files and agent-scoped variables for that version. **Auth**: JWT/PAT

### `PUT /api/agents/:id`

Partial update. Setting `githubTokenCredentialId` automatically clears any inline token and vice versa. `copilotTokenCredentialId` is used for GitHub-provider sessions or as the secret source for custom model providers. **Auth**: JWT/PAT · **Role**: `creator_user`+

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

## Conversations

Interactive user-to-agent chat threads. Conversations are private to the creating user within a workspace.

### `GET /api/conversations`

List the current user's conversations. **Auth**: JWT/PAT

| Query | Type | Description |
|-------|------|-------------|
| `page`, `limit` | integer | Pagination |
| `agentId` | uuid | Optional filter by selected agent |

### `POST /api/conversations`

Create a new conversation for an active agent. **Auth**: JWT/PAT

```bash
curl -X POST http://localhost:4002/api/conversations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "agent-uuid",
    "title": "Research Partner"
  }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | uuid | Yes | Active agent to chat with |
| `title` | string | No | Optional title (1–200 chars) |

### `GET /api/conversations/:id`

Get conversation metadata plus the full ordered message transcript. **Auth**: JWT/PAT

Response includes:

- `conversation` — thread header
- `messages` — ordered transcript with assistant metadata
- `agent` — currently selected agent summary including `builtinToolsEnabled`
- `settings` — last-used turn settings derived from message metadata

### `GET /api/conversations/:id/tool-catalog`

Resolve the grouped tool catalog for the current conversation agent. **Auth**: JWT/PAT

This endpoint combines the current agent defaults with the last-used per-turn tool override so the conversation UI can show both:

- `defaultSelectedToolNames` — the current agent defaults
- `effectiveSelectedToolNames` — the selection that the next turn will currently use

It includes built-in tools, the default OAO Platform MCP server, stored MCP servers, and any servers rendered from the agent's `mcpJsonTemplate`.

### `PATCH /api/conversations/:id`

Switch the active agent for future turns in the conversation. **Auth**: JWT/PAT

```bash
curl -X PATCH http://localhost:4002/api/conversations/$CONVERSATION_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "new-agent-uuid"
  }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agentId` | uuid | Yes | Replacement active agent for subsequent turns |

### `POST /api/conversations/:id/messages`

Append a user turn and wait for the assistant response. **Auth**: JWT/PAT

```bash
curl -X POST http://localhost:4002/api/conversations/$CONVERSATION_ID/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Summarize the latest deployment risks for this workspace.",
    "model": "gpt-5.4",
    "reasoningEffort": "high",
    "enabledToolNames": ["record_decision", "read_variables", "simple_http_request", "oao_list_workflows"]
  }'
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | User message (1–20,000 chars) |
| `model` | string | No | Per-turn model override |
| `reasoningEffort` | `low` \| `medium` \| `high` \| `xhigh` | No | Per-turn reasoning override |
| `enabledToolNames` | string[] | No | Per-turn full tool override across built-ins and MCP tools; empty array disables all optional tools |
| `enabledBuiltinTools` | string[] | No | Backward-compatible built-in-only override for older clients |

Responses:

- `201` User message stored and assistant reply completed
- `400` Invalid input, archived conversation, inactive/missing agent, or assistant turn failure
- `409` Agent session lock still held by another active Copilot session

### `GET /api/conversations/:id/stream`

SSE stream for live assistant updates. **Auth**: JWT/PAT (query token supported for `EventSource` clients)

Event types:

- `conversation.message.started`
- `conversation.message.delta`
- `conversation.message.reasoning`
- `conversation.message.reasoning_delta`
- `conversation.message.completed`
- `conversation.message.failed`
- `conversation.tool.execution_start`
- `conversation.tool.execution_complete`
- `conversation.tool.ask_questions`
- `conversation.tool.ask_questions_resolved`
- `conversation.turn.started`
- `conversation.turn.completed`

### `POST /api/conversations/:id/answer-questions`

Submit the user's answers in response to a `conversation.tool.ask_questions` SSE event. The pending agent tool call resolves with the supplied answers and the conversation continues.

**Auth**: JWT/PAT

Request body:

```json
{
  "askId": "<uuid from the ask_questions SSE event>",
  "answers": {
    "<questionId>": "free-text answer",
    "<questionId>": ["choice-a", "choice-b"],
    "<questionId>": { "value": "__other__", "other": "user-supplied free-text" }
  }
}
```

- For `single_choice` questions, send the chosen option string. If the user picked "Other", send `{ "value": "__other__", "other": "..." }`.
- For `multi_choice` questions, send an array of option strings. If the user picked "Other", send `{ "value": ["a", "b"], "other": "..." }` and omit `__other__` from `value`.
- For `free_text` questions, send the raw string.

Returns `404` if the `askId` is unknown (already answered or timed out), `409` on a race condition.

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
      { "triggerType": "time_schedule", "configuration": { "cron": "0 8 * * 1-5" } }
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

When an optional workflow default is unset, omit that field from the request body. Do not send `null` for values such as `defaultModel`, `defaultReasoningEffort`, or `defaultAgentId` on create requests.

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

### `GET /api/workflow-graph/:workflowId/graph`

Fetch persisted graph nodes, edges, current `workflow_steps` projection, and serialized triggers. **Auth**: JWT/PAT

### `PUT /api/workflow-graph/:workflowId/graph`

Replace graph nodes and edges atomically and synchronize saved `agent_step` blocks back to `workflow_steps`. Validates graph node types, valid edge endpoints, and non-empty prompt templates for agent-step nodes. **Auth**: JWT/PAT · **Role**: `creator_user`+

### `GET /api/workflow-graph/executions/:executionId/nodes`

List graph node execution rows for one execution. Rows include node input/output/error, status (`pending`, `running`, `awaiting_input`, `completed`, `failed`, `skipped`), the frozen node snapshot, and `stepExecutionId` for `agent_step` nodes so the UI can load live output and answer `ask_questions`. **Auth**: JWT/PAT

### `DELETE /api/workflows/:id`

Delete workflow. **Auth**: JWT/PAT · **Role**: `creator_user`+

### `POST /api/triggers/:id/run`

Manually run a workflow through a specific trigger. Eligible trigger types are
`webhook`, `time_schedule`, `exact_datetime`, `jira_polling` (all entries with
`supportsManualRun: true` in the trigger catalog). The selected trigger's
`entryNodeKey` is honoured by the graph engine, so each trigger has its own
entry point. For `webhook` triggers, `inputs` are validated against the
declared `parameters`; for the other eligible types, `inputs` are passed
through to the execution context as a free-form object. **Auth**: JWT/PAT · **Role**: `creator_user`+

```bash
curl -X POST http://localhost:4002/api/triggers/$TRIGGER_ID/run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"issue_url": "https://github.com/org/repo/issues/42"}}'
```

**Response**: `202 Accepted` — `{ "executionId": "...", "status": "pending" }`

---

## Executions

### `GET /api/executions`

List executions (paginated). **Auth**: JWT/PAT

| Query | Type | Description |
|-------|------|-------------|
| `workflowId` | uuid | Filter by workflow |
| `status` | `pending` \| `running` \| `completed` \| `failed` \| `cancelled` | Filter by status |
| `page`, `limit` | integer | Pagination |

Each execution row includes `workflowName`, resolved from the frozen execution snapshot when available and falling back to the current workflow record for older executions.

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

Graph-mode runs emit `node.started`, `node.completed`, `node.skipped`, and `node.failed` events in addition to execution-level events. Agent-step nodes also emit `agent.*` / `step.tool.ask_questions*` events with `nodeKey` and `nodeExecutionId` for graph-panel correlation.

### `POST /api/executions/:id/cancel`

Cancel a pending or running execution. **Auth**: JWT/PAT

### `POST /api/executions/:id/retry`

Retry from the last failed step — does not restart the entire workflow. **Auth**: JWT/PAT

---

## Variables

Variables use a 3-tier scoping system with priority: **Agent > User > Workspace**. All values are encrypted at rest with AES-256-GCM. Credential values are never returned in API responses.

All variable responses include the current `version`. Updates increment the variable version, and agent-scoped variable mutations also increment the owning agent version.

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

### `GET /api/variables/:id/versions`

List variable version history for a specific scope. **Auth**: JWT/PAT

| Query | Type | Description |
|-------|------|-------------|
| `scope` | `"agent"` \| `"user"` \| `"workspace"` | Required variable scope |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (default: 50, max: 100) |

### `GET /api/variables/:id/versions/:version`

Get a specific variable version snapshot for a specific scope. **Auth**: JWT/PAT

### `PUT /api/variables/:id`

Update variable. Increments variable version. **Auth**: JWT/PAT · **Role**: `creator_user`+

### `DELETE /api/variables/:id`

Delete variable. Preserves a final deleted historical snapshot. **Auth**: JWT/PAT · **Role**: `creator_user`+

---

## Triggers

### `GET /api/triggers`

List visible triggers. Pass `workflowId` to scope the response to one workflow; omit it to list triggers across workflows visible to the current user. **Auth**: JWT/PAT

Trigger responses include sanitized labels and runtime status fields such as `typeLabel`, `shortTypeLabel`, and `runtimeSummary`.

### `GET /api/triggers/types`

Return the shared trigger catalog used by the UI. **Auth**: JWT/PAT

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
    "configuration": { "cron": "0 8 * * 1-5" }
  }'

# Webhook trigger with parameters
curl -X POST http://localhost:4002/api/triggers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "wf-uuid",
    "triggerType": "webhook",
    "configuration": {
      "path": "/jira-task-created",
      "parameters": [
        { "name": "issue_key", "required": true, "description": "Jira issue key" },
        { "name": "summary", "required": false, "description": "Issue summary" }
      ]
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
      "eventScope": "workspace",
      "conditions": { "scope": "workspace" }
    }
  }'

# Jira changes notification trigger (dynamic Jira webhook)
curl -X POST http://localhost:4002/api/triggers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "wf-uuid",
    "triggerType": "jira_changes_notification",
    "configuration": {
      "jiraSiteUrl": "https://example.atlassian.net",
      "authMode": "oauth2",
      "credentials": {
        "accessTokenVariableKey": "JIRA_ACCESS_TOKEN",
        "refreshTokenVariableKey": "JIRA_REFRESH_TOKEN",
        "clientIdVariableKey": "JIRA_CLIENT_ID",
        "clientSecretVariableKey": "JIRA_CLIENT_SECRET"
      },
      "jql": "project = OAO AND statusCategory != Done",
      "events": ["jira:issue_created", "jira:issue_updated"],
      "fieldIdsFilter": ["summary", "status"]
    }
  }'

# Jira polling trigger
curl -X POST http://localhost:4002/api/triggers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "wf-uuid",
    "triggerType": "jira_polling",
    "configuration": {
      "jiraSiteUrl": "https://example.atlassian.net",
      "authMode": "api_token",
      "credentials": {
        "email": "jira-bot@example.com",
        "apiTokenVariableKey": "JIRA_API_TOKEN"
      },
      "jql": "project = OAO ORDER BY updated DESC",
      "intervalMinutes": 15,
      "maxResults": 50,
      "fields": ["summary", "status", "assignee", "updated"],
      "initialLoadMode": "from_now",
      "overlapMinutes": 5
    }
  }'
```

**Trigger Types**

| Type | Configuration | Description |
|------|---------------|-------------|
| `time_schedule` | `{ cron: "0 8 * * *" }` | Cron-based schedule |
| `exact_datetime` | `{ datetime: "2026-06-01T10:00:00Z" }` | One-time execution |
| `webhook` | `{ path: "/...", parameters: [{ name, required, description }] }` | Parameterized webhook/manual-run input definition |
| `event` | `{ eventName: "...", eventScope: "workspace", conditions: {...} }` | System event with data matching |
| `jira_changes_notification` | `{ jiraSiteUrl, authMode: "oauth2", credentials, jql, events, fieldIdsFilter }` | Jira dynamic webhook registration filtered by JQL |
| `jira_polling` | `{ jiraSiteUrl, authMode, credentials, jql, intervalMinutes, maxResults, fields, initialLoadMode, overlapMinutes }` | Jira search polling with overlap-window dedupe |

### `PUT /api/triggers/:id`

Update trigger. **Auth**: JWT/PAT · **Role**: `creator_user`+

Optional fields (all may be sent independently):

- `triggerType`, `configuration`, `isActive` — same shape as `POST`.
- `entryNodeKey` (string | null) — graph node where this trigger begins execution. `null` (or omitted) falls back to the first root block by canvas position and node key. Multiple triggers on the same workflow can target different entry nodes.
- `positionX`, `positionY` (integer) — visual editor coordinates of the trigger block on the canvas.

The `POST /api/triggers` body accepts the same `entryNodeKey`, `positionX`, and `positionY` fields, so triggers can be created in-place when dragged onto the visual editor canvas.

### `POST /api/triggers/:id/test`

Run a saved trigger connectivity test. **Auth**: JWT/PAT

- Jira Changes Notification: attempts a temporary Jira webhook registration, removes it, and probes the hosted callback URL.
- Jira Polling: executes the configured Jira search with saved credentials.
- Schedule, webhook, exact datetime, and system event triggers: validates that the saved configuration is structurally valid.

### `DELETE /api/triggers/:id`

Delete trigger. **Auth**: JWT/PAT · **Role**: `creator_user`+

---

## Webhooks

### `POST /api/webhooks/:registrationId`

Receive an external webhook event and trigger the associated workflow.

Workflow webhook triggers automatically provision and maintain the backing webhook registration used by this endpoint.

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

### `POST /api/jira-webhooks/:triggerId?token=...`

Receive a Jira dynamic webhook callback for a `jira_changes_notification` trigger. This endpoint is intended for Jira to call after OAO registers a dynamic webhook.

- Requires the OAO-generated `token` query parameter
- Dedupes repeated `X-Atlassian-Webhook-Identifier` deliveries
- Emits a `webhook.received` system event with `triggerType: "jira_changes_notification"` and `source: "jira"`

**Response**: `202 Accepted` on first delivery, `200` with `{"status":"already_processed"}` for duplicate deliveries

### `GET /api/jira-webhooks/:triggerId?token=...`

Probe the hosted Jira callback URL without firing the workflow. This is used by trigger connectivity checks to confirm that the public callback endpoint is reachable with the generated token.

**Response**: `200 OK` with `{"status":"reachable"}` when the callback URL and token are valid

---

## MCP Servers

Manage Model Context Protocol server configurations per agent.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/mcp-servers?agentId=...` | List MCP configs for agent, including the default OAO Platform record |
| `POST` | `/api/mcp-servers` | Create MCP server config |
| `PUT` | `/api/mcp-servers/:id` | Update config (`oao_platform` can only be enabled/disabled) |
| `DELETE` | `/api/mcp-servers/:id` | Delete config (`oao_platform` cannot be deleted) |

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
| `envMapping` | object | `{}` | `{ "CREDENTIAL_KEY": "ENV_VAR" }` — maps credential keys to child-process env vars |
| `writeTools` | string[] | `[]` | Tools that require human approval |
| `isEnabled` | boolean | `true` | Enable/disable |

The default system-managed OAO Platform row uses `serverType: "oao_platform"` internally, is created automatically for every new agent, and is also synthesized at runtime for older agents that do not yet have the row persisted.

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

### Models (User-Scoped, v1.37.0)

As of v1.37.0 the model registry is **user-scoped**, not workspace-scoped. Each user owns their own list of models. Authentication via the standard `Authorization: Bearer <jwt>` header is sufficient — no admin role is required.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | List **active** models for the current user |
| `GET` | `/api/models/:id` | Get a single model owned by the current user |
| `POST` | `/api/models` | Create a custom model |
| `PUT` | `/api/models/:id` | Update a model (catalog rows lock most fields) |
| `DELETE` | `/api/models/:id` | Delete a model |
| `POST` | `/api/models/sync-catalog` | Pull GitHub Models `/catalog/models` into the user's registry. Body: `{ url?, githubTokenCredentialId? }` |

The `githubTokenCredentialId` parameter is the UUID of a user-scope credential variable (sub-type `github_token`). When omitted the server falls back to the `DEFAULT_LLM_API_KEY` / `GITHUB_TOKEN` env vars.

Catalog rows expose additional metadata (filled by sync, never overwritten by users):
`rateLimitTier` (low/high — closest signal to "premium"), `tags[]`, `capabilities[]`, `htmlUrl`, `modelVersion`. The GitHub Models catalog endpoint does **not** return any explicit premium/credit/billing field.

```bash
curl -X POST http://localhost:4002/api/models \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gpt-4o-byok",
    "provider": "openai",
    "providerType": "custom",
    "customProviderType": "openai",
    "customBaseUrl": "https://api.openai.com/v1",
    "customAuthType": "api_key",
    "customWireApi": "responses",
    "creditCost": "2.00",
    "isActive": true
  }'
```

Custom provider fields:

| Field | Type | Description |
|---|---|---|
| `providerType` | `github` \| `custom` | Selects GitHub-managed vs BYOK session routing |
| `customProviderType` | `openai` \| `azure` \| `anthropic` | Required when `providerType=custom` |
| `customBaseUrl` | string (URL) | Required when `providerType=custom` |
| `customAuthType` | `none` \| `api_key` \| `bearer_token` | How OAO injects the selected secret |
| `customWireApi` | `completions` \| `responses` | Optional OpenAI/Azure wire API override |
| `customAzureApiVersion` | string | Required for Azure custom providers |

### Security

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/security` | Get workspace security settings (legacy — use `/api/admin/settings`) |
| `PUT` | `/api/admin/security` | Update `allowRegistration` and `allowPasswordReset` (legacy — use `/api/admin/settings`) |
| `GET` | `/api/admin/settings` | Get workspace settings: `allowRegistration`, `allowPasswordReset`, `ephemeralKeepAliveMs`, `staticCleanupIntervalMs`, `disallowCredentialAccessViaTools` |
| `PUT` | `/api/admin/settings` | Update workspace settings (validates lifecycle bounds: ephemeral 60s–7d, static 60s–30d) |

### Mail Settings

Requires `super_admin` role.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/mail-settings` | Get global SMTP settings status/configuration |
| `PUT` | `/api/admin/mail-settings` | Save global SMTP settings used for password reset emails |

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
| `POST` | `/api/workspaces` | Create workspace (`name`, `slug`, `description`, optional security flags) |
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
| `GET` | `/api/quota/usage` | Credit usage stats for `user`, `workspace`, or `platform` scope, depending on role |
| `GET` | `/api/quota/models` | Active models for dropdowns (compatibility alias) |

## Models

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | Active models from the workspace model registry for authenticated selection UIs |

`GET /api/quota/usage` supports `?days=30` and `?scope=user|workspace|platform`.

- `scope=user` is available to any authenticated user.
- `scope=workspace` requires `workspace_admin` or `super_admin`.
- `scope=platform` requires `super_admin`.

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
