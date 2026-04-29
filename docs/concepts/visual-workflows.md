# Visual Workflows

OAO workflows are graph workflows. The Visual Editor is the primary authoring surface for both simple linear agent pipelines and richer automations with branching, procedural blocks, and multiple trigger entry points.

The `workflow_steps` table still exists as the ordered projection of `agent_step` nodes for snapshots, version history, and execution details; it is not a separate runtime mode.

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
| `agent_step` | Run an AI agent step (Copilot session, MCP tools, prompt template). | `promptTemplate`, optional `agentId`, `model`, `reasoningEffort` |
| `http_request` | Call an external HTTP API. | `url`, optional `method`, `headers`, `body`, `query`, `jsonPath`, `timeoutMs` |
| `script` | Run a sandboxed JavaScript snippet (Node `vm` — no `process`/`require`). | `source`, optional `timeoutMs` (max 30s) |
| `conditional` | Evaluate a JS expression; routes by `branchKey` on outgoing edges. | `expression` |
| `parallel` | Pass-through fan-out marker. | – |
| `join` | Wait for multiple parents (strategy: `all` by default). | optional `strategy` |

The entry node receives the runtime trigger envelope. Downstream nodes receive an object with `inputs`, `trigger`, `payload`, and `eventData`, so manual-run inputs and webhook payloads are available immediately to the first connected block.

### Per-Trigger Entry Points

Each trigger now has its own **block on the canvas** and points at a single **entry node**. This lets multiple triggers fan into different parts of the same workflow:

```
[Trigger T1] ──► [Step A] ──► [Step B] ──► [Step C]
                                   ▲
[Trigger T2] ──────────────────────┘
```

- Drag a trigger from the left palette onto the canvas to place a new trigger block at that position. Configure that selected block in the Inspector, then choose **Save This Trigger** to create only that trigger record. Multiple trigger blocks can be placed and configured independently; saving one draft removes only that selected draft, and the other unsaved trigger drafts stay on the canvas until they are saved or cancelled.
- Selecting a trigger block opens that trigger's settings directly in the Inspector. The Inspector must not group triggers into a combined trigger tab, list, or collection editor.
- Drag from a trigger's right-edge port to any node to set that node as the trigger's entry point. The connection is rendered as a dashed orange arrow.
- A trigger with no explicit entry node falls back to the first root block by canvas position and node key.
- Trigger position (`positionX`, `positionY`) and `entryNodeKey` are persisted on the `triggers` table, not in `workflow_edges`.

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

In the Visual Editor Inspector, `headers` and `body` are edited as YAML. Headers should be a YAML object with one HTTP header per line:

```yaml
Authorization: Bearer {{ credentials.API_TOKEN }}
Content-Type: application/json
```

The body can be a YAML object, array, or plain string. Objects and arrays are sent as JSON after templates are rendered:

```yaml
ticketId: {{ inputs.ticketId }}
message: Hello from OAO
```

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

- **SVG canvas** — drag nodes to position them. Drag empty canvas space to pan around large workflows. Workflows are persisted as graph blocks; the `workflow_steps` table is maintained as the ordered `agent_step` projection for history and execution details.
- **Auto expanding inspector** — click a block or trigger to expand the inspector; click empty canvas space to collapse it. The inspector can also be expanded or collapsed from the toolbar.
- **Block summaries** — every block shows its most important setting on the canvas, such as prompt/model for agent steps, method + URL for HTTP requests, expression for conditionals, branch count for parallel blocks, and strategy for joins.
- **Agent-step inspector** — click an agent-step block to edit the same attributes that used to be available in the block-step editor: name, prompt template, agent override, model override, reasoning effort, worker runtime, timeout, and position. Prompt templates use compact monospace text so long prompts remain readable in the Inspector.
- **Procedural-node inspector** — click HTTP/script/conditional/join blocks to edit their config. HTTP headers and body use focused YAML textareas; parallel blocks have no config and show their outgoing branch count; join blocks support the `all` and `any` strategies.
- **Trigger blocks** — saved triggers and new trigger drafts render as visual trigger blocks with their key setting on the block, such as schedule cron, exact date/time, webhook path, event name, or Jira JQL/interval. A trigger can optionally name an `entryNodeKey`; otherwise execution starts from the first root block by canvas position and key. Creation, editing, deletion, and connectivity tests are contextual to the selected trigger block in the Inspector, and unsaved draft trigger blocks are preserved until they are saved or cancelled.
- **Edge list** — quickly add or remove edges and assign `branchKey` for conditional routing.
- **Workflow variables** — add property / credential / short_memory entries that the running workflow can use.

Saving the graph persists the new node + edge layout. Every saved `agent_step` node is also synchronized back into `workflow_steps`, preserving the prompt template and step-level overrides for version history, snapshots, and the classic step list. Procedural nodes and edges remain graph-only.

At runtime, each `agent_step` node is linked to its synced `workflow_steps` / `step_executions` row. That keeps prompt resolution, reasoning traces, live tool output, and `ask_questions` approvals available from the execution graph detail panel.

If you want to realign the canvas with the ordered `workflow_steps` projection, use **Rebuild From Steps** in the Visual Editor. This replaces the canvas with the current agent-step chain before you save.

---

## REST API

| Method & Path | Purpose |
|---|---|
| `GET  /api/workflow-graph/:workflowId/graph` | Fetch persisted nodes + edges, plus current `steps` projection and serialized `triggers`. |
| `PUT  /api/workflow-graph/:workflowId/graph` | Replace nodes + edges atomically and sync `agent_step` nodes back to `workflow_steps`. Validates node types, edge endpoints, and prompt templates on agent-step nodes. |
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
