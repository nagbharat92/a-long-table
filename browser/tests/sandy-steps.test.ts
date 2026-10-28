import { describe, expect, it } from 'vitest';
import type { Ramp, World } from '../src/core/contracts';
import { drawSandySteps } from '../src/render/sandy-steps';

function fixture(dx: number, dy: number, span = 3) {
  const highCell = { x: 8, y: 8 };
  const lowCell = { x: 8 + dx * span, y: 8 + dy * span };
  const ramp: Ramp = {
    surface: 'sand', highCell, lowCell, direction: { x: dx, y: dy },
    upperLevel: 1, lowerLevel: 0,
    rect: {
      x: Math.min(highCell.x, lowCell.x) - (dx === 0 ? 1 : 0),
      y: Math.min(highCell.y, lowCell.y) - (dy === 0 ? 1 : 0),
      width: dx === 0 ? 3 : span + 1, height: dy === 0 ? 3 : span + 1,
    },
  };
  const world: World = {
    width: 20, height: 20, tileSize: 4, seed: 42, seaLevel: 0,
    generatorVersion: 'test', provenance: 'test-fixture',
    cells: new Uint8Array(400).fill(1), heights: new Float32Array(400).fill(1),
    elevations: new Uint8Array(400), cliffCells: new Uint8Array(400),
    rampIds: new Int32Array(400).fill(-1), ramps: [ramp],
  };
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      if ((x - highCell.x) * dx + (y - highCell.y) * dy <= 0) world.elevations![y * world.width + x] = 1;
    }
  }
  for (let y = ramp.rect.y; y < ramp.rect.y + ramp.rect.height; y++) {
    for (let x = ramp.rect.x; x < ramp.rect.x + ramp.rect.width; x++) world.rampIds![y * world.width + x] = 0;
  }
  return { world, ramp };
}

function render(world: World, ramp: Ramp) {
  const commands: { x: number; y: number; width: number; height: number; color: string }[] = [];
  const pixels = new Map<string, string>();
  const context = {
    fillStyle: '',
    fillRect(x: number, y: number, width: number, height: number) {
      commands.push({ x, y, width, height, color: this.fillStyle });
      for (let py = y; py < y + height; py++) {
        for (let px = x; px < x + width; px++) pixels.set(`${px},${py}`, this.fillStyle);
      }
    },
  };
  drawSandySteps(context, world, ramp);
  return { commands, pixels };
}

function geometry(world: World, ramp: Ramp) {
  const { direction: d, highCell: h, lowCell: l } = ramp;
  const tile = world.tileSize;
  const width = (d.x ? ramp.rect.height : ramp.rect.width) * tile;
  const length = (Math.abs(l.x - h.x) + Math.abs(l.y - h.y) + 1) * tile;
  const landing = Math.max(1, Math.floor(tile / 2));
  const count = Math.max(2, Math.round((length - landing * 2) / 4));
  const rise = Math.min(count, Math.floor(width / 4));
  const breadth = width - (d.x ? rise : 2);
  const origin = {
    x: (h.x + 0.5) * tile - d.x * tile / 2 + d.y * width / 2,
    y: (h.y + 0.5) * tile - d.y * tile / 2 - d.x * width / 2,
  };
  const point = (a: number, s: number) => [
    Math.floor(origin.x + d.x * (a + 0.5) - d.y * (s + 0.5)),
    Math.floor(origin.y + d.y * (a + 0.5) + d.x * (s + 0.5)),
  ];
  const key = (a: number, s: number) => point(a, s).join(',');
  const start = (step: number) => {
    const drop = Math.ceil(Math.max(0, Math.min(count, step + 1)) * rise / count);
    return d.x ? d.x > 0 ? drop : rise - drop : 1;
  };
  const bands = Array.from({ length: count + 2 }, (_, i) => {
    const step = i - 1;
    return {
      step, start: start(step),
      from: step < 0 ? 0 : landing + Math.floor(step * (length - landing * 2) / count),
      to: step === count ? length : landing + Math.floor((step + 1) * (length - landing * 2) / count),
    };
  });
  return { width, length, count, rise, breadth, point, key, bands };
}

