# Copilot Instructions for Agent Orchestration Platform

## ⚠️ MANDATORY — Read Before Doing Anything

1. **Always read the `docs/` directory first** before making any changes.
2. **Always keep `docs/` up to date** after every change.
3. **Remember user preferences** noted in this file. Do not deviate from stated preferences.

## User Preferences (DO NOT FORGET)

- **No GitHub Actions / CI/CD** — Build and deploy locally only using `build.sh` and `deploy.sh`
- **Helm Charts, NOT Kustomize** — Kubernetes deployment uses Helm charts:
  - `helm/agent-platform/` — Agent Platform chart
  - `helm/infrastructure/` — Redis + namespace
- **Local Kubernetes** — Docker Desktop Kubernetes, no cloud providers
- **Pre-build checks** — Before ANY Docker build (`build.sh`), always run these checks first and fix all errors:
  1. `npx tsc --noEmit -p packages/shared/tsconfig.json` — TypeScript check shared
  2. `npx tsc --noEmit -p packages/agent-api/tsconfig.json` — TypeScript check agent-api
  3. `npm run lint` — ESLint across all packages
  4. `npm test` — Run all tests
  Only proceed with `build.sh` after all checks pass.
- **Always rebuild and redeploy after changes** — For any code changes:
  1. Run pre-build checks (TypeScript, ESLint, tests) — fix all errors first
  2. Rebuild Docker images with `build.sh` (bump `BUILD_TAG` version)
  3. Update image tags in `helm/agent-platform/values.yaml`
  4. Push DB schema changes if necessary (`drizzle-kit push` via `deploy.sh`)
  5. Redeploy via `deploy.sh`
  6. After deployment, verify the Agent UI (http://localhost:3002) is accessible

---

## Project Overview

**Agent Orchestration Platform** — An autonomous AI workflow engine powered by the GitHub Copilot SDK. Agents are defined as Git-hosted markdown files with skills, connected to workflows with scheduled/webhook/manual triggers. The platform clones agent repos, reads their instructions, creates Copilot sessions with custom tools, and executes multi-step workflows autonomously.

| Component | Purpose | Port |
|-----------|---------|------|
| Agent API | Agents, workflows, triggers, executions, Copilot sessions | :4002 |
| Agent UI | Dashboard for managing agents and viewing executions | :3002 |

## Monorepo Structure

```
packages/
├── shared/       # @ai-trader/shared — auth, utils, types, middleware
├── agent-api/    # @ai-trader/agent-api — Hono v4.6 (port 4002)
├── agent-ui/     # @ai-trader/agent-ui — Nuxt 3 (port 3002)
└── ui-base/      # @ai-trader/ui-base — Shared Nuxt layer (tailwind, auth)

helm/
├── agent-platform/   # Helm chart for Agent Platform
└── infrastructure/   # Redis + namespace

build.sh              # Build Docker images locally
deploy.sh             # Deploy to local K8s via Helm
```

## Technology Stack

- **Runtime**: Node.js >= 20, TypeScript strict mode
- **API**: Hono v4.6 with `@hono/node-server`
- **Frontend**: Nuxt 3 + shadcn-vue + TailwindCSS
- **Database**: PostgreSQL 16 + pgvector, Drizzle ORM
- **Queue/Cache**: Redis 7 + BullMQ
- **Auth**: JWT (jose, HS256, 7-day expiry)
- **Encryption**: AES-256-GCM for credentials at rest
- **Testing**: Vitest
- **AI SDK**: `@github/copilot-sdk` — CopilotClient, defineTool, session-per-agent pattern
- **Code Quality**: ESLint (flat config) + Prettier
- **Deployment**: Docker images → Helm charts → Docker Desktop Kubernetes

## Coding Conventions

### TypeScript
- Strict mode always (`strict: true` in tsconfig)
- Use `interface` for object shapes, `type` for unions/intersections
- Prefer `const` over `let`, never use `var`
- All async functions must have proper error handling (try/catch or .catch())
- Use Zod for runtime validation at boundaries (API inputs, agent tool params)

### Database (Drizzle ORM)
- UUIDs for all primary keys (`uuid('id').defaultRandom().primaryKey()`)
- Monetary values: `decimal(15, 2)` stored/compared as strings, convert to `Number()` only for display
- All tables have `createdAt` timestamp with timezone
- Use `onConflictDoNothing()` or `onConflictDoUpdate()` for upserts
- Write path pattern: `db.transaction(async (tx) => { ... })` for multi-table mutations

### API Routes (Hono)
- Routes in `packages/agent-api/src/routes/{resource}.ts` as Hono sub-apps
- Mounted via `app.route('/api/{resource}', resourceRoutes)` in server.ts
- Return typed JSON responses with `c.json()` and status codes
- Validate query/body params with Zod at the top of every handler
- Pagination: `?page=1&limit=50` pattern, max 200

### Frontend (Vue/Nuxt)
- Use `useFetch()` composable for data fetching
- Tailwind utility classes, no custom CSS unless unavoidable
- shadcn-vue components where available

## Copilot SDK (`@github/copilot-sdk`)
- **Package**: `npm install @github/copilot-sdk`
- **Client**: `new CopilotClient()` → `client.createSession({ model, tools, systemMessage, onPermissionRequest })`
- **Tools**: `defineTool('name', { description, parameters: z.object(...), handler })` — Zod schemas for parameters
- **Sessions**: `session.sendAndWait({ prompt }, timeout)` returns `{ data: { content } }`
- **Events**: `session.on('assistant.message_delta', ...)`, `session.on('tool.execution_start', ...)`
- **Permission**: `approveAll` for agent workflows, custom handler for interactive
- **System message**: `systemMessage: { mode: 'customize', sections: {...}, content: '...' }`
- **Auth**: Uses `GITHUB_TOKEN` env var or GitHub CLI auth
- **Important**: Do NOT use Vercel AI SDK (`ai` package) or `@github/models`. Use `@github/copilot-sdk` only.

## Database Schema (14 tables)

| Table | Purpose |
|-------|---------|
| `users` | Independent auth (email/password/bcrypt) |
| `agents` | Git repo config, status, linked credentials |
| `workflows` | Template definitions (name, steps, agent) |
| `workflow_steps` | Ordered prompt templates per workflow |
| `workflow_executions` | Execution history with status/output |
| `step_executions` | Per-step output, reasoning trace (JSONB) |
| `triggers` | time_schedule/webhook/event/manual |
| `agent_credentials` | AES-256-GCM encrypted key-value store |
| `agent_quota_usage` | Daily token usage tracking per agent |
| `webhook_registrations` | HMAC secrets for webhook auth |
| `mcp_server_configs` | Per-agent MCP server configurations |
| `agent_decisions` | Generic audit trail of agent decisions |
| `agent_memories` | Long-term memory with pgvector embeddings |

## Security Rules
- Input validation: Zod on all API endpoints
- SQL injection: Drizzle ORM parameterized queries only
- Webhook auth: HMAC-SHA256 + 5-minute replay protection + eventId dedup
- Secrets: AES-256-GCM at rest, Pino redaction in logs

## Testing
- Unit tests with Vitest in `tests/` directory per package
- Run all: `npm test` (workspace-wide)
- Guard `serve()` behind `NODE_ENV !== 'test'` in server.ts

## Key Environment Variables
See `.env.example`. Critical:
- `AGENT_DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — Secret for JWT signing/verification
- `ENCRYPTION_KEY` — 32-byte hex for AES-256-GCM
- `GITHUB_TOKEN` — For Copilot SDK
