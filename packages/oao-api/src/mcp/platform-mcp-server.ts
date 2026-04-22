#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const apiBaseUrl = process.env.OAO_PLATFORM_API_URL;
const authToken = process.env.OAO_PLATFORM_TOKEN;
const defaultAgentId = process.env.OAO_AGENT_ID ?? null;

if (!apiBaseUrl) {
  throw new Error('OAO_PLATFORM_API_URL is required');
}

if (!authToken) {
  throw new Error('OAO_PLATFORM_TOKEN is required');
}

const server = new McpServer({
  name: 'oao-platform-mcp',
  version: '1.0.0',
});

function buildUrl(path: string, query?: Record<string, string | undefined>) {
  const url = new URL(path, apiBaseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function callApi<T extends Record<string, unknown>>(
  path: string,
  init?: RequestInit,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const response = await fetch(buildUrl(path, query), {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${authToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const responseText = await response.text();
  const parsed = responseText ? JSON.parse(responseText) : null;

  if (!response.ok) {
    const message = parsed?.error ?? `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return parsed as T;
}

function jsonResult(payload: Record<string, unknown>) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

function resolveAgentId(agentId: string | undefined, scope: 'agent' | 'user' | 'workspace') {
  if (scope !== 'agent') {
    return undefined;
  }

  const resolvedAgentId = agentId ?? defaultAgentId ?? undefined;
  if (!resolvedAgentId) {
    throw new Error('agentId is required for agent-scoped operations');
  }

  return resolvedAgentId;
}

const stepSchema = z.object({
  name: z.string().min(1).max(200),
  promptTemplate: z.string().min(1),
  stepOrder: z.number().int().min(1),
  agentId: z.string().uuid().optional(),
  model: z.string().max(100).optional(),
  reasoningEffort: z.enum(['high', 'medium', 'low']).optional(),
  workerRuntime: z.enum(['static', 'ephemeral']).optional(),
  timeoutSeconds: z.number().int().min(30).max(3600).default(300),
});

const triggerSchema = z.object({
  triggerType: z.enum(['manual', 'webhook', 'time_schedule', 'jira']),
  configuration: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().optional(),
});

server.registerTool('oao_list_agents', {
  description: 'List agents visible to the authenticated OAO user in the current workspace.',
  inputSchema: {
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
  },
}, async ({ page = 1, limit = 50 }) => {
  const result = await callApi('/api/agents', undefined, {
    page: String(page),
    limit: String(limit),
  });
  return jsonResult(result);
});

server.registerTool('oao_list_workflows', {
  description: 'List workflows visible to the authenticated OAO user in the current workspace.',
  inputSchema: {
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(50),
    labels: z.array(z.string()).optional(),
  },
}, async ({ page = 1, limit = 50, labels }) => {
  const result = await callApi('/api/workflows', undefined, {
    page: String(page),
    limit: String(limit),
    labels: labels?.join(','),
  });
  return jsonResult(result);
});

server.registerTool('oao_get_workflow', {
  description: 'Fetch a workflow with its steps and triggers by ID.',
  inputSchema: {
    id: z.string().uuid(),
  },
}, async ({ id }) => {
  const result = await callApi(`/api/workflows/${id}`);
  return jsonResult(result);
});

server.registerTool('oao_create_workflow', {
  description: 'Create a new workflow in OAO, including its steps and optional triggers.',
  inputSchema: {
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    labels: z.array(z.string().min(1).max(50)).max(10).default([]),
    defaultAgentId: z.string().uuid().optional(),
    defaultModel: z.string().max(100).optional(),
    defaultReasoningEffort: z.enum(['high', 'medium', 'low']).optional(),
    workerRuntime: z.enum(['static', 'ephemeral']).default('static'),
    stepAllocationTimeoutSeconds: z.number().int().min(15).max(3600).default(300),
    scope: z.enum(['user', 'workspace']).default('user'),
    steps: z.array(stepSchema).min(1).max(20),
    triggers: z.array(triggerSchema).optional(),
  },
}, async (payload) => {
  const result = await callApi('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return jsonResult(result);
});

server.registerTool('oao_update_workflow', {
  description: 'Update workflow metadata without replacing its steps.',
  inputSchema: {
    id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).optional(),
    labels: z.array(z.string().min(1).max(50)).max(10).optional(),
    isActive: z.boolean().optional(),
    defaultAgentId: z.string().uuid().nullable().optional(),
    defaultModel: z.string().max(100).nullable().optional(),
    defaultReasoningEffort: z.enum(['high', 'medium', 'low']).nullable().optional(),
    workerRuntime: z.enum(['static', 'ephemeral']).optional(),
    stepAllocationTimeoutSeconds: z.number().int().min(15).max(3600).optional(),
  },
}, async ({ id, ...payload }) => {
  const result = await callApi(`/api/workflows/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return jsonResult(result);
});

server.registerTool('oao_replace_workflow_steps', {
  description: 'Atomically replace every step in a workflow.',
  inputSchema: {
    id: z.string().uuid(),
    steps: z.array(stepSchema).min(1).max(20),
  },
}, async ({ id, steps }) => {
  const result = await callApi(`/api/workflows/${id}/steps`, {
    method: 'PUT',
    body: JSON.stringify({ steps }),
  });
  return jsonResult(result);
});

server.registerTool('oao_run_workflow', {
  description: 'Trigger a manual workflow run with optional inputs.',
  inputSchema: {
    id: z.string().uuid(),
    inputs: z.record(z.string(), z.unknown()).default({}),
  },
}, async ({ id, inputs = {} }) => {
  const result = await callApi(`/api/workflows/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ inputs }),
  });
  return jsonResult(result);
});

server.registerTool('oao_list_variables', {
  description: 'List variables in OAO for an agent, the current user, or the current workspace.',
  inputSchema: {
    scope: z.enum(['agent', 'user', 'workspace']).default('agent'),
    agentId: z.string().uuid().optional(),
  },
}, async ({ scope = 'agent', agentId }) => {
  const resolvedAgentId = resolveAgentId(agentId, scope);
  const result = await callApi('/api/variables', undefined, {
    scope: scope === 'agent' ? undefined : scope,
    agentId: resolvedAgentId,
  });
  return jsonResult(result);
});

server.registerTool('oao_get_variable', {
  description: 'Fetch a variable metadata record by ID.',
  inputSchema: {
    id: z.string().uuid(),
    scope: z.enum(['agent', 'user', 'workspace']).optional(),
  },
}, async ({ id, scope }) => {
  const result = await callApi(`/api/variables/${id}`, undefined, {
    scope,
  });
  return jsonResult(result);
});

server.registerTool('oao_create_variable', {
  description: 'Create or upsert an agent, user, or workspace variable in OAO.',
  inputSchema: {
    scope: z.enum(['agent', 'user', 'workspace']).default('agent'),
    agentId: z.string().uuid().optional(),
    key: z.string().min(1).max(100),
    value: z.string().min(1).max(50000),
    variableType: z.enum(['property', 'credential']).default('credential'),
    credentialSubType: z.enum(['secret_text', 'github_token', 'github_app', 'user_account', 'private_key', 'certificate']).default('secret_text'),
    injectAsEnvVariable: z.boolean().default(false),
    description: z.string().max(300).optional(),
  },
}, async ({ scope = 'agent', agentId, ...payload }) => {
  const resolvedAgentId = resolveAgentId(agentId, scope);
  const result = await callApi('/api/variables', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      scope,
      agentId: resolvedAgentId,
    }),
  });
  return jsonResult(result);
});

server.registerTool('oao_update_variable', {
  description: 'Update an existing variable in OAO.',
  inputSchema: {
    id: z.string().uuid(),
    scope: z.enum(['agent', 'user', 'workspace']).default('agent'),
    value: z.string().min(1).max(50000).optional(),
    variableType: z.enum(['property', 'credential']).optional(),
    credentialSubType: z.enum(['secret_text', 'github_token', 'github_app', 'user_account', 'private_key', 'certificate']).optional(),
    injectAsEnvVariable: z.boolean().optional(),
    description: z.string().max(300).optional(),
  },
}, async ({ id, ...payload }) => {
  const result = await callApi(`/api/variables/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return jsonResult(result);
});

server.registerTool('oao_delete_variable', {
  description: 'Delete a variable in OAO.',
  inputSchema: {
    id: z.string().uuid(),
    scope: z.enum(['agent', 'user', 'workspace']).default('agent'),
  },
}, async ({ id, scope = 'agent' }) => {
  const result = await callApi(`/api/variables/${id}`, {
    method: 'DELETE',
  }, {
    scope,
  });
  return jsonResult(result);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('OAO Platform MCP server running on stdio');
}

main().catch((error) => {
  console.error('OAO Platform MCP server error:', error);
  process.exit(1);
});