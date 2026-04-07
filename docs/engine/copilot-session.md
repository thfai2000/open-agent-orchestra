# Copilot Session Setup

Each workflow step runs as a Copilot session with two types of tools:

## Built-in Tools (8 tools)

These operate on the agent-orchestra's own database (`agent_db`). Each agent can opt-in/out of individual built-in tools via the `builtinToolsEnabled` configuration.

| Tool | Description |
|------|-------------|
| `schedule_next_wakeup` | Self-scheduling via cron triggers |
| `manage_webhook_trigger` | Webhook lifecycle management |
| `record_decision` | Generic decision audit trail (JSONB) |
| `memory_store` | Store memories with pgvector embeddings |
| `memory_retrieve` | Semantic similarity search over memories |
| `edit_workflow` | Edit workflow triggers and steps |
| `read_variables` | Read agent/user variables (credentials masked) |
| `edit_variables` | Create/update/delete agent variables |

By default, all tools are enabled. Admins and agent owners can toggle individual tools when creating or editing agents.

## MCP Tools (user-configured, per-agent)

Each agent can have multiple MCP servers configured through the `/api/mcp-servers` API. During workflow execution, the engine spawns each enabled MCP server as a child process (stdio transport) and loads its tools dynamically.

**Example**: A trading agent might have a "Trading Platform" MCP server configured that provides 13 trading/market tools. A different agent might have a "GitHub" MCP server for code review tools.

## MCP Server Configuration

MCP servers are configured per-agent in the `mcp_server_configs` table:

| Field | Description |
|-------|-------------|
| `name` | Display name (e.g. "Trading Platform") |
| `command` | Process command (e.g. "node", "npx", "python") |
| `args` | Command arguments (e.g. ["--import", "tsx", "server.ts"]) |
| `envMapping` | Maps agent credential keys → env vars for the process |
| `writeTools` | Tool names that require permission confirmation |
| `isEnabled` | Whether to load this server during execution |

## Tool Loading Flow

```
Workflow step starts
  │
  ▼
1. Create built-in tools (filtered by agent's builtinToolsEnabled config)
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

## Session Setup Process

1. **Clone Git repo** to temp directory
   ```
   git clone --depth 1 --branch {gitBranch} {gitRepoUrl} /tmp/session-{execId}/
   ```

2. **Load credentials** — merge user-level + agent-level credentials (agent overrides user)

3. **Create tools** (built-in + MCP from all configured servers)
   ```typescript
   const builtInTools = createAgentTools(credentials, context, agent.builtinToolsEnabled);
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

## Security

- **Webhook HMAC**: SHA-256 signature verification, 5-min replay window, event-id dedup
- **Credentials**: AES-256-GCM encrypted at rest, decrypted only in-memory during execution
- **Agent isolation**: Redis lock ensures one session per agent at a time
- **Git tokens**: Encrypted, used only for repo clone, never logged
- **Input validation**: Zod schemas on all API inputs
- **Session cleanup**: Temp directories destroyed after execution
