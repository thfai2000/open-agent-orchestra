# Agent Orchestration Platform — System Design

> Separate repository: `github-copilot-agent-orchestra`

## Overview

The Agent Orchestration Platform is a general-purpose workflow engine for AI agents powered by GitHub Copilot. It manages agent definitions, workflow configurations (triggers + ordered steps), workflow executions (Copilot sessions), variables (credentials + properties), and quotas. It is **domain-agnostic** — agents can be configured for any domain.

Domain-specific capabilities are provided by **user-installed MCP servers**. Each agent can have multiple MCP servers configured, which are spawned on-demand during workflow execution via stdio transport. The platform itself has zero domain-specific logic.

---

## Core Concepts

### Agent
An AI agent defined by:
- **Git Repository** — Contains `.github/agents/*.md` (personality) and `skills/*.md` (domain knowledge)
- **Name and Description** — User-facing identity
- **GitHub Token** — For repo access (encrypted at rest)
- **Agent Variables** — Encrypted key-value pairs (credentials or properties) scoped to this agent

### Workflow
A repeatable automated process belonging to a **user** (not an agent). Consists of:
1. **Trigger Configuration** — When/how to start (cron schedule, webhook, event). All workflows support manual start from UI.
2. **Agent Steps** — Ordered list of prompt templates; each step can specify its own agent, model, and reasoning effort, or inherit from workflow defaults
3. **Version** — Auto-incremented on every edit (metadata or steps change)
4. **Owner** — The user who created the workflow
5. **Workflow Defaults** — Default Agent, Model, and Reasoning Effort that steps inherit unless overridden

### Trigger Types
| Type | Description | Configuration |
|------|-------------|---------------|
| **Time Schedule** | Cron-based or interval-based | Cron expression or interval (minutes) |
| **Webhook** | External HTTP call | URL endpoint, HMAC secret |
| **Event** | Internal platform event | Event type (e.g., `workflow.completed`, `agent.error`) |

> **Manual Start**: Every workflow can be started manually via the "Run Now" button in the UI. The user can optionally provide initial context (user input), which becomes the `<PRECEDENT_OUTPUT>` for the first step.

### Agent Step
A single unit of work in a workflow:
- **Name** — Human-readable identifier
- **Prompt Template** — Markdown text sent to the Copilot session
- **Order** — Position in the workflow (1, 2, 3, ...)
- **Agent** — Optional: which agent runs this step. If not set, uses the workflow's default agent
- **Session Configuration** (per-step overrides, falls back to workflow defaults):
  - **Model** — Copilot model override (e.g., `gpt-4.1`, `claude-sonnet-4`, `claude-sonnet-4-5`, `o4-mini`)
  - **Reasoning Effort** — `high`, `medium`, or `low` (affects model reasoning depth)
  - **Timeout** — Max duration in seconds (default: 300, range: 30–3600)

#### Resolution Priority
For Agent, Model, and Reasoning Effort, the engine resolves in this order:
1. Step-level override (if set)
2. Workflow-level default (if set)
3. Platform default / env var (for model only: `DEFAULT_AGENT_MODEL` env var, defaults to `gpt-4.1`)

#### Prompt Template & `<PRECEDENT_OUTPUT>` & `{{ Properties.KEY }}`
The prompt template is user-defined markdown. It can include:
- `<PRECEDENT_OUTPUT>` — replaced at runtime with the output of the previous step
- `{{ Properties.KEY_NAME }}` — replaced at runtime with the value of the named property variable

Example workflow with 3 steps:

**Step 1** — "Analyze Market" (prompt template):
```markdown
Analyze the current market conditions for the following symbols: AAPL, GOOG, MSFT.
For each symbol, provide:
1. Current trend (bullish/bearish/neutral)
2. Key support/resistance levels
3. Recent news impact
```

**Step 2** — "Make Trade Decisions" (prompt template):
```markdown
Based on the following market analysis, decide which trades to make:

<PRECEDENT_OUTPUT>

Consider our current portfolio state and risk tolerance.
For each recommended trade, provide: symbol, side (buy/sell), quantity, and reasoning.
```

