import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { destinations, destinationById } from '../src/destinations';

describe('destination registry', () => {
  it('includes the game and every requested explorer exactly once', () => {
    expect(destinations.map((destination) => destination.id)).toEqual([
      'play', 'island', 'character', 'foraging', 'navigation',
    ]);
    expect(new Set(destinations.map((destination) => destination.id)).size).toBe(5);
    expect(destinations.every((destination) => destination.title && destination.description && destination.detail)).toBe(true);
  });

  it('keeps experimental terrain separate from approved gameplay', () => {
    expect(destinationById('play')?.experimental).toBe(false);
    expect(destinationById('island')?.experimental).toBe(true);
    expect(destinationById('not-real')).toBeUndefined();
  });
});

describe('approved character assets', () => {
  for (const name of ['rabbit', 'rabbit-blink']) {
    it(`preserves ${name} at its native size`, () => {
      const bytes = readFileSync(new URL(`../public/assets/${name}.png`, import.meta.url));
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([18, 29]);
    });
  }
});
