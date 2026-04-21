# Use Cases

Real-world scenarios showing how OAO connects AI agents to your existing workflows. Each example includes a conceptual architecture diagram, the trigger type, and the workflow steps involved.

## 1. Jira Task Assignment → AI Analysis & Response

**Scenario**: When a new Jira task is created and assigned to someone, an AI agent automatically analyzes the task, researches context from the codebase, and posts an initial analysis as a comment.

```mermaid
sequenceDiagram
    participant Jira
    participant OAO as OAO Platform
    participant Analyst as Analyst Agent
    participant GitHub as GitHub MCP
    participant Writer as Writer Agent

    Jira->>OAO: Webhook: task.created
    Note over OAO: Verify HMAC signature<br/>Inject payload into template
    OAO->>Analyst: Step 1: Analyze task [webhook.summary]
    Analyst->>GitHub: Search codebase for related files
    GitHub-->>Analyst: Related code snippets
    Analyst-->>OAO: Analysis report
    OAO->>Writer: Step 2: Write Jira comment from [precedent_output]
    Writer-->>OAO: Formatted comment
    Note over OAO: POST comment back to Jira<br/>via simple_http_request tool
```

**Setup**:
- **Trigger**: `webhook` — Jira sends task-created events to OAO
- **Agent 1** (Analyst): GitHub MCP server for code search, read-only access
- **Agent 2** (Writer): `simple_http_request` tool to post comments back to Jira
- **Variables**: `JIRA_API_TOKEN` (agent-scoped credential), `JIRA_BASE_URL` (workspace property)

**Workflow Steps**:

| Step | Agent | Prompt Template |
|------|-------|----------------|
<div v-pre>

| 1 | Analyst | `Analyze this Jira task: "{{webhook.summary}}". Search the codebase for related files and identify the likely area of change. Task description: {{webhook.description}}` |
| 2 | Writer | `Based on this analysis: {{precedent_output}}. Write a concise Jira comment with: 1) affected files, 2) suggested approach, 3) estimated complexity. Post it to {{properties.JIRA_BASE_URL}}/rest/api/2/issue/{{webhook.issue_key}}/comment` |

</div>

---

## 2. GitHub PR Review Automation

**Scenario**: When a pull request is opened, an AI agent reviews the changes, checks for security issues, and posts a review summary.

```mermaid
sequenceDiagram
    participant GitHub as GitHub
    participant OAO as OAO Platform
    participant Security as Security Agent
    participant Reviewer as Reviewer Agent

    GitHub->>OAO: Webhook: pull_request.opened
    Note over OAO: Verify HMAC<br/>Extract PR diff URL
    OAO->>Security: Step 1: Review PR [webhook.number] for security
    Note over Security: Uses GitHub MCP to<br/>read PR diff and files
    Security-->>OAO: Security findings
    OAO->>Reviewer: Step 2: Write review from [precedent_output]
    Note over Reviewer: Posts review comment<br/>via GitHub MCP
    Reviewer-->>OAO: Review posted
```

**Setup**:
- **Trigger**: `webhook` — GitHub sends `pull_request.opened` events
- **Agent 1** (Security): GitHub MCP with read-only tools. Instructions focus on OWASP Top 10, credential leaks, SQL injection
- **Agent 2** (Reviewer): GitHub MCP with write tools (`create_review`). Instructions focus on code quality and constructive feedback
- **Benefit**: Segregation of duties — the security scanner can't post reviews, and the reviewer uses separate credentials

---

## 3. Daily Standup Report Generation

**Scenario**: Every weekday at 8 AM, OAO generates a team standup summary from yesterday's GitHub activity and posts it to Slack.

```mermaid
flowchart LR
    subgraph Trigger["⏰ Cron: 0 8 * * 1-5"]
        CRON["Schedule<br/>Weekdays 8 AM"]
    end

    subgraph Workflow["OAO Workflow"]
        S1["Step 1: Gather Data<br/><i>GitHub Agent</i>"]
        S2["Step 2: Generate Summary<br/><i>Writer Agent</i>"]
        S3["Step 3: Post to Slack<br/><i>Notifier Agent</i>"]
    end

    CRON --> S1
    S1 --> S2
    S2 --> S3
    S3 --> SLACK["📱 #team-standup"]

    style Trigger fill:#e8f5e9
    style SLACK fill:#e3f2fd
```

**Setup**:
- **Trigger**: `time_schedule` with `cronExpression: "0 8 * * 1-5"`
- **Variables**: `GITHUB_ORG` (workspace), `SLACK_WEBHOOK_URL` (workspace credential)
- **Three agents** with distinct responsibilities:
  1. **GitHub Agent**: Reads commits, PRs, and reviews from the last 24 hours
  2. **Writer Agent**: Summarizes activity into a human-friendly standup format
  3. **Notifier Agent**: Uses `simple_http_request` to post to Slack webhook

---

## 4. Customer Support Escalation

**Scenario**: An internal support tool sends a webhook when a ticket is escalated. OAO triages the ticket, searches the knowledge base, drafts a response, and logs the decision.

```mermaid
flowchart TD
    TICKET["🎫 Support Ticket Escalated"]
    TICKET -- webhook --> OAO

    subgraph OAO["OAO Workflow"]
        direction TB
        TRIAGE["Step 1: Triage<br/><i>Classify priority & category</i>"]
        SEARCH["Step 2: Knowledge Search<br/><i>Search docs + past tickets</i>"]
        DRAFT["Step 3: Draft Response<br/><i>Write customer reply</i>"]
        LOG["Step 4: Record Decision<br/><i>Audit trail + memory</i>"]

        TRIAGE --> SEARCH
        SEARCH --> DRAFT
        DRAFT --> LOG
    end

    LOG --> QUEUE["📋 Response Queue<br/><i>Human reviews before sending</i>"]

    style TICKET fill:#fff3e0
    style QUEUE fill:#e8f5e9
```

