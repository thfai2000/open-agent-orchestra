/**
 * Procedural step executor tests — http_request, script (vm sandbox), conditional.
 * No DB or network access needed (HTTP is mocked via fetch override).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  executeHttpRequest,
  executeScript,
  evaluateConditional,
  type ProceduralContext,
} from '../src/services/workflow-procedural.js';

const ctx: ProceduralContext = {
  workflowId: 'wf-1',
  executionId: 'exec-1',
  nodeKey: 'n1',
  properties: { greeting: 'hello' },
  executionVariables: { count: 3, items: ['a', 'b'] },
};

describe('executeHttpRequest', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('performs a GET request and parses JSON', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, items: [1, 2, 3] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    );
    const result = await executeHttpRequest({ url: 'https://api.example.com/data', method: 'GET' }, undefined, ctx);
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ ok: true, items: [1, 2, 3] });
  });

  it('applies jsonPath extraction', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ data: { items: [{ name: 'first' }, { name: 'second' }] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response,
    );
    const result = await executeHttpRequest(
      { url: 'https://api.example.com/data', jsonPath: 'data.items[1].name' },
      undefined,
      ctx,
    );
    expect(result.body).toBe('second');
  });

  it('serializes object body as JSON for POST', async () => {
    fetchSpy.mockResolvedValue(
      new Response('ok', { status: 201, headers: { 'content-type': 'text/plain' } }) as unknown as Response,
    );
    await executeHttpRequest(
      { url: 'https://api.example.com/data', method: 'POST', body: { hello: 'world' } },
      undefined,
      ctx,
    );
    const callArgs = fetchSpy.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"hello":"world"}');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
  });

  it('rejects when url missing', async () => {
    await expect(executeHttpRequest({ url: '' as unknown as string }, undefined, ctx)).rejects.toThrow(/url/);
  });
});

describe('executeScript', () => {
  it('returns the result of an async expression', async () => {
    const out = await executeScript({ source: 'return input * 2' }, 21, ctx);
    expect(out).toBe(42);
  });

  it('exposes input, vars, props', async () => {
    const out = await executeScript(
      { source: 'return { sum: input + vars.count, greet: props.greeting }' },
      10,
      ctx,
    );
    expect(out).toEqual({ sum: 13, greet: 'hello' });
  });

  it('respects timeout for runaway code', async () => {
    await expect(
      executeScript({ source: 'while (true) {}', timeoutMs: 100 }, undefined, ctx),
    ).rejects.toThrow();
  });

  it('rejects unsupported language', async () => {
    await expect(
      executeScript({ source: 'noop', language: 'python' as unknown as 'javascript' }, undefined, ctx),
    ).rejects.toThrow(/unsupported/i);
  });

  it('does not expose process or require', async () => {
    const out = await executeScript(
      {
        source: `
          let leaked = null;
          try { leaked = typeof process; } catch (e) { leaked = 'blocked'; }
          let req = null;
          try { req = typeof require; } catch (e) { req = 'blocked'; }
          return { leaked, req };
        `,
      },
      undefined,
      ctx,
    );
    expect(out).toEqual({ leaked: 'undefined', req: 'undefined' });
  });
});

describe('evaluateConditional', () => {
  it('returns true/false branch keys for boolean expressions', () => {
    expect(evaluateConditional({ expression: 'input > 5' }, 10, ctx).branchKey).toBe('true');
    expect(evaluateConditional({ expression: 'input > 5' }, 1, ctx).branchKey).toBe('false');
  });

  it('coerces string results to branch keys', () => {
    const out = evaluateConditional(
      { expression: "input.kind === 'A' ? 'alpha' : 'beta'" },
      { kind: 'A' },
      ctx,
    );
    expect(out.branchKey).toBe('alpha');
  });

  it('throws on syntax error', () => {
    expect(() => evaluateConditional({ expression: '1 +' }, undefined, ctx)).toThrow(/expression failed/);
  });

  it('access vars and props', () => {
    const out = evaluateConditional({ expression: 'vars.count + (props.greeting === "hello" ? 1 : 0)' }, undefined, ctx);
    expect(out.raw).toBe(4);
    expect(out.branchKey).toBe('4');
  });
});
