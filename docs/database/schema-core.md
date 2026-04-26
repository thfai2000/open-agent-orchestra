# Core Tables

Tenancy, Agent, Workflow, and Execution tables. For the ER diagram and enums, see [Schema Overview](/database/schema).

## Tenancy Tables

### workspaces

Tenant isolation boundary. All entities reference a workspace.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | varchar(200) | |
| slug | varchar(100) | Unique, URL-safe identifier |
| description | text | |
| isDefault | boolean | Default workspace cannot be deleted |
| allowRegistration | boolean | Controls self-service account registration |
| allowPasswordReset | boolean | Controls forgot-password/reset email requests |
| createdAt, updatedAt | timestamp | |

### users

Independent auth (email/password/bcrypt). Supports multiple auth providers (database, LDAP).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | Cascade delete |
| email | varchar(255) | Unique |
| name | varchar(100) | |
| passwordHash | text | bcrypt (nullable for LDAP users) |
| authProvider | auth_provider_type | `database` or `ldap` (default: `database`) |
| role | user_role | Default: `creator_user` |
| createdAt | timestamp | |

## Agent Tables

### agents

AI agent definitions.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | Cascade delete |
| userId | UUID | Owner user |
| name | varchar(100) | |
| description | text | |
| sourceType | agent_source_type | Default: `github_repo` |
| gitRepoUrl | varchar(500) | Required for `github_repo` |
| gitBranch | varchar(100) | Default: `main` |
| agentFilePath | varchar(300) | Path to .md in repo |
| skillsDirectory | varchar(500) | Skills directory path |
| skillsPaths | varchar(300)[] | Explicit skill file paths |
| githubTokenEncrypted | text | AES-256-GCM encrypted |
| githubTokenCredentialId | varchar(100) | References credential variable |
| builtinToolsEnabled | jsonb | Array of enabled built-in tool names |
| mcpJsonTemplate | text | Jinja2 template for mcp.json (rendered with variables before session) |
| scope | resource_scope | Default: `user`. Immutable |
| version | integer | Auto-incremented on every update. Default: 1 |
| status | agent_status | |
| lastSessionAt | timestamp | |
| createdAt, updatedAt | timestamp | |

### agent_files

Database-stored agent files (for `sourceType: database`).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | Cascade delete |
| filePath | varchar(500) | Relative path (e.g., `agent.md`, `skills/research.md`) |
| content | text | Markdown content |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(agentId, filePath) |

### agent_versions

Immutable snapshots of agent config at each version, for audit trail.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | Cascade delete |
| version | integer | Matches agents.version at time of change |
| snapshot | jsonb | Full agent config + files snapshot |
| changedBy | UUID | User who made the change |
| createdAt | timestamp | |
| | | UNIQUE(agentId, version) |

### mcp_server_configs

MCP server configurations per agent.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | |
| serverType | enum | `custom` or system-managed `oao_platform` |
| name | varchar(100) | Display name |
| description | varchar(500) | |
| command | varchar(200) | Process command (`node`, `npx`, `python`) |
| args | jsonb | Command arguments array |
| envMapping | jsonb | Credential key → env var mapping |
| isEnabled | boolean | |
| writeTools | jsonb | Tool names requiring permission |
| createdAt, updatedAt | timestamp | |

Every new agent gets one default `oao_platform` row. That system-managed row points at the bundled OAO Platform MCP server and carries per-session auth/env at runtime rather than storing secrets in the table.

## Workflow Tables

### workflows

Multi-step execution templates.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | Cascade delete |
| userId | UUID | Owner |
| name | varchar(200) | |
| description | text | |
| labels | varchar(50)[] | Filterable tags (GIN indexed) |
| isActive | boolean | |
| maxConcurrentExecutions | integer | Default: 1 |
| version | integer | Auto-incremented. Default: 1 |
| defaultAgentId | UUID FK → agents | Optional |
| defaultModel | varchar(100) | Optional |
| defaultReasoningEffort | reasoning_effort | Optional |
| workerRuntime | worker_runtime | `static` or `ephemeral`. Default: `static` |
| stepAllocationTimeoutSeconds | integer | Default: 300. Max wait for a step to leave `pending` while allocating a runtime |
| scope | resource_scope | Default: `user`. Immutable |
| createdAt, updatedAt | timestamp | |

