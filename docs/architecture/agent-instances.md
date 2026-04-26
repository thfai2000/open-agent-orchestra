# Agent Instances

Following a **Jenkins Controller + Agent** pattern, workflow steps are executed by **Agent Instances**. Each workflow now chooses its **Worker Runtime**: `static` or `ephemeral`.

For the system-wide architecture and component diagram, see [System Overview](/architecture/overview).

## Static Instances (Docker / VM / K8s)

Pre-provisioned, long-running worker processes. Each static instance connects to a BullMQ queue (`agent-step-execution`) and picks up step execution jobs. Works in **any environment** — Docker Compose, VM, or Kubernetes.

- Registered in the `agent_instances` database table on startup
- Send periodic heartbeats (15s interval); marked offline if stale (60s threshold)
- Cleaned up by the controller when the last heartbeat is older than 24 hours by default
- Scale horizontally by running more worker containers/processes
- Managed via the Instances page in the UI
- Selected by workflows whose `workerRuntime` is `static`

```mermaid
sequenceDiagram
    participant Q as Step Queue
    participant AW as Static Agent Worker
    participant DB as PostgreSQL
    participant CS as Copilot Session

    Q->>AW: Dequeue step job
    AW->>DB: Load step config + 3-tier variables
    AW->>CS: Create Copilot session
    Note over CS: Agent instructions + skills<br/>+ tools + MCP servers
    CS-->>AW: Step output
    AW->>DB: Store step result
    Note over AW: Worker stays alive,<br/>picks up next job
```

## Ephemeral Instances (Kubernetes only)

Short-lived instances created on-demand per workflow step. The controller creates a K8s pod, the pod executes one step, writes results, and exits:

- Requires Kubernetes with RBAC for pod management
- Provides strong workload isolation (each step = separate container)
- Pod creation starts immediately for each ephemeral step; readiness is bounded by the workflow's step allocation timeout
- Pods are auto-cleaned after completion
- Selected by workflows whose `workerRuntime` is `ephemeral`

```mermaid
sequenceDiagram
    participant W as Controller Worker
    participant K8s as Kubernetes API
    participant EP as Ephemeral Instance
    participant DB as PostgreSQL
    participant CS as Copilot Session

    W->>K8s: Create instance (pod)
    K8s->>EP: Instance starts
    EP->>DB: Load step config + variables
    EP->>CS: Create Copilot session
    CS-->>EP: Step output
    EP->>DB: Store step result
    EP->>EP: Exit
    W->>K8s: Poll status → completed
    W->>K8s: Delete instance
```

## Communication & Ports

Agent instances (both static and ephemeral) **do not expose any inbound network ports**. All communication uses outbound connections to shared infrastructure:

| Channel | Protocol | Direction | Purpose |
|---|---|---|---|
| **BullMQ (Redis)** | Redis `:6379` | Outbound | Receive step jobs from the `agent-step-execution` queue |
| **PostgreSQL** | TCP `:5432` | Outbound | Read step config, write execution results, heartbeat updates |
| **GitHub Copilot API** | HTTPS `:443` | Outbound | Create Copilot sessions, send prompts, receive responses |
| **MCP Servers** | stdio (child process) | Local | Spawn MCP servers as subprocesses within the same container |

**Status polling** does not use HTTP health endpoints. Instead:

| Instance Type | Status Mechanism |
|---|---|
| **Static Worker** | Writes `lastHeartbeatAt` to `agent_instances` table every 15s. Marked offline if stale (>60s). The API reads this table for the Instances UI page. |
| **Ephemeral Instance** | Controller polls the Kubernetes API (`GET /api/v1/namespaces/.../pods/{name}`) to check pod phase (`Running` → `Succeeded` / `Failed`). Pods are deleted after results are written. |

The controller also performs background maintenance while it holds the leader lock. Static instances whose heartbeat has been absent for more than `STALE_STATIC_INSTANCE_CLEANUP_MS` (default: 24 hours) are removed from `agent_instances`, so old worker rows do not accumulate after VM, Docker, or Kubernetes restarts. Live workers refresh `lastHeartbeatAt` every 15 seconds, and graceful shutdown marks the instance offline before the cleanup window starts.

> **Firewall note:** Agent instances only need **outbound** access to PostgreSQL, Redis, and `api.githubcopilot.com`. No inbound ports need to be opened.

## Scaling Strategy

| Component | Scaling Approach | Notes |
|---|---|---|
| **Controller (Poller)** | Leader election — 1 active + N standby | Only one instance polls; extras provide automatic failover |
| **Controller (Worker)** | BullMQ concurrency per instance | Each instance processes 1 job at a time; add instances for throughput |
| **Static Agent Workers** | Horizontal scaling | Add more worker containers; each listens on the same BullMQ queue |
| **Ephemeral Instances** | Dynamic provisioning | Each ephemeral step creates its own pod and waits on pod readiness within the workflow allocation timeout |
| **OAO-API** | Horizontal scaling (HPA) | Stateless HTTP handlers; scale freely behind a load balancer |
| **OAO-UI** | Horizontal scaling (HPA) | Stateless Nuxt SSR; scale freely |

## Docker Images

OAO ships as **two Docker images**:

| Image | Contents | Roles |
|---|---|---|
| `oao-core` | Node.js backend (shared + oao-api packages) | API, Controller, Agent Worker — selected by CMD at runtime |
| `oao-ui` | Nuxt 3 SSR frontend | UI only |

To select the role at runtime, override the container command:

```bash
# API (default CMD)
node --import tsx packages/oao-api/src/server.ts

# Controller
node --import tsx packages/oao-api/src/workers/controller.ts

# Static Agent Worker
node --import tsx packages/oao-api/src/workers/agent-worker.ts
```
