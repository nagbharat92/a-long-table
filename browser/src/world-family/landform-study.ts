import type { PilotController, PilotShell } from '../pilot/ui';
import {
  LANDFORM_FIXTURE, ASCENT_RESERVATION, SCALE_PLACEMENTS, OCCLUSION_PLACEMENT,
  type LandProjection, type LandMass, type LandVertex,
} from './core/landform-study';
import { generateLandform, LANDFORM_GENERATOR, MAX_LANDFORM_SEED, type LandformSample } from './core/landform-generation';
import {
  drawLandform, studyScreenPoint, STUDY_WIDTH, STUDY_HEIGHT,
  type LandPalette, type RabbitPixels,
} from './render/landform-study';

type StudyProjection = 'current' | 'oblique' | 'compare';
type StudyView = 'blockout' | 'plan' | 'closeup';
type StudySource = 'reference' | 'generated' | 'sheet';
interface StudyShape {
  masses: readonly LandMass[];
  placements: readonly LandVertex[];
  probe: LandVertex;
  junction: LandVertex;
}
const reference: StudyShape = {
  masses: LANDFORM_FIXTURE, placements: SCALE_PLACEMENTS, probe: OCCLUSION_PLACEMENT,
  junction: { x: -20, y: 8, z: 20 },
};

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

