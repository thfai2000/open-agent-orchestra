# Database Schema

PostgreSQL 16 with pgvector extension. Managed via Drizzle ORM.

## Entity Relationship

```
workspaces ──< users
workspaces ──< agents ──< agent_variables
workspaces ──< workflows ──< workflow_steps ──> agents
                         ──< workflow_executions ──< step_executions
workspaces ──< plugins ──< agent_plugins ──> agents
workspaces ──< models
workspaces ──< workspace_variables
workspaces ──< workspace_quota_settings
users ──< user_variables
users ──< user_quota_settings
users ──< credit_usage ──> models (by name)
agents ──< mcp_server_configs
agents ──< webhook_registrations
agents ──< agent_quota_usage
agents ──< agent_decisions
agents ──< agent_memories
triggers ──< workflow_executions
system_events (audit log)
```

## Enums

| Enum | Values |
|---|---|
| `user_role` | `super_admin`, `workspace_admin`, `creator_user`, `view_user` |
| `agent_status` | `active`, `paused`, `error` |
| `execution_status` | `pending`, `running`, `completed`, `failed`, `cancelled` |
| `step_status` | `pending`, `running`, `completed`, `failed`, `skipped` |
| `trigger_type` | `time_schedule`, `webhook`, `event`, `manual` |
| `variable_type` | `property`, `credential` |
| `reasoning_effort` | `low`, `medium`, `high` |

## Tables

### workspaces
Tenant isolation boundary. All entities reference a workspace.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | varchar(200) | |
| slug | varchar(100) | Unique, URL-safe identifier |
| description | text | |
| isDefault | boolean | Default workspace cannot be deleted |
| createdAt, updatedAt | timestamp | |

### users
Independent auth (email/password/bcrypt).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | Cascade delete |
| email | varchar(255) | Unique |
| name | varchar(100) | |
| passwordHash | text | bcrypt |
| role | user_role | Default: `creator_user` |
| createdAt | timestamp | |

### agents
Git-hosted AI agent definitions.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | Cascade delete |
| userId | UUID | Owner user |
| name | varchar(100) | |
| description | text | |
| gitRepoUrl | varchar(500) | GitHub repo URL |
| gitBranch | varchar(100) | Default: main |
| agentFilePath | varchar(300) | Path to .md in repo |
| skillsPaths | varchar(300)[] | Paths to skill .md files |
| githubTokenEncrypted | text | AES-256-GCM encrypted |
| builtinToolsEnabled | jsonb | Array of enabled built-in tool names. Default: all 8 tools |
| scope | enum('user','workspace') | Resource scope. Default: 'user'. Immutable |
| status | agent_status | |
| lastSessionAt | timestamp | |
| createdAt, updatedAt | timestamp | |

### workflows
Multi-step execution templates. Belong to a user, not an agent.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | Cascade delete |
| userId | UUID | Owner |
| name | varchar(200) | |
| description | text | |
| isActive | boolean | Whether triggers should fire |
| maxConcurrentExecutions | integer | Default: 1 |
| version | integer | Auto-incremented on edit. Default: 1 |
| defaultAgentId | UUID FK → agents | Optional: workflow-level default agent |
| defaultModel | varchar(100) | Optional: workflow-level default model |
| defaultReasoningEffort | reasoning_effort | Optional: workflow-level default |
| scope | enum('user','workspace') | Resource scope. Default: 'user'. Immutable |
| createdAt, updatedAt | timestamp | |

### workflow_steps
Ordered steps in a workflow. Each step can specify its own agent, or inherit from workflow defaults.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workflowId | UUID FK → workflows | Cascade delete |
| name | varchar(200) | |
| promptTemplate | text | Markdown with optional `<PRECEDENT_OUTPUT>` |
| stepOrder | integer | 1-indexed |
| agentId | UUID FK → agents | Optional: falls back to workflow default |
| model | varchar(100) | Optional: overrides workflow default |
| reasoningEffort | reasoning_effort | Optional: overrides workflow default |
| timeoutSeconds | integer | Default: 300 |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(workflowId, stepOrder) |

