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
import { createLogger } from '@oao/shared';

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

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
  requiresPermission: boolean;
}

interface ListedMcpTool {
  name: string;
  description?: string;
  inputSchema?: McpToolSchema;
}

interface McpToolSchema {
  type?: string | string[];
  properties?: Record<string, McpToolSchema>;
  required?: string[];
  items?: McpToolSchema;
  enum?: string[];
  description?: string;
  default?: unknown;
  additionalProperties?: boolean | McpToolSchema;
  anyOf?: McpToolSchema[];
  oneOf?: McpToolSchema[];
}

function getSchemaType(schema: McpToolSchema): string | undefined {
  if (Array.isArray(schema.type)) {
    return schema.type.find((value) => value !== 'null') ?? schema.type[0];
  }
  return schema.type;
}

function schemaToZod(schema: McpToolSchema, isRequired = true): z.ZodTypeAny {
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants?.length) {
    return schemaToZod(variants[0], isRequired);
  }

  let field: z.ZodTypeAny;

  if (schema.enum?.length) {
    field = z.enum(schema.enum as [string, ...string[]]);
  } else {
    switch (getSchemaType(schema)) {
      case 'number':
        field = z.number();
        break;
      case 'integer':
        field = z.number().int();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'array':
        field = z.array(schemaToZod(schema.items ?? { type: 'string' }));
        break;
      case 'object':
        if (schema.properties && Object.keys(schema.properties).length > 0) {
          const required = new Set(schema.required ?? []);
          const shape: Record<string, z.ZodTypeAny> = {};
          for (const [key, propertySchema] of Object.entries(schema.properties)) {
            shape[key] = schemaToZod(propertySchema, required.has(key));
          }

          field = z.object(shape);
          if (schema.additionalProperties) {
            field = field.passthrough();
          }
        } else if (typeof schema.additionalProperties === 'object') {
          field = z.record(schemaToZod(schema.additionalProperties));
        } else {
          field = z.record(z.unknown());
        }
        break;
      case 'string':
        field = z.string();
        break;
      default:
        field = z.unknown();
        break;
    }
  }

  if (schema.description) {
    field = field.describe(schema.description);
  }

  if (schema.default !== undefined) {
    field = field.default(schema.default as never);
  }

  if (!isRequired) {
    field = field.optional();
  }

  return field;
}

/**
 * Connect to an MCP server via stdio and return Copilot SDK tools.
 *
 * The returned tools proxy all calls through the MCP protocol to the server.
 * Call `cleanup()` when done to terminate the child process.
 */
export async function connectToMcpServer(
  config: McpServerConfig,
  options?: { enabledToolNames?: string[] },
): Promise<{ tools: Tool[]; toolDescriptors: McpToolDescriptor[]; cleanup: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: { ...process.env, ...config.env } as Record<string, string>,
  });

  const client = new Client({ name: 'open-agent-orchestra', version: '1.0.0' });
  await client.connect(transport);

  // List all tools from the MCP server
  const { tools: rawTools } = await client.listTools();
  const mcpTools = rawTools as ListedMcpTool[];
  logger.info({ server: config.name, count: mcpTools.length }, 'Connected to MCP server');

  const writeToolSet = new Set(config.writeTools ?? []);
  const enabledToolSet = options?.enabledToolNames ? new Set(options.enabledToolNames) : null;

  const toolDescriptors: McpToolDescriptor[] = mcpTools.map((mcpTool) => ({
    name: mcpTool.name,
    description: mcpTool.description ?? mcpTool.name,
    inputSchema: (mcpTool.inputSchema ?? {}) as McpToolSchema,
    requiresPermission: writeToolSet.has(mcpTool.name),
  }));

  const selectedMcpTools = enabledToolSet
    ? mcpTools.filter((mcpTool) => enabledToolSet.has(mcpTool.name))
    : mcpTools;

  // Convert each MCP tool into a Copilot SDK tool
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Tool[] = selectedMcpTools.map((mcpTool: any) => {
    const schema = (mcpTool.inputSchema ?? {}) as McpToolSchema;
    const zodShape: Record<string, z.ZodTypeAny> = {};

    // Build a Zod schema from the JSON Schema properties
    if (schema.properties) {
      const required = new Set(schema.required ?? []);
      for (const [key, prop] of Object.entries(schema.properties)) {
        zodShape[key] = schemaToZod(prop, required.has(key));
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

  return { tools, toolDescriptors, cleanup };
}
