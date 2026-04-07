# Agent Orchestration Platform — Documentation

Organized documentation for the Agent Orchestration Platform.

## Directory Structure

| File/Folder | Description |
|---|---|
| [concepts.md](concepts.md) | Core concepts: agents, workflows, steps, triggers, scoping, retry |
| [architecture/overview.md](architecture/overview.md) | System architecture, components, tech stack |
| [architecture/workspaces.md](architecture/workspaces.md) | Multi-tenant workspace isolation & RBAC |
| [database/schema.md](database/schema.md) | Database tables, relationships, enums |
| [engine/workflow-engine.md](engine/workflow-engine.md) | Workflow execution engine, variable hierarchy, retry, error handling |
| [engine/copilot-session.md](engine/copilot-session.md) | Copilot session setup, built-in tools, MCP tools, security |
| [engine/workers.md](engine/workers.md) | BullMQ workflow worker & scheduler |
| [api/routes.md](api/routes.md) | API endpoint reference |
| [api/variables.md](api/variables.md) | Variable system with priority rules |
| [ui/pages.md](ui/pages.md) | UI pages, layout, execution detail view |
| [plugin-system.md](plugin-system.md) | Plugin specification & development guide |
| [deployment/local.md](deployment/local.md) | Build, deploy, and operate locally |

## Quick Start

1. Install: `npm install`
2. Set `.env` (see `.env.example`)
3. Build: `./build.sh`
4. Deploy: `./deploy.sh`
5. Open: http://localhost:3002/default/login
