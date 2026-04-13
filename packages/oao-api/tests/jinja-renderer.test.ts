/**
 * Jinja2 template renderer tests.
 * Tests renderTemplate() and buildTemplateContext() from the jinja-renderer service.
 */
import { describe, it, expect } from 'vitest';
import { renderTemplate, buildTemplateContext } from '../src/services/jinja-renderer.js';

describe('renderTemplate', () => {
  it('renders simple variable substitution', () => {
    const result = renderTemplate('Hello {{ name }}', { name: 'World' });
    expect(result).toBe('Hello World');
  });

  it('renders nested dot-notation variables', () => {
    const result = renderTemplate('Key: {{ properties.API_KEY }}', {
      properties: { API_KEY: 'sk-123' },
    });
    expect(result).toBe('Key: sk-123');
  });

  it('renders undefined variables as empty strings', () => {
    const result = renderTemplate('Value: [{{ missing }}]', {});
    expect(result).toBe('Value: []');
  });

  it('handles backward-compat <PRECEDENT_OUTPUT> placeholder', () => {
    const result = renderTemplate('Previous: <PRECEDENT_OUTPUT>', {
      precedent_output: 'step-1-result',
    });
    expect(result).toBe('Previous: step-1-result');
  });

  it('handles backward-compat {{ Properties.KEY }} placeholder', () => {
    const result = renderTemplate('Symbol: {{ Properties.SYMBOL }}', {
      properties: { SYMBOL: 'AAPL' },
    });
    expect(result).toBe('Symbol: AAPL');
  });

  it('renders Jinja2 conditionals', () => {
    const template = '{% if active %}ON{% else %}OFF{% endif %}';
    expect(renderTemplate(template, { active: true })).toBe('ON');
    expect(renderTemplate(template, { active: false })).toBe('OFF');
  });

  it('renders Jinja2 loops', () => {
    const template = '{% for item in items %}{{ item }},{% endfor %}';
    const result = renderTemplate(template, { items: ['a', 'b', 'c'] });
    expect(result).toBe('a,b,c,');
  });

  it('renders filters', () => {
    const result = renderTemplate('{{ name | upper }}', { name: 'hello' });
    expect(result).toBe('HELLO');
  });

  it('handles empty template', () => {
    expect(renderTemplate('', {})).toBe('');
  });

  it('handles template with no variables', () => {
    expect(renderTemplate('static text', {})).toBe('static text');
  });

  it('handles special characters in values', () => {
    const result = renderTemplate('{{ text }}', { text: '<script>alert("xss")</script>' });
    // autoescape is off — raw text passes through
    expect(result).toBe('<script>alert("xss")</script>');
  });

  it('handles multiline templates', () => {
    const template = 'Line1: {{ a }}\nLine2: {{ b }}';
    const result = renderTemplate(template, { a: 'hello', b: 'world' });
    expect(result).toBe('Line1: hello\nLine2: world');
  });

  it('renders credential and property namespaces together', () => {
    const template = 'Use {{ credentials.TOKEN }} to query {{ properties.ENDPOINT }}';
    const result = renderTemplate(template, {
      credentials: { TOKEN: 'abc123' },
      properties: { ENDPOINT: 'https://api.example.com' },
    });
    expect(result).toBe('Use abc123 to query https://api.example.com');
  });

  it('renders numeric values', () => {
    const result = renderTemplate('Count: {{ count }}', { count: 42 });
    expect(result).toBe('Count: 42');
  });

  it('renders default filter for missing values', () => {
    const result = renderTemplate('{{ missing | default("fallback") }}', {});
    expect(result).toBe('fallback');
  });
});

describe('buildTemplateContext', () => {
  it('builds context from property and credential maps', () => {
    const properties = new Map([['KEY1', 'val1'], ['KEY2', 'val2']]);
    const credentials = new Map([['TOKEN', 'secret']]);

    const ctx = buildTemplateContext({ properties, credentials });

    expect(ctx.properties).toEqual({ KEY1: 'val1', KEY2: 'val2' });
    expect(ctx.credentials).toEqual({ TOKEN: 'secret' });
  });

  it('includes precedent_output when provided', () => {
    const ctx = buildTemplateContext({
      properties: new Map(),
      credentials: new Map(),
      precedentOutput: 'step-1-output',
    });

    expect(ctx.precedent_output).toBe('step-1-output');
  });

  it('omits precedent_output when not provided', () => {
    const ctx = buildTemplateContext({
      properties: new Map(),
      credentials: new Map(),
    });

    expect(ctx).not.toHaveProperty('precedent_output');
  });

  it('includes env variables when provided', () => {
    const ctx = buildTemplateContext({
      properties: new Map(),
      credentials: new Map(),
      envVariables: new Map([['NODE_ENV', 'production']]),
    });

    expect(ctx.env).toEqual({ NODE_ENV: 'production' });
  });

  it('omits env when not provided', () => {
    const ctx = buildTemplateContext({
      properties: new Map(),
      credentials: new Map(),
    });

    expect(ctx).not.toHaveProperty('env');
  });

  it('merges extra context', () => {
    const ctx = buildTemplateContext({
      properties: new Map(),
      credentials: new Map(),
      extra: { customKey: 'customValue' },
    });

    expect(ctx.customKey).toBe('customValue');
  });

  it('handles empty maps', () => {
    const ctx = buildTemplateContext({
      properties: new Map(),
      credentials: new Map(),
    });

    expect(ctx.properties).toEqual({});
    expect(ctx.credentials).toEqual({});
  });

  it('integrates with renderTemplate end-to-end', () => {
    const ctx = buildTemplateContext({
      properties: new Map([['SYMBOL', 'BTC']]),
      credentials: new Map([['API_KEY', 'sk-test']]),
      precedentOutput: 'previous result',
    });

    const result = renderTemplate(
      'Analyse {{ properties.SYMBOL }} with {{ credentials.API_KEY }}. Previous: {{ precedent_output }}',
      ctx,
    );
    expect(result).toBe('Analyse BTC with sk-test. Previous: previous result');
  });
});
