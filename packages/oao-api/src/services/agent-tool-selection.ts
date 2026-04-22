export const BUILTIN_TOOL_NAMES = [
  'schedule_next_workflow_execution',
  'manage_webhook_trigger',
  'record_decision',
  'memory_store',
  'memory_retrieve',
  'edit_workflow',
  'read_variables',
  'edit_variables',
  'simple_http_request',
] as const;

export type BuiltInToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export interface BuiltInToolCatalogEntry {
  name: BuiltInToolName;
  label: string;
  description: string;
  group: 'Workflow' | 'Knowledge' | 'Variables' | 'Network';
}

export interface ExplicitAgentToolSelection {
  mode: 'explicit';
  names: string[];
}

const BUILTIN_TOOL_NAME_SET = new Set<string>(BUILTIN_TOOL_NAMES);

export const BUILTIN_TOOL_CATALOG: ReadonlyArray<BuiltInToolCatalogEntry> = [
  {
    name: 'schedule_next_workflow_execution',
    label: 'Schedule Next Workflow Execution',
    description: 'Schedule a future run for the current workflow.',
    group: 'Workflow',
  },
  {
    name: 'manage_webhook_trigger',
    label: 'Manage Webhook Trigger',
    description: 'Create or deactivate workflow webhooks.',
    group: 'Workflow',
  },
  {
    name: 'edit_workflow',
    label: 'Edit Workflow',
    description: 'Inspect or update workflow steps and triggers.',
    group: 'Workflow',
  },
  {
    name: 'record_decision',
    label: 'Record Decision',
    description: 'Write an audit-trail entry for significant decisions.',
    group: 'Knowledge',
  },
  {
    name: 'memory_store',
    label: 'Memory Store',
    description: 'Store semantic memories for later retrieval.',
    group: 'Knowledge',
  },
  {
    name: 'memory_retrieve',
    label: 'Memory Retrieve',
    description: 'Search semantic memories by similarity.',
    group: 'Knowledge',
  },
  {
    name: 'read_variables',
    label: 'Read Variables',
    description: 'Read agent, user, or workspace variables.',
    group: 'Variables',
  },
  {
    name: 'edit_variables',
    label: 'Edit Variables',
    description: 'Create, update, or delete scoped variables.',
    group: 'Variables',
  },
  {
    name: 'simple_http_request',
    label: 'Simple HTTP Request',
    description: 'Make templated HTTP requests to external APIs.',
    group: 'Network',
  },
] as const;

function normalizeToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function isBuiltInToolName(name: string): name is BuiltInToolName {
  return BUILTIN_TOOL_NAME_SET.has(name);
}

export function isExplicitAgentToolSelection(value: unknown): value is ExplicitAgentToolSelection {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (value as { mode?: unknown }).mode === 'explicit',
  );
}

export function resolveAgentToolSelection(value: unknown) {
  const explicitToolSelection = isExplicitAgentToolSelection(value);
  const selectedToolNames = normalizeToolNames(explicitToolSelection ? value.names : value);

  return {
    explicitToolSelection,
    selectedToolNames,
    selectedBuiltinToolNames: selectedToolNames.filter(isBuiltInToolName),
  };
}

export function createExplicitAgentToolSelection(names: readonly string[]): ExplicitAgentToolSelection {
  return {
    mode: 'explicit',
    names: normalizeToolNames(names),
  };
}

export function countConfiguredTools(value: unknown): number {
  return resolveAgentToolSelection(value).selectedToolNames.length;
}