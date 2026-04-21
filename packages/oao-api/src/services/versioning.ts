import { and, eq } from 'drizzle-orm';
import { db } from '../database/index.js';
import {
  agentFiles,
  agentVariables,
  agentVersions,
  variableVersions,
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

export type VariableScope = 'agent' | 'user' | 'workspace';

export interface VariableVersionSnapshot {
  id: string;
  scope: VariableScope;
  scopeId: string;
  workspaceId: string | null;
  key: string;
  variableType: string;
  credentialSubType: string;
  injectAsEnvVariable: boolean;
  description: string | null;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
}

interface VariableVersionCaptureInput {
  id: string;
  scope: VariableScope;
  scopeId: string;
  workspaceId: string | null;
  key: string;
  variableType: string;
  credentialSubType: string;
  injectAsEnvVariable: boolean;
  description: string | null | undefined;
  version: number;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

interface VariableVersionSummary {
  version: number;
  createdAt: Date | null;
  changedBy: string | null;
  isLatest: boolean;
  isDeleted: boolean;
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

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildVariableVersionSnapshot(
  input: VariableVersionCaptureInput,
  options?: { deleted?: boolean; deletedAt?: Date | string | null },
): VariableVersionSnapshot {
  const deleted = options?.deleted === true;

  return {
    id: input.id,
    scope: input.scope,
    scopeId: input.scopeId,
    workspaceId: input.workspaceId,
    key: input.key,
    variableType: input.variableType,
    credentialSubType: input.credentialSubType,
    injectAsEnvVariable: input.injectAsEnvVariable,
    description: input.description ?? null,
    version: input.version,
    createdAt: toIsoString(input.createdAt),
    updatedAt: toIsoString(input.updatedAt),
    isDeleted: deleted,
    deletedAt: deleted ? toIsoString(options?.deletedAt ?? new Date()) : null,
  };
}

function normalizeVariableSnapshot(snapshot: unknown): VariableVersionSnapshot | null {
  const parsed = (snapshot ?? {}) as Partial<VariableVersionSnapshot>;

  if (
    typeof parsed.id !== 'string'
    || (parsed.scope !== 'agent' && parsed.scope !== 'user' && parsed.scope !== 'workspace')
    || typeof parsed.scopeId !== 'string'
    || typeof parsed.key !== 'string'
    || typeof parsed.version !== 'number'
  ) {
    return null;
  }

  return {
    id: parsed.id,
    scope: parsed.scope,
    scopeId: parsed.scopeId,
    workspaceId: typeof parsed.workspaceId === 'string' ? parsed.workspaceId : null,
    key: parsed.key,
    variableType: typeof parsed.variableType === 'string' ? parsed.variableType : 'credential',
    credentialSubType: typeof parsed.credentialSubType === 'string' ? parsed.credentialSubType : 'secret_text',
    injectAsEnvVariable: parsed.injectAsEnvVariable === true,
    description: typeof parsed.description === 'string' ? parsed.description : null,
    version: parsed.version,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    isDeleted: parsed.isDeleted === true,
    deletedAt: typeof parsed.deletedAt === 'string' ? parsed.deletedAt : null,
  };
}

export async function captureVariableHistoricalVersion(
  input: VariableVersionCaptureInput,
  changedBy: string | null,
  options?: { deleted?: boolean; deletedAt?: Date | string | null },
) {
  const snapshot = buildVariableVersionSnapshot(input, options);

  await db.insert(variableVersions).values({
    variableId: input.id,
    scope: input.scope,
    scopeId: input.scopeId,
    workspaceId: input.workspaceId,
    version: input.version,
    snapshot,
    changedBy,
  }).onConflictDoNothing();

  return snapshot;
}

export async function getVariableVersionView(
  scope: VariableScope,
  variableId: string,
  version: number,
  currentSnapshot?: VariableVersionSnapshot | null,
): Promise<VersionView<VariableVersionSnapshot> | null> {
  if (currentSnapshot && !currentSnapshot.isDeleted && currentSnapshot.version === version) {
    return {
      version,
      createdAt: currentSnapshot.updatedAt ? new Date(currentSnapshot.updatedAt) : currentSnapshot.createdAt ? new Date(currentSnapshot.createdAt) : null,
      changedBy: null,
      isLatest: true,
      snapshot: currentSnapshot,
    };
  }

  const matched = await db.query.variableVersions.findMany({
    where: and(eq(variableVersions.scope, scope), eq(variableVersions.variableId, variableId)),
    orderBy: variableVersions.version,
  });
  const record = matched.find((item) => item.version === version);

  if (!record) return null;

  const snapshot = normalizeVariableSnapshot(record.snapshot);
  if (!snapshot) return null;

  return {
    version: record.version,
    createdAt: record.createdAt,
    changedBy: record.changedBy,
    isLatest: !currentSnapshot && record.version === Math.max(...matched.map((item) => item.version)),
    snapshot,
  };
}

export async function listVariableVersionViews(
  scope: VariableScope,
  variableId: string,
  currentSnapshot?: VariableVersionSnapshot | null,
): Promise<VariableVersionSummary[]> {
  const historical = await db.query.variableVersions.findMany({
    where: and(eq(variableVersions.scope, scope), eq(variableVersions.variableId, variableId)),
  });

  const summaries = [
    ...(currentSnapshot && !currentSnapshot.isDeleted
      ? [{
          version: currentSnapshot.version,
          createdAt: currentSnapshot.updatedAt ? new Date(currentSnapshot.updatedAt) : currentSnapshot.createdAt ? new Date(currentSnapshot.createdAt) : null,
          changedBy: null,
          isLatest: true,
          isDeleted: false,
        } satisfies VariableVersionSummary]
      : []),
    ...historical.flatMap((record) => {
      const snapshot = normalizeVariableSnapshot(record.snapshot);
      if (!snapshot) return [];
      return [{
        version: record.version,
        createdAt: record.createdAt,
        changedBy: record.changedBy,
        isLatest: false,
        isDeleted: snapshot.isDeleted,
      } satisfies VariableVersionSummary];
    }),
  ];

  const deduped = new Map<number, VariableVersionSummary>();
  for (const summary of summaries) {
    if (!deduped.has(summary.version) || summary.isLatest) {
      deduped.set(summary.version, summary);
    }
  }

  const ordered = Array.from(deduped.values()).sort((left, right) => right.version - left.version);
  if (!currentSnapshot && ordered.length > 0) {
    const latestVersion = ordered[0].version;
    return ordered.map((entry) => ({
      ...entry,
      isLatest: entry.version === latestVersion,
    }));
  }

  return ordered;
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