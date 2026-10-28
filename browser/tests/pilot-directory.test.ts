import { describe, expect, it } from 'vitest';
import { explorers, resolveRoute, routeTitle } from '../src/pilot/directory';

describe('explorer hierarchy', () => {
  it('uses Home as the entry point and separates gameplay and tooling from explorers', () => {
    expect(resolveRoute('', new URLSearchParams())).toBe('home');
    expect(resolveRoute('/', new URLSearchParams())).toBe('home');
    expect(explorers.map(item => item.id)).toEqual(['character', 'foliage', 'island', 'navigation']);
    expect(resolveRoute('/play', new URLSearchParams())).toBe('play');
    expect(resolveRoute('/ui', new URLSearchParams())).toBe('ui');
    for (const explorer of explorers) {
      expect(resolveRoute(`/${explorer.id}`, new URLSearchParams())).toBe(explorer.id);
      expect(routeTitle(explorer.id)).toBe(explorer.title);
    }
  });
  it('keeps old tree links inside Foliage and retains their seed', () => {
    const parameters = new URLSearchParams('treeSeed=9');
    expect(resolveRoute('/trees', parameters)).toBe('foliage');
    expect(parameters.get('treeSeed')).toBe('9');
    expect(parameters.get('foliage')).toBe('trees');
    expect(resolveRoute('/foraging', new URLSearchParams())).toBe('foliage');
  });
  it('rejects unknown destinations instead of presenting a successful Play session', () => {
    expect(() => resolveRoute('/missing', new URLSearchParams())).toThrow('does not exist');
  });
});