function expectConnected(pixels: Map<string, string>) {
  const first = pixels.keys().next().value!;
  const seen = new Set([first]);
  const queue = [first];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i].split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + dx},${y + dy}`;
      if (pixels.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(key);
      }
    }
  }
  expect(seen.size).toBe(pixels.size);
}

const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const variants = directions.flatMap(([dx, dy]) => [3, 4].map(span => [dx, dy, span]));
const seededVariants = variants.flatMap(variant => [42, 902479].map(seed => [...variant, seed]));
const transition = new Set(['#b6ce67', '#c1cf74', '#ced483']);

describe('sandy hillside steps', () => {
  it.each(seededVariants)('preserves broad connected steps %i,%i span %i seed %i', (dx, dy, span, seed) => {
    const { world, ramp } = fixture(dx, dy, span);
    world.seed = seed;
    const before = structuredClone(world);
    const { commands, pixels } = render(world, ramp);
    const g = geometry(world, ramp);
    expect(render(world, ramp)).toEqual({ commands, pixels });
    expect(world).toEqual(before);
    expect(g.count).toBe(span);
    expectConnected(pixels);
    for (const command of commands) {
      expect(command.width).toBeGreaterThan(0);
      expect(command.height).toBeGreaterThan(0);
      expect([command.x, command.y, command.width, command.height].every(Number.isInteger)).toBe(true);
    }
    const surface = new Set(['#e7cf85', '#e8d29a', '#f2dfa7', '#c3ad79', '#b79e6b']);
    const bodyColors = new Set([...surface, ...transition]);
    const blends = [...pixels.values()].filter(color => transition.has(color)).length;
    expect(blends).toBeGreaterThan(pixels.size * 0.02);
    expect(blends).toBeLessThan(pixels.size * 0.2);
    for (const band of g.bands) {
      for (let a = band.from; a < band.to; a++) {
        // The middle three pixels remain solid from the original upper to lower endpoint.
        const center = band.start + Math.floor(g.breadth / 2);
        for (let s = center - 1; s <= center + 1; s++) {
          expect(surface.has(pixels.get(g.key(a, s))!)).toBe(true);
        }
        const body = Array.from({ length: g.breadth }, (_, s) => pixels.get(g.key(a, band.start + s)));
        expect(body.filter(color => bodyColors.has(color!)).length)
          .toBeGreaterThanOrEqual(g.breadth - (a === 0 || a === g.length - 1 ? 2 : 1));
        for (let s = 1; s < g.breadth - 1; s++) expect(body[s]).toBeDefined();
        for (let s = 0; s < body.length; s++) {
          if (!transition.has(body[s]!)) continue;
          expect(s <= 1 || s >= g.breadth - 2).toBe(true);
          if (dx) expect(dx > 0 ? s <= 1 : s >= g.breadth - 2).toBe(true);
        }
        for (let s = -1; s <= g.width; s++) {
          if (s < (dx ? 0 : 1) || s >= g.width - (dx ? 0 : 1)) {
            expect(pixels.has(g.key(a, s))).toBe(false);
          }
        }
      }
      if (band.step < 0 || band.step === g.count) continue;
      const lip = Array.from({ length: g.breadth }, (_, s) => pixels.get(g.key(band.from, band.start + s)));
      const seam = Array.from({ length: g.breadth }, (_, s) => pixels.get(g.key(band.to - 1, band.start + s)));
      expect(lip.filter(color => color === '#f2dfa7').length).toBeGreaterThanOrEqual(2);
      expect(lip.filter(color => color === '#f2dfa7').length).toBeLessThan(g.breadth - 2);
      expect(seam.filter(color => color === (dy > 0 ? '#b79e6b' : '#c3ad79')).length).toBeGreaterThanOrEqual(2);
      expect(Array.from({ length: g.breadth }, (_, s) => pixels.get(g.key(band.from + 1, band.start + s))))
        .toContain('#e8d29a');
    }
    expect([...pixels.values()]).toContain('#e7cf85');
    if (dx) {
      for (const band of g.bands.filter(band => Math.ceil(Math.max(0, band.step + 1) * g.rise / g.count) < g.rise)) {
        for (let a = band.from; a < band.to; a++) {
          const [x] = g.point(a, 0);
          expect(['#9e895f', '#b79e6b']).toContain(pixels.get(`${x},${(ramp.rect.y + ramp.rect.height) * 4 - 1}`));
        }
      }
      const bank = new Map([...pixels].filter(([, color]) => color === '#9e895f' || color === '#b79e6b'));
      expectConnected(bank);
      expect(commands.filter(command => command.color === '#b79e6b').every(command => command.height <= g.rise + 2)).toBe(true);
    } else {
      expect(commands.filter(command => command.color === (dy > 0 ? '#b79e6b' : '#c3ad79'))
        .every(command => command.height === 1)).toBe(true);
    }
    const outside = [...pixels].filter(([key]) => {
      const [x, y] = key.split(',').map(Number);
      return x < ramp.rect.x * 4 || y < ramp.rect.y * 4
        || x >= (ramp.rect.x + ramp.rect.width) * 4 || y >= (ramp.rect.y + ramp.rect.height) * 4;
    });
    expect(outside.length).toBeGreaterThan(0);
    for (const [key] of outside) {
      const [x, y] = key.split(',').map(Number);
      const cx = Math.floor(x / 4), cy = Math.floor(y / 4);
      expect(cx).toBeGreaterThanOrEqual(0);
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cx).toBeLessThan(world.width);
      expect(cy).toBeLessThan(world.height);
      const index = cy * world.width + cx;
      const upper = (cx - ramp.highCell.x) * dx + (cy - ramp.highCell.y) * dy < 0;
      expect(world.cells[index]).toBe(1);
      expect(world.heights[index]).toBeGreaterThan(world.seaLevel);
      expect(world.elevations![index]).toBe(upper ? ramp.upperLevel : ramp.lowerLevel);
      expect(world.cliffCells![index]).toBe(0);
      expect(world.rampIds![index]).toBe(-1);
    }
    for (const end of [0, g.length]) {
      const start = end === 0 ? g.bands[0].start : g.bands.at(-1)!.start;
      const rows = Array.from({ length: 3 }, (_, distance) => {
        const a = end === 0 ? -1 - distance : end + distance;
        return Array.from({ length: g.breadth }, (_, s) => pixels.has(g.key(a, start + s))).filter(Boolean).length;
      });
      expect(rows[0]).toBe(g.breadth - 2);
      expect(rows[1]).toBe(g.breadth - 3);
      expect(rows[2]).toBe(0);
    }
    world.seed++;
    expect(render(world, ramp).pixels).not.toEqual(pixels);
  });

  it.each(directions.flatMap(([dx, dy]) => ['water', 'sea height', 'submerged height', 'cliff', 'other crossing', 'wrong level', 'bounds']
    .map(obstacle => ({ dx, dy, obstacle }))))('guards every exterior pixel: $dx,$dy $obstacle', ({ dx, dy, obstacle }) => {
    const { world, ramp } = fixture(dx, dy);
    const g = geometry(world, ramp);
    for (const end of [0, g.length]) {
      const level = end === 0 ? ramp.upperLevel : ramp.lowerLevel;
      for (let distance = 0; distance < 4; distance++) {
        const a = end === 0 ? -1 - distance : end + distance;
        for (let s = 0; s < g.width; s++) {
          const [x, y] = g.point(a, s);
          const index = Math.floor(y / 4) * world.width + Math.floor(x / 4);
          if (obstacle === 'water') world.cells[index] = 0;
          if (obstacle === 'sea height') world.heights[index] = world.seaLevel;
          if (obstacle === 'submerged height') world.heights[index] = world.seaLevel - 1;
          if (obstacle === 'cliff') world.cliffCells![index] = 1;
          if (obstacle === 'other crossing') world.rampIds![index] = 1;
          if (obstacle === 'wrong level') world.elevations![index] = level === 0 ? 1 : 0;
        }
      }
    }
    if (obstacle === 'bounds') {
      const shift = dx ? ramp.rect.x * 4 : ramp.rect.y * 4;
      if (dx) {
        ramp.highCell.x -= shift / 4; ramp.lowCell.x -= shift / 4; ramp.rect.x = 0;
        world.width = ramp.rect.width;
      } else {
        ramp.highCell.y -= shift / 4; ramp.lowCell.y -= shift / 4; ramp.rect.y = 0;
        world.height = ramp.rect.height;
      }
    }
    const { pixels } = render(world, ramp);
    for (const key of pixels.keys()) {
      const [x, y] = key.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(ramp.rect.x * 4);
      expect(y).toBeGreaterThanOrEqual(ramp.rect.y * 4);
      expect(x).toBeLessThan((ramp.rect.x + ramp.rect.width) * 4);
      expect(y).toBeLessThan((ramp.rect.y + ramp.rect.height) * 4);
    }
    expectConnected(pixels);
  });

  it.each(directions.flatMap(([dx, dy]) => ['water height', 'cliff', 'other crossing', 'wrong level']
    .map(obstacle => ({ dx, dy, obstacle }))))('does not tint hazardous shoulders: $dx,$dy $obstacle', ({ dx, dy, obstacle }) => {
    const { world, ramp } = fixture(dx, dy);
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (x >= ramp.rect.x && x < ramp.rect.x + ramp.rect.width
          && y >= ramp.rect.y && y < ramp.rect.y + ramp.rect.height) continue;
        const index = y * world.width + x;
        if (obstacle === 'water height') world.heights[index] = world.seaLevel;
        if (obstacle === 'cliff') world.cliffCells![index] = 1;
        if (obstacle === 'other crossing') world.rampIds![index] = 1;
        if (obstacle === 'wrong level') world.elevations![index] = 2;
      }
    }
    const { pixels } = render(world, ramp);
    expect([...pixels.values()].some(color => transition.has(color))).toBe(false);
    expectConnected(pixels);
  });
});