**Step 3** — "Write Blog Post" (prompt template):
```markdown
Write a brief market commentary blog post based on the following trade decisions:

<PRECEDENT_OUTPUT>

Write in a professional but approachable tone. Include key market observations.
```

### Workflow Execution
A single run of a workflow:
- **Triggered by** — Trigger type + metadata (cron tick, webhook payload, manual user + optional user input)
- **Workflow Version** — Snapshot of the workflow version at trigger time
- **Workflow Snapshot** — Complete snapshot of workflow + steps configuration (JSONB), immutable once created
- **Status** — `pending` → `running` → `completed` | `failed` | `cancelled`
- **Step Executions** — Ordered list of step execution records
- **Retry** — Failed executions can be retried from the last failed step; completed steps' outputs are preserved

### Step Execution
A single Copilot session:
- **Resolved Prompt** — The prompt template with `<PRECEDENT_OUTPUT>` replaced
- **Output** — Full response from the Copilot session
- **Reasoning Trace** — Tool calls, intermediate thoughts (JSONB)
- **Status** — `pending` → `running` → `completed` | `failed`
- **Duration** — Start to finish time

---

## Database Schema (agent_db)

### Entity Relationship

```
users ──< workflows ──< workflow_steps ──> agents
                   ──< workflow_executions ──< step_executions
agents ──< agent_variables
users  ──< user_variables
agents ──< agent_quota_usage
agents ──< agent_plugins ──> plugins
users  ──< plugins (created_by)
users  ──< credit_usage ──> models (by name)
users  ──< user_quota_settings
global_quota_settings (singleton)
triggers ──< workflow_executions
```

### Tables

#### agents
AI agent definitions.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid | Owner (from JWT, no FK to trading_db) |
| name | varchar(100) | |
| description | text | |
| git_repo_url | varchar(500) | GitHub repo URL |
| git_branch | varchar(100) | Default: main |
| agent_file_path | varchar(300) | Path to .md in repo (e.g., `.github/agents/normal.md`) |
| skills_paths | varchar(300)[] | Paths to skill .md files |
| github_token_encrypted | text | AES-256-GCM encrypted |
| status | enum('active','paused','error') | |
| last_session_at | timestamptz | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### workflows
Workflow definitions. Belong to a **user**, not an agent.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid | Owner who created this workflow |
| name | varchar(200) | |
| description | text | |
| is_active | boolean | Whether triggers should fire |
| max_concurrent_executions | integer | Default: 1 |
| version | integer | Auto-incremented on edit. Default: 1 |
| default_agent_id | uuid FK → agents | Optional: workflow-level default agent |
| default_model | varchar(100) | Optional: workflow-level default model |
| default_reasoning_effort | enum('high','medium','low') | Optional: workflow-level default |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### workflow_steps
Ordered steps in a workflow. Each step can specify its own agent, or inherit from workflow defaults.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK → workflows | |
| name | varchar(200) | |
| prompt_template | text | Markdown with optional `<PRECEDENT_OUTPUT>` |
| step_order | integer | 1-indexed |
| agent_id | uuid FK → agents | Optional: falls back to workflow default_agent_id |
| model | varchar(100) | Optional: overrides workflow default_model |
| reasoning_effort | enum('high','medium','low') | Optional: overrides workflow default |
| timeout_seconds | integer | Default: 300 |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| | | UNIQUE(workflow_id, step_order) |

#### triggers
Trigger configurations for workflows.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK → workflows | |
| trigger_type | enum('time_schedule','webhook','event','manual') | 'manual' kept in DB enum but unused — all workflows allow manual start via UI |
| configuration | jsonb | Type-specific config |
| is_active | boolean | |
| last_fired_at | timestamptz | |
| created_at | timestamptz | |

Configuration JSONB examples:
```json
// Time Schedule
{ "cron": "0 9 * * 1-5", "timezone": "America/New_York" }
{ "interval_minutes": 60 }

// Webhook
{ "secret": "hmac-secret-encrypted", "allowed_ips": ["0.0.0.0/0"] }

// Event
{ "event_type": "workflow.completed", "source_workflow_id": "uuid" }
```

