import './world-family.css';
import { action, download, el, section, type PilotController, type PilotShell } from './ui';
import { islandJournal } from '../world-family/journal';
import type { Point, World } from '../world-family/core/contracts';
import { generateWorld, generateIslandWorld, makeNavigationFixture, cellAt, terrainAt } from '../world-family/core/world';
import { Navigation } from '../world-family/core/navigation';
import { GameSimulation } from '../world-family/core/game';
import { createGameView, type GameView } from '../world-family/render/game-view';

type WorldMode = 'island' | 'navigation';
const versionSettings = new Map<string, string>();

export async function mountWorldFamily(shell: PilotShell, params: URLSearchParams, mode: WorldMode): Promise<PilotController> {
  const lifecycle = new AbortController();
  const signal = lifecycle.signal;
  let mounted: PilotController | undefined;
  const abort = () => {
    lifecycle.abort();
    mounted?.destroy();
  };
  shell.signal.addEventListener('abort', abort, { once: true });
  if (shell.signal.aborted) abort();
  function destroy(): void {
    lifecycle.abort();
    shell.signal.removeEventListener('abort', abort);
    mounted?.destroy();
    shell.root.classList.remove('p-world-family');
    shell.stage.classList.remove('landform-stage');
    delete shell.root.dataset.worldVersion;
    delete shell.root.dataset.study;
    delete shell.root.dataset.source;
    delete shell.root.dataset.ready;
  }
  shell.root.classList.add('p-world-family');
  try {
    const rawVersion = params.get('version') ?? (params.get('study') === 'landform' ? 'v2' : 'v1');
    if (mode === 'island' && rawVersion !== 'v1' && rawVersion !== 'v2') throw new Error('Unknown island version. Choose version=v1 or version=v2.');
    let provenance: HTMLElement | undefined;
    shell.subject.append(el('h1', '', mode === 'island' ? 'Island Explorer' : 'Navigation Explorer'));
    if (mode === 'island') {
      shell.root.dataset.worldVersion = rawVersion;
      shell.subject.append(el('p', 'p-muted', rawVersion === 'v2' ? 'V2 · Landform rebuild · In review' : 'V1 · Original terrain · Source snapshot'));
      const versionLabel = el('label', 'p-world-version', 'Island version');
      const version = el('select');
      version.setAttribute('aria-label', 'Island version');
      for (const [value, label] of [['v1', 'V1 · Original island'], ['v2', 'V2 · Landform rebuild']]) {
        const option = el('option', '', label);
        option.value = value;
        version.append(option);
      }
      version.value = rawVersion;
      versionLabel.append(version);
      shell.sessionControls.append(versionLabel);
      version.addEventListener('change', () => {
        const current = new URLSearchParams(location.hash.split('?')[1] ?? '');
        versionSettings.set(rawVersion, current.toString());
        const next = new URLSearchParams(versionSettings.get(version.value) ?? params);
        next.set('version', version.value);
        if (version.value === 'v2') next.set('study', 'landform');
        else next.delete('study');
        location.hash = `/island?${next}`;
      }, { signal });
      shell.toolsContent.append(islandJournal());
      provenance = section('Source provenance');
      provenance.append(el('p', 'p-muted', rawVersion === 'v2'
        ? 'Current landform-study source, copied into this pilot. Authored reference and seeded studies are not playable terrain. Surface materials and elevation transitions remain planned.'
        : 'Integrated original terrain algorithms from the October 28 upstream source snapshot. The independently frozen V1 deployment remains available unchanged for archival comparison.'));
      const archive = el('a', 'p-button', 'Open frozen V1 artifact ↗');
      archive.href = `${import.meta.env.BASE_URL}world-family/v1/index.html#/island?seed=${params.get('seed') ?? '42'}&paused=1`;
      archive.target = '_blank';
      archive.rel = 'noopener';
      provenance.append(archive);
    } else {
      shell.subject.append(el('p', 'p-muted', 'Terrain costs, clearance and routes'));
    }
    if (mode === 'island' && rawVersion === 'v2') {
      const { mountLandformStudy } = await import('../world-family/landform-study');
      if (!signal.aborted) mounted = await mountLandformStudy(shell, params, signal);
    } else if (!signal.aborted) {
      mounted = await mountTerrain(shell, params, mode, signal);
    }
    if (provenance && !signal.aborted) shell.toolsContent.append(provenance);
    if (signal.aborted) mounted?.destroy();
    return {
      destroy,
      snapshot: () => mounted?.snapshot?.(),
      worldToScreen: point => mounted?.worldToScreen?.(point) ?? point,
    };
  } catch (cause) {
    destroy();
    throw cause;
  }
}

