# Visual Workflows (Graph Mode)

OAO supports two complementary workflow execution modes:

| Mode | Best for | Defined as |
|---|---|---|
| **Sequential** (default) | Linear, agent-only pipelines | Ordered list of `workflow_steps` |
| **Graph** (opt-in) | Parallel, conditional, mixed agent + procedural | Nodes + edges in a DAG, with agent-step nodes synced back to `workflow_steps` |

Graph mode is **additive** at the runtime layer. Existing sequential workflows continue to execute unchanged until a graph is saved, and the Visual Editor loads their existing `workflow_steps` as connected `agent_step` blocks. In the UI, the Visual Editor is now the single authoring surface for workflow steps and graph blocks.

---

## Why Graph Workflows?

A workflow is rarely a straight line. Real automations often need:

- **Parallel branches** — fan out work across two API calls, merge the results.
- **Conditional routes** — inspect a JSON payload, then take different paths based on its content.
- **Mixed step types** — call a web API, transform the response with JavaScript, then hand the result to an agent.
- **Scoped state** — share data between steps without polluting agent or workspace variables.

Graph workflows give you all of this in one place.

---

## Node Types

| Type | Purpose | Required `config` keys |
|---|---|---|
| `start` | Entry point. Exactly one per graph. | – |
| `end` | Terminal node. | – |
| `agent_step` | Run an AI agent step (Copilot session, MCP tools, prompt template). | `promptTemplate`, optional `agentId`, `model`, `reasoningEffort` |
| `http_request` | Call an external HTTP API. | `url`, optional `method`, `headers`, `body`, `query`, `jsonPath`, `timeoutMs` |
| `script` | Run a sandboxed JavaScript snippet (Node `vm` — no `process`/`require`). | `source`, optional `timeoutMs` (max 30s) |
| `conditional` | Evaluate a JS expression; routes by `branchKey` on outgoing edges. | `expression` |
| `parallel` | Pass-through fan-out marker. | – |
| `join` | Wait for multiple parents (strategy: `all` by default). | optional `strategy` |

The **Start** node emits the runtime trigger envelope. Downstream nodes receive an object with `inputs`, `trigger`, `payload`, and `eventData`, so manual-run inputs and webhook payloads are available immediately to the first connected block.

### Edges

Each edge has `fromNodeKey`, `toNodeKey`, and an optional `branchKey` + `label`. The graph engine traverses edges with these rules:

- After a **conditional** node, only the edge whose `branchKey` matches the expression result is followed.
- After every other node, **all** outgoing edges are followed (parallel fan-out).
- A **join** node with `strategy: 'all'` waits until every incoming edge's parent has completed or has been skipped by an unchosen conditional branch.

---

## Procedural Steps

### `http_request`

```jsonc
{
  "url": "https://api.example.com/items/{{ properties.region }}",
  "method": "GET",
  "headers": { "Authorization": "Bearer {{ credentials.API_TOKEN }}" },
  "jsonPath": "data.items[0].id",   // optional — extract a single field
  "timeoutMs": 15000                 // capped at 120000
}
```

The output of `http_request` is `{ status, ok, headers, body }` (or just the extracted value when `jsonPath` is set).

The configuration is rendered with **Jinja2** before execution, so workflow-scoped credentials and properties are available as <span v-pre>`{{ credentials.X }}`</span> / <span v-pre>`{{ properties.X }}`</span>. Credentials are decrypted only inside the executor — they never leave the controller pod.

### `script`

```jsonc
{
  "source": "return { doubled: input.body.value * 2 }",
  "timeoutMs": 5000
}
```

The script body runs inside `(async () => { ... })()` in a Node `vm` sandbox. Available globals: `input`, `vars` (execution-scoped variables), `props` (workflow-scoped properties), `JSON`, `Math`, `Date`, `console`, primitive constructors. **Not available**: `process`, `require`, `globalThis`, `import`, network access.

For the first script after Start, `input.inputs` contains manual/webhook parameters. For later scripts, `input` is the previous node output, or a `{ nodeKey: output }` map when multiple parents feed a join.

### `conditional`

```jsonc
{
  "expression": "input.body.value > 100 ? 'big' : 'small'"
}
```

The expression's return value becomes the `branchKey`:

- `true`/`false` → `'true'`/`'false'`
- string → that string
- number → `String(number)`
- `null`/`undefined` → `'null'`

Edges leaving a conditional node should set `branchKey` to one of these values.

---

## Variables and Memory

Graph workflows introduce two new variable scopes plus persistent agent memory:

| Scope | Lifetime | Type | Tools available |
|---|---|---|---|
| `workflow_variables` | Forever (until deleted) | property / credential / short_memory | `workflow_get_variable`, `workflow_set_variable`, `workflow_list_variables` |
| `workflow_execution_variables` | One execution | property | `execution_get_variable`, `execution_set_variable`, `execution_list_variables` |
| `agent_short_memories` | Until TTL expires (max 30 days) | KV with TTL | `remember`, `recall`, `list_short_memories`, `forget` |

Agents can read/write all three from inside a graph workflow execution via the new tools above. **Workflow-scoped credentials are not exposed via tools** — use Jinja2 templates (<span v-pre>`{{ credentials.X }}`</span>) inside `http_request` configs and agent prompts instead.

Execution-scoped variables are cascade-deleted when the workflow execution row is deleted, making them safe for ephemeral state like API cursors or counters.

