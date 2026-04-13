import * as k8s from '@kubernetes/client-node';
import { createLogger } from '@oao/shared';
import { getRedisConnection } from './redis.js';

const logger = createLogger('k8s-provisioner');

// ─── Configuration ────────────────────────────────────────────────────

const K8S_NAMESPACE = process.env.K8S_NAMESPACE || 'open-agent-orchestra';
const AGENT_POD_IMAGE = process.env.AGENT_POD_IMAGE || 'oao-api:latest';
const AGENT_POD_MEMORY_REQUEST = process.env.AGENT_POD_MEMORY_REQUEST || '256Mi';
const AGENT_POD_CPU_REQUEST = process.env.AGENT_POD_CPU_REQUEST || '200m';
const AGENT_POD_MEMORY_LIMIT = process.env.AGENT_POD_MEMORY_LIMIT || '512Mi';
const AGENT_POD_CPU_LIMIT = process.env.AGENT_POD_CPU_LIMIT || '500m';
const MAX_CONCURRENT_AGENTS = parseInt(process.env.MAX_CONCURRENT_AGENTS || '10', 10);
const AGENT_POD_TIMEOUT_SECONDS = parseInt(process.env.AGENT_POD_TIMEOUT_SECONDS || '600', 10); // 10 min default

const AGENT_SLOTS_KEY = 'controller:agent-slots';

// ─── K8s Client ───────────────────────────────────────────────────────

let k8sApi: k8s.CoreV1Api | null = null;

function getK8sApi(): k8s.CoreV1Api {
  if (!k8sApi) {
    const kc = new k8s.KubeConfig();
    if (process.env.NODE_ENV === 'test') {
      // In test mode, don't try loading cluster config
      kc.loadFromDefault();
    } else {
      try {
        kc.loadFromCluster();
        logger.info('Loaded in-cluster K8s config');
      } catch {
        kc.loadFromDefault();
        logger.info('Loaded default K8s config (kubeconfig)');
      }
    }
    k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  }
  return k8sApi;
}

/** Reset K8s client (for testing). */
export function resetK8sClient(): void {
  k8sApi = null;
}

// ─── Agent Slot Semaphore ─────────────────────────────────────────────

/**
 * Acquire an agent slot (semaphore). Returns true if a slot is available.
 * Uses Redis INCR with a check against MAX_CONCURRENT_AGENTS.
 */
export async function acquireAgentSlot(): Promise<boolean> {
  const redis = getRedisConnection();
  const current = await redis.incr(AGENT_SLOTS_KEY);
  if (current > MAX_CONCURRENT_AGENTS) {
    // No slot available, decrement back
    await redis.decr(AGENT_SLOTS_KEY);
    return false;
  }
  return true;
}

/**
 * Release an agent slot when an agent pod completes.
 */
export async function releaseAgentSlot(): Promise<void> {
  const redis = getRedisConnection();
  const val = await redis.decr(AGENT_SLOTS_KEY);
  // Prevent going below 0 (safety guard)
  if (val < 0) {
    await redis.set(AGENT_SLOTS_KEY, '0');
  }
}

/**
 * Get current agent slot usage.
 */
export async function getAgentSlotUsage(): Promise<{ active: number; max: number }> {
  const redis = getRedisConnection();
  const val = await redis.get(AGENT_SLOTS_KEY);
  return { active: parseInt(val || '0', 10), max: MAX_CONCURRENT_AGENTS };
}

// ─── Pod Creation ─────────────────────────────────────────────────────

export interface AgentPodConfig {
  stepExecutionId: string;
  executionId: string;
  workflowId: string;
  stepOrder: number;
  agentId: string;
  agentName: string;
  timeoutSeconds?: number;
}

/**
 * Build the K8s Pod spec for an agent runner.
 * The pod runs the agent-runner.ts entry point with step execution ID as env var.
 */
