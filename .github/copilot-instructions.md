# Copilot Instructions for OAO — Open Agent Orchestra

## ⚠️ MANDATORY — Read Before Doing Anything

1. **Always read the `docs/` directory first** before making any changes.
2. **Always keep `docs/` up to date** after every change.
3. **Remember user preferences** noted in this file. Do not deviate from stated preferences.

## User Preferences (DO NOT FORGET)

- **No GitHub Actions / CI/CD** — Build and deploy locally only using `build.sh` and `deploy.sh`
- **Helm Charts, NOT Kustomize** — Kubernetes deployment uses Helm charts:
  - `helm/oao-platform/` — OAO Platform chart
- **Local Kubernetes** — Docker Desktop Kubernetes, no cloud providers
- **Pre-build checks** — Before ANY Docker build (`build.sh`), always run these checks first and fix all errors:
  1. `npx tsc --noEmit -p packages/shared/tsconfig.json` — TypeScript check shared
  2. `npx tsc --noEmit -p packages/oao-api/tsconfig.json` — TypeScript check oao-api
  3. `npm run lint` — ESLint across all packages
  4. `npm test` — Run all tests
  Only proceed with `build.sh` after all checks pass.
- **Always rebuild and redeploy after changes** — For any code changes:
  1. Run pre-build checks (TypeScript, ESLint, tests) — fix all errors first
  2. Rebuild Docker images with `build.sh` (bump `BUILD_TAG` using semantic versioning)
  3. Update `coreImage` and `ui.image` tags in `helm/oao-platform/values.yaml`
  4. DB schema push + seed data are applied automatically via Helm hook (`post-install`/`post-upgrade` Job)
  5. Redeploy via `deploy.sh`
  6. After deployment, verify the OAO-UI (http://localhost:3002) is accessible
- **Semantic Versioning** — All versions follow `major.minor.patch` format (e.g. `1.0.0`):
  - **Patch** (`1.0.x`): Bug fixes, typos, small safe changes
  - **Minor** (`1.x.0`): New features, non-breaking changes, new API endpoints
  - **Major** (`x.0.0`): Breaking changes, schema migrations that drop data, API contract changes
  - Always bump the version according to what changed — do NOT always bump major
  - `BUILD_TAG` must match the version (e.g. `BUILD_TAG=1.0.1 bash build.sh`)
  - Update `coreImage` and `ui.image` tags in `helm/oao-platform/values.yaml` to match
  - Publish to DockerHub with `DOCKER_USERNAME=thfai2000 BUILD_TAG=1.0.1 bash publish.sh`

---

## Project Overview

**OAO — Open Agent Orchestra** — An autonomous AI workflow engine powered by the GitHub Copilot SDK. Agents are defined as Git-hosted markdown files with skills, connected to workflows with scheduled/webhook/manual triggers. The platform clones agent repos, reads their instructions, creates Copilot sessions with custom tools, and executes multi-step workflows autonomously.

| Component | Purpose | Port |
|-----------|---------|------|
| OAO-API | Agents, workflows, triggers, executions, Copilot sessions | :4002 |
| OAO-UI | Dashboard for managing agents and viewing executions | :3002 |

## Monorepo Structure

```
packages/
├── shared/       # @oao/shared — auth, utils, types, middleware
├── oao-api/      # @oao/oao-api — Hono v4.6 (port 4002)
├── oao-ui/       # @oao/oao-ui — Nuxt 3 (port 3002)
└── ui-base/      # @oao/ui-base — Shared Nuxt layer (tailwind, auth)

helm/
└── oao-platform/   # Helm chart for OAO Platform

build.sh              # Build Docker images locally
deploy.sh             # Deploy to local K8s via Helm
build-and-deploy-doc.sh  # Build & deploy VitePress docs to GitHub Pages
```

## Technology Stack

- **Runtime**: Node.js >= 24 (LTS), TypeScript strict mode
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
- Routes in `packages/oao-api/src/routes/{resource}.ts` as Hono sub-apps
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

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | Independent auth (email/password/bcrypt) |
| `workspaces` | Multi-tenant workspace isolation |
| `agents` | Git repo config, status, MCP JSON template |
| `agent_files` | DB-stored agent instruction/skill files |
| `workflows` | Template definitions (name, steps, agent, labels) |
| `workflow_steps` | Ordered prompt templates per workflow |
| `workflow_executions` | Execution history with status/output |
| `step_executions` | Per-step output, reasoning trace (JSONB) |
| `triggers` | time_schedule/webhook/event/manual |
| `agent_variables` | 3-tier scoped variables (agent level, AES-256-GCM for credentials) |
| `user_variables` | 3-tier scoped variables (user level) |
| `workspace_variables` | 3-tier scoped variables (workspace level) |
| `webhook_registrations` | HMAC secrets for webhook auth |
| `mcp_server_configs` | Per-agent MCP server configurations |
| `agent_decisions` | Generic audit trail of agent decisions |
| `agent_memories` | Long-term memory with pgvector embeddings |
| `system_events` | Event audit trail for triggers |
| `agent_quota_usage` | Daily token usage tracking per agent |

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
- `DOCKER_USERNAME` — Docker Hub username (for publish.sh)