#### workflow_executions
Records of workflow runs.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK → workflows | |
| trigger_id | uuid FK → triggers | What triggered this run |
| trigger_metadata | jsonb | Webhook payload, cron tick time, retry info, etc. |
| workflow_version | integer | Snapshot of workflow.version at trigger time |
| workflow_snapshot | jsonb | Full snapshot of workflow + steps config (immutable) |
| status | enum('pending','running','completed','failed','cancelled') | |
| current_step | integer | Which step is executing (1-indexed) |
| total_steps | integer | How many steps in this workflow |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| error | text | If failed |
| created_at | timestamptz | |

#### step_executions
Records of individual step runs within a workflow execution.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_execution_id | uuid FK → workflow_executions | |
| workflow_step_id | uuid FK → workflow_steps | |
| step_order | integer | Execution order |
| resolved_prompt | text | Prompt with `<PRECEDENT_OUTPUT>` replaced |
| output | text | Copilot session response |
| reasoning_trace | jsonb | Tool calls, intermediate thoughts |
| status | enum('pending','running','completed','failed','skipped') | |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| error | text | If failed |

#### agent_variables
Agent-level key-value variable store. Variables have a type (credential or property) and can optionally be injected as environment variables. Agent variables override user-level variables with the same key.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| agent_id | uuid FK → agents | |
| key | varchar(100) | e.g., `API_KEY`, `API_URL` |
| value_encrypted | text | AES-256-GCM encrypted |
| description | varchar(300) | |
| variable_type | enum('property','credential') | Default: 'credential' |
| inject_as_env_variable | boolean | If true, written to .env file during execution |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| | | UNIQUE(agent_id, key) |

#### user_variables
User-level key-value variable store. Available to all workflow steps. Agent variables with the same key take priority.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid | Owner |
| key | varchar(100) | e.g., `OPENAI_API_KEY` |
| value_encrypted | text | AES-256-GCM encrypted |
| description | varchar(300) | |
| variable_type | enum('property','credential') | Default: 'credential' |
| inject_as_env_variable | boolean | If true, written to .env file during execution |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| | | UNIQUE(user_id, key) |

#### agent_quota_usage
Per-agent quota tracking.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| agent_id | uuid FK → agents | |
| date | date | Usage date |
| prompt_tokens_used | integer | |
| completion_tokens_used | integer | |
| session_count | integer | Number of Copilot sessions |
| created_at | timestamptz | |
| | | UNIQUE(agent_id, date) |

#### webhook_registrations
Webhook endpoint metadata for agents.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| agent_id | uuid FK → agents | |
| trigger_id | uuid FK → triggers | Which trigger this serves |
| endpoint_path | varchar(200) | URL path suffix |
| hmac_secret_encrypted | text | AES-256-GCM encrypted |
| is_active | boolean | |
| request_count | integer | Total received |
| last_received_at | timestamptz | |
| created_at | timestamptz | |

#### mcp_server_configs
MCP server configurations per-agent. Users install MCP servers through the API.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| agent_id | uuid FK → agents | |
| name | varchar(100) | Display name |
| description | varchar(500) | |
| command | varchar(200) | Process command (e.g. "node", "npx") |
| args | jsonb | Command arguments array |
| env_mapping | jsonb | Credential key → env var name mapping |
| is_enabled | boolean | Whether to load during execution |
| write_tools | jsonb | Tool names requiring permission |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### plugins
Admin-managed plugin registry. Each plugin is a Git repo following the plugin pattern (see `docs/plugin-system.md`).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | varchar(100) | Display name |
| description | text | |
| git_repo_url | varchar(500) | Plugin repository URL |
| git_branch | varchar(100) | Default: main |
| github_token_encrypted | text | For private repos (AES-256-GCM) |
| manifest_cache | jsonb | Cached plugin.json contents |
| is_allowed | boolean | Admin toggle — allowed for users |
| created_by | uuid FK → users | Admin who registered |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### agent_plugins
Per-agent plugin toggle. Users enable/disable allowed plugins for their agents.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| agent_id | uuid FK → agents | |
| plugin_id | uuid FK → plugins | |
| is_enabled | boolean | Default: true |
| created_at | timestamptz | |
| | | UNIQUE(agent_id, plugin_id) |

