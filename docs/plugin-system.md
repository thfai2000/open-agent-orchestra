# Plugin System — Specification & Development Guide

## Overview

The **Plugin System** extends the Agent Orchestration Platform by allowing Git-hosted plugin repositories to add **MCP servers**, **tools** (scripts), and **skills** to agent Copilot sessions. Plugins are managed centrally by admins and selectively enabled per agent by users.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                Admin (Plugin Registry)                   │
│  • Register Git repo URL as a plugin                    │
│  • Allow / disallow plugins globally                    │
│  • View plugin manifest & contents                      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Agent Owner (Per-Agent Toggle)              │
│  • View list of allowed plugins                         │
│  • Enable / disable any allowed plugin for their agent  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│            Workflow Execution (Runtime)                   │
│  1. For each enabled plugin on the agent:               │
│     a. git clone <plugin repo> into /tmp/plugins/<id>   │
│     b. Read plugin.json manifest                        │
│     c. Merge MCP servers, tools, skills into session    │
│  2. Start Copilot session with merged configuration     │
└─────────────────────────────────────────────────────────┘
```

---

## Plugin Repository Structure (Pattern)

A plugin is a **Git repository** that follows this folder structure:

```
my-plugin-repo/
├── plugin.json           # REQUIRED — Plugin manifest
├── README.md             # Optional — Plugin documentation
├── tools/                # Optional — Custom tool scripts
│   ├── tool-a.ts         # Each file exports a tool definition
│   └── tool-b.ts
├── skills/               # Optional — Skill markdown files
│   ├── skill-a.md        # Each .md is injected as a skill
│   └── skill-b.md
└── mcp-servers/          # Optional — MCP server definitions
    └── servers.json      # JSON array of MCP server configs
```

### `plugin.json` — Manifest (REQUIRED)

```json
{
  "name": "my-awesome-plugin",
  "version": "1.0.0",
  "description": "Adds web scraping and analysis tools to agents",
  "author": "Your Name",
  "homepage": "https://github.com/your-org/my-awesome-plugin",
  "tools": [
    {
      "name": "web_scraper",
      "description": "Scrape a web page and return its content",
      "scriptPath": "tools/web-scraper.ts",
      "parameters": {
        "type": "object",
        "properties": {
          "url": { "type": "string", "description": "URL to scrape" },
          "selector": { "type": "string", "description": "CSS selector to extract" }
        },
        "required": ["url"]
      }
    }
  ],
  "skills": [
    "skills/web-analysis.md",
    "skills/data-extraction.md"
  ],
  "mcpServers": [
    {
      "name": "playwright-mcp",
      "description": "Browser automation via Playwright MCP server",
      "command": "npx",
      "args": ["@anthropic/mcp-playwright"],
      "envMapping": {
        "BROWSER_API_KEY": "PLAYWRIGHT_KEY"
      },
      "writeTools": ["navigate", "click", "fill"]
    }
  ]
}
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique plugin identifier (lowercase, hyphens) |
| `version` | string | Yes | Semver version |
| `description` | string | Yes | Human-readable description |
| `author` | string | No | Plugin author |
| `homepage` | string | No | URL for documentation |
| `tools` | array | No | List of tool definitions |
| `tools[].name` | string | Yes | Tool name (unique within plugin) |
| `tools[].description` | string | Yes | Tool description for Copilot |
| `tools[].scriptPath` | string | Yes | Relative path to script file |
| `tools[].parameters` | object | Yes | JSON Schema for tool parameters |
| `skills` | array | No | Relative paths to skill .md files |
| `mcpServers` | array | No | MCP server configurations |
| `mcpServers[].name` | string | Yes | Server display name |
| `mcpServers[].command` | string | Yes | Command to spawn (e.g., "npx") |
| `mcpServers[].args` | array | Yes | Command arguments |
| `mcpServers[].envMapping` | object | No | Agent credential key → env var mapping |
| `mcpServers[].writeTools` | array | No | Tool names requiring permission |

---

## Tool Script Format

Tool scripts in `tools/` are TypeScript/JavaScript files that export a handler function. They are loaded dynamically at runtime and wrapped as Copilot SDK tools.

```typescript
// tools/web-scraper.ts
import type { PluginToolHandler } from '@agent-orchestra/plugin-types';

export const handler: PluginToolHandler = async (params, context) => {
  const { url, selector } = params;
  
  // Tool implementation
  const response = await fetch(url);
  const html = await response.text();
  
  return {
    content: html.substring(0, 5000),
    url,
    status: response.status,
  };
};
```

At runtime, the platform:
1. Reads the tool definition from `plugin.json`
2. Dynamically imports the script file
3. Wraps it as a `defineTool(name, { description, parameters, handler })` call
4. Adds it to the Copilot session tools array

---

## Skill Files

