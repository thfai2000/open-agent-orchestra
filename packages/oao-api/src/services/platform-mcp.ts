import * as jose from 'jose';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { createLogger } from '@oao/shared';
import { db } from '../database/index.js';
import { mcpServerConfigs, users, workspaces } from '../database/schema.js';
import { renderTemplate } from './jinja-renderer.js';
import { connectToMcpServer, type McpServerConfig, type McpToolDescriptor } from './mcp-client.js';

const logger = createLogger('platform-mcp');

const PLATFORM_MCP_TOKEN_EXPIRY = '2h';

export const PLATFORM_MCP_SERVER_NAME = 'OAO Platform';
export const PLATFORM_MCP_SERVER_TYPE = 'oao_platform';
export const PLATFORM_MCP_SENTINEL_COMMAND = 'oao-platform-mcp';
export const PLATFORM_MCP_WRITE_TOOLS = [
  'oao_create_workflow',
  'oao_update_workflow',
  'oao_run_trigger',
  'oao_create_variable',
  'oao_update_variable',
  'oao_delete_variable',
] as const;

export interface PlatformMcpAuthContext {
  agentId: string;
  userId: string;
  workspaceId: string;
}

export interface AgentMcpSource {
  id: string;
  mcpJsonTemplate: string | null;
}

interface RenderedMcpJson {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

export interface McpToolCatalogGroup {
  key: string;
  label: string;
  source: 'platform' | 'stored_mcp' | 'template_mcp';
  description: string | null;
  authNote?: string | null;
  tools: McpToolDescriptor[];
  error?: string;
}

type McpServerConfigRecord = typeof mcpServerConfigs.$inferSelect;

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET environment variable is required');
  return new TextEncoder().encode(secret);
}

export function resolvePlatformApiUrl(): string {
  if (process.env.OAO_PLATFORM_API_URL) {
    return process.env.OAO_PLATFORM_API_URL;
  }

  if (process.env.NODE_ENV === 'production' || process.env.KUBERNETES_SERVICE_HOST) {
    return `http://oao-api:${Number(process.env.AGENT_API_PORT) || 4002}`;
  }

  return process.env.PUBLIC_API_BASE_URL || `http://127.0.0.1:${Number(process.env.AGENT_API_PORT) || 4002}`;
}

function resolvePlatformServerEntry(): { command: string; args: string[] } {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const compiledEntry = join(currentDir, '..', 'mcp', 'platform-mcp-server.js');
  const sourceEntry = join(currentDir, '..', 'mcp', 'platform-mcp-server.ts');

  if (existsSync(compiledEntry)) {
    return { command: process.execPath, args: [compiledEntry] };
  }

  return { command: process.execPath, args: ['--import', 'tsx', sourceEntry] };
}

