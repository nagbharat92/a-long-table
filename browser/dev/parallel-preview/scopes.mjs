export const scopes = [
  { files: ['src/pilot/character.ts', 'src/pilot/character.css', 'src/pilot/character-family.ts', 'src/pilot/character-family.css', 'src/character-family/**'], routes: ['/character'] },
  { files: ['src/pilot/trees.ts', 'src/pilot/trees.css', 'src/tree-source/**', 'src/pilot/foliage-family.ts', 'src/pilot/foliage-family.css', 'src/foliage-family/**', 'public/foliage-family/**'], routes: ['/foliage', '/trees', '/foraging'] },
  { files: ['src/pilot/world-family.ts', 'src/pilot/world-family.css', 'src/world-family/**', 'public/world-family/**'], routes: ['/island', '/navigation'] },
  { files: ['src/pilot/home.ts'], routes: ['/', '/ui'] },
  { files: ['src/pilot/play.ts'], routes: ['/play'] },
];
