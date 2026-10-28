import { FOLIAGE_PALETTES } from './core/foliage-palettes';
import { GRASS_DENSITIES, GRASS_PREVIEW_SIZE, GRASS_SHAPES, GRASS_SIZES, drawGrassPreview, generateGrass, grassSeed } from './core/grass-appearance';
import { foliageTabs } from './foliage-tabs';
import { GRASS_WIND_PRESETS, GrassWindRenderer, type GrassWind } from './render/grass-wind';
import { exportPng, presentExplorer, registerSnapshot, reportError } from './pilot-host';

export function mountGrassExplorer(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal): void {
  document.title = 'Grass · Foraging Explorer';
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
    const result = document.createElement(tag);
    result.textContent = text;
    for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, value);
    return result;
  };
  const main = node('main', '', { class: 'runtime runtime-compact forage-lab', 'data-mode': 'foraging' });
  const header = node('header', '', { class: 'runtime-header' });
  header.append(node('a', 'Home', { class: 'button', href: '#/' }), node('h1', 'Foraging Explorer'), foliageTabs('grass'));
  const error = node('div', '', { class: 'error-banner', role: 'alert', hidden: '' });
  const body = node('div', '', { class: 'runtime-body' });
  const stage = node('section', '', { class: 'stage forage-stage', 'aria-label': 'Grass preview' });
  const makeCanvas = (): HTMLCanvasElement => node('canvas', '', {
    width: String(GRASS_PREVIEW_SIZE.width), height: String(GRASS_PREVIEW_SIZE.height), role: 'img',
  });
  const canvas = makeCanvas();
  canvas.className = 'forage-bush grass-preview';
  const caption = node('output', '', { class: 'forage-caption', 'aria-label': 'Grass appearance' });
  const study = node('div', '', { class: 'grass-study', 'aria-label': 'Grass silhouette comparison' });
  const studies = GRASS_SHAPES.map(name => {
    const figure = node('figure');
    const preview = makeCanvas();
    preview.setAttribute('aria-label', name);
    figure.append(preview, node('figcaption', name));
    study.append(figure);
    return preview;
  });
  stage.append(canvas, caption, study);
  const panel = node('aside', '', { class: 'inspector forage-panel', 'aria-label': 'Grass parameters' });
  const scroll = node('div', '', { class: 'customization-parameters' });
  const footer = node('div', '', { class: 'customization-footer' });
  panel.append(scroll, footer);
  body.append(stage, panel);
  main.append(header, error, body);
  presentExplorer(root, main);
  let stopMotion = (): void => {};
  let shaderFailed = false;
  const showError = (cause: unknown): void => {
    stopMotion();
    reportError(root, cause);
    error.textContent = cause instanceof Error ? cause.message : String(cause);
    error.hidden = false;
    console.error('[grass explorer]', cause);
  };
  try {
    let appearance = generateGrass(grassSeed(parameters.get('grassSeed') ?? '42'));
    const renderers: GrassWindRenderer[] = [];
    let frame = 0;
    let previous: number | undefined;
    let seconds = 0;
    let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let wind: GrassWind = { ...GRASS_WIND_PRESETS.Breeze };
    let selectedPreset = 'Breeze';
    registerSnapshot(root, () => ({ appearance: { ...appearance }, wind: { ...wind }, seconds, paused, selectedPreset }));
    stopMotion = () => { cancelAnimationFrame(frame); frame = 0; previous = undefined; };
    signal.addEventListener('abort', () => {
      stopMotion();
      renderers.forEach(renderer => renderer.dispose());
    }, { once: true });
    try {
      for (const preview of [canvas, ...studies]) renderers.push(new GrassWindRenderer(preview, cause => {
        shaderFailed = true;
        stopMotion();
        showError(cause);
      }, signal));
    } catch (cause) {
      renderers.forEach(renderer => renderer.dispose());
      throw cause;
    }
    const section = (title: string): HTMLElement => {
      const result = node('section');
      result.append(node('h2', title));
      scroll.append(result);
      return result;
    };
    const button = (text: string, action: () => void): HTMLButtonElement => {
      const result = node('button', text, { type: 'button' });
      result.addEventListener('click', () => {
        try { action(); render(); error.hidden = !shaderFailed; } catch (cause) { showError(cause); }
      }, { signal });
      return result;
    };
    const intro = section('Grass tufts');
    intro.append(node('p', 'Pixel-stepped wind with anchored roots. Compare the same wind across all three shapes. Changes stay here.'));
    const movement = section('Wind shader');
    const presets = node('div', '', { class: 'pattern-options grass-wind-presets', role: 'group', 'aria-label': 'Wind preset' });
    const presetButtons = Object.entries(GRASS_WIND_PRESETS).map(([name, preset]) => button(name, () => {
      wind = { ...preset };
      selectedPreset = name;
    }));
    presets.append(...presetButtons);
    movement.append(presets);
    const windInputs: { input: HTMLInputElement; output: HTMLOutputElement; key: keyof GrassWind; unit: string }[] = [];
    for (const [title, key, min, max, step, unit] of [
      ['Strength', 'strength', 0, 5, 0.1, ' px'],
      ['Speed', 'speed', 0.2, 3, 0.1, '×'],
      ['Turbulence', 'turbulence', 0, 1, 0.05, ''],
    ] as const) {
      const label = node('label', title, { class: 'rig-range' });
      const output = node('output');
      const input = node('input', '', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': `Wind ${title.toLowerCase()}` });
      label.append(output, input);
      movement.append(label);
      windInputs.push({ input, output, key, unit });
      input.addEventListener('input', () => {
        wind[key] = Number(input.value);
        selectedPreset = '';
        render();
      }, { signal });
    }
    const direction = node('div', '', { class: 'pattern-options', role: 'group', 'aria-label': 'Wind direction' });
    const directions = [-1, 1].map(value => button(value < 0 ? 'Left' : 'Right', () => { wind.direction = value; selectedPreset = ''; }));
    direction.append(...directions);
    const actions = node('div', '', { class: 'forage-actions' });
    const pause = button('Pause wind', () => { paused = !paused; });
    const step = button('Step 0.25 s', () => { paused = true; seconds += 0.25; });
    const reset = button('Restart wind', () => { seconds = 0; });
    actions.append(pause, step);
    const motionTime = node('output', '', { 'aria-label': 'Wind time', 'aria-live': 'off' });
    movement.append(node('p', 'Direction'), direction, actions, reset, motionTime);
    const reduced = node('p', 'Wind starts paused because reduced motion is enabled.');
    reduced.hidden = !paused;
    movement.append(reduced);
    movement.append(button('Download motion', () => {
      const recipe = { version: 1, appearance, wind, seconds, paused };
      const url = URL.createObjectURL(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }));
      node('a', '', { href: url, download: `grass-motion-${appearance.seed}.json` }).click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    const choices: { buttons: HTMLButtonElement[]; selected: () => number }[] = [];
    for (const [title, key, names] of [
      ['Shape', 'shape', GRASS_SHAPES],
      ['Foliage', 'foliage', FOLIAGE_PALETTES.map(palette => palette.name)],
      ['Size', 'size', GRASS_SIZES],
      ['Density', 'density', GRASS_DENSITIES],
    ] as const) {
      const area = section(title);
      const group = node('div', '', { class: 'pattern-options', role: 'group', 'aria-label': title });
      const buttons = names.map((name, index) => button(name, () => { appearance[key] = index; }));
      group.append(...buttons);
      area.append(group);
      choices.push({ buttons, selected: () => appearance[key] });
    }
    const generation = section('Generation');
    const form = node('form', '', { class: 'color-seed-form', 'aria-label': 'Reproduce grass' });
    const label = node('label', 'Grass seed');
    const input = node('input', '', { type: 'text', inputmode: 'numeric', 'aria-label': 'Grass seed' });
    label.append(input);
    form.append(label, node('button', 'Apply', { type: 'submit' }));
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        appearance = generateGrass(grassSeed(input.value.trim()));
        writeUrl(); render(); error.hidden = !shaderFailed;
      } catch (cause) { showError(cause); }
    }, { signal });
    generation.append(form, button('Download PNG', () => {
      const exported = makeCanvas();
      const context = exported.getContext('2d');
      if (!context) throw new Error('Could not open the grass export canvas.');
      drawGrassPreview(context, appearance);
      exportPng(exported, `grass-${appearance.seed}.png`, signal, showError);
    }), button('Download recipe', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(appearance, null, 2)], { type: 'application/json' }));
      node('a', '', { href: url, download: `grass-${appearance.seed}.json` }).click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }), node('p', 'Seeds restore generated choices. Download keeps manual edits. Switching tabs starts a new preview.'));
    generation.append(node('a', 'Reference: SLYNYRD texture study', {
      class: 'forage-reference', href: 'https://www.slynyrd.com/blog/2018/2/15/pixelblog-2-texture',
      target: '_blank', rel: 'noopener noreferrer',
    }));
    const generate = button('Generate grass', () => {
      let seed = crypto.getRandomValues(new Uint32Array(1))[0];
      let candidate = generateGrass(seed);
      while (candidate.shape === appearance.shape && candidate.foliage === appearance.foliage
        && candidate.size === appearance.size && candidate.density === appearance.density) {
        seed = (seed + 1) >>> 0;
        candidate = generateGrass(seed);
      }
      appearance = candidate;
      writeUrl();
    });
    generate.className = 'primary';
    footer.append(generate);
    function writeUrl(): void {
      history.replaceState(null, '', `#/foliage?tab=grass&grassSeed=${appearance.seed}`);
    }
    function render(): void {
      renderers[0].setAppearance(appearance);
      renderers.slice(1).forEach((renderer, shape) => renderer.setAppearance({ ...appearance, shape }));
      windInputs.forEach(({ input, output, key, unit }) => {
        input.value = String(wind[key]);
        output.value = `${Number(wind[key].toFixed(2))}${unit}`;
      });
      presetButtons.forEach(b => b.setAttribute('aria-pressed', String(b.textContent === selectedPreset)));
      directions.forEach((b, index) => b.setAttribute('aria-pressed', String(wind.direction === (index === 0 ? -1 : 1))));
      pause.textContent = paused ? 'Resume wind' : 'Pause wind';
      pause.setAttribute('aria-pressed', String(paused));
      draw();
      schedule();
      canvas.setAttribute('aria-label', `${FOLIAGE_PALETTES[appearance.foliage].name} ${GRASS_SHAPES[appearance.shape].toLowerCase()}, ${GRASS_SIZES[appearance.size].toLowerCase()}, ${GRASS_DENSITIES[appearance.density].toLowerCase()}`);
      caption.value = `${GRASS_SHAPES[appearance.shape]} · ${GRASS_SIZES[appearance.size]} · ${GRASS_DENSITIES[appearance.density]}`;
      for (const choice of choices) choice.buttons.forEach((b, index) => b.setAttribute('aria-pressed', String(index === choice.selected())));
      if (document.activeElement !== input) input.value = String(appearance.seed);
    }
    function draw(): void {
      renderers.forEach(renderer => renderer.draw(seconds, wind));
      motionTime.value = `${seconds.toFixed(2)} s`;
    }
    function schedule(): void {
      stopMotion();
      if (!paused && wind.strength > 0 && !document.hidden && !signal.aborted && !shaderFailed) frame = requestAnimationFrame(tick);
    }
    function tick(now: number): void {
      if (signal.aborted) return;
      try {
        if (previous !== undefined) seconds += Math.min((now - previous) / 1000, 0.05);
        previous = now;
        draw();
        frame = requestAnimationFrame(tick);
      } catch (cause) { showError(cause); }
    }
    document.addEventListener('visibilitychange', schedule, { signal });
    const resize = new ResizeObserver(() => {
      const { width, height } = GRASS_PREVIEW_SIZE;
      const scale = Math.max(1, Math.min(10, Math.floor(Math.min((stage.clientWidth - 32) / width, (stage.clientHeight - 100) / height))));
      canvas.style.width = `${width * scale}px`;
      canvas.style.height = `${height * scale}px`;
    });
    resize.observe(stage);
    signal.addEventListener('abort', () => resize.disconnect(), { once: true });
    window.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input,button,select,textarea'))) return;
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); generate.click(); }
    }, { signal });
    writeUrl();
    render();
  } catch (cause) { showError(cause); }
}
