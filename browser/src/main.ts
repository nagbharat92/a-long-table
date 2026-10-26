import './styles.css';
import './debug';
import { destinations, destinationById } from './destinations';
import type { CharacterMode, DestinationId, Point, World } from './core/contracts';
import type { GameView } from './render/game-view';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('The application mount is missing.');
const root = app;
const base = import.meta.env.BASE_URL;
let activeView: GameView | undefined;
let routeController = new AbortController();
let routeRevision = 0;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function listen(
  target: EventTarget,
  type: string,
  callback: EventListener,
  options: AddEventListenerOptions = {},
): void {
  target.addEventListener(type, callback, { ...options, signal: routeController.signal });
}

function button(label: string, action: () => void, attributes: Record<string, string> = {}): HTMLButtonElement {
  const node = element('button', { type: 'button', ...attributes }, label);
  listen(node, 'click', action);
  return node;
}

function preview(id: DestinationId, alt: string): HTMLImageElement {
  return element('img', {
    class: 'preview',
    src: `${base}previews/${id}.png`,
    alt,
    width: '640',
    height: '360',
    loading: id === 'play' ? 'eager' : 'lazy',
  });
}

function renderHome(): void {
  document.title = 'a long table';
  const home = element('main', { class: 'home' });
  const heading = element('header', { class: 'home-heading' });
  const intro = element('div');
  intro.append(
    element('div', { class: 'eyebrow' }, 'A small world, in progress'),
    element('h1', {}, 'a long table'),
    element('p', {}, 'Play a little. Try an idea. Find out what happens.'),
  );
  heading.append(intro, element('div', { class: 'build-note' }, 'Browser edition'));
  const featured = element('section', { class: 'play-card', 'aria-label': 'Main gameplay' });
  const copy = element('div', { class: 'play-copy' });
  copy.append(
    element('div', { class: 'eyebrow' }, 'The game'),
    element('h2', {}, 'An island to begin with.'),
    element('p', {}, destinations[0].description),
    element('a', { class: 'button primary', href: '#/play' }, 'Play'),
  );
  featured.append(preview('play', 'The current island and its small rabbit character'), copy);
  const sectionHeading = element('div', { class: 'section-heading' });
  sectionHeading.append(
    element('h2', {}, 'The explorers'),
    element('p', {}, 'Small places to try things. The same systems as the game.'),
  );
  const grid = element('nav', { class: 'explorer-grid', 'aria-label': 'Explorers' });
  for (const destination of destinations.slice(1)) {
    const card = element('a', { class: 'explorer-card', href: `#/${destination.id}` });
    const body = element('div', { class: 'explorer-copy' });
    body.append(
      element('h3', {}, destination.title),
      element('p', {}, destination.description),
      element('span', { class: 'card-meta' }, destination.experimental ? 'Experimental' : 'Shared with gameplay'),
    );
    card.append(preview(destination.id, `${destination.title} preview`), body);
    grid.append(card);
  }
  const footer = element('footer', { class: 'home-footer' });
  footer.append(
    element('span', {}, 'One world. A few ways to look at it.'),
    element('span', {}, 'Open an explorer in another tab to work side by side.'),
  );
  home.append(heading, featured, sectionHeading, grid, footer);
  root.replaceChildren(home);
}

function describeSource(world: World): string {
  if (world.provenance === 'captured-reference') return `Terrain reference · seed ${world.seed}`;
  if (world.provenance === 'test-fixture') return 'Editable navigation fixture';
  return `Browser generator ${world.generatorVersion} · seed ${world.seed}`;
}

