// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — Copilot SDK's Tool/defineTool generics have incompatible Zod type constraints
/**
 * Generic MCP Client for connecting to any MCP server via stdio transport.
 *
 * Spawns an MCP server as a child process and converts its tools into
 * Copilot SDK Tool[] format for agent sessions. Domain-agnostic — works
 * with any MCP-compliant server.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { defineTool, type Tool } from '@github/copilot-sdk';
import { z } from 'zod';
import { createLogger } from '@ai-trader/shared';

const logger = createLogger('mcp-client');

export interface McpServerConfig {
  /** Display name for this MCP server */
  name: string;
  /** Command to spawn the MCP server process (e.g. "node", "npx", "python") */
  command: string;
  /** Arguments for the command (e.g. ["--import", "tsx", "server.ts"]) */
  args: string[];
  /** Environment variables to pass to the MCP server process */
  env: Record<string, string>;
  /** Tool names that require permission (write operations). Empty = all tools skip permission. */
  writeTools?: string[];
}

interface McpToolSchema {
  type: string;
  properties?: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown; items?: unknown }>;
  required?: string[];
}

/**
 * Connect to an MCP server via stdio and return Copilot SDK tools.
 *
 * The returned tools proxy all calls through the MCP protocol to the server.
 * Call `cleanup()` when done to terminate the child process.
 */
export async function connectToMcpServer(
  config: McpServerConfig,
): Promise<{ tools: Tool[]; cleanup: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env, ...config.env } as Record<string, string>,
  });

  const client = new Client({ name: 'agent-orchestra', version: '1.0.0' });
  await client.connect(transport);

  // List all tools from the MCP server
  const { tools: mcpTools } = await client.listTools();
  logger.info({ server: config.name, count: mcpTools.length }, 'Connected to MCP server');

  const writeToolSet = new Set(config.writeTools ?? []);

  // Convert each MCP tool into a Copilot SDK tool
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Tool[] = mcpTools.map((mcpTool: any) => {
    const schema = (mcpTool.inputSchema ?? {}) as McpToolSchema;
    const zodShape: Record<string, z.ZodTypeAny> = {};

    // Build a Zod schema from the JSON Schema properties
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        let field: z.ZodTypeAny;

        if (prop.enum) {
          field = z.enum(prop.enum as [string, ...string[]]);
        } else if (prop.type === 'number' || prop.type === 'integer') {
          field = z.number();
        } else if (prop.type === 'boolean') {
          field = z.boolean();
        } else if (prop.type === 'array') {
          field = z.array(z.string());
        } else {
          field = z.string();
        }

        if (prop.description) field = field.describe(prop.description);

        // If not required, make optional
        if (!schema.required?.includes(key)) {
          field = field.optional();
        }

        zodShape[key] = field;
      }
    }

    // Whether this tool needs permission (write operations)
    const skipPermission = !writeToolSet.has(mcpTool.name);

    return defineTool(mcpTool.name, {
      description: mcpTool.description ?? mcpTool.name,
      parameters: z.object(zodShape),
      skipPermission,
      handler: async (params: Record<string, unknown>) => {
        logger.info({ server: config.name, tool: mcpTool.name, params }, `MCP tool call: ${mcpTool.name}`);
        const result = await client.callTool({ name: mcpTool.name, arguments: params });
        // Extract text content from MCP result
        const contents = result.content as Array<{ type: string; text?: string }>;
        const text = contents?.find((c) => c.type === 'text')?.text;
        if (text) {
          try {
            return JSON.parse(text);
          } catch {
            return { result: text };
          }
        }
        return result;
      },
    });
  });

  const cleanup = async () => {
    try {
      await client.close();
    } catch {
      // ignore cleanup errors
    }
  };

  return { tools, cleanup };
}
