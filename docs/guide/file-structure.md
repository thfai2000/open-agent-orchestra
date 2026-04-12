# File Structure

Understanding the OAO monorepo layout and how the pieces fit together.

## Top-Level Structure

```
github-copilot-agent-orchestra/
├── build.sh              # Build Docker images locally
├── deploy.sh             # Deploy to local K8s via Helm
├── publish.sh            # Publish images + Helm chart to Docker Hub
├── Dockerfile.api        # OAO-API Docker build
├── Dockerfile.ui         # OAO-UI Docker build
├── package.json          # Root workspace config + docs scripts
├── tsconfig.json         # Base TypeScript config
├── eslint.config.mjs     # ESLint flat config
│
├── packages/             # npm workspaces
│   ├── shared/           # Shared library (auth, utils, middleware)
│   ├── agent-api/        # OAO-API — REST API + workflow engine
│   ├── agent-ui/         # OAO-UI — Nuxt 3 dashboard
│   └── ui-base/          # Shared Nuxt layer (Tailwind, auth)
│
├── helm/                 # Kubernetes deployment
│   └── agent-platform/   # Helm chart for the full platform
│
├── docs/                 # VitePress documentation site
│   └── .vitepress/       # VitePress configuration
│
└── migrations/           # SQL migration scripts
```

## Packages

### `packages/shared/` — `@ai-trader/shared`

Shared utilities used by all other packages.

```
shared/
├── src/
│   ├── index.ts          # Re-exports everything
│   ├── openapi.ts        # OpenAPI spec generation
│   ├── app/              # createApp() — Hono app factory
│   ├── auth/             # JWT helpers, encrypt/decrypt (AES-256-GCM)
│   ├── middleware/        # Auth middleware, rate limiting, CORS
│   ├── sse/              # Server-Sent Events utilities
│   └── utils/            # Logging (Pino), validation schemas
├── tests/                # Unit tests
├── package.json
└── tsconfig.json
```

**Key exports**: `createApp`, `authMiddleware`, `encrypt`, `decrypt`, `createLogger`, `uuidSchema`, `emailSchema`, `passwordSchema`

### `packages/agent-api/` — `@ai-trader/agent-api`

The core backend: REST API, workflow engine, Copilot sessions, job workers.

```
agent-api/
├── src/
│   ├── server.ts         # Hono app setup, route mounting, serve()
│   ├── database/
│   │   ├── index.ts      # Drizzle DB connection
│   │   └── schema.ts     # All table/enum definitions (Drizzle ORM)
│   ├── routes/
│   │   ├── admin.ts      # User/model/quota/security management
│   │   ├── agents.ts     # Agent CRUD
│   │   ├── auth.ts       # Register, login, me
│   │   ├── executions.ts # View/cancel/retry executions
│   │   ├── events.ts     # System event log
│   │   ├── mcp-servers.ts # MCP server config CRUD
│   │   ├── plugins.ts    # Plugin management
│   │   ├── quota.ts      # Quota stats
│   │   ├── supervisor.ts # Emergency stop/resume
│   │   ├── triggers.ts   # Trigger CRUD
│   │   ├── variables.ts  # Variable CRUD (3-tier)
│   │   ├── webhooks.ts   # Incoming webhook handler
│   │   ├── workflows.ts  # Workflow CRUD + step updates
│   │   ├── workspaces.ts # Workspace CRUD
│   │   └── agent-files.ts # DB-stored agent file management
│   ├── services/
│   │   ├── workflow-engine.ts  # Core: enqueue, execute, retry, Copilot sessions
│   │   ├── agent-tools.ts     # 9 built-in tools (defineTool)
│   │   ├── agent-workspace.ts # Git clone + skill loading
│   │   ├── mcp-client.ts      # MCP server spawn + tool registration
│   │   ├── plugin-loader.ts   # Plugin repo clone + manifest parsing
│   │   ├── system-events.ts   # Event emission + audit trail
│   │   ├── embedding-service.ts # pgvector embeddings
│   │   └── redis.ts           # Redis connection, BullMQ queue factory
│   └── workers/
│       └── workflow-worker.ts # BullMQ job processor
├── tests/                     # Vitest unit tests
├── drizzle.config.ts          # Drizzle Kit config
├── package.json
└── tsconfig.json
```

**Key files to know**:
- **`schema.ts`** — All database tables. The source of truth for the data model.
- **`workflow-engine.ts`** — The heart of the system. Handles execution flow, Copilot sessions, credential resolution, tool merging.
- **`agent-tools.ts`** — Defines the 9 built-in tools available to agents.

### `packages/agent-ui/` — `@ai-trader/agent-ui`

Nuxt 3 frontend for managing the platform.

```
agent-ui/
├── app.vue               # Root Vue component
├── nuxt.config.ts        # Nuxt configuration
├── pages/
│   ├── index.vue         # Root dashboard
│   ├── login.vue         # Login page
│   ├── register.vue      # Registration page
│   └── [workspace]/      # Dynamic workspace routing
│       ├── index.vue     # Workspace home
│       ├── agents.vue    # Agent management
│       ├── workflows.vue # Workflow builder
│       ├── executions.vue # Execution history
│       ├── variables.vue # Variable management
│       ├── plugins.vue   # Plugin registry
│       ├── workspaces.vue # Workspace management (super_admin)
│       └── admin/
│           ├── users.vue     # User role management
│           ├── models.vue    # Model & credit costs
│           ├── quotas.vue    # Quota settings
│           └── security.vue  # Security settings
├── composables/
│   └── useAuth.ts        # JWT token management
├── middleware/
│   └── auth.global.ts    # Route guards
├── components/
│   └── ui/               # shadcn-vue components
├── lib/
│   └── utils.ts          # Utility functions
└── server/
    └── api/              # Nuxt server routes (proxy)
```

### `packages/ui-base/` — `@ai-trader/ui-base`

Shared Nuxt layer for Tailwind config, auth composables, and route guards.

## Helm Charts

```
helm/
└── agent-platform/
    ├── Chart.yaml        # Chart metadata (name: oao-platform)
    ├── values.yaml       # Deployment configuration
    ├── values.yaml.template  # Template for values.yaml
    └── templates/
        ├── api-deployment.yaml       # OAO-API Deployment
        ├── ui-deployment.yaml        # OAO-UI Deployment
        ├── scheduler-deployment.yaml # Scheduler Deployment
        ├── postgres.yaml             # PostgreSQL StatefulSet
        ├── redis.yaml                # Redis Deployment
        ├── configmap.yaml            # Environment config
        ├── secret.yaml               # Encrypted secrets
        ├── ingress.yaml              # Optional Ingress
        └── worker-hpa.yaml           # Optional HPA
```

## Scripts

| Script | Purpose |
|---|---|
| `build.sh` | Build Docker images (`oao-api`, `oao-ui`) |
| `deploy.sh` | Deploy to Docker Desktop K8s via Helm |
| `publish.sh` | Push images + Helm chart to Docker Hub |
| `npm run dev` | Start both API and UI in dev mode |
| `npm run dev:api` | Start OAO-API only (hot reload) |
| `npm run dev:ui` | Start OAO-UI only (hot reload) |
| `npm run lint` | ESLint across all packages |
| `npm test` | Vitest across all packages |
| `npm run docs:dev` | VitePress dev server for docs |
| `npm run docs:build` | Build static docs site |

## Next Steps

- [Architecture Overview](/architecture/overview) — How the components interact
- [Database Schema](/database/schema) — All tables and relationships
- [API Endpoints](/api/routes) — Complete API reference
