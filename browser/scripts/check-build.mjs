import { readdir, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
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
  ['All JavaScript', sum(chunks, 'raw'), 1_800_000],
  ['All JavaScript (gzip)', sum(chunks, 'gzip'), 530_000],
];
for (const [label, actual, limit] of budgets) {
  console.log(`${label}: ${actual} / ${limit} bytes`);
  if (actual > limit) throw new Error(`${label} exceeds its build budget.`);
}
if (home.some(chunk => /^(phaser|reference-data|world|game-view)-/.test(chunk.name))) {
  throw new Error('Home must not eagerly load the game engine or world data.');
}