function buildAgentPodSpec(config: AgentPodConfig): k8s.V1Pod {
  const podName = `oao-agent-${config.stepExecutionId.slice(0, 8)}-${Date.now()}`.toLowerCase();

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: K8S_NAMESPACE,
      labels: {
        app: 'oao-agent',
        'oao/execution-id': config.executionId,
        'oao/step-execution-id': config.stepExecutionId,
        'oao/workflow-id': config.workflowId,
      },
      annotations: {
        'oao/agent-name': config.agentName,
        'oao/step-order': String(config.stepOrder),
      },
    },
    spec: {
      restartPolicy: 'Never',
      activeDeadlineSeconds: config.timeoutSeconds || AGENT_POD_TIMEOUT_SECONDS,
      containers: [
        {
          name: 'agent-runner',
          image: AGENT_POD_IMAGE,
          imagePullPolicy: 'IfNotPresent' as k8s.V1Container['imagePullPolicy'],
          command: ['node', '--import', 'tsx', 'packages/oao-api/src/workers/agent-runner.ts'],
          env: [
            { name: 'STEP_EXECUTION_ID', value: config.stepExecutionId },
            { name: 'EXECUTION_ID', value: config.executionId },
            { name: 'WORKFLOW_ID', value: config.workflowId },
          ],
          envFrom: [
            { configMapRef: { name: 'oao-platform-config' } },
            { secretRef: { name: 'oao-platform-secrets' } },
          ],
          resources: {
            requests: {
              memory: AGENT_POD_MEMORY_REQUEST,
              cpu: AGENT_POD_CPU_REQUEST,
            },
            limits: {
              memory: AGENT_POD_MEMORY_LIMIT,
              cpu: AGENT_POD_CPU_LIMIT,
            },
          },
        },
      ],
    },
  };
}

/**
 * Create an agent pod for a specific step execution.
 * Returns the pod name for status tracking.
 */
export async function createAgentPod(config: AgentPodConfig): Promise<string> {
  const api = getK8sApi();
  const podSpec = buildAgentPodSpec(config);
  const podName = podSpec.metadata!.name!;

  logger.info(
    {
      podName,
      stepExecutionId: config.stepExecutionId,
      executionId: config.executionId,
      agentName: config.agentName,
      image: AGENT_POD_IMAGE,
    },
    'Creating agent pod',
  );

  await api.createNamespacedPod({ namespace: K8S_NAMESPACE, body: podSpec });

  logger.info({ podName }, 'Agent pod created');
  return podName;
}

/**
 * Wait for an agent pod to reach a terminal state (Succeeded or Failed).
 * Polls pod status periodically.
 * Returns the pod phase ('Succeeded' | 'Failed').
 */
export async function waitForPodCompletion(
  podName: string,
  timeoutSeconds?: number,
): Promise<'Succeeded' | 'Failed'> {
  const api = getK8sApi();
  const timeout = (timeoutSeconds || AGENT_POD_TIMEOUT_SECONDS) * 1000;
  const pollInterval = 3000; // 3 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const pod = await api.readNamespacedPod({ name: podName, namespace: K8S_NAMESPACE });
      const phase = pod.status?.phase;

      if (phase === 'Succeeded') {
        logger.info({ podName, phase }, 'Agent pod completed successfully');
        return 'Succeeded';
      }

      if (phase === 'Failed') {
        const containerStatus = pod.status?.containerStatuses?.[0];
        const reason = containerStatus?.state?.terminated?.reason || 'Unknown';
        const exitCode = containerStatus?.state?.terminated?.exitCode;
        logger.error({ podName, phase, reason, exitCode }, 'Agent pod failed');
        return 'Failed';
      }

      // Still running or pending, wait and poll again
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    } catch (error) {
      // Pod might have been deleted externally
      logger.error({ podName, error }, 'Error checking agent pod status');
      return 'Failed';
    }
  }

  // Timeout reached
  logger.error({ podName, timeoutSeconds }, 'Agent pod timed out');
  return 'Failed';
}

/**
 * Delete an agent pod (cleanup after completion).
 * Best-effort: ignores errors if pod already deleted.
 */
export async function deleteAgentPod(podName: string): Promise<void> {
  try {
    const api = getK8sApi();
    await api.deleteNamespacedPod({ name: podName, namespace: K8S_NAMESPACE });
    logger.info({ podName }, 'Agent pod deleted');
  } catch (error) {
    logger.debug({ podName, error }, 'Failed to delete agent pod (may already be gone)');
  }
}

/**
 * List all active agent pods (for monitoring/cleanup).
 */
export async function listAgentPods(): Promise<Array<{ name: string; phase: string; executionId: string }>> {
  const api = getK8sApi();
  const podList = await api.listNamespacedPod({
    namespace: K8S_NAMESPACE,
    labelSelector: 'app=oao-agent',
  });

  return (podList.items || []).map((pod: k8s.V1Pod) => ({
    name: pod.metadata?.name || '',
    phase: pod.status?.phase || 'Unknown',
    executionId: pod.metadata?.labels?.['oao/execution-id'] || '',
  }));
}
