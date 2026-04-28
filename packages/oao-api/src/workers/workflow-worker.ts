import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createLogger } from '@oao/shared';
import { executeWorkflow } from '../services/workflow-engine.js';
import { executeGraphWorkflow } from '../services/workflow-graph-engine.js';
import { db } from '../database/index.js';
import { workflowExecutions, workflows } from '../database/schema.js';
import { getRedisConnectionOpts } from '../services/redis.js';

const logger = createLogger('workflow-worker');

let worker: Worker | null = null;

/**
 * Start the BullMQ workflow worker.
 * Called from controller.ts so both the trigger poller and worker
 * run in the same Kubernetes pod.
 */
export function startWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(
    'workflow-execution',
    async (job) => {
      const { executionId, workflowId, agentId, startFromStep } = job.data;
      const stepIndex = typeof startFromStep === 'number' && Number.isInteger(startFromStep) && startFromStep >= 0
        ? startFromStep
        : 0;
      logger.info(
        { executionId, workflowId, agentId, startFromStep: stepIndex, jobId: job.id },
        'Processing workflow execution',
      );

      // Resolve execution mode (sequential vs graph) by reading the
      // workflow row referenced by this execution. Graph workflows ignore
      // startFromStep; partial resume is sequential-only for now.
      const execution = workflowId
        ? null
        : await db.query.workflowExecutions.findFirst({ where: eq(workflowExecutions.id, executionId) });
      const wfId = workflowId ?? execution?.workflowId;
      let mode: 'sequential' | 'graph' = 'sequential';
      if (wfId) {
        const wf = await db.query.workflows.findFirst({ where: eq(workflows.id, wfId) });
        if (wf?.executionMode === 'graph') mode = 'graph';
      }

      if (mode === 'graph') {
        await executeGraphWorkflow(executionId);
      } else {
        await executeWorkflow(executionId, stepIndex);
      }
    },
    {
      connection: getRedisConnectionOpts(),
      concurrency: 1,
      lockDuration: 600_000, // 10 minutes
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'Job failed');
  });

  worker.on('error', (err) => {
    logger.error({ error: err.message }, 'Worker error');
  });

  logger.info('Workflow worker started, waiting for jobs...');

  return worker;
}

/**
 * Gracefully close the worker. Called during shutdown.
 */
export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