Skill `.md` files are plain markdown documents containing domain knowledge. They are appended to the agent's system message under `## Plugin Skills`.

```markdown
<!-- skills/web-analysis.md -->
# Web Analysis Skill

You have expertise in analyzing web pages. When asked to analyze a website:
1. Use the `web_scraper` tool to fetch the page content
2. Extract key information using CSS selectors
3. Summarize findings in a structured format
```

---

## MCP Server Definitions

MCP servers defined in `plugin.json` follow the same format as the platform's `mcp_server_configs` table. Each server is spawned as a child process during the Copilot session.

The `envMapping` field maps **agent credential keys** to **environment variable names** passed to the MCP server process, reusing the platform's existing credential system.

---

## Database Schema

### `plugins` Table (Admin-Managed Registry)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(100) | Display name |
| description | TEXT | Plugin description |
| gitRepoUrl | VARCHAR(500) | Git repository URL |
| gitBranch | VARCHAR(100) | Branch to clone (default: main) |
| githubTokenEncrypted | TEXT | Optional encrypted token for private repos |
| manifestCache | JSONB | Cached plugin.json contents |
| isAllowed | BOOLEAN | Admin toggle — allowed for users (default: false) |
| createdBy | UUID | Admin user who registered the plugin |
| createdAt | TIMESTAMP | Creation timestamp |
| updatedAt | TIMESTAMP | Last update timestamp |

### `agent_plugins` Table (Per-Agent Toggle)

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| agentId | UUID | FK → agents.id |
| pluginId | UUID | FK → plugins.id |
| isEnabled | BOOLEAN | User toggle (default: true) |
| createdAt | TIMESTAMP | When plugin was enabled for agent |

---

## API Endpoints

### Admin Plugin Management (`/api/plugins`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/plugins` | User | List all allowed plugins (admin sees all) |
| POST | `/api/plugins` | Admin | Register a new plugin |
| GET | `/api/plugins/:id` | User | Plugin detail with manifest |
| PUT | `/api/plugins/:id` | Admin | Update plugin (name, repo, allowed status) |
| DELETE | `/api/plugins/:id` | Admin | Remove plugin from registry |
| POST | `/api/plugins/:id/sync` | Admin | Re-clone and refresh manifest cache |

### Agent Plugin Toggles (`/api/agents/:agentId/plugins`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/agents/:id/plugins` | Owner | List plugins with enabled status for agent |
| PUT | `/api/agents/:id/plugins/:pluginId` | Owner | Enable/disable plugin for agent |

---

## Runtime Flow

When a workflow step executes:

1. **Load enabled plugins**: Query `agent_plugins` JOIN `plugins` for the resolved agent
2. **Clone plugin repos**: For each enabled plugin, `git clone --depth 1` into a temp directory
3. **Read manifests**: Parse `plugin.json` from each cloned repo
4. **Merge skills**: Append plugin skill markdowns to the system message
5. **Merge tools**: Dynamically import tool scripts, wrap as Copilot SDK tools
6. **Merge MCP servers**: Spawn MCP server processes with resolved env vars
7. **Execute session**: Run Copilot session with all merged tools, skills, and MCP servers
8. **Cleanup**: Remove temp directories after session completes

---

## How to Create a Plugin

### Step 1: Create a Git Repository

```bash
mkdir my-agent-plugin && cd my-agent-plugin
git init
```

### Step 2: Create `plugin.json`

```json
{
  "name": "my-agent-plugin",
  "version": "1.0.0",
  "description": "Description of what this plugin does",
  "skills": ["skills/my-skill.md"],
  "tools": [],
  "mcpServers": []
}
```

### Step 3: Add Skills (Optional)

```bash
mkdir skills
echo "# My Skill\nYou can do X, Y, Z..." > skills/my-skill.md
```

### Step 4: Add Tools (Optional)

```bash
mkdir tools
cat > tools/my-tool.ts << 'EOF'
export const handler = async (params, context) => {
  return { result: `Processed: ${params.input}` };
};
EOF
```

Update `plugin.json` to include the tool definition with parameters schema.

### Step 5: Add MCP Servers (Optional)

Add MCP server entries to `plugin.json` under the `mcpServers` array.

### Step 6: Push to Git

```bash
git add . && git commit -m "Initial plugin" && git push
```

### Step 7: Register as Admin

In the Agent UI, navigate to **Plugins** and click **Register Plugin**, providing the Git repo URL.

### Step 8: Enable for Agents

On any agent detail page, toggle desired plugins in the **Plugins** section.

---

## Security Considerations

- Plugin repos are cloned in isolated temp directories, cleaned up after each session
- Tool scripts run in the Node.js process — only trusted plugins should be allowed
- Admin must explicitly allow a plugin before users can enable it
- Private repos require GitHub token (encrypted at rest with AES-256-GCM)
- MCP server env vars are resolved from the agent's existing encrypted credentials
