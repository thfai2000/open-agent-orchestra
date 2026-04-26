# Jira Integration Tutorial

This tutorial connects Jira to an OAO workflow that reacts to tickets whose description asks for a weather report. It walks through every credential, agent, workflow, trigger, and verification screen, and links a screenshot to each step.

OAO supports two trigger approaches for Jira:

| Approach | Auth required | How it works |
|---|---|---|
| **Jira Polling** | API token (email + token) | OAO polls Jira's search API on a schedule and fires when new or updated issues match the JQL filter |
| **Jira Changes Notification** | Jira OAuth 2.0 + public callback URL | OAO registers a Jira dynamic webhook; Jira pushes events to OAO immediately when issues change |

Use **Jira Polling** first — it requires only a Jira site URL, email, and API token. Switch to **Jira Changes Notification** when you have OAuth 2.0 credentials and a publicly accessible OAO API URL (Jira cannot reach `localhost`).

## What You Will Build

- A workspace credential that stores a **GitHub Copilot token**, used by the agent to call the Copilot LLM.
- A workspace credential that stores a **Jira API token**, used by the polling trigger to call Jira's REST API.
- A Jira-aware agent and workflow whose step receives matched issue data.
- A **Jira polling trigger** filtered by JQL that reacts to tickets in `To Do` status.
- A verification path: create a Jira ticket whose description requests a weather report, then inspect the OAO execution and step output.

## Prerequisites

| Requirement | Example | Purpose |
|---|---|---|
| OAO workspace | `http://oao.local/default` | Create variables, agents, workflows, and triggers |
| Jira site URL | `https://your-domain.atlassian.net` | Jira REST API base URL |
| Jira account email | `jira-bot@example.com` | API token authentication username |
| Jira API token | Created from Atlassian account security | Stored as an OAO credential variable |
| Jira project key | `SCRUM` | Used in the JQL filter |
| GitHub Copilot token | GitHub PAT with Copilot access, or `gh auth token` | Authorises the agent's Copilot LLM session |

For a local Kubernetes deployment, confirm OAO is reachable before configuring the trigger:

```bash
curl -I http://oao.local
```

## 1. Store The GitHub Copilot Token Credential

Without a Copilot token the agent cannot create an LLM session. The token is stored encrypted at rest (AES-256-GCM) and resolved per execution.

1. Open **Variables** in the workspace navigation, choose the **Workspace** scope, and click **Create variable**.
2. Fill the form:

| Field | Value |
|---|---|
| Key | `COPILOT_TOKEN` |
| Type | `credential` |
| Sub-type | `github_token` |
| Value | A GitHub Personal Access Token with Copilot access (`github_pat_…`) or the output of `gh auth token` |
| Inject as environment variable | Off |

3. Save. The token is hidden after creation; rotate it by editing the variable.

See [Copilot Token Variable](./copilot-token-variable.md) for guidance on token scopes, model availability with PAT vs OAuth, and rotation.

![Workspace Copilot token credential](/screenshots/copilot-token-variable.png)

::: tip Model availability with personal PATs
A `github_pat_*` token typically cannot use the system default model `claude-sonnet-4-6`. Choose a Copilot-PAT-compatible model such as `gpt-5-mini` on the agent or workflow step (see Step 3 and Step 4).
:::

## 2. Store The Jira API Token Credential

Repeat the variable-creation flow for Jira:

| Field | Value |
|---|---|
| Key | `JIRA_API_TOKEN` |
| Type | `credential` |
| Sub-type | `secret_text` |
| Value | Your Atlassian API token (created at <https://id.atlassian.com/manage-profile/security/api-tokens>) |
| Inject as environment variable | Off, unless an MCP server needs it |

After saving, OAO does not display the stored secret again. To rotate it later, open the variable detail page and save a new value.

![Workspace Jira API token credential variable](/screenshots/jira-tutorial-variable.png)

## 3. Create A Jira Agent (And Bind The Copilot Token)

Create a database-backed agent named `Jira Weather Agent`. In the agent editor:

- **Source Type**: `Database` (so the agent's instruction file is stored in OAO).
- **GitHub Copilot Token / LLM API Key**: select the workspace credential `COPILOT_TOKEN` you created in Step 1.
- **Model**: leave blank to inherit the workflow default, or set to `gpt-5-mini` if your Copilot token cannot use the default model.

Use instructions like this for the agent file:

```md
# Jira Weather Agent

You handle Jira issue payloads for operations workflows.

When a ticket asks for a weather report:
- Identify the location, dates, and missing details from the issue description.
- Produce a concise weather report or action plan.
- Never print credential values or API tokens.
```

Keep the first version simple. Add Jira-writing tools later only if the agent needs to post comments back to Jira.

![Jira Weather Agent edit page with Copilot token bound](/screenshots/jira-tutorial-agent-edit.png)

## 4. Create The Workflow

Create a workflow named `Jira Weather Report` and assign `Jira Weather Agent` as the default agent.

- **Worker Runtime**: `Ephemeral` — provisions a fresh isolated pod per execution. Useful when each run should start clean. (Use `Static` if you prefer a long-running shared worker.)
- **Default Model**: `gpt-5-mini` (or any model your Copilot token supports). The agent inherits this when its own model is blank.
- **Step Allocation Timeout**: `600` seconds — generous timeout for the ephemeral pod to provision.

Add one step named `Handle Jira Description` and use this prompt template:

<div v-pre>

```txt
Handle Jira Tickets according to Description.

Summary: {{ inputs.jiraIssues[0].summary | default("(none)") }}
Description: {{ inputs.jiraIssues[0].fields.description | dump | default("(none)") }}
```

</div>

::: warning Jira description is ADF
Jira Cloud's `description` field is in [Atlassian Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/) (a JSON object), not plain text. Pipe it through Nunjucks' `| dump` filter so the agent receives readable JSON instead of `[object Object]`.
:::

The polling trigger injects matched Jira issues into `inputs.jiraIssues` and their issue keys into `inputs.jiraIssueKeys`.

![Workflow edit page with ephemeral worker runtime](/screenshots/jira-tutorial-workflow-edit.png)

## 5. Add The Jira Polling Trigger

Open the workflow **Triggers** tab, add **Jira Polling**, and configure it with API token authentication:

| Field | Value |
|---|---|
| Jira Site URL | `https://your-domain.atlassian.net` |
| Authentication | `API token` |
| Jira Account Email | `jira-bot@example.com` |
| API Token Variable | `JIRA_API_TOKEN` |
| JQL Filter | `project = SCRUM AND status = "To Do" ORDER BY updated DESC` |
| Interval | `15` minutes for normal use, `1` minute while testing |
| Max Results | `25` |
| Overlap | `5` minutes |
| First Poll Behavior | `From now` |
| Fields | `summary`, `description`, `status`, `updated`, `labels` |

::: warning JQL syntax
Wrap multi-word status names in double quotes: `status = "To Do"` not `status = To Do`. Most Jira projects use `To Do`, `In Progress`, `Done`. Project-specific workflows (e.g. SCRUM) sometimes start tickets in `Idea` and require an explicit transition before they match.
:::

Save the trigger, then use **Test Connectivity** from the trigger card. The workflow should show a Jira Polling trigger summary with the interval and JQL filter.

![Jira polling trigger with JQL filter](/screenshots/jira-tutorial-workflow-trigger.png)

## 6. Create The Jira Ticket

In Jira, create a ticket in the project referenced by your JQL filter. For this tutorial, use:

| Jira field | Example value |
|---|---|
| Project | `SCRUM` |
| Issue type | `Task` |
| Summary | `Weather report request` |
| Description | `Please generate Weather Report` |
| Status | `To Do` (transition the ticket if your project starts in another status, e.g. `Idea`) |

The ticket must match the project key, status, and any other constraints in the JQL filter. If you use a different project key, update the JQL before testing.

## 7. Verify The Execution

Wait for the next polling interval, then open **Executions** in OAO. The created execution should show trigger metadata with `jira_polling` and the matched issue payload.

Open the execution detail page and check the first step output. The agent should produce a weather report or action plan based on the ticket description that was rendered into the prompt via the Jinja template.

![Execution detail page showing completed Jira-triggered run](/screenshots/jira-tutorial-execution-detail.png)

If you cannot wait for the polling interval, use the force-fire endpoint to trigger immediately:

```bash
curl -X POST http://oao.local/api/triggers/<triggerId>/fire \
  -H "Authorization: Bearer $OAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If the workflow still does not fire, use **Test Connectivity** on the trigger card and confirm the Jira ticket appears in Jira for the same JQL query.

## Optional: Use Jira Changes Notification

Use **Jira Changes Notification** instead of polling when Jira should push issue changes to OAO. This trigger registers a Jira dynamic webhook filtered by JQL.

### Prerequisites

- `PUBLIC_API_BASE_URL` must be set to a public OAO API URL. For local-only Docker Desktop Kubernetes, `http://oao.local` is not reachable from Atlassian.
- Jira OAuth 2.0 credentials must be stored as credential variables:

| Variable key | Description |
|---|---|
| `JIRA_OAUTH_ACCESS_TOKEN` | OAuth 2.0 access token |
| `JIRA_OAUTH_REFRESH_TOKEN` | OAuth 2.0 refresh token (for automatic renewal) |
| `JIRA_OAUTH_CLIENT_ID` | OAuth 2.0 client ID from the Atlassian developer app |
| `JIRA_OAUTH_CLIENT_SECRET` | OAuth 2.0 client secret from the Atlassian developer app |

- The OAuth app must have `read:jira-work`, `write:jira-work`, and `manage:jira-webhook` scopes for the Jira site.

### Setup steps

1. Store the four credential variables (see table above) in OAO's Variables page.
2. Open the workflow **Triggers** tab and add a **Jira Changes Notification** trigger.
3. Set the authentication to **OAuth 2.0** and reference the variable keys created above.
4. Set the **JQL Filter** to match the issues you want to process:
   ```
   project = SCRUM AND status = "To Do" ORDER BY updated DESC
   ```
5. Select events: `jira:issue_created`, `jira:issue_updated`.
6. Save and activate the trigger. OAO registers the webhook with Jira and stores the webhook IDs in the trigger's runtime state.
7. OAO automatically refreshes webhook registrations before they expire (Jira dynamic webhooks expire after ~30 days).

When Jira fires the webhook, OAO validates the callback token and enqueues the workflow execution with `inputs.jiraIssues` populated from the payload.

### Simulate without OAuth credentials

Use the force-fire endpoint to test a changes-notification trigger without real OAuth credentials:

```bash
curl -X POST http://oao.local/api/triggers/<triggerId>/fire \
  -H "Authorization: Bearer $OAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {
      "webhookEvent": "jira:issue_created",
      "issue": {
        "id": "10001",
        "key": "SCRUM-1",
        "fields": {
          "summary": "Weather report request",
          "description": "Please generate Weather Report",
          "status": { "name": "To Do" },
          "updated": "2026-04-26T10:00:00.000+0000"
        }
      }
    }
  }'
```

This bypasses Jira's webhook delivery entirely and fires the workflow with the supplied mock payload.

## Troubleshooting

| Symptom | Check |
|---|---|
| Test Connectivity fails | Jira site URL, account email, API token variable key, and Jira token permissions |
| No execution appears | Trigger is active, polling interval has elapsed, and Jira issue matches the exact JQL (including quoted status) |
| Old issues do not run immediately | `First Poll Behavior` is `From now`; update the Jira issue or choose a different initial load mode |
| Notification trigger cannot save | `PUBLIC_API_BASE_URL` must be public and OAuth credentials must be valid |
| Step output shows `[object Object]` | Pipe the description through `\| dump` (Nunjucks) — Jira description is ADF, not plain text |
| `Model "<name>" is not active in this workspace` | Choose a model present in the workspace's Models admin page (e.g. `gpt-5-mini` for personal PATs) |
| `Session was not created with authentication info` | The Copilot token cannot use the configured model, or the token is missing/expired — bind a valid Copilot token credential to the agent and pick a compatible model |
| Secret appears missing in UI | Credential values are intentionally hidden after creation; save a new value to rotate the secret |

## Live E2E Check

The Playwright Jira integration tests cover the scenarios below.

| Test | Live Jira required | What it verifies |
|---|---|---|
| Credential variable is stored without exposing the secret | No | AES-256-GCM encryption and masked display |
| Jira Changes Notification trigger saves with JQL and OAuth credential references | No | Trigger schema, inactive state, UI display |
| Jira Changes Notification simulation fires and completes an execution | No (mock payload) | Full execution lifecycle via force-fire endpoint |
| Live Jira polling workflow creates an execution for a new ticket | Yes (opt-in) | Polling detects a real new issue |
| Live Jira polling force-fire immediately polls and completes execution with step output | Yes (opt-in) | End-to-end: Jira issue → OAO execution → step output |
| Jira polling trigger runtimeSummary reflects connectivity test | Yes (opt-in) | Connectivity test + UI display |
| Live Jira polling with **ephemeral runtime + Copilot token credential** completes a weather-report ticket | Yes (opt-in) | Full path: Copilot credential → ephemeral pod → Jira-triggered Copilot run |

### Simulation test (no live Jira needed)

The `Jira changes notification simulation` test runs without any Jira credentials. It:

1. Creates an agent and workflow with a `jira_changes_notification` trigger (inactive).
2. Calls `POST /api/triggers/:id/fire` with a mock Jira issue payload.
3. Waits for the workflow execution to complete.
4. Asserts that `triggerMetadata.type` is `jira_changes_notification`, the simulated flag is set, and the step output is non-empty.

This exercises the full execution path — trigger → BullMQ queue → agent worker → step completion — without touching Jira's API.

### Live tests (opt-in)

Set these variables before running the live tests:

```bash
export RUN_LIVE_JIRA_E2E=1
export JIRA_BASE_URL=https://your-domain.atlassian.net
export JIRA_EMAIL=jira-bot@example.com
export JIRA_API_TOKEN=your-jira-api-token
export JIRA_PROJECT_KEY=SCRUM
export JIRA_ISSUE_TYPE=Task

# Required for the ephemeral-runtime + Copilot-token scenario:
export TESTING_GITHUB_PAT=github_pat_xxx   # PAT with Copilot access
```

The E2E also accepts the testing-prefixed aliases `TESTING_JIRA_BASE_URL`, `TESTING_JIRA_EMAIL`, `TESTING_JIRA_API_TOKEN`, `TESTING_JIRA_PROJECT_KEY`, and `TESTING_JIRA_ISSUE_TYPE`. This is useful when a local `.env` file already stores integration-test credentials separately from runtime application settings.

Then run:

```bash
npx playwright test tests/e2e/jira-integration.spec.ts --project=chromium
```

To run only the simulation tests (no live Jira):

```bash
npx playwright test tests/e2e/jira-integration.spec.ts --project=chromium --grep "simulation"
```

To run the ephemeral + Copilot-token scenario alone:

```bash
npx playwright test tests/e2e/jira-integration.spec.ts --project=chromium \
  --grep "ephemeral runtime \+ Copilot token"
```

### Force-fire API endpoint

OAO exposes `POST /api/triggers/:id/fire` for workspace admins to immediately test trigger execution:

- **`jira_polling`**: bypasses the polling interval and calls Jira's search API immediately. Returns `{ fired, executionId, issueCount }`.
- **`jira_changes_notification`**: accepts a `{ payload: {...} }` body with a mock Jira webhook payload. Enqueues the workflow without registering with Jira. Returns `{ fired, executionId }`.

This endpoint is useful both in E2E tests and for manual debugging from the command line:

```bash
# Force-poll a Jira polling trigger
curl -X POST http://localhost:4002/api/triggers/<triggerId>/fire \
  -H "Authorization: Bearer $OAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Simulate a Jira webhook for a changes-notification trigger
curl -X POST http://localhost:4002/api/triggers/<triggerId>/fire \
  -H "Authorization: Bearer $OAO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "payload": {
      "webhookEvent": "jira:issue_created",
      "issue": {
        "id": "10001",
        "key": "SCRUM-1",
        "fields": {
          "summary": "Weather report request",
          "description": "Please generate Weather Report",
          "status": { "name": "To Do" },
          "updated": "2026-04-26T10:00:00.000+0000"
        }
      }
    }
  }'
```