### workflow_steps

Ordered steps in a workflow.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workflowId | UUID FK → workflows | Cascade delete |
| name | varchar(200) | |
| promptTemplate | text | Markdown with optional `<PRECEDENT_OUTPUT>` |
| stepOrder | integer | 1-indexed |
| agentId | UUID FK → agents | Optional |
| model | varchar(100) | Optional override |
| reasoningEffort | reasoning_effort | Optional |
| workerRuntime | worker_runtime | Optional override. Falls back to `workflows.workerRuntime` |
| timeoutSeconds | integer | Default: 300 |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(workflowId, stepOrder) |

### workflow_versions

Immutable snapshots of workflow config + steps at each version, for audit trail.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workflowId | UUID FK → workflows | Cascade delete |
| version | integer | Matches workflows.version at time of change |
| snapshot | jsonb | Full workflow config + steps snapshot |
| changedBy | UUID | User who made the change |
| createdAt | timestamp | |
| | | UNIQUE(workflowId, version) |

### triggers

Trigger configurations for workflows.

> Triggers can be edited or deleted at any time via `PUT /api/triggers/:id` and `DELETE /api/triggers/:id`. Webhook paths must remain unique across all webhook triggers.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workflowId | UUID FK → workflows | |
| triggerType | trigger_type | |
| configuration | jsonb | Type-specific config |
| isActive | boolean | |
| lastFiredAt | timestamp | |
| createdAt | timestamp | |

**Configuration JSONB examples:**
- **Cron**: `{ "cron": "0 9 * * 1-5", "timezone": "America/New_York" }`
- **Datetime**: `{ "datetime": "2025-01-15T09:00:00Z" }` (one-shot, auto-deactivates)
- **Webhook**: `{ "secret": "hmac-secret-encrypted" }`
- **Event**: `{ "eventName": "workflow.completed", "conditions": { "status": "completed" } }`

## Conversation Tables

### conversations

Persisted interactive chat threads between a user and a selected agent.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | Cascade delete |
| userId | UUID FK → users | Conversation owner |
| agentId | UUID FK → agents | Nullable if the source agent is deleted later |
| agentNameSnapshot | varchar(100) | Stored display name at conversation creation time |
| title | varchar(200) | User-supplied or auto-generated |
| status | conversation_status | `active` or `archived` |
| lastMessageAt | timestamp | Updated whenever a turn is added |
| createdAt, updatedAt | timestamp | |

### conversation_messages

Stored user and assistant turns for each conversation.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| conversationId | UUID FK → conversations | Cascade delete |
| role | conversation_message_role | `user` or `assistant` |
| status | conversation_message_status | `pending`, `completed`, `failed` |
| content | text | Assistant messages stream into this field as deltas arrive |
| model | varchar(100) | Recorded for assistant turns when available |
| error | text | Failure message for failed assistant turns |
| metadata | jsonb | Reasoning trace and tool-call summary |
| createdAt, updatedAt | timestamp | |

## Execution Tables

### workflow_executions

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workflowId | UUID FK → workflows | |
| triggerId | UUID FK → triggers | |
| triggerMetadata | jsonb | Webhook payload, cron tick, retry info |
| workflowVersion | integer | Snapshot version at trigger time |
| workflowSnapshot | jsonb | Full workflow + steps snapshot (immutable, including worker runtime overrides and allocation timeout) |
| status | execution_status | |
| currentStep | integer | 1-indexed |
| totalSteps | integer | |
| startedAt, completedAt | timestamp | |
| error | text | |
| createdAt | timestamp | |

### step_executions

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workflowExecutionId | UUID FK → workflow_executions | |
| workflowStepId | UUID FK → workflow_steps | |
| stepOrder | integer | |
| agentVersion | integer | Snapshot of agent.version when step executes |
| agentSnapshot | jsonb | Full agent config snapshot at execution time (immutable) |
| resolvedPrompt | text | Prompt with variables replaced |
| output | text | Copilot session response |
| reasoningTrace | jsonb | Tool calls, intermediate thoughts |
| liveOutput | jsonb | Array of intermediate events streamed during execution |
| status | step_status | |
| startedAt, completedAt | timestamp | |
| error | text | |
