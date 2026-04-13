# Host on Kubernetes

Deploy **Open Agent Orchestra (OAO)** to Kubernetes using Helm charts. No source code checkout or build required.

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Kubernetes cluster | 1.25+ | Docker Desktop K8s, Minikube, or any cluster |
| Helm | >= 3 | Package manager for Kubernetes |
| kubectl | Latest | Kubernetes CLI |
| NGINX Ingress Controller | Latest | Routes traffic to services (recommended) |

> **Tip:** On Docker Desktop, enable the built-in Kubernetes cluster and install the NGINX Ingress Controller:
> ```bash
> helm upgrade --install ingress-nginx ingress-nginx \
>   --repo https://kubernetes.github.io/ingress-nginx \
>   --namespace ingress-nginx --create-namespace
> ```

## Quick Start

### 1. Add the Helm Repository

```bash
helm repo add oao https://thfai2000.github.io/open-agent-orchestra/charts
helm repo update
```

Or, if you have the chart locally:

```bash
git clone https://github.com/thfai2000/open-agent-orchestra.git
cd open-agent-orchestra
```

### 2. Create Values File

Create a `my-values.yaml` with your configuration:

```yaml
namespace: open-agent-orchestra

ingress:
  enabled: true
  host: oao.local       # Add to /etc/hosts → 127.0.0.1  oao.local
  className: nginx
  annotations: {}

coreImage: thfai2000/oao-core:1.6.0   # Single image for API, Controller, Agent Worker

api:
  replicas: 1
  port: 4002
  resources:
    requests:
      memory: 256Mi
      cpu: 200m
    limits:
      memory: 512Mi
      cpu: 500m

ui:
  image: thfai2000/oao-ui:1.6.0
  replicas: 1
  port: 3002

controller:
  replicas: 1

agentPod:
  image: thfai2000/oao-core:1.6.0   # Image used for ephemeral agent instances
  resources:
    requests:
      memory: 256Mi
      cpu: 200m
    limits:
      memory: 512Mi
      cpu: 500m

postgres:
  image: pgvector/pgvector:pg16
  storage: 10Gi

redis:
  image: redis:7-alpine

config:
  NODE_ENV: production
  LOG_LEVEL: info
  DEFAULT_AGENT_MODEL: gpt-4.1

secrets:
  POSTGRES_PASSWORD: "change-me-in-production"
  AGENT_DATABASE_URL: "postgresql://oao:change-me-in-production@postgres:5432/agent_db"
  REDIS_URL: "redis://redis:6379"
  JWT_SECRET: "your-jwt-secret-change-in-production"
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  GITHUB_TOKEN: "your-github-token"
```

### 3. Deploy with Helm

```bash
# From Helm repo:
helm upgrade --install oao-platform oao/oao-platform \
  -f my-values.yaml \
  --namespace open-agent-orchestra --create-namespace

# Or from local chart:
helm upgrade --install oao-platform helm/oao-platform \
  -f my-values.yaml \
  --namespace open-agent-orchestra --create-namespace
```

### 4. Wait for Pods

```bash
kubectl -n open-agent-orchestra rollout status deployment/redis --timeout=60s
kubectl -n open-agent-orchestra rollout status statefulset/postgres --timeout=120s
kubectl -n open-agent-orchestra rollout status deployment/oao-api --timeout=120s
kubectl -n open-agent-orchestra rollout status deployment/oao-ui --timeout=120s
```

> **Note:** Database schema and seed data are applied automatically via a Helm `post-install`/`post-upgrade` hook Job.
> The hook waits for PostgreSQL to be ready, then runs `drizzle-kit push` followed by the seed script. No manual step needed.
> On first deploy, a **superadmin** account is created with a random password. Check the job logs:
> ```bash
> kubectl -n open-agent-orchestra logs job/oao-platform-db-migrate | grep -A 5 "SUPERADMIN"
> ```
> **Change the superadmin password immediately** via Settings → Change Password.

### 5. Access the Platform

With ingress enabled (default), add the host to `/etc/hosts`:

```bash
echo "127.0.0.1  oao.local" | sudo tee -a /etc/hosts
```

| Service | URL |
|---|---|
| **OAO Platform** | http://oao.local |
| **OAO API** | http://oao.local/api |

Register at http://oao.local/register, or log in with the superadmin account created during first deploy.

::: details Without Ingress (port-forward fallback)
Set `ingress.enabled: false` in your values, then:
```bash
kubectl -n open-agent-orchestra port-forward svc/oao-ui 3002:3002 &
kubectl -n open-agent-orchestra port-forward svc/oao-api 4002:4002 &
```
Access at http://localhost:3002 and http://localhost:4002.
:::

## What Gets Deployed

```mermaid
graph TB
    subgraph "open-agent-orchestra namespace"
        ING[Ingress<br/>oao.local]
        API[OAO-API<br/>Deployment :4002]
        UI[OAO-UI<br/>Deployment :3002]
        CTRL[OAO-Controller<br/>Deployment]
        AP["Agent Instances<br/>(ephemeral pods)"]
        PG[PostgreSQL<br/>StatefulSet :5432]
        RD[Redis<br/>Deployment :6379]
    end

    ING -->|/api| API
    ING -->|/| UI
    API --> PG
    API --> RD
    CTRL --> PG
    CTRL --> RD
    CTRL -->|"create/delete"| AP
    AP --> PG
```

## Updating

```bash
# Update image tags in my-values.yaml, then:
helm upgrade --install oao-platform oao/oao-platform \
  -f my-values.yaml \
  --namespace open-agent-orchestra
```

Database schema changes are applied automatically by the Helm post-upgrade hook.

## Useful Commands

```bash
# Pod status
kubectl -n open-agent-orchestra get pods

# OAO-API logs
kubectl -n open-agent-orchestra logs -f deployment/oao-api

# Scheduler logs
kubectl -n open-agent-orchestra logs -f deployment/oao-controller

# Uninstall
helm uninstall oao-platform -n open-agent-orchestra
```

## Development

For local development with Docker Desktop Kubernetes, use `deploy.sh` which runs pre-flight checks and deploys via Helm:

```bash
# Build images first
BUILD_TAG=1.6.0 bash build.sh

# Deploy locally
bash deploy.sh
```

::: warning
`deploy.sh` is a development convenience script. For production deployments, use `helm upgrade --install` directly as shown above.
:::

## Helm Chart Repository

The OAO Helm chart is available via our chart repository:

```bash
helm repo add oao https://thfai2000.github.io/open-agent-orchestra/charts
helm repo update
helm search repo oao
```

## Next Steps

- [Build & Deploy](/guide/build-and-deploy) — Build from source and customize
- [AI Security](/concepts/security) — Configure credential approval
- [Workflows](/concepts/workflows) — Build your first multi-agent workflow