#### models
Admin-managed model registry. Defines available LLM models and their credit costs.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | varchar(100) | Model name (e.g., `gpt-4.1`). UNIQUE |
| provider | varchar(50) | Provider (e.g., `github`). Default: github |
| description | text | Model description |
| credit_cost | decimal(10,2) | Credits consumed per session. Default: 1.00 |
| is_active | boolean | Whether available for use |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### global_quota_settings
System-wide credit quota limits. Managed by admin. Singleton table.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| daily_credit_limit | decimal(10,2) | Null = unlimited |
| monthly_credit_limit | decimal(10,2) | Null = unlimited |
| updated_by | uuid FK → users | Admin who last updated |
| updated_at | timestamptz | |

#### user_quota_settings
Per-user credit quota overrides. Users can set their own limits (must be <= global limits).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → users | UNIQUE |
| daily_credit_limit | decimal(10,2) | Null = use global default |
| monthly_credit_limit | decimal(10,2) | Null = use global default |
| updated_at | timestamptz | |

#### credit_usage
Per-user, per-model, per-day credit consumption tracking. Replaces agent-level quota as primary credit system.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| model_name | varchar(100) | Model used |
| credits_consumed | decimal(10,2) | Credits consumed. Default: 0 |
| session_count | integer | Number of sessions |
| date | date | Usage date |
| created_at | timestamptz | |
| | | UNIQUE(user_id, model_name, date) |

#### agent_decisions
Generic decision audit trail for agents.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| agent_id | uuid FK → agents | |
| execution_id | uuid FK → workflow_executions | |
| category | varchar(50) | Decision category (e.g. "trade", "analysis") |
| action | varchar(50) | Action taken (e.g. "buy", "approve") |
| summary | text | Brief summary |
| decision | jsonb | Full reasoning (signals, confidence, details) |
| outcome | varchar(20) | executed, rejected, skipped |
| reference_id | varchar(100) | External reference ID |
| created_at | timestamptz | |

---

## Workflow Execution Engine

### Execution Flow

```
Trigger fires (cron/webhook/event/manual)
  │
  ▼
Scheduler/Webhook handler creates BullMQ job
  { workflowId, triggerId, triggerMetadata }
  │
  ▼
1. Snapshot workflow: capture version + full config (steps, models, agents, etc.)
2. Create workflow_execution record (status: pending, workflowVersion, workflowSnapshot)
3. Pre-create step_execution records for all steps
4. Enqueue BullMQ job
  │
  ▼
Workflow Worker picks up job
  │
  ▼
1. Load user-level variables (from user_variables table) → split by type into credentialMap, propertyMap, envVarMap
2. Mark workflow_execution (status: running)
3. For each step in order (or from startFromStep on retry):
   a. Mark step_execution (status: running)
   b. Load step's agent from DB (via step.agentId)
   c. Clone agent Git repo to temp dir
   d. Load agent-level variables → merge with user variables (agent overrides user) → 3 maps: mergedCredentials, mergedProperties, mergedEnvVars
   e. If envVarMap has entries, write .env file to agent workspace workdir
   f. Replace `{{ Properties.KEY }}` tokens in prompt template with property values
   g. Initialize Copilot session with:
       - Agent personality (.md from repo)
       - Skills (.md from repo)
       - Step-configured model (or default)
       - Step-configured reasoning effort (if set)
       - Resolved prompt (template with <PRECEDENT_OUTPUT> and {{ Properties.KEY }} replaced)
       - Merged credentials
   h. Run Copilot session with step timeout
   i. Capture output + reasoning trace
   j. Update step_execution (status: completed, output)
   k. Store output for next step's <PRECEDENT_OUTPUT>
4. Update workflow_execution (status: completed)
5. Update lastSessionAt for all agents used in the workflow
6. Cleanup temp dirs
```

