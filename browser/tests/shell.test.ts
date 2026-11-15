import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('canonical shell', () => {
  it('boots the integrated shell instead of a standalone runtime', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("from './pilot/ui'");
    expect(main).toContain("from './pilot/directory'");
    expect(main).not.toContain('__longTable');
  });

  it('does not retain standalone UI source or deployable archived UI', () => {
    for (const path of [
      'src/character-creation.ts', 'src/character-customization.ts',
      'src/debug.ts', 'src/destinations.ts',
      'src/island-versions.ts', 'src/island-versions.css',
      'src/landform-study.ts', 'src/landform-study.css', 'src/styles.css',
      'public/world-family/v1', 'public/previews',
      'tests/capture-previews.mjs', 'playwright.config.ts',
    ]) {
      expect(existsSync(new URL(`../${path}`, import.meta.url)), path).toBe(false);
    }
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
