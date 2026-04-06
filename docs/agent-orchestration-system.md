# Agent Orchestration Platform — System Design

> Part of [Architecture v4.0](ARCHITECTURE.md)

## Overview

The Agent Orchestration Platform is a general-purpose workflow engine for AI agents powered by GitHub Copilot. It manages agent definitions, workflow configurations (triggers + ordered steps), workflow executions (Copilot sessions), credentials, and quotas. It is **trading-unrelated** — agents can be configured for any domain.

---

## Core Concepts

### Agent
An AI agent defined by:
- **Git Repository** — Contains `.github/agents/*.md` (personality) and `skills/*.md` (domain knowledge)
- **Name and Description** — User-facing identity
- **GitHub Token** — For repo access (encrypted at rest)
- **Associated Workflows** — One or more workflows

### Workflow
A repeatable automated process consisting of:
1. **Trigger Configuration** — When/how to start
2. **Agent Steps** — Ordered list of prompt templates to execute

### Trigger Types
| Type | Description | Configuration |
|------|-------------|---------------|
| **Time Schedule** | Cron-based or interval-based | Cron expression or interval (minutes) |
| **Webhook** | External HTTP call | URL endpoint, HMAC secret |
| **Event** | Internal platform event | Event type (e.g., `workflow.completed`, `agent.error`) |
| **Manual** | User-initiated from UI | No configuration needed |

### Agent Step
A single unit of work in a workflow:
- **Name** — Human-readable identifier
- **Prompt Template** — Markdown text sent to the Copilot session
- **Order** — Position in the workflow (1, 2, 3, ...)
- **Agent Override** — Optional: use a different agent for this step
- **Timeout** — Max duration in seconds (default: 300)

#### Prompt Template & `<PRECEDENT_OUTPUT>`
The prompt template is user-defined markdown. It can include the special token `<PRECEDENT_OUTPUT>`, which is replaced at runtime with the output of the previous step.

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
- **Triggered by** — Trigger type + metadata (cron tick, webhook payload, manual user)
- **Status** — `pending` → `running` → `completed` | `failed` | `cancelled`
- **Step Executions** — Ordered list of step execution records

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
agents ──< workflows ──< workflow_steps
                    ──< workflow_executions ──< step_executions
agents ──< agent_credentials
agents ──< agent_quota_usage
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
Workflow definitions.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| agent_id | uuid FK → agents | Primary agent |
| name | varchar(200) | |
| description | text | |
| is_active | boolean | Whether triggers should fire |
| max_concurrent_executions | integer | Default: 1 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

#### workflow_steps
Ordered steps in a workflow.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| workflow_id | uuid FK → workflows | |
| name | varchar(200) | |
| prompt_template | text | Markdown with optional `<PRECEDENT_OUTPUT>` |
| step_order | integer | 1-indexed |
| agent_id | uuid FK → agents | Optional: override agent for this step |
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
| trigger_type | enum('time_schedule','webhook','event','manual') | |
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
| trigger_metadata | jsonb | Webhook payload, cron tick time, etc. |
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

#### agent_credentials
Key-value credential store for agents. Loaded as environment variables during execution.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| agent_id | uuid FK → agents | |
| key | varchar(100) | e.g., `TRADING_API_KEY` |
| value_encrypted | text | AES-256-GCM encrypted |
| description | varchar(300) | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| | | UNIQUE(agent_id, key) |

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
Workflow Worker picks up job
  │
  ▼
1. Acquire Redis lock: agent:{agentId}:session
2. Create workflow_execution record (status: running)
3. For each step in order:
   a. Create step_execution (status: running)
   b. Clone agent Git repo to temp dir
   c. Load agent credentials → .env file
   d. Initialize Copilot session with:
       - Agent personality (.md from repo)
       - Skills (.md from repo)
       - Resolved prompt (template with <PRECEDENT_OUTPUT>)
   e. Run Copilot session
   f. Capture output + reasoning trace
   g. Update step_execution (status: completed, output)
   h. Store output for next step's <PRECEDENT_OUTPUT>
