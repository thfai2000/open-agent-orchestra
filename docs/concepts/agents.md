# Agents

An **agent** is an AI personality defined as a markdown file — either hosted in a Git repository or managed directly in the platform's database editor.

## Agent Sources

| Source Type | Description | Best For |
|---|---|---|
| **GitHub Repo** | Clone from any Git repo at execution time | Version-controlled agents, team collaboration |
| **Database** | Create and edit markdown files directly in the UI | Quick prototyping, simple agents |

## Agent Markdown Structure

An agent's main file is a markdown document that serves as the system message for the Copilot session:

```markdown
# Data Analyst Agent

You are a professional data analyst specializing in business intelligence.

## Personality
- Data-driven and analytical
- Conservative risk assessment
- Clear, actionable recommendations

## Guidelines
- Always cite data sources
- Never recommend more than 5% portfolio allocation to a single asset
- Use tables for comparative analysis
```

## Skills

Skills are additional markdown files that extend the agent's knowledge:

```
my-agent/
├── agent.md           # Main agent file
├── skills/
│   ├── market-analysis.md
│   ├── risk-management.md
│   └── report-writing.md
```

Configure via:
- **Skills Paths** — Explicit list of skill file paths relative to the repo root
- **Skills Directory** — Load all `.md` files from a directory automatically

### Skills Paths Example

Specify individual files when you need fine-grained control over which skills are loaded:

```json
["skills/market-analysis.md", "skills/risk-management.md", "docs/api-reference.md"]
```

This loads exactly those three files, even if they are in different directories. Useful when the agent only needs a specific subset of knowledge.

### Skills Directory Example

Specify a directory to auto-discover all `.md` files:

```
skills/
```

This loads every `.md` file found under `skills/` recursively — ideal when the agent should have access to an entire knowledge base without maintaining an explicit list.

## Agent Scoping

| Scope | Visibility | Who Can Create |
|---|---|---|
| **User** (default) | Only the creator (or admins) | Any user except `view_user` |
| **Workspace** | All workspace members | Admins only |

Scope is set at creation time and **cannot be changed** afterward.

## Authentication

Agent authentication is configured with **credential variables**. Manual token entry is not used in the agent create/edit forms.

### Git Authentication

For Git checkout, choose one of these options:

- **No Authentication (Public Repo)** — for public repositories
- **Credential variable** — the checkout flow automatically applies the selected credential subtype

Supported Git credential subtypes:

- **GitHub Token** or **Secret Text** — used as token-based HTTPS authentication
- **GitHub App** — OAO exchanges the stored App credentials for an installation token at checkout time
- **User Account** — uses the stored username/password pair for HTTPS authentication

Git authentication is only used for repository access. It does not affect GitHub Copilot sessions.

### Copilot Authentication

Copilot authentication is configured separately from Git checkout.

- **System default** — uses the server-level `GITHUB_TOKEN`
- **Credential variable** — overrides the Copilot token for that agent's sessions

Use a **GitHub Token** credential (or compatible Secret Text credential) for Copilot authentication.

### Database File Content

When an agent uses **Database Storage**, you can manage the **Agent/Skill File Content** directly in the create/edit flow.

- The first root-level markdown file is treated as the main agent instruction file.
- Additional markdown files can be stored as skills.

> 📖 **See also:** [Variables](/concepts/variables) — Manage properties and credentials across all three scopes (agent → user → workspace)

## Version History

Agents keep immutable version history.

- The latest editable page lives at `/{workspace}/agents/:id`
- Historical snapshots live at `/{workspace}/agents/:id/v/:version`
- Historical pages are read-only and expose the exact files and agent-scoped variables that belonged to that version

Agent-scoped variable changes also participate in agent version history. Creating, updating, or deleting an agent variable increments the agent version and stores a historical snapshot before the change is applied.

## Tools

### Built-in Tools

Every agent has access to 10 built-in platform tools (individually toggleable):

| Tool | Description |
|---|---|
| `schedule_next_workflow_execution` | Schedule the next workflow run |
| `manage_webhook_trigger` | Create/update/delete webhook triggers |
| `record_decision` | Log decisions to the audit trail |
| `memory_store` | Store long-term memories with vector embeddings |
| `memory_retrieve` | Retrieve relevant memories by semantic search |
| `edit_workflow` | Modify workflow steps programmatically |
| `read_variables` | Read properties and credentials |
| `edit_variables` | Create/update variables |
| `simple_http_request` | Curl-like HTTP requests with Jinja2 templating on all arguments |