### triggers
Trigger configurations for workflows.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workflowId | UUID FK → workflows | |
| triggerType | trigger_type | 'manual' in enum but unused — all support manual |
| configuration | jsonb | Type-specific config (see below) |
| isActive | boolean | |
| lastFiredAt | timestamp | |
| createdAt | timestamp | |

Configuration JSONB examples:
- Time Schedule: `{ "cron": "0 9 * * 1-5", "timezone": "America/New_York" }` or `{ "interval_minutes": 60 }`
- Webhook: `{ "secret": "hmac-secret-encrypted", "allowed_ips": ["0.0.0.0/0"] }`
- Event: `{ "event_type": "workflow.completed", "source_workflow_id": "uuid" }`

### workflow_executions
Records of workflow runs.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workflowId | UUID FK → workflows | |
| triggerId | UUID FK → triggers | What triggered this run |
| triggerMetadata | jsonb | Webhook payload, cron tick, retry info |
| workflowVersion | integer | Snapshot of workflow.version at trigger time |
| workflowSnapshot | jsonb | Full snapshot of workflow + steps (immutable) |
| status | execution_status | |
| currentStep | integer | Which step is executing (1-indexed) |
| totalSteps | integer | Total steps in workflow |
| startedAt, completedAt | timestamp | |
| error | text | If failed |
| createdAt | timestamp | |

### step_executions
Records of individual step runs within a workflow execution.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workflowExecutionId | UUID FK → workflow_executions | |
| workflowStepId | UUID FK → workflow_steps | |
| stepOrder | integer | Execution order |
| resolvedPrompt | text | Prompt with `<PRECEDENT_OUTPUT>` replaced |
| output | text | Copilot session response |
| reasoningTrace | jsonb | Tool calls, intermediate thoughts |
| status | step_status | |
| startedAt, completedAt | timestamp | |
| error | text | If failed |

### agent_variables
Agent-level encrypted key-value store. Overrides user and workspace variables with the same key.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | |
| key | varchar(100) | UPPER_SNAKE_CASE |
| valueEncrypted | text | AES-256-GCM encrypted |
| description | varchar(300) | |
| variableType | variable_type | Default: 'credential' |
| injectAsEnvVariable | boolean | Write to .env during execution |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(agentId, key) |

### user_variables
User-level encrypted key-value store. Available to all workflow steps. Agent variables with same key take priority.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| userId | UUID | Owner |
| key | varchar(100) | UPPER_SNAKE_CASE |
| valueEncrypted | text | AES-256-GCM encrypted |
| description | varchar(300) | |
| variableType | variable_type | Default: 'credential' |
| injectAsEnvVariable | boolean | Write to .env during execution |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(userId, key) |

### workspace_variables
Workspace-level encrypted key-value store. Lowest priority — overridden by user and agent variables.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | |
| key | varchar(100) | UPPER_SNAKE_CASE |
| valueEncrypted | text | AES-256-GCM encrypted |
| description | varchar(300) | |
| variableType | variable_type | Default: 'credential' |
| injectAsEnvVariable | boolean | Write to .env during execution |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(workspaceId, key) |

### agent_quota_usage
Per-agent token usage tracking.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | |
| date | date | Usage date |
| promptTokensUsed | integer | |
| completionTokensUsed | integer | |
| sessionCount | integer | Number of Copilot sessions |
| createdAt | timestamp | |
| | | UNIQUE(agentId, date) |

### webhook_registrations
Webhook endpoint metadata for agents.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | |
| triggerId | UUID FK → triggers | Which trigger this serves |
| endpointPath | varchar(200) | URL path suffix |
| hmacSecretEncrypted | text | AES-256-GCM encrypted |
| isActive | boolean | |
| requestCount | integer | Total received |
| lastReceivedAt | timestamp | |
| createdAt | timestamp | |

