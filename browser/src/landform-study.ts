import './landform-study.css';
import { ASCENT_RESERVATION, SCALE_PLACEMENTS, OCCLUSION_PLACEMENT, type LandProjection } from './core/landform-study';
import {
  drawLandform, studyScreenPoint, STUDY_WIDTH, STUDY_HEIGHT,
  type LandPalette, type RabbitPixels,
} from './render/landform-study';

type StudyProjection = 'current' | 'oblique' | 'compare';
type StudyView = 'blockout' | 'plan' | 'closeup';

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, attributes: Record<string, string> = {}, text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
  if (text !== undefined) result.textContent = text;
  return result;
}

function choice<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  if (value === null) return fallback;
  const match = allowed.find(item => item === value);
  if (!match) throw new Error(`Unknown landform study setting: ${value}. Return to the Island Explorer and reopen the study.`);
  return match;
}

export async function mountLandformStudy(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal): Promise<void> {
  let projection = choice<StudyProjection>(parameters.get('projection'), ['current', 'oblique', 'compare'], 'oblique');
  let view = choice<StudyView>(parameters.get('view'), ['blockout', 'plan', 'closeup'], 'blockout');
  let scale = choice(parameters.get('scale'), ['0', '1'], '0') === '1';
  let probe = choice(parameters.get('probe'), ['0', '1'], '0') === '1';
  const initialZoom = parameters.get('zoom');
  if (initialZoom !== null && !/^[1-8]$/.test(initialZoom)) throw new Error('Landform zoom must be a whole number from 1 to 8.');
  let magnification = initialZoom === null ? 0 : Number(initialZoom);
  let rabbit: RabbitPixels | undefined;
  const runtime = node('main', { class: 'runtime landform-study', 'data-study': 'landform' });
  const header = node('header', { class: 'runtime-header' });
  const toolbar = node('div', { class: 'toolbar', role: 'group', 'aria-label': 'Study zoom' });
  const baseline = parameters.get('seed');
  const back = `#/island${baseline && /^\d{1,6}$/.test(baseline) ? `?seed=${baseline}&paused=1` : ''}`;
  header.append(
    node('a', { class: 'button', href: back }, 'Island Explorer'),
    node('h1', {}, 'Landform study'),
    toolbar,
  );
  const error = node('div', { class: 'error-banner', role: 'alert', hidden: '' });
  const body = node('div', { class: 'runtime-body' });
  const stage = node('div', { class: 'landform-stage', role: 'region', 'aria-label': 'Landform preview' });
  const gallery = node('div', { class: 'landform-gallery' });
  const inspector = node('aside', { class: 'inspector', 'aria-label': 'Landform study controls' });
  const status = node('output', { class: 'landform-status', role: 'status', 'aria-live': 'polite' });
  const help = node('p', { class: 'landform-help' }, 'One fixed island. Three elevations. No texture or movement.');
  stage.append(gallery);
  body.append(stage, inspector);
  runtime.append(header, error, body);
  root.replaceChildren(runtime);
  document.title = 'Landform study · Island Explorer';

  function fail(cause: unknown): void {
    if (signal.aborted) return;
    error.textContent = cause instanceof Error ? cause.message : String(cause);
    error.hidden = false;
    console.error('[a long table: landform study]', cause);
  }
  function listen(target: EventTarget, type: string, callback: EventListener): void {
    target.addEventListener(type, callback, { signal });
  }
  function button(label: string, action: () => void, attributes: Record<string, string> = {}): HTMLButtonElement {
    const result = node('button', { type: 'button', ...attributes }, label);
    listen(result, 'click', () => { try { action(); } catch (cause) { fail(cause); } });
    return result;
  }
  function group(title: string): HTMLDivElement {
    const section = node('section');
    const controls = node('div', { class: 'stack', role: 'group', 'aria-label': title });
    section.append(node('h2', {}, title), controls);
    inspector.append(section);
    return controls;
  }
  const projectionControls = group('Projection');
  const projectionButtons = new Map<StudyProjection, HTMLButtonElement>();
  for (const [value, label] of [['oblique', 'Elevated oblique'], ['current', 'Current axes'], ['compare', 'Compare']] as const) {
    const control = button(label, () => { projection = value; update(); });
    projectionButtons.set(value, control);
    projectionControls.append(control);
  }
  const viewControls = group('View');
  const viewButtons = new Map<StudyView, HTMLButtonElement>();
  for (const [value, label] of [['blockout', 'Blockout'], ['plan', 'Elevation plan'], ['closeup', 'Junction close-up']] as const) {
    const control = button(label, () => { view = value; update(); });
    viewButtons.set(value, control);
    viewControls.append(control);
  }
  const diagnosticControls = group('Scale and overlap');
  function checkbox(label: string, initial: boolean, action: (checked: boolean) => void): HTMLInputElement {
    const wrapper = node('label', { class: 'landform-checkbox' });
    const input = node('input', { type: 'checkbox' });
    input.checked = initial;
    listen(input, 'change', () => { try { action(input.checked); } catch (cause) { fail(cause); } });
    wrapper.append(input, document.createTextNode(label));
    diagnosticControls.append(wrapper);
    return input;
  }
  const scaleInput = checkbox('Rabbit scale', scale, checked => {
    scale = checked;
    if (!scale) probe = false;
    update();
  });
  const probeInput = checkbox('Behind-cliff probe', probe, checked => {
    probe = checked;
    if (probe) scale = true;
    update();
  });
  const notes = node('section', { class: 'landform-notes' });
  notes.append(
    help,
    node('p', {}, 'Current axes keeps the existing map orientation, but adds explicit height. It is not the existing terrain renderer.'),
    node('p', {}, 'Flat tops share one tone. Walls use one consistent light direction. Heights: 0 / 20 / 48 world units; rabbit: 12.'),
    status,
  );
  inspector.append(notes);
  toolbar.append(
    button('-', () => zoom(-1), { 'aria-label': 'Zoom out' }),
    button('+', () => zoom(1), { 'aria-label': 'Zoom in' }),
    button('Fit', () => { magnification = 0; update(); }, { 'aria-label': 'Fit study' }),
  );

  function palette(): LandPalette {
    const styles = getComputedStyle(runtime);
    const color = (name: string): readonly number[] => {
      const hex = styles.getPropertyValue(`--cp-landform-${name}`).trim();
      if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Invalid landform palette color: ${name}.`);
      return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    };
    return {
      water: color('water'), top: color('top'), light: color('light'), middle: color('middle'), dark: color('dark'),
      levels: [color('level-base'), color('level-shelf'), color('level-high')],
    };
  }

  function planOverlay(canvas: HTMLCanvasElement): void {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not draw the elevation plan.');
    context.strokeStyle = getComputedStyle(runtime).getPropertyValue('--cp-landform-annotation').trim();
    context.lineWidth = 9;
    context.globalAlpha = 0.18;
    context.beginPath();
    ASCENT_RESERVATION.forEach((point, index) => {
      const p = studyScreenPoint({ ...point, z: 0 }, 'plan');
      if (index === 0) context.moveTo(p.x, p.y);
      else context.lineTo(p.x, p.y);
    });
    context.stroke();
    context.globalAlpha = 1;
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = context.strokeStyle;
    context.font = '10px "Segoe UI", sans-serif';
    for (const [index, placement] of SCALE_PLACEMENTS.entries()) {
      const p = studyScreenPoint(placement, 'plan');
      context.fillText(String(index), Math.round(p.x), Math.round(p.y));
    }
    if (probe) {
      const p = studyScreenPoint(OCCLUSION_PLACEMENT, 'plan');
      context.fillText('P', Math.round(p.x), Math.round(p.y));
    }
  }

  function addFigure(kind: LandProjection, title: string, colors: LandPalette): HTMLCanvasElement {
    const figure = node('figure', { class: 'landform-figure' });
    const caption = node('figcaption', {}, title);
    const frame = node('div', { class: 'landform-canvas-frame', tabindex: '0', 'aria-label': `${title}, scroll to inspect when zoomed` });
    const canvas = node('canvas', {
      role: 'img', 'aria-label': `${title}: connected low ground, middle shelf and high shoulder${scale ? ', with static rabbit scale references' : ''}`,
    });
    drawLandform(canvas, kind, colors, scale ? rabbit : undefined, probe);
    if (kind === 'plan') planOverlay(canvas);
    if (view === 'closeup') {
      const source = node('canvas');
      source.width = STUDY_WIDTH;
      source.height = STUDY_HEIGHT;
      const sourceContext = source.getContext('2d');
      if (!sourceContext) throw new Error('Could not prepare the junction close-up.');
      sourceContext.drawImage(canvas, 0, 0);
      const center = studyScreenPoint({ x: -20, y: 8, z: 20 }, kind);
      canvas.width = 112;
      canvas.height = 96;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create the junction close-up.');
      context.imageSmoothingEnabled = false;
      context.drawImage(source, Math.round(center.x - 56), Math.round(center.y - 48), 112, 96, 0, 0, 112, 96);
    }
    frame.append(canvas);
    figure.append(caption, frame);
    gallery.append(figure);
    return canvas;
  }

  function layout(): void {
    const figures = [...gallery.querySelectorAll<HTMLElement>('.landform-figure')];
    for (const figure of figures) {
      const canvas = figure.querySelector('canvas')!;
      const frame = figure.querySelector<HTMLElement>('.landform-canvas-frame')!;
      const fit = Math.max(0.5, Math.floor(Math.min(
        Math.max(1, frame.clientWidth - 24) / canvas.width,
        Math.max(1, frame.clientHeight - 24) / canvas.height,
      )));
      const zoom = magnification || fit;
      canvas.style.width = `${canvas.width * zoom}px`;
      canvas.style.height = `${canvas.height * zoom}px`;
      canvas.dataset.magnification = String(zoom);
    }
  }
  function zoom(direction: number): void {
    const current = magnification || Number(gallery.querySelector('canvas')?.dataset.magnification ?? 1);
    magnification = Math.max(1, Math.min(8, Math.floor(current) + direction));
    update();
  }
  function update(): void {
    if (signal.aborted) return;
    error.hidden = true;
    for (const [key, control] of projectionButtons) {
      control.setAttribute('aria-pressed', String(projection === key));
      control.disabled = view === 'plan';
    }
    for (const [key, control] of viewButtons) control.setAttribute('aria-pressed', String(view === key));
    scaleInput.checked = scale;
    probeInput.checked = probe;
    scaleInput.disabled = !rabbit || view === 'plan';
    probeInput.disabled = !rabbit || view === 'plan';
    const colors = palette();
    gallery.replaceChildren();
    gallery.dataset.compare = String(projection === 'compare' && view !== 'plan');
    if (view === 'plan') {
      addFigure('plan', 'Elevation plan', colors);
      status.textContent = '0: base · 1: shelf · 2: shoulder. Dashed band: space reserved for a future ascent, not a walkable route.';
    } else {
      const kinds: readonly ('current' | 'oblique')[] = projection === 'compare' ? ['current', 'oblique'] : [projection];
      const results: string[] = [];
      for (const kind of kinds) {
        const title = kind === 'current' ? 'Current axes' : 'Elevated oblique';
        const canvas = addFigure(kind, view === 'closeup' ? `${title} · junction` : title, colors);
        if (probe && rabbit) results.push(`${title}: ${canvas.dataset.probeVisible} probe pixels visible, ${canvas.dataset.probeHidden} hidden.`);
      }
      status.textContent = !rabbit ? 'Loading the original rabbit scale reference…'
        : results.length ? `P is on low ground behind the high mass. ${results.join(' ')}`
          : scale ? 'Three static rabbits, one on each elevation. Original artwork at gameplay scale; no movement or paths.'
            : 'Form only. The shelf, recess and walls share the same boundaries.';
    }
    const next = new URLSearchParams({ study: 'landform', projection, view });
    if (baseline && /^\d{1,6}$/.test(baseline)) next.set('seed', baseline);
    if (scale) next.set('scale', '1');
    if (probe) next.set('probe', '1');
    if (magnification) next.set('zoom', String(magnification));
    history.replaceState(null, '', `#/island?${next}`);
    layout();
  }

  const observer = new ResizeObserver(() => { try { layout(); } catch (cause) { fail(cause); } });
  observer.observe(stage);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  listen(window, 'keydown', event => {
    const key = event as KeyboardEvent;
    if (key.ctrlKey || key.metaKey || key.altKey
      || (key.target instanceof HTMLElement && key.target.closest('input, button, select, textarea'))) return;
    try {
      if (key.key.toLowerCase() === 'f') { magnification = 0; update(); }
      else if (key.key === '+' || key.key === '=') zoom(1);
      else if (key.key === '-') zoom(-1);
      else return;
      key.preventDefault();
    } catch (cause) { fail(cause); }
  });
  update();
  const image = new Image();
  image.src = `${import.meta.env.BASE_URL}assets/rabbit.png`;
  try {
    await image.decode();
    if (signal.aborted) return;
    if (image.naturalWidth !== 18 || image.naturalHeight !== 29) throw new Error('The rabbit scale reference must be the original 18 by 29 artwork.');
    const canvas = node('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not read the original rabbit scale reference.');
    context.drawImage(image, 0, 0);
    rabbit = { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    runtime.dataset.ready = 'true';
    update();
  } catch (cause) {
    fail(cause);
  }
}
