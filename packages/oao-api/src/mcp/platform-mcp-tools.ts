import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodTypeAny } from 'zod/v4';
import {
  platformCreateVariableBodySchema,
  platformCreateWorkflowBodySchema,
  platformDeleteVariableInputSchema,
  platformGetVariableInputSchema,
  platformGetWorkflowInputSchema,
  platformListAgentsInputSchema,
  platformListVariablesInputSchema,
  platformListWorkflowsInputSchema,
  platformReplaceWorkflowStepsInputSchema,
  platformRunWorkflowInputSchema,
  platformUpdateVariableInputSchema,
  platformUpdateWorkflowInputSchema,
} from '../contracts/platform-api.js';
import { PLATFORM_MCP_WRITE_TOOLS } from '../services/platform-mcp.js';

interface PlatformMcpHelpers {
  callApi: <T extends Record<string, unknown>>(
    path: string,
    init?: RequestInit,
    query?: Record<string, string | undefined>,
  ) => Promise<T>;
  jsonResult: (payload: Record<string, unknown>) => {
    content: Array<{ type: 'text'; text: string }>;
    structuredContent: Record<string, unknown>;
  };
  defaultAgentId: string | null;
}

interface PlatformMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  requiresPermission: boolean;
  execute: (params: Record<string, unknown>, helpers: PlatformMcpHelpers) => Promise<Record<string, unknown>>;
}

const writeToolSet = new Set<string>(PLATFORM_MCP_WRITE_TOOLS);

function resolveAgentId(agentId: string | undefined, defaultAgentId: string | null, scope: string | undefined) {
  if (scope && scope !== 'agent') {
    return undefined;
  }

  const resolvedAgentId = agentId ?? defaultAgentId ?? undefined;
  if (!resolvedAgentId) {
    throw new Error('agentId is required for agent-scoped operations');
  }

  return resolvedAgentId;
}

export const platformMcpToolDefinitions: ReadonlyArray<PlatformMcpToolDefinition> = [
  {
    name: 'oao_list_agents',
    description: 'List agents visible to the authenticated OAO user in the current workspace.',
    inputSchema: platformListAgentsInputSchema,
    requiresPermission: false,
    execute: async ({ page = 1, limit = 50 }, { callApi }) => {
      return callApi('/api/agents', undefined, {
        page: String(page),
        limit: String(limit),
      });
    },
  },
  {
    name: 'oao_list_workflows',
    description: 'List workflows visible to the authenticated OAO user in the current workspace.',
    inputSchema: platformListWorkflowsInputSchema,
    requiresPermission: false,
    execute: async ({ page = 1, limit = 50, labels }, { callApi }) => {
      return callApi('/api/workflows', undefined, {
        page: String(page),
        limit: String(limit),
        labels: Array.isArray(labels) ? labels.join(',') : undefined,
      });
    },
  },
  {
    name: 'oao_get_workflow',
    description: 'Fetch a workflow with its steps and triggers by ID.',
    inputSchema: platformGetWorkflowInputSchema,
    requiresPermission: false,
    execute: async ({ id }, { callApi }) => {
      return callApi(`/api/workflows/${String(id)}`);
    },
  },
  {
    name: 'oao_create_workflow',
    description: 'Create a new workflow in OAO, including its steps and optional triggers.',
    inputSchema: platformCreateWorkflowBodySchema,
    requiresPermission: true,
    execute: async (payload, { callApi }) => {
      return callApi('/api/workflows', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
  },
  {
    name: 'oao_update_workflow',
    description: 'Update workflow metadata without replacing its steps.',
    inputSchema: platformUpdateWorkflowInputSchema,
    requiresPermission: true,
    execute: async ({ id, ...payload }, { callApi }) => {
      return callApi(`/api/workflows/${String(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
  },
  {
    name: 'oao_replace_workflow_steps',
    description: 'Atomically replace every step in a workflow.',
    inputSchema: platformReplaceWorkflowStepsInputSchema,
    requiresPermission: true,
    execute: async ({ id, steps }, { callApi }) => {
      return callApi(`/api/workflows/${String(id)}/steps`, {
        method: 'PUT',
        body: JSON.stringify({ steps }),
      });
    },
  },
  {
    name: 'oao_run_workflow',
    description: 'Trigger a manual workflow run with optional inputs.',
    inputSchema: platformRunWorkflowInputSchema,
    requiresPermission: true,
    execute: async ({ id, inputs = {} }, { callApi }) => {
      return callApi(`/api/workflows/${String(id)}/run`, {
        method: 'POST',
        body: JSON.stringify({ inputs }),
      });
    },
  },
  {
    name: 'oao_list_variables',
    description: 'List variables in OAO for an agent, the current user, or the current workspace.',
    inputSchema: platformListVariablesInputSchema,
    requiresPermission: false,
    execute: async ({ scope = 'agent', agentId }, { callApi, defaultAgentId }) => {
      const resolvedAgentId = resolveAgentId(
        typeof agentId === 'string' ? agentId : undefined,
        defaultAgentId,
        typeof scope === 'string' ? scope : undefined,
      );

      return callApi('/api/variables', undefined, {
        scope: scope === 'agent' ? undefined : String(scope),
        agentId: resolvedAgentId,
      });
    },
  },
  {
    name: 'oao_get_variable',
    description: 'Fetch a variable metadata record by ID.',
    inputSchema: platformGetVariableInputSchema,
    requiresPermission: false,
    execute: async ({ id, scope }, { callApi }) => {
      return callApi(`/api/variables/${String(id)}`, undefined, {
        scope: typeof scope === 'string' ? scope : undefined,
      });
    },
  },
  {
    name: 'oao_create_variable',
    description: 'Create or upsert an agent, user, or workspace variable in OAO.',
    inputSchema: platformCreateVariableBodySchema,
    requiresPermission: true,
    execute: async ({ scope = 'agent', agentId, ...payload }, { callApi, defaultAgentId }) => {
      const resolvedAgentId = resolveAgentId(
        typeof agentId === 'string' ? agentId : undefined,
        defaultAgentId,
        typeof scope === 'string' ? scope : undefined,
      );

      return callApi('/api/variables', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          scope,
          agentId: resolvedAgentId,
        }),
      });
    },
  },
  {
    name: 'oao_update_variable',
    description: 'Update an existing variable in OAO.',
    inputSchema: platformUpdateVariableInputSchema,
    requiresPermission: true,
    execute: async ({ id, ...payload }, { callApi }) => {
      return callApi(`/api/variables/${String(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },
  },
  {
    name: 'oao_delete_variable',
    description: 'Delete a variable in OAO.',
    inputSchema: platformDeleteVariableInputSchema,
    requiresPermission: true,
    execute: async ({ id, scope = 'agent' }, { callApi }) => {
      return callApi(`/api/variables/${String(id)}`, {
        method: 'DELETE',
      }, {
        scope: String(scope),
      });
    },
  },
] as const;

export function registerPlatformMcpTools(server: McpServer, helpers: PlatformMcpHelpers) {
  for (const tool of platformMcpToolDefinitions) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.inputSchema,
    }, async (params) => {
      const result = await tool.execute(params as Record<string, unknown>, helpers);
      return helpers.jsonResult(result);
    });
  }
}

export function getPlatformMcpToolDescriptors() {
  return platformMcpToolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    requiresPermission: writeToolSet.has(tool.name),
  }));
}