import { action, el, section, type PilotController, type PilotShell } from '../pilot/ui';
import {
  ISLAND_LAYER_IDS,
  ISLAND_LAYER_LABELS,
  ISLAND_MESH_LAYER_IDS,
  activeIslandLandTriangles,
  activeIslandSeabedTriangles,
  generateIslandLandform,
  islandMeshLayers,
  islandTerrainAt,
  type IslandLandform,
} from './core/island-landform';
import { ascentHeightAt, ascentSectionPosition, type IslandAscent } from './core/island-ascents';
import { islandLevelHeights } from './core/island-heights';
import { projectLandVertex, type IslandLayerId, type IslandMeshLayerId, type LandCamera, type LandProjection } from './core/landform-study';
import { islandOrbitCenter, islandOrbitViewport, islandTurnProgress, islandViewFromParameters, QUARTER_TURN } from './core/island-view';
import { drawLandform, type LandPalette } from './render/landform-study';
import { createIslandEnvironment, ISLAND_SEA, type EnvironmentFrame } from './render/island-environment';
import {
  createDefaultLayersInspection,
  diagnosticSetting,
  isDefaultLayersInspection,
  layersFromParameters,
  serializeLayersParameter,
  soloIslandLayer,
  type IslandMeshLayerInspection,
  type IslandWaterLayerInspection,
  type LandDiagnostics,
} from './render/landform-diagnostics';
import { islandLevelPalette } from './render/island-level-palette';
import { IslandOceanBackdrop } from './render/island-ocean-backdrop';
import { DEFAULT_SUN, sunParameters, sunSettingsFromParameters, validateSunSettings, type SunSettings } from './render/island-sun';
import {
  WATER_COLOR_FIELDS,
  WATER_NUMERIC_FIELDS,
  resetWaterSettings,
  validateWaterSettings,
  waterParameters,
  waterSettingsFromParameters,
  type WaterSettings,
} from './render/island-water-settings';
import { createIslandOrbitRenderer, type IslandOrbitRenderer } from './render/island-orbit-renderer';

