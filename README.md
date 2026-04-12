# Agent Orchestration Platform

Autonomous AI workflow engine powered by the **GitHub Copilot SDK**.

Agents are defined as Git-hosted markdown files with skills. The platform clones agent repos, reads their instructions, creates Copilot sessions with custom tools, and executes multi-step workflows autonomously.

## Features

- **Agent Management** — Define agents as Git repos with markdown instructions and skills
- **Workflow Engine** — Multi-step workflows with sequential Copilot sessions
- **9 Built-in Tools** — Self-scheduling, webhook management, decision audit, pgvector memory, HTTP requests with Jinja2
- **MCP Server Integration** — Install and configure any MCP server per-agent for domain-specific tools
- **Trigger System** — Cron schedules, webhooks (HMAC-SHA256), events, manual triggers
- **Memory System** — Long-term agent memory with pgvector semantic search
- **Secure Credentials** — AES-256-GCM encrypted storage, Jinja2 template injection (zero agent exposure)
- **Quota Management** — Daily token usage tracking and limits
- **Real-time Updates** — SSE event streaming for live execution monitoring

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│  Agent UI   │────▶│  Agent API  │────▶│  GitHub Copilot │
│  (Nuxt 3)   │     │  (Hono v4)  │     │     SDK         │
│  port 3002  │     │  port 4002  │     └─────────────────┘
└─────────────┘     │             │
                    │  ┌────────┐ │     ┌─────────────────┐
                    │  │BullMQ  │─┤     │  MCP Servers    │
                    │  │Workers │ │────▶│  (stdio, any)   │
                    │  └────────┘ │     │  user-installed  │
                    └──────┬──────┘     └─────────────────┘
                           │
              ┌────────────┼───────────┐
              │            │           │
        ┌─────────┐ ┌─────────┐ ┌─────────┐
        │PostgreSQL│ │  Redis  │ │Git Repos│
        │+pgvector │ │ (Queue) │ │ (Agent  │
        └─────────┘ └─────────┘ │  Files) │
                                └─────────┘
```

### Tool Architecture

- **9 Built-in tools** operate on agent_db (triggers, decisions, memory, HTTP requests)
- **MCP tools** are loaded per-agent from user-configured MCP servers via Model Context Protocol (stdio transport)
- Each agent can have multiple MCP servers configured, loaded on-demand during workflow execution

### MCP Server Management

Users can install any MCP-compliant server per-agent through the API:

```bash
# Add an MCP server to an agent
POST /api/mcp-servers
{
  "agentId": "...",
  "name": "My MCP Server",
  "command": "node",
  "args": ["--import", "tsx", "path/to/mcp-server.ts"],
  "envMapping": { "API_KEY": "API_KEY", "API_URL": "API_URL" },
  "writeTools": ["dangerous_action"],
  "isEnabled": true
}
```

The `envMapping` maps agent credential keys to environment variables passed to the MCP server process.

## Quick Start

### Prerequisites
- Node.js >= 20
- Docker Desktop with Kubernetes enabled
- Helm 3
- PostgreSQL 16 + Redis 7 (or use the Helm infrastructure chart)

### Development

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your credentials (GITHUB_TOKEN, DATABASE_URL, etc.)

# Run database migrations
npm run db:push

# Start development servers
npm run dev
# Agent API: http://localhost:4002
# Agent UI:  http://localhost:3002
```

### Kubernetes Deployment

```bash
# Build Docker images
BUILD_TAG=v1.0 bash build.sh

# Set up Helm values
cp helm/agent-platform/values.yaml.template helm/agent-platform/values.yaml
# Edit values.yaml with your secrets

# Deploy
bash deploy.sh
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | Hono v4.6, Node.js 20 |
| Frontend | Nuxt 3, shadcn-vue, TailwindCSS |
| Database | PostgreSQL 16 + pgvector, Drizzle ORM |
| Queue | Redis 7 + BullMQ |
| AI | GitHub Copilot SDK (`@github/copilot-sdk`) |
| MCP | `@modelcontextprotocol/sdk` (client, stdio transport) |
| Auth | JWT (jose, HS256) |
| Encryption | AES-256-GCM |
| Deploy | Docker + Helm + Kubernetes |

## Project Structure

```
packages/
├── shared/       # Auth, utils, middleware, validation
├── agent-api/    # Hono API server (port 4002)
├── agent-ui/     # Nuxt 3 dashboard (port 3002)
└── ui-base/      # Shared Nuxt layer (TailwindCSS, auth)

helm/
├── agent-platform/   # Helm chart
└── infrastructure/   # Redis + namespace
```

## License

MIT