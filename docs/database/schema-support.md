# Support Tables

Variables, Admin & Rate Limit, Audit & Memory, and Auth & Token tables. For the ER diagram and enums, see [Schema Overview](/database/schema).

## Variable Tables

All variable tables share the same structure: `key` (UPPER_SNAKE_CASE), `valueEncrypted` (AES-256-GCM), `variableType` (credential/property), `injectAsEnvVariable`, and a monotonically increasing `version`.

### agent_variables

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK → agents | |
| key | varchar(100) | UPPER_SNAKE_CASE |
| valueEncrypted | text | AES-256-GCM |
| description | varchar(300) | |
| variableType | variable_type | Default: `credential` |
| injectAsEnvVariable | boolean | |
| version | integer | Auto-incremented on each update |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(agentId, key) |

### user_variables

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| userId | UUID | |
| key | varchar(100) | |
| valueEncrypted | text | |
| description | varchar(300) | |
| variableType | variable_type | Default: `credential` |
| injectAsEnvVariable | boolean | |
| version | integer | Auto-incremented on each update |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(userId, key) |

### workspace_variables

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | |
| key | varchar(100) | |
| valueEncrypted | text | |
| description | varchar(300) | |
| variableType | variable_type | Default: `credential` |
| injectAsEnvVariable | boolean | |
| version | integer | Auto-incremented on each update |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(workspaceId, key) |

### variable_versions

Immutable metadata snapshots for variables across all three scopes.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| variableId | UUID | Original variable ID (no FK so history survives deletion) |
| scope | variable_scope | `agent`, `user`, or `workspace` |
| scopeId | UUID | Owner ID for the variable's scope |
| workspaceId | UUID | Workspace context for access checks |
| version | integer | Snapshot version number |
| snapshot | jsonb | Variable metadata snapshot, including deleted state |
| changedBy | UUID | User who made the change |
| createdAt | timestamp | |
| | | UNIQUE(scope, variableId, version) |

## Admin & Rate Limit Tables

### models

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | |
| name | varchar(100) | UNIQUE per workspace |
| provider | varchar(50) | Default: `github` |
| description | text | |
| creditCost | decimal(10,2) | Default: 1.00 |
| isActive | boolean | |
| createdAt, updatedAt | timestamp | |

### workspace_quota_settings

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK | UNIQUE |
| dailyCreditLimit | decimal(10,2) | Null = unlimited |
| weeklyCreditLimit | decimal(10,2) | Null = unlimited |
| monthlyCreditLimit | decimal(10,2) | Null = unlimited |
| updatedBy | UUID FK → users | |
| updatedAt | timestamp | |

### user_quota_settings

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| userId | UUID FK | UNIQUE |
| dailyCreditLimit | decimal(10,2) | Null = use workspace default |
| weeklyCreditLimit | decimal(10,2) | Null = use workspace default |
| monthlyCreditLimit | decimal(10,2) | Null = use workspace default |
| updatedAt | timestamp | |

### credit_usage

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK | |
| userId | UUID FK | |
| modelName | varchar(100) | |
| creditCostSnapshot | decimal(10,2) | Stored model credit cost at execution time |
| creditsConsumed | decimal(10,2) | Default: 0 |
| sessionCount | integer | |
| date | date | |
| createdAt | timestamp | |
| | | UNIQUE(userId, modelName, date, creditCostSnapshot) |

## Audit & Memory Tables

### system_events

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| eventScope | enum(`workspace`, `user`) | |
| scopeId | UUID | workspaceId or userId |
| eventName | varchar(100) | One of 21 predefined events |
| eventData | jsonb | Event-specific payload |
| actorId | UUID | User who caused the event |
| createdAt | timestamp | Indexed for cursor-based polling |

### agent_decisions

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK | |
| executionId | UUID FK | |
| category | varchar(50) | e.g., `trade`, `analysis` |
| action | varchar(50) | e.g., `buy`, `approve` |
| summary | text | |
| decision | jsonb | Full reasoning |
| outcome | varchar(20) | `executed`, `rejected`, `skipped` |
| referenceId | varchar(100) | External reference |
| createdAt | timestamp | |

### agent_memories

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK | |
| content | text | Memory content |
| embedding | vector(1536) | pgvector embedding |
| metadata | jsonb | Additional context |
| createdAt | timestamp | |

### agent_instances

Tracks running agent instances (both static and ephemeral).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| name | varchar(200) | Instance name (worker name or K8s pod name) |
| instance_type | enum | `static` or `ephemeral` |
| status | enum | `idle`, `busy`, `offline`, `terminated` |
| hostname | varchar(255) | Machine/container hostname |
| current_step_execution_id | UUID FK → step_executions | Currently executing step (nullable) |
| metadata | JSONB | Flexible metadata (pid, labels, etc.) |
| last_heartbeat_at | timestamp | Last heartbeat time |
| createdAt | timestamp | |
| updatedAt | timestamp | |

### webhook_registrations

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| agentId | UUID FK | |
| triggerId | UUID FK | |
| endpointPath | varchar(200) | URL path suffix |
| hmacSecretEncrypted | text | AES-256-GCM |
| isActive | boolean | |
| requestCount | integer | |
| lastReceivedAt | timestamp | |
| createdAt | timestamp | |

## Auth & Token Tables

### auth_providers

Workspace-scoped authentication provider configurations. See [Auth Providers](/concepts/auth-providers).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| workspaceId | UUID FK → workspaces | |
| providerType | auth_provider_type | `database` or `ldap` |
| name | varchar(100) | Display name |
| isEnabled | boolean | Default: true |
| priority | integer | Lower = higher priority (default: 0) |
| config | jsonb | Provider-specific settings (LDAP URL, bind DN, etc.) |
| createdAt, updatedAt | timestamp | |
| | | UNIQUE(workspaceId, providerType, name) |

### personal_access_tokens

Fine-grained PATs for webhook triggers and API access.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| userId | UUID FK → users | Cascade delete |
| workspaceId | UUID FK → workspaces | Cascade delete |
| name | varchar(100) | User-friendly label |
| tokenHash | varchar(128) | SHA-256 hash (UNIQUE) |
| tokenPrefix | varchar(12) | First 8 chars for display (`oao_xxxx`) |
| scopes | jsonb | Array of granted scopes |
| expiresAt | timestamp | Null = no expiry |
| lastUsedAt | timestamp | Updated on each use |
| isRevoked | boolean | Default: false |
| createdAt | timestamp | |

**Available Scopes:**

| Scope | Description |
|---|---|
| `webhook:trigger` | Trigger webhook-type workflow triggers |
| `api:read` | Read-only API access (GET endpoints) |
| `api:write` | Write API access (POST/PUT/DELETE) |
| `api:agents` | Manage agents |
| `api:workflows` | Manage workflows |
| `api:executions` | View/manage executions |
| `api:variables` | Read/write variables |
| `api:triggers` | Manage triggers |
| `api:admin` | Admin operations |