Short memory entries are stored in `agent_short_memories` (`agentId + key`) and persist across executions. They're lazy-evicted: an expired entry is deleted on the next `recall`.

---

## Authoring with the Visual Editor

Open a workflow detail page and use the **Visual Editor** tab. The workflow page keeps authoring and history focused in two tabs: **Visual Editor** and **Executions**. The old block-step list is no longer shown; its controls are part of the visual inspector.

The editor offers:

- **SVG canvas** — drag nodes to position them. Drag empty canvas space to pan around large workflows. Existing sequential steps are loaded as `agent_step` blocks in order: `Start -> Step 1 -> Step 2 -> End`.
- **Auto expanding inspector** — click a block or trigger to expand the inspector; click empty canvas space to collapse it. The inspector can also be expanded or collapsed from the toolbar.
- **Agent-step inspector** — click an agent-step block to edit the same attributes that used to be available in the block-step editor: name, prompt template, agent override, model override, reasoning effort, worker runtime, timeout, and position.
- **Procedural-node inspector** — click HTTP/script/conditional/join blocks to edit their JSON config. Hints are shown for each node type.
- **Trigger elements** — saved workflow triggers render as visual trigger blocks connected to the first agent step. Trigger creation, editing, deletion, and connectivity tests live inside the Visual Editor inspector.
- **Edge list** — quickly add or remove edges and assign `branchKey` for conditional routing.
- **Workflow variables** — add property / credential / short_memory entries that the running workflow can use.

Saving the graph **automatically flips the workflow's `executionMode` to `graph`**. Every saved `agent_step` node is also synchronized back into `workflow_steps`, preserving the prompt template and step-level overrides for version history, snapshots, and the classic step list. Procedural nodes and edges remain graph-only.

At runtime, each `agent_step` node is linked to its synced `workflow_steps` / `step_executions` row. That keeps prompt resolution, reasoning traces, live tool output, and `ask_questions` approvals available from the execution graph detail panel.

If a graph already exists but you want to realign it with the classic ordered steps, use **Rebuild From Steps** in the Visual Editor. This replaces the canvas with the current `workflow_steps` chain before you save.

---

## REST API

| Method & Path | Purpose |
|---|---|
| `GET  /api/workflow-graph/:workflowId/graph` | Fetch nodes + edges + executionMode, plus current `steps` and serialized `triggers`. When no saved graph exists, returns a synthetic graph built from existing sequential steps. |
| `PUT  /api/workflow-graph/:workflowId/graph` | Replace nodes + edges atomically, flip to graph mode, and sync `agent_step` nodes back to `workflow_steps`. Validates exactly 1 start node, edge endpoints, and prompt templates on agent-step nodes. |
| `GET  /api/workflow-graph/:workflowId/variables` | List workflow-scoped variables (credential values redacted) |
| `PUT  /api/workflow-graph/:workflowId/variables` | Upsert a variable (`{ key, value, type, description? }`) |
| `DELETE /api/workflow-graph/:workflowId/variables/:key` | Delete a variable |
| `GET  /api/workflow-graph/executions/:executionId/variables` | Inspect execution-scoped variables |
| `GET  /api/workflow-graph/executions/:executionId/nodes` | List per-node execution rows for audit |
| `GET  /api/workflow-graph/agents/:agentId/short-memories` | List an agent's short-memory entries |
| `PUT  /api/workflow-graph/agents/:agentId/short-memories` | Set a memory entry (`{ key, value, ttlSeconds? }`) |
| `DELETE /api/workflow-graph/agents/:agentId/short-memories/:key` | Forget a memory |

All routes require an authenticated session and enforce workspace scoping (`workspaceId` match unless the caller is `super_admin`).

---

## Example: Mixed Graph

```
[start] → [http_request: fetch user] → [conditional: input.body.tier]
                                            ├── 'gold' → [agent_step: VIP outreach]
                                            └── 'silver' → [script: enqueue notification]
                                                                       │
                                                                       ▼
                                                                    [end]
```

This workflow shows:

- A procedural HTTP fetch driving routing.
- A conditional choosing between an agent and a script branch.
- The script writes to `vars.notification_id` (execution-scoped) using `execution_set_variable`, available to any later node.

---

## Implementation Notes

- The graph engine uses **breadth-first scheduling**. Each iteration groups arrivals by node, executes all "ready" nodes via `Promise.all`, and defers join nodes until every parent has completed or been skipped.
- A safety limit (`MAX_NODE_FIRINGS = 500`) protects against accidental cycles.
- Each node execution is recorded in `node_executions` with `nodeSnapshot` (audit trail) and a `stepExecutionId` link when the node was an `agent_step` (so existing per-step UIs work unchanged).
- Unchosen conditional paths are recorded as `skipped`, so execution graphs do not leave inactive branches looking pending after a run completes.
- Agent prompt templates in graph mode can use <span v-pre>`{{ inputs.* }}`</span> for trigger/manual parameters, <span v-pre>`{{ node_input }}`</span> for the previous node output, <span v-pre>`{{ execution_vars.* }}`</span> for execution-scoped variables, and <span v-pre>`{{ trigger.* }}`</span> for trigger metadata.
- Realtime events: `execution.started`, `node.started`, `node.completed`, `node.skipped`, `node.failed`, `execution.completed`, `execution.failed`.