4. Update workflow_execution (status: completed)
5. Release Redis lock
6. Cleanup temp dir
```

### Error Handling
- If a step fails, the entire workflow execution is marked `failed`
- Remaining steps are marked `skipped`
- Error logged in `step_executions.error` and `workflow_executions.error`
- **No automatic retry** — user can manually re-trigger from the UI
- BullMQ handles job-level retries for transient failures (network, pod crash)

### Concurrency Control
- **One session per agent**: Redis distributed lock `agent:{agentId}:session`
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
GET  /api/workflows           — List workflows (optionally filter by agentId)
POST /api/workflows           — Create workflow
  Body: { agentId, name, description, steps: [{ name, promptTemplate, stepOrder, timeoutSeconds? }] }

GET  /api/workflows/:id       — Workflow detail + steps + triggers
PUT  /api/workflows/:id       — Update workflow (name, description, isActive)
DELETE /api/workflows/:id

PUT  /api/workflows/:id/steps — Replace all steps atomically
  Body: { steps: [{ name, promptTemplate, stepOrder, agentId?, timeoutSeconds? }] }

POST /api/workflows/:id/trigger — Manually trigger a workflow
  Returns: { execution }
```

#### Execution Routes (`/api/executions`)
```
GET  /api/executions          — List executions (filter by workflowId, agentId, status)
  Query: ?workflowId=...&status=...&from=...&to=...&page=1&limit=50

GET  /api/executions/:id      — Full execution detail (all step executions + reasoning)
POST /api/executions/:id/cancel — Cancel a running execution
```

#### Trigger Routes (`/api/triggers`)
```
GET  /api/triggers            — List triggers (filter by workflowId)
POST /api/triggers            — Create trigger
  Body: { workflowId, triggerType, configuration }

PUT  /api/triggers/:id        — Update trigger
DELETE /api/triggers/:id
```

#### Credential Routes (`/api/credentials`)
```
GET  /api/credentials         — List credentials for an agent
  Query: ?agentId=...

POST /api/credentials         — Add credential
  Body: { agentId, key, value, description? }

PUT  /api/credentials/:id     — Update credential value
DELETE /api/credentials/:id
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

Each workflow step runs as a Copilot session. The setup process:

1. **Clone Git repo** to temp directory
   ```
   git clone --depth 1 --branch {gitBranch} {gitRepoUrl} /tmp/session-{execId}/
   ```

2. **Load credentials** into `.env` file
   ```
   # /tmp/session-{execId}/.env
   TRADING_API_KEY=ak_live_xxxxx
   TRADING_API_URL=https://trading.local/api
   NEWS_API_KEY=xxxxx
   ```

3. **Initialize Copilot session**
   ```typescript
   const session = copilot.createSession({
     agent: readFile(agentFilePath),  // .github/agents/normal.md
     skills: skillsPaths.map(p => readFile(p)),
     prompt: resolvedPrompt,  // Template with <PRECEDENT_OUTPUT> replaced
     workingDirectory: `/tmp/session-${execId}/`,
   });
   ```

4. **Execute and capture output**
   - Full response text → `step_executions.output`
   - Tool calls + reasoning → `step_executions.reasoning_trace` (JSONB)

5. **Cleanup**
   ```
   rm -rf /tmp/session-{execId}/
   ```

---

## UI Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | / | Overview: agent count, active workflows, recent executions |
| Login | /login | SSO login (shared with Trading Platform) |
| Agents | /agents | Agent list with status indicators |
| Agent Detail | /agents/:id | Agent config, associated workflows, recent executions |
| Agent Config | /agents/:id/config | Edit agent settings (repo, files, etc.) |
| Workflows | /workflows | Workflow list with trigger status |
| Workflow Detail | /workflows/:id | Workflow steps editor, trigger config, execution history |
| Workflow Edit | /workflows/:id/edit | Step-by-step workflow builder |
| Executions | /executions | Execution history with filters |
| Execution Detail | /executions/:id | Full execution trace: each step's prompt, output, reasoning |
| Credentials | /credentials | Credential key-value manager per agent |
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
