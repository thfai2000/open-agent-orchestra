import { describe, expect, it } from 'vitest';
import { pickEntryNode } from '../src/services/workflow-graph-engine.js';

describe('pickEntryNode (v4.0.0 — no start/end)', () => {
  const nodes = [
    { nodeKey: 'step_a', nodeType: 'agent_step' },
    { nodeKey: 'step_b', nodeType: 'agent_step' },
    { nodeKey: 'step_c', nodeType: 'agent_step' },
  ];

  it('returns the first node when no override is given', () => {
    expect(pickEntryNode(nodes, null)?.nodeKey).toBe('step_a');
    expect(pickEntryNode(nodes, undefined)?.nodeKey).toBe('step_a');
    expect(pickEntryNode(nodes, '')?.nodeKey).toBe('step_a');
  });

  it('returns the matching node when override exists', () => {
    expect(pickEntryNode(nodes, 'step_b')?.nodeKey).toBe('step_b');
    expect(pickEntryNode(nodes, 'step_c')?.nodeKey).toBe('step_c');
  });

  it('falls back to first node when override key does not exist', () => {
    expect(pickEntryNode(nodes, 'missing')?.nodeKey).toBe('step_a');
  });

  it('lets multiple triggers route to different entry points', () => {
    expect(pickEntryNode(nodes, 'step_a')?.nodeKey).toBe('step_a');
    expect(pickEntryNode(nodes, 'step_c')?.nodeKey).toBe('step_c');
  });

  it('returns null when graph is empty and no override', () => {
    expect(pickEntryNode([], null)).toBeNull();
  });

  it('returns null when graph is empty even with an override', () => {
    expect(pickEntryNode([], 'step_a')).toBeNull();
  });
});
