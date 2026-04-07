# System Architecture

## Overview

The Agent Orchestration Platform is an autonomous AI workflow engine powered by the GitHub Copilot SDK. Agents are defined as Git-hosted markdown files with skills, connected to workflows with scheduled/webhook/manual triggers. The platform clones agent repos, reads their instructions, creates Copilot sessions with custom tools, and executes multi-step workflows autonomously.

## Components

| Component | Purpose | Port |
|---|---|---|
| Agent API | Backend — agents, workflows, triggers, executions, Copilot sessions | :4002 |
| Agent UI | Frontend — dashboard for managing agents and viewing executions | :3002 |

## Monorepo Structure

```
packages/
├── shared/       # @ai-trader/shared — auth, utils, types, middleware
├── agent-api/    # @ai-trader/agent-api — Hono v4.6 API server
├── agent-ui/     # @ai-trader/agent-ui — Nuxt 3 frontend
└── ui-base/      # @ai-trader/ui-base — Shared Nuxt layer

helm/
├── agent-platform/   # Helm chart for Agent Platform
└── infrastructure/   # Redis + namespace
```

## Technology Stack

- **Runtime**: Node.js >= 20, TypeScript strict mode
- **API**: Hono v4.6 with `@hono/node-server`
- **Frontend**: Nuxt 3 + shadcn-vue + TailwindCSS
- **Database**: PostgreSQL 16 + pgvector, Drizzle ORM
- **Queue/Cache**: Redis 7 + BullMQ
- **Auth**: JWT (jose, HS256, 7-day expiry) with workspace context
- **Encryption**: AES-256-GCM for credentials at rest
- **AI SDK**: `@github/copilot-sdk` — CopilotClient, defineTool, session-per-agent
- **Deployment**: Docker images → Helm charts → Docker Desktop Kubernetes

## Request Flow

1. User makes request via Agent UI (Nuxt 3 SSR)
2. Nuxt server proxy forwards `/api/*` to Agent API (:4002)
3. Agent API authenticates via JWT middleware (extracts userId, role, workspaceId)
4. All queries are scoped to the user's workspace (workspace isolation)
5. Workflow execution enqueues BullMQ jobs → workflow worker picks up
6. Worker creates Copilot sessions via `@github/copilot-sdk`, runs steps sequentially
7. Results stored in PostgreSQL, credit/quota usage tracked per workspace

## URL Routing Pattern

All UI routes are workspace-scoped: `/<workspace-slug>/<page>`

- **Login**: `/<workspace>/login` — users login to their workspace
- **Dashboard**: `/<workspace>/` — workspace dashboard
- **Resources**: `/<workspace>/agents`, `/<workspace>/workflows`, etc.
- **Super Admin**: accesses platform via `/default/workspaces`
