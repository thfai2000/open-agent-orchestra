import {
  BUILTIN_TOOL_CATALOG,
  resolveAgentToolSelection,
} from './agent-tool-selection.js';
import { buildTemplateContext } from './jinja-renderer.js';
import {
  listConfiguredMcpToolCatalog,
  type AgentMcpSource,
} from './platform-mcp.js';
import { resolveAgentTemplateContextMaps } from './resolved-agent-variables.js';

export interface ToolCatalogTool {
  name: string;
  label?: string;
  description?: string;
  group?: string | null;
  requiresPermission: boolean;
}

export interface ToolCatalogGroup {
  key: string;
  label: string;
  source: 'builtin' | 'platform' | 'stored_mcp' | 'template_mcp';
  description: string | null;
  authNote?: string | null;
  tools: ToolCatalogTool[];
  error?: string;
}

export interface ResolvedToolCatalog {
  selectionMode: 'legacy' | 'explicit';
  defaultSelectedToolNames: string[];
  effectiveSelectedToolNames: string[];
  unresolvedSelectedToolNames: string[];
  groups: ToolCatalogGroup[];
}

function sortToolNames(names: Iterable<string>): string[] {
  return Array.from(new Set(names)).sort((left, right) => left.localeCompare(right));
}

function resolveSelectedToolNames(params: {
  groups: ToolCatalogGroup[];
  selectionValue: unknown;
}) {
  const { groups, selectionValue } = params;
  const toolSelection = resolveAgentToolSelection(selectionValue);
  const discoveredToolNames = new Set(groups.flatMap((group) => group.tools.map((tool) => tool.name)));
  const selectedToolNames = new Set<string>(toolSelection.selectedBuiltinToolNames);

  for (const group of groups) {
    if (group.source === 'builtin') continue;

    for (const tool of group.tools) {
      if (toolSelection.explicitToolSelection) {
        if (toolSelection.selectedToolNames.includes(tool.name)) {
          selectedToolNames.add(tool.name);
        }
        continue;
      }

      selectedToolNames.add(tool.name);
    }
  }

  return {
    selectionMode: toolSelection.explicitToolSelection ? 'explicit' as const : 'legacy' as const,
    selectedToolNames: sortToolNames(selectedToolNames),
    unresolvedSelectedToolNames: toolSelection.explicitToolSelection
      ? sortToolNames(toolSelection.selectedToolNames.filter((toolName) => !discoveredToolNames.has(toolName)))
      : [],
  };
}

export async function resolveAgentToolCatalog(params: {
  agent: AgentMcpSource;
  userId: string;
  workspaceId: string;
  defaultSelectionValue: unknown;
  effectiveSelectionValue?: unknown;
  mcpJsonTemplateOverride?: string | null;
  logContext: string;
}): Promise<ResolvedToolCatalog> {
  const {
    agent,
    userId,
    workspaceId,
    defaultSelectionValue,
    effectiveSelectionValue,
    mcpJsonTemplateOverride,
    logContext,
  } = params;

  const { credentials, properties, envVariables } = await resolveAgentTemplateContextMaps({
    agentId: agent.id,
    userId,
    workspaceId,
  });
  const templateContext = buildTemplateContext({ credentials, properties, envVariables });

  const mcpGroups = await listConfiguredMcpToolCatalog({
    agent,
    credentials,
    templateContext,
    authContext: {
      agentId: agent.id,
      userId,
      workspaceId,
    },
    mcpJsonTemplateOverride,
    logContext,
  });

  const groups: ToolCatalogGroup[] = [
    {
      key: 'builtin:core',
      label: 'Built-in Tools',
      source: 'builtin',
      description: 'Native OAO tools available without an MCP server.',
      tools: BUILTIN_TOOL_CATALOG.map((tool) => ({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        group: tool.group,
        requiresPermission: false,
      })),
    },
    ...mcpGroups,
  ];

  const defaultSelection = resolveSelectedToolNames({
    groups,
    selectionValue: defaultSelectionValue,
  });
  const effectiveSelection = effectiveSelectionValue === undefined
    ? defaultSelection
    : resolveSelectedToolNames({
      groups,
      selectionValue: effectiveSelectionValue,
    });

  return {
    selectionMode: effectiveSelection.selectionMode,
    defaultSelectedToolNames: defaultSelection.selectedToolNames,
    effectiveSelectedToolNames: effectiveSelection.selectedToolNames,
    unresolvedSelectedToolNames: effectiveSelection.unresolvedSelectedToolNames,
    groups,
  };
}