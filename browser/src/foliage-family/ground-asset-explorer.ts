import { foliageTabs, type StaticGroundAssetTab } from './foliage-tabs';
import { presentExplorer, registerSnapshot, reportError } from './pilot-host';

export interface GroundAssetAppearance {
  version: 1;
  seed: number;
  shape: number;
  palette: number;
  size: number;
  facing: number;
}

export interface GroundAssetWind {
  mode: number;
  preset: number;
  strength: number;
  speed: number;
  direction: number;
}

export interface GroundAssetStudy<Appearance extends GroundAssetAppearance = GroundAssetAppearance> {
  tab: StaticGroundAssetTab;
  name: string;
  title: string;
  paletteLabel: string;
  intro: string;
  dimensions: { readonly width: number; readonly height: number };
  shapes: readonly string[];
  palettes: readonly { readonly name: string }[];
  sizes: readonly string[];
  facings: readonly string[];
  defaultSeed?: number;
  seed: (value: string) => number;
  generate: (seed: number) => Appearance;
  draw: (context: CanvasRenderingContext2D, appearance: Appearance) => void;
  companion?: {
    label: string;
    dimensions: { readonly width: number; readonly height: number };
    draw: (context: CanvasRenderingContext2D, appearance: Appearance) => void;
  };
  motion?: {
    modes: readonly string[];
    presets: readonly string[];
    defaults: Readonly<GroundAssetWind>;
    draw: (context: CanvasRenderingContext2D, appearance: Appearance, seconds: number, wind: GroundAssetWind) => void;
    drawCompanion?: (context: CanvasRenderingContext2D, appearance: Appearance, seconds: number, wind: GroundAssetWind) => void;
  };
  references?: readonly { readonly title: string; readonly url: string; readonly note: string }[];
  extraChoices?: readonly {
    title: string;
    names: readonly string[];
    selected: (appearance: Appearance) => number;
    set: (appearance: Appearance, index: number) => void;
  }[];
}