export async function mountLandformStudy(shell: PilotShell, parameters: URLSearchParams, signal: AbortSignal): Promise<PilotController> {
  let projection = choice<StudyProjection>(parameters.get('projection'), ['current', 'oblique', 'compare'], 'oblique');
  let view = choice<StudyView>(parameters.get('view'), ['blockout', 'plan', 'closeup'], 'blockout');
  let scale = choice(parameters.get('scale'), ['0', '1'], '0') === '1';
  let probe = choice(parameters.get('probe'), ['0', '1'], '0') === '1';
  let source = choice<StudySource>(parameters.get('source'), ['reference', 'generated', 'sheet'], 'reference');
  let contours = choice(parameters.get('contours'), ['0', '1'], '0') === '1';
  const initialSeed = parameters.get('landSeed') ?? '0';
  if (!/^\d{1,6}$/.test(initialSeed)) throw new Error('Landform seed must be a whole number from 0 to 999999.');
  let landSeed = Number(initialSeed);
  const samples = new Map<string, LandformSample>();
  function sample(seed: number): LandformSample {
    const key = `${seed}:${contours}`;
    let result = samples.get(key);
    if (!result) {
      result = generateLandform(seed, contours);
      if (samples.size >= 64) samples.delete(samples.keys().next().value!);
      samples.set(key, result);
    }
    return result;
  }
  const initialZoom = parameters.get('zoom');
  if (initialZoom !== null && !/^[1-8]$/.test(initialZoom)) throw new Error('Landform zoom must be a whole number from 1 to 8.');
  let magnification = initialZoom === null ? 0 : Number(initialZoom);
  let rabbit: RabbitPixels | undefined;
  const runtime = shell.root;
  runtime.dataset.study = 'landform';
  const toolbar = node('div', { class: 'toolbar', role: 'group', 'aria-label': 'Study zoom' });
  const baseline = parameters.get('seed');
  const error = node('div', { class: 'error-banner', role: 'alert', hidden: '' });
  const stage = shell.stage;
  stage.classList.add('landform-stage');
  const gallery = node('div', { class: 'landform-gallery' });
  const inspector = shell.toolsContent;
  const status = node('output', { class: 'landform-status', role: 'status', 'aria-live': 'polite' });
  const help = node('p', { class: 'landform-help' }, 'New outlines and elevation layouts per seed. Three elevations; no texture, routes or movement.');
  stage.append(gallery);
  shell.sessionControls.append(toolbar);
  document.title = 'Landform study · Island Explorer';

  function fail(cause: unknown): void {
    if (signal.aborted) return;
    error.textContent = cause instanceof Error ? cause.message : String(cause);
    error.hidden = false;
    shell.showError(cause);
  }
  function listen(target: EventTarget, type: string, callback: EventListener): void {
    target.addEventListener(type, callback, { signal });
  }
  function button(label: string, action: () => void, attributes: Record<string, string> = {}): HTMLButtonElement {
    const result = node('button', { type: 'button', ...attributes }, label);
    result.classList.add('p-button');
    listen(result, 'click', () => { try { action(); } catch (cause) { fail(cause); } });
    return result;
  }
  function group(title: string): HTMLDivElement {
    const section = node('section', { class: 'p-section' });
    const controls = node('div', { class: 'stack p-world-stack', role: 'group', 'aria-label': title });
    section.append(node('h2', { class: 'p-label' }, title), controls);
    inspector.append(section);
    return controls;
  }
  const generationControls = group('Landform');
  const sourceButtons = new Map<StudySource, HTMLButtonElement>();
  for (const [value, label] of [['reference', 'Approved reference'], ['generated', 'Single island'], ['sheet', 'Comparison sheet']] as const) {
    const control = button(label, () => { source = value; update(); });
    sourceButtons.set(value, control);
    generationControls.append(control);
  }
  const seedLabel = node('label', { class: 'landform-seed' }, 'Landform seed');
  const seedInput = node('input', { type: 'number', min: '0', max: String(MAX_LANDFORM_SEED), step: '1', value: String(landSeed) });
  seedLabel.append(seedInput);
  const useSeed = button('Use seed', () => {
    if (!seedInput.reportValidity() || !/^\d{1,6}$/.test(seedInput.value)) {
      throw new Error('Enter a whole landform seed from 0 to 999999.');
    }
    landSeed = Number(seedInput.value);
    if (source === 'reference') source = 'generated';
    update();
  });
  const generate = button('Generate', () => {
    landSeed = source === 'reference' ? landSeed : (landSeed + 1) % (MAX_LANDFORM_SEED + 1);
    source = 'generated';
    update();
  }, { class: 'p-button p-primary', 'data-action': 'generate-landform' });
  const nextBatch = button('Next eight seeds', () => {
    landSeed = (landSeed + 8) % (MAX_LANDFORM_SEED + 1);
    source = 'sheet';
    update();
  });
  shell.primary.append(generate);
  generationControls.append(seedLabel, useSeed, nextBatch);
  const contourLabel = node('label', { class: 'landform-checkbox' });
  const contourInput = node('input', { type: 'checkbox' });
  contourInput.checked = contours;
  contourLabel.append(contourInput, document.createTextNode('Broad contour refinement'));
  generationControls.append(contourLabel);
  listen(contourInput, 'change', () => {
    try { contours = contourInput.checked; update(); } catch (cause) { fail(cause); }
  });
  listen(seedInput, 'keydown', event => { if ((event as KeyboardEvent).key === 'Enter') useSeed.click(); });
  const generationDetails = node('details', { class: 'landform-generation-details' });
  generationDetails.append(node('summary', {}, 'Generation diagnostics'));
  const generationReport = node('pre');
  generationDetails.append(generationReport);
  generationControls.append(generationDetails);
  const reviewControls = group('Shape review');
  const verdictLabel = node('label', {}, 'Judgment');
  const verdict = node('select', { 'aria-label': 'Shape judgment' });
  for (const [value, label] of [['unreviewed', 'Not reviewed'], ['accept', 'Accept'], ['revise', 'Revise'], ['reject', 'Reject']]) {
    verdict.append(node('option', { value }, label));
  }
  verdictLabel.append(verdict);
  const reasonLabel = node('label', {}, 'Reason');
  const reason = node('textarea', { 'aria-label': 'Review reason', rows: '2', maxlength: '1000' });
  reasonLabel.append(reason);
  const reviewMessage = node('p', { class: 'landform-review-message' });
  const reviewDrafts = new Map<string, { verdict: string; reason: string }>();
  function reviewKey(): string { return `${LANDFORM_GENERATOR}:${landSeed}:${contours ? 'refined' : 'simple'}`; }
  function readReview(seed = landSeed): { verdict: string; reason: string } {
    const raw = localStorage.getItem(`${LANDFORM_GENERATOR}:${seed}:${contours ? 'refined' : 'simple'}`);
    if (!raw) return { verdict: 'unreviewed', reason: '' };
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !('verdict' in data) || !('reason' in data)
      || typeof data.verdict !== 'string' || typeof data.reason !== 'string'
      || !['unreviewed', 'accept', 'revise', 'reject'].includes(data.verdict)) throw new Error('Stored shape review is invalid.');
    return { verdict: data.verdict, reason: data.reason };
  }
  const saveReview = button('Save review', () => {
    if (verdict.value !== 'unreviewed' && !reason.value.trim()) throw new Error('Add a concrete reason before saving a shape judgment.');
    localStorage.setItem(reviewKey(), JSON.stringify({ verdict: verdict.value, reason: reason.value.trim() }));
    reviewDrafts.delete(reviewKey());
    update();
    reviewMessage.textContent = 'Saved in this browser for this seed and contour mode.';
  });
  for (const control of [verdict, reason]) listen(control, 'input', () => {
    reviewDrafts.set(reviewKey(), { verdict: verdict.value, reason: reason.value });
    reviewMessage.textContent = 'Unsaved judgment. Use Save review to keep it in this browser.';
  });
  reviewControls.append(verdictLabel, reasonLabel, saveReview, reviewMessage);
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
  const dimensionNote = node('p');
  inspector.append(reviewControls.parentElement!);
  notes.append(
    help,
    node('p', {}, 'Current axes keeps the existing map orientation, but adds explicit height. It is not the existing terrain renderer.'),
    dimensionNote,
    status,
  );
  inspector.append(notes);
  const zoomOut = button('-', () => zoom(-1), { 'aria-label': 'Zoom out' });
  const zoomIn = button('+', () => zoom(1), { 'aria-label': 'Zoom in' });
  const fitStudy = button('Fit', () => { magnification = 0; update(); }, { 'aria-label': 'Fit study' });
  toolbar.append(zoomOut, zoomIn, fitStudy);

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

  function planOverlay(canvas: HTMLCanvasElement, shape: StudyShape): void {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not draw the elevation plan.');
    context.strokeStyle = getComputedStyle(runtime).getPropertyValue('--cp-landform-annotation').trim();
    if (shape === reference) {
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
    }
    context.fillStyle = context.strokeStyle;
    context.font = '10px "Segoe UI", sans-serif';
    for (const [index, placement] of shape.placements.entries()) {
      const p = studyScreenPoint(placement, 'plan');
      context.fillText(String(index), Math.round(p.x), Math.round(p.y));
    }
    if (probe) {
      const p = studyScreenPoint(shape.probe, 'plan');
      context.fillText('P', Math.round(p.x), Math.round(p.y));
    }
  }

  function addFigure(
    kind: LandProjection, title: string, colors: LandPalette, shape: StudyShape = reference, seed?: number,
  ): HTMLCanvasElement {
    const figure = node('figure', { class: 'landform-figure' });
    const caption = node('figcaption', {}, title);
    const frame = node('div', { class: 'landform-canvas-frame', tabindex: '0', 'aria-label': `${title}, scroll to inspect when zoomed` });
    const canvas = node('canvas', {
      role: 'img', 'aria-label': `${title}: connected low ground, middle shelf and high shoulder${scale ? ', with static rabbit scale references' : ''}`,
    });
    drawLandform(canvas, kind, colors, scale ? rabbit : undefined, probe, shape.masses, shape.placements, shape.probe);
    canvas.dataset.landSeed = seed === undefined ? 'reference' : String(seed);
    if (kind === 'plan') planOverlay(canvas, shape);
    if (view === 'closeup' && source !== 'sheet') {
      const source = node('canvas');
      source.width = STUDY_WIDTH;
      source.height = STUDY_HEIGHT;
      const sourceContext = source.getContext('2d');
      if (!sourceContext) throw new Error('Could not prepare the junction close-up.');
      sourceContext.drawImage(canvas, 0, 0);
      const center = studyScreenPoint(shape.junction, kind);
      canvas.width = 112;
      canvas.height = 96;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create the junction close-up.');
      context.imageSmoothingEnabled = false;
      context.drawImage(source, Math.round(center.x - 56), Math.round(center.y - 48), 112, 96, 0, 0, 112, 96);
    }
    frame.append(canvas);
    figure.append(caption, frame);
    if (source === 'sheet' && seed !== undefined) {
      figure.append(button(`Inspect seed ${seed}`, () => { landSeed = seed; source = 'generated'; update(); }));
    }
    gallery.append(figure);
    return canvas;
  }

  function layout(): void {
    const figures = [...gallery.querySelectorAll<HTMLElement>('.landform-figure')];
    const sheetZoom = source === 'sheet' ? Math.max(0.5, Math.floor(
      Math.max(1, (figures[0]?.clientWidth ?? STUDY_WIDTH) - 24) / STUDY_WIDTH,
    )) : 0;
    for (const figure of figures) {
      const canvas = figure.querySelector('canvas')!;
      const frame = figure.querySelector<HTMLElement>('.landform-canvas-frame')!;
      const fit = Math.max(0.5, Math.floor(Math.min(
        Math.max(1, frame.clientWidth - 24) / canvas.width,
        Math.max(1, frame.clientHeight - 24) / canvas.height,
      )));
      const zoom = source === 'sheet' ? sheetZoom : magnification || fit;
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
    seedInput.value = String(landSeed);
    contourInput.checked = contours;
    contourInput.disabled = source === 'reference';
    for (const control of [zoomOut, zoomIn, fitStudy]) control.disabled = source === 'sheet';
    for (const [key, control] of sourceButtons) control.setAttribute('aria-pressed', String(source === key));
    for (const control of [verdict, reason, saveReview]) control.disabled = source !== 'generated';
    reviewMessage.textContent = source === 'generated' ? 'Judgments are yours, not automatic quality scores.' : 'Inspect a generated island to record a judgment.';
    if (source === 'generated') {
      const saved = reviewDrafts.get(reviewKey()) ?? readReview();
      verdict.value = saved.verdict;
      reason.value = saved.reason;
      if (reviewDrafts.has(reviewKey())) reviewMessage.textContent = 'Unsaved judgment. Use Save review to keep it in this browser.';
    }
    for (const [key, control] of projectionButtons) {
      const displayed = source === 'sheet' && projection === 'compare' ? 'oblique' : projection;
      control.setAttribute('aria-pressed', String(displayed === key));
      control.disabled = (view === 'plan' && source !== 'sheet') || (source === 'sheet' && key === 'compare');
    }
    for (const [key, control] of viewButtons) {
      control.setAttribute('aria-pressed', String((source === 'sheet' ? 'blockout' : view) === key));
      control.disabled = source === 'sheet';
    }
    scaleInput.checked = scale;
    probeInput.checked = probe;
    scaleInput.disabled = !rabbit || (view === 'plan' && source !== 'sheet');
    probeInput.disabled = !rabbit || (view === 'plan' && source !== 'sheet');
    const colors = palette();
    gallery.replaceChildren();
    gallery.dataset.sheet = String(source === 'sheet');
    gallery.dataset.compare = String(source !== 'sheet' && projection === 'compare' && view !== 'plan');
    const reports: string[] = [];
    function report(result: LandformSample): void {
      const { metrics } = result;
      reports.push(`Seed ${result.seed}: valid on attempt ${result.attempts}.\nOpen ground ${Math.round(metrics.openGround * 100)}%; exposed shelf ${Math.round(metrics.exposedShelf * 100)}%; shoulder offset ${metrics.shoulderOffset.toFixed(2)} base radii; elevations ${metrics.heights.join(' / ')}.\n${result.rejected.join('\n') || 'No rejected candidates.'}`);
    }
    const shape = source === 'generated' ? sample(landSeed) : reference;
    dimensionNote.textContent = `Flat plane tones and fixed lighting. ${source === 'sheet' ? 'Each tile reports open low ground and elevations.' : `Elevations: ${shape.masses.map(mass => mass.height).join(' / ')} world units.`} Rabbit height: 12 world units.`;
    if (source === 'generated') report(sample(landSeed));
    if (source === 'sheet') {
      const kind = projection === 'current' ? 'current' : 'oblique';
      addFigure(kind, 'Approved reference', colors);
      const judgments: Record<string, number> = { accept: 0, revise: 0, reject: 0, unreviewed: 0 };
      for (let offset = 0; offset < 8; offset++) {
        const seed = (landSeed + offset) % (MAX_LANDFORM_SEED + 1);
        const result = sample(seed);
        report(result);
        const judgment = readReview(seed).verdict;
        judgments[judgment]++;
        addFigure(kind, `Seed ${seed} · ${Math.round(result.metrics.openGround * 100)}% open · heights ${result.metrics.heights.join('/')} · ${judgment}`, colors, result, seed);
      }
      status.textContent = `Eight consecutive seeds: ${judgments.accept} accepted, ${judgments.revise} to revise, ${judgments.reject} rejected, ${judgments.unreviewed} unreviewed. Same scale and framing as the reference. Structural validity is not visual approval.`;
    } else if (view === 'plan') {
      addFigure('plan', 'Elevation plan', colors, shape, source === 'generated' ? landSeed : undefined);
      status.textContent = source === 'reference'
        ? '0: base · 1: shelf · 2: shoulder. Dashed band: space reserved for a future ascent, not a walkable route.'
        : '0: base · 1: shelf · 2: shoulder. No ascent reservation or walkable route is generated.';
    } else {
      const kinds: readonly ('current' | 'oblique')[] = projection === 'compare' ? ['current', 'oblique'] : [projection];
      const results: string[] = [];
      for (const kind of kinds) {
        const title = kind === 'current' ? 'Current axes' : 'Elevated oblique';
        const titleWithSeed = source === 'generated' ? `Seed ${landSeed} · ${title}` : title;
        const canvas = addFigure(kind, view === 'closeup' ? `${titleWithSeed} · junction` : titleWithSeed, colors, shape,
          source === 'generated' ? landSeed : undefined);
        if (scale && rabbit) results.push(`${title}: ${canvas.dataset.scaleSummary}.`);
        if (probe && rabbit) results.push(`${title}: ${canvas.dataset.probeVisible} probe pixels visible, ${canvas.dataset.probeHidden} hidden.`);
      }
      status.textContent = !rabbit ? 'Loading the original rabbit scale reference…'
        : results.length ? `Three static rabbits, one on each elevation; foreground cliffs can hide them. ${probe ? 'P is a low-ground overlap probe. ' : ''}${results.join(' ')}`
          : 'Form only. The shelf, recess and walls share the same boundaries.';
    }
    generationReport.textContent = `${LANDFORM_GENERATOR}\n${contours ? 'Broad contour refinement' : 'Composition only'}\n${reports.join('\n\n') || 'Authored reference; no generation.'}`;
    runtime.dataset.source = source;
    const next = new URLSearchParams({ study: 'landform', projection, view, source, landSeed: String(landSeed), contours: contours ? '1' : '0' });
    if (baseline && /^\d{1,6}$/.test(baseline)) next.set('seed', baseline);
    if (scale) next.set('scale', '1');
    if (probe) next.set('probe', '1');
    if (magnification) next.set('zoom', String(magnification));
    next.set('version', 'v2');
    history.replaceState(null, '', `#/island?${next}`);
    layout();
  }

  const observer = new ResizeObserver(() => { try { layout(); } catch (cause) { fail(cause); } });
  observer.observe(stage);
  function destroy(): void {
    observer.disconnect();
    gallery.remove();
    stage.classList.remove('landform-stage');
    delete runtime.dataset.study;
    delete runtime.dataset.source;
    delete runtime.dataset.ready;
  }
  signal.addEventListener('abort', destroy, { once: true });
  listen(window, 'keydown', event => {
    const key = event as KeyboardEvent;
    if (source === 'sheet' || key.ctrlKey || key.metaKey || key.altKey
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
  image.src = `${import.meta.env.BASE_URL}world-family/assets/rabbit.png`;
  try {
    await image.decode();
    if (signal.aborted) return { destroy };
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
  return {
    destroy,
    snapshot() {
      return { mode: 'island', version: 'v2', source, projection, view, landSeed, contours, scale, probe, magnification };
    },
  };
}