async function mountTerrain(shell: PilotShell, params: URLSearchParams, mode: WorldMode, signal: AbortSignal): Promise<PilotController> {
  const rawSeed = params.get('seed') ?? '42';
  if (!/^\d{1,6}$/.test(rawSeed)) throw new Error('Seed must be a whole number from 0 to 999999.');
  let seed = Number(rawSeed);
  let navigationFixture = mode === 'navigation' && params.get('fixture') !== 'island';
  let relief = mode === 'island' || (mode === 'navigation' && params.get('relief') === '1');
  let paused = params.get('paused') === '1';
  let inspection = params.get('levels') === '1';
  let navigationOverlay = mode === 'navigation' || params.get('routes') === '1';
  let brush = 'move';
  let hover: Point | null = null;
  let customStatus = '';
  let view: GameView | undefined;
  let destroyed = false;
  const createWorld = (nextSeed: number): World => navigationFixture ? makeNavigationFixture()
    : mode === 'island' ? generateIslandWorld(nextSeed) : generateWorld(nextSeed, { relief });
  let world = createWorld(seed);
  let simulation = new GameSimulation(world, new Navigation(world), { foraging: false, autoSelect: true });
  const currentSeed = el('output', 'p-current-seed');
  const primary = action(navigationFixture ? 'Reset fixture' : 'Generate', () => {
    regenerate(navigationFixture ? seed : crypto.getRandomValues(new Uint32Array(1))[0] % 1000000);
  }, signal, 'p-primary');
  primary.dataset.action = 'generate-world';
  shell.primary.append(primary, currentSeed);
  const source = el('p', 'p-muted');
  const status = el('output', 'p-world-status');
  status.setAttribute('aria-label', 'Terrain details');
  status.setAttribute('aria-live', 'off');
  const sessionReadout = el('output', 'p-world-status');
  sessionReadout.setAttribute('aria-label', 'Navigation session');
  function guarded(run: () => void): void {
    try { run(); } catch (cause) { shell.showError(cause); }
  }
  function button(label: string, run: () => void, className = ''): HTMLButtonElement {
    return action(label, () => guarded(run), signal, className);
  }
  function syncUrl(): void {
    const next = new URLSearchParams({ seed: String(seed) });
    if (mode === 'island') next.set('version', 'v1');
    if (mode === 'navigation') {
      next.set('fixture', navigationFixture ? 'test' : 'island');
      if (relief) next.set('relief', '1');
    }
    if (paused) next.set('paused', '1');
    if (inspection) next.set('levels', '1');
    if (navigationOverlay) next.set('routes', '1');
    history.replaceState(null, '', `#/${mode}?${next}`);
  }
  function refresh(): void {
    let message = customStatus || simulation.feedback || simulation.activity || 'Click a destination to inspect its route.';
    if (hover) {
      const cell = cellAt(world, hover);
      if (cell.x >= 0 && cell.y >= 0 && cell.x < world.width && cell.y < world.height) {
        const index = cell.y * world.width + cell.x;
        const level = world.elevations?.[index] ?? 0;
        const ramp = (world.rampIds?.[index] ?? -1) >= 0 ? ' · ramp' : '';
        message = `${terrainAt(world, cell)} · ${['low', 'middle', 'high'][level] ?? level} · ${simulation.navigation.speedAt(hover) > 0 ? 'walkable' : 'blocked'}${ramp}`;
      }
    }
    if (status.textContent !== message) status.textContent = message;
    const position = simulation.character.position;
    const readout = `${simulation.elapsed.toFixed(1)} s · Position ${position.x.toFixed(1)}, ${position.y.toFixed(1)} · ${Math.max(0, simulation.character.route.length - simulation.character.routeIndex)} waypoints`;
    if (sessionReadout.textContent !== readout) sessionReadout.textContent = readout;
    currentSeed.textContent = navigationFixture ? 'Editable fixed test map · no generator' : `Seed ${seed} · ${world.generatorVersion}`;
    source.textContent = world.provenance === 'test-fixture' ? 'Editable navigation fixture'
      : world.provenance === 'captured-reference' ? `Terrain reference · seed ${world.seed}`
        : `Browser generator ${world.generatorVersion} · seed ${world.seed}`;
  }
  function replaceSimulation(nextWorld: World): void {
    const next = new GameSimulation(nextWorld, new Navigation(nextWorld), { foraging: false, autoSelect: true });
    view?.setSimulation(next);
    world = nextWorld;
    simulation = next;
    levels.disabled = !world.elevations?.length;
    levels.title = levels.disabled ? 'This fixture has no elevation.' : 'Inspect land elevations and ramps.';
    view?.setInspection(inspection);
    view?.setNavigationOverlay(navigationOverlay);
    customStatus = '';
    hover = null;
    refresh();
  }
  function regenerate(nextSeed: number): void {
    guarded(() => {
      replaceSimulation(createWorld(nextSeed));
      seed = nextSeed;
      seedInput.value = String(seed);
      primary.textContent = navigationFixture ? 'Reset fixture' : 'Generate';
      seedForm.hidden = navigationFixture;
      tools.disabled = !navigationFixture;
      refresh();
      syncUrl();
      shell.status(navigationFixture ? 'Navigation fixture reset.' : `Generated seed ${seed}.`);
    });
  }
  // This is the original navigation fixture edit algorithm, including clearance
  // protection, copied cell arrays, and re-routing from the old character position.
  function paint(point: Point): void {
    const cell = cellAt(world, point);
    if (cell.x < 0 || cell.y < 0 || cell.x >= world.width || cell.y >= world.height) return;
    const index = cell.y * world.width + cell.x;
    const characterCell = cellAt(world, simulation.character.position);
    if (Math.abs(cell.x - characterCell.x) <= 1 && Math.abs(cell.y - characterCell.y) <= 1) {
      customStatus = 'Paint away from the character to keep its clearance.';
      refresh();
      return;
    }
    const nextWorld: World = {
      ...world,
      provenance: 'test-fixture',
      heights: world.heights.slice(),
      cells: world.cells.slice(),
      elevations: world.elevations?.slice(),
      cliffCells: world.cliffCells?.slice(),
      rampIds: world.rampIds?.slice(),
    };
    nextWorld.heights[index] = brush === 'block' ? -0.7 : brush === 'shallow' ? -0.1 : 0.08;
    nextWorld.cells[index] = brush === 'block' || brush === 'shallow' ? 0 : 1;
    if (nextWorld.elevations) nextWorld.elevations[index] = 0;
    if (nextWorld.cliffCells) nextWorld.cliffCells[index] = 0;
    if (nextWorld.rampIds) nextWorld.rampIds[index] = -1;
    const oldPosition = { ...simulation.character.position };
    const target = simulation.character.route.at(-1);
    replaceSimulation(nextWorld);
    if (simulation.navigation.speedAt(oldPosition) > 0 && simulation.navigation.segmentClear(oldPosition, oldPosition)) {
      simulation.character.position = oldPosition;
      if (target) simulation.moveTo(target);
    }
    customStatus = 'Terrain updated. Click Move to try a route.';
    refresh();
    shell.status(customStatus);
  }
  const seedSection = section('Seed');
  const seedForm = el('form', 'p-world-seed');
  seedForm.setAttribute('aria-label', 'Choose island seed');
  const seedLabel = el('label', '', 'Island seed');
  const seedInput = el('input');
  seedInput.type = 'number';
  seedInput.min = '0';
  seedInput.max = '999999';
  seedInput.step = '1';
  seedInput.required = true;
  seedInput.value = String(seed);
  seedLabel.append(seedInput);
  const apply = el('button', 'p-button', 'Use seed');
  apply.type = 'submit';
  seedForm.append(seedLabel, apply);
  seedForm.hidden = navigationFixture;
  seedForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!/^\d{1,6}$/.test(seedInput.value)) {
      shell.showError(new Error('Enter a whole-number seed from 0 to 999999. The current island has not changed.'));
      return;
    }
    regenerate(Number(seedInput.value));
  }, { signal });
  seedSection.append(seedForm, source);
  shell.toolsContent.append(seedSection);
  const tools = el('select');
  tools.setAttribute('aria-label', 'Terrain tool');
  for (const [value, label] of [['move', 'Move'], ['block', 'Paint blocked water'], ['shallow', 'Paint slow shallows'], ['sand', 'Paint walkable sand']]) {
    const option = el('option', '', label);
    option.value = value;
    tools.append(option);
  }
  tools.disabled = !navigationFixture;
  tools.addEventListener('change', () => {
    brush = tools.value;
    customStatus = brush === 'move' ? 'Click a destination to see its route.' : 'Click a cell to mark terrain.';
    refresh();
    shell.status(customStatus);
  }, { signal });
  if (mode === 'navigation') {
    const controls = section('Terrain and routes');
    const fixtureLabel = el('label', '', 'Navigation world');
    const fixtures = el('select');
    fixtures.setAttribute('aria-label', 'Navigation world');
    for (const [value, label] of [['test', 'Editable test map'], ['island', 'Island coastline'], ['relief', 'Island with elevation']]) {
      const option = el('option', '', label);
      option.value = value;
      fixtures.append(option);
    }
    fixtures.value = navigationFixture ? 'test' : relief ? 'relief' : 'island';
    fixtures.addEventListener('change', () => {
      navigationFixture = fixtures.value === 'test';
      relief = fixtures.value === 'relief';
      brush = 'move';
      tools.value = brush;
      regenerate(seed);
    }, { signal });
    fixtureLabel.append(fixtures);
    const toolLabel = el('label', '', 'Terrain tool');
    toolLabel.append(tools);
    controls.append(fixtureLabel, toolLabel, el('p', 'p-muted', 'Move around the test map or paint terrain. Sand is normal speed; shallows are 45%. Deep water blocks movement.'));
    shell.toolsContent.prepend(controls);
    const explanation = section('Not just a line');
    explanation.append(el('p', 'p-muted', 'Routes respect terrain costs, clearance and cliff edges. The character follows the shared movement system.'));
    shell.toolsContent.append(explanation);
  }
  const display = section('View');
  const overlayRow = el('div', 'p-choices');
  const levels = button('Levels', () => {
    inspection = !inspection;
    levels.setAttribute('aria-pressed', String(inspection));
    view?.setInspection(inspection);
    syncUrl();
  });
  levels.setAttribute('aria-pressed', String(inspection));
  levels.disabled = !world.elevations?.length;
  const routes = button('Routes', () => {
    navigationOverlay = !navigationOverlay;
    routes.setAttribute('aria-pressed', String(navigationOverlay));
    view?.setNavigationOverlay(navigationOverlay);
    syncUrl();
  });
  routes.setAttribute('aria-pressed', String(navigationOverlay));
  overlayRow.append(levels, routes);
  const zoomRow = el('div', 'p-choices');
  zoomRow.setAttribute('aria-label', 'Scene zoom');
  zoomRow.append(button('−', () => view?.zoomBy(1 / 1.5)), button('+', () => view?.zoomBy(1.5)), button('Fit', () => view?.fit()));
  zoomRow.children[0].setAttribute('aria-label', 'Zoom out');
  zoomRow.children[1].setAttribute('aria-label', 'Zoom in');
  const pause = button(paused ? 'Resume' : 'Pause', () => {
    paused = !paused;
    pause.textContent = paused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
    view?.setPaused(paused);
    syncUrl();
  });
  pause.setAttribute('aria-pressed', String(paused));
  const playback = el('div', 'p-choices');
  playback.append(pause, button('Reset', () => regenerate(seed)));
  display.append(overlayRow, zoomRow, playback, status);
  shell.sessionControls.append(display);
  const session = section('This session');
  session.append(sessionReadout, el('p', 'p-muted', 'Reset starts this fixture again. Explorers do not change the game or one another.'));
  session.append(button('Download recipe', () => download(`${mode}-${seed}.json`, JSON.stringify({
    mode, seed, version: mode === 'island' ? 'v1' : undefined, navigationFixture, relief,
    paused, inspection, navigationOverlay, world: {
      ...world, heights: Array.from(world.heights), cells: Array.from(world.cells),
      elevations: world.elevations && Array.from(world.elevations),
      cliffCells: world.cliffCells && Array.from(world.cliffCells),
      rampIds: world.rampIds && Array.from(world.rampIds),
    },
  }, null, 2))));
  shell.toolsContent.append(session);
  const loading = el('div', 'p-loading', 'Opening terrain…');
  loading.setAttribute('role', 'status');
  shell.stage.append(loading);
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    view?.destroy();
    loading.remove();
  };
  signal.addEventListener('abort', destroy, { once: true });
  shell.stage.addEventListener('wheel', event => {
    event.preventDefault();
    if (event.deltaY !== 0) guarded(() => view?.zoomBy(event.deltaY < 0 ? 1.5 : 1 / 1.5));
  }, { signal, passive: false });
  window.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey
      || (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, button, summary, a'))) return;
    guarded(() => {
      if (event.key.toLowerCase() === 'r') regenerate(navigationFixture ? seed : (seed + 7919) % 1000000);
      else if (event.key.toLowerCase() === 'f') view?.fit();
      else if (event.key === '+' || event.key === '=') view?.zoomBy(1.5);
      else if (event.key === '-') view?.zoomBy(1 / 1.5);
      else return;
      event.preventDefault();
    });
  }, { signal });
  try {
    view = await createGameView(shell.stage, {
      mode, simulation,
      onGroundClick: (point, pointer) => guarded(() => {
        if (pointer.button !== 0) return;
        customStatus = '';
        if (mode === 'navigation' && brush !== 'move') paint(point);
        else simulation.click(point, view!.getCameraState().zoom);
        refresh();
        shell.status(simulation.feedback || `Route has ${simulation.character.route.length} waypoints.`);
      }),
      onHover: point => { hover = point; },
      onFrame: refresh,
      onError: cause => { if (!signal.aborted) shell.showError(cause); },
    });
    if (signal.aborted) {
      view.destroy();
      return { destroy };
    }
    loading.remove();
    view.setPaused(paused);
    view.setInspection(inspection);
    view.setNavigationOverlay(navigationOverlay);
    refresh();
    syncUrl();
  } catch (cause) {
    destroy();
    throw cause;
  }
  return {
    destroy,
    worldToScreen: point => view!.worldToScreen(point),
    snapshot: () => ({
      mode, version: mode === 'island' ? 'v1' : undefined, seed, navigationFixture, relief,
      paused, inspection, navigationOverlay, brush, world,
      character: { ...simulation.character, position: { ...simulation.character.position }, route: simulation.character.route.map(point => ({ ...point })) },
      elapsed: simulation.elapsed, feedback: simulation.feedback,
    }),
  };
}
