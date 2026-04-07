# Core Concepts

## Agent

An AI agent defined by:
- **Git Repository** — Contains `.github/agents/*.md` (personality) and `skills/*.md` (domain knowledge)
- **Name and Description** — User-facing identity
- **GitHub Token** — For repo access (encrypted at rest)
- **Agent Variables** — Encrypted key-value pairs (credentials or properties) scoped to this agent
- **Scope** — `user` (personal, owned by creator) or `workspace` (shared, admin-managed). Immutable after creation.
- **Built-in Tools Config** — Which platform built-in tools this agent can use (opt-in/opt-out per tool)

## Workflow

A repeatable automated process belonging to a **user** (not an agent). Consists of:
1. **Trigger Configuration** — When/how to start (cron schedule, webhook, event). All workflows support manual start from UI.
2. **Agent Steps** — Ordered list of prompt templates; each step can specify its own agent, model, and reasoning effort, or inherit from workflow defaults
3. **Version** — Auto-incremented on every edit (metadata or steps change)
4. **Owner** — The user who created the workflow
5. **Workflow Defaults** — Default Agent, Model, and Reasoning Effort that steps inherit unless overridden
6. **Scope** — `user` (personal, owned by creator) or `workspace` (shared, admin-managed). Immutable after creation.

## Resource Scoping

Agents and Workflows support two scope levels:
- **`user`** (default): Personal resource, owned and managed by the creator. Only the owner (or admins) can edit/delete.
- **`workspace`**: Shared resource visible to all workspace members. Only workspace admins or super admins can create, edit, or delete workspace-scoped resources.

Scope is set at creation time and **cannot be changed** afterward. Workspace-scoped workflows can use workspace-scoped agents. The API lists both workspace-scoped resources and the current user's personal resources.

## Trigger Types

| Type | Description | Configuration |
|------|-------------|---------------|
| **Time Schedule** | Cron-based or interval-based | Cron expression or interval (minutes) |
| **Webhook** | External HTTP call | URL endpoint, HMAC secret |
| **Event** | Internal platform event | Event name, optional scope filter, condition matching on event data |

> **Manual Start**: Every workflow can be started manually via the "Run Now" button in the UI. The user can optionally provide initial context (user input), which becomes the `<PRECEDENT_OUTPUT>` for the first step.

## Agent Step

A single unit of work in a workflow:
- **Name** — Human-readable identifier
- **Prompt Template** — Markdown text sent to the Copilot session
- **Order** — Position in the workflow (1, 2, 3, ...)
- **Agent** — Optional: which agent runs this step. If not set, uses the workflow's default agent
- **Session Configuration** (per-step overrides, falls back to workflow defaults):
  - **Model** — Copilot model override (e.g., `gpt-4.1`, `claude-sonnet-4`, `claude-sonnet-4-5`, `o4-mini`)
  - **Reasoning Effort** — `high`, `medium`, or `low` (affects model reasoning depth)
  - **Timeout** — Max duration in seconds (default: 300, range: 30–3600)

### Resolution Priority

For Agent, Model, and Reasoning Effort, the engine resolves in this order:
1. Step-level override (if set)
2. Workflow-level default (if set)
3. Platform default / env var (for model only: `DEFAULT_AGENT_MODEL` env var, defaults to `gpt-4.1`)

### Prompt Template & `<PRECEDENT_OUTPUT>` & `{{ Properties.KEY }}`

The prompt template is user-defined markdown. It can include:
- `<PRECEDENT_OUTPUT>` — replaced at runtime with the output of the previous step
- `{{ Properties.KEY_NAME }}` — replaced at runtime with the value of the named property variable

**Example workflow with 3 steps:**

**Step 1** — "Analyze Market":
```markdown
Analyze the current market conditions for the following symbols: AAPL, GOOG, MSFT.
For each symbol, provide:
1. Current trend (bullish/bearish/neutral)
2. Key support/resistance levels
3. Recent news impact
```

**Step 2** — "Make Trade Decisions":
```markdown
Based on the following market analysis, decide which trades to make:

<PRECEDENT_OUTPUT>

Consider our current portfolio state and risk tolerance.
For each recommended trade, provide: symbol, side (buy/sell), quantity, and reasoning.
```

**Step 3** — "Write Blog Post":
```markdown
Write a brief market commentary blog post based on the following trade decisions:

<PRECEDENT_OUTPUT>

Write in a professional but approachable tone. Include key market observations.
```

## Workflow Execution

A single run of a workflow:
- **Triggered by** — Trigger type + metadata (cron tick, webhook payload, manual user + optional user input)
- **Workflow Version** — Snapshot of the workflow version at trigger time
- **Workflow Snapshot** — Complete snapshot of workflow + steps configuration (JSONB), immutable once created
- **Status** — `pending` → `running` → `completed` | `failed` | `cancelled`
- **Step Executions** — Ordered list of step execution records
- **Retry** — Failed executions can be retried from the last failed step; completed steps' outputs are preserved

## Step Execution

A single Copilot session:
- **Resolved Prompt** — The prompt template with `<PRECEDENT_OUTPUT>` replaced
- **Output** — Full response from the Copilot session
- **Reasoning Trace** — Tool calls, intermediate thoughts (JSONB)
- **Status** — `pending` → `running` → `completed` | `failed`
- **Duration** — Start to finish time

## Retry

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
