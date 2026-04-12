# Build & Deploy

Build **Open Agent Orchestra (OAO)** from source code for local development or customization.

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Node.js | >= 20 | Runtime for API and build tools |
| Docker Desktop | Latest | Container runtime + optional Kubernetes |
| Git | Latest | Clone the repository |
| Helm | >= 3 | Kubernetes deployment (optional) |

## 1. Clone & Install

```bash
git clone https://github.com/thfai2000/open-agent-orchestra.git
cd open-agent-orchestra
npm install
```

## 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```ini
# Database
AGENT_DATABASE_URL=postgresql://oao:oao_dev@localhost:15432/agent_db

# Redis
REDIS_URL=redis://localhost:6379

# Security — generate unique values for production
JWT_SECRET=your-jwt-secret-here
ENCRYPTION_KEY=your-32-byte-hex-key-here

# GitHub Copilot SDK
GITHUB_TOKEN=your-github-token
```

## 3. Pre-Build Checks

Before **any** Docker build, always run these checks and fix all errors:

```bash
# TypeScript checks
npx tsc --noEmit -p packages/shared/tsconfig.json
npx tsc --noEmit -p packages/oao-api/tsconfig.json

# Lint
npm run lint

# Tests
npm test
```

## 4. Build Docker Images

```bash
BUILD_TAG=1.0.0 ./build.sh
```

This builds two images:

| Image | Port | Description |
|---|---|---|
| `oao-api:1.0.0` | 4002 | OAO-API (REST API + BullMQ worker) |
| `oao-ui:1.0.0` | 3002 | OAO-UI (Nuxt 3 dashboard) |

## 5. Deploy

### Option A: Deploy to Docker Desktop Kubernetes

Update image tags in `helm/oao-platform/values.yaml`:

```yaml
api:
  image: oao-api:1.0.0

ui:
  image: oao-ui:1.0.0
```

Run the deploy script (development convenience):

```bash
./deploy.sh
```

This will:
1. Run pre-flight checks (kubectl, helm, cluster connectivity)
2. Deploy via `helm upgrade --install` to the `open-agent-orchestra` namespace
3. Auto-push database schema via Helm hook (Drizzle `post-install`/`post-upgrade` Job)

> **Note:** `deploy.sh` is a development convenience wrapper. For production, use `helm upgrade --install` directly — see [Host on Kubernetes](/guide/kubernetes).

After deployment, access the platform via ingress at **http://oao.local** (requires `/etc/hosts` entry and NGINX Ingress Controller). See [Host on Kubernetes](/guide/kubernetes) for setup details.

### Option B: Use Docker Compose

See [Host on Docker](/guide/docker) for the compose file, but use your locally built images:

```yaml
oao-api:
  image: oao-api:v1.0    # locally built

oao-ui:
  image: oao-ui:v1.0     # locally built
```

## 6. Seed Default Data (First Deploy)

Seed data (default workspace, models, and superadmin account) is applied automatically via the Helm `post-install`/`post-upgrade` hook after schema push.

To check the superadmin password:

```bash
kubectl -n open-agent-orchestra logs job/oao-platform-db-migrate | grep -A 5 "SUPERADMIN"
```

**Important:** Change the superadmin password immediately after first login via **Settings → Change Password**.

For manual seeding (local development):

```bash
cd packages/oao-api
AGENT_DATABASE_URL="postgresql://oao:oao_dev@localhost:15432/agent_db" \
  npx tsx src/database/seed.ts
```

## 7. Access the Platform

With ingress enabled (default):

| Service | URL |
|---|---|
| **OAO Platform** | http://oao.local |
| **OAO API** | http://oao.local/api |

Without ingress (port-forward fallback):

```bash
kubectl -n open-agent-orchestra port-forward svc/oao-ui 3002:3002 &
kubectl -n open-agent-orchestra port-forward svc/oao-api 4002:4002 &
```

| Service | URL |
|---|---|
| **OAO-UI** | http://localhost:3002 |
| **OAO-API** | http://localhost:4002 |

## Local Development (Hot Reload)

For development without Docker:

```bash
# Terminal 1: Start the API (requires PostgreSQL + Redis running)
npm run dev:api

# Terminal 2: Start the UI
npm run dev:ui
```

Or both at once:

```bash
npm run dev
```

## Redeployment Cycle

After code changes, always follow this cycle:

```bash
# 1. Pre-build checks — fix ALL errors first
npx tsc --noEmit -p packages/shared/tsconfig.json
npx tsc --noEmit -p packages/oao-api/tsconfig.json
npm run lint && npm test

# 2. Bump version and rebuild
BUILD_TAG=v1.1 ./build.sh

# 3. Update values.yaml with new tag
# ...edit helm/oao-platform/values.yaml...

# 4. Redeploy
./deploy.sh

# 5. Verify
curl http://localhost:4002/health
```

## Publishing to Docker Hub

To publish your images and Helm chart to Docker Hub:

```bash
DOCKER_USERNAME=myuser BUILD_TAG=v1.0 ./publish.sh
```

This will:
1. Build Docker images (`oao-api`, `oao-ui`)
2. Tag for Docker Hub (`myuser/oao-api:v1.0`, `myuser/oao-ui:v1.0`)
3. Push images to Docker Hub
4. Package and push the Helm chart to OCI registry

Set `SKIP_BUILD=true` to push existing local images without rebuilding.

## Next Steps

- [File Structure](/guide/file-structure) — Understand the codebase layout
- [Architecture Overview](/architecture/overview) — System design deep dive
- [Technologies](/architecture/technologies) — Stack details and design decisions