export async function mountIslandLandform(shell: PilotShell, parameters: URLSearchParams, signal: AbortSignal): Promise<PilotController> {
  const initialSeed = parameters.get('seed') ?? '902479';
  if (!/^\d{1,6}$/.test(initialSeed)) throw new Error('Island seed must be a whole number from 0 to 999999.');
  let seed = Number(initialSeed);
  const requestedProjection = parameters.get('projection') ?? 'oblique';
  if (requestedProjection !== 'oblique' && requestedProjection !== 'current' && requestedProjection !== 'plan') {
    throw new Error('Unknown full-island projection.');
  }
  let projection: LandProjection = requestedProjection;
  let view = islandViewFromParameters(parameters);
  let yaw = view * QUARTER_TURN;
  let turning = false;
  let turnAnimation = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const requestedAppearance = parameters.get('appearance') ?? 'environment';
  if (requestedAppearance !== 'environment' && requestedAppearance !== 'blockout') throw new Error('Unknown island appearance.');
  let appearance: 'environment' | 'blockout' = requestedAppearance;
  let sunSettings = sunSettingsFromParameters(parameters);
  let sunRender = 0;
  let sunChanged = false;
  let waterSettings = waterSettingsFromParameters(parameters);
  let waterRender = 0;
  let waterChanged = false;
  const requestedEdges = parameters.get('edges') ?? 'grid';
  if (requestedEdges !== 'conditioned' && requestedEdges !== 'grid') throw new Error('Unknown terrace edge treatment.');
  // Old chamfer links remain loadable, but normal islands use square corners.
  const conditionEdges = false;
  // Retired comparison links use the final geometry, then lose their old flags.
  const requestedAscent = parameters.get('ascent');
  if (requestedAscent !== null && requestedAscent !== 'stairs' && requestedAscent !== 'natural') throw new Error('Unknown island ascent setting.');
  const requestedRelief = parameters.get('relief');
  if (requestedRelief !== null && requestedRelief !== 'original' && requestedRelief !== 'lower') throw new Error('Unknown island relief setting.');
  const diagnostics = {
    checker: diagnosticSetting(parameters, 'checker'),
    wireframe: diagnosticSetting(parameters, 'wireframe'),
    regions: diagnosticSetting(parameters, 'regions'),
    groundMask: diagnosticSetting(parameters, 'groundMask'),
    layers: layersFromParameters(parameters),
  };
  const requestedWater = parameters.get('water');
  if (requestedWater !== null && requestedWater !== 'still' && requestedWater !== 'animated') throw new Error('Unknown water motion setting.');
  let animated = requestedWater === null ? !matchMedia('(prefers-reduced-motion: reduce)').matches : requestedWater === 'animated';
  const waterHasMotion = () => {
    const water = diagnostics.layers.water;
    return (water.surfaceResponse && (water.lighting || (water.seabedVisibility && diagnostics.layers.seabed.visible)))
      || water.surfaceHighlights || water.waves || water.shoreFoam
      || (water.colorPatches && waterSettings.noiseSpeed > 0 && (waterSettings.noiseShallow > 0 || waterSettings.noiseDeep > 0));
  };
  let zoom = 0;
  let island: IslandLandform;
  let orbitCenter = { x: 0, y: 0 };
  let environment: ReturnType<typeof createIslandEnvironment> | undefined;
  let orbit: IslandOrbitRenderer | undefined;
  let orbitEnvironment: typeof environment;
  let graphicsUnavailable = false;
  let environmentFrame: EnvironmentFrame | undefined;
  let animation = 0;
  let seconds = 0;
  let lastFrame = 0;
  let imageData: ImageData | undefined;
  let viewportOrigin = { x: 0, y: 0 };
  let focusedAscent: number | undefined;
  shell.root.dataset.study = 'island-landform';
  shell.stage.classList.add('landform-stage');
  const gallery = el('div', 'landform-gallery');
  const figure = el('figure', 'landform-figure');
  const caption = el('figcaption');
  const scene = el('div', 'island-ocean-scene');
  const oceanCanvas = el('canvas', 'island-ocean-backdrop');
  oceanCanvas.setAttribute('aria-hidden', 'true');
  oceanCanvas.hidden = true;
  const backdrop = new IslandOceanBackdrop(oceanCanvas);
  const frame = el('div', 'landform-canvas-frame');
  frame.tabIndex = 0;
  frame.setAttribute('aria-label', 'Whole island, left and right arrow keys rotate, scroll to pan when zoomed');
  const canvas = el('canvas');
  const orbitCanvas = el('canvas', 'island-orbit-canvas');
  orbitCanvas.hidden = true;
  orbitCanvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.islandSurface = 'true';
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the island environment canvas.');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Full generated island rendered from connected 3D terrain');
  frame.append(canvas);
  scene.append(oceanCanvas, frame, orbitCanvas);
  figure.append(caption, scene);
  gallery.append(figure);
  shell.stage.append(gallery);
  function button(label: string, run: () => void): HTMLButtonElement {
    return action(label, () => { try { run(); } catch (cause) { shell.showError(cause); } }, signal);
  }
  const rotationControls = el('div', 'island-view-controls');
  rotationControls.setAttribute('role', 'group');
  rotationControls.setAttribute('aria-label', 'Island rotation');
  const rotateLeft = button('←', () => turn(-1));
  rotateLeft.setAttribute('aria-label', 'Rotate island left');
  rotateLeft.title = 'Rotate left 90°';
  const rotateRight = button('→', () => turn(1));
  rotateRight.setAttribute('aria-label', 'Rotate island right');
  rotateRight.title = 'Rotate right 90°';
  const viewReadout = el('output', 'island-view-readout');
  viewReadout.setAttribute('aria-live', 'polite');
  viewReadout.setAttribute('aria-atomic', 'true');
  rotationControls.append(rotateLeft, viewReadout, rotateRight);
  scene.append(rotationControls);
  function camera(): LandCamera {
    return {
      yaw: projection === 'plan' ? 0 : yaw,
      center: orbitCenter,
    };
  }
  function updateViewControls(): void {
    rotateLeft.disabled = rotateRight.disabled = turning || projection === 'plan';
    rotationControls.setAttribute('aria-busy', String(turning));
    viewReadout.value = projection === 'plan' ? 'Elevation plan' : `View ${view + 1} / 4`;
    canvas.dataset.view = String(view);
    canvas.dataset.yaw = String(yaw);
    canvas.dataset.turning = String(turning);
  }
  function finishTurn(): void {
    cancelAnimationFrame(turnAnimation);
    turnAnimation = 0;
    turning = false;
    yaw = view * QUARTER_TURN;
    updateViewControls();
  }
  function orbitUnavailable(cause: unknown): void {
    graphicsUnavailable = true;
    orbit?.destroy();
    orbit = undefined;
    orbitCanvas.hidden = true;
    canvas.style.visibility = '';
    canvas.removeAttribute('aria-hidden');
    viewReadout.title = 'Smooth rotation is unavailable. Views change instantly.';
    console.warn('Smooth island rotation is unavailable; using instant quarter turns.', cause);
  }
  function turn(direction: -1 | 1): void {
    if (turning || projection === 'plan' || signal.aborted) return;
    focusedAscent = undefined;
    delete canvas.dataset.focusAscent;
    const start = yaw, target = start + direction * QUARTER_TURN;
    view = (view + direction + 4) % 4;
    turning = true;
    clearTimeout(animation);
    advanceWater(performance.now());
    updateViewControls();
    const gpu = orbit && appearance === 'environment' ? orbit : undefined;
    if (gpu) {
      try {
        gpu.draw(camera(), seconds);
        orbitCanvas.hidden = false;
      } catch (cause) {
        orbitUnavailable(cause);
        finishTurn();
        render();
        return;
      }
    }
    let started: number | undefined;
    const tick = (now: number) => {
      if (signal.aborted) return;
      try {
        started ??= now;
        const progress = !gpu || reducedMotion.matches || document.hidden ? 1 : islandTurnProgress(now - started);
        yaw = start + (target - start) * progress;
        if (gpu) {
          advanceWater(performance.now());
          paintGPU();
          updateViewControls();
        }
        if (progress === 1) {
          finishTurn();
          if (gpu) {
            paintGPU();
            const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
            params.set('view',String(view));
            history.replaceState(null,'',`#/island?${params}`);
            scheduleWater();
          } else render();
        }
        if (turning) turnAnimation = requestAnimationFrame(tick);
      } catch (cause) {
        finishTurn();
        if (gpu) {
          orbitUnavailable(cause);
          try { render(); } catch (fallbackCause) { shell.showError(fallbackCause); }
        } else shell.showError(cause);
      }
    };
    turnAnimation = requestAnimationFrame(tick);
  }
  const navigation = el('div', 'p-choices');
  const study = el('a', 'p-button', 'Landform study');
  study.href = '#/island?version=v2&study=landform&source=reference&treatment=compare';
  const current = el('span', 'p-button', 'Whole island');
  current.setAttribute('aria-current', 'page');
  navigation.append(study, current);
  shell.sessionControls.append(navigation);
  const generation = section('Island');
  const generationStack = el('div', 'p-world-stack');
  const seedLabel = el('label', 'p-world-seed', 'Island seed');
  const seedInput = el('input');
  seedInput.type = 'number';
  seedInput.min = '0';
  seedInput.max = '999999';
  seedInput.step = '1';
  seedInput.value = String(seed);
  seedLabel.append(seedInput);
  const statistics = el('output', 'landform-status');
  const heightReadout = el('output', 'landform-status');
  heightReadout.setAttribute('aria-label', 'Terrace heights');
  const meshStatistics = el('output', 'landform-status');
  const edgeStatistics = el('output', 'landform-status');
  edgeStatistics.setAttribute('aria-label', 'Terrace edge conditioning');
  meshStatistics.setAttribute('aria-label', 'Mesh triangle count');
  statistics.setAttribute('role', 'status');
  const original = el('a', 'p-button', 'View V1 with this seed');
  const details = el('details', 'landform-generation-details');
  const report = el('pre');
  details.append(el('summary', '', 'Inherited generation rules'), report);
  const projectionControls = section('Projection');
  const projectionStack = el('div', 'p-world-stack');
  projectionStack.setAttribute('role', 'group');
  projectionStack.setAttribute('aria-label', 'Island projection');
  projectionControls.append(projectionStack);
  const projectionButtons = new Map<LandProjection, HTMLButtonElement>();
  const appearanceButtons = new Map<string, HTMLButtonElement>();
  const diagnosticInputs = new Map<'checker' | 'wireframe' | 'regions' | 'groundMask', HTMLInputElement>();
  const layerVisibilityInputs = new Map<IslandLayerId, HTMLInputElement>();
  const layerSoloButtons = new Map<IslandLayerId, HTMLButtonElement>();
  const layerMetaOutputs = new Map<IslandLayerId, HTMLOutputElement>();
  const meshLayerSubInputs = new Map<string, HTMLInputElement>();
  const waterLayerSubInputs = new Map<keyof IslandWaterLayerInspection, HTMLInputElement>();
  const ascentControls = section('Ascents');
  const ascentList = el('div', 'p-world-stack');
  ascentControls.append(ascentList);
  const colors = getComputedStyle(shell.root);
  function color(name: string): number[] {
    const hex = colors.getPropertyValue(`--cp-landform-${name}`).trim();
    if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Invalid island palette color: ${name}.`);
    return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
  }
  const palette: LandPalette = {
    water: color('water'), top: color('top'), light: color('light'),
    middle: color('middle'), dark: color('dark'),
    levels: [color('level-base'), color('level-shelf'), color('level-high')],
  };
  const sunControls = section('Sun and shadows');
  const sunStack = el('div', 'p-world-stack');
  const sunInputs = new Map<keyof SunSettings, HTMLInputElement | HTMLSelectElement>();
  const sunReadouts = new Map<keyof SunSettings, HTMLOutputElement>();
  function updateSunControls(): void {
    const disabled = appearance !== 'environment' || projection === 'plan' || diagnostics.checker || diagnostics.regions;
    for (const [key, input] of sunInputs) {
      input.value = String(sunSettings[key]);
      input.disabled = disabled || (key === 'softness' && sunSettings.shadowMode === 'hard');
      const readout = sunReadouts.get(key);
      if (readout) readout.value = `${sunSettings[key]}${key === 'azimuth' || key === 'elevation' || (key === 'softness' && sunSettings.shadowMode === 'contact') ? '°' : ''}`;
    }
    resetSun.disabled = disabled;
  }
  function changeSun(next: SunSettings): void {
    try {
      validateSunSettings(next);
      sunSettings = next;
      sunChanged = true;
      updateSunControls();
      cancelAnimationFrame(sunRender);
      sunRender = requestAnimationFrame(() => {
        sunRender = 0;
        if (signal.aborted) return;
        try { render(); } catch (cause) { shell.showError(cause); }
      });
    } catch (cause) {
      updateSunControls();
      shell.showError(cause);
    }
  }
  for (const [key, label, min, max, step] of [
    ['azimuth', 'Sun direction', 0, 360, 1],
    ['elevation', 'Sun elevation', 10, 85, 1],
    ['intensity', 'Sun intensity', 0, 2, 0.05],
    ['skyFill', 'Sky fill', 0, 1, 0.05],
    ['warmth', 'Sun warmth', 0, 1, 0.05],
    ['shadowStrength', 'Shadow strength', 0, 1, 0.05],
    ['softness', 'Shadow softness', 0, 8, 0.1],
  ] as const) {
    const row = el('label', 'p-slider');
    const heading = el('span', 'p-slider-heading');
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    const readout = el('output');
    sunInputs.set(key, input);
    sunReadouts.set(key, readout);
    heading.append(el('span', '', label), readout);
    row.append(heading, input);
    input.addEventListener('input', () => changeSun({ ...sunSettings, [key]: input.valueAsNumber }), { signal });
    sunStack.append(row);
  }
  for (const [key, label, options] of [
    ['shadowMode', 'Shadow mode', [['hard', 'Hard'], ['filtered', 'Filtered'], ['contact', 'Contact hardening']]],
    ['mapSize', 'Shadow quality', [['512', '512'], ['1024', '1024'], ['2048', '2048']]],
  ] as const) {
    const row = el('label', 'p-world-seed', label);
    const input = el('select');
    input.setAttribute('aria-label', label);
    for (const [value, text] of options) {
      const option = el('option', '', text);
      option.value = value;
      input.append(option);
    }
    sunInputs.set(key, input);
    input.addEventListener('change', () => changeSun({
      ...sunSettings, [key]: key === 'mapSize' ? Number(input.value) : input.value,
    } as SunSettings), { signal });
    row.append(input);
    sunStack.append(row);
  }
  const resetSun = button('Reset sun', () => changeSun({ ...DEFAULT_SUN }));
  sunStack.append(resetSun, el('p', 'landform-help', 'Light the current island and water without changing terrain. Contact softness is the sun’s angular diameter in degrees; filtered softness is an artistic world-space radius. Checker, material regions and elevation plans remain unlit.'));
  sunControls.append(sunStack);
  const waterControls = section('Water art');
  const waterStack = el('div', 'p-world-stack');
  const waterAdvanced = el('details', 'landform-generation-details');
  const waterAdvancedStack = el('div', 'p-world-stack');
  waterAdvanced.append(el('summary', '', 'Advanced water'), waterAdvancedStack);
  type WaterColorField = (typeof WATER_COLOR_FIELDS)[number][0];
  type WaterNumericField = (typeof WATER_NUMERIC_FIELDS)[number][0];
  const waterColorInputs = new Map<WaterColorField, HTMLInputElement>();
  const waterNumericInputs = new Map<WaterNumericField, HTMLInputElement>();
  const waterReadouts = new Map<keyof WaterSettings, HTMLOutputElement>();
  const waterNumericLabels: Record<WaterNumericField, readonly [string, number, string, boolean]> = {
    transitionDepth: ['Middle color depth', 0.1, ' units', true],
    deepDepth: ['Deep color depth', 0.1, ' units', true],
    blendSoftness: ['Depth blend softness', 0.05, '', false],
    noiseShallow: ['Shallow color noise', 0.1, ' bytes', false],
    noiseDeep: ['Deep color noise', 0.1, ' bytes', false],
    noiseScale: ['Noise patch size', 0.1, ' units', true],
    noiseSpeed: ['Noise drift speed', 0.01, ' units/s', true],
    waveEndSoftness: ['Wave tip softness', 0.01, '', false],
  };
  function waterHex(color: WaterSettings[WaterColorField]): string {
    return `#${color.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
  }
  function updateWaterControls(): void {
    const disabled = appearance !== 'environment' || projection === 'plan' || diagnostics.checker || diagnostics.regions || !diagnostics.layers.water.visible;
    for (const [key, input] of waterColorInputs) {
      input.value = waterHex(waterSettings[key]);
      input.disabled = disabled;
      waterReadouts.get(key)!.value = input.value;
    }
    for (const [key, , min, max] of WATER_NUMERIC_FIELDS) {
      const input = waterNumericInputs.get(key)!;
      const [, step, unit] = waterNumericLabels[key];
      // Preserve valid fractional URL anchors while leaving room between depths.
      input.min = String(key === 'deepDepth' ? Math.max(min, Math.min(waterSettings.deepDepth, waterSettings.transitionDepth + step)) : min);
      input.max = String(key === 'transitionDepth' ? Math.min(max, Math.max(waterSettings.transitionDepth, waterSettings.deepDepth - step)) : max);
      const steps = (waterSettings[key] - Number(input.min)) / step;
      const anchor = Number(input.min) / step;
      input.step = Math.abs(steps - Math.round(steps)) < 1e-8 && Math.abs(anchor - Math.round(anchor)) < 1e-8 ? String(step) : 'any';
      input.value = String(waterSettings[key]);
      input.disabled = disabled;
      waterReadouts.get(key)!.value = `${waterSettings[key]}${unit}`;
    }
    resetWater.disabled = disabled;
  }
  function changeWater(next: WaterSettings): void {
    try {
      waterSettings = validateWaterSettings(next);
      waterChanged = true;
      updateWaterControls();
      cancelAnimationFrame(waterRender);
      waterRender = requestAnimationFrame(() => {
        waterRender = 0;
        if (signal.aborted) return;
        try { render(); } catch (cause) { shell.showError(cause); }
      });
    } catch (cause) {
      updateWaterControls();
      shell.showError(cause);
    }
  }
  for (const [key] of WATER_COLOR_FIELDS) {
    const label = `${key[0].toUpperCase()}${key.slice(1)} water color`;
    const row = el('label', 'p-world-seed');
    const heading = el('span', 'p-slider-heading');
    const input = el('input');
    input.type = 'color';
    input.setAttribute('aria-label', label);
    input.dataset.waterSetting = key;
    const readout = el('output');
    waterColorInputs.set(key, input);
    waterReadouts.set(key, readout);
    heading.append(el('span', '', label), readout);
    row.append(heading, input);
    input.addEventListener('input', () => {
      try {
        if (!/^#[0-9a-f]{6}$/i.test(input.value)) throw new Error(`Invalid ${label.toLowerCase()}.`);
        const color: WaterSettings[WaterColorField] = [
          parseInt(input.value.slice(1, 3), 16), parseInt(input.value.slice(3, 5), 16), parseInt(input.value.slice(5, 7), 16),
        ];
        changeWater({ ...waterSettings, [key]: color });
      } catch (cause) { updateWaterControls(); shell.showError(cause); }
    }, { signal });
    waterStack.append(row);
  }
  for (const [key, , min, max] of WATER_NUMERIC_FIELDS) {
    const [label, step, , advanced] = waterNumericLabels[key];
    const row = el('label', 'p-slider');
    const heading = el('span', 'p-slider-heading');
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    input.dataset.waterSetting = key;
    const readout = el('output');
    waterNumericInputs.set(key, input);
    waterReadouts.set(key, readout);
    heading.append(el('span', '', label), readout);
    row.append(heading, input);
    input.addEventListener('input', () => changeWater({ ...waterSettings, [key]: input.valueAsNumber }), { signal });
    (advanced ? waterAdvancedStack : waterStack).append(row);
  }
  const resetWater = button('Reset water', () => changeWater(resetWaterSettings()));
  waterStack.append(waterAdvanced, resetWater,
    el('p', 'landform-help', 'Adjust water colors, depth blending, drifting color noise and wave tips without changing terrain or wave timing. Checker, material regions and elevation plans keep these controls inactive.'));
  waterControls.append(waterStack);
  function paintEnvironment(): void {
    if (orbit && !orbitCanvas.hidden) { paintGPU(); return; }
    if (!environmentFrame || !imageData) return;
    environmentFrame.animate(seconds);
    imageData.data.set(environmentFrame.raster.pixels);
    const wLayer = diagnostics.layers!.water;
    const useBackdropMask = wLayer.visible && projection !== 'plan';
    if (useBackdropMask) {
      for (let i = 0; i < environmentFrame.oceanOnlyMask.length; i++) {
        if (environmentFrame.oceanOnlyMask[i]) imageData.data[i * 4 + 3] = 0;
      }
    }
    context!.putImageData(imageData, 0, 0);
    if (useBackdropMask) backdrop.paint(seconds);
    else backdrop.hide();
    canvas.dataset.waterTime = seconds.toFixed(3);
    canvas.dataset.foamPixels = String(environmentFrame.foamPixels);
  }
  function paintGPU(): void {
    orbit!.draw(camera(),seconds);
    canvas.dataset.waterTime = orbitCanvas.dataset.waterTime = seconds.toFixed(3);
  }
  function advanceWater(now: number): void {
    if (animated && waterHasMotion() && !document.hidden && lastFrame) seconds += Math.max(0, Math.min(0.25,(now-lastFrame)/1000));
    lastFrame = now;
  }
  function updateOceanBackdrop(): void {
    const wLayer = diagnostics.layers!.water;
    const useBackdropMask = wLayer.visible && projection !== 'plan';
    if (!useBackdropMask || (orbit && appearance === 'environment' && projection !== 'plan')) { backdrop.hide(); return; }
    if (!environment || appearance !== 'environment' || projection === 'plan') { backdrop.hide(); return; }
    const bounds = canvas.getBoundingClientRect(), sceneBounds = scene.getBoundingClientRect();
    backdrop.update(environment.ocean, {
      width: scene.clientWidth, height: scene.clientHeight,
      left: bounds.left - sceneBounds.left, top: bounds.top - sceneBounds.top,
      magnification: Number(canvas.dataset.magnification), origin: viewportOrigin, projection, camera: camera(),
      surfaceSun: wLayer.surfaceResponse && wLayer.lighting ? environment.sun : undefined,
      surfaceHighlights: wLayer.surfaceHighlights,
      waterSettings: environment.waterSettings,
      patches: environment.oceanBake.patches,
      colorPatches: wLayer.colorPatches,
      lighting: wLayer.lighting,
    }, seconds);
  }
  function scheduleWater(): void {
    clearTimeout(animation);
    animation = 0;
    if (signal.aborted || document.hidden || turning || !animated || !waterHasMotion() || !diagnostics.layers!.water.visible || appearance !== 'environment' || projection === 'plan') return;
    lastFrame = performance.now();
    const tick = () => {
      if (signal.aborted || document.hidden) return;
      try {
        advanceWater(performance.now());
        paintEnvironment();
      } catch (cause) {
        if (orbit) {
          orbitUnavailable(cause);
          try { render(); } catch (fallbackCause) { shell.showError(fallbackCause); }
        } else shell.showError(cause);
        return;
      }
      animation = window.setTimeout(tick,125);
    };
    animation = window.setTimeout(tick,125);
  }
  function ensureOrbit(): void {
    if (!environment || graphicsUnavailable) return;
    if (orbitEnvironment !== environment) {
      orbit?.destroy();
      orbitEnvironment = environment;
      try {
        orbit = createIslandOrbitRenderer(orbitCanvas,island,environment);
        if (!orbit) orbitUnavailable('WebGL with depth textures is not supported.');
        else viewReadout.removeAttribute('title');
      } catch (cause) { orbitUnavailable(cause); }
    }
  }
  function layout(): void {
    if (!canvas.width || !canvas.height) return;
    const fit = Math.max(0.25, Math.min((frame.clientWidth - 24) / canvas.width, (frame.clientHeight - 96) / canvas.height));
    const factor = zoom || fit;
    canvas.style.width = `${canvas.width * factor}px`;
    canvas.style.height = `${canvas.height * factor}px`;
    canvas.dataset.magnification = String(factor);
    canvas.dataset.pivotX = String(orbitCenter.x);
    canvas.dataset.pivotY = String(orbitCenter.y);
    updateOceanBackdrop();
    if (environment && appearance === 'environment' && projection !== 'plan') {
      ensureOrbit();
      if (orbit) {
        const bounds = canvas.getBoundingClientRect(), sceneBounds = scene.getBoundingClientRect();
        try {
          orbit.prepare(projection, {
            width: Math.max(1, Math.ceil(scene.clientWidth / factor)),
            height: Math.max(1, Math.ceil(scene.clientHeight / factor)),
            origin: {
              x: viewportOrigin.x + (bounds.left - sceneBounds.left) / factor,
              y: viewportOrigin.y + (bounds.top - sceneBounds.top) / factor,
            },
          }, diagnostics, seconds);
          // Crop a uniformly magnified framebuffer; never stretch rounded X/Y
          // framebuffer dimensions independently to the scene rectangle.
          orbitCanvas.style.width = `${orbitCanvas.width}px`;
          orbitCanvas.style.height = `${orbitCanvas.height}px`;
          orbitCanvas.style.transformOrigin = '0 0';
          orbitCanvas.style.transform = `scale(${factor})`;
          orbitCanvas.hidden = false;
          canvas.style.visibility = 'hidden';
          canvas.setAttribute('aria-hidden','true');
          orbitCanvas.removeAttribute('aria-hidden');
          orbitCanvas.setAttribute('role','img');
          orbitCanvas.setAttribute('aria-label',canvas.getAttribute('aria-label')!);
          canvas.dataset.presentation = 'webgl';
          canvas.dataset.grassCount = orbitCanvas.dataset.grassCount!;
          paintGPU();
        } catch (cause) { orbitUnavailable(cause); render(); }
      }
    }
  }
  function centerAscent(ascent: IslandAscent): void {
    const middle = ascent.sections[Math.floor(ascent.sections.length / 2)];
    const point = ascent.kind === 'gully' ? ascentSectionPosition(ascent, middle, (middle.from + middle.to) / 2) : {
      x: ascent.origin.x + ascent.direction.x * ascent.length / 2,
      y: ascent.origin.y + ascent.direction.y * ascent.length / 2,
    };
    const projected = projectLandVertex({ ...point, z: ascentHeightAt(ascent, point)! }, projection, camera());
    const factor = Number(canvas.dataset.magnification);
    const canvasBounds = canvas.getBoundingClientRect(), frameBounds = frame.getBoundingClientRect();
    frame.scrollLeft += canvasBounds.left + (projected.x + viewportOrigin.x) * factor - frameBounds.left - frame.clientWidth / 2;
    frame.scrollTop += canvasBounds.top + (projected.y + viewportOrigin.y) * factor - frameBounds.top - frame.clientHeight / 2;
    canvas.dataset.focusAscent = String(ascent.id);
    if (orbit && !orbitCanvas.hidden) layout();
    else updateOceanBackdrop();
  }
  function render(): void {
    if (turning) finishTurn();
    cancelAnimationFrame(sunRender);
    sunRender = 0;
    cancelAnimationFrame(waterRender);
    waterRender = 0;
    if (signal.aborted) return;
    const { world, triangles } = island;
    const heights = islandLevelHeights(world);
    const renderPalette = { ...palette, levels: islandLevelPalette(world, palette.levels[0], palette.levels[2]) };
    const viewport = islandOrbitViewport(triangles, projection, camera());
    viewportOrigin = viewport.origin;
    environmentFrame = undefined;
    imageData = undefined;
    orbitCanvas.hidden = true;
    canvas.style.visibility = '';
    canvas.removeAttribute('aria-hidden');
    canvas.dataset.presentation = 'cpu';
    if (appearance === 'environment') {
      if (!environment) environment = createIslandEnvironment(island, sunSettings, waterSettings);
      else {
        if (sunChanged) environment.setSun(sunSettings);
        if (waterChanged) environment.setWaterSettings(waterSettings);
      }
      sunChanged = false;
      waterChanged = false;
      waterSettings = environment.waterSettings;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      if (projection !== 'plan') ensureOrbit();
      if (!orbit || projection === 'plan') {
        environmentFrame = environment.render(projection, viewport, undefined, diagnostics, camera());
        imageData = context!.createImageData(canvas.width, canvas.height);
        paintEnvironment();
        canvas.dataset.grassCount = String(environmentFrame.grassCount);
        canvas.dataset.waterPixels = String(environmentFrame.waterPixels);
        canvas.dataset.beachWaterPixels = String(environmentFrame.beachWaterPixels);
        canvas.dataset.cliffWaterPixels = String(environmentFrame.cliffWaterPixels);
        canvas.dataset.submergedPixels = String(environmentFrame.submergedPixels);
      } else {
        // Pixel coverage belongs to the CPU raster only, not the authoritative
        // GPU surface. Do not retain stale CPU diagnostics.
        for (const key of ['waterPixels','beachWaterPixels','cliffWaterPixels','submergedPixels','foamPixels']) delete canvas.dataset[key];
      }
      canvas.dataset.ocean = projection === 'plan' ? 'plan' : 'full-scene';
      canvas.dataset.shoreline = 'beach-aware';
    } else {
      const layers = diagnostics.layers!;
      const blockoutLand = activeIslandLandTriangles(island, {
        base: layers.base.visible,
        uplands: layers.uplands.visible,
        beaches: layers.beaches.visible,
      });
      const blockoutSeabed = projection === 'plan'
        ? []
        : activeIslandSeabedTriangles(island, { seabed: layers.seabed.visible });
      drawLandform(canvas, projection, renderPalette, undefined, false, [], [], undefined, {
      triangles: [...blockoutLand, ...blockoutSeabed],
      viewport,
      camera: camera(),
      diagnostics,
      shade: (triangle, point) => {
        if (triangle.plane !== 'top') return palette[triangle.plane];
        const cell = {
          x: Math.min(world.width - 1, Math.max(0, Math.floor(point.x / world.tileSize))),
          y: Math.min(world.height - 1, Math.max(0, Math.floor(point.y / world.tileSize))),
        };
        return islandTerrainAt(world, cell, point, island.ascents) === 'sand' ? palette.light : palette.top;
      },
      });
      canvas.dataset.grassCount = '0';
      canvas.dataset.waterPixels = '0';
      canvas.dataset.beachWaterPixels = '0';
      canvas.dataset.cliffWaterPixels = '0';
      canvas.dataset.foamPixels = '0';
      canvas.dataset.submergedPixels = '0';
      canvas.dataset.ocean = 'none';
      canvas.dataset.shoreline = 'none';
    }
    const layers = diagnostics.layers!;
    const meshLayers = islandMeshLayers(island);
    const activeLand = activeIslandLandTriangles(island, {
      base: layers.base.visible,
      uplands: layers.uplands.visible,
      beaches: layers.beaches.visible,
    });
    const activeSeabed = projection === 'plan'
      ? []
      : activeIslandSeabedTriangles(island, { seabed: layers.seabed.visible });
    canvas.dataset.visibleLayers = ISLAND_LAYER_IDS.filter(id => layers[id].visible).join(',');
    canvas.dataset.activeTriangles = String(activeLand.length + activeSeabed.length);
    canvas.dataset.baseTriangles = String(meshLayers.base.triangles.length);
    canvas.dataset.uplandsTriangles = String(meshLayers.uplands.triangles.length);
    canvas.dataset.beachesTriangles = String(meshLayers.beaches.triangles.length);
    canvas.dataset.seabedTriangles = String(meshLayers.seabed.triangles.length);
    for (const id of ISLAND_MESH_LAYER_IDS) {
      const layer = meshLayers[id];
      const meta = layerMetaOutputs.get(id);
      if (meta) meta.value = `${layer.triangles.length} tris · ${layer.vertices.length} verts`;
      const input = layerVisibilityInputs.get(id);
      if (input) input.checked = layers[id].visible;
      const solo = layerSoloButtons.get(id);
      if (solo) {
        const isSolo = ISLAND_LAYER_IDS.every(other => (other === id ? layers[other].visible : !layers[other].visible));
        solo.setAttribute('aria-pressed', String(isSolo));
      }
      for (const key of ['materials', 'textures', 'lighting', 'wireframe', 'vertices', 'normals', 'boundaries', 'uvChecker', 'uvSeams'] as const) {
        const sub = meshLayerSubInputs.get(`${id}:${key}`);
        if (sub) {
          sub.checked = layers[id][key];
          sub.disabled = !layers[id].visible;
        }
      }
    }
    const waterMeta = layerMetaOutputs.get('water');
    if (waterMeta) waterMeta.value = !layers.water.visible ? 'Hidden' : !waterHasMotion() ? 'Calm' : animated ? 'Animated' : 'Still';
    const waterVisInput = layerVisibilityInputs.get('water');
    if (waterVisInput) waterVisInput.checked = layers.water.visible;
    const waterSolo = layerSoloButtons.get('water');
    if (waterSolo) {
      const isSolo = ISLAND_LAYER_IDS.every(other => (other === 'water' ? layers[other].visible : !layers[other].visible));
      waterSolo.setAttribute('aria-pressed', String(isSolo));
    }
    for (const [key, sub] of waterLayerSubInputs) {
      sub.checked = layers.water[key];
      sub.disabled = !layers.water.visible;
    }
    resetLayers.disabled = isDefaultLayersInspection(layers);
    updateViewControls();
    canvas.dataset.projection = projection;
    canvas.dataset.appearance = appearance;
    canvas.dataset.checker = String(diagnostics.checker);
    canvas.dataset.wireframe = String(diagnostics.wireframe);
    const regionView = diagnostics.regions && !diagnostics.checker && appearance === 'environment';
    const maskView = diagnostics.groundMask && !diagnostics.checker && appearance === 'environment';
    canvas.dataset.groundMask = String(maskView);
    canvas.dataset.regions = String(regionView);
    canvas.setAttribute('aria-label', `${diagnostics.checker ? 'Projection checker' : maskView ? 'White and grey ground mask' : regionView ? 'Material regions' : appearance === 'environment' ? 'Textured' : 'Blockout'} island, ${projection} projection${diagnostics.wireframe ? ', with triangle wireframe' : ''}`);
    canvas.dataset.texturing = appearance === 'environment' && projection !== 'plan' && !maskView && !regionView && !diagnostics.checker ? 'projected-tiles' : 'diagnostic';
    canvas.dataset.lighting = diagnostics.checker ? 'unlit-checker' : maskView ? 'unlit-ground-mask' : regionView ? 'unlit-material-regions' : appearance === 'environment' && projection !== 'plan' ? 'directional-ambient-shadow' : 'blockout';
    canvas.dataset.sun = 'geometry-shadow-map';
    canvas.dataset.sunAzimuth = String(sunSettings.azimuth);
    canvas.dataset.sunElevation = String(sunSettings.elevation);
    canvas.dataset.shadowMode = sunSettings.shadowMode;
    canvas.dataset.shadowSoftness = String(sunSettings.softness);
    canvas.dataset.shadowQuality = String(sunSettings.mapSize);
    canvas.dataset.scaleReferences = '0';
    updateSunControls();
    updateWaterControls();
    diagnosticInputs.get('regions')!.disabled = diagnostics.checker || appearance !== 'environment';
    diagnosticInputs.get('groundMask')!.disabled = diagnostics.checker || appearance !== 'environment';
    shell.stage.style.backgroundColor = appearance === 'environment' && layers.water.visible ? `rgb(${ISLAND_SEA.join(',')})` : `rgb(${palette.water.join(',')})`;
    canvas.dataset.seed = String(seed);
    canvas.dataset.triangles = String(triangles.length);
    canvas.dataset.sourceTriangles = String(island.sourceTriangleCount);
    canvas.dataset.ramps = String(world.ramps!.length);
    canvas.dataset.ascents = String(island.ascents.length);
    canvas.dataset.ascentKinds = island.ascents.map(ascent => ascent.kind).join(',');
    canvas.dataset.ascentSteps = island.ascents.map(ascent => ascent.stepCount).join(',');
    canvas.dataset.ascentGrades = island.ascents.map(ascent => maximumGrade(ascent).toFixed(6)).join(',');
    canvas.dataset.ascentSwitchbacks = island.ascents.map(ascent => switchbacks(ascent)).join(',');
    canvas.dataset.ascentFootprints = island.naturalAscent?.status === 'placed' ? 'orthogonal' : 'rectangular';
    canvas.dataset.naturalAscent = island.naturalAscent?.status ?? 'off';
    canvas.dataset.naturalAscentProfile = island.naturalAscent?.status === 'placed' ? 'open-flank' : 'none';
    canvas.dataset.uplandShoulders = String(island.shoulders.patches.length);
    canvas.dataset.uplandShoulderHeights = island.shoulders.patches.map(patch => patch.height).join(',');
    canvas.dataset.beachProfile = 'stepped';
    canvas.dataset.waterProfile = 'terrain-depth';
    canvas.dataset.waterSurface = layers.water.surfaceResponse && layers.water.lighting ? 'normal-sky' : 'flat';
    canvas.dataset.beachWash = layers.water.shoreFoam ? 'run-up' : 'off';
    canvas.dataset.seabedCellSize = String(island.beach.seabed.cellSize);
    canvas.dataset.seabedFragments = String(island.beach.seabed.components.filter(component => !component.anchored).length);
    canvas.dataset.seabedSourceTriangles = String(island.beach.seabed.sourceTriangleCount);
    canvas.dataset.generator = world.generatorVersion;
    canvas.dataset.terraceEdges = conditionEdges ? 'conditioned' : 'grid';
    canvas.dataset.coast = island.coast ? 'procedural' : 'original';
    const coves = island.coast?.regions.filter(region => region.kind === 'cove').length ?? 0;
    const beaches = island.coast?.regions.filter(region => region.kind === 'beach').length ?? 0;
    canvas.dataset.coastCoves = String(coves);
    canvas.dataset.coastBeaches = String(beaches);
    const budget = island.coastBudget;
    const dryCells = budget?.dryCells.reduce((sum, value) => sum + value, 0) ?? 0;
    canvas.dataset.coastDryWidth = budget ? '16' : '0';
    canvas.dataset.coastDryCells = String(dryCells);
    canvas.dataset.coastSections = String(budget?.sections.length ?? 0);
    canvas.dataset.coastRestoredCells = String(budget?.restoredCells ?? 0);
    canvas.dataset.coastRejectedProfiles = String(budget?.rejectedProfiles ?? 0);
    canvas.dataset.conditionedCorners = String(island.edges.patches.length);
    canvas.dataset.elevationHeights = heights.join(',');
    canvas.dataset.maximumHeight = String(heights.at(-1));
    heightReadout.textContent = `Terraces: ${heights.join(' / ')} world units.`;
    caption.textContent = `Seed ${seed} · ${world.width * world.tileSize} × ${world.height * world.tileSize} world units`;
    const land = world.cells.reduce((sum, value) => sum + value, 0);
    const raised = world.elevations!.reduce((sum, value) => sum + Number(value > 0), 0);
    statistics.textContent = `${land.toLocaleString()} land cells · ${Math.round(raised / land * 100)}% highlands · ${world.ramps!.length} elevation connections · ${coves} coves · ${beaches} beaches.`;
    meshStatistics.textContent = `${triangles.length.toLocaleString()} triangles (${island.sourceTriangleCount.toLocaleString()} before merging; ${Math.round((1 - triangles.length / island.sourceTriangleCount) * 100)}% fewer). ${island.beach.underwaterTriangles.length.toLocaleString()} submerged shelf triangles.`;
    edgeStatistics.textContent = `Square terrace corners, ${island.naturalAscent?.status === 'placed' ? 'one open-sided flank ascent with a short upper gully' : 'rectangular stair flights and landings'}. ${island.shoulders.patches.length} partial upland shoulders.`;
    report.textContent = `${world.generatorVersion}\nCoastline: seeded coves, broad lowland beaches, shallow sand terraces and stepped submerged shelves; narrow connections, highlands and stair footprints protected.\nCoastal decisions: ${JSON.stringify(island.coastStats)}\nHighlands: selected heights ${heights.join(' / ')} in eight-unit increments. Maximum summit 32, maximum individual rise 16, no added tiers.\nConnections: supported stair flights constrain individual risers and tread depth. Terraced stairs have a wider middle landing.\nEdges: square grid corners, with coastal cells and stair reservations protected.\nMesh: true treads, risers and sidewalls; matching surface-height queries. Coplanar surfaces are merged and boundary-triangulated.`;
    report.textContent += `\nNatural ascent: ${island.naturalAscent?.status === 'placed'
      ? 'one stair connection replaced by a grade-limited flank route. Longer climbs add return traverses and level turn pockets. Sloping legs target 25% grade and never exceed 33.3%; flat turns do not count as climbing run. Cut-created narrow or detached remnants are cleaned locally or the site is rejected. No added terrain tiers.'
      : 'no supported open-flank ascent on this seed; the existing stairs are retained.'}`;
    original.href = `#/island?version=v1&seed=${seed}&paused=1`;
    for (const [value, control] of projectionButtons) control.setAttribute('aria-pressed', String(value === projection));
    for (const [value, control] of appearanceButtons) control.setAttribute('aria-pressed', String(value === appearance));
    waterMotion.textContent = !waterHasMotion() ? 'Water motion off' : animated ? 'Pause water' : 'Animate water';
    waterMotion.disabled = !waterHasMotion() || !layers.water.visible || appearance === 'blockout' || projection === 'plan';
    const layersParam = serializeLayersParameter(diagnostics.layers);
    const diagnosticParams = `checker=${Number(diagnostics.checker)}&wireframe=${Number(diagnostics.wireframe)}&regions=${Number(diagnostics.regions)}&groundMask=${Number(diagnostics.groundMask)}&edges=${conditionEdges ? 'conditioned' : 'grid'}${layersParam ? `&layers=${encodeURIComponent(layersParam)}` : ''}`;
    study.href = `#/island?version=v2&study=landform&source=reference&seed=${seed}&${diagnosticParams}&${waterParameters(waterSettings)}`;
    history.replaceState(null, '', `#/island?version=v2&study=landform&source=island&seed=${seed}&projection=${projection}&view=${view}&appearance=${appearance}&water=${animated ? 'animated' : 'still'}&${diagnosticParams}&${sunParameters(sunSettings)}&${waterParameters(waterSettings)}`);
    layout();
    if (focusedAscent !== undefined) {
      const ascent = island.ascents.find(ascent => ascent.id === focusedAscent);
      if (ascent) centerAscent(ascent);
    }
    scheduleWater();
  }
  function maximumGrade(ascent: IslandAscent): number {
    return ascent.kind === 'gully' ? Math.max(0, ...ascent.sections.map(section =>
      (section.fromHeight - section.toHeight) / (section.to - section.from))) : 0;
  }
  function switchbacks(ascent: IslandAscent): number {
    return Math.max(0, ascent.sections.filter(section => section.role === 'slope' && section.axis
      && Math.abs(section.axis.direction.x * ascent.direction.x + section.axis.direction.y * ascent.direction.y) < 1e-8).length - 1);
  }
  function generate(next: number): void {
    finishTurn();
    const updated = generateIslandLandform(next, { conditionEdges });
    island = updated;
    orbitCenter = islandOrbitCenter(island.triangles);
    environment = undefined;
    seconds = 0;
    seed = next;
    focusedAscent = undefined;
    delete canvas.dataset.focusAscent;
    seedInput.value = String(seed);
    ascentList.replaceChildren();
    for (const ascent of island.ascents) {
      const label = ascent.kind === 'gully' ? 'Open-flank ascent' : ascent.kind === 'stairs' ? 'Continuous stairs' : 'Terraced stairs';
      const proportions = ascent.kind === 'gully'
        ? `${(maximumGrade(ascent) * 100).toFixed(1)}% maximum slope, ${switchbacks(ascent)} return traverses`
        : `${ascent.stepCount} risers`;
      const readout = el('p', 'p-muted', `${label}: ${ascent.upperHeight - ascent.lowerHeight} rise, ${ascent.length.toFixed(1)} run, ${ascent.topWidth.toFixed(1)} top / ${ascent.bottomWidth.toFixed(1)} bottom width, ${proportions}.`);
      const focus = button(`Focus ascent ${ascent.id + 1}`, () => {
        focusedAscent = ascent.id;
        zoom = Math.max(3, Number(canvas.dataset.magnification));
        layout();
        centerAscent(ascent);
        frame.focus({ preventScroll: true });
      });
      ascentList.append(readout, focus);
    }
    if (!island.ascents.length) ascentList.append(el('p', 'p-muted', 'This island is flat; no ascent is needed.'));
    else if (island.naturalAscent?.status === 'unsupported') {
      ascentList.prepend(el('p', 'p-muted', 'No supported open-flank ascent on this seed. Existing stairs are retained.'));
    }
    render();
  }
  const generateButton = button('Generate', () => generate((seed + 1) % 1000000));
  generateButton.classList.add('p-primary');
  generateButton.dataset.action = 'generate-world';
  shell.primary.append(generateButton);
  const useSeed = button('Use seed', () => {
    if (!seedInput.reportValidity() || !/^\d{1,6}$/.test(seedInput.value)) throw new Error('Enter a whole island seed from 0 to 999999.');
    generate(Number(seedInput.value));
  });
  generationStack.append(seedLabel, useSeed, heightReadout);
  generation.append(generationStack);
  seedInput.addEventListener('keydown', event => { if (event.key === 'Enter') useSeed.click(); }, { signal });
  for (const [value, label] of [['oblique', 'Elevated oblique'], ['current', 'Current axes'], ['plan', 'Elevation plan']] as const) {
    const control = button(label, () => { finishTurn(); projection = value; render(); });
    projectionButtons.set(value, control);
    projectionStack.append(control);
  }
  const notes = section('Terrain');
  notes.append(original, statistics, details,
    el('p', 'landform-help', 'Terrain-led water with gentle ripples, a soft sky sheen, visible submerged shelves and local beach wash. Displaced waves, movement and resource interactions are not integrated.'));
  const appearanceControls = section('Appearance');
  const appearanceChoices = el('div', 'p-choices');
  appearanceChoices.setAttribute('role', 'group');
  appearanceChoices.setAttribute('aria-label', 'Island appearance');
  for (const [value, label] of [['environment', 'Environment'], ['blockout', 'Blockout']] as const) {
    const control = button(label, () => { appearance = value; render(); });
    appearanceButtons.set(value, control);
    appearanceChoices.append(control);
  }
  const waterMotion = button(animated ? 'Pause water' : 'Animate water', () => {
    animated = !animated;
    waterMotion.textContent = animated ? 'Pause water' : 'Animate water';
    const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
    params.set('water', animated ? 'animated' : 'still');
    sunParameters(sunSettings).forEach((value, key) => params.set(key, value));
    waterParameters(waterSettings).forEach((value, key) => params.set(key, value));
    history.replaceState(null, '', `#/island?${params}`);
    scheduleWater();
  });
  const appearanceStack = el('div', 'p-world-stack');
  appearanceStack.append(appearanceChoices, waterMotion);
  appearanceControls.append(appearanceStack);
  const diagnosticControls = section('Surface diagnostics');
  const diagnosticStack = el('div', 'p-world-stack');
  for (const [key, label] of [['checker', 'Projection checker'], ['wireframe', 'Triangle wireframe'], ['regions', 'Material regions'], ['groundMask', 'Ground patch mask']] as const) {
    const wrapper = el('label', 'landform-checkbox');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = diagnostics[key];
    diagnosticInputs.set(key, input);
    input.addEventListener('change', () => {
      try { diagnostics[key] = input.checked; render(); } catch (cause) { shell.showError(cause); }
    }, { signal });
    wrapper.append(input, document.createTextNode(label));
    diagnosticStack.append(wrapper);
  }
  diagnosticStack.append(meshStatistics, edgeStatistics, el('p', 'landform-help', 'Checker shows world-space texture projections. Regions shows unlit materials. Ground patch mask: coordinated white/off-white base regions and one grey crevice layer, set back from sand. No grass or top lighting. Sides, sand and water are unchanged.'));
  diagnosticControls.append(diagnosticStack);
  const layerControls = section('Layers');
  const layerStack = el('div', 'p-world-stack landform-layers-stack');
  const resetLayers = button('Reset layers', () => {
    diagnostics.layers = createDefaultLayersInspection();
    render();
  });
  const meshSubGroups: readonly [string, readonly [keyof IslandMeshLayerInspection, string][]][] = [
    ['Appearance', [
      ['materials', 'Materials / color'],
      ['textures', 'Textures'],
      ['lighting', 'Lighting / shading'],
    ]],
    ['Geometry inspection', [
      ['wireframe', 'Wireframe'],
      ['vertices', 'Vertices'],
      ['normals', 'Surface normals'],
      ['boundaries', 'Mesh boundaries'],
    ]],
    ['UV inspection', [
      ['uvChecker', 'UV checker'],
      ['uvSeams', 'UV seams'],
    ]],
  ];
  for (const id of ISLAND_MESH_LAYER_IDS) {
    const labelText = ISLAND_LAYER_LABELS[id];
    const card = el('div', 'landform-layer-card');
    card.dataset.layerCard = id;
    const header = el('div', 'landform-layer-header');
    const toggleLabel = el('label', 'landform-checkbox landform-layer-title');
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = diagnostics.layers![id].visible;
    toggle.setAttribute('aria-label', `${labelText} layer`);
    toggle.addEventListener('change', () => {
      try {
        diagnostics.layers![id].visible = toggle.checked;
        render();
      } catch (cause) { shell.showError(cause); }
    }, { signal });
    layerVisibilityInputs.set(id, toggle);
    toggleLabel.append(toggle, el('span', '', labelText));
    const meta = el('output', 'landform-layer-meta');
    meta.dataset.layerMeta = id;
    layerMetaOutputs.set(id, meta);
    const solo = button('Solo', () => {
      diagnostics.layers = soloIslandLayer(diagnostics.layers!, id);
      render();
    });
    solo.classList.add('landform-layer-solo');
    solo.setAttribute('aria-label', `Solo ${labelText}`);
    layerSoloButtons.set(id, solo);
    header.append(toggleLabel, meta, solo);

    const inspectDetails = el('details', 'landform-layer-details');
    const summary = el('summary', 'landform-layer-summary', `Inspect ${labelText.toLowerCase()}`);
    const groupsContainer = el('div', 'landform-layer-groups');
    for (const [groupTitle, items] of meshSubGroups) {
      const group = el('div', 'landform-layer-group');
      group.append(el('p', 'landform-layer-group-title', groupTitle));
      for (const [key, itemLabel] of items) {
        const subWrapper = el('label', 'landform-checkbox landform-layer-subcheck');
        const subInput = el('input');
        subInput.type = 'checkbox';
        subInput.checked = diagnostics.layers![id][key];
        subInput.setAttribute('aria-label', `${labelText} ${itemLabel}`);
        meshLayerSubInputs.set(`${id}:${key}`, subInput);
        subInput.addEventListener('change', () => {
          try {
            diagnostics.layers![id][key] = subInput.checked;
            render();
          } catch (cause) { shell.showError(cause); }
        }, { signal });
        subWrapper.append(subInput, document.createTextNode(itemLabel));
        group.append(subWrapper);
      }
      groupsContainer.append(group);
    }
    inspectDetails.append(summary, groupsContainer);
    card.append(header, inspectDetails);
    layerStack.append(card);
  }
  {
    const card = el('div', 'landform-layer-card');
    card.dataset.layerCard = 'water';
    const header = el('div', 'landform-layer-header');
    const toggleLabel = el('label', 'landform-checkbox landform-layer-title');
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = diagnostics.layers!.water.visible;
    toggle.setAttribute('aria-label', 'Water layer');
    toggle.addEventListener('change', () => {
      try {
        diagnostics.layers!.water.visible = toggle.checked;
        render();
      } catch (cause) { shell.showError(cause); }
    }, { signal });
    layerVisibilityInputs.set('water', toggle);
    toggleLabel.append(toggle, el('span', '', 'Water'));
    const meta = el('output', 'landform-layer-meta');
    meta.dataset.layerMeta = 'water';
    layerMetaOutputs.set('water', meta);
    const solo = button('Solo', () => {
      diagnostics.layers = soloIslandLayer(diagnostics.layers!, 'water');
      render();
    });
    solo.classList.add('landform-layer-solo');
    solo.setAttribute('aria-label', 'Solo Water');
    layerSoloButtons.set('water', solo);
    header.append(toggleLabel, meta, solo);

    const inspectDetails = el('details', 'landform-layer-details');
    const summary = el('summary', 'landform-layer-summary', 'Inspect water');
    const group = el('div', 'landform-layer-group');
    group.append(el('p', 'landform-layer-group-title', 'Water treatments'),
      el('p', 'landform-help', 'Normal water uses terrain depth, gentle surface ripples, a soft sky sheen and broken beach wash. Earlier streaks and shore ripples remain inspection-only.'));
    const waterItems: readonly [Exclude<keyof IslandWaterLayerInspection, 'visible'>, string][] = [
      ['depthColor', 'Depth color'],
      ['colorPatches', 'Color patches'],
      ['seabedVisibility', 'Seabed visibility'],
      ['surfaceResponse', 'Surface ripples and sheen'],
      ['surfaceHighlights', 'Surface highlights'],
      ['waves', 'Waves'],
      ['shoreFoam', 'Beach wash and foam'],
      ['lighting', 'Lighting / shadows'],
    ];
    for (const [key, itemLabel] of waterItems) {
      const subWrapper = el('label', 'landform-checkbox landform-layer-subcheck');
      const subInput = el('input');
      subInput.type = 'checkbox';
      subInput.checked = diagnostics.layers!.water[key];
      subInput.setAttribute('aria-label', `Water ${itemLabel}`);
      waterLayerSubInputs.set(key, subInput);
      subInput.addEventListener('change', () => {
        try {
          diagnostics.layers!.water[key] = subInput.checked;
          render();
        } catch (cause) { shell.showError(cause); }
      }, { signal });
      subWrapper.append(subInput, document.createTextNode(itemLabel));
      group.append(subWrapper);
    }
    const groupsContainer = el('div', 'landform-layer-groups');
    groupsContainer.append(group);
    inspectDetails.append(summary, groupsContainer);
    card.append(header, inspectDetails);
    layerStack.append(card);
  }
  layerStack.append(resetLayers, el('p', 'landform-help', 'Disconnected mesh layers can be hidden, soloed or inspected independently across seeds without regenerating geometry.'));
  layerControls.append(layerStack);
  shell.toolsContent.append(generation, layerControls, appearanceControls, waterControls, sunControls, diagnosticControls, ascentControls, projectionControls, notes);
  const toolbar = el('div', 'toolbar');
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Island zoom');
  function changeZoom(direction: number): void {
    const current = zoom || Number(canvas.dataset.magnification ?? 1);
    zoom = Math.max(0.5, Math.min(8, direction > 0 ? Math.ceil(current + 0.5) : current - 0.5));
    layout();
  }
  const minus = button('-', () => changeZoom(-1));
  minus.setAttribute('aria-label', 'Zoom out');
  const plus = button('+', () => changeZoom(1));
  plus.setAttribute('aria-label', 'Zoom in');
  toolbar.append(minus, plus, button('Fit', () => {
    focusedAscent = undefined;
    delete canvas.dataset.focusAscent;
    zoom = 0;
    layout();
  }));
  shell.sessionControls.append(toolbar);
  if (signal.aborted) return { destroy() {} };
  generate(seed);
  const observer = new ResizeObserver(layout);
  observer.observe(shell.stage);
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && turning) {
      finishTurn();
      const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
      params.set('view',String(view));
      history.replaceState(null,'',`#/island?${params}`);
    } else if (!document.hidden) {
      try { layout(); } catch (cause) { shell.showError(cause); }
    }
    scheduleWater();
  }, { signal });
  orbitCanvas.addEventListener('webglcontextlost', () => {
    orbitUnavailable('The graphics context was lost.');
    finishTurn();
    try { render(); } catch (cause) { shell.showError(cause); }
  }, { signal });
  frame.addEventListener('scroll', () => { if (orbit && !orbitCanvas.hidden) layout(); else updateOceanBackdrop(); }, { signal, passive: true });
  frame.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      turn(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }, { signal });
  signal.addEventListener('abort', () => {
    clearTimeout(animation);
    cancelAnimationFrame(sunRender);
    cancelAnimationFrame(waterRender);
    cancelAnimationFrame(turnAnimation);
    orbit?.destroy();
  }, { once: true });
  return {
    destroy() {
      observer.disconnect();
      clearTimeout(animation);
      cancelAnimationFrame(sunRender);
      cancelAnimationFrame(waterRender);
      cancelAnimationFrame(turnAnimation);
      orbit?.destroy();
      shell.stage.style.removeProperty('background-color');
    },
    snapshot: () => ({
      seed, projection, view, appearance, animated, sun: { ...sunSettings }, waterSettings: validateWaterSettings(waterSettings),
      ...diagnostics, triangles: island.triangles.length, sourceTriangles: island.sourceTriangleCount,
      heightComposition: [...islandLevelHeights(island.world)],
      conditionEdges, conditionedCorners: island.edges.patches.length, coast: island.coast ? 'procedural' : 'original',
      coastRegions: island.coast?.regions.map(region => ({ ...region })),
      coastStats: island.coastStats,
      coastBudget: island.coastBudget ? { dryWidth: 16, sections: island.coastBudget.sections.length,
        dryCells: island.coastBudget.dryCells.reduce((sum, value) => sum + value, 0),
        restoredCells: island.coastBudget.restoredCells, rejectedProfiles: island.coastBudget.rejectedProfiles } : undefined,
      ascents: island.ascents.map(({ id, kind, stepCount, length, topWidth, bottomWidth, upperHeight, lowerHeight }) =>
        ({ id, kind, stepCount, length, topWidth, bottomWidth, upperHeight, lowerHeight })),
      presentation: canvas.dataset.presentation,
      grass: Number(canvas.dataset.grassCount ?? 0), waterPixels: environmentFrame?.waterPixels,
    }),
  };
}