**Key Features Used**:
- **Webhook trigger** with parameters: `ticket_id`, `customer_name`, `subject`, `body`
- **Built-in tools**: `memory_retrieve` (find similar past tickets), `memory_store` (remember this resolution), `record_decision` (audit trail)
- **Human-in-the-loop**: The drafted response goes to a review queue — the agent doesn't send directly to the customer

---

## 5. Incident Response Runbook

**Scenario**: A monitoring system (PagerDuty, Prometheus Alertmanager) sends an alert webhook. OAO executes an automated runbook: check metrics, identify root cause, execute remediation steps, and notify the on-call team.

```mermaid
sequenceDiagram
    participant PD as PagerDuty
    participant OAO as OAO Platform
    participant Diag as Diagnostics Agent
    participant Fix as Remediation Agent
    participant Notify as Notifier Agent

    PD->>OAO: Webhook: incident.triggered
    Note over OAO: Payload: service, severity,<br/>description, runbook_url

    OAO->>Diag: Step 1: Diagnose [webhook.service]
    Note over Diag: Queries Prometheus via<br/>simple_http_request<br/>Checks recent deploys
    Diag-->>OAO: Root cause analysis

    OAO->>Fix: Step 2: "Execute remediation"
    Note over Fix: Rolls back deploy or<br/>scales replicas via K8s MCP
    Fix-->>OAO: Actions taken

    OAO->>Notify: Step 3: "Notify on-call team"
    Note over Notify: Posts to Slack with<br/>diagnosis + actions taken
    Notify-->>OAO: Notification sent

    Note over OAO: Record decision audit trail<br/>Store incident memory
```

**Agent Segregation**:
- **Diagnostics Agent**: Read-only access to metrics APIs and deployment history
- **Remediation Agent**: Write access to Kubernetes (scale, rollback) — separate credentials, separate approval scope
- **Notifier Agent**: Only Slack webhook access — cannot modify infrastructure

This demonstrates **least-privilege access**: no single agent has full access to everything.

---

## 6. Scheduled Compliance Report

**Scenario**: Every Monday at 7 AM, generate a compliance report covering the past week's agent activity, credit usage, and security events.

```mermaid
flowchart LR
    subgraph Trigger["⏰ Weekly: Mon 7 AM"]
        CRON["Cron Schedule"]
    end

    subgraph Steps["OAO Workflow"]
        S1["Step 1: Gather Events<br/><i>read_variables + API calls</i>"]
        S2["Step 2: Analyze Patterns<br/><i>Anomaly detection</i>"]
        S3["Step 3: Generate Report<br/><i>Markdown + PDF</i>"]
    end

    CRON --> S1 --> S2 --> S3
    S3 --> EMAIL["📧 Compliance Team"]
    S3 --> ARCHIVE["📁 Archive Storage"]

    style Trigger fill:#e8f5e9
    style EMAIL fill:#e3f2fd
    style ARCHIVE fill:#f3e5f5
```

**Built-in Tools Used**:
- `read_variables`: Access workspace-level configuration
- `simple_http_request`: Fetch data from internal APIs
- `record_decision`: Document the report generation decision
- `memory_store`: Archive key findings for trend analysis

---

## 7. Event-Driven Agent Onboarding

**Scenario**: When a new agent is created in OAO, an automated workflow validates its configuration, tests its connectivity, and notifies the team.

```mermaid
flowchart TD
    EVENT["🔔 Event: agent.created"]
    EVENT --> OAO

    subgraph OAO["Onboarding Workflow"]
        VALIDATE["Step 1: Validate Config<br/><i>Check git repo, credentials, MCP</i>"]
        TEST["Step 2: Test Connectivity<br/><i>Clone repo, verify MCP servers</i>"]
        NOTIFY["Step 3: Notify Team<br/><i>Slack message with status</i>"]

        VALIDATE --> TEST
        TEST --> NOTIFY
    end

    NOTIFY --> SLACK["📱 #ai-agents"]

    style EVENT fill:#fff3e0
    style SLACK fill:#e3f2fd
```

**Setup**:
- **Trigger**: `event` with `eventName: "agent.created"`
- This workflow is **triggered by OAO's own event system** — showcasing how the platform can orchestrate its own operations

---

## Patterns Summary

| Pattern | Trigger | Key Features |
|---------|---------|--------------|
| **Webhook → Analyze → Respond** | Webhook | HMAC auth, payload injection, multi-agent |
| **Schedule → Gather → Report** | Cron | Template variables, output chaining |
| **Alert → Diagnose → Fix → Notify** | Webhook | Agent segregation, least-privilege |
| **Event → Validate → Notify** | Event | Internal event bus, self-orchestration |

### Common Building Blocks

All use cases above leverage these OAO primitives:

<span v-pre>

- **Jinja2 Prompt Templates**: `{{webhook.field}}`, `{{precedent_output}}`, `{{properties.KEY}}`

</span>
- **3-Tier Variables**: Agent-scoped credentials, user preferences, workspace defaults
- **Agent Segregation**: Different agents per step with different tools and access levels
- **Built-in Tools**: `simple_http_request`, `memory_store/retrieve`, `record_decision`
- **MCP Servers**: GitHub, Kubernetes, Slack, or any custom MCP server

::: tip Build Your Own
These examples are starting points. OAO's composable architecture means you can mix and match triggers, agents, tools, and steps to build workflows tailored to your organization's needs.
:::