### Variable Hierarchy

Variables are loaded at two levels, split by type, and merged per-step:

```
User Variables (user_variables table)
  └── Available to all workflow steps
  └── Split into: credentialMap, propertyMap, envVarMap
  └── e.g., OPENAI_API_KEY (credential), PROJECT_NAME (property)

Agent Variables (agent_variables table)
  └── Scoped to a specific agent
  └── Override user variables with the same key
  └── e.g., AGENT_SPECIFIC_API_KEY (credential)

Merged per step:
  mergedCredentials = { ...userCredentials, ...agentCredentials }
  mergedProperties  = { ...userProperties, ...agentProperties }
  mergedEnvVars     = { ...userEnvVars, ...agentEnvVars }
```

**Variable Types:**
- **Credential**: Injected into Copilot session as encrypted key-value pairs
- **Property**: Used as `{{ Properties.KEY }}` tokens in prompt templates, replaced at runtime

**Env Variable Injection:**
Any variable with `inject_as_env_variable = true` is written to a `.env` file in the agent's working directory before execution.

### Execution Retry

Failed executions can be retried from the last failed step:

```
POST /api/executions/:id/retry
  │
  ▼
1. Find the first failed step in the original execution
2. Create new workflow_execution with:
   - Same workflowVersion + workflowSnapshot (from original)
   - triggerMetadata includes { retryOf: originalExecutionId }
3. Pre-create step_executions:
   - Steps before the failed step: COPY completed outputs from original
   - Failed step and subsequent steps: status = pending
4. Enqueue BullMQ job with startFromStep = failedStepIndex
5. Worker picks up and executes from the failed step
   - precedentOutput recovered from last completed step
```

### Error Handling
- If a step fails, the entire workflow execution is marked `failed`
- Remaining steps are marked `skipped`
- Error logged in `step_executions.error` and `workflow_executions.error`
- **Manual retry available**: User can retry from the last failed step via `POST /api/executions/:id/retry`
  - Creates a new execution, copying completed step outputs from the original
  - Re-runs from the first failed step onwards
  - New execution links back to the original via `triggerMetadata.retryOf`
- BullMQ handles job-level retries for transient failures (network, pod crash)

### Concurrency Control
- **`max_concurrent_executions` per workflow**: Checked before starting a new execution
- **BullMQ concurrency**: 1 job per worker pod (scale by adding pods)

---

## API Design

### Routes

#### Agent Routes (`/api/agents`)
```
GET  /api/agents              — List agents for current user
POST /api/agents              — Create agent
  Body: { name, description, gitRepoUrl, gitBranch, agentFilePath, skillsPaths, githubToken }

GET  /api/agents/:id          — Agent detail
PUT  /api/agents/:id          — Update agent config
DELETE /api/agents/:id        — Delete agent (cascades to workflows)

POST /api/agents/:id/validate — Validate Git repo access + file structure
```

#### Workflow Routes (`/api/workflows`)
```
GET  /api/workflows           — List workflows for current user (with lastExecutionAt, ownerName, version)

POST /api/workflows           — Create workflow (version=1, owner from JWT)
  Body: {
    name, description,
    defaultAgentId?, defaultModel?, defaultReasoningEffort?,
    steps: [{ name, promptTemplate, stepOrder, agentId?, model?, reasoningEffort?, timeoutSeconds? }],
    triggers?: [{ triggerType, configuration }]
  }
  Note: Step agentId is optional if workflow has defaultAgentId. Webhook trigger paths must be globally unique.
  Trigger types: time_schedule, webhook, event (no 'manual' — all workflows allow manual start).

GET  /api/workflows/:id       — Workflow detail + steps + triggers + owner + lastExecution + defaults
PUT  /api/workflows/:id       — Update workflow metadata + defaults (auto-increments version)
  Body: { name?, description?, isActive?, defaultAgentId?, defaultModel?, defaultReasoningEffort? }
DELETE /api/workflows/:id

PUT  /api/workflows/:id/steps — Replace all steps atomically (auto-increments version)
  Body: { steps: [{ name, promptTemplate, stepOrder, agentId?, model?, reasoningEffort?, timeoutSeconds? }] }

POST /api/workflows/:id/trigger — Manually trigger a workflow with optional user input
  Body: { userInput?: string }  — User input becomes initial <PRECEDENT_OUTPUT> for step 1
  Returns: { execution }
```

