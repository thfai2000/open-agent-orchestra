// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — Copilot SDK's Tool/defineTool generics have incompatible Zod type constraints
/**
 * Workflow-context agent tools.
 *
 * Surface these to the Copilot session ONLY when the agent is running as
 * part of a workflow execution (graph or sequential). They expose:
 *
 *   - workflow_get_variable / workflow_set_variable     workflow-scoped KV
 *   - execution_get_variable / execution_set_variable   per-execution KV
 *   - remember / recall                                  agent short-memory
 *
 * Workflow credentials are intentionally NOT readable from these tools to
 * preserve the secrets-out-of-prompts guarantee. Use the standard
 * `{{ credentials.* }}` Jinja context instead.
 */

import { defineTool, type Tool } from '@github/copilot-sdk';
import { z } from 'zod';
import { createLogger } from '@oao/shared';
import {
  getWorkflowVariable,
  setWorkflowVariable,
  listWorkflowVariables,
  getExecutionVariable,
  setExecutionVariable,
  listExecutionVariables,
  rememberShortMemory,
  recallShortMemory,
  listShortMemories,
  forgetShortMemory,
} from './workflow-scoped-variables.js';
import { getWorkspaceSettings } from './workspace-settings.js';

const logger = createLogger('workflow-agent-tools');

/** Drop credential rows from a variable list when the workspace guardrail is on. */
async function applyCredentialGuardrail<T extends { type?: string; variableType?: string }>(workspaceId: string | undefined, rows: T[]): Promise<T[]> {
  const s = await getWorkspaceSettings(workspaceId);
  if (!s.disallowCredentialAccessViaTools) return rows;
  return rows.filter((r) => (r.type ?? r.variableType) !== 'credential');
}

export interface WorkflowToolContext {
  agentId: string;
  workspaceId: string;
  workflowId: string;
  executionId: string;
  currentNodeKey?: string;
}

/**
 * Build the workflow-context tool list. Returns an empty array if the
 * caller has no executionId (i.e. not running inside a workflow).
 */
export function createWorkflowAgentTools(ctx: WorkflowToolContext): Tool[] {
  const tools: Tool[] = [];

  tools.push(
    defineTool('workflow_get_variable', {
      description:
        'Read a workflow-scoped variable (persists across all executions of this workflow). Returns null when the key is missing. Credential variables return a masked value.',
      parameters: z.object({
        key: z.string().describe('Variable key (letters, digits, _, ., -; max 100 chars).'),
      }),
      handler: async ({ key }) => {
        logger.info({ key, workflowId: ctx.workflowId }, 'Tool: workflow_get_variable');
        const v = await getWorkflowVariable(ctx.workflowId, key);
        if (!v) return { key, value: null, type: 'property', masked: false };
        const settings = await getWorkspaceSettings(ctx.workspaceId);
        if (settings.disallowCredentialAccessViaTools && (v.type === 'credential' || v.variableType === 'credential')) {
          return { key, value: null, type: 'credential', blocked: true, note: 'Credential access via agent tools is disabled by workspace policy. Use {{ credentials.' + key + ' }} in prompts/MCP/HTTP — values render server-side.' };
        }
        return v;
      },
    }),
  );

  tools.push(
    defineTool('workflow_set_variable', {
      description:
        'Create or update a workflow-scoped variable. Use type="property" for plain values, type="short_memory" for things the agent wants to remember across executions, or type="credential" for secrets (encrypted at rest, masked on read).',
      parameters: z.object({
        key: z.string(),
        value: z.unknown().describe('Any JSON value. Strings for credentials.'),
        type: z.enum(['property', 'credential', 'short_memory']).optional(),
        description: z.string().max(300).optional(),
      }),
      handler: async ({ key, value, type, description }) => {
        logger.info({ key, type, workflowId: ctx.workflowId }, 'Tool: workflow_set_variable');
        await setWorkflowVariable({
          workflowId: ctx.workflowId,
          key,
          value,
          type: type ?? 'property',
          description,
        });
        return { key, type: type ?? 'property', stored: true };
      },
    }),
  );

  tools.push(
    defineTool('workflow_list_variables', {
      description: 'List all workflow-scoped variables (credentials are masked).',
      parameters: z.object({}),
      handler: async () => {
        const list = await listWorkflowVariables(ctx.workflowId);
        const filtered = await applyCredentialGuardrail(ctx.workspaceId, list);
        return { variables: filtered };
      },
    }),
  );

  tools.push(
    defineTool('execution_get_variable', {
      description:
        'Read an execution-scoped variable. Execution variables live for the lifetime of the current workflow execution and are typically used to pass data between nodes.',
      parameters: z.object({ key: z.string() }),
      handler: async ({ key }) => {
        const value = await getExecutionVariable(ctx.executionId, key);
        return { key, value: value ?? null, found: value !== undefined };
      },
    }),
  );

  tools.push(
    defineTool('execution_set_variable', {
      description:
        'Create or update an execution-scoped variable. Cleared automatically when the workflow execution ends.',
      parameters: z.object({
        key: z.string(),
        value: z.unknown(),
      }),
      handler: async ({ key, value }) => {
        logger.info({ key, executionId: ctx.executionId, nodeKey: ctx.currentNodeKey }, 'Tool: execution_set_variable');
        await setExecutionVariable(ctx.executionId, key, value, ctx.currentNodeKey);
        return { key, stored: true };
      },
    }),
  );

  tools.push(
    defineTool('execution_list_variables', {
      description: 'List all execution-scoped variables for the current workflow execution.',
      parameters: z.object({}),
      handler: async () => {
        const map = await listExecutionVariables(ctx.executionId);
        return { variables: map };
      },
    }),
  );

  tools.push(
    defineTool('remember', {
      description:
        'Store an entry in the agent\'s short-term memory. Persists across executions, scoped to this agent. Optionally provide ttlSeconds to auto-expire.',
      parameters: z.object({
        key: z.string(),
        value: z.unknown(),
        ttlSeconds: z.number().int().positive().max(60 * 60 * 24 * 30).optional(),
      }),
      handler: async ({ key, value, ttlSeconds }) => {
        logger.info({ key, ttlSeconds, agentId: ctx.agentId }, 'Tool: remember');
        await rememberShortMemory(ctx.agentId, ctx.workspaceId, key, value, ttlSeconds);
        return { key, stored: true, ttlSeconds: ttlSeconds ?? null };
      },
    }),
  );

  tools.push(
    defineTool('recall', {
      description: 'Retrieve a value previously stored via the `remember` tool. Returns null when missing or expired.',
      parameters: z.object({ key: z.string() }),
      handler: async ({ key }) => {
        const value = await recallShortMemory(ctx.agentId, key);
        return { key, value: value ?? null, found: value !== undefined };
      },
    }),
  );

  tools.push(
    defineTool('list_short_memories', {
      description: 'List all entries in the agent\'s short-term memory.',
      parameters: z.object({}),
      handler: async () => {
        const entries = await listShortMemories(ctx.agentId);
        return { entries };
      },
    }),
  );

  tools.push(
    defineTool('forget', {
      description: 'Delete an entry from short-term memory.',
      parameters: z.object({ key: z.string() }),
      handler: async ({ key }) => {
        const deleted = await forgetShortMemory(ctx.agentId, key);
        return { key, deleted };
      },
    }),
  );

  return tools;
}
