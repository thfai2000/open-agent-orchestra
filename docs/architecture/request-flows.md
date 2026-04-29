# Request & Trigger Flows

How data flows through the OAO platform for user requests and automated triggers. For the component overview, see [System Overview](/architecture/overview).

## Request Flow

```mermaid
sequenceDiagram
    participant User as Browser
    participant UI as OAO-UI
    participant API as OAO-API
    participant DB as PostgreSQL

    User->>UI: Navigate to /default/agents
    UI->>API: GET /api/agents
    API->>API: Verify JWT + extract workspaceId
    API->>DB: SELECT * FROM agents WHERE workspace_id = ?
    DB-->>API: Agent rows
    API-->>UI: JSON response
    UI-->>User: Render page
```

## Trigger Flow

Webhook and event triggers enter through `system_events`; manual trigger runs enqueue immediately; scheduled triggers are polled by the Controller.

```mermaid
sequenceDiagram
    participant Src as Trigger Source
    participant API as OAO-API
    participant DB as PostgreSQL (system_events)
    participant Ctrl as Controller (Leader)
    participant Q as BullMQ Queue
    participant W as Worker
    participant AI as Agent Instances

    alt Webhook
        Src->>API: POST /api/webhooks/:path
        API->>DB: Insert webhook.received event
        API-->>Src: 202 Accepted
    else Manual Run (UI)
        Src->>API: POST /api/triggers/:id/run
        API->>Q: Enqueue workflow-execution job
        API-->>Src: 202 Accepted {executionId,status}
    else Cron / Datetime
        Note over Ctrl: Poll triggers table directly
    else System Event
        Note over DB: Events emitted by API mutations
    end

    Ctrl->>DB: Poll system_events + triggers
    Ctrl->>Q: Enqueue workflow-execution job
    Q->>W: Dequeue
    W->>AI: Run agent_step nodes when reached
    AI->>DB: Write step and node results
```

## URL Routing

All UI routes are workspace-scoped: `/{workspace-slug}/{page}`

| Route | Purpose |
|---|---|
| `/{ws}/` | Dashboard |
| `/{ws}/agents` | Agent management |
| `/{ws}/workflows` | Workflow management |
| `/{ws}/executions` | Execution history |
| `/{ws}/instances` | Agent instance monitoring |
| `/{ws}/events` | System event viewer |
| `/{ws}/variables` | Variable management |
| `/{ws}/admin/users` | User administration |
| `/{ws}/admin/models` | Model registry |
| `/{ws}/admin/rate-limits` | Rate limit settings |
| `/{ws}/workspaces` | Workspace management (super_admin) |
| `/{ws}/settings/tokens` | Personal Access Tokens |
