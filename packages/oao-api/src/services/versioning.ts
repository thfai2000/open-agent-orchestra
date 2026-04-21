import { eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import {
  agentFiles,
  agentVariables,
  agentVersions,
  workflowSteps,
  workflowVersions,
  triggers,
} from '../database/schema.js';

type AgentRecord = NonNullable<Awaited<ReturnType<typeof db.query.agents.findFirst>>>;
type WorkflowRecord = NonNullable<Awaited<ReturnType<typeof db.query.workflows.findFirst>>>;

interface VersionView<TSnapshot> {
  version: number;
  createdAt: Date | null;
  changedBy: string | null;
  isLatest: boolean;
  snapshot: TSnapshot;
}

function sanitizeAgent(agent: AgentRecord) {
  return {
    id: agent.id,
    workspaceId: agent.workspaceId,
    userId: agent.userId,
    scope: agent.scope,
    name: agent.name,
    description: agent.description,
    sourceType: agent.sourceType,
    gitRepoUrl: agent.gitRepoUrl,
    gitBranch: agent.gitBranch,
    agentFilePath: agent.agentFilePath,
    skillsPaths: agent.skillsPaths,
    skillsDirectory: agent.skillsDirectory,
    githubTokenCredentialId: agent.githubTokenCredentialId,
    copilotTokenCredentialId: agent.copilotTokenCredentialId,
    builtinToolsEnabled: agent.builtinToolsEnabled,
    mcpJsonTemplate: agent.mcpJsonTemplate,
    version: agent.version,
    status: agent.status,
    lastSessionAt: agent.lastSessionAt,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    hasInlineGitToken: Boolean(agent.githubTokenEncrypted),
  };
}

function sanitizeWorkflow(workflow: WorkflowRecord) {
  return {
    id: workflow.id,
    workspaceId: workflow.workspaceId,
    userId: workflow.userId,
    scope: workflow.scope,
    name: workflow.name,
    description: workflow.description,
    labels: workflow.labels,
    isActive: workflow.isActive,
    maxConcurrentExecutions: workflow.maxConcurrentExecutions,
    version: workflow.version,
    defaultAgentId: workflow.defaultAgentId,
    defaultModel: workflow.defaultModel,
    defaultReasoningEffort: workflow.defaultReasoningEffort,
    workerRuntime: workflow.workerRuntime,
    stepAllocationTimeoutSeconds: workflow.stepAllocationTimeoutSeconds,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function normalizeAgentSnapshot(snapshot: unknown) {
  const parsed = (snapshot ?? {}) as {
    agent?: Record<string, unknown>;
    files?: Array<Record<string, unknown>>;
    variables?: Array<Record<string, unknown>>;
  };

  return {
    agent: parsed.agent ?? null,
    files: Array.isArray(parsed.files) ? parsed.files : [],
    variables: Array.isArray(parsed.variables) ? parsed.variables : [],
  };
}

function normalizeWorkflowSnapshot(snapshot: unknown) {
  const parsed = (snapshot ?? {}) as {
    workflow?: Record<string, unknown>;
    steps?: Array<Record<string, unknown>>;
    triggers?: Array<Record<string, unknown>>;
  };

  return {
    workflow: parsed.workflow ?? null,
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    triggers: Array.isArray(parsed.triggers) ? parsed.triggers : [],
  };
}

export async function buildAgentVersionSnapshot(agent: AgentRecord) {
  const [files, variables] = await Promise.all([
    db.query.agentFiles.findMany({
      where: eq(agentFiles.agentId, agent.id),
      orderBy: agentFiles.filePath,
    }),
    db.query.agentVariables.findMany({
      where: eq(agentVariables.agentId, agent.id),
      orderBy: agentVariables.key,
      columns: {
        id: true,
        agentId: true,
        key: true,
        variableType: true,
        credentialSubType: true,
        injectAsEnvVariable: true,
        description: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    agent: sanitizeAgent(agent),
    files: files.map((file) => ({
      id: file.id,
      filePath: file.filePath,
      content: file.content,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    })),
    variables,
  };
}

export async function captureAgentHistoricalVersion(agent: AgentRecord, changedBy: string | null) {
  const snapshot = await buildAgentVersionSnapshot(agent);

  await db.insert(agentVersions).values({
    agentId: agent.id,
    version: agent.version,
    snapshot,
    changedBy,
  }).onConflictDoNothing();
}

export async function getAgentVersionView(
  agent: AgentRecord,
  version: number,
): Promise<VersionView<ReturnType<typeof normalizeAgentSnapshot>> | null> {
  if (version === agent.version) {
    return {
      version,
      createdAt: agent.updatedAt ?? agent.createdAt,
      changedBy: null,
      isLatest: true,
      snapshot: normalizeAgentSnapshot(await buildAgentVersionSnapshot(agent)),
    };
  }

  const matched = await db.query.agentVersions.findMany({
    where: eq(agentVersions.agentId, agent.id),
    orderBy: agentVersions.version,
  });
  const record = matched.find((item) => item.version === version);

  if (!record) return null;

  return {
    version: record.version,
    createdAt: record.createdAt,
    changedBy: record.changedBy,
    isLatest: false,
    snapshot: normalizeAgentSnapshot(record.snapshot),
  };
}

export async function listAgentVersionViews(agent: AgentRecord) {
  const historical = await db.query.agentVersions.findMany({
    where: eq(agentVersions.agentId, agent.id),
  });

  const summaries = [
    {
      version: agent.version,
      createdAt: agent.updatedAt ?? agent.createdAt,
      changedBy: null,
      isLatest: true,
    },
    ...historical.map((record) => ({
      version: record.version,
      createdAt: record.createdAt,
      changedBy: record.changedBy,
      isLatest: false,
    })),
  ];

  const deduped = new Map<number, typeof summaries[number]>();
  for (const summary of summaries) {
    if (!deduped.has(summary.version) || summary.isLatest) {
      deduped.set(summary.version, summary);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => right.version - left.version);
}

export async function buildWorkflowVersionSnapshot(workflow: WorkflowRecord) {
  const [steps, workflowTriggers] = await Promise.all([
    db.query.workflowSteps.findMany({
      where: eq(workflowSteps.workflowId, workflow.id),
      orderBy: workflowSteps.stepOrder,
    }),
    db.query.triggers.findMany({
      where: eq(triggers.workflowId, workflow.id),
      orderBy: triggers.createdAt,
    }),
  ]);

  return {
    workflow: sanitizeWorkflow(workflow),
    steps: steps.map((step) => ({
      id: step.id,
      workflowId: step.workflowId,
      name: step.name,
      promptTemplate: step.promptTemplate,
      stepOrder: step.stepOrder,
      agentId: step.agentId,
      model: step.model,
      reasoningEffort: step.reasoningEffort,
      workerRuntime: step.workerRuntime,
      timeoutSeconds: step.timeoutSeconds,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    })),
    triggers: workflowTriggers.map((trigger) => ({
      id: trigger.id,
      workflowId: trigger.workflowId,
      triggerType: trigger.triggerType,
      configuration: trigger.configuration,
      isActive: trigger.isActive,
      lastFiredAt: trigger.lastFiredAt,
      createdAt: trigger.createdAt,
    })),
  };
}

export async function captureWorkflowHistoricalVersion(workflow: WorkflowRecord, changedBy: string | null) {
  const snapshot = await buildWorkflowVersionSnapshot(workflow);

  await db.insert(workflowVersions).values({
    workflowId: workflow.id,
    version: workflow.version,
    snapshot,
    changedBy,
  }).onConflictDoNothing();
}

export async function getWorkflowVersionView(
  workflow: WorkflowRecord,
  version: number,
): Promise<VersionView<ReturnType<typeof normalizeWorkflowSnapshot>> | null> {
  if (version === workflow.version) {
    return {
      version,
      createdAt: workflow.updatedAt ?? workflow.createdAt,
      changedBy: null,
      isLatest: true,
      snapshot: normalizeWorkflowSnapshot(await buildWorkflowVersionSnapshot(workflow)),
    };
  }

  const historical = await db.query.workflowVersions.findMany({
    where: eq(workflowVersions.workflowId, workflow.id),
  });
  const record = historical.find((item) => item.version === version);

  if (!record) return null;

  return {
    version: record.version,
    createdAt: record.createdAt,
    changedBy: record.changedBy,
    isLatest: false,
    snapshot: normalizeWorkflowSnapshot(record.snapshot),
  };
}

export async function listWorkflowVersionViews(workflow: WorkflowRecord) {
  const historical = await db.query.workflowVersions.findMany({
    where: eq(workflowVersions.workflowId, workflow.id),
  });

  const summaries = [
    {
      version: workflow.version,
      createdAt: workflow.updatedAt ?? workflow.createdAt,
      changedBy: null,
      isLatest: true,
    },
    ...historical.map((record) => ({
      version: record.version,
      createdAt: record.createdAt,
      changedBy: record.changedBy,
      isLatest: false,
    })),
  ];

  const deduped = new Map<number, typeof summaries[number]>();
  for (const summary of summaries) {
    if (!deduped.has(summary.version) || summary.isLatest) {
      deduped.set(summary.version, summary);
    }
  }

  return Array.from(deduped.values()).sort((left, right) => right.version - left.version);
}