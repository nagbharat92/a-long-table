import { BERRY_LAYOUTS, BERRY_PALETTES, BUSH_PALETTES, BUSH_PREVIEW_SIZE, BUSH_SHAPES, CROP_MATURITIES, bushSeed, drawBushPreview, generateBush } from './core/bush-appearance';
import { BERRY_STAGES, BushCrop } from './core/bush-crop';
import { foliageTabs } from './foliage-tabs';
import { FoliageWindRenderer, FOLIAGE_WIND_PRESETS, type FoliageWind } from './render/foliage-wind';
import { exportPng, presentExplorer, registerSnapshot, reportError } from './pilot-host';

export function mountForagingExplorer(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal): void {
  document.title = 'Foraging Explorer · a long table';
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
    const result = document.createElement(tag);
    result.textContent = text;
    for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, value);
    return result;
  };
  const main = node('main', '', { class: 'runtime runtime-compact forage-lab', 'data-mode': 'foraging' });
  const header = node('header', '', { class: 'runtime-header' });
  header.append(node('a', 'Home', { class: 'button', href: '#/' }), node('h1', 'Foraging Explorer'));
  header.append(foliageTabs('bush'));
  const error = node('div', '', { class: 'error-banner', role: 'alert', hidden: '' });
  const body = node('div', '', { class: 'runtime-body' });
  const stage = node('section', '', { class: 'stage forage-stage', 'aria-label': 'Bush preview' });
  const canvas = node('canvas', '', { width: String(BUSH_PREVIEW_SIZE.width), height: String(BUSH_PREVIEW_SIZE.height), role: 'img', 'aria-label': 'Berry bush', class: 'forage-bush' });
  const previewState = node('output', '', { class: 'forage-caption', 'aria-label': 'Preview state' });
  const stageCounts = node('div', '', { class: 'forage-stage-counts', 'aria-label': 'Berry ripeness' });
  stage.append(canvas, previewState, stageCounts);
  const panel = node('aside', '', { class: 'inspector forage-panel', 'aria-label': 'Bush parameters' });
  const scroll = node('div', '', { class: 'customization-parameters' });
  const footer = node('div', '', { class: 'customization-footer' });
  body.append(stage, panel);
  panel.append(scroll, footer);
  main.append(header, error, body);
  presentExplorer(root, main);
  let shaderFailed = false;
  let stopMotion = (): void => {};
  const showError = (cause: unknown): void => {
    stopMotion();
    reportError(root, cause);
    error.textContent = cause instanceof Error ? cause.message : String(cause);
    error.hidden = false;
    console.error('[foraging explorer]', cause);
  };
  try {
    const button = (text: string, action: () => void): HTMLButtonElement => {
      const result = node('button', text, { type: 'button' });
      result.addEventListener('click', () => {
        try { action(); error.hidden = !shaderFailed; render(); } catch (cause) { showError(cause); }
      }, { signal });
      return result;
    };
    const initialSeed = bushSeed(parameters.get('bushSeed') ?? '42');
    let appearance = generateBush(initialSeed);
    let crop = new BushCrop(appearance);
    let paused = parameters.get('paused') === '1';
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not open the bush canvas.');
    let frame = 0;
    let windSeconds = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let windPaused = paused || reducedMotion;
    let wind: FoliageWind = { ...FOLIAGE_WIND_PRESETS.Breeze };
    let selectedPreset = 'Breeze';
    registerSnapshot(root, () => ({
      appearance: { ...appearance }, wind: { ...wind }, seconds: windSeconds,
      paused, windPaused, selectedPreset,
      crop: { elapsed: crop.elapsed, available: crop.available, collected: crop.collected, value: crop.value,
        fruits: crop.fruits.map(fruit => ({ ...fruit })) },
    }));
    const windCanvas = node('canvas', '', { width: canvas.width.toString(), height: canvas.height.toString() });
    const profile = { anchor: 38.5, height: 36, response: 0.65, swayRate: 0.55, flutter: 0.35 };
    const renderer = new FoliageWindRenderer(windCanvas, cause => {
      shaderFailed = true;
      cancelAnimationFrame(frame);
      showError(cause);
    }, signal, profile);
    stopMotion = () => { cancelAnimationFrame(frame); };
    signal.addEventListener('abort', () => {
      cancelAnimationFrame(frame);
      renderer.dispose();
    }, { once: true });
    const section = (title: string): HTMLElement => {
      const result = node('section');
      result.append(node('h2', title));
      scroll.append(result);
      return result;
    };
    const choices: { buttons: HTMLButtonElement[]; selected: () => number }[] = [];
    function options(title: string, names: readonly string[], selected: () => number, set: (index: number) => void): void {
      const area = section(title);
      const group = node('div', '', { class: 'pattern-options', role: 'group', 'aria-label': title });
      const buttons = names.map((name, index) => button(name, () => set(index)));
      group.append(...buttons);
      area.append(group);
      choices.push({ buttons, selected });
    }
    const identity = section('Berry bush');
    identity.append(node('p', 'Berries ripen independently on each shape. Shape and crop edits reset the harvest. Changes stay in this explorer.'));
    const movement = section('Wind shader');
    movement.append(node('p', 'Heavier canopy sway with light leaf flutter. Roots stay fixed; berries move with their branches. Wind playback is separate from crop growth.'));
    const presets = node('div', '', { class: 'pattern-options grass-wind-presets', role: 'group', 'aria-label': 'Wind preset' });
    const presetButtons = Object.entries(FOLIAGE_WIND_PRESETS).map(([name, preset]) => button(name, () => {
      wind = { ...preset };
      selectedPreset = name;
    }));
    presets.append(...presetButtons);
    movement.append(presets);
    const windInputs: { input: HTMLInputElement; output: HTMLOutputElement; key: keyof FoliageWind; unit: string }[] = [];
    for (const [title, key, min, max, step, unit] of [
      ['Strength', 'strength', 0, 5, 0.1, ''],
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
        try {
          wind[key] = Number(input.value);
          selectedPreset = '';
          render();
        } catch (cause) { showError(cause); }
      }, { signal });
    }
    const direction = node('div', '', { class: 'pattern-options', role: 'group', 'aria-label': 'Wind direction' });
    const directions = [-1, 1].map(value => button(value < 0 ? 'Left' : 'Right', () => { wind.direction = value; selectedPreset = ''; }));
    direction.append(...directions);
    const windActions = node('div', '', { class: 'forage-actions' });
    const pauseWind = button('Pause wind', () => { windPaused = !windPaused; });
    windActions.append(pauseWind, button('Step 0.25 s', () => { windPaused = true; windSeconds += 0.25; }));
    const windTime = node('output', '', { 'aria-label': 'Wind time', 'aria-live': 'off' });
    movement.append(node('p', 'Direction'), direction, windActions, button('Restart wind', () => { windSeconds = 0; }), windTime);
    if (reducedMotion) movement.append(node('p', 'Wind starts paused because reduced motion is enabled.'));
    movement.append(button('Download motion', () => {
      const recipe = { version: 1, appearance, wind, seconds: windSeconds, paused: windPaused };
      const url = URL.createObjectURL(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }));
      node('a', '', { href: url, download: `bush-motion-${appearance.seed}.json` }).click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    options('Shape', BUSH_SHAPES.map(p => p.name), () => appearance.shape, index => { appearance.shape = index; crop = new BushCrop(appearance); });
    options('Foliage', BUSH_PALETTES.map(p => p.name), () => appearance.foliage, index => { appearance.foliage = index; });
    options('Berry color', BERRY_PALETTES.map(p => p.name), () => appearance.berries, index => { appearance.berries = index; });
    options('Berry placement', BERRY_LAYOUTS.map(p => p.name), () => appearance.layout, index => { appearance.layout = index; crop = new BushCrop(appearance); });
    const density = section('Crop size');
    const countLabel = node('label', '', { class: 'forage-count-label' });
    const countValue = node('span');
    const countInput = node('input', '', { type: 'range', min: '3', max: '12', step: '1', 'aria-label': 'Berry count' });
    countLabel.append(countValue, countInput);
    density.append(countLabel);
    countInput.addEventListener('input', () => {
      try {
        appearance.count = Number(countInput.value);
        crop = new BushCrop(appearance);
        error.hidden = !shaderFailed;
        render();
      } catch (cause) { showError(cause); }
    }, { signal });
    options('Starting ripeness', CROP_MATURITIES, () => appearance.maturity, index => { appearance.maturity = index; crop = new BushCrop(appearance); });
    const legend = BERRY_STAGES.filter(name => name !== 'picked').map(name => {
      const item = node('span', '', { class: `forage-ripeness forage-ripeness-${name}` });
      const count = node('span');
      item.append(node('i', '', { 'aria-hidden': 'true' }), count);
      stageCounts.append(item);
      return { name, count };
    });
    const lifecycle = section('Growth & gathering');
    const phases = node('div', '', { class: 'pattern-options', role: 'group', 'aria-label': 'Set bush state' });
    const phaseButtons = (['ripe', 'depleted', 'growing'] as const).map(phase => button(phase[0].toUpperCase() + phase.slice(1), () => crop.setState(phase)));
    phases.append(...phaseButtons);
    const gather = button('Gather', () => { crop.gather(); });
    gather.className = 'primary';
    const cancel = button('Interrupt', () => crop.cancel());
    const actions = node('div', '', { class: 'forage-actions' });
    actions.append(gather, cancel);
    const progress = node('progress', '', { max: '1', value: '0', 'aria-label': 'Gathering progress' });
    const readout = node('output', '', { 'aria-label': 'Bush state', 'data-testid': 'bush-state' });
    const berries = node('output', '', { 'aria-label': 'Berries' });
    const value = node('output', '', { 'aria-label': 'Collected value' });
    const available = node('output', '', { 'aria-label': 'Available harvest' });
    const status = node('output', '', { 'aria-label': 'Gathering status', 'aria-live': 'polite' });
    lifecycle.append(phases, actions, progress, readout, available, berries, value, status, node('p', 'Gather takes 0.8 s. Only ripe and sweet berries are picked: 1 and 2 value each. Other fruit keeps growing; picked spots bud again in about 6–9 s.'));
    const playback = node('div', '', { class: 'forage-actions' });
    const pause = button('Pause', () => { paused = !paused; writeUrl(); });
    playback.append(pause, button('Advance 1 s', () => { paused = true; crop.advance(1); writeUrl(); }), button('Advance 10 s', () => { paused = true; crop.advance(10); writeUrl(); }));
    lifecycle.append(playback, button('Reset simulation', () => { crop = new BushCrop(appearance); }));
    const generation = section('Generation');
    const form = node('form', '', { class: 'color-seed-form', 'aria-label': 'Reproduce bush' });
    const label = node('label', 'Bush seed');
    const input = node('input', '', { type: 'text', inputmode: 'numeric', 'aria-label': 'Bush seed' });
    const apply = node('button', 'Apply', { type: 'submit' });
    label.append(input);
    form.append(label, apply);
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        const next = generateBush(bushSeed(input.value.trim()));
        const nextCrop = new BushCrop(next);
        appearance = next;
        crop = nextCrop;
        writeUrl(); error.hidden = !shaderFailed; render();
      }
      catch (cause) { showError(cause); }
    }, { signal });
    generation.append(form, button('Download PNG', () => {
      const exported = node('canvas', '', { width: String(canvas.width), height: String(canvas.height) });
      const context = exported.getContext('2d');
      if (!context) throw new Error('Could not open the bush export canvas.');
      const phase = crop.available ? 'ripe' : crop.fruits.every(fruit => fruit.stage === 'picked') ? 'depleted' : 'growing';
      drawBushPreview(context, phase, appearance, crop.fruits);
      exportPng(exported, `berry-bush-${appearance.seed}.png`, signal, showError);
    }), button('Download recipe', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(appearance, null, 2)], { type: 'application/json' }));
      node('a', '', { href: url, download: `berry-bush-${appearance.seed}.json` }).click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }), node('p', 'The seed restores the starting crop. Crop edits and generation reset time and collected value. Download a recipe to keep manual choices.'));
    const generate = (): void => {
      let next = crypto.getRandomValues(new Uint32Array(1))[0];
      while (true) {
        const candidate = generateBush(next);
        if (candidate.shape !== appearance.shape || candidate.foliage !== appearance.foliage || candidate.berries !== appearance.berries || candidate.layout !== appearance.layout) {
          appearance = candidate;
          crop = new BushCrop(appearance);
          break;
        }
        next = (next + 1) >>> 0;
      }
      writeUrl();
    };
    const generateButton = button('Generate bush', generate);
    generateButton.className = 'primary';
    footer.append(generateButton);
    function writeUrl(): void {
      const next = new URLSearchParams({ tab: 'bush', bushSeed: String(appearance.seed) });
      if (paused) next.set('paused', '1');
      history.replaceState(null, '', `#/foliage?${next}`);
    }
    function render(): void {
      const phase = crop.available ? 'ripe' : crop.fruits.every(fruit => fruit.stage === 'picked') ? 'depleted' : 'growing';
      if (!shaderFailed) {
        drawBushPreview(context!, phase, appearance, crop.fruits);
        profile.height = appearance.shape === 1 ? 22 : 36;
        renderer.setSprite(canvas, appearance.seed);
        renderer.draw(windSeconds, wind);
        context!.clearRect(0, 0, canvas.width, canvas.height);
        context!.drawImage(windCanvas, 0, 0);
      }
      windInputs.forEach(({ input, output, key, unit }) => {
        input.value = String(wind[key]);
        output.value = `${Number(wind[key].toFixed(2))}${unit}`;
      });
      presetButtons.forEach(b => b.setAttribute('aria-pressed', String(b.textContent === selectedPreset)));
      directions.forEach((b, index) => b.setAttribute('aria-pressed', String(wind.direction === (index === 0 ? -1 : 1))));
      pauseWind.textContent = windPaused ? 'Resume wind' : 'Pause wind';
      pauseWind.setAttribute('aria-pressed', String(windPaused));
      windTime.value = `${windSeconds.toFixed(2)} s`;
      canvas.setAttribute('aria-label', `${BUSH_PALETTES[appearance.foliage].name} berry bush, ${BUSH_SHAPES[appearance.shape].name.toLowerCase()}, ${crop.available} of ${appearance.count} berries ready, ${crop.availableValue} value`);
      for (const choice of choices) choice.buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === choice.selected())));
      phaseButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(
        i === 0 ? crop.fruits.every(fruit => fruit.stage === 'sweet')
          : i === 1 ? phase === 'depleted' : crop.fruits.every(fruit => fruit.stage === 'bud'),
      )));
      previewState.value = `${crop.available} / ${appearance.count} ready · ${crop.availableValue} value now`;
      readout.value = `Time ${crop.elapsed.toFixed(1)} s`;
      available.value = `${crop.available} ready · ${crop.availableValue} value${crop.nextRipe === null ? '' : ` · Next ripe in ${Math.ceil(crop.nextRipe)} s`}`;
      berries.value = `Berries ${crop.collected}`;
      value.value = `Collected value ${crop.value}`;
      const message = crop.feedback || (crop.available ? 'Ready to gather' : 'Berries are ripening');
      if (status.value !== message) status.value = message;
      progress.value = crop.progress;
      gather.disabled = crop.available === 0 || crop.gathering;
      cancel.disabled = !crop.gathering;
      countValue.textContent = `${appearance.count} berry spots`;
      countInput.value = String(appearance.count);
      for (const { name, count } of legend) {
        count.textContent = `${crop.fruits.filter(fruit => fruit.stage === name).length} ${name}`;
      }
      stageCounts.style.setProperty('--berry-fruit', BERRY_PALETTES[appearance.berries].fruit);
      stageCounts.style.setProperty('--berry-light', BERRY_PALETTES[appearance.berries].light);
      stageCounts.style.setProperty('--berry-green', BUSH_PALETTES[appearance.foliage].bud);
      stageCounts.style.setProperty('--berry-leaf', BUSH_PALETTES[appearance.foliage].light);
      pause.textContent = paused ? 'Resume' : 'Pause';
      pause.setAttribute('aria-pressed', String(paused));
      if (document.activeElement !== input) input.value = String(appearance.seed);
    }
    const resize = new ResizeObserver(() => {
      const { width, height } = BUSH_PREVIEW_SIZE;
      const scale = Math.max(1, Math.min(12, Math.floor(Math.min((stage.clientWidth - 80) / width, (stage.clientHeight - 120) / height))));
      canvas.style.width = `${width * scale}px`;
      canvas.style.height = `${height * scale}px`;
    });
    resize.observe(stage);
    let previous: number | undefined;
    function tick(now: number): void {
      if (signal.aborted) return;
      try {
        const delta = previous === undefined ? 0 : Math.max(0, Math.min(0.1, (now - previous) / 1000));
        if (!document.hidden) {
          if (!paused) crop.advance(delta);
          if (!windPaused && wind.strength > 0) windSeconds += delta;
        }
        previous = now;
        render();
        frame = requestAnimationFrame(tick);
      } catch (cause) { showError(cause); }
    }
    document.addEventListener('visibilitychange', () => { previous = undefined; }, { signal });
    signal.addEventListener('abort', () => { cancelAnimationFrame(frame); resize.disconnect(); }, { once: true });
    window.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input,button,select,textarea'))) return;
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); generateButton.click(); }
    }, { signal });
    writeUrl();
    render();
    frame = requestAnimationFrame(tick);
  } catch (cause) { showError(cause); }
}
