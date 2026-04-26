# Build & Deploy

Build **Open Agent Orchestra (OAO)** from source code for local development or customization.

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Node.js | >= 24 | Runtime for API and build tools |
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

# GitHub Copilot SDK / BYOK auth
GITHUB_TOKEN=your-github-token
DEFAULT_LLM_API_KEY=

# Public API origin used for Jira change-notification callbacks
PUBLIC_API_BASE_URL=http://localhost:4002

# Base URL used by the bundled OAO Platform MCP server
OAO_PLATFORM_API_URL=http://localhost:4002
```

For Docker Desktop Kubernetes with ingress, set `PUBLIC_API_BASE_URL=http://oao.local`. Jira change-notification triggers need this value because Atlassian must reach the OAO API callback endpoint from outside the controller loop.

For Kubernetes or Docker Compose workers, set `OAO_PLATFORM_API_URL` to an internal service URL such as `http://oao-api:4002` so spawned MCP subprocesses can reach the API from worker/controller containers.

Agent runtime allocation and stale static instance cleanup can be tuned with these optional values:

| Variable | Default | Purpose |
|---|---:|---|
| `DEFAULT_STEP_ALLOCATION_TIMEOUT_SECONDS` | `300` | Fallback seconds a step can stay pending while waiting for static worker pickup or ephemeral pod readiness. |
| `AGENT_ALLOCATION_RETRY_MS` | `3000` | Retry interval for dynamic agent capacity and pod provisioning checks. |
| `AGENT_INSTANCE_MAINTENANCE_INTERVAL_MS` | `3600000` | How often the controller runs stale instance cleanup while it is leader. |
| `STALE_STATIC_INSTANCE_CLEANUP_MS` | `86400000` | Removes static agent instance rows whose last heartbeat is older than this age. |

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

# Coverage summary + HTML report
npm run test:coverage
```

If you plan to run Playwright end-to-end tests after a Docker Desktop reset, cache cleanup, or a new machine setup, reinstall the browser binaries first:

```bash
npx playwright install chromium
```

Jira integration E2E coverage includes local-safe credential/trigger configuration checks by default. The live Jira polling case is opt-in because it creates and deletes a real Jira issue with the description `Get a Weekly Weather Report`. To enable it, add these values to `.env` or export them before `npm run test:e2e`:

```ini
RUN_LIVE_JIRA_E2E=1
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=jira-bot@example.com
JIRA_API_TOKEN=your-jira-api-token
JIRA_PROJECT_KEY=OAO
JIRA_ISSUE_TYPE=Task
```

You can also use `TESTING_JIRA_BASE_URL`, `TESTING_JIRA_EMAIL`, `TESTING_JIRA_API_TOKEN`, `TESTING_JIRA_PROJECT_KEY`, and `TESTING_JIRA_ISSUE_TYPE` when you want live-test settings to stay separate from runtime Jira settings.

The live test stores the Jira API token as an OAO workspace credential variable, creates a Jira polling workflow filtered by a unique JQL label, creates the Jira issue, and waits for the controller to enqueue a workflow execution containing that issue payload.

## 4. Build Docker Images

```bash
BUILD_TAG=1.30.13 ./build.sh
```

This builds two images:

| Image | Description |
|---|---|
| `oao-core:1.30.13` | Single backend image for all roles (API, Controller, Agent Worker) |
| `oao-ui:1.30.13` | OAO-UI (Nuxt 3 dashboard) |

## 5. Deploy

### Option A: Deploy to Docker Desktop Kubernetes

Update image tags in `helm/oao-platform/values.yaml`:

```yaml
coreImage: oao-core:1.30.13

ui:
  image: oao-ui:1.30.13

config:
  PUBLIC_API_BASE_URL: "http://oao.local"
```

Run the deploy script (development convenience):

```bash
./deploy.sh
```

`deploy.sh` now waits for the local Redis, PostgreSQL, API, UI, controller, and agent-worker rollouts to become ready before it recreates the `http://oao.local` bridge.

