import nunjucks from 'nunjucks';

// Configure Nunjucks (Jinja2-compatible) environment
// - autoescape off: we render plain text prompts & JSON, not HTML
// - throwOnUndefined: false — undefined variables become empty strings
const env = new nunjucks.Environment(null, {
  autoescape: false,
  throwOnUndefined: false,
  trimBlocks: true,
  lstripBlocks: true,
});

/**
 * Render a Jinja2 template string with the given variables.
 *
 * Backward compatibility:
 *   - `<PRECEDENT_OUTPUT>` is auto-converted to `{{ precedent_output }}`
 *   - `{{ Properties.KEY }}` is auto-converted to `{{ properties.KEY }}`
 *
 * Available namespaces in the template context:
 *   - `properties.*`       — agent/user/workspace property values
 *   - `credentials.*`      — agent/user/workspace credential values
 *   - `precedent_output`   — output from the previous workflow step
 *   - `env.*`              — environment-injected variables
 *
 * Example template:
 *   "Analyse {{ properties.SYMBOL }} using key {{ credentials.API_KEY }}"
 *   "Previous result: {{ precedent_output }}"
 */
export function renderTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  // Backward compatibility: convert old-style placeholders to Jinja2
  const normalized = template
    .replace(/<PRECEDENT_OUTPUT>/g, '{{ precedent_output }}')
    .replace(/\{\{\s*Properties\.(\w+)\s*\}\}/g, '{{ properties.$1 }}');

  return env.renderString(normalized, context);
}

/**
 * Build a Jinja2 template context from the variable maps used during workflow execution.
 */
export function buildTemplateContext(params: {
  properties: Map<string, string>;
  credentials: Map<string, string>;
  envVariables?: Map<string, string>;
  precedentOutput?: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};

  // Flatten maps into nested objects for Jinja2 dot-notation access
  const propsObj: Record<string, string> = {};
  for (const [k, v] of params.properties) propsObj[k] = v;
  ctx['properties'] = propsObj;

  const credsObj: Record<string, string> = {};
  for (const [k, v] of params.credentials) credsObj[k] = v;
  ctx['credentials'] = credsObj;

  if (params.envVariables) {
    const envObj: Record<string, string> = {};
    for (const [k, v] of params.envVariables) envObj[k] = v;
    ctx['env'] = envObj;
  }

  if (params.precedentOutput !== undefined) {
    ctx['precedent_output'] = params.precedentOutput;
  }

  if (params.extra) {
    Object.assign(ctx, params.extra);
  }

  return ctx;
}
