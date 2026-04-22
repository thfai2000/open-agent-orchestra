interface ExplicitAgentToolSelection {
  mode: 'explicit';
  names: string[];
}

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

export function isExplicitAgentToolSelection(value: unknown): value is ExplicitAgentToolSelection {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && (value as { mode?: unknown }).mode === 'explicit',
  );
}

export function extractAgentSelectedToolNames(value: unknown): string[] {
  return normalizeToolNames(isExplicitAgentToolSelection(value) ? value.names : value);
}

export function countAgentSelectedTools(value: unknown): number {
  return extractAgentSelectedToolNames(value).length;
}

export function buildExplicitAgentToolSelection(names: readonly string[]): ExplicitAgentToolSelection {
  return {
    mode: 'explicit',
    names: normalizeToolNames(names),
  };
}