import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const readReference = async (name) => JSON.parse(
  await readFile(new URL(`src/fixtures/reference-${name}.json`, root), 'utf8'),
);

function packBits(values, bits) {
  const bytes = Buffer.alloc(Math.ceil(values.length * bits / 8));
  values.forEach((value, index) => {
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bits) {
      throw new Error(`Cannot pack ${value} into ${bits} bits at cell ${index}.`);
    }
    bytes[Math.floor(index * bits / 8)] |= value << (index * bits % 8);
  });
  return bytes.toString('base64');
}

function packHeights(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => {
    if (!Number.isFinite(value) || Math.fround(value) !== value) {
      throw new Error(`Reference height at cell ${index} is not an exact finite float32.`);
    }
    bytes.writeFloatLE(value, index * 4);
  });
  return bytes.toString('base64');
}

const base = [];
const relief = [];
for (const seed of [42, 43, 12345]) {
  const world = await readReference(seed);
  base.push({
    seed, generatorVersion: world.generatorVersion,
    width: world.width, height: world.height,
    tileSize: world.tileSize, seaLevel: world.seaLevel,
    heights: packHeights(world.heights), cells: packBits(world.cells, 1),
  });
  if (seed === 43) continue;
  const elevated = await readReference(`${seed}-relief`);
  if (JSON.stringify(elevated.heights) !== JSON.stringify(world.heights)
    || JSON.stringify(elevated.cells) !== JSON.stringify(world.cells)) {
    throw new Error(`Relief reference ${seed} no longer shares its baseline terrain.`);
  }
  relief.push({
    seed, generatorVersion: elevated.generatorVersion,
    elevations: packBits(elevated.elevations, 2),
    cliffCells: packBits(elevated.cliffCells, 1),
    rampIds: elevated.rampIds.flatMap((id, index) => id < 0 ? [] : [[index, id]]),
    ramps: elevated.ramps,
  });
}
const output = `${JSON.stringify({ format: 1, base, relief })}\n`;
const destination = new URL('src/fixtures/packed-worlds.json', root);
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== output) {
    throw new Error('Packed references are stale. Run npm run fixtures:pack.');
  }
  console.log('Packed references match every source fixture.');
} else {
  await writeFile(destination, output);
  console.log(`Packed five reference worlds into ${Buffer.byteLength(output)} bytes.`);
}
