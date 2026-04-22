# Database Schema

PostgreSQL 16 with pgvector extension. All tables use UUID primary keys and timestamps with timezone. Managed via Drizzle ORM.

## Entity Relationship

```mermaid
erDiagram
    workspaces ||--o{ users : "has members"
    workspaces ||--o{ agents : "contains"
    workspaces ||--o{ workflows : "contains"
    workspaces ||--o{ workspace_variables : "has variables"
    workspaces ||--o{ variable_versions : "scopes variable history"
    workspaces ||--o{ models : "has models"
    workspaces ||--o| workspace_security_settings : "has security settings"
    workspaces ||--o{ auth_providers : "has auth providers"

    users ||--o{ agents : "creates"
    users ||--o{ workflows : "creates"
    users ||--o{ conversations : "starts"
    users ||--o{ user_variables : "has variables"
    users ||--o{ variable_versions : "changes"
    users ||--o{ credit_usage : "tracks usage"
    users ||--o{ personal_access_tokens : "has PATs"

    agents ||--o{ agent_variables : "has variables"
    agents ||--o{ mcp_server_configs : "has MCP configs"
    agents ||--o{ agent_files : "has files"
    agents ||--o{ variable_versions : "owns variable history"
    agents ||--o{ webhook_registrations : "has webhooks"
    agents ||--o{ agent_decisions : "has decisions"
    agents ||--o{ agent_memories : "has memories"
    agents ||--o{ conversations : "powers chats"

    step_executions ||--o| agent_instances : "runs on"

    workflows ||--o{ workflow_steps : "has steps"
    workflows ||--o{ triggers : "has triggers"
    workflows ||--o{ workflow_executions : "has executions"
    conversations ||--o{ conversation_messages : "stores turns"

    workflow_executions ||--o{ step_executions : "has step results"
```

## Enums

| Enum | Values |
|---|---|
| `user_role` | `super_admin`, `workspace_admin`, `creator_user`, `view_user` |
| `agent_status` | `active`, `paused`, `error` |
| `execution_status` | `pending`, `running`, `completed`, `failed`, `cancelled` |
| `step_status` | `pending`, `running`, `completed`, `failed`, `skipped` |
| `trigger_type` | `time_schedule`, `exact_datetime`, `webhook`, `event`, `manual` |
| `agent_source_type` | `github_repo`, `database` |
| `variable_type` | `property`, `credential` |
| `variable_scope` | `agent`, `user`, `workspace` |
| `reasoning_effort` | `low`, `medium`, `high` |
| `worker_runtime` | `static`, `ephemeral` |
| `conversation_status` | `active`, `archived` |
| `conversation_message_role` | `user`, `assistant` |
| `conversation_message_status` | `pending`, `completed`, `failed` |
| `resource_scope` | `user`, `workspace` |
| `auth_provider_type` | `database`, `ldap` |
| `event_scope` | `workspace`, `user` |
| `memory_type` | `observation`, `insight`, `strategy`, `lesson_learned`, `general` |
| `instance_type` | `static`, `ephemeral` |
| `instance_status` | `idle`, `busy`, `offline`, `terminated` |

## Security Features

- **Encryption** — All credential values encrypted with AES-256-GCM
- **Parameterized queries** — Drizzle ORM prevents SQL injection
- **UUID keys** — Non-guessable primary keys
- **Foreign keys** — Cascade deletes for referential integrity
- **Unique indexes** — Prevent duplicate variable keys per scope
- **Zero credential exposure** — Agents never access credentials directly. Credentials are injected via Jinja2 templates into MCP configs and HTTP headers. See [AI Security](/concepts/security)
- **Personal Access Tokens** — SHA-256 hashed, fine-grained scopes, optional expiry

## Table Reference

`workflow_executions.workflowSnapshot` preserves workflow-level allocation timeout plus any step-level worker runtime overrides so retries and history remain stable even after later edits.

For full table definitions, see:

- [Core Tables](/database/schema-core) — Tenancy, Agents, Workflows, Executions
- [Support Tables](/database/schema-support) — Variables, Admin & Rate Limits, Audit & Memory, Auth & Tokens
