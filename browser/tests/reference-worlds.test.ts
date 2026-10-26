import { describe, expect, it } from 'vitest';
import references from '../src/fixtures/packed-worlds.json';
import { referenceWorld } from '../src/core/reference-worlds';

describe('packed reference validation', () => {
  it('rejects truncated heights and bit fields instead of inventing terrain', () => {
    const source = references.base[0];
    expect(() => referenceWorld({ ...source, heights: 'AAAA' })).toThrow('byte length');
    expect(() => referenceWorld({ ...source, cells: 'AAAA' })).toThrow('byte length');
  });

  it('rejects mismatched relief and invalid ramp indices', () => {
    const source = references.base[0];
    const relief = references.relief[0];
    expect(() => referenceWorld(source, { ...relief, seed: 43 })).toThrow('does not match');
    for (const rampIds of [[[-1, 0]], [[source.width * source.height, 0]], [[0, 999]], [[0]]]) {
      expect(() => referenceWorld(source, { ...relief, rampIds })).toThrow('invalid ramp cell');
    }
  });
});
