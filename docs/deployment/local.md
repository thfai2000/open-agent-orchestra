# Local Build & Deployment

## Prerequisites

- Node.js >= 20
- Docker Desktop with Kubernetes enabled
- Helm 3
- PostgreSQL 16 (via Helm or external)
- Redis 7 (via Helm)

## Environment

Copy `.env.example` to `.env` and set:

| Variable | Description |
|---|---|
| `AGENT_DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | 32+ char secret for JWT signing |
| `ENCRYPTION_KEY` | 64-char hex string for AES-256-GCM |
| `GITHUB_TOKEN` | GitHub token for Copilot SDK |

## Pre-Build Checks

Always run before building Docker images:

```bash
npx tsc --noEmit -p packages/shared/tsconfig.json
npx tsc --noEmit -p packages/agent-api/tsconfig.json
npm run lint
npm test
```

## Build

```bash
./build.sh    # Builds Docker images for api and ui
```

Bump `BUILD_TAG` in `build.sh` for each release. Update `helm/agent-platform/values.yaml` with the new tag.

## Deploy

```bash
./deploy.sh   # Deploys to local K8s via Helm
```

This pushes DB schema via `drizzle-kit push` if needed, then runs `helm upgrade --install`.

## Verify

After deployment:
- Agent UI: http://localhost:3002/default/login
- Agent API health: http://localhost:4002/health
- API docs: http://localhost:4002/api/openapi.json

## Database Seed

The seed script creates:
- Default Workspace (slug: `default`, cannot be deleted)
- Sample agent, workflow, and triggers

Run via: `npx tsx packages/agent-api/src/database/seed.ts`