#### Execution Routes (`/api/executions`)
```
GET  /api/executions          — List executions with workflowVersion, trigger info
  Query: ?workflowId=...&status=...&from=...&to=...&page=1&limit=50

GET  /api/executions/:id      — Full execution detail (step executions + reasoning + version)
POST /api/executions/:id/cancel — Cancel a running execution
POST /api/executions/:id/retry  — Retry from last failed step (creates new execution)
  Requires: execution status = 'failed'
  Returns: { execution } (new execution with retryOf link)
```

#### Trigger Routes (`/api/triggers`)
```
GET  /api/triggers            — List triggers (filter by workflowId)
POST /api/triggers            — Create trigger
  Body: { workflowId, triggerType, configuration }

PUT  /api/triggers/:id        — Update trigger
DELETE /api/triggers/:id
```

#### Variable Routes (`/api/variables`)
```
GET  /api/variables            — List variables
  Query: ?agentId=...          (agent-level variables for a specific agent)
  Query: ?scope=user           (user-level variables for current user)

POST /api/variables            — Add variable
  Body: { agentId?, key, value, description?, variableType?: 'property'|'credential', injectAsEnvVariable?: boolean }
  If agentId present → agent-level variable
  If agentId absent  → user-level variable

PUT  /api/variables/:id        — Update variable value
  Body: { value?, description?, variableType?, injectAsEnvVariable?, scope? }

DELETE /api/variables/:id      — Delete variable
  Query: ?scope=user           (for user-level variables)
```

#### MCP Server Routes (`/api/mcp-servers`)
```
GET  /api/mcp-servers         — List MCP server configs for an agent
  Query: ?agentId=...

POST /api/mcp-servers         — Add MCP server config to an agent
  Body: { agentId, name, description?, command, args, envMapping, isEnabled, writeTools }

PUT  /api/mcp-servers/:id     — Update MCP server config
DELETE /api/mcp-servers/:id   — Remove MCP server config
```

#### Plugin Routes (`/api/plugins`)
```
GET    /api/plugins              — List plugins (admin sees all, users see allowed only)
POST   /api/plugins              — Register plugin (admin only)
  Body: { name, description?, gitRepoUrl, gitBranch?, githubToken?, isAllowed? }

GET    /api/plugins/:id          — Plugin detail with manifest
PUT    /api/plugins/:id          — Update plugin (admin only)
DELETE /api/plugins/:id          — Remove plugin (admin only)
POST   /api/plugins/:id/sync     — Re-clone and refresh manifest cache (admin only)

GET    /api/plugins/agent/:agentId           — List plugins with enabled status for agent
PUT    /api/plugins/agent/:agentId/:pluginId — Enable/disable plugin for agent
  Body: { isEnabled: boolean }
```

#### Webhook Routes (`/api/webhooks`)
```
POST /api/webhooks/:registrationId
  Headers: X-Signature, X-Timestamp, X-Event-Id
  Body: (any JSON)

  Verifies:
  1. HMAC-SHA256 signature
  2. Timestamp within 5-minute window
  3. Event-Id not replayed (dedup cache)
  4. Rate limit per registration

  On success: enqueues workflow execution job
```

#### Admin Routes (`/api/admin`) — Admin only
```
GET  /api/admin/users              — List all users
PUT  /api/admin/users/:id/role     — Update user role
  Body: { role: 'user' | 'admin' }

GET  /api/admin/models             — List all models
POST /api/admin/models             — Create model
  Body: { name, provider?, description?, creditCost?, isActive? }
PUT  /api/admin/models/:id         — Update model
DELETE /api/admin/models/:id       — Delete model

GET  /api/admin/quota              — Get global quota settings
PUT  /api/admin/quota              — Update global quota settings
  Body: { dailyCreditLimit?, monthlyCreditLimit? }

GET  /api/admin/usage/summary      — Aggregated credit usage across all users
  Query: ?days=30
```

