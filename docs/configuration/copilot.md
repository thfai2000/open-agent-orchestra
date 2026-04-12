# Copilot Sessions

Each workflow step creates a fresh [GitHub Copilot SDK](https://github.com/features/copilot) session with the agent's personality, skills, and tools.

## Session Lifecycle

```mermaid
sequenceDiagram
    participant Engine as Workflow Engine
    participant SDK as Copilot SDK
    participant Session as Copilot Session
    participant Tools as Tool Handlers

    Engine->>SDK: new CopilotClient()
    Engine->>Engine: Build system message<br/>(agent markdown + skills)
    Engine->>Engine: Prepare tools<br/>(built-in + MCP + plugin)
    Engine->>SDK: client.createSession({model, tools, systemMessage})
    SDK-->>Session: Session created
    Engine->>Session: session.sendAndWait({prompt}, timeout)

    loop Tool calls
        Session->>Tools: Execute tool
        Tools-->>Session: Tool result
    end

    Session-->>Engine: Final response
    Engine->>Engine: Cleanup MCP + temp dirs
```

## System Message Construction

The system message is assembled from:
1. **Agent markdown** — the main `.md` file (personality, instructions)
2. **Skills** — additional `.md` files appended as `## Agent Skills` section
3. **Plugin skills** — skills from enabled plugins (if any)

```typescript
const systemContent = `${agentMarkdown}${skillsContent}`;
// Passed as: systemMessage: { mode: 'customize', content: systemContent }
```

## Session Setup Process

```mermaid
graph TB
    CLONE[1. Clone Git repo<br/>to temp directory] --> CREDS[2. Load & merge credentials<br/>workspace → user → agent]
    CREDS --> TOOLS[3. Create tools<br/>built-in + MCP + plugin]
    TOOLS --> INIT[4. Initialize Copilot session<br/>model + tools + system message]
    INIT --> EXEC[5. Execute session<br/>capture output + reasoning]
    EXEC --> CLEAN[6. Cleanup<br/>kill MCP processes + rm temp dirs]
```

## Tool Types

### Built-in Tools (9)

Platform tools created with `defineTool()` from the Copilot SDK:

| Tool | Parameters | Description |
|---|---|---|
| `schedule_next_workflow_execution` | `delayMinutes`, `userInput` | Schedule next execution |
| `manage_webhook_trigger` | `action`, `path`, etc. | CRUD webhook triggers |
| `record_decision` | `decision`, `reasoning`, `confidence` | Audit trail entries |
| `memory_store` | `content`, `category`, `tags` | Store with vector embeddings |
| `memory_retrieve` | `query`, `limit`, `category` | Semantic search retrieval |
| `edit_workflow` | `stepUpdates[]` | Modify workflow steps |
| `read_variables` | `scope`, `variableType` | Read variables |
| `edit_variables` | `key`, `value`, `scope`, etc. | Create/update variables |

### MCP Tools

Loaded from configured MCP servers at session start:

```mermaid
graph LR
    Config[MCP Server Config] --> Spawn[Spawn child process<br/>stdio transport]
    Spawn --> List[List available tools]
    List --> Register[Register in session]
    Register --> Use[Agent uses tools]
    Use --> Cleanup[Kill child process]
```

### Plugin Tools

Loaded from enabled plugin Git repositories:
1. Clone plugin repos → parse `plugin.json` → load tool scripts → register as session tools

## Permission Handling

For agent workflows, all tool calls are auto-approved:

```typescript
onPermissionRequest: approveAll
```

Write tools (configured per MCP server via `writeTools`) receive explicit permission through the handler.

## Model Configuration

The model is resolved per step:
1. **Step-level model** (if specified)
2. **Workflow default model** (fallback)
3. **Platform default** (`DEFAULT_AGENT_MODEL` env var, defaults to `gpt-4.1`)

## Key Environment Variables

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Token for GitHub Copilot SDK authentication |
| `DEFAULT_AGENT_MODEL` | Default model when none specified (default: `gpt-4.1`) |
| `AGENT_DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Secret for JWT signing/verification |
| `ENCRYPTION_KEY` | 64-char hex string for AES-256-GCM credential encryption |

## Security

- **Webhook HMAC** — SHA-256 signature verification, 5-min replay window, event-id dedup
- **Credentials** — AES-256-GCM encrypted at rest, decrypted only in-memory during execution
- **Agent isolation** — Redis lock ensures one session per agent at a time
- **Git tokens** — Encrypted, used only for repo clone, never logged
- **Input validation** — Zod schemas on all API inputs
- **Session cleanup** — Temp directories destroyed after execution, MCP processes killed
