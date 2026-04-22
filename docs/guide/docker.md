# Host on Docker

Run **Open Agent Orchestra (OAO)** using pre-built Docker images. No source code checkout or build required.

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Docker Desktop | Latest | Container runtime |
| Docker Compose | v2+ | Multi-container orchestration |

## Quick Start

### 1. Create a Project Directory

```bash
mkdir oao && cd oao
```

### 2. Create `docker-compose.yml`

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: oao
      POSTGRES_PASSWORD: oao_dev
      POSTGRES_DB: agent_db
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U oao -d agent_db"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  oao-api:
    image: oao-core:latest     # or: thfai2000/oao-core:1.6.0
    ports:
      - "4002:4002"
    environment:
      NODE_ENV: production
      AGENT_API_PORT: "4002"
      AGENT_DATABASE_URL: postgresql://oao:oao_dev@postgres:5432/agent_db
      REDIS_URL: redis://redis:6379
      JWT_SECRET: your-jwt-secret-change-in-production
      ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      DEFAULT_AGENT_MODEL: gpt-4.1
      OAO_PLATFORM_API_URL: http://oao-api:4002
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  oao-controller:
    image: oao-core:latest     # same image, different entrypoint
    command: ["node", "--import", "tsx", "packages/oao-api/src/workers/controller.ts"]
    environment:
      NODE_ENV: production
      AGENT_DATABASE_URL: postgresql://oao:oao_dev@postgres:5432/agent_db
      REDIS_URL: redis://redis:6379
      JWT_SECRET: your-jwt-secret-change-in-production
      ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      OAO_PLATFORM_API_URL: http://oao-api:4002
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  oao-agent:
    image: oao-core:latest     # same image, different entrypoint
    command: ["node", "--import", "tsx", "packages/oao-api/src/workers/agent-worker.ts"]
    environment:
      NODE_ENV: production
      AGENT_DATABASE_URL: postgresql://oao:oao_dev@postgres:5432/agent_db
      REDIS_URL: redis://redis:6379
      JWT_SECRET: your-jwt-secret-change-in-production
      ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      OAO_PLATFORM_API_URL: http://oao-api:4002
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  oao-ui:
    image: oao-ui:latest      # or: thfai2000/oao-ui:1.6.0
    ports:
      - "3002:3002"
    environment:
      NODE_ENV: production
      NITRO_PORT: "3002"
    depends_on:
      - oao-api

volumes:
  pgdata:
```

### 3. Create `.env` File

```bash
# .env — place in the same directory as docker-compose.yml
GITHUB_TOKEN=your-github-token-here
```

### 4. Start the Platform

```bash
docker compose up -d
```

This starts:
- **PostgreSQL 16** with pgvector on port 5432
- **Redis 7** on port 6379
- **OAO-API** on port 4002 (via `oao-core` image, default CMD)
- **OAO-Controller** (via `oao-core` image, command override)
- **OAO-Agent Worker** (via `oao-core` image, command override)
- **OAO-UI** on port 3002

### 5. Push Database Schema

The database schema needs to be initialized on first run. You can do this from the OAO-API container:

```bash
docker compose exec oao-api npx drizzle-kit push
```

### 6. Access the Platform

| Service | URL |
|---|---|
| **OAO-UI** | http://localhost:3002 |
| **OAO-API** | http://localhost:4002 |
| **API Health** | http://localhost:4002/health |

Register your first account at http://localhost:3002/register.

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AGENT_DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `JWT_SECRET` | Yes | Secret for JWT signing (change in production) |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for AES-256-GCM encryption |
| `GITHUB_TOKEN` | Yes | GitHub token for Copilot SDK |
| `DEFAULT_AGENT_MODEL` | No | Default model (default: `gpt-4.1`) |
| `LOG_LEVEL` | No | Log level: `debug`, `info`, `warn`, `error` |

### Updating

To update to a new version:

```bash
# Pull latest images
docker compose pull

# Restart with new images
docker compose down && docker compose up -d

# Push schema if there are DB changes
docker compose exec oao-api npx drizzle-kit push
```

## Using Published Images

If images are published to Docker Hub, replace the image references:

```yaml
oao-api:
  image: thfai2000/oao-core:1.6.0

oao-controller:
  image: thfai2000/oao-core:1.6.0

oao-agent:
  image: thfai2000/oao-core:1.6.0

oao-ui:
  image: thfai2000/oao-ui:1.6.0
```

Pull them first:

```bash
docker pull thfai2000/oao-core:1.6.0
docker pull thfai2000/oao-ui:1.6.0
```

## Next Steps

- [Host on Kubernetes](/guide/kubernetes) — Production-like deployment with Helm
- [What is OAO?](/guide/what-is-oao) — Platform overview
- [Agents & Tools](/concepts/agents) — Start building your AI team