export function mountGroundAssetExplorer<Appearance extends GroundAssetAppearance>(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal, study: GroundAssetStudy<Appearance>): void {
  const { name, title, dimensions } = study;
  document.title = `${title} · Foraging Explorer`;
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
    const result = document.createElement(tag);
    result.textContent = text;
    for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, value);
    return result;
  };
  const main = node('main', '', { class: 'runtime runtime-compact forage-lab', 'data-mode': 'foraging' });
  const header = node('header', '', { class: 'runtime-header' });
  header.append(node('a', 'Home', { class: 'button', href: '#/' }), node('h1', 'Foraging Explorer'), foliageTabs(study.tab));
  const error = node('div', '', { class: 'error-banner', role: 'alert', hidden: '' });
  const body = node('div', '', { class: 'runtime-body' });
  const stage = node('section', '', { class: 'stage forage-stage', 'aria-label': `${name} preview` });
  const makeCanvas = (): HTMLCanvasElement => node('canvas', '', {
    width: String(dimensions.width), height: String(dimensions.height), role: 'img',
  });
  const canvas = makeCanvas();
  canvas.className = `forage-bush ${name.toLowerCase()}-preview`;
  const caption = node('output', '', { class: 'forage-caption', 'aria-label': `${name} appearance` });
  const comparison = node('div', '', { class: 'grass-study', 'aria-label': `${name} ${study.motion ? 'motion' : 'silhouette'} comparison` });
  const studies = (study.motion?.modes ?? study.shapes).map(name => {
    const figure = node('figure');
    const preview = makeCanvas();
    preview.setAttribute('aria-label', name);
    figure.append(preview, node('figcaption', name));
    comparison.append(figure);
    return preview;
  });
  let companionCanvas: HTMLCanvasElement | undefined;
  if (study.companion) {
    const row = node('div', '', { class: 'asset-preview-row' });
    const single = node('figure');
    single.append(canvas, node('figcaption', `Individual ${name.toLowerCase()}`));
    const layered = node('figure');
    companionCanvas = node('canvas', '', {
      width: String(study.companion.dimensions.width), height: String(study.companion.dimensions.height),
      role: 'img', 'aria-label': study.companion.label, class: 'asset-companion',
    });
    layered.append(companionCanvas, node('figcaption', study.companion.label));
    row.append(single, layered);
    stage.append(row, caption, comparison);
  } else stage.append(canvas, caption, comparison);
  const panel = node('aside', '', { class: 'inspector forage-panel', 'aria-label': `${name} parameters` });
  const scroll = node('div', '', { class: 'customization-parameters' });
  const footer = node('div', '', { class: 'customization-footer' });
  panel.append(scroll, footer);
  body.append(stage, panel);
  main.append(header, error, body);
  presentExplorer(root, main);
  let stopMotion = (): void => {};
  const showError = (cause: unknown): void => {
    stopMotion();
    reportError(root, cause);
    error.textContent = cause instanceof Error ? cause.message : String(cause);
    error.hidden = false;
    console.error(`[${name.toLowerCase()} explorer]`, cause);
  };
  try {
    let appearance = study.generate(study.seed(parameters.get(`${name.toLowerCase()}Seed`) ?? String(study.defaultSeed ?? 42)));
    const contexts = [canvas, ...studies].map(preview => {
      const context = preview.getContext('2d');
      if (!context) throw new Error(`Could not open the ${name.toLowerCase()} canvas.`);
      return context;
    });
    const companionContext = companionCanvas?.getContext('2d');
    if (companionCanvas && !companionContext) throw new Error('Could not open the layered preview canvas.');
    let seconds = 0;
    let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wind: GroundAssetWind = { ...(study.motion?.defaults ?? { mode: 0, preset: 0, strength: 0, speed: 1, direction: 1 }) };
    registerSnapshot(root, () => ({
      appearance: { ...appearance }, wind: study.motion ? { ...wind } : null,
      seconds, paused, name, dimensions: { ...dimensions },
    }));
    let frame = 0;
    let previous: number | undefined;
    stopMotion = () => { cancelAnimationFrame(frame); frame = 0; previous = undefined; };
    signal.addEventListener('abort', stopMotion, { once: true });
    const button = (text: string, action: () => void): HTMLButtonElement => {
      const result = node('button', text, { type: 'button' });
      result.addEventListener('click', () => {
        try { action(); render(); error.hidden = true; } catch (cause) { showError(cause); }
      }, { signal });
      return result;
    };
    const section = (title: string): HTMLElement => {
      const result = node('section');
      result.append(node('h2', title));
      scroll.append(result);
      return result;
    };
    section(title).append(node('p', study.intro));
    const choices: { buttons: HTMLButtonElement[]; selected: () => number }[] = [];
    const options = (title: string, names: readonly string[], selected: () => number, set: (index: number) => void): void => {
      const area = section(title);
      const group = node('div', '', { class: 'pattern-options', role: 'group', 'aria-label': title });
      const buttons = names.map((name, index) => button(name, () => set(index)));
      group.append(...buttons);
      area.append(group);
      choices.push({ buttons, selected });
    };
    let pause: HTMLButtonElement | undefined;
    let motionTime: HTMLOutputElement | undefined;
    const motionInputs: { input: HTMLInputElement; output: HTMLOutputElement; key: 'strength' | 'speed' }[] = [];
    if (study.motion) {
      options('Motion', study.motion.modes, () => wind.mode, index => { wind.mode = index; });
      options('Wind', study.motion.presets, () => wind.preset, index => { wind.preset = index; });
      const movement = section('Playback');
      for (const [title, key, min, max, step] of [
        ['Strength', 'strength', 0, 6, 0.1], ['Speed', 'speed', 0.2, 2, 0.1],
      ] as const) {
        const label = node('label', title, { class: 'rig-range' });
        const output = node('output');
        const input = node('input', '', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': `Wind ${title.toLowerCase()}` });
        label.append(output, input);
        movement.append(label);
        motionInputs.push({ input, output, key });
        input.addEventListener('input', () => {
          try { wind[key] = Number(input.value); render(); error.hidden = true; } catch (cause) { showError(cause); }
        }, { signal });
      }
      options('Wind direction', ['Left', 'Right'], () => wind.direction === -1 ? 0 : 1, index => { wind.direction = index === 0 ? -1 : 1; });
      const actions = node('div', '', { class: 'forage-actions' });
      pause = button('Pause wind', () => { paused = !paused; });
      actions.append(pause, button('Step 0.25 s', () => { paused = true; seconds += 0.25; }));
      motionTime = node('output', '', { 'aria-label': 'Wind time', 'aria-live': 'off' });
      movement.append(actions, button('Restart wind', () => { seconds = 0; }), motionTime);
      if (paused) movement.append(node('p', 'Wind starts paused because reduced motion is enabled.'));
    }
    for (const [title, key, names] of [
      ['Shape', 'shape', study.shapes],
      [study.paletteLabel, 'palette', study.palettes.map(palette => palette.name)],
      ['Size', 'size', study.sizes],
      ['Facing', 'facing', study.facings],
    ] as const) {
      options(title, names, () => appearance[key], index => { appearance[key] = index; });
    }
    for (const choice of study.extraChoices ?? []) {
      options(choice.title, choice.names, () => choice.selected(appearance), index => choice.set(appearance, index));
    }
    const download = (blob: Blob, filename: string): void => {
      const url = URL.createObjectURL(blob);
      node('a', '', { href: url, download: filename }).click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const exports = section('Export');
    exports.append(button('Download PNG', () => {
      const filename = `${name.toLowerCase()}-${appearance.seed}-${appearance.shape}-${appearance.size}-${appearance.facing}.png`;
      const exported = makeCanvas();
      const context = exported.getContext('2d');
      if (!context) throw new Error(`Could not open the ${name.toLowerCase()} export canvas.`);
      study.draw(context, appearance);
      exported.toBlob(blob => {
        if (signal.aborted) return;
        if (!blob) { showError(new Error(`Could not export the ${name.toLowerCase()} PNG.`)); return; }
        download(blob, filename);
      }, 'image/png');
    }), button('Download recipe', () => {
      download(new Blob([JSON.stringify(appearance, null, 2)], { type: 'application/json' }), `${name.toLowerCase()}-${appearance.seed}.json`);
    }), node('p', `PNG keeps the transparent ${dimensions.width} × ${dimensions.height} pixel frame and ground baseline. Recipe includes manual choices.`));
    if (study.motion) exports.append(button('Download motion', () => {
      download(new Blob([JSON.stringify({ version: 1, appearance, wind, seconds, paused }, null, 2)], { type: 'application/json' }), `${name.toLowerCase()}-motion-${appearance.seed}.json`);
    }), node('p', 'PNG exports the still tree. Motion saves the current settings and time. Import is not implemented.'));
    const generation = section('Generation');
    const form = node('form', '', { class: 'color-seed-form', 'aria-label': `Reproduce ${name.toLowerCase()}` });
    const label = node('label', `${name} seed`);
    const input = node('input', '', { type: 'text', inputmode: 'numeric', 'aria-label': `${name} seed` });
    label.append(input);
    form.append(label, node('button', 'Apply', { type: 'submit' }));
    form.addEventListener('submit', event => {
      event.preventDefault();
      try {
        appearance = study.generate(study.seed(input.value.trim()));
        writeUrl(); render(); error.hidden = true;
      } catch (cause) { showError(cause); }
    }, { signal });
    generation.append(form, node('p', 'Seeds restore generated choices. Download keeps manual edits. Switching tabs starts a new preview.'));
    if (study.references?.length) {
      const references = node('details', '', { class: 'asset-references' });
      references.append(node('summary', 'Nature references'));
      for (const reference of study.references) {
        references.append(node('a', reference.title, { href: reference.url, target: '_blank', rel: 'noopener noreferrer' }),
          node('p', reference.note));
      }
      scroll.append(references);
    }
    const generate = button(`Generate ${name.toLowerCase()}`, () => {
      let seed = crypto.getRandomValues(new Uint32Array(1))[0];
      let next = study.generate(seed);
      while (next.shape === appearance.shape && next.palette === appearance.palette
        && next.size === appearance.size && next.facing === appearance.facing
        && (study.extraChoices ?? []).every(choice => choice.selected(next) === choice.selected(appearance))) {
        next = study.generate(seed = (seed + 1) >>> 0);
      }
      appearance = next;
      writeUrl();
    });
    generate.className = 'primary';
    footer.append(generate);
    function writeUrl(): void {
      history.replaceState(null, '', `#/foliage?tab=${study.tab}&${name.toLowerCase()}Seed=${appearance.seed}`);
    }
    function draw(): void {
      contexts.forEach((context, index) => {
        if (study.motion) study.motion.draw(context, appearance, seconds, { ...wind, mode: index === 0 ? wind.mode : index - 1 });
        else study.draw(context, index === 0 ? appearance : { ...appearance, shape: index - 1 });
      });
      if (companionContext) {
        if (study.motion?.drawCompanion) study.motion.drawCompanion(companionContext, appearance, seconds, wind);
        else study.companion?.draw(companionContext, appearance);
      }
      if (motionTime) motionTime.value = `${seconds.toFixed(2)} s`;
    }
    function schedule(): void {
      stopMotion();
      if (study.motion && !paused && wind.preset !== 0 && wind.strength > 0 && !document.hidden && !signal.aborted) frame = requestAnimationFrame(tick);
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
    function render(): void {
      draw();
      schedule();
      const extra = (study.extraChoices ?? []).map(choice => `${choice.title}: ${choice.names[choice.selected(appearance)]}`);
      const description = [study.shapes[appearance.shape], study.palettes[appearance.palette].name,
        study.sizes[appearance.size], study.facings[appearance.facing], ...extra].join(' · ');
      caption.value = description;
      canvas.setAttribute('aria-label', description);
      if (study.motion) canvas.setAttribute('aria-label', `${description} · ${study.motion.modes[wind.mode]}`);
      if (pause) {
        pause.textContent = paused ? 'Resume wind' : 'Pause wind';
        pause.setAttribute('aria-pressed', String(paused));
      }
      for (const { input, output, key } of motionInputs) {
        input.value = String(wind[key]);
        output.value = `${wind[key].toFixed(1)}${key === 'strength' ? ' px' : '×'}`;
      }
      for (const choice of choices) choice.buttons.forEach((b, index) => b.setAttribute('aria-pressed', String(index === choice.selected())));
      if (document.activeElement !== input) input.value = String(appearance.seed);
    }
    document.addEventListener('visibilitychange', () => { if (error.hidden) schedule(); }, { signal });
    const resize = new ResizeObserver(() => {
      const { width, height } = dimensions;
      const combinedWidth = width + (study.companion?.dimensions.width ?? 0);
      const combinedHeight = Math.max(height, study.companion?.dimensions.height ?? 0);
      const scale = Math.max(1, Math.min(10, Math.floor(Math.min((stage.clientWidth - (study.companion ? 56 : 32)) / combinedWidth, (stage.clientHeight - 100) / combinedHeight))));
      canvas.style.width = `${width * scale}px`;
      canvas.style.height = `${height * scale}px`;
      if (companionCanvas && study.companion) {
        companionCanvas.style.width = `${study.companion.dimensions.width * scale}px`;
        companionCanvas.style.height = `${study.companion.dimensions.height * scale}px`;
      }
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
