import {
  appearanceSeed, CHARACTER_COLOR_PALETTES, CHARACTER_EAR_MARKINGS, earLayoutName,
  generateAppearance, linkedAccessoryColor, linkedEarColor, linkedPatternColor, renderAppearance,
  type GeneratedCharacterAppearance,
} from '../core/character-appearance';
import { CHARACTER_EAR_SHAPES } from '../core/character-ear-shape';
import { CHARACTER_EXPRESSIONS } from '../core/character-expression';
import { CHARACTER_ACCESSORIES } from '../core/character-accessory';
import { buildCharacterArtwork, exportCharacterDefinition } from '../core/character-definition';
import { createCharacterRig, RIG_HEIGHT, RIG_WIDTH } from '../core/character-rig';
import { action, choices, download, el, section, type PilotController, type PilotShell } from './ui';
import './character.css';

type Family = 'Color' | 'Ears' | 'Expression' | 'Accessories';
type Crop = readonly [number, number, number, number];
const full: Crop = [0, 0, RIG_WIDTH, RIG_HEIGHT];
const earsCrop: Crop = [0, 0, 18, 8];
const faceCrop: Crop = [0, 6, 18, 13];
const accessoryCrop: Crop = [1, 18, 16, 11];

export async function mountCharacter(shell: PilotShell, parameters: URLSearchParams): Promise<PilotController> {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const abort = () => lifetime.abort();
  shell.signal.addEventListener('abort', abort, { once: true });
  if (shell.signal.aborted) abort();
  const noop: PilotController = { destroy: abort };
  if (signal.aborted) return noop;
  const safe = (run: () => void) => () => {
    if (signal.aborted) return;
    try { run(); } catch (cause) { shell.showError(cause); }
  };
  let seed = crypto.getRandomValues(new Uint32Array(1))[0];
  const supplied = parameters.get('colorSeed');
  if (supplied !== null) {
    try { seed = appearanceSeed(supplied); } catch (cause) { shell.showError(cause); }
  }
  const image = new Image();
  image.src = `${import.meta.env.BASE_URL}assets/rabbit.png`;
  try {
    await image.decode();
    if (signal.aborted) return noop;
    if (image.width !== RIG_WIDTH || image.height !== RIG_HEIGHT) {
      throw new Error('The rabbit artwork has unexpected dimensions.');
    }
  } catch (cause) {
    if (!signal.aborted) shell.showError(cause instanceof Error && cause.message.includes('dimensions')
      ? cause : new Error('Could not load the rabbit artwork. Return to Character to try again.'));
    return noop;
  }
  const original = el('canvas');
  original.width = RIG_WIDTH;
  original.height = RIG_HEIGHT;
  const originalContext = original.getContext('2d');
  if (!originalContext) {
    shell.showError(new Error('Could not open the character canvas.'));
    return noop;
  }
  originalContext.drawImage(image, 0, 0);
  const source = originalContext.getImageData(0, 0, RIG_WIDTH, RIG_HEIGHT).data;
  let appearance = generateAppearance(seed);
  let originalColors = structuredClone(appearance.parameters.color);
  const rig = createCharacterRig();
  const updates: Array<() => void> = [];
  const previews: Array<{ canvas: HTMLCanvasElement; crop: Crop; variant: () => GeneratedCharacterAppearance }> = [];
  const owned: HTMLElement[] = [];
  let active: Family = 'Color';

  function button(label: string, run: () => void, className = ''): HTMLButtonElement {
    return action(label, safe(run), signal, className);
  }
  function paint(canvas: HTMLCanvasElement, pixels: Uint8ClampedArray, crop: Crop = full): void {
    const context = canvas.getContext('2d');
    const bufferContext = original.getContext('2d');
    if (!context || !bufferContext) throw new Error('Could not draw a character variation.');
    const data = bufferContext.createImageData(RIG_WIDTH, RIG_HEIGHT);
    data.data.set(pixels);
    bufferContext.putImageData(data, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(original, ...crop, 0, 0, canvas.width, canvas.height);
  }
  function thumbnail(crop: Crop, variant: () => GeneratedCharacterAppearance, scale = 3): HTMLCanvasElement {
    const canvas = el('canvas');
    canvas.width = crop[2];
    canvas.height = crop[3];
    canvas.style.width = `${crop[2] * scale}px`;
    canvas.style.height = `${crop[3] * scale}px`;
    canvas.setAttribute('aria-hidden', 'true');
    previews.push({ canvas, crop, variant });
    return canvas;
  }
  function variant(change: (next: GeneratedCharacterAppearance) => void): () => GeneratedCharacterAppearance {
    return () => {
      const next = structuredClone(appearance);
      change(next);
      return next;
    };
  }
  function visualChoices<T extends string>(
    label: string, items: readonly { type: T; name: string }[], crop: Crop,
    current: () => T, change: (next: GeneratedCharacterAppearance, value: T) => void,
  ): HTMLDivElement {
    const group = el('div', 'p-choices p-character-options');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const item of items) {
      const choice = button(item.name, () => { change(appearance, item.type); render(); }, 'p-thumbnail');
      choice.prepend(thumbnail(crop, variant(next => change(next, item.type))));
      group.append(choice);
      updates.push(() => choice.setAttribute('aria-pressed', String(current() === item.type)));
    }
    return group;
  }
  function colorField(label: string, value: () => string, change: (color: string) => void, disabled = () => false): HTMLLabelElement {
    const row = el('label', 'p-character-color');
    const input = el('input');
    input.type = 'color';
    input.setAttribute('aria-label', label);
    const output = el('output');
    row.append(input, el('span', '', label), output);
    input.addEventListener('input', safe(() => { change(input.value); render(); }), { signal });
    updates.push(() => {
      input.value = value();
      input.disabled = disabled();
      output.value = value();
    });
    return row;
  }
  function links(label: string, current: () => 'coat' | 'custom', change: (mode: 'coat' | 'custom') => void): HTMLDivElement {
    const control = choices(label, [
      { value: 'coat' as const, label: 'Follow coat' },
      { value: 'custom' as const, label: 'Custom color' },
    ], current(), mode => safe(() => { change(mode); render(); })(), signal);
    updates.push(() => control.set(current()));
    return control.element;
  }

  shell.stage.classList.add('p-creator-stage', 'p-character-stage');
  const canvas = el('canvas', 'p-character-rabbit');
  canvas.width = RIG_WIDTH;
  canvas.height = RIG_HEIGHT;
  canvas.setAttribute('role', 'img');
  shell.stage.append(canvas);
  const heading = el('div');
  heading.append(el('h1', '', 'Character'), el('p', 'p-muted', 'Generate a rabbit, then make it yours.'));
  const stageActions = el('div', 'p-generation');
  stageActions.append(button('Generate character', () => replaceCharacter(nextSeed()), 'p-primary'));
  const seedLabel = el('output', 'p-character-seed');
  seedLabel.setAttribute('aria-label', 'Current character seed');
  stageActions.append(seedLabel);
  shell.subject.append(heading);
  shell.primary.append(stageActions);
  owned.push(canvas, heading, stageActions);

  shell.tray.hidden = false;
  shell.tray.classList.add('p-character-tray');
  shell.tray.setAttribute('aria-label', 'Character customization');
  const tabs = el('div', 'p-tray-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Character categories');
  const content = el('div', 'p-tray-content');
  const families = new Map<Family, HTMLElement>();
  const categoryButtons = new Map<Family, HTMLButtonElement>();
  const categoryCrops: Record<Family, Crop> = { Color: full, Ears: earsCrop, Expression: faceCrop, Accessories: accessoryCrop };
  for (const family of ['Color', 'Ears', 'Expression', 'Accessories'] as const) {
    const panel = section(family);
    panel.setAttribute('aria-label', `${family} customization`);
    families.set(family, panel);
    content.append(panel);
    const tab = button(family, () => {
      active = family;
      syncCategory();
      shell.status(`${family} controls`);
    }, 'p-character-tab');
    tab.prepend(thumbnail(categoryCrops[family], () => appearance, 1));
    categoryButtons.set(family, tab);
    tabs.append(tab);
  }
  shell.tray.append(tabs, content);
  owned.push(tabs, content);
  function syncCategory(): void {
    for (const [family, panel] of families) {
      panel.hidden = family !== active;
      categoryButtons.get(family)!.setAttribute('aria-pressed', String(family === active));
    }
  }
  syncCategory();

  const colorPanel = families.get('Color')!;
  const palettes = el('div', 'p-choices p-character-palettes');
  palettes.setAttribute('role', 'group');
  palettes.setAttribute('aria-label', 'Color palettes');
  for (const palette of CHARACTER_COLOR_PALETTES) {
    const swatch = button(palette.name, () => {
      appearance.parameters.color = { coat: palette.coat, shade: palette.shade };
      render();
    }, 'p-character-palette');
    const chips = el('span', 'p-character-chips');
    chips.setAttribute('aria-hidden', 'true');
    for (const color of [palette.coat, palette.shade]) {
      const chip = el('span');
      chip.style.backgroundColor = color;
      chips.append(chip);
    }
    swatch.prepend(chips);
    palettes.append(swatch);
    updates.push(() => swatch.setAttribute('aria-pressed', String(
      appearance.parameters.color.coat === palette.coat && appearance.parameters.color.shade === palette.shade)));
  }
  const colors = el('div', 'p-row');
  colors.append(
    colorField('Coat', () => appearance.parameters.color.coat, value => { appearance.parameters.color.coat = value; }),
    colorField('Shading', () => appearance.parameters.color.shade, value => { appearance.parameters.color.shade = value; }),
    button('Reset palette', () => { appearance.parameters.color = structuredClone(originalColors); render(); }),
  );
  colorPanel.append(palettes, colors);

  const earPanel = families.get('Ears')!;
  const earGrid = el('div', 'p-tray-grid p-character-ear-grid');
  const shapes = el('div');
  shapes.append(el('h3', 'p-label', 'Shape'), visualChoices('Ear shape', CHARACTER_EAR_SHAPES, earsCrop,
    () => appearance.parameters.ears.shape ?? 'upright', (next, value) => { next.parameters.ears.shape = value; }));
  const markings = el('div');
  const markingChoices = choices('Ear markings', CHARACTER_EAR_MARKINGS.map(item => ({ value: item.type, label: item.name })),
    appearance.parameters.ears.type, value => safe(() => { appearance.parameters.ears.type = value; render(); })(), signal);
  updates.push(() => markingChoices.set(appearance.parameters.ears.type));
  markings.append(el('h3', 'p-label', 'Markings'), markingChoices.element);
  earGrid.append(shapes, markings);
  const earColors = el('div', 'p-row');
  earColors.append(
    colorField('Ear color', () => appearance.parameters.ears.color, value => {
      appearance.parameters.ears.color = value;
      appearance.parameters.ears.colorMode = 'custom';
    }, () => appearance.parameters.ears.type === 'plain'),
    links('Ear color linking', () => appearance.parameters.ears.colorMode, mode => { appearance.parameters.ears.colorMode = mode; }),
  );
  const earLayout = el('p', 'p-muted');
  updates.push(() => { earLayout.textContent = earLayoutName(appearance.parameters.ears, appearance.parameters.pattern); });
  earPanel.append(earGrid, earColors, earLayout);

  const expressions = families.get('Expression')!;
  const expressionDetails = el('p', 'p-muted');
  expressions.append(visualChoices('Facial expressions', CHARACTER_EXPRESSIONS, faceCrop,
    () => appearance.parameters.expression.type, (next, value) => { next.parameters.expression.type = value; }), expressionDetails);
  updates.push(() => {
    expressionDetails.textContent = CHARACTER_EXPRESSIONS.find(item => item.type === appearance.parameters.expression.type)!.description;
  });
  const accessories = families.get('Accessories')!;
  const accessoryDetails = el('p', 'p-muted');
  const accessoryColors = el('div', 'p-row');
  accessoryColors.append(
    colorField('Accessory color', () => appearance.parameters.accessory.color, value => {
      appearance.parameters.accessory.color = value;
      appearance.parameters.accessory.colorMode = 'custom';
    }, () => appearance.parameters.accessory.type === 'none'),
    links('Accessory color linking', () => appearance.parameters.accessory.colorMode, mode => { appearance.parameters.accessory.colorMode = mode; }),
  );
  accessories.append(visualChoices('Accessories', CHARACTER_ACCESSORIES, accessoryCrop,
    () => appearance.parameters.accessory.type, (next, value) => { next.parameters.accessory.type = value; }), accessoryColors, accessoryDetails);
  updates.push(() => {
    accessoryDetails.textContent = CHARACTER_ACCESSORIES.find(item => item.type === appearance.parameters.accessory.type)!.description;
  });

  const tools = section('Character recipe');
  const form = el('form', 'p-row');
  form.setAttribute('aria-label', 'Reproduce character');
  const seedField = el('label', 'p-character-seed-field', 'Character seed');
  const seedInput = el('input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedInput.setAttribute('aria-label', 'Character seed');
  seedField.append(seedInput);
  const apply = el('button', 'p-button', 'Apply seed');
  apply.type = 'submit';
  form.append(seedField, apply);
  form.addEventListener('submit', event => {
    event.preventDefault();
    safe(() => replaceCharacter(appearanceSeed(seedInput.value.trim())))();
  }, { signal });
  tools.append(form, el('p', 'p-muted', 'A seed restores the generated character. Download the recipe to keep your manual edits.'),
    button('Download recipe', () => download(`rabbit-character-${seed}.json`, exportCharacterDefinition(appearance, rig))));
  shell.toolsContent.append(tools);
  owned.push(tools);

  function nextSeed(): number {
    const next = crypto.getRandomValues(new Uint32Array(1))[0];
    return next === seed ? (next + 1) >>> 0 : next;
  }
  function updateUrl(): void {
    const next = new URLSearchParams(parameters);
    next.set('colorSeed', String(seed));
    history.replaceState(history.state, '', `#/character?${next}`);
  }
  function replaceCharacter(next: number): void {
    const generated = generateAppearance(next);
    // Validate the new artwork before replacing a character with manual edits.
    buildCharacterArtwork(source, generated);
    seed = next;
    appearance = generated;
    originalColors = structuredClone(generated.parameters.color);
    render();
    updateUrl();
    shell.status(`Generated character ${seed}`);
  }
  function render(): void {
    const { color, pattern, ears, accessory, expression } = appearance.parameters;
    if (pattern.colorMode === 'coat') pattern.color = linkedPatternColor(color, pattern.type);
    if (ears.colorMode === 'coat') ears.color = linkedEarColor(color, ears.type);
    if (accessory.colorMode === 'coat') accessory.color = linkedAccessoryColor(color);
    paint(canvas, buildCharacterArtwork(source, appearance).source);
    for (const preview of previews) paint(preview.canvas, renderAppearance(source, preview.variant()), preview.crop);
    for (const update of updates) update();
    seedInput.value = String(seed);
    seedLabel.value = `Seed ${seed}`;
    canvas.dataset.seed = String(seed);
    const expressionName = CHARACTER_EXPRESSIONS.find(item => item.type === expression.type)!.name;
    const earName = CHARACTER_EAR_SHAPES.find(item => item.type === (ears.shape ?? 'upright'))!.name;
    const accessoryName = CHARACTER_ACCESSORIES.find(item => item.type === accessory.type)!.name;
    canvas.setAttribute('aria-label', `Customized rabbit, ${expressionName.toLowerCase()} expression, ${earName.toLowerCase()} ears, ${accessoryName.toLowerCase()} accessory`);
  }
  const resize = new ResizeObserver(() => {
    if (signal.aborted) return;
    const style = getComputedStyle(shell.stage);
    const width = shell.stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = shell.stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    const scale = Math.max(1, Math.min(20, Math.floor(Math.min(width / RIG_WIDTH, height / RIG_HEIGHT))));
    canvas.style.width = `${RIG_WIDTH * scale}px`;
    canvas.style.height = `${RIG_HEIGHT * scale}px`;
  });
  resize.observe(shell.stage);
  signal.addEventListener('abort', () => resize.disconnect(), { once: true });
  safe(() => { render(); updateUrl(); })();
  return {
    destroy() {
      abort();
      shell.signal.removeEventListener('abort', abort);
      for (const node of owned) node.remove();
      shell.stage.classList.remove('p-creator-stage', 'p-character-stage');
      shell.tray.classList.remove('p-character-tray');
      shell.tray.hidden = true;
      shell.tray.removeAttribute('aria-label');
    },
    snapshot: () => ({ seed, appearance: structuredClone(appearance) }),
  };
}