This will:
1. Run pre-flight checks (kubectl, helm, cluster connectivity)
2. Deploy via `helm upgrade --install` to the `open-agent-orchestra` namespace
3. Auto-push database schema via Helm hook (Drizzle `post-install`/`post-upgrade` Job)
4. Start a local `oao.local` access bridge for Docker Desktop by port-forwarding the UI/API and running a tiny Docker reverse proxy on port `80`

For local Docker Desktop Kubernetes, the Helm migration hook reuses `coreImage` with `imagePullPolicy: IfNotPresent`, so a locally built `oao-core:<tag>` image can be used directly without a separate manual image import step.

> **Note:** `deploy.sh` is a development convenience wrapper. For production, use `helm upgrade --install` directly — see [Host on Kubernetes](/guide/kubernetes).

After deployment, access the platform via ingress at **http://oao.local** (requires `/etc/hosts` entry and NGINX Ingress Controller). See [Host on Kubernetes](/guide/kubernetes) for setup details.

For Docker Desktop on macOS, `deploy.sh` now manages the local host bridge automatically because the cluster's internal load-balancer IP is not consistently reachable from the macOS host. The bridge keeps `http://oao.local` on port `80` working by forwarding to the live UI and API services, and a background monitor restarts dead UI or API port-forwards if they drop later.

If `oao.local` stops responding after a VS Code restart, stale local bridge state, or a terminated `kubectl port-forward`, you do **not** need to redeploy. Recreate the bridge from the repo root with:

```bash
# start or repair the bridge
bash port-forward.sh start

# or force a clean restart when the saved PIDs are stale
bash port-forward.sh restart

# inspect the bridge state
bash port-forward.sh status

# inspect recent bridge logs
bash port-forward.sh logs
```

Equivalent npm shortcuts are also available:

```bash
npm run local:access
npm run local:access:restart
npm run local:access:status
npm run local:access:stop
```

### Option B: Use Docker Compose

See [Host on Docker](/guide/docker) for the compose file, but use your locally built images:

```yaml
oao-api:
  image: oao-core:latest    # locally built — default CMD starts API

oao-controller:
  image: oao-core:latest    # same image, command override selects controller role

oao-agent:
  image: oao-core:latest    # same image, command override selects agent worker role

oao-ui:
  image: oao-ui:latest      # locally built
```

## 6. Seed Default Data (First Deploy)

Seed data (default workspace, models, and superadmin account) is applied automatically via the Helm `post-install`/`post-upgrade` hook after schema push.

If `secrets.SUPERADMIN_PASSWORD` is empty, the first deploy creates a random password. To check it:

```bash
kubectl -n open-agent-orchestra logs job/oao-platform-db-migrate | grep -A 5 "SUPERADMIN"
```

For local development, you can make the superadmin password deterministic through Helm values or deploy overrides:

```bash
bash deploy.sh \
  --set-string secrets.SUPERADMIN_PASSWORD='Admin@OAO2026' \
  --set-string secrets.SUPERADMIN_FORCE_PASSWORD_RESET=true
```

`SUPERADMIN_FORCE_PASSWORD_RESET=true` is required only when the superadmin already exists and you intentionally want the next Helm hook run to reset its password. For a private local override file, keep it outside Git, for example `.oao-local/superadmin-values.yaml`, then deploy with `bash deploy.sh -f .oao-local/superadmin-values.yaml`.

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

For the `oao.local` bridge used by the default local Helm deployment, prefer the helper script above instead of running the raw port-forwards manually.

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
npm run test:coverage

# 2. Bump version and rebuild
BUILD_TAG=1.30.13 ./build.sh

# 3. Update values.yaml with new tag
# ...edit helm/oao-platform/values.yaml...

# 4. Redeploy
./deploy.sh

