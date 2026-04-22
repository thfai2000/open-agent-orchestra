#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPlatformMcpTools } from './platform-mcp-tools.js';

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

registerPlatformMcpTools(server, {
  callApi,
  jsonResult,
  defaultAgentId,
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