#### Quota Routes (`/api/quota`) — Authenticated users
```
GET  /api/quota/settings           — Get own quota settings + global defaults
PUT  /api/quota/settings           — Update own quota limits
  Body: { dailyCreditLimit?, monthlyCreditLimit? }

GET  /api/quota/usage              — Get own credit usage
  Query: ?days=30

GET  /api/quota/models             — List active models
```

---

## Workers

### Workflow Worker
BullMQ worker that processes workflow execution jobs.

```typescript
// packages/agent-api/src/workers/workflow-worker.ts
const worker = new Worker('workflow-execution', async (job) => {
  const { workflowId, triggerId, triggerMetadata } = job.data;
  await executeWorkflow(workflowId, triggerId, triggerMetadata);
}, {
  connection: redis,
  concurrency: 1,  // One session per pod
  lockDuration: 600_000, // 10 minutes
});
```

### Scheduler
Singleton process (Redis leader lock) that:
1. Polls `triggers` table for time-schedule triggers that are due
2. Enqueues workflow execution jobs in BullMQ
3. Updates `triggers.last_fired_at`

```
Every 30 seconds:
  SELECT * FROM triggers
  WHERE trigger_type = 'time_schedule'
    AND is_active = true
    AND (last_fired_at IS NULL OR next_fire_at <= NOW())
  FOR UPDATE SKIP LOCKED
```

---

## Copilot Session Setup

Each workflow step runs as a Copilot session with two types of tools:

### Built-in Tools (5 tools)
These operate on the agent-orchestra's own database (`agent_db`):

| Tool | Description |
|------|-------------|
| `schedule_next_wakeup` | Self-scheduling via cron triggers |
| `manage_webhook_trigger` | Webhook lifecycle management |
| `record_decision` | Generic decision audit trail (JSONB) |
| `memory_store` | Store memories with pgvector embeddings |
| `memory_retrieve` | Semantic similarity search over memories |

### MCP Tools (user-configured, per-agent)
Each agent can have multiple MCP servers configured through the `/api/mcp-servers` API. During workflow execution, the engine spawns each enabled MCP server as a child process (stdio transport) and loads its tools dynamically.

**Example**: A trading agent might have a "Trading Platform" MCP server configured that provides 13 trading/market tools. A different agent might have a "GitHub" MCP server for code review tools.

### MCP Server Configuration

MCP servers are configured per-agent in the `mcp_server_configs` table:

| Field | Description |
|-------|-------------|
| `name` | Display name (e.g. "Trading Platform") |
| `command` | Process command (e.g. "node", "npx", "python") |
| `args` | Command arguments (e.g. ["--import", "tsx", "server.ts"]) |
| `envMapping` | Maps agent credential keys → env vars for the process |
| `writeTools` | Tool names that require permission confirmation |
| `isEnabled` | Whether to load this server during execution |

### Tool Loading Flow

```
Workflow step starts
  │
  ▼
1. Create built-in tools (5 tools, always available)
2. Load agent's MCP server configs from DB
  │
  ▼
For each enabled MCP server:
  ├── Resolve env vars from agent credentials via envMapping
  ├── Spawn MCP server subprocess (stdio transport)
  ├── List available tools from server
  ├── Convert MCP tools → Copilot SDK tools
  └── Merge with existing tools
  │
  ▼
3. Initialize Copilot session with merged tools
4. Execute session, capture output + reasoning trace
5. Cleanup all MCP child processes
```

### Session Setup Process

1. **Clone Git repo** to temp directory
   ```
   git clone --depth 1 --branch {gitBranch} {gitRepoUrl} /tmp/session-{execId}/
   ```

2. **Load credentials** — merge user-level + agent-level credentials (agent overrides user)

