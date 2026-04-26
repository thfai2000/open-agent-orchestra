# External Integration Workflow Tutorials

External integrations in OAO follow one repeatable pattern: store secrets as credential variables, give the agent only the tools it needs, create a workflow with a clear prompt template, and expose the right trigger for the external platform.

This guide uses placeholders only. Put real credentials in OAO Variables, never in docs, prompts that will be shared, screenshots, or source control.

## Shared Setup Pattern

1. Create credentials on the Variables page.
2. Create or edit an agent and enable only the integration tools it needs.
3. Create a workflow with a prompt template that names the expected input fields.
4. Add a webhook, schedule, Jira polling trigger, or system event trigger.
5. Test with Manual Run first when the trigger supports it.
6. Inspect Executions to confirm inputs, outputs, and failures are observable.

![External webhook workflow trigger](/screenshots/external-webhook-workflow-trigger.png)

## Tutorial 1: Slack Alert Notification

Use this when an external system sends an alert to OAO and you want an agent to summarize it before posting to Slack.

### Variables

| Key | Scope | Type | Sub-type | Value |
|-----|-------|------|----------|-------|
| `SLACK_WEBHOOK_URL` | Workspace | `credential` | `secret_text` | Slack incoming webhook URL |

Keep **Inject as environment variable** off unless a specific tool needs environment-variable injection. The agent can read the credential through the platform variable tools.

### Agent

Create a database-backed agent named `Slack Alert Agent` with these built-in tools enabled:

| Tool | Purpose |
|------|---------|
| `read_variables` | Resolve `SLACK_WEBHOOK_URL` at runtime |
| `simple_http_request` | POST the final Slack message |

Agent instructions:

```markdown
# Slack Alert Agent

Summarize incoming alert payloads into concise operational messages. Include severity, source, title, and one recommended next action. Send the final message to Slack only after the summary is ready.
```

### Workflow

Create `Slack Alert Notification` with one step:

```text
Read the credential variable SLACK_WEBHOOK_URL.
Create a concise Slack message from this alert payload.
Severity: {{ inputs.severity }}
Source: {{ inputs.source | default("unknown") }}
Title: {{ inputs.title | default("Untitled alert") }}
Description: {{ inputs.description | default("No description supplied") }}

Use simple_http_request to POST JSON to the Slack webhook URL:
{
  "text": "[{{ inputs.severity }}] {{ inputs.title }} - recommended action: ..."
}
```

Add a webhook trigger:

| Field | Value |
|-------|-------|
| Type | `Webhook` |
| Path | `/alerts/slack` |
| Parameters | `severity` required, `source` optional, `title` optional, `description` optional |
| Active | On after local testing succeeds |

### Test Payload

```json
{
  "severity": "warning",
  "source": "weather-service",
  "title": "Weekly report delayed",
  "description": "The upstream report job has not published today's summary."
}
```

## Tutorial 2: GitHub Pull Request Review Summary

Use this when GitHub sends a pull request webhook and OAO should produce a review summary or post a comment through GitHub APIs.

### Variables

| Key | Scope | Type | Sub-type | Value |
|-----|-------|------|----------|-------|
| `GITHUB_TOKEN` | Workspace or User | `credential` | `GitHub Token` | Fine-grained token with the minimum repository permissions |

Use a user-scoped token if reviews should act as the signed-in operator. Use a workspace-scoped token for shared service-account automation.

### Agent

Create `GitHub PR Review Agent` with these tools:

| Tool | Purpose |
|------|---------|
| `read_variables` | Resolve `GITHUB_TOKEN` |
| `simple_http_request` | Call GitHub REST endpoints |

If you configure a GitHub MCP server for the agent, keep `simple_http_request` disabled unless the workflow truly needs raw HTTP access.

### Workflow

Prompt template:

```text
Review the GitHub pull request payload.
Repository: {{ inputs.repository }}
Pull request: #{{ inputs.pull_request_number }}
Title: {{ inputs.title }}
Changed files summary: {{ inputs.changed_files | default("not supplied") }}

Return:
1. Risk summary
2. Suggested test focus
3. A short review comment body

If posting is enabled for this workflow, use GITHUB_TOKEN and simple_http_request to create a pull request comment through the GitHub REST API.
```

Webhook trigger:

| Field | Value |
|-------|-------|
| Type | `Webhook` |
| Path | `/github/pr-review` |
| Parameters | `repository`, `pull_request_number`, `title`, `changed_files` |

## Tutorial 3: HTTP Enrichment Before Ticket Routing

Use this when a workflow must enrich an incoming request with data from a CRM, inventory system, or internal API before deciding how to route it.

### Variables

| Key | Scope | Type | Sub-type | Value |
|-----|-------|------|----------|-------|
| `CUSTOMER_API_BASE_URL` | Workspace | `property` | n/a | `https://api.example.internal` |
| `CUSTOMER_API_TOKEN` | Workspace | `credential` | `secret_text` | API bearer token |

### Agent

Create `Customer Enrichment Agent` with `read_variables` and `simple_http_request` enabled.

### Workflow

Step 1, `Fetch Customer Context`:

```text
Read CUSTOMER_API_BASE_URL and CUSTOMER_API_TOKEN.
Use simple_http_request to GET:
{{ properties.CUSTOMER_API_BASE_URL }}/customers/{{ inputs.customer_id }}

Return the customer tier, region, open incidents, and renewal date.
```

Step 2, `Route Ticket`:

```text
Using the enrichment result below, decide the support queue and priority.

Customer context:
{{ precedent_output }}

Ticket:
{{ inputs.description }}

Return JSON with queue, priority, reason, and recommended owner.
```

Webhook trigger:

| Field | Value |
|-------|-------|
| Type | `Webhook` |
| Path | `/support/enrich` |
| Parameters | `customer_id` required, `description` required |

## Tutorial 4: Jira Weather Report Request

For Jira polling or Jira dynamic webhook setup, use the dedicated [Jira Integration Tutorial](/guide/jira-integration). The short version is:

1. Store `JIRA_API_TOKEN` as a workspace credential.
2. Create an agent that can process Jira issue payloads.
3. Create a workflow prompt that reads `inputs.jiraIssues` and `inputs.jiraIssueKeys`.
4. Add a Jira polling trigger with JQL such as:

```text
project = OAO AND description ~ "Get a Weekly Weather Report" ORDER BY updated DESC
```

The live Playwright E2E creates a real Jira issue with description `Get a Weekly Weather Report`, waits for OAO to record a workflow execution, and deletes the temporary issue.

## Verification Checklist

| Check | Expected Result |
|-------|-----------------|
| Variable list | Credential rows show metadata only, never raw values |
| Agent edit page | Model and integration credentials appear as selectable variable references |
| Workflow trigger card | Webhook path, Jira JQL, or polling interval is visible without exposing secrets |
| Execution detail | Inputs, status, agent step output, and failures are auditable |
| Cleanup | Deleting a workflow removes its triggers and does not leave stale automation endpoints |
