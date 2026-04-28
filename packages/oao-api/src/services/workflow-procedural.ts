/**
 * Procedural step executors for graph workflows.
 *
 * Three step kinds, all pure functions of `(node config, input, ctx)`:
 *
 *   - http_request: call an HTTP endpoint, return parsed body / status
 *   - script:       run a JavaScript snippet in a sandboxed `vm` context,
 *                   with read-only access to the input and a small set of
 *                   helpers, and a strict timeout
 *   - conditional:  evaluate a JS-ish boolean expression against the input
 *                   and return the chosen branch label
 *
 * No procedural step has direct DB / network access through OAO internals;
 * scripts run in a fresh `vm` context with only `console`, `JSON`, `Math`,
 * `Date`, and the provided input. HTTP requests use the standard `fetch`.
 */

import { runInNewContext } from 'node:vm';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import { createLogger } from '@oao/shared';

const logger = createLogger('workflow-procedural');

export interface ProceduralContext {
  workflowId: string;
  executionId: string;
  nodeKey: string;
  /** Variables already resolved for template rendering (properties only, NO credentials). */
  properties: Record<string, unknown>;
  /** Execution-scoped variables snapshot (read-only at call time). */
  executionVariables: Record<string, unknown>;
}

export interface HttpRequestConfig {
  method?: string; // default GET
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown; // JSON-serializable object or string
  timeoutMs?: number; // default 30s, max 120s
  jsonPath?: string; // optional dot-path to extract a sub-tree from JSON response
  /** When true, response body is treated as text. Default: auto by content-type. */
  responseAs?: 'auto' | 'json' | 'text';
}

export interface ScriptConfig {
  source: string;
  timeoutMs?: number; // default 5s, max 30s
  language?: 'javascript';
}

export interface ConditionalConfig {
  /**
   * JS expression evaluated against the node input. Allowed identifiers:
   *   `input`, `vars`, `props`, `Math`, `Number`, `String`, `Boolean`,
   *   `Array`, `Object`, `JSON`.
   * The evaluated value is coerced to a string and used as the branch key.
   * For boolean expressions, branch keys 'true' / 'false' are emitted.
   */
  expression: string;
}

// ─── HTTP ───────────────────────────────────────────────────────────

const MAX_HTTP_TIMEOUT_MS = 120_000;

export async function executeHttpRequest(
  config: HttpRequestConfig,
  input: unknown,
  _ctx: ProceduralContext,
): Promise<{ status: number; ok: boolean; body: unknown; headers: Record<string, string> }> {
  if (!config?.url || typeof config.url !== 'string') {
    throw new Error('http_request: `url` is required');
  }
  const method = (config.method ?? 'GET').toUpperCase();
  const timeoutMs = Math.min(Math.max(config.timeoutMs ?? 30_000, 100), MAX_HTTP_TIMEOUT_MS);

  // Build URL with query parameters.
  const url = new URL(config.url);
  if (config.query) {
    for (const [k, v] of Object.entries(config.query)) {
      url.searchParams.set(k, String(v));
    }
  }

  // Build body.
  let body: BodyInit | undefined;
  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  if (method !== 'GET' && method !== 'HEAD' && config.body !== undefined) {
    if (typeof config.body === 'string') {
      body = config.body;
    } else {
      body = JSON.stringify(config.body);
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['content-type'] = 'application/json';
      }
    }
  }
  // Inject input automatically when no explicit body and method allows one.
  if (body === undefined && method !== 'GET' && method !== 'HEAD' && input !== undefined) {
    body = JSON.stringify(input);
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  }

  const controller = new AbortController();
  const timer = nodeSetTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }

  const respHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });
  const contentType = response.headers.get('content-type') ?? '';
  let parsed: unknown;
  const responseAs = config.responseAs ?? 'auto';
  if (responseAs === 'text') {
    parsed = await response.text();
  } else if (responseAs === 'json' || contentType.includes('application/json')) {
    const text = await response.text();
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
  } else {
    parsed = await response.text();
  }

  if (config.jsonPath) {
    parsed = applyJsonPath(parsed, config.jsonPath);
  }

  logger.info(
    { url: url.toString(), method, status: response.status, ok: response.ok, nodeKey: _ctx.nodeKey },
    'http_request executed',
  );

  return { status: response.status, ok: response.ok, body: parsed, headers: respHeaders };
}

function applyJsonPath(value: unknown, path: string): unknown {
  if (!path) return value;
  let current: unknown = value;
  // Support simple dot/bracket paths: "data.items[0].name"
  const tokens = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

// ─── Sandboxed script ───────────────────────────────────────────────

const MAX_SCRIPT_TIMEOUT_MS = 30_000;

export function executeScript(
  config: ScriptConfig,
  input: unknown,
  ctx: ProceduralContext,
): Promise<unknown> {
  if (!config?.source || typeof config.source !== 'string') {
    return Promise.reject(new Error('script: `source` is required'));
  }
  if (config.language && config.language !== 'javascript') {
    return Promise.reject(
      new Error(`script: unsupported language "${config.language}". Only 'javascript' is allowed.`),
    );
  }
  const timeoutMs = Math.min(Math.max(config.timeoutMs ?? 5_000, 50), MAX_SCRIPT_TIMEOUT_MS);

  // Build a safe sandbox. No `require`, no `process`, no `globalThis` extras.
  // The user code is wrapped in an async IIFE so they can `await fetch`-less work.
  const sandbox: Record<string, unknown> = {
    console: {
      log: (...args: unknown[]) => logger.info({ nodeKey: ctx.nodeKey, args }, 'script log'),
      warn: (...args: unknown[]) => logger.warn({ nodeKey: ctx.nodeKey, args }, 'script warn'),
      error: (...args: unknown[]) => logger.error({ nodeKey: ctx.nodeKey, args }, 'script error'),
    },
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    input,
    vars: ctx.executionVariables,
    props: ctx.properties,
  };

  const wrapped = `(async () => {\n${config.source}\n})()`;
  return new Promise<unknown>((resolve, reject) => {
    try {
      const result = runInNewContext(wrapped, sandbox, {
        timeout: timeoutMs,
        displayErrors: true,
      });
      Promise.resolve(result).then(resolve, reject);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ─── Conditional ────────────────────────────────────────────────────

export function evaluateConditional(
  config: ConditionalConfig,
  input: unknown,
  ctx: ProceduralContext,
): { branchKey: string; raw: unknown } {
  if (!config?.expression || typeof config.expression !== 'string') {
    throw new Error('conditional: `expression` is required');
  }
  const sandbox: Record<string, unknown> = {
    input,
    vars: ctx.executionVariables,
    props: ctx.properties,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
  };
  let raw: unknown;
  try {
    raw = runInNewContext(`(${config.expression})`, sandbox, { timeout: 1000, displayErrors: true });
  } catch (err) {
    throw new Error(`conditional: expression failed — ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
  const branchKey =
    typeof raw === 'boolean' ? (raw ? 'true' : 'false') : raw === null || raw === undefined ? 'null' : String(raw);
  return { branchKey, raw };
}
