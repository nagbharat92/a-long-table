import {
  appearanceSeed, CHARACTER_EAR_MARKINGS,
  earLayoutName, linkedAccessoryColor, linkedEarColor, linkedPatternColor,
  type CharacterAppearance, type CharacterColors, type GeneratedCharacterAppearance,
} from './core/character-appearance';
import { RIG_HEIGHT, RIG_WIDTH, type CharacterSpecies } from './core/character-rig';
import { generateSpeciesAppearance, speciesPalettes } from './core/character-species';
import { CHARACTER_EXPRESSIONS } from './core/character-expression';
import { CHARACTER_ACCESSORIES } from './core/character-accessory';
import { CHARACTER_EAR_SHAPES } from './core/character-ear-shape';
import { buildCharacterArtwork, exportCharacterDefinition, type CharacterArtwork } from './core/character-definition';
import type { CharacterRigState } from './core/character-rig';

export interface CharacterCustomization {
  generate(): void;
  getSeed(): number;
  getAppearance(): GeneratedCharacterAppearance;
  setSpecies(species: CharacterSpecies): void;
}

export async function mountCharacterCustomization(
  panel: HTMLElement,
  preview: HTMLElement,
  initialSeed: string | null,
  signal: AbortSignal,
  onError: (cause: unknown) => void,
  onChange: (appearance: CharacterAppearance, artwork: CharacterArtwork) => void,
  getRigSetup: () => CharacterRigState,
  initialSpecies: CharacterSpecies = 'rabbit',
): Promise<CharacterCustomization | undefined> {
  let species = initialSpecies;
  let seed = initialSeed === null ? (species !== 'rabbit' ? 0 : crypto.getRandomValues(new Uint32Array(1))[0]) : appearanceSeed(initialSeed);
  const image = new Image();
  image.src = new URL('./assets/rabbit.png', import.meta.url).href;
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        image.src = '';
        reject(new DOMException('Character loading was cancelled.', 'AbortError'));
      };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      image.decode().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  } catch (cause) {
    if (signal.aborted) return;
    throw new Error('Could not load the rabbit artwork. Try opening Character again.', { cause });
  }
  if (signal.aborted) return;
  if (image.width !== RIG_WIDTH || image.height !== RIG_HEIGHT) throw new Error('The rabbit artwork has unexpected dimensions.');
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = RIG_WIDTH; sourceCanvas.height = RIG_HEIGHT;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('Could not open the customization canvas.');
  sourceContext.drawImage(image, 0, 0);
  const source = sourceContext.getImageData(0, 0, RIG_WIDTH, RIG_HEIGHT).data;
  let appearance = generateSpeciesAppearance(seed, species);
  let originalColors = structuredClone(appearance.parameters.color);
  const savedAppearances = new Map<CharacterSpecies, {
    seed: number; appearance: GeneratedCharacterAppearance; originalColors: CharacterColors;
  }>();

  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
    return result;
  }
  function listen(target: EventTarget, type: string, action: () => void): void {
    target.addEventListener(type, event => {
      if (type === 'submit') event.preventDefault();
      try { action(); } catch (cause) { onError(cause); }
    }, { signal });
  }
  function draw(canvas: HTMLCanvasElement, source: Uint8ClampedArray): void {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not draw a character variation.');
    const pixels = context.createImageData(RIG_WIDTH, RIG_HEIGHT);
    pixels.data.set(source);
    context.putImageData(pixels, 0, 0);
  }
  const thumbnails: { canvas: HTMLCanvasElement; change: (next: GeneratedCharacterAppearance) => void }[] = [];
  function thumbnail(button: HTMLButtonElement, change: (next: GeneratedCharacterAppearance) => void): void {
    const canvas = node('canvas', undefined, {
      class: 'cf-thumbnail', width: String(RIG_WIDTH), height: String(RIG_HEIGHT), 'aria-hidden': 'true',
    });
    button.prepend(canvas);
    thumbnails.push({ canvas, change });
  }
  const canvas = node('canvas', undefined, {
    class: 'customization-character', width: String(RIG_WIDTH), height: String(RIG_HEIGHT),
    role: 'img', 'aria-label': 'Customized rabbit',
  });
  preview.append(canvas);
  const resize = new ResizeObserver(() => {
    const scale = Math.max(1, Math.min(16, Math.floor(Math.min(
      (preview.clientWidth - 80) / RIG_WIDTH, (preview.clientHeight - 80) / RIG_HEIGHT,
    ))));
    canvas.style.width = `${RIG_WIDTH * scale}px`;
    canvas.style.height = `${RIG_HEIGHT * scale}px`;
  });
  resize.observe(preview);
  signal.addEventListener('abort', () => resize.disconnect(), { once: true });

  const colorSection = node('section');
  const heading = node('div', undefined, { class: 'customization-color-heading' });
  const paletteName = node('output', '', { 'aria-live': 'polite', 'aria-label': 'Selected palette' });
  heading.append(node('h2', 'Color'), paletteName);
  const swatches = node('div', undefined, { class: 'color-swatches', role: 'group', 'aria-label': 'Color palettes' });
  const paletteButtons = speciesPalettes(species).map((palette, index) => {
    const swatch = node('button', undefined, {
      type: 'button', class: 'color-swatch', 'aria-label': palette.name, title: palette.name,
    });
    for (const color of [palette.coat, palette.shade]) {
      const chip = node('span', undefined, { 'aria-hidden': 'true' });
      chip.style.backgroundColor = color;
      swatch.append(chip);
    }
    listen(swatch, 'click', () => {
      const current = speciesPalettes(species)[index];
      appearance.parameters.color = { coat: current.coat, shade: current.shade };
      render();
    });
    swatches.append(swatch);
    return swatch;
  });
  colorSection.append(heading, swatches);
  const generate = node('button', 'Randomize color', { type: 'button', class: 'color-generate' });
  const generation = node('section');
  const form = node('form', undefined, { class: 'color-seed-form', novalidate: '', 'aria-label': 'Reproduce character' });
  const seedLabel = node('label', 'Character seed');
  const seedInput = node('input', undefined, { type: 'text', inputmode: 'numeric', 'aria-label': 'Character seed' });
  seedLabel.append(seedInput);
  const apply = node('button', 'Apply', { type: 'submit' });
  form.append(seedLabel, apply);
  generation.append(form);
  const fields = new Map<keyof CharacterColors, { input: HTMLInputElement; output: HTMLOutputElement }>();
  for (const [key, label] of [['coat', 'Coat'], ['shade', 'Shading']] as const) {
    const row = node('label', undefined, { class: 'color-field' });
    const input = node('input', undefined, { type: 'color', 'aria-label': label });
    const output = node('output');
    row.append(input, node('span', label), output);
    colorSection.append(row);
    fields.set(key, { input, output });
    listen(input, 'input', () => {
      appearance.parameters.color[key] = input.value;
      render();
    });
  }
  const reset = node('button', 'Reset palette', { type: 'button', class: 'color-reset' });
  listen(reset, 'click', () => {
    appearance.parameters.color = structuredClone(originalColors);
    render();
  });
  colorSection.append(generate, reset);
  const earSection = node('section', undefined, { 'aria-label': 'Ear customization' });
  earSection.append(node('h2', 'Ears'));
  const earShapes = node('div', undefined, { class: 'ear-options', role: 'group', 'aria-label': 'Ear shape' });
  const earShapeButtons = CHARACTER_EAR_SHAPES.map(option => {
    const choice = node('button', option.name, { type: 'button' });
    thumbnail(choice, next => { next.parameters.ears.shape = option.type; });
    listen(choice, 'click', () => {
      appearance.parameters.ears.shape = option.type;
      render();
    });
    earShapes.append(choice);
    return choice;
  });
  earSection.append(earShapes, node('p', 'Markings'));
  const earOptions = node('div', undefined, { class: 'ear-options', role: 'group', 'aria-label': 'Ear markings' });
  const earButtons = CHARACTER_EAR_MARKINGS.map(option => {
    const choice = node('button', option.name, { type: 'button' });
    thumbnail(choice, next => { next.parameters.ears.type = option.type; });
    listen(choice, 'click', () => {
      appearance.parameters.ears.type = option.type;
      render();
    });
    earOptions.append(choice);
    return choice;
  });
  const earLayout = node('p', '', { 'aria-live': 'polite', 'aria-label': 'Ear layout' });
  const earRow = node('label', undefined, { class: 'color-field' });
  const earColor = node('input', undefined, { type: 'color', 'aria-label': 'Ear color' });
  const earValue = node('output');
  earRow.append(earColor, node('span', 'Ear color'), earValue);
  listen(earColor, 'input', () => {
    appearance.parameters.ears.color = earColor.value;
    appearance.parameters.ears.colorMode = 'custom';
    render();
  });
  const matchEarCoat = node('button', 'Match ear color to coat', { type: 'button', class: 'color-reset' });
  listen(matchEarCoat, 'click', () => {
    appearance.parameters.ears.colorMode = 'coat';
    render();
  });
  earSection.append(earOptions, earLayout, earRow, matchEarCoat);
  const expressionSection = node('section', undefined, { 'aria-label': 'Expression customization' });
  expressionSection.append(node('h2', 'Expression'));
  const expressionOptions = node('div', undefined, { class: 'expression-options', role: 'group', 'aria-label': 'Facial expressions' });
  const expressionButtons = CHARACTER_EXPRESSIONS.map(option => {
    const choice = node('button', option.name, { type: 'button' });
    thumbnail(choice, next => { next.parameters.expression.type = option.type; });
    listen(choice, 'click', () => {
      appearance.parameters.expression.type = option.type;
      render();
    });
    expressionOptions.append(choice);
    return choice;
  });
  const expressionDetails = node('p', '', { 'aria-live': 'polite', 'aria-label': 'Expression details' });
  expressionSection.append(expressionOptions, expressionDetails);
  const accessorySection = node('section', undefined, { 'aria-label': 'Accessory customization' });
  accessorySection.append(node('h2', 'Accessories'));
  const accessoryOptions = node('div', undefined, { class: 'accessory-options', role: 'group', 'aria-label': 'Accessories' });
  const accessoryButtons = CHARACTER_ACCESSORIES.map(option => {
    const choice = node('button', option.name, { type: 'button' });
    thumbnail(choice, next => { next.parameters.accessory.type = option.type; });
    listen(choice, 'click', () => {
      appearance.parameters.accessory.type = option.type;
      render();
    });
    accessoryOptions.append(choice);
    return choice;
  });
  const accessoryDetails = node('p', '', { 'aria-live': 'polite', 'aria-label': 'Accessory details' });
  const accessoryRow = node('label', undefined, { class: 'color-field' });
  const accessoryColor = node('input', undefined, { type: 'color', 'aria-label': 'Accessory color' });
  const accessoryValue = node('output');
  accessoryRow.append(accessoryColor, node('span', 'Accessory color'), accessoryValue);
  listen(accessoryColor, 'input', () => {
    appearance.parameters.accessory.color = accessoryColor.value;
    appearance.parameters.accessory.colorMode = 'custom';
    render();
  });
  const matchAccessory = node('button', 'Match accessory to coat', { type: 'button', class: 'color-reset' });
  listen(matchAccessory, 'click', () => {
    appearance.parameters.accessory.colorMode = 'coat';
    render();
  });
  accessorySection.append(accessoryOptions, accessoryDetails, accessoryRow, matchAccessory);
  const download = node('button', 'Download recipe', { type: 'button', class: 'color-download' });
  listen(download, 'click', () => {
    const url = URL.createObjectURL(new Blob([exportCharacterDefinition(appearance, getRigSetup())], { type: 'application/json' }));
    const link = node('a', undefined, { href: url, download: `${species}-character-${appearance.seed}.json` });
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  generation.append(download, node('p', 'The seed restores the generated character. Download a recipe to keep your edits.'));
  const scroll = node('div', undefined, { class: 'customization-parameters' });
  scroll.append(colorSection, earSection, expressionSection, accessorySection, generation);
  panel.append(scroll);

  function render(): void {
    const palettes = speciesPalettes(species);
    for (const [index, swatch] of paletteButtons.entries()) {
      const palette = palettes[index];
      swatch.setAttribute('aria-label', palette.name);
      swatch.title = palette.name;
      const chips = swatch.querySelectorAll('span');
      chips[0].style.backgroundColor = palette.coat;
      chips[1].style.backgroundColor = palette.shade;
    }
    for (const [key, field] of fields) {
      field.input.value = appearance.parameters.color[key];
      field.output.value = appearance.parameters.color[key];
    }
    const paletteIndex = palettes.findIndex(palette =>
      palette.coat === appearance.parameters.color.coat && palette.shade === appearance.parameters.color.shade);
    paletteName.value = paletteIndex < 0 ? 'Custom' : palettes[paletteIndex].name;
    for (const [index, swatch] of paletteButtons.entries()) swatch.setAttribute('aria-pressed', String(index === paletteIndex));
    reset.disabled = JSON.stringify(appearance.parameters.color) === JSON.stringify(originalColors);
    const pattern = appearance.parameters.pattern;
    if (pattern.colorMode === 'coat') pattern.color = linkedPatternColor(appearance.parameters.color, pattern.type);
    const ears = appearance.parameters.ears;
    earShapes.hidden = species !== 'rabbit';
    const earShape = ears.shape ?? 'upright';
    for (const [index, choice] of earShapeButtons.entries()) {
      const option = CHARACTER_EAR_SHAPES[index];
      choice.setAttribute('aria-pressed', String(option.type === earShape));
    }
    for (const [index, choice] of earButtons.entries()) {
      choice.hidden = species !== 'rabbit' && !['plain', 'inner'].includes(CHARACTER_EAR_MARKINGS[index].type);
      choice.setAttribute('aria-pressed', String(CHARACTER_EAR_MARKINGS[index].type === ears.type));
    }
    if (ears.colorMode === 'coat') ears.color = linkedEarColor(appearance.parameters.color, ears.type);
    earColor.value = ears.color;
    earValue.value = ears.color;
    earColor.disabled = ears.type === 'plain';
    matchEarCoat.textContent = ears.colorMode === 'coat' ? 'Ear color follows coat' : 'Match ear color to coat';
    matchEarCoat.disabled = ears.type === 'plain' || ears.colorMode === 'coat';
    earLayout.textContent = species === 'bear' ? 'Small round ears'
      : species === 'cat' ? 'Small pointed ears' : earLayoutName(ears, pattern);
    for (const [index, choice] of expressionButtons.entries()) {
      const option = CHARACTER_EXPRESSIONS[index];
      const selected = option.type === appearance.parameters.expression.type;
      choice.setAttribute('aria-pressed', String(selected));
      if (selected) {
        expressionDetails.textContent = option.description;
        canvas.setAttribute('aria-label', `Customized rabbit, ${option.name.toLowerCase()} expression`);
      }
    }
    const accessory = appearance.parameters.accessory;
    for (const [index, choice] of accessoryButtons.entries()) {
      const option = CHARACTER_ACCESSORIES[index];
      choice.setAttribute('aria-pressed', String(option.type === accessory.type));
      if (option.type === accessory.type) accessoryDetails.textContent = option.description;
    }
    if (accessory.colorMode === 'coat') accessory.color = linkedAccessoryColor(appearance.parameters.color);
    accessoryColor.value = accessory.color;
    accessoryValue.value = accessory.color;
    accessoryColor.disabled = accessory.type === 'none';
    matchAccessory.textContent = accessory.colorMode === 'coat' ? 'Accessory color follows coat' : 'Match accessory to coat';
    matchAccessory.disabled = accessory.type === 'none' || accessory.colorMode === 'coat';
    const expressionName = CHARACTER_EXPRESSIONS.find(option => option.type === appearance.parameters.expression.type)!.name;
    const accessoryName = CHARACTER_ACCESSORIES.find(option => option.type === accessory.type)!.name;
    const earShapeName = CHARACTER_EAR_SHAPES.find(option => option.type === earShape)!.name;
    const earDescription = species === 'bear' ? 'round' : species === 'cat' ? 'pointed' : earShapeName.toLowerCase();
    canvas.setAttribute('aria-label', `Customized ${species}, ${expressionName.toLowerCase()} expression, ${accessory.type === 'none' ? 'no accessory' : accessoryName.toLowerCase()}, ${earDescription} ears`);
    seedInput.value = String(seed);
    preview.dataset.seed = String(seed);
    preview.dataset.species = species;
    const artwork = buildCharacterArtwork(source, appearance);
    onChange(structuredClone(appearance), artwork);
    draw(canvas, artwork.source);
    for (const thumbnail of thumbnails) {
      const variant = structuredClone(appearance);
      thumbnail.change(variant);
      if (variant.parameters.ears.colorMode === 'coat') {
        variant.parameters.ears.color = linkedEarColor(variant.parameters.color, variant.parameters.ears.type);
      }
      draw(thumbnail.canvas, buildCharacterArtwork(source, variant).source);
    }
  }
  function replaceCharacter(next: number): void {
    const nextAppearance = generateSpeciesAppearance(next, species);
    seed = next; appearance = nextAppearance; originalColors = structuredClone(nextAppearance.parameters.color);
    render();
  }
  function nextSeed(previous: number): number {
    let next = crypto.getRandomValues(new Uint32Array(1))[0];
    if (next === previous) next = (next + 1) >>> 0;
    return next;
  }
  function randomize(): void {
    replaceCharacter(nextSeed(seed));
  }
  listen(generate, 'click', () => {
    appearance.parameters.color = generateSpeciesAppearance(nextSeed(seed), species).parameters.color;
    render();
  });
  listen(form, 'submit', () => replaceCharacter(appearanceSeed(seedInput.value.trim())));
  render();
  return {
    generate() {
      try { randomize(); } catch (cause) { onError(cause); }
    },
    getSeed: () => seed,
    getAppearance: () => structuredClone(appearance),
    setSpecies(next) {
      if (species === next) return;
      savedAppearances.set(species, { seed, appearance: structuredClone(appearance), originalColors: structuredClone(originalColors) });
      const saved = savedAppearances.get(next);
      const nextAppearance = saved?.appearance ?? generateSpeciesAppearance(next !== 'rabbit' ? 0 : seed, next);
      species = next;
      seed = saved?.seed ?? nextAppearance.seed;
      appearance = structuredClone(nextAppearance);
      originalColors = structuredClone(saved?.originalColors ?? appearance.parameters.color);
      render();
    },
  };
}
