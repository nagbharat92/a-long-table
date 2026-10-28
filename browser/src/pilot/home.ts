import { GameSimulation } from '../core/game';
import { Navigation } from '../core/navigation';
import { generateWorld } from '../core/world';
import { createGameView, type GameView } from '../render/game-view';
import { explorers } from './directory';
import { action, choices, el, section, slider, type PilotController, type PilotShell } from './ui';

async function backdrop(shell: PilotShell): Promise<{ view: GameView; simulation: GameSimulation }> {
  const world = generateWorld(42);
  const simulation = new GameSimulation(world, new Navigation(world), { foraging: true, autoSelect: false });
  const view = await createGameView(shell.stage, { mode: 'play', simulation, onError: shell.showError });
  if (shell.signal.aborted) view.destroy();
  return { view, simulation };
}

function controller(view: GameView, simulation: GameSimulation): PilotController {
  return {
    destroy: () => view.destroy(),
    snapshot: () => ({ seed: simulation.world.seed, camera: view.getCameraState() }),
  };
}

export async function mountHome(shell: PilotShell, _parameters: URLSearchParams): Promise<PilotController> {
  shell.stage.setAttribute('aria-label', 'Live island preview');
  shell.subject.append(
    el('h1', '', 'a long table'),
    el('p', 'p-muted', 'A small world, in progress.'),
  );
  const play = el('a', 'p-button p-primary', 'Play');
  play.href = '#/play?seed=42';
  shell.primary.append(play);
  const directory = section('Explorers');
  const navigation = el('nav', 'p-directory');
  navigation.setAttribute('aria-label', 'Explorers');
  for (const explorer of explorers) {
    const link = el('a', 'p-directory-link');
    link.href = `#/${explorer.id}`;
    link.append(el('strong', '', explorer.title), el('span', '', explorer.description), el('small', '', explorer.detail));
    navigation.append(link);
  }
  directory.append(navigation);
  const tooling = section('Development');
  const library = el('a', 'p-directory-link');
  library.href = '#/ui';
  library.append(el('strong', '', 'UI Explorer'), el('span', '', 'Shared controls and visual states'));
  tooling.append(library);
  shell.toolsContent.append(directory, tooling);
  const { view, simulation } = await backdrop(shell);
  return controller(view, simulation);
}

export async function mountUiLibrary(shell: PilotShell, _parameters: URLSearchParams): Promise<PilotController> {
  shell.subject.append(el('h1', '', 'UI Explorer'), el('p', 'p-muted', 'The shared panel and controls, in use.'));
  const { view, simulation } = await backdrop(shell);
  if (shell.signal.aborted) return controller(view, simulation);
  let seed = 42;
  let count = 3;
  let levels = false;
  let paths = false;
  let paused = false;
  const generate = action('Generate island', () => {
    try {
      const next = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
      seed = next === seed ? (next + 1) % 1000000 : next;
      const world = generateWorld(seed);
      view.setSimulation(new GameSimulation(world, new Navigation(world)));
      currentSeed.textContent = `Seed ${seed}`;
      shell.status(`Generated island ${seed}.`);
    } catch (cause) { shell.showError(cause); }
  }, shell.signal, 'p-primary');
  const currentSeed = el('output', 'p-current-seed', 'Seed 42');
  shell.primary.append(generate, currentSeed);
  const sections = new Map<string, HTMLElement>();
  const content = el('div', 'p-ui-library');
  const selection = choices('UI library', [
    { value: 'controls', label: 'Controls' },
    { value: 'foundations', label: 'Foundations' },
    { value: 'layout', label: 'Layout' },
  ], 'controls', value => {
    for (const [id, node] of sections) node.hidden = id !== value;
  }, shell.signal);
  shell.sessionControls.append(selection.element);
  const controls = el('div');
  const toggles = section('Scene toggles');
  for (const [label, initial, change] of [
    ['Levels', levels, (value: boolean) => { levels = value; view.setInspection(value); }],
    ['Walkability', paths, (value: boolean) => { paths = value; view.setNavigationOverlay(value); }],
    ['Paused', paused, (value: boolean) => { paused = value; view.setPaused(value); }],
  ] as const) {
    let selected: boolean = initial;
    const button = action(label, () => {
      selected = !selected;
      change(selected);
      button.setAttribute('aria-pressed', String(selected));
    }, shell.signal);
    button.setAttribute('aria-pressed', String(selected));
    toggles.append(button);
  }
  const counters = section('Counter and range');
  const output = el('output', 'p-chip', `Sample berries ${count}`);
  counters.append(output, slider('Sample count', 0, 24, 1, count, value => {
    count = value;
    output.textContent = `Sample berries ${count}`;
  }, shell.signal), el('p', 'p-muted', 'Sample only, not gameplay inventory.'));
  const states = section('Interaction states');
  const unavailable = action('Unavailable', () => {}, shell.signal);
  unavailable.disabled = true;
  states.append(unavailable, el('p', 'p-muted', 'Hover, press and Tab through the controls to inspect feedback and focus.'));
  controls.append(toggles, counters, states);
  const foundations = el('div');
  const colors = section('Color');
  const swatches = el('div', 'p-swatch-list');
  for (const [name, token] of [
    ['Panel', '--game-ink'], ['Deep', '--game-deep'], ['Text', '--game-paper'],
    ['Muted', '--game-muted'], ['Border', '--game-edge'], ['Primary', '--game-active'],
  ]) {
    const row = el('div', 'p-swatch');
    const chip = el('span', 'p-swatch-chip');
    chip.style.background = `var(${token})`;
    chip.setAttribute('aria-hidden', 'true');
    row.append(chip, el('span', '', name), el('code', '', token));
    swatches.append(row);
  }
  colors.append(swatches);
  const type = section('Type');
  type.append(el('h3', '', 'The world comes first.'), el('p', 'p-muted', 'Quiet labels. Clear values. One primary action.'));
  foundations.append(colors, type);
  const layout = el('div');
  const composition = section('Composition');
  composition.append(el('p', 'p-muted', 'Scene on the left. One panel on the right. Home returns to the explorer directory. The primary action stays above the scroll area; editing, seeds and exports sit below it. On narrow screens the panel stacks below the scene.'));
  layout.append(composition);
  for (const [id, node] of [['controls', controls], ['foundations', foundations], ['layout', layout]] as const) {
    sections.set(id, node);
    node.hidden = id !== 'controls';
    content.append(node);
  }
  shell.tray.hidden = false;
  shell.tray.append(content);
  return {
    destroy: () => view.destroy(),
    snapshot: () => ({ seed, levels, paths, paused, sampleBerries: count, camera: view.getCameraState() }),
  };
}