3. **Create tools** (built-in + MCP from all configured servers)
   ```typescript
   const builtInTools = createAgentTools(credentials, context);
   // For each enabled MCP server config:
   const mcp = await connectToMcpServer({
     name: config.name,
     command: config.command,
     args: config.args,
     env: resolvedEnv, // credential keys mapped to env vars
     writeTools: config.writeTools,
   });
   const allTools = [...builtInTools, ...mcp.tools];
   ```

4. **Initialize Copilot session**
   ```typescript
   const session = copilot.createSession({
     model: 'gpt-4.1',
     tools: allTools,
     systemMessage: { ... },
     onPermissionRequest: approveAll,
   });
   ```

5. **Execute and capture output**
   - Full response text → `step_executions.output`
   - Tool calls + reasoning → `step_executions.reasoning_trace` (JSONB)

6. **Cleanup**
   ```
   // terminate all MCP child processes
   for (const cleanup of mcpCleanups) await cleanup();
   rm -rf /tmp/session-{execId}/
   ```

---

## UI Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | / | Overview: agent count, active workflows, recent executions |
| Login | /login | SSO login (shared with Trading Platform) |
| Agents | /agents | Agent list + create form |
| Agent Detail | /agents/:id | View/Edit (prominent ✏️ Edit Agent button), agent credentials, MCP servers |
| Workflows | /workflows | Workflow list + create form (with defaults + per-step agent selection) |
| Workflow Detail | /workflows/:id | ✏️ Edit Workflow (metadata + defaults), steps editor, trigger config, ▶ Run Now with user input dialog |
| Executions | /executions | Execution history with filters |
| Execution Detail | /executions/:id | Full execution trace: each step's prompt, output, reasoning |
| Credentials | /credentials | User-level + agent-level credential manager |
| Settings | /settings | Platform settings |

### Execution Detail View

The execution detail page is the most important UI feature. It shows:

```
┌─────────────────────────────────────────────────────────────────┐
│ Execution #e7a3...  │  Status: ✅ Completed  │  Duration: 45s  │
├─────────────────────────────────────────────────────────────────┤
│ Triggered by: Time Schedule (0 9 * * 1-5) at 2024-12-01 09:00  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Step 1: Analyze Market                          ✅ 12s         │
│  ┌── Prompt ──────────────────────────────────────────┐        │
│  │ Analyze the current market conditions for AAPL...  │        │
│  └────────────────────────────────────────────────────┘        │
│  ┌── Output ──────────────────────────────────────────┐        │
│  │ ## Market Analysis - Dec 1, 2024                   │        │
│  │ ### AAPL: Bullish ...                              │        │
│  └────────────────────────────────────────────────────┘        │
│  ┌── Reasoning (3 tool calls) ────────────────────────┐        │
│  │ → web_search("AAPL stock news today") ...          │        │
│  └────────────────────────────────────────────────────┘        │
│                                                                 │
│  Step 2: Make Trade Decisions                    ✅ 18s         │
│  ┌── Prompt ──────────────────────────────────────────┐        │
│  │ Based on the following market analysis...          │        │
│  │ [output from step 1 injected here]                 │        │
│  └────────────────────────────────────────────────────┘        │
│  ┌── Output ──────────────────────────────────────────┐        │
│  │ ## Trade Recommendations ...                       │        │
│  └────────────────────────────────────────────────────┘        │
│                                                                 │
│  Step 3: Write Blog Post                         ✅ 15s         │
│  ...                                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quota System

Per-agent limits (configurable per agent):
- **Daily session limit**: Max Copilot sessions per day (default: 50)
- **Monthly token limit**: Max tokens (prompt + completion) per month
- Tracked in `agent_quota_usage` table
- Checked before each step execution
- Exceeded → step marked `failed`, execution halted

---

## Security

- **Webhook HMAC**: SHA-256 signature verification, 5-min replay window, event-id dedup
- **Credentials**: AES-256-GCM encrypted at rest, decrypted only in-memory during execution
- **Agent isolation**: Redis lock ensures one session per agent at a time
- **Git tokens**: Encrypted, used only for repo clone, never logged
- **Input validation**: Zod schemas on all API inputs
- **Session cleanup**: Temp directories destroyed after execution
