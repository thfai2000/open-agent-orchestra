# Events

OAO emits **system events** for every significant action in the platform. These events are stored in the `system_events` table and can be used to:

- **Trigger workflows** via event-type triggers (match by event name + optional data conditions)
- **Audit** platform activity
- **Drive the webhook pipeline** — `webhook.received` events from generic webhooks, Jira callbacks, and Manual Run are processed by the Controller to enqueue workflow executions

## Event List

| Category | Event Name | Description |
|---|---|---|
| **Agent** | `agent.created` | A new agent was created |
| | `agent.updated` | An agent's configuration was updated |
| | `agent.deleted` | An agent was deleted |
| | `agent.status_changed` | An agent's status changed (e.g., active → inactive) |
| **Workflow** | `workflow.created` | A new workflow was created |
| | `workflow.updated` | A workflow's configuration or steps were updated |
| | `workflow.deleted` | A workflow was deleted |
| **Execution** | `execution.started` | A workflow execution started running |
| | `execution.completed` | A workflow execution completed successfully |
| | `execution.failed` | A workflow execution failed |
| | `execution.cancelled` | A workflow execution was cancelled |
| **Step** | `step.completed` | A workflow step completed successfully |
| | `step.failed` | A workflow step failed |
| | `step.allocation_waiting` | Realtime SSE event emitted when a pending step is waiting for static or ephemeral agent runtime allocation |
| | `step.quota_waiting` | Realtime SSE event emitted when a pending step is waiting for enough LLM credit quota |
| **Trigger** | `trigger.fired` | A trigger fired (cron, datetime, or event match) |
| **Webhook** | `webhook.received` | A webhook-style trigger input was received (generic webhook, Jira callback, or Manual Run) |
| **User** | `user.login` | A user logged in |
| | `user.registered` | A new user registered |
| **Variable** | `variable.created` | A variable was created |
| | `variable.updated` | A variable was updated |
| | `variable.deleted` | A variable was deleted |
| **Credential** | `credential.access_requested` | An agent requested access to a credential |
| | `credential.access_approved` | A credential access request was approved |
| | `credential.access_denied` | A credential access request was denied |

## Event Structure

Each event record contains:

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique event identifier |
| `eventName` | string | Event name (e.g., `agent.created`) |
| `eventScope` | enum | `workspace` or `user` |
| `scopeId` | UUID | Workspace or user ID for scoping |
| `eventData` | JSONB | Event-specific payload |
| `actorId` | UUID | User who caused the event (optional) |
| `processedAt` | timestamp | When the Controller processed this event (null if unprocessed) |
| `createdAt` | timestamp | When the event was emitted |

## Event Triggers

Event-type triggers match events by name and optional **data conditions** — key-value pairs that must match fields in `eventData`:

```json
{
  "triggerType": "event",
  "configuration": {
    "eventName": "agent.status_changed",
    "conditions": {
      "newStatus": "active"
    }
  }
}
```

This trigger fires only when an agent's status changes to `active`.

## Pipeline Events

The `webhook.received` event is special — it drives the webhook execution pipeline:

1. **External webhook** → `POST /api/webhooks/:registrationId` → inserts `webhook.received` event
2. **Jira callback** → `POST /api/jira-webhooks/:triggerId?token=...` → inserts `webhook.received` event with `triggerType: "jira_changes_notification"`
3. **Manual Run** → `POST /api/workflows/:id/run` → inserts `webhook.received` event
4. **Controller** → polls `system_events` → processes `webhook.received` → enqueues workflow execution

`webhook.received.eventData` commonly includes `triggerId`, `workflowId`, `triggerType`, `source`, `authMethod`, `eventId`, `payload`, `inputs`, and `receivedAt`.

Jira polling is different: `jira_polling` triggers do not emit `webhook.received`; the controller polls Jira directly and enqueues executions with `triggerMetadata.type = "jira_polling"`.

Generic webhooks, Jira callbacks, and Manual Run all flow through the same event pipeline, ensuring consistent processing and auditability.