async function renderRuntime(mode: DestinationId, parameters: URLSearchParams, revision: number): Promise<void> {
  const entry = destinationById(mode);
  if (!entry) throw new Error(`Unknown destination: ${mode}`);
  const destination = entry;
  document.title = `${destination.title} · a long table`;
  const runtime = element('main', { class: 'runtime', 'data-mode': mode });
  const header = element('header', { class: 'runtime-header' });
  const berries = element('output', { class: 'berries', 'aria-label': 'Berries' }, 'Berries 0');
  header.append(
    element('a', { class: 'button', href: '#/', 'aria-label': 'Home', title: 'Return home. This session is not saved.' }, 'Home'),
    element('h1', {}, mode === 'play' ? 'a long table' : destination.title),
  );
  if (mode === 'play' || mode === 'foraging') header.append(berries);
  else header.append(element('span', { class: 'brand' }, 'a long table'));
  const error = element('div', { class: 'error-banner', role: 'alert', hidden: '' });
  const toolbar = element('div', { class: 'toolbar', 'aria-label': 'Explorer controls' });
  const body = element('div', { class: 'runtime-body' });
  const stage = element('div', { class: 'stage', 'aria-label': `${destination.title} canvas` });
  const loading = element('div', { class: 'stage-loading', role: 'status' }, 'Opening the island…');
  stage.append(loading);
  const inspector = element('aside', { class: 'inspector', 'aria-label': 'Inspector' });
  if (mode === 'play') inspector.hidden = true;
  body.append(stage, inspector);
  const footer = element('footer', { class: 'runtime-footer' });
  const status = element('output', { 'aria-live': 'polite', role: 'status' }, destination.detail);
  const provenance = element('span', { class: 'provenance' });
  footer.append(status, provenance);
  runtime.append(header, error, toolbar, body, footer);
  root.replaceChildren(runtime);

  function showError(cause: unknown): void {
    const message = cause instanceof Error ? cause.message : String(cause);
    error.textContent = message;
    error.hidden = false;
    console.error('[a long table]', cause);
  }

  try {
    const [{ generateWorld, makeNavigationFixture, cellAt, terrainAt }, { Navigation }, { GameSimulation }, { createGameView }] =
      await Promise.all([
        import('./core/world'),
        import('./core/navigation'),
        import('./core/game'),
        import('./render/game-view'),
      ]);
    if (revision !== routeRevision) return;
    const rawSeed = parameters.get('seed') ?? '42';
    const initialSeed = Number(rawSeed);
    if (!/^\d{1,6}$/.test(rawSeed) || !Number.isSafeInteger(initialSeed)) {
      throw new Error('Seed must be a whole number from 0 to 999999. Change the URL or return Home.');
    }
    let seed = initialSeed;
    let navigationFixture = mode === 'navigation' && parameters.get('fixture') !== 'island';
    let relief = mode === 'island' || (mode === 'navigation' && parameters.get('relief') === '1');
    let world = navigationFixture ? makeNavigationFixture() : generateWorld(seed, { relief });
    let simulation = new GameSimulation(world, new Navigation(world), {
      foraging: mode === 'play' || mode === 'foraging',
      autoSelect: mode !== 'play',
    });
    let view: GameView;
    let paused = parameters.get('paused') === '1';
    let inspection = parameters.get('levels') === '1';
    let navigationOverlay = mode === 'navigation';
    let characterMode: CharacterMode = 'hop';
    let brush = 'move';
    let hover: Point | null = null;
    let selectedBush = '';
    let customStatus = '';
    let lastStatus = '';
    let bushSelect: HTMLSelectElement | undefined;
    let stateOutput: HTMLElement | undefined;
    let clockOutput: HTMLElement | undefined;
    let selectedOutput: HTMLElement | undefined;
    let generationOutput: HTMLElement | undefined;
    let positionOutput: HTMLElement | undefined;
    let routeOutput: HTMLElement | undefined;
    let levelsButton: HTMLButtonElement | undefined;

    const updateUrl = (): void => {
      const next = new URLSearchParams();
      if (mode !== 'character') next.set('seed', String(seed));
      if (mode === 'navigation') {
        next.set('fixture', navigationFixture ? 'test' : 'island');
        if (relief) next.set('relief', '1');
      }
      if (inspection) next.set('levels', '1');
      if (paused) next.set('paused', '1');
      const query = next.toString();
      history.replaceState(null, '', `#/${mode}${query ? `?${query}` : ''}`);
    };

    const syncDebug = (): void => {
      if (import.meta.env.DEV) window.__longTable = { ready: true, mode, world, simulation, view };
    };

    function refreshBushChoices(): void {
      if (!bushSelect) return;
      bushSelect.replaceChildren();
      for (const [index, bush] of simulation.bushes.entries()) {
        bushSelect.append(element('option', { value: bush.id }, `Bush ${index + 1}`));
      }
      if (!simulation.bushes.some((bush) => bush.id === selectedBush)) selectedBush = simulation.bushes[0]?.id ?? '';
      bushSelect.value = selectedBush;
      bushSelect.disabled = simulation.bushes.length === 0;
    }

    function updateReadouts(): void {
      const berryText = `Berries ${simulation.berries}`;
      if (berries.value !== berryText) berries.value = berryText;
      updateText(provenance, describeSource(world));
      if (generationOutput) updateText(generationOutput, world.generatorVersion);
      if (positionOutput) updateText(positionOutput, `${simulation.character.position.x.toFixed(1)}, ${simulation.character.position.y.toFixed(1)}`);
      if (routeOutput) updateText(routeOutput, String(Math.max(0, simulation.character.route.length - simulation.character.routeIndex)));
      if (selectedOutput) updateText(selectedOutput, simulation.character.selected ? 'Selected' : 'Not selected');
      if (clockOutput) updateText(clockOutput, `${(mode === 'character' ? simulation.character.animationTime : simulation.elapsed).toFixed(1)} s`);
      if (stateOutput) {
        const bush = simulation.bushes.find((candidate) => candidate.id === selectedBush);
        updateText(stateOutput, bush ? `${bush.state} · ${bush.regrowElapsed.toFixed(1)} / 20 s` : 'No bushes on this island');
      }
      let message = customStatus || simulation.feedback || simulation.activity || destination.detail;
      if (hover && (mode === 'island' || mode === 'navigation')) {
        const cell = cellAt(world, hover);
        if (cell.x >= 0 && cell.y >= 0 && cell.x < world.width && cell.y < world.height) {
          const index = cell.y * world.width + cell.x;
          const level = world.elevations?.[index] ?? 0;
          const ramp = (world.rampIds?.[index] ?? -1) >= 0 ? ' · ramp' : '';
          const walkable = simulation.navigation.speedAt(hover) > 0 ? 'walkable' : 'blocked';
          message = `${terrainAt(world, cell)} · ${['low', 'middle', 'high'][level] ?? level} · ${walkable}${ramp}`;
        }
      }
      if (message !== lastStatus) {
        status.value = message;
        lastStatus = message;
      }
    }

    function replaceSimulation(nextWorld: World): void {
      const next = new GameSimulation(nextWorld, new Navigation(nextWorld), {
        foraging: mode === 'play' || mode === 'foraging',
        autoSelect: mode !== 'play',
      });
      view.setSimulation(next);
      world = nextWorld;
      simulation = next;
      if (levelsButton) {
        levelsButton.disabled = !world.elevations?.length;
        levelsButton.title = levelsButton.disabled ? 'This fixture has no elevation.' : 'Inspect land elevations and ramps.';
      }
      view.setInspection(inspection);
      view.setNavigationOverlay(navigationOverlay);
      if (mode === 'character') view.setCharacterMode(characterMode);
      customStatus = '';
      error.hidden = true;
      hover = null;
      refreshBushChoices();
      updateReadouts();
      syncDebug();
    }

    function regenerate(nextSeed: number): void {
      try {
        const nextWorld = navigationFixture ? makeNavigationFixture() : generateWorld(nextSeed, { relief });
        replaceSimulation(nextWorld);
        seed = nextSeed;
        seedInput.value = String(seed);
        updateUrl();
      } catch (cause) {
        showError(cause);
      }
    }

    function paint(point: Point): void {
      const cell = cellAt(world, point);
      if (cell.x < 0 || cell.y < 0 || cell.x >= world.width || cell.y >= world.height) return;
      const index = cell.y * world.width + cell.x;
      const characterCell = cellAt(world, simulation.character.position);
      if (Math.abs(cell.x - characterCell.x) <= 1 && Math.abs(cell.y - characterCell.y) <= 1) {
        customStatus = 'Paint away from the character to keep its clearance.';
        updateReadouts();
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
      updateReadouts();
    }

    view = await createGameView(stage, {
      mode,
      simulation,
      onGroundClick: (point, pointer) => {
        try {
          if (pointer.button !== 0) return;
          customStatus = '';
          if (mode === 'character') return;
          if (mode === 'navigation' && brush !== 'move') paint(point);
          else {
            const bush = simulation.bushAt(point, view.getCameraState().zoom);
            if (bush) {
              selectedBush = bush.id;
              if (bushSelect) bushSelect.value = selectedBush;
            }
            simulation.click(point, view.getCameraState().zoom);
          }
          updateReadouts();
        } catch (cause) {
          showError(cause);
        }
      },
      onHover: (point) => {
        hover = point;
        if (point) {
          const bush = simulation.bushAt(point, view.getCameraState().zoom);
          for (const candidate of simulation.bushes) candidate.hovered = candidate === bush;
        } else {
          for (const candidate of simulation.bushes) candidate.hovered = false;
        }
      },
      onFrame: updateReadouts,
      onError: showError,
    });
    if (revision !== routeRevision) {
      view.destroy();
      return;
    }
    activeView = view;
    loading.remove();
    view.setPaused(paused);
    view.setInspection(inspection);
    view.setNavigationOverlay(navigationOverlay);
    if (mode === 'character') view.setCharacterMode(characterMode);

    const seedForm = element('form', { 'aria-label': 'Choose island seed', novalidate: '' });
    const seedInput = element('input', {
      id: 'seed',
      type: 'number',
      min: '0',
      max: '999999',
      step: '1',
      value: String(seed),
      required: '',
      'aria-label': 'Seed',
    });
    const newIsland = button('New island', () => regenerate(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000), {
      'aria-label': 'Generate a new island',
    });
    seedForm.append(element('label', { for: 'seed' }, 'Seed'), seedInput, element('button', { type: 'submit' }, 'Go'));
    listen(seedForm, 'submit', (event) => {
      event.preventDefault();
      const value = Number(seedInput.value);
      if (!/^\d{1,6}$/.test(seedInput.value) || !Number.isInteger(value) || value < 0 || value > 999999) {
        showError(new Error('Enter a whole-number seed from 0 to 999999. The current island has not changed.'));
        return;
      }
      regenerate(value);
    });
    if (mode !== 'character') {
      seedForm.hidden = navigationFixture;
      newIsland.hidden = navigationFixture;
      toolbar.append(seedForm, newIsland);
      toolbar.append(element('span', { class: 'divider', 'aria-hidden': 'true' }));
    }
    toolbar.append(
      button('-', () => view.zoomBy(1 / 1.5), { 'aria-label': 'Zoom out' }),
      button('+', () => view.zoomBy(1.5), { 'aria-label': 'Zoom in' }),
      button('Fit', () => view.fit(), { 'aria-label': 'Fit view' }),
    );
    if (mode === 'island' || mode === 'navigation') {
      const levels = button('Levels', () => {
        inspection = !inspection;
        levels.setAttribute('aria-pressed', String(inspection));
        view.setInspection(inspection);
        updateUrl();
      }, { 'aria-pressed': String(inspection) });
      levelsButton = levels;
      levels.disabled = !world.elevations?.length;
      levels.title = levels.disabled ? 'This fixture has no elevation.' : 'Inspect land elevations and ramps.';
      const paths = button('Walkability', () => {
        navigationOverlay = !navigationOverlay;
        paths.setAttribute('aria-pressed', String(navigationOverlay));
        view.setNavigationOverlay(navigationOverlay);
      }, { 'aria-pressed': String(navigationOverlay) });
      toolbar.append(levels, paths);
    }
    if (mode !== 'play') {
      toolbar.append(element('span', { class: 'spacer' }));
      const pause = button(paused ? 'Resume' : 'Pause', () => {
        paused = !paused;
        pause.textContent = paused ? 'Resume' : 'Pause';
        pause.setAttribute('aria-pressed', String(paused));
        view.setPaused(paused);
        updateUrl();
      }, { 'aria-pressed': String(paused) });
      toolbar.append(
        pause,
        button('Reset', () => regenerate(seed), { 'aria-label': 'Reset this explorer' }),
      );
    }

    function section(title: string, description: string): HTMLElement {
      const node = element('section');
      node.append(element('h2', {}, title), element('p', {}, description));
      inspector.append(node);
      return node;
    }
    function readout(list: HTMLElement, title: string, initial = '0'): HTMLElement {
      const output = element('dd', {}, initial);
      list.append(element('dt', {}, title), output);
      return output;
    }
    if (mode === 'character') {
      const controls = section('A closer look', 'The original 18 x 29 sprite. The same distance-driven motion as the game.');
      const modes = element('div', { class: 'stack', role: 'group', 'aria-label': 'Character motion' });
      const modeButtons = new Map<CharacterMode, HTMLButtonElement>();
      for (const [value, label] of [['idle', 'Idle'], ['hop', 'Hop'], ['shallows', 'Shallows']] as const) {
        const control = button(label, () => {
          characterMode = value;
          view.setCharacterMode(value);
          for (const [key, candidate] of modeButtons) candidate.setAttribute('aria-pressed', String(key === value));
        }, { 'aria-pressed': String(characterMode === value) });
        modeButtons.set(value, control);
        modes.append(control);
      }
      controls.append(modes);
      const details = section('Motion notes', 'Hopping lifts the artwork, not the ground position. Shallows slow the stride to 45%.');
      const list = element('dl');
      readout(list, 'Source', '18 x 29 px');
      readout(list, 'World height', '12 units');
      readout(list, 'Stride', '9 units');
      details.append(list);
    } else if (mode === 'foraging') {
      const controls = section('A berry patch', 'Choose a bush, then gather or inspect its growth state. Ground clicks cancel gathering.');
      bushSelect = element('select', { 'aria-label': 'Bush' });
      listen(bushSelect, 'change', () => {
        selectedBush = bushSelect?.value ?? '';
        updateReadouts();
      });
      const actions = element('div', { class: 'stack' });
      actions.append(bushSelect, button('Gather selected bush', () => {
        simulation.select(true);
        simulation.gather(selectedBush);
        updateReadouts();
      }, { class: 'primary' }));
      const states = element('div', { class: 'row', role: 'group', 'aria-label': 'Set bush state' });
      for (const [phase, label] of [['ripe', 'Ripe'], ['depleted', 'Depleted'], ['growing', 'Growing']] as const) {
        states.append(button(label, () => {
          if (!selectedBush) return;
          simulation.setBushState(selectedBush, phase);
          updateReadouts();
        }));
      }
      actions.append(states);
      controls.append(actions);
      const stats = section('Shared gathering rules', '0.8 seconds to gather. 3 berries. 20 seconds to grow again.');
      stateOutput = element('p', { 'data-testid': 'bush-state' });
      stats.append(stateOutput);
      refreshBushChoices();
    } else if (mode === 'navigation') {
      const controls = section('Terrain and routes', 'Move around the test map or paint terrain. Sand is normal speed; shallows are 45%. Deep water blocks movement.');
      const fixtures = element('select', { 'aria-label': 'Navigation world' });
      fixtures.append(
        element('option', { value: 'test' }, 'Editable test map'),
        element('option', { value: 'island' }, 'Island coastline'),
        element('option', { value: 'relief' }, 'Island with elevation'),
      );
      fixtures.value = navigationFixture ? 'test' : relief ? 'relief' : 'island';
      listen(fixtures, 'change', () => {
        navigationFixture = fixtures.value === 'test';
        relief = fixtures.value === 'relief';
        seedForm.hidden = navigationFixture;
        newIsland.hidden = navigationFixture;
        tools.disabled = !navigationFixture;
        brush = 'move';
        tools.value = brush;
        regenerate(seed);
      });
      const tools = element('select', { 'aria-label': 'Terrain tool' });
      tools.append(
        element('option', { value: 'move' }, 'Move'),
        element('option', { value: 'block' }, 'Paint blocked water'),
        element('option', { value: 'shallow' }, 'Paint slow shallows'),
        element('option', { value: 'sand' }, 'Paint walkable sand'),
      );
      tools.disabled = !navigationFixture;
      listen(tools, 'change', () => {
        brush = tools.value;
        customStatus = brush === 'move' ? 'Click a destination to see its route.' : 'Click a cell to mark terrain.';
        updateReadouts();
      });
      const stack = element('div', { class: 'stack' });
      stack.append(fixtures, tools);
      controls.append(stack);
      section('Not just a line', 'Routes respect terrain costs, clearance and cliff edges. The character follows the shared movement system.');
    } else if (mode === 'island') {
      section('Highs and lows', 'Three land elevations, connected by natural ramps. Beaches stay low. Cliff faces block movement.');
      section('Explore, then approve', 'This relief remains an experiment. Opening it here does not add it to main gameplay.');
    }
    if (mode !== 'play') {
      const stats = section('This session', 'Reset starts this fixture again. Explorers do not change the game or one another.');
      const list = element('dl');
      clockOutput = readout(list, 'Simulation');
      if (mode !== 'character') {
        positionOutput = readout(list, 'Position');
        routeOutput = readout(list, 'Waypoints');
        selectedOutput = readout(list, 'Character');
        generationOutput = readout(list, 'Generator');
      }
      stats.append(list);
    }

    listen(stage, 'wheel', (event) => {
      const wheel = event as WheelEvent;
      wheel.preventDefault();
      if (wheel.deltaY !== 0) view.zoomBy(wheel.deltaY < 0 ? 1.5 : 1 / 1.5);
    }, { passive: false });
    listen(window, 'keydown', (event) => {
      const key = event as KeyboardEvent;
      if (key.target instanceof HTMLElement && key.target.closest('input, select, textarea, button')) return;
      if (key.ctrlKey || key.metaKey || key.altKey) return;
      if (key.key.toLowerCase() === 'r') regenerate(navigationFixture || mode === 'character' ? seed : (seed + 7919) % 1000000);
      else if (key.key.toLowerCase() === 'f') view.fit();
      else if (key.key === '+' || key.key === '=') view.zoomBy(1.5);
      else if (key.key === '-') view.zoomBy(1 / 1.5);
      else return;
      key.preventDefault();
    });
    updateReadouts();
    syncDebug();
  } catch (cause) {
    if (revision !== routeRevision) return;
    loading.remove();
    showError(cause);
    status.value = 'This destination could not open. Return Home or try a different seed.';
  }
}

async function route(): Promise<void> {
  const revision = ++routeRevision;
  routeController.abort();
  routeController = new AbortController();
  activeView?.destroy();
  activeView = undefined;
  delete window.__longTable;
  const hash = location.hash.replace(/^#\/?/, '');
  const separator = hash.indexOf('?');
  const id = separator < 0 ? hash : hash.slice(0, separator);
  const parameters = new URLSearchParams(separator < 0 ? '' : hash.slice(separator + 1));
  if (!id) {
    renderHome();
    return;
  }
  const destination = destinationById(id);
  if (!destination) {
    const content = element('main', { class: 'empty' });
    content.append(
      element('h1', {}, 'That explorer does not exist.'),
      element('p', { class: 'muted' }, 'Use the home screen to open a game or explorer.'),
      element('a', { class: 'button', href: '#/' }, 'Home'),
    );
    root.replaceChildren(content);
    return;
  }
  await renderRuntime(destination.id, parameters, revision);
}

const onHashChange = (): void => { void route(); };
const onPageHide = (): void => { activeView?.destroy(); };
window.addEventListener('hashchange', onHashChange);
window.addEventListener('pagehide', onPageHide);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    routeController.abort();
    activeView?.destroy();
    window.removeEventListener('hashchange', onHashChange);
    window.removeEventListener('pagehide', onPageHide);
  });
}
void route();