# 5. Verify
curl http://localhost:4002/health
```

## Test Audit Report

Use the audit report script when you need a reviewable record of what the automated tests verify and the evidence they produced:

```bash
npm run test:report
```

The script runs:

- Shared package Vitest unit tests with JSON and HTML coverage output
- OAO API Vitest API/integration/functional tests with JSON and HTML coverage output
- Chromium Playwright E2E tests with JSON, HTML report, traces, and screenshot artifacts

Outputs are written under `test-results/audit-report/`:

| Artifact | Purpose |
|---|---|
| `test-audit-report.md` | Human-readable audit summary with each test case, status, and verification intent |
| `test-audit-report.html` | Standalone HTML audit summary with totals, coverage, screenshots, traces, and per-test verification intent |
| `shared-coverage/index.html` | Shared package HTML coverage report |
| `oao-api-coverage/index.html` | API package HTML coverage report |
| `playwright-html/index.html` | Standard Playwright HTML report with browser evidence |
| `playwright-artifacts/` | Screenshots, traces, and other per-test evidence |
| `logs/` | Raw command logs for each test layer |

For repeatable audit evidence, run it after the local Helm stack is reachable at `http://oao.local`.
The browser audit runs the cluster-backed Playwright tests serially against the shared local deployment. It includes longer cross-entity flows, such as agent CRUD, conversations, workflow CRUD, manual runs, and cleanup, so those scenarios keep full trace and screenshot capture enabled and may run longer than smaller smoke checks.

## Release Versioning & Git Tags

Treat the application release version as a single semantic version shared across:

- the root workspace `package.json`
- each workspace package version
- `helm/oao-platform/Chart.yaml`
- `helm/oao-platform/values.yaml` image tags

To bump all of those together locally, use:

```bash
node scripts/release-version.mjs --bump patch
```

Or set an explicit version:

```bash
node scripts/release-version.mjs --set 1.30.13
```

Do **not** auto-tag every merge to `main`. A semantic version bump is a release decision, not a merge event. Use the manual GitHub Actions workflow **Create Release Tag** after the intended release commit is already on `main`.

That workflow:

1. reads the release version already committed in the root `package.json`
2. validates that `vX.Y.Z` does not already exist
3. creates and pushes an annotated Git tag as `vX.Y.Z`

Because GitHub's default `GITHUB_TOKEN` does not trigger downstream workflows from a workflow-created tag push, the repository must define an Actions secret named `RELEASE_TOKEN` with a personal access token that can push tags and trigger the Pages workflow.

The application images and local Kubernetes deployment still remain **local-only** using `build.sh`, `deploy.sh`, and `publish.sh`.

## Versioned Docs on GitHub Pages

The GitHub Pages workflow rebuilds the docs site from scratch on each `main` push or release tag event:

- `latest` is built from the current `main` branch and published at the site root
- release snapshots are rebuilt by checking out the allowed Git tags in temporary worktrees
- the allow-list is hardcoded in `.github/workflows/deploy-pages.yml` via `DOCS_TAGS`
- a version only appears in the dropdown after the matching Git tag actually exists, so the site never advertises a broken version URL

Published version snapshots live under paths such as:

```text
/open-agent-orchestra/1.30.10/
/open-agent-orchestra/1.30.9/
```

You can reproduce the Pages build locally with:

```bash
npm run docs:site
```

## Publishing to Docker Hub

To publish your images and Helm chart to Docker Hub:

```bash
DOCKER_USERNAME=myuser BUILD_TAG=1.17.1 ./publish.sh
```

This will:
1. Build Docker images (`oao-core`, `oao-ui`)
2. Tag for Docker Hub (`myuser/oao-core:v1.0`, `myuser/oao-ui:v1.0`)
3. Push images to Docker Hub
4. Package and push the Helm chart to OCI registry

Set `SKIP_BUILD=true` to push existing local images without rebuilding.

## Next Steps

- [File Structure](/guide/file-structure) — Understand the codebase layout
- [Architecture Overview](/architecture/overview) — System design deep dive
- [Technologies](/architecture/technologies) — Stack details and design decisions
