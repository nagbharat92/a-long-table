import { TREE_ASSET, TREE_BASELINE, generateTree } from '../foliage-family/core/tree-assets';
import { DEFAULT_TREE_WIND, prepareTreeMotion, validateTreeMotion, type TreeWind } from '../foliage-family/core/tree-motion';
import { color, coverage, qualityMask } from '../foliage-family/core/tree-shadow-study';
import { validateSunSettings, type SunSettings } from '../world-family/render/island-sun';
import { PATCH_SIZE, type BushPatch } from './generation';
import { prepareCanopy, type CanopyPoint } from './canopy';
import { stackedCanopyOffsets, type CanopyOffset, type PatchLayout } from './layout';

interface Sample extends CanopyPoint {
  owner: number;
  tree: boolean;
  spread: number;
}
export interface PatchFrame {
  pixels: Uint8ClampedArray;
  groundShadowPixels: number;
  receiverShadowPixels: number;
  canopyCount: number;
  foliagePixels: number;
  creasePixels: number;
  canopyOverlapPixels: number;
  canopyOffsets: readonly CanopyOffset[];
}

export function preparePatchRenderer(patch: BushPatch, ground: readonly [number, number, number], compareTrees = true):
  (seconds: number, wind: TreeWind, settings: SunSettings, shadows?: boolean, sunEnabled?: boolean, warmShrubs?: boolean, layout?: PatchLayout) => PatchFrame {
  const canopies = patch.clusters.flatMap((_, cluster) => patch.bushes.some(bush => bush.cluster === cluster)
    ? [prepareCanopy(patch, cluster)] : []);
  const trees = compareTrees ? [[292, 184, 1, 0, 1], [337, 201, 2, 2, 0]].map(([x, baseY, palette, shape, size]) => ({
    x: x - 40, baseY,
    palette: TREE_ASSET.palettes[palette].tones.map(tone => tone ? color(tone) : [0, 0, 0]),
    draw: prepareTreeMotion({ ...generateTree(patch.seed + x), shape, palette, size, growth: 0, branches: 0 }),
  })) : [];
  const { width, height } = PATCH_SIZE, size = width * height;
  const spaced = canopies.map(() => ({ x: 0, y: 0 }));
  let stacked: CanopyOffset[] | undefined;
  const background = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < background.length; i += 4) background.set([...ground, 255], i);
  return (seconds, wind, settings, shadows = true, sunEnabled = true, warmShrubs = true, layout = 'spaced') => {
    validateTreeMotion(seconds, wind);
    if (layout !== 'spaced' && layout !== 'stacked') throw new RangeError('Invalid patch layout.');
    const offsets = layout === 'spaced' ? spaced
      : (stacked ??= stackedCanopyOffsets(canopies.map(c => c.draw(0, DEFAULT_TREE_WIND).surface), patch.seed));
    const depths = [...canopies.map((c, owner) => c.baseY + offsets[owner].y), ...trees.map(t => t.baseY)];
    const sun = validateSunSettings(settings);
    const angle = sun.azimuth * Math.PI / 180, elevation = sun.elevation * Math.PI / 180;
    const length = 1 / Math.tan(elevation);
    const lightX = Math.cos(angle) * Math.cos(elevation), lightY = Math.sin(angle) * Math.cos(elevation);
    const lightZ = Math.sin(elevation);
    const shadowX = -Math.cos(angle) * length * 0.22, shadowY = -Math.sin(angle) * length * 0.2;
    const surface: Sample[] = [], sources: Sample[] = [];
    const layers = new Uint8Array(size);
    canopies.forEach((canopy, owner) => {
      const frame = canopy.draw(seconds, wind);
      const offset = offsets[owner];
      const sample = (point: CanopyPoint): Sample => ({ ...point, x: point.x + offset.x, y: point.y + offset.y,
        groundY: point.groundY + offset.y, owner, tree: false, spread: 2 });
      surface.push(...frame.surface.map(sample));
      sources.push(...frame.tops.map(sample));
      for (const point of frame.surface) {
        const x = point.x + offset.x, y = point.y + offset.y;
        if (x >= 0 && x < width && y >= 0 && y < height) layers[y * width + x]++;
      }
    });
    trees.forEach((tree, index) => {
      tree.draw(seconds, wind).forEach((row, y) => row.forEach((tone, x) => {
        if (!tone) return;
        const point: Sample = { x: x + tree.x, y: y + tree.baseY - TREE_BASELINE, groundY: tree.baseY,
          height: Math.max(0, TREE_BASELINE - y), normal: [0, 0, 1], rgb: tree.palette[tone],
          green: tree.palette[tone], crease: false, region: -1, greenRegion: -1,
          owner: canopies.length + index, tree: true, spread: tone >= 3 ? 2 : 0 };
        surface.push(point); sources.push(point);
      }));
    });
    const groundMask = new Uint16Array(size);
    const receiverMasks = depths.map(() => new Uint16Array(size));
    if (shadows && sunEnabled && sun.intensity > 0 && sun.shadowStrength > 0) {
      const heights = new Float32Array(size), owners = new Int16Array(size).fill(-1);
      let maxHeight = 0;
      for (const source of sources) {
        const sx = Math.round(source.x), sy = Math.round(source.groundY);
        maxHeight = Math.max(maxHeight, source.height);
        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
          const index = sy * width + sx;
          if (source.height > heights[index]) { heights[index] = source.height; owners[index] = source.owner; }
        }
        const gx = Math.round(source.x + source.height * shadowX);
        const gy = Math.round(source.groundY + source.height * shadowY);
        for (let oy = -source.spread; oy <= source.spread; oy++) for (let ox = -source.spread; ox <= source.spread; ox++) {
          const x = gx + ox, y = gy + oy;
          if (x >= 0 && x < width && y >= 0 && y < height) {
            const index = y * width + x;
            groundMask[index] = Math.max(groundMask[index], Math.round(source.height) + 1);
          }
        }
      }
      // Trace the incoming sun against the same canopy heights used by the cast shadows.
      for (const point of surface) {
        if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) continue;
        for (let rise = 1; rise <= maxHeight - point.height; rise++) {
          const x = Math.round(point.x - rise * shadowX), y = Math.round(point.groundY - rise * shadowY);
          if (x < 0 || x >= width || y < 0 || y >= height) break;
          const index = y * width + x;
          if (point.tree && owners[index] === point.owner) continue;
          if (heights[index] > point.height + rise + 0.5) {
            receiverMasks[point.owner][point.y * width + point.x] = rise + 1;
            break;
          }
        }
      }
    }
    const groundFiltered = qualityMask(groundMask, width, height, sun.mapSize);
    const receiverFiltered = receiverMasks.map(mask => qualityMask(mask, width, height, sun.mapSize));
    const pixels = background.slice(), foliage = new Uint8Array(size), creases = new Uint8Array(size);
    let groundShadowPixels = 0, receiverShadowPixels = 0;
    if (shadows && sunEnabled) groundFiltered.forEach((_, index) => {
      const shade = coverage(groundFiltered, width, height, index % width, Math.floor(index / width), sun);
      if (!shade || sun.intensity === 0 || sun.shadowStrength === 0) return;
      groundShadowPixels++;
      const darkness = Math.min(1, shade * sun.shadowStrength * sun.intensity * (1 - 0.25 * sun.skyFill));
      for (let c = 0; c < 3; c++) pixels[index * 4 + c] = Math.round(pixels[index * 4 + c] * (1 - darkness * (c === 0 ? 0.3 : 0.27)));
    });
    surface.sort((a, b) => depths[a.owner] - depths[b.owner] || a.groundY - b.groundY);
    for (const point of surface) {
      if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) continue;
      const index = point.y * width + point.x;
      const shade = shadows && sunEnabled ? coverage(receiverFiltered[point.owner], width, height, point.x, point.y, sun) : 0;
      let light = 1;
      if (sunEnabled) {
        const facing = point.normal[0] * lightX + point.normal[1] * lightY + point.normal[2] * lightZ;
        const tone = point.tree ? 1 : facing < 0.15 ? 0.84 : facing < 0.65 ? 1 : 1.04;
        light = sun.skyFill * 0.7 + sun.intensity * 0.79 * tone
          * (1 - Math.min(1, shade * sun.shadowStrength * sun.intensity) * 0.33);
      }
      if (point.crease) light *= 0.88;
      if (!point.tree && point.height < 1) light *= 0.92;
      const warmth = sunEnabled ? (sun.warmth - 0.3) * sun.intensity : 0;
      const rgb = warmShrubs ? point.rgb : point.green;
      pixels[index * 4] = Math.round(rgb[0] * light * (1 + warmth * 0.14));
      pixels[index * 4 + 1] = Math.round(rgb[1] * light * (1 - warmth * 0.02));
      pixels[index * 4 + 2] = Math.round(rgb[2] * light * (1 - warmth * 0.15));
      foliage[index] = Number(!point.tree); creases[index] = Number(point.crease);
      if (shade && sun.intensity > 0 && sun.shadowStrength > 0) receiverShadowPixels++;
    }
    return { pixels, groundShadowPixels, receiverShadowPixels, canopyCount: canopies.length,
      foliagePixels: foliage.reduce((sum, value) => sum + value, 0), creasePixels: creases.reduce((sum, value) => sum + value, 0),
      canopyOverlapPixels: layers.reduce((sum, value) => sum + Number(value > 1), 0), canopyOffsets: offsets };
  };
}
