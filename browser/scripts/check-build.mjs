import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
const files = await readdir(dist, { recursive: true });
const retired = files.filter(path => /^(?:world-family\/v1|versions\/island-v1|previews)(?:\/|$)/.test(path));
if (retired.length) {
  throw new Error(`Build contains retired standalone UI artifacts: ${retired.join(', ')}`);
}
const manifest = JSON.parse(await readFile(new URL('.vite/manifest.json', dist), 'utf8'));
const entry = Object.values(manifest).find(chunk => chunk.isEntry);
if (!entry) throw new Error('Build manifest has no application entry.');
const initial = new Set();
function visit(chunk) {
  if (initial.has(chunk.file)) return;
  initial.add(chunk.file);
  for (const dependency of chunk.imports ?? []) visit(manifest[dependency]);
}
visit(entry);
const chunks = await Promise.all(
  (await readdir(new URL('assets/', dist))).filter(name => name.endsWith('.js')).map(async name => {
    const bytes = await readFile(new URL(`assets/${name}`, dist));
    return { name, raw: bytes.length, gzip: gzipSync(bytes).length, initial: initial.has(`assets/${name}`) };
  }),
);
const sum = (items, field) => items.reduce((total, chunk) => total + chunk[field], 0);
const home = chunks.filter(chunk => chunk.initial);
const budgets = [
  ['Home JavaScript', sum(home, 'raw'), 35_000],
  ['Home JavaScript (gzip)', sum(home, 'gzip'), 12_000],
  // Includes a bounded 26 KB / 12 KB gzip allowance for the lazy bush-patch demo.
  // Wall-path patch anchoring adds at most 1 KB raw / 512 bytes gzip; Home is unchanged.
  // Rounded beach-mask filtering has a separate 2 KB raw / 1 KB gzip allowance.
  ['All JavaScript', sum(chunks, 'raw'), 2_848_000 + 1_000 + 2_000],
  ['All JavaScript (gzip)', sum(chunks, 'gzip'), 974_768 + 512 + 1_024],
];
for (const [label, actual, limit] of budgets) {
  console.log(`${label}: ${actual} / ${limit} bytes`);
  if (actual > limit) throw new Error(`${label} exceeds its build budget.`);
}
if (home.some(chunk => /^(phaser|reference-data|world|game-view)-/.test(chunk.name))) {
  throw new Error('Home must not eagerly load the game engine or world data.');
}
