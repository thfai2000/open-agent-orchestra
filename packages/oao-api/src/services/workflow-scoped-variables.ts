/**
 * Workflow + execution-scoped variables, plus agent short-memory.
 *
 * Three new "namespaces" complement the existing agent / user / workspace
 * variable tables:
 *
 *   - workflow:   per-workflow KV, lives across all executions
 *   - execution:  per-workflow_execution KV, cleared with the execution
 *   - memory:     agent short-term memory (persistent KV the agent itself
 *                 writes via the `remember`/`recall` tools)
 *
 * Credential entries on the workflow scope are AES-256-GCM encrypted at
 * rest just like other credential variables. Properties and short_memory
 * values are stored as JSON (jsonb) directly. Execution-scoped variables
 * are always plain JSON because they are short-lived runtime state.
 */

import { and, eq, lt } from 'drizzle-orm';
import { decrypt, encrypt, createLogger } from '@oao/shared';
import { db } from '../database/index.js';
import {
  workflowVariables,
  workflowExecutionVariables,
  agentShortMemories,
} from '../database/schema.js';

const logger = createLogger('workflow-scoped-variables');

export type WorkflowVariableType = 'property' | 'credential' | 'short_memory';

export interface WorkflowVariableInput {
  workflowId: string;
  key: string;
  value: unknown;
  type?: WorkflowVariableType;
  description?: string;
}

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/;

function assertKey(key: string): void {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new Error(
      `Invalid variable key "${key}". Must start with a letter and contain only letters, digits, '_', '.', '-' (max 100 chars).`,
    );
  }
}

// ─── Workflow-scoped variables ───────────────────────────────────────

export async function setWorkflowVariable(input: WorkflowVariableInput): Promise<void> {
  assertKey(input.key);
  const type: WorkflowVariableType = input.type ?? 'property';

  const baseRow = {
    workflowId: input.workflowId,
    key: input.key,
    variableType: type,
    description: input.description ?? null,
    updatedAt: new Date(),
  };

  if (type === 'credential') {
    const plain = typeof input.value === 'string' ? input.value : JSON.stringify(input.value);
    const encrypted = encrypt(plain);
    await db
      .insert(workflowVariables)
      .values({ ...baseRow, valueEncrypted: encrypted, valueJson: null })
      .onConflictDoUpdate({
        target: [workflowVariables.workflowId, workflowVariables.key],
        set: { valueEncrypted: encrypted, valueJson: null, variableType: type, updatedAt: new Date() },
      });
  } else {
    await db
      .insert(workflowVariables)
      .values({ ...baseRow, valueJson: input.value as unknown, valueEncrypted: null })
      .onConflictDoUpdate({
        target: [workflowVariables.workflowId, workflowVariables.key],
        set: { valueJson: input.value as unknown, valueEncrypted: null, variableType: type, updatedAt: new Date() },
      });
  }
}

export async function getWorkflowVariable(
  workflowId: string,
  key: string,
): Promise<{ key: string; type: WorkflowVariableType; value: unknown; masked: boolean } | null> {
  assertKey(key);
  const [row] = await db
    .select()
    .from(workflowVariables)
    .where(and(eq(workflowVariables.workflowId, workflowId), eq(workflowVariables.key, key)))
    .limit(1);
  if (!row) return null;

  if (row.variableType === 'credential') {
    return { key: row.key, type: 'credential', value: '********', masked: true };
  }
  return { key: row.key, type: row.variableType as WorkflowVariableType, value: row.valueJson, masked: false };
}

export async function listWorkflowVariables(
  workflowId: string,
): Promise<Array<{ key: string; type: WorkflowVariableType; value: unknown; masked: boolean; description: string | null }>> {
  const rows = await db
    .select()
    .from(workflowVariables)
    .where(eq(workflowVariables.workflowId, workflowId));
  return rows.map((row) => {
    const masked = row.variableType === 'credential';
    return {
      key: row.key,
      type: row.variableType as WorkflowVariableType,
      value: masked ? '********' : row.valueJson,
      masked,
      description: row.description ?? null,
    };
  });
}

export async function deleteWorkflowVariable(workflowId: string, key: string): Promise<boolean> {
  assertKey(key);
  const existing = await db
    .select({ id: workflowVariables.id })
    .from(workflowVariables)
    .where(and(eq(workflowVariables.workflowId, workflowId), eq(workflowVariables.key, key)))
    .limit(1);
  if (existing.length === 0) return false;
  await db
    .delete(workflowVariables)
    .where(and(eq(workflowVariables.workflowId, workflowId), eq(workflowVariables.key, key)));
  return true;
}

/**
 * Returns the resolved values for a workflow's variables. Credential
 * entries are decrypted. Use ONLY in trusted server code (engine,
 * Jinja renderer) — never return through API.
 */
export async function resolveWorkflowVariablesForRender(workflowId: string): Promise<{
  properties: Record<string, unknown>;
  credentials: Record<string, string>;
  memories: Record<string, unknown>;
}> {
  const rows = await db
    .select()
    .from(workflowVariables)
    .where(eq(workflowVariables.workflowId, workflowId));

  const properties: Record<string, unknown> = {};
  const credentials: Record<string, string> = {};
  const memories: Record<string, unknown> = {};
  for (const row of rows) {
    if (row.variableType === 'credential' && row.valueEncrypted) {
      try {
        credentials[row.key] = decrypt(row.valueEncrypted);
      } catch (err) {
        logger.warn({ err, key: row.key, workflowId }, 'Failed to decrypt workflow credential');
      }
    } else if (row.variableType === 'short_memory') {
      memories[row.key] = row.valueJson;
    } else {
      properties[row.key] = row.valueJson;
    }
  }
  return { properties, credentials, memories };
}

