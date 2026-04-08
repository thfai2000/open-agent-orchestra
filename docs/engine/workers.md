# Workers

## Workflow Worker

BullMQ worker that processes workflow execution jobs.

```typescript
// packages/agent-api/src/workers/workflow-worker.ts
const worker = new Worker('workflow-execution', async (job) => {
  const { workflowId, triggerId, triggerMetadata } = job.data;
  await executeWorkflow(workflowId, triggerId, triggerMetadata);
}, {
  connection: redis,
  concurrency: 1,  // One session per pod
  lockDuration: 600_000, // 10 minutes
});
```

## Scheduler

Separate K8s service (configurable replicas, Redis leader lock for atomicity) that:
1. Polls `triggers` table for time-schedule triggers that are due
2. Polls `triggers` table for exact-datetime triggers that are due (one-shot: fires once, auto-deactivates)
3. Polls `system_events` table for event triggers using Redis cursor-based tracking
4. Enqueues workflow execution jobs in BullMQ
5. Updates `triggers.last_fired_at`

**Deployment**: Separate K8s Deployment (`scheduler-deployment.yaml`) using the same API Docker image but with a custom entrypoint command. Configurable replicas (default: 1) with leader election via Redis lock.

```
Every 30 seconds (runs in parallel):

  ── Cron Trigger Polling ──
  SELECT * FROM triggers
  WHERE trigger_type = 'time_schedule'
    AND is_active = true
    AND (last_fired_at IS NULL OR next_fire_at <= NOW())
  FOR UPDATE SKIP LOCKED

  ── Exact Datetime Trigger Polling ──
  SELECT * FROM triggers
  WHERE trigger_type = 'exact_datetime'
    AND is_active = true
  Then check if configuration.datetime <= NOW()
  If due: fire once, then deactivate (isActive = false)

  ── Event Trigger Polling ──
  1. Read last processed event timestamp from Redis cursor
  2. Fetch new system_events since cursor
  3. For each event, match against active 'event' triggers:
     - eventName must match trigger configuration
     - eventScope filter (optional)
     - Conditions object: key-value match against event_data
     - Workspace scope compatibility check
  4. Enqueue matched workflow executions
  5. Update Redis cursor to latest event timestamp
```