By default, all tools are enabled. Admins and agent owners can toggle individual tools when creating or editing agents.

### Simple HTTP Request Tool

The `simple_http_request` tool provides curl-like HTTP request capabilities with all the fine-grained control of popular HTTP clients:

- All HTTP methods (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS)
- Custom headers, query parameters, cookies
- Basic and Bearer authentication
- Request body (JSON, form data, raw text)
- Timeout control, redirect following
- SSL verification toggle
- Response size limits
- Response header inclusion

**Jinja2 Templating:** All string arguments support Jinja2 template syntax. Available variables: <span v-pre>`{{ properties.KEY }}`</span>, <span v-pre>`{{ credentials.KEY }}`</span>, <span v-pre>`{{ env.KEY }}`</span>. This allows agents to dynamically construct URLs, headers, and bodies using agent variables.

### MCP Servers {#mcp}

Agents can connect to [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers for custom tool access. Each MCP server is configured with:

| Field | Description | Example |
|---|---|---|
| **Name** | Display name | `Analytics Platform` |
| **Command** | Executable to spawn | `node`, `python`, `npx` |
| **Args** | Command arguments | `["server.js", "--port", "3000"]` |
| **Env Mapping** | Map credential variables → env vars | `{"API_KEY": "SERVICE_API_KEY"}` |
| **Write Tools** | Tools requiring permission approval | `["send_notification"]` |

```mermaid
sequenceDiagram
    participant Session as Copilot Session
    participant MCP as MCP Client
    participant Server as MCP Server Process

    Session->>MCP: Connect to MCP server
    MCP->>Server: Spawn child process (stdio)
    Server-->>MCP: List available tools
    MCP-->>Session: Register tools in session

    Note over Session,Server: During execution...
    Session->>MCP: Agent calls MCP tool
    MCP->>Server: Forward tool call
    Server-->>MCP: Tool result
    MCP-->>Session: Return to agent

    Note over Session,Server: After execution...
    Session->>MCP: Cleanup
    MCP->>Server: Kill child process
```

#### Environment Variable Mapping

MCP servers often need credentials. Use env mapping to securely inject them:

```json
{
  "envMapping": {
    "SERVICE_API_URL": "SERVICE_API_URL",
    "SERVICE_API_KEY": "SERVICE_API_KEY"
  }
}
```

The left side is the env var name passed to the MCP server process. The right side is the credential variable key resolved from the agent's credential hierarchy.

#### Write Tool Permissions

Tools listed in `writeTools` require explicit permission approval before execution. This prevents agents from making destructive calls without authorization.

### MCP JSON Template (Jinja2)

In addition to DB-configured MCP servers, agents can define an **MCP JSON Template** — a Jinja2 template that renders to a `mcp.json` configuration at execution time. This is useful for dynamically configuring MCP servers with variable substitution.

**Template variables:**
- <span v-pre>`{{ properties.KEY }}`</span> — Agent/user/workspace property values
- <span v-pre>`{{ credentials.KEY }}`</span> — Agent/user/workspace credential values

**Example template:**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "{{ credentials.GITHUB_TOKEN }}"
      }
    },
    "custom-api": {
      "command": "node",
      "args": ["{{ properties.MCP_SERVER_PATH }}"],
      "env": {
        "API_KEY": "{{ credentials.API_KEY }}",
        "API_URL": "{{ properties.API_URL }}"
      }
    }
  }
}
```

The rendered JSON must contain a `mcpServers` key mapping server names to `{ command, args?, env? }` objects.

### Tool Loading Flow

```mermaid
graph TB
    START[Workflow step starts] --> BUILTIN[Create built-in tools<br/>filtered by agent config]
    BUILTIN --> LOAD[Load MCP server configs]
    LOAD --> FOREACH{For each enabled<br/>MCP server}
    FOREACH --> RESOLVE[Resolve env vars<br/>from agent credentials]
    RESOLVE --> SPAWN[Spawn MCP subprocess<br/>stdio transport]
    SPAWN --> LIST[List available tools]
    LIST --> CONVERT[Convert to Copilot SDK tools]
    CONVERT --> FOREACH
    FOREACH -->|done| INIT[Initialize Copilot session<br/>with merged tools]
    INIT --> EXEC[Execute session]
    EXEC --> CLEANUP[Cleanup all MCP processes]
```