// ─── Execution-scoped variables ──────────────────────────────────────

export async function setExecutionVariable(
  executionId: string,
  key: string,
  value: unknown,
  setByNodeKey?: string,
): Promise<void> {
  assertKey(key);
  await db
    .insert(workflowExecutionVariables)
    .values({
      workflowExecutionId: executionId,
      key,
      valueJson: value as unknown,
      setByNodeKey: setByNodeKey ?? null,
    })
    .onConflictDoUpdate({
      target: [workflowExecutionVariables.workflowExecutionId, workflowExecutionVariables.key],
      set: { valueJson: value as unknown, setByNodeKey: setByNodeKey ?? null, updatedAt: new Date() },
    });
}

export async function getExecutionVariable(executionId: string, key: string): Promise<unknown | undefined> {
  assertKey(key);
  const [row] = await db
    .select()
    .from(workflowExecutionVariables)
    .where(
      and(
        eq(workflowExecutionVariables.workflowExecutionId, executionId),
        eq(workflowExecutionVariables.key, key),
      ),
    )
    .limit(1);
  return row?.valueJson;
}

export async function listExecutionVariables(executionId: string): Promise<Record<string, unknown>> {
  const rows = await db
    .select()
    .from(workflowExecutionVariables)
    .where(eq(workflowExecutionVariables.workflowExecutionId, executionId));
  const out: Record<string, unknown> = {};
  for (const row of rows) out[row.key] = row.valueJson;
  return out;
}

export async function deleteExecutionVariable(executionId: string, key: string): Promise<boolean> {
  assertKey(key);
  const existing = await db
    .select({ id: workflowExecutionVariables.id })
    .from(workflowExecutionVariables)
    .where(
      and(
        eq(workflowExecutionVariables.workflowExecutionId, executionId),
        eq(workflowExecutionVariables.key, key),
      ),
    )
    .limit(1);
  if (existing.length === 0) return false;
  await db
    .delete(workflowExecutionVariables)
    .where(
      and(
        eq(workflowExecutionVariables.workflowExecutionId, executionId),
        eq(workflowExecutionVariables.key, key),
      ),
    );
  return true;
}

// ─── Agent short-memory ──────────────────────────────────────────────

export interface ShortMemoryEntry {
  key: string;
  value: unknown;
  expiresAt: Date | null;
  updatedAt: Date;
}

export async function rememberShortMemory(
  agentId: string,
  workspaceId: string,
  key: string,
  value: unknown,
  ttlSeconds?: number,
): Promise<void> {
  assertKey(key);
  const expiresAt = ttlSeconds && ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : null;
  await db
    .insert(agentShortMemories)
    .values({
      agentId,
      workspaceId,
      key,
      valueJson: value as unknown,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [agentShortMemories.agentId, agentShortMemories.key],
      set: { valueJson: value as unknown, expiresAt, updatedAt: new Date() },
    });
}

export async function recallShortMemory(agentId: string, key: string): Promise<unknown | undefined> {
  assertKey(key);
  const [row] = await db
    .select()
    .from(agentShortMemories)
    .where(and(eq(agentShortMemories.agentId, agentId), eq(agentShortMemories.key, key)))
    .limit(1);
  if (!row) return undefined;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    // Lazy-evict expired entries.
    await db.delete(agentShortMemories).where(eq(agentShortMemories.id, row.id));
    return undefined;
  }
  return row.valueJson;
}

export async function listShortMemories(agentId: string): Promise<ShortMemoryEntry[]> {
  const rows = await db
    .select()
    .from(agentShortMemories)
    .where(eq(agentShortMemories.agentId, agentId));
  const now = Date.now();
  return rows
    .filter((r) => !r.expiresAt || r.expiresAt.getTime() >= now)
    .map((r) => ({ key: r.key, value: r.valueJson, expiresAt: r.expiresAt, updatedAt: r.updatedAt }));
}

export async function forgetShortMemory(agentId: string, key: string): Promise<boolean> {
  assertKey(key);
  const existing = await db
    .select({ id: agentShortMemories.id })
    .from(agentShortMemories)
    .where(and(eq(agentShortMemories.agentId, agentId), eq(agentShortMemories.key, key)))
    .limit(1);
  if (existing.length === 0) return false;
  await db
    .delete(agentShortMemories)
    .where(and(eq(agentShortMemories.agentId, agentId), eq(agentShortMemories.key, key)));
  return true;
}

/** Maintenance: prune all expired short-memory rows. Called by controller. */
export async function pruneExpiredShortMemories(): Promise<number> {
  const expired = await db
    .select({ id: agentShortMemories.id })
    .from(agentShortMemories)
    .where(lt(agentShortMemories.expiresAt, new Date()));
  if (expired.length === 0) return 0;
  await db.delete(agentShortMemories).where(lt(agentShortMemories.expiresAt, new Date()));
  return expired.length;
}