### mcp_server_configs
MCP server configurations per-agent.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | |
| name | varchar(100) | Display name |
| description | varchar(500) | |
| command | varchar(200) | Process command (e.g. "node", "npx") |
| args | jsonb | Command arguments array |
| envMapping | jsonb | Credential key → env var name mapping |
| isEnabled | boolean | Whether to load during execution |
| writeTools | jsonb | Tool names requiring permission |
| createdAt, updatedAt | timestamp | |

### plugins
Admin-managed plugin registry. Each plugin is a Git repo.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | |
| name | varchar(100) | Display name |
| description | text | |
| gitRepoUrl | varchar(500) | Plugin repository URL |
| gitBranch | varchar(100) | Default: main |
| githubTokenEncrypted | text | For private repos (AES-256-GCM) |
| manifestCache | jsonb | Cached plugin.json contents |
| isAllowed | boolean | Admin toggle |
| createdBy | UUID FK → users | Admin who registered |
| createdAt, updatedAt | timestamp | |

### agent_plugins
Per-agent plugin toggle.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | |
| pluginId | UUID FK → plugins | |
| isEnabled | boolean | Default: true |
| createdAt | timestamp | |
| | | UNIQUE(agentId, pluginId) |

### models
Admin-managed model registry with credit costs. Workspace-scoped.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | |
| name | varchar(100) | Model name (e.g., `gpt-4.1`). UNIQUE per workspace |
| provider | varchar(50) | Provider (e.g., `github`). Default: github |
| description | text | |
| creditCost | decimal(10,2) | Credits per session. Default: 1.00 |
| isActive | boolean | Whether available for use |
| createdAt, updatedAt | timestamp | |

### workspace_quota_settings
Workspace-level credit quota limits. Managed by admin.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | UNIQUE |
| dailyCreditLimit | decimal(10,2) | Null = unlimited |
| monthlyCreditLimit | decimal(10,2) | Null = unlimited |
| updatedBy | UUID FK → users | Admin who last updated |
| updatedAt | timestamp | |

### user_quota_settings
Per-user credit quota overrides.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| userId | UUID FK → users | UNIQUE |
| dailyCreditLimit | decimal(10,2) | Null = use workspace default |
| monthlyCreditLimit | decimal(10,2) | Null = use workspace default |
| updatedAt | timestamp | |

### credit_usage
Per-user, per-model, per-day credit consumption tracking.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | |
| userId | UUID FK → users | |
| modelName | varchar(100) | Model used |
| creditsConsumed | decimal(10,2) | Default: 0 |
| sessionCount | integer | Number of sessions |
| date | date | Usage date |
| createdAt | timestamp | |
| | | UNIQUE(userId, modelName, date) |

### agent_decisions
Generic decision audit trail for agents.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | |
| executionId | UUID FK → workflow_executions | |
| category | varchar(50) | e.g. "trade", "analysis" |
| action | varchar(50) | e.g. "buy", "approve" |
| summary | text | Brief summary |
| decision | jsonb | Full reasoning (signals, confidence, details) |
| outcome | varchar(20) | executed, rejected, skipped |
| referenceId | varchar(100) | External reference ID |
| createdAt | timestamp | |

### system_events
Audit log and event trigger source.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| eventScope | enum('workspace','user') | Workspace-wide or user-specific |
| scopeId | UUID | workspaceId or userId |
| eventName | varchar(100) | Predefined event name |
| eventData | jsonb | Event-specific payload |
| actorId | UUID | User who caused the event (nullable) |
| createdAt | timestamp | Indexed for cursor-based polling |

**Predefined Event Names** (18 events):
- `agent.created`, `agent.updated`, `agent.deleted`, `agent.status_changed`
- `workflow.created`, `workflow.updated`, `workflow.deleted`
- `execution.started`, `execution.completed`, `execution.failed`, `execution.cancelled`
- `step.completed`, `step.failed`
- `trigger.fired`
- `user.login`, `user.registered`
- `variable.created`, `variable.updated`, `variable.deleted`

### agent_memories
Long-term memory with pgvector embeddings for semantic retrieval.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | |
| content | text | Memory content |
| embedding | vector(1536) | pgvector embedding |
| metadata | jsonb | Additional context |
| createdAt | timestamp | |
