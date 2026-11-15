import { action, choices, el, section, slider, type PilotController, type PilotShell } from '../pilot/ui';
import { foliageTabs } from '../foliage-family/foliage-tabs';
import { DEFAULT_TREE_WIND, TREE_MOTION_MODES, TREE_WIND_PRESETS, validateTreeMotion, type TreeWind } from '../foliage-family/core/tree-motion';
import { DEFAULT_SUN, sunParameters, sunSettingsFromParameters, type SunSettings } from '../world-family/render/island-sun';
import { generateBushPatch, PATCH_SIZE, patchSeed } from './generation';
import { preparePatchRenderer, type PatchFrame } from './renderer';
import type { PatchLayout } from './layout';
import './explorer.css';
import '../pilot/foliage-family.css';

export function mountBushPatch(shell: PilotShell, params: URLSearchParams): PilotController {
  const { signal } = shell;
  const numeric = (key: string, fallback: number): number => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error(`Invalid ${key}.`);
    return Number(raw);
  };
  const boolean = (key: string, fallback: boolean): boolean => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!['true', 'false'].includes(raw)) throw new Error(`Invalid ${key}.`);
    return raw === 'true';
  };
  let seed = patchSeed(params.get('seed') ?? '0');
  let patch = generateBushPatch(seed);
  const layoutParam = params.get('layout') ?? 'stacked';
  if (layoutParam !== 'spaced' && layoutParam !== 'stacked') throw new Error('Invalid patch layout.');
  let layout: PatchLayout = layoutParam;
  const wind: TreeWind = {
    ...DEFAULT_TREE_WIND, mode: numeric('windMode', DEFAULT_TREE_WIND.mode),
    preset: numeric('windPreset', DEFAULT_TREE_WIND.preset), strength: numeric('windStrength', DEFAULT_TREE_WIND.strength),
    speed: numeric('windSpeed', DEFAULT_TREE_WIND.speed), direction: numeric('windDirection', DEFAULT_TREE_WIND.direction),
  };
  let seconds = numeric('time', 0);
  validateTreeMotion(seconds, wind);
  let sun = sunSettingsFromParameters(params);
  let shadows = boolean('shadows', true), sunEnabled = boolean('sun', true), compareTrees = boolean('trees', true);
  let warmShrubs = boolean('warmShrubs', true);
  let paused = boolean('paused', matchMedia('(prefers-reduced-motion: reduce)').matches);
  let zoom = numeric('zoom', 2);
  if (zoom < 0.75 || zoom > 4) throw new Error('Zoom must be between 0.75 and 4.');
  let destroyed = false, frame = 0, previous: number | undefined, lastPaint = -Infinity;
  let lastFrame: PatchFrame | undefined;
  shell.root.classList.add('bush-patch-study', 'foliage-family');
  shell.subject.replaceChildren(el('h1', '', 'Bush patch study'), el('p', 'p-muted', 'Foliage · procedural filler demo'));
  const stage = el('div', 'bush-patch-stage');
  const figure = el('figure');
  const canvas = el('canvas');
  canvas.width = PATCH_SIZE.width;
  canvas.height = PATCH_SIZE.height;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Continuous green canopies with sparse interior creases, ochre pockets and optional reference trees');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  const caption = el('figcaption');
  figure.append(canvas, caption);
  stage.append(figure);
  shell.stage.replaceChildren(stage);
  shell.stage.setAttribute('aria-label', 'Bush patch demo scene');
  shell.sessionControls.append(foliageTabs('bush-patch'));
  const rgb = getComputedStyle(stage).backgroundColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!rgb) throw new Error('Unsupported bush patch ground color.');
  const ground = rgb.slice(1).map(Number) as [number, number, number];
  let draw = preparePatchRenderer(patch, ground, compareTrees);

  function save(): void {
    const next = sunParameters(sun);
    next.set('seed', String(seed));
    for (const [key, value] of Object.entries(wind)) next.set(`wind${key[0].toUpperCase()}${key.slice(1)}`, String(value));
    next.set('paused', String(paused)); next.set('shadows', String(shadows)); next.set('sun', String(sunEnabled));
    next.set('trees', String(compareTrees)); next.set('zoom', String(zoom));
    next.set('warmShrubs', String(warmShrubs));
    next.set('layout', layout);
    if (paused) next.set('time', String(seconds));
    history.replaceState(null, '', `#/bush-patch?${next}`);
  }
  function render(): void {
    if (destroyed || signal.aborted) return;
    lastFrame = draw(seconds, wind, sun, shadows, sunEnabled, warmShrubs, layout);
    const image = context!.createImageData(PATCH_SIZE.width, PATCH_SIZE.height);
    image.data.set(lastFrame.pixels);
    context!.putImageData(image, 0, 0);
    canvas.style.width = `${PATCH_SIZE.width * zoom}px`;
    const forms = patch.clusterForms.map(form => form === 'Broken' ? 'Lobed' : form === 'Winding' ? 'Curved' : form);
    caption.textContent = `${forms.join(' + ')} · ${lastFrame.canopyCount} canopies · ${layout === 'stacked' ? 'Stacked' : 'Spaced'} · Seed ${seed}`;
  }
  const change = (run: () => void): void => {
    try { run(); save(); render(); } catch (error) { shell.showError(error); }
  };
  function rebuild(nextSeed: number): void {
    const nextPatch = generateBushPatch(nextSeed);
    const nextDraw = preparePatchRenderer(nextPatch, ground, compareTrees);
    nextDraw(0, wind, sun, shadows, sunEnabled, warmShrubs, layout);
    seed = nextSeed; patch = nextPatch; draw = nextDraw;
  }
  const generation = section('Generation');
  generation.append(el('p', 'p-muted', 'Overlap canopies to study depth, or space them out for comparison.'));
  const layoutChoices = choices<PatchLayout>('Patch arrangement', [
    { value: 'stacked', label: 'Stacked' }, { value: 'spaced', label: 'Spaced' },
  ], layout, value => {
    change(() => { draw(seconds, wind, sun, shadows, sunEnabled, warmShrubs, value); layout = value; });
    queueMicrotask(() => layoutChoices.set(layout));
  }, signal);
  generation.append(el('h3', 'p-label', 'Patch arrangement'), layoutChoices.element);
  const seedLabel = el('label', 'bush-patch-seed', 'Seed number or name');
  const seedInput = el('input');
  seedInput.value = String(seed);
  seedInput.setAttribute('aria-label', 'Seed number or name');
  seedLabel.append(seedInput);
  generation.append(seedLabel, action('Apply seed', () => change(() => {
    rebuild(patchSeed(seedInput.value)); seedInput.value = String(seed); seconds = 0;
  }), signal));
  shell.primary.append(action('Generate patch', () => change(() => {
    const random = new Uint32Array(1); crypto.getRandomValues(random); rebuild(random[0]);
    seedInput.value = String(seed); seconds = 0; shell.status(`Generated ${patch.form.toLowerCase()} patch, seed ${seed}.`);
  }), signal, 'p-primary'));
  shell.tray.hidden = false;
  shell.tray.append(generation);
  const depth = section('Depth & volume');
  depth.append(el('p', 'p-muted', 'Shared canopy volume, partial creases and small ochre pockets. No black outlines.'));
  const legend = el('div', 'bush-patch-depth');
  for (const label of ['Far · dark', 'Middle · green', 'Front · light']) legend.append(el('span', '', label));
  depth.append(legend);
  toggle('Warm shrub pockets', warmShrubs, value => { warmShrubs = value; }, depth);
  shell.tray.append(depth);

  function toggle(title: string, value: boolean, set: (value: boolean) => void, target: HTMLElement): HTMLInputElement {
    const label = el('label', 'bush-patch-toggle');
    const input = el('input'); input.type = 'checkbox'; input.checked = value;
    label.append(input, document.createTextNode(title)); target.append(label);
    input.addEventListener('change', () => change(() => set(input.checked)), { signal });
    return input;
  }
  const view = section('View');
  toggle('Reference trees at the same pixel scale', compareTrees, value => {
    draw = preparePatchRenderer(patch, ground, value); compareTrees = value;
  }, view);
  view.append(slider('Zoom', 0.75, 4, 0.25, zoom, value => change(() => { zoom = value; }), signal));
  view.append(action('Export PNG', () => {
    canvas.toBlob(blob => {
      if (!blob || signal.aborted) return;
      const url = URL.createObjectURL(blob), link = el('a');
      link.href = url; link.download = `bush-patch-${seed}.png`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }, signal));
  shell.tray.append(view);

  const motion = section('Wind');
  const pause = action(paused ? 'Resume wind' : 'Pause wind', () => change(() => {
    paused = !paused; previous = undefined; pause.textContent = paused ? 'Resume wind' : 'Pause wind';
    pause.setAttribute('aria-pressed', String(paused));
  }), signal);
  pause.setAttribute('aria-pressed', String(paused));
  motion.append(pause);
  for (const [key, title, names] of [['mode', 'Motion mode', TREE_MOTION_MODES], ['preset', 'Wind preset', TREE_WIND_PRESETS]] as const) {
    motion.append(el('h3', 'p-label', title), choices(title, names.map((label, value) => ({ label: label.replace('Whole tree', 'Whole canopy'), value })), wind[key],
      value => change(() => { wind[key] = value; }), signal).element);
  }
  motion.append(slider('Wind strength', 0, 6, 0.5, wind.strength, value => change(() => { wind.strength = value; }), signal),
    slider('Wind speed', 0.2, 2, 0.1, wind.speed, value => change(() => { wind.speed = value; }), signal),
    choices('Wind direction', [{ value: -1, label: 'Left' }, { value: 1, label: 'Right' }], wind.direction,
      value => change(() => { wind.direction = value; }), signal).element);
  shell.tray.append(motion);

  const lighting = section('Sun and shadows');
  const sunControls: (HTMLInputElement | HTMLSelectElement | HTMLButtonElement)[] = [];
  function syncSun(): void {
    for (const control of sunControls) {
      const key = control.dataset.sun as keyof SunSettings | undefined;
      if (key) control.value = String(sun[key]);
      control.disabled = !sunEnabled || (key === 'softness' && sun.shadowMode === 'hard');
      if (control instanceof HTMLInputElement && control.parentElement) {
        const output = control.parentElement.querySelector('output');
        if (output && key) output.value = String(sun[key]);
      }
    }
  }
  toggle('Sun lighting', sunEnabled, value => { sunEnabled = value; syncSun(); }, lighting);
  toggle('Cast on ground and neighboring foliage', shadows, value => { shadows = value; }, lighting);
  for (const [key, title, min, max, step] of [
    ['azimuth', 'Sun azimuth', 0, 360, 5], ['elevation', 'Sun elevation', 10, 85, 1],
    ['intensity', 'Sun intensity', 0, 2, 0.05], ['skyFill', 'Sky fill', 0, 1, 0.05],
    ['warmth', 'Sun warmth', 0, 1, 0.05], ['shadowStrength', 'Shadow strength', 0, 1, 0.05],
    ['softness', 'Shadow softness', 0, 8, 0.5],
  ] as const) {
    const row = slider(title, min, max, step, sun[key], value => change(() => { sun = { ...sun, [key]: value }; }), signal);
    const input = row.querySelector('input')!; input.dataset.sun = key; sunControls.push(input); lighting.append(row);
  }
  for (const [key, title, options] of [
    ['shadowMode', 'Shadow mode', [['hard', 'Hard'], ['filtered', 'Filtered'], ['contact', 'Contact hardening']]],
    ['mapSize', 'Shadow quality', [['512', '512'], ['1024', '1024'], ['2048', '2048']]],
  ] as const) {
    const label = el('label', 'bush-patch-select', title), select = el('select');
    select.setAttribute('aria-label', title); select.dataset.sun = key;
    for (const [value, text] of options) { const option = el('option', '', text); option.value = value; select.append(option); }
    select.value = String(sun[key]);
    select.addEventListener('change', () => change(() => {
      sun = { ...sun, [key]: key === 'mapSize' ? Number(select.value) : select.value } as SunSettings; syncSun();
    }), { signal });
    label.append(select); lighting.append(label); sunControls.push(select);
  }
  const reset = action('Reset sun', () => change(() => { sun = { ...DEFAULT_SUN }; syncSun(); }), signal);
  lighting.append(reset, el('p', 'p-muted', 'Canopy shading follows the sun. 2.5D demo shadows, not island lighting.'));
  sunControls.push(reset); syncSun(); shell.tray.append(lighting);

  function tick(now: number): void {
    if (destroyed || signal.aborted) return;
    if (!paused && document.visibilityState === 'visible') {
      if (previous !== undefined) seconds += Math.min(0.1, (now - previous) / 1000);
      previous = now;
      if (now - lastPaint >= 1000 / 24 && wind.preset !== 0 && wind.strength > 0) { render(); lastPaint = now; }
    } else previous = undefined;
    frame = requestAnimationFrame(tick);
  }
  const destroy = (): void => {
    if (destroyed) return; destroyed = true; cancelAnimationFrame(frame);
    shell.root.classList.remove('bush-patch-study', 'foliage-family');
  };
  signal.addEventListener('abort', destroy, { once: true });
  document.addEventListener('visibilitychange', () => { previous = undefined; }, { signal });
  render(); save(); frame = requestAnimationFrame(tick);
  shell.status('Bush patch ready. Demo only; no island placement.');
  return {
    destroy,
    snapshot: () => destroyed ? null : ({
      family: 'foliage', tab: 'bush-patch', seed, form: patch.form, bushCount: patch.bushes.length,
      clusterCount: patch.clusters.length,
      renderMode: 'continuous', canopyCount: lastFrame?.canopyCount,
      foliagePixels: lastFrame?.foliagePixels, creasePixels: lastFrame?.creasePixels,
      layout, canopyOverlapPixels: lastFrame?.canopyOverlapPixels,
      canopyOffsets: lastFrame?.canopyOffsets.map(offset => ({ ...offset })),
      clusterForms: [...patch.clusterForms],
      bushes: patch.bushes.map(({ x, y, depth, cluster, palette }) => ({ x, y, depth, cluster, palette: palette ?? 'green' })),
      warmShrubs, warmBushCount: warmShrubs ? patch.bushes.filter(bush => bush.palette === 'warm').length : 0,
      wind: { ...wind }, sun: { ...sun }, seconds, paused, shadows, sunEnabled, compareTrees, zoom,
      groundShadowPixels: lastFrame?.groundShadowPixels, receiverShadowPixels: lastFrame?.receiverShadowPixels,
    }),
  };
}