export function buildDefaultPlatformMcpServerValues(agentId: string): typeof mcpServerConfigs.$inferInsert {
  return {
    agentId,
    serverType: PLATFORM_MCP_SERVER_TYPE,
    name: PLATFORM_MCP_SERVER_NAME,
    description: 'System-managed MCP server for OAO platform workflows and variables.',
    command: PLATFORM_MCP_SENTINEL_COMMAND,
    args: [],
    envMapping: {},
    isEnabled: true,
    writeTools: [...PLATFORM_MCP_WRITE_TOOLS],
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasPersistedAgentId(agentId: string) {
  return uuidPattern.test(agentId);
}

export async function ensureDefaultPlatformMcpServerConfig(agentId: string): Promise<void> {
  const existing = await db.query.mcpServerConfigs.findFirst({
    where: and(
      eq(mcpServerConfigs.agentId, agentId),
      eq(mcpServerConfigs.serverType, PLATFORM_MCP_SERVER_TYPE),
    ),
  });

  if (existing) {
    return;
  }

  await db.insert(mcpServerConfigs).values(buildDefaultPlatformMcpServerValues(agentId));
}

async function createPlatformMcpToken(authContext: PlatformMcpAuthContext): Promise<string> {
  const [user, workspace] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, authContext.userId),
    }),
    db.query.workspaces.findFirst({
      where: eq(workspaces.id, authContext.workspaceId),
    }),
  ]);

  if (!user) {
    throw new Error(`User ${authContext.userId} not found for platform MCP session`);
  }

  if (user.workspaceId !== authContext.workspaceId) {
    throw new Error(`User ${authContext.userId} is not in workspace ${authContext.workspaceId}`);
  }

  if (!workspace) {
    throw new Error(`Workspace ${authContext.workspaceId} not found for platform MCP session`);
  }

  return new jose.SignJWT({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    authProvider: user.authProvider,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(PLATFORM_MCP_TOKEN_EXPIRY)
    .sign(getJwtSecret());
}

async function resolveRuntimeMcpServerConfig(
  config: McpServerConfigRecord,
  credentials: Map<string, string>,
  authContext: PlatformMcpAuthContext,
): Promise<McpServerConfig> {
  if (config.serverType === PLATFORM_MCP_SERVER_TYPE) {
    const serverEntry = resolvePlatformServerEntry();
    const platformToken = await createPlatformMcpToken(authContext);

    return {
      name: config.name,
      command: serverEntry.command,
      args: serverEntry.args,
      env: {
        OAO_PLATFORM_API_URL: resolvePlatformApiUrl(),
        OAO_PLATFORM_TOKEN: platformToken,
        OAO_AGENT_ID: authContext.agentId,
        OAO_USER_ID: authContext.userId,
        OAO_WORKSPACE_ID: authContext.workspaceId,
      },
      writeTools: (config.writeTools ?? []) as string[],
    };
  }

  const envMapping = (config.envMapping ?? {}) as Record<string, string>;
  const resolvedEnv: Record<string, string> = {};
  for (const [credentialKey, envVar] of Object.entries(envMapping)) {
    const value = credentials.get(credentialKey);
    if (value) {
      resolvedEnv[envVar] = value;
    }
  }

  return {
    name: config.name,
    command: config.command,
    args: (config.args ?? []) as string[],
    env: resolvedEnv,
    writeTools: (config.writeTools ?? []) as string[],
  };
}

function withDefaultPlatformConfig(
  agentId: string,
  configs: McpServerConfigRecord[],
): McpServerConfigRecord[] {
  if (configs.some((config) => config.serverType === PLATFORM_MCP_SERVER_TYPE)) {
    return configs;
  }

  return [
    ...configs,
    {
      id: `virtual-${agentId}`,
      ...buildDefaultPlatformMcpServerValues(agentId),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ] as McpServerConfigRecord[];
}

function renderMcpJsonTemplate(template: string, templateContext: Record<string, unknown>): RenderedMcpJson {
  const renderedMcpJson = renderTemplate(template, templateContext);
  return JSON.parse(renderedMcpJson) as RenderedMcpJson;
}

function normalizeCatalogTools(toolDescriptors: McpToolDescriptor[]): McpToolDescriptor[] {
  return [...toolDescriptors].sort((left, right) => left.name.localeCompare(right.name));
}

export async function listConfiguredMcpToolCatalog(params: {
  agent: AgentMcpSource;
  credentials: Map<string, string>;
  templateContext: Record<string, unknown>;
  authContext: PlatformMcpAuthContext;
  mcpJsonTemplateOverride?: string | null;
  logContext: string;
}): Promise<McpToolCatalogGroup[]> {
  const { agent, credentials, templateContext, authContext, mcpJsonTemplateOverride, logContext } = params;
  const cleanups: Array<() => Promise<void>> = [];

  try {
    const groups: McpToolCatalogGroup[] = [];
    const storedConfigs = hasPersistedAgentId(agent.id)
      ? await db.query.mcpServerConfigs.findMany({
        where: eq(mcpServerConfigs.agentId, agent.id),
      })
      : [];

    const configs = withDefaultPlatformConfig(agent.id, storedConfigs).filter((config) => config.isEnabled);

    for (const mcpConfig of configs) {
      const source = mcpConfig.serverType === PLATFORM_MCP_SERVER_TYPE ? 'platform' : 'stored_mcp';

      try {
        const runtimeConfig = await resolveRuntimeMcpServerConfig(mcpConfig, credentials, authContext);
        const mcp = await connectToMcpServer(runtimeConfig);
        cleanups.push(mcp.cleanup);

        groups.push({
          key: `${source}:${mcpConfig.id}`,
          label: mcpConfig.name,
          source,
          description: mcpConfig.description ?? null,
          authNote: source === 'platform'
            ? 'Auto-included. Authenticated as the current signed-in OAO user via a short-lived JWT. No mcp.json.template entry is required.'
            : null,
          tools: normalizeCatalogTools(mcp.toolDescriptors),
        });
      } catch (error) {
        groups.push({
          key: `${source}:${mcpConfig.id}`,
          label: mcpConfig.name,
          source,
          description: mcpConfig.description ?? null,
          authNote: source === 'platform'
            ? 'Auto-included. Authenticated as the current signed-in OAO user via a short-lived JWT. No mcp.json.template entry is required.'
            : null,
          tools: [],
          error: error instanceof Error ? error.message : 'Failed to connect MCP server.',
        });
        logger.warn({ server: mcpConfig.name, error, logContext }, 'Failed to inspect MCP server for tool catalog');
      }
    }

    const resolvedTemplate = mcpJsonTemplateOverride !== undefined
      ? mcpJsonTemplateOverride
      : agent.mcpJsonTemplate;

    if (resolvedTemplate) {
      try {
        const mcpJson = renderMcpJsonTemplate(resolvedTemplate, templateContext);

        for (const [serverName, serverConfig] of Object.entries(mcpJson.mcpServers ?? {})) {
          try {
            const mcp = await connectToMcpServer({
              name: serverName,
              command: serverConfig.command,
              args: serverConfig.args ?? [],
              env: serverConfig.env ?? {},
            });
            cleanups.push(mcp.cleanup);

            groups.push({
              key: `template:${serverName}`,
              label: serverName,
              source: 'template_mcp',
              description: 'Discovered from mcp.json.template.',
              tools: normalizeCatalogTools(mcp.toolDescriptors),
            });
          } catch (error) {
            groups.push({
              key: `template:${serverName}`,
              label: serverName,
              source: 'template_mcp',
              description: 'Discovered from mcp.json.template.',
              tools: [],
              error: error instanceof Error ? error.message : 'Failed to connect MCP server from template.',
            });
            logger.warn({ server: serverName, error, logContext }, 'Failed to inspect MCP server from template');
          }
        }
      } catch (error) {
        groups.push({
          key: 'template:parse',
          label: 'MCP JSON Template',
          source: 'template_mcp',
          description: 'Discovered from mcp.json.template.',
          tools: [],
          error: error instanceof Error ? error.message : 'Failed to render or parse mcp.json.template.',
        });
        logger.warn({ error, logContext }, 'Failed to inspect mcp.json.template for tool catalog');
      }
    }

    return groups;
  } finally {
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

export async function loadConfiguredMcpTools(params: {
  agent: AgentMcpSource;
  credentials: Map<string, string>;
  templateContext: Record<string, unknown>;
  authContext: PlatformMcpAuthContext;
  enabledToolNames?: string[];
  mcpCleanups: Array<() => Promise<void>>;
  logContext: string;
}) {
  const { agent, credentials, templateContext, authContext, enabledToolNames, mcpCleanups, logContext } = params;

  const storedConfigs = hasPersistedAgentId(agent.id)
    ? await db.query.mcpServerConfigs.findMany({
      where: eq(mcpServerConfigs.agentId, agent.id),
    })
    : [];

  const configs = withDefaultPlatformConfig(agent.id, storedConfigs).filter((config) => config.isEnabled);
  const tools = [];

  for (const mcpConfig of configs) {
    try {
      const runtimeConfig = await resolveRuntimeMcpServerConfig(mcpConfig, credentials, authContext);
        const mcp = await connectToMcpServer(runtimeConfig, { enabledToolNames });
      tools.push(...mcp.tools);
      mcpCleanups.push(mcp.cleanup);
      logger.info({ server: mcpConfig.name, mcpToolCount: mcp.tools.length, logContext }, 'MCP tools loaded');
    } catch (error) {
      logger.warn({ server: mcpConfig.name, error, logContext }, 'Failed to connect MCP server, skipping');
    }
  }

  if (agent.mcpJsonTemplate) {
    try {
      const mcpJson = renderMcpJsonTemplate(agent.mcpJsonTemplate, templateContext);

      if (mcpJson.mcpServers) {
        for (const [serverName, serverConfig] of Object.entries(mcpJson.mcpServers)) {
          try {
            const mcp = await connectToMcpServer({
              name: serverName,
              command: serverConfig.command,
              args: serverConfig.args ?? [],
              env: serverConfig.env ?? {},
            }, { enabledToolNames });
            tools.push(...mcp.tools);
            mcpCleanups.push(mcp.cleanup);
            logger.info({ server: serverName, mcpToolCount: mcp.tools.length, logContext }, 'MCP tools loaded from mcp.json.template');
          } catch (error) {
            logger.warn({ server: serverName, error, logContext }, 'Failed to connect MCP server from template, skipping');
          }
        }
      }
    } catch (error) {
      logger.warn({ error, logContext }, 'Failed to render or parse mcp.json.template, skipping');
    }
  }

  return tools;
}