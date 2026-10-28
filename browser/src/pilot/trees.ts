import { drawGroundArt, GROUND_ART_FACINGS, GROUND_ART_SIZES, groundArtSeed } from '../tree-source/core/ground-pixel-art';
import { drawTreeLayers, generateTree, LAYER_TREES, TREE_ASSET, TREE_BRANCHES, TREE_GROWTH, TREE_LAYER_SIZE, TREE_SIZE, type TreeAppearance } from '../tree-source/core/tree-assets';
import { DEFAULT_TREE_WIND, prepareTreeMotion, TREE_MOTION_MODES, TREE_WIND_PRESETS, type TreeWind } from '../tree-source/core/tree-motion';
import { action, choices, download, el, section, slider, type PilotController, type PilotShell } from './ui';
import './trees.css';

export async function mountTrees(shell: PilotShell, parameters: URLSearchParams): Promise<PilotController> {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const cache = new Map<string, ReturnType<typeof prepareTreeMotion>>();
  let appearance = generateTree(groundArtSeed(parameters.get('treeSeed') ?? '9', 'Tree'));
  const wind: TreeWind = { ...DEFAULT_TREE_WIND };
  let seconds = 0;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame = 0;
  let previous: number | undefined;
  let destroyed = false;
  let category: 'Appearance' | 'Motion' = 'Appearance';
  type Family = 'shape' | 'palette' | 'size' | 'facing' | 'growth' | 'branches';
  let family: Family = 'shape';
  const families: { value: Family; label: string; names: readonly string[] }[] = [
    { value: 'shape', label: 'Shape', names: TREE_ASSET.shapes },
    { value: 'palette', label: 'Palette', names: TREE_ASSET.palettes.map(palette => palette.name) },
    { value: 'size', label: 'Size', names: GROUND_ART_SIZES },
    { value: 'facing', label: 'Facing', names: GROUND_ART_FACINGS },
    { value: 'growth', label: 'Growth', names: TREE_GROWTH },
    { value: 'branches', label: 'Branches', names: TREE_BRANCHES },
  ];
  const items = (names: readonly string[]) => names.map((label, value) => ({ value, label }));
  const guard = (run: () => void): (() => void) => () => {
    try { run(); } catch (cause) { stop(); shell.showError(cause); }
  };
  const stage = el('div', 'p-creator-stage pt-stage');
  const gallery = el('div', 'p-tree-gallery pt-gallery');
  const makePreview = (label: string, width: number, height: number) => {
    const figure = el('figure');
    const canvas = el('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not open the tree canvas.');
    context.imageSmoothingEnabled = false;
    figure.append(canvas, el('figcaption', '', label));
    gallery.append(figure);
    return { canvas, context };
  };
  const single = makePreview('Individual tree', TREE_SIZE.width, TREE_SIZE.height);
  const layered = makePreview('Layered color study', TREE_LAYER_SIZE.width, TREE_LAYER_SIZE.height);
  stage.append(gallery);
  shell.stage.append(stage);
  const subject = el('div');
  const description = el('p', 'p-muted');
  subject.append(el('h1', '', 'Trees'), description);
  shell.subject.append(subject);
  shell.tray.hidden = false;
  const tabs = el('div', 'p-tray-tabs pt-tabs');
  const content = el('div', 'p-tray-content pt-content');
  const transport = el('div', 'p-tree-transport pt-transport');
  const time = el('output', 'pt-time');
  time.setAttribute('aria-label', 'Wind time');
  const pause = action('', guard(() => { paused = !paused; refresh(); }), signal);
  const step = action('Step 0.25 s', guard(() => { paused = true; seconds += 0.25; refresh(); }), signal);
  const restart = action('Restart', guard(() => { seconds = 0; refresh(); }), signal);
  restart.setAttribute('aria-label', 'Restart wind');
  transport.append(pause, step, restart, time);
  const categoryChoices = choices('Tree controls', [
    { value: 'Appearance' as const, label: 'Appearance' },
    { value: 'Motion' as const, label: 'Motion' },
  ], category, value => { category = value; renderControls(); }, signal);
  tabs.append(categoryChoices.element);
  shell.sessionControls.append(transport);
  shell.tray.append(tabs, content);

  function drawMotion(context: CanvasRenderingContext2D, recipe: TreeAppearance, offsetX = 0, offsetY = 0): void {
    const key = JSON.stringify(recipe);
    let prepared = cache.get(key);
    if (!prepared) {
      prepared = prepareTreeMotion(recipe);
      if (cache.size >= 24) cache.delete(cache.keys().next().value!);
      cache.set(key, prepared);
    }
    const pixels = prepared(seconds, wind);
    const tones = TREE_ASSET.palettes[recipe.palette].tones;
    pixels.forEach((row, y) => row.forEach((tone, x) => {
      if (!tone) return;
      context.fillStyle = tones[tone];
      context.fillRect(x + offsetX, y + offsetY, 1, 1);
    }));
  }
  function draw(): void {
    if (seconds === 0 || wind.preset === 0 || wind.strength === 0) {
      drawGroundArt(single.context, TREE_ASSET, appearance);
      drawTreeLayers(layered.context, appearance);
    } else {
      single.context.clearRect(0, 0, TREE_SIZE.width, TREE_SIZE.height);
      layered.context.clearRect(0, 0, TREE_LAYER_SIZE.width, TREE_LAYER_SIZE.height);
      drawMotion(single.context, appearance);
      LAYER_TREES.forEach((layer, index) => {
        drawMotion(layered.context, { ...appearance, ...layer, seed: (appearance.seed + index * 73) >>> 0 }, layer.x, layer.y);
      });
      drawMotion(layered.context, appearance, 76, 5);
    }
    time.value = `${seconds.toFixed(2)} s`;
  }
  function stop(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = undefined;
  }
  function running(): boolean {
    return !destroyed && !signal.aborted && !paused && !document.hidden && wind.preset !== 0 && wind.strength > 0;
  }
  function tick(now: number): void {
    frame = 0;
    if (!running()) { previous = undefined; return; }
    try {
      if (previous !== undefined) seconds += Math.min(Math.max(0, (now - previous) / 1000), 0.05);
      previous = now;
      draw();
      frame = requestAnimationFrame(tick);
    } catch (cause) { stop(); shell.showError(cause); }
  }
  function schedule(): void {
    if (!running()) { stop(); return; }
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function refresh(): void {
    draw();
    pause.textContent = paused ? 'Resume wind' : 'Pause wind';
    pause.setAttribute('aria-pressed', String(paused));
    const text = `${TREE_ASSET.shapes[appearance.shape]} · ${TREE_ASSET.palettes[appearance.palette].name} · ${GROUND_ART_SIZES[appearance.size]}`;
    description.textContent = text;
    currentSeed.value = `Seed ${appearance.seed}`;
    single.canvas.setAttribute('aria-label', `Individual tree · ${text} · ${TREE_MOTION_MODES[wind.mode]}`);
    schedule();
  }
  let controlsLifetime: AbortController | undefined;
  function renderControls(): void {
    const focused = document.activeElement;
    const focusLabel = focused instanceof HTMLElement && content.contains(focused)
      ? focused.getAttribute('aria-label') ?? focused.textContent : null;
    controlsLifetime?.abort();
    controlsLifetime = new AbortController();
    const controlsSignal = controlsLifetime.signal;
    content.replaceChildren();
    if (category === 'Appearance') {
      const familyChoices = choices('Appearance family', families, family, value => { family = value; renderControls(); }, controlsSignal);
      const selected = families.find(item => item.value === family)!;
      const familySection = section(selected.label);
      const options = choices(selected.label, items(selected.names), appearance[family] ?? 0, value => {
        appearance[family] = value;
        guard(refresh)();
      }, controlsSignal);
      familySection.append(options.element);
      content.append(familyChoices.element, familySection);
    } else {
      const modes = section('Movement');
      modes.append(choices('Motion mode', items(TREE_MOTION_MODES), wind.mode, value => {
        wind.mode = value; guard(refresh)();
      }, controlsSignal).element);
      const presets = section('Wind');
      presets.append(choices('Wind preset', items(TREE_WIND_PRESETS), wind.preset, value => {
        wind.preset = value; guard(refresh)();
      }, controlsSignal).element);
      const grid = el('div', 'p-tray-grid pt-motion-grid');
      grid.append(modes, presets,
        slider('Wind strength', 0, 6, 0.1, wind.strength, value => { wind.strength = value; guard(refresh)(); }, controlsSignal),
        slider('Wind speed', 0.2, 2, 0.1, wind.speed, value => { wind.speed = value; guard(refresh)(); }, controlsSignal));
      const direction = choices('Wind direction', [{ value: -1, label: '← Left' }, { value: 1, label: 'Right →' }], wind.direction, value => {
        wind.direction = value; guard(refresh)();
      }, controlsSignal);
      const directionRow = el('div', 'p-row pt-direction');
      directionRow.append(el('span', 'p-label', 'Direction'), direction.element);
      content.append(grid, directionRow);
    }
    if (focusLabel !== null) {
      const replacement = [...content.querySelectorAll<HTMLElement>('button,input')]
        .find(node => (node.getAttribute('aria-label') ?? node.textContent) === focusLabel);
      replacement?.focus({ preventScroll: true });
    }
    resize();
  }
  const generation = section('Tree seed');
  const form = el('form', 'p-row');
  const seedLabel = el('label', 'pt-seed-label', 'Seed');
  const seedInput = el('input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedInput.value = String(appearance.seed);
  seedInput.setAttribute('aria-label', 'Tree seed');
  seedLabel.append(seedInput);
  const apply = el('button', 'p-button', 'Apply seed');
  apply.type = 'submit';
  form.append(seedLabel, apply);
  function setSeed(seed: number): void {
    appearance = generateTree(seed);
    seedInput.value = String(seed);
    const hash = location.hash;
    const [route, query = ''] = hash.split('?');
    const next = new URLSearchParams(query);
    next.set('treeSeed', String(seed));
    history.replaceState(null, '', `${route || '#/trees'}?${next}`);
    renderControls();
    refresh();
    shell.status(`Tree seed ${seed} applied.`);
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    guard(() => setSeed(groundArtSeed(seedInput.value.trim(), 'Tree')))();
  }, { signal });
  const generate = action('Generate tree', guard(() => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    setSeed(seed === appearance.seed ? (seed + 1) >>> 0 : seed);
  }), signal, 'p-primary');
  const currentSeed = el('output', 'p-current-seed');
  currentSeed.setAttribute('aria-label', 'Current tree seed');
  shell.primary.append(generate, currentSeed);
  generation.append(form, el('p', 'p-muted', 'A seed restores generated choices. Recipes preserve manual edits. Applying a seed keeps the wind clock.'));
  const exports = section('Tree exports');
  const exportRow = el('div', 'p-row');
  exportRow.append(
    action('Download PNG', guard(() => {
      const canvas = el('canvas');
      canvas.width = TREE_SIZE.width;
      canvas.height = TREE_SIZE.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not open the tree export canvas.');
      const recipe = { ...appearance };
      drawGroundArt(context, TREE_ASSET, recipe);
      canvas.toBlob(blob => {
        if (signal.aborted) return;
        if (!blob) { shell.showError(new Error('Could not export the tree PNG.')); return; }
        download(`tree-${recipe.seed}-${recipe.shape}-${recipe.size}-${recipe.facing}.png`, blob);
      }, 'image/png');
    }), signal),
    action('Download recipe', guard(() => download(`tree-${appearance.seed}.json`, JSON.stringify(appearance, null, 2))), signal),
    action('Download motion', guard(() => download(`tree-motion-${appearance.seed}.json`, JSON.stringify({
      version: 1, appearance, wind, seconds, paused,
    }, null, 2))), signal),
  );
  exports.append(exportRow, el('p', 'p-muted', 'PNG is the original transparent 80 × 176 still tree. Recipe saves manual choices; motion saves the original version-1 appearance, wind, time and playback schema. Import is not implemented.'));
  shell.toolsContent.append(generation, exports);
  if (paused) shell.status('Wind starts paused because reduced motion is enabled.');

  function resize(): void {
    if (destroyed) return;
    const scale = Math.max(1, Math.min(10, Math.floor(Math.min(
      (gallery.clientWidth - parseFloat(getComputedStyle(gallery).columnGap)) / (TREE_SIZE.width + TREE_LAYER_SIZE.width),
      (gallery.clientHeight - 34) / TREE_SIZE.height,
    ))));
    for (const preview of [single, layered]) {
      preview.canvas.style.width = `${preview.canvas.width * scale}px`;
      preview.canvas.style.height = `${preview.canvas.height * scale}px`;
    }
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  document.addEventListener('visibilitychange', schedule, { signal });
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    stop();
    observer.disconnect();
    cache.clear();
    controlsLifetime?.abort();
    lifetime.abort();
    shell.signal.removeEventListener('abort', destroy);
    stage.remove();
    subject.remove();
    transport.remove();
    generate.remove();
    currentSeed.remove();
    tabs.remove();
    content.remove();
    generation.remove();
    exports.remove();
    shell.tray.hidden = true;
  }
  shell.signal.addEventListener('abort', destroy, { once: true });
  if (shell.signal.aborted) destroy();
  else {
    renderControls();
    refresh();
  }
  return {
    destroy,
    snapshot: () => ({ seed: appearance.seed, appearance: { ...appearance }, wind: { ...wind }, seconds, paused }),
  };
}
