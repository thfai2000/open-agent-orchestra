import { Worker } from 'bullmq';
import { createLogger } from '@oao/shared';
import { executeWorkflow } from '../services/workflow-engine.js';
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
      const { executionId, workflowId, agentId } = job.data;
      logger.info(
        { executionId, workflowId, agentId, jobId: job.id },
        'Processing workflow execution',
      );

      await executeWorkflow(executionId);
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
