# Workflow Execution Engine

## Execution Flow

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
   f. Replace {{ Properties.KEY }} tokens in prompt template with property values
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

## Variable Hierarchy

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

## Execution Retry

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

## Error Handling

- If a step fails, the entire workflow execution is marked `failed`
- Remaining steps are marked `skipped`
- Error logged in `step_executions.error` and `workflow_executions.error`
- **Manual retry available**: User can retry from the last failed step via `POST /api/executions/:id/retry`
  - Creates a new execution, copying completed step outputs from the original
  - Re-runs from the first failed step onwards
  - New execution links back to the original via `triggerMetadata.retryOf`
- BullMQ handles job-level retries for transient failures (network, pod crash)

## Concurrency Control

- **`max_concurrent_executions` per workflow**: Checked before starting a new execution
- **BullMQ concurrency**: 1 job per worker pod (scale by adding pods)
