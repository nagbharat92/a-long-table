import { mountCharacterCreation, type CharacterCreation } from '../character-family/character-creation';
import { mountCharacterCustomization, type CharacterCustomization } from '../character-family/character-customization';
import { appearanceSeed } from '../character-family/core/character-appearance';
import { characterDefinitionRecipe, originalCharacterAppearance } from '../character-family/core/character-definition';
import { CHARACTER_SPECIES, characterSpecies } from '../character-family/core/character-species';
import type { CharacterSpecies } from '../character-family/core/character-rig';
import type { CharacterMode } from '../character-family/core/contracts';
import { GameSimulation } from '../character-family/core/game';
import { Navigation } from '../character-family/core/navigation';
import { generateWorld } from '../character-family/core/world';
import { createGameView, type GameView } from '../character-family/render/game-view';
import { action, choices, el, section, type PilotController, type PilotShell } from './ui';
import './character-family.css';

type Workspace = 'creation' | 'motion' | 'customization';

export async function mountCharacterFamily(shell: PilotShell, parameters: URLSearchParams): Promise<PilotController> {
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const abort = () => lifetime.abort();
  let view: GameView | undefined;
  let creation: CharacterCreation | undefined;
  let customization: CharacterCustomization | undefined;
  let destroyed = false;
  const owned: HTMLElement[] = [];
  shell.signal.addEventListener('abort', abort, { once: true });
  if (shell.signal.aborted) abort();
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    abort();
    shell.signal.removeEventListener('abort', abort);
    view?.destroy();
    for (const node of owned) node.remove();
    shell.root.classList.remove('p-character-family');
    delete shell.root.dataset.characterTab;
    delete shell.root.dataset.characterSpecies;
  }
  signal.addEventListener('abort', () => {
    view?.destroy();
    for (const node of owned) node.remove();
  }, { once: true });
  if (signal.aborted) return { destroy };
  shell.root.classList.add('p-character-family');
  const safe = (run: () => void) => () => {
    if (signal.aborted) return;
    try { run(); } catch (cause) { shell.showError(cause); }
  };
  const button = (label: string, run: () => void, className = '') => action(label, safe(run), signal, className);
  const attach = (parent: HTMLElement, node: HTMLElement) => { parent.append(node); owned.push(node); return node; };
  const heading = el('div');
  heading.append(el('h1', '', 'Character Explorer'), el('p', 'p-muted', 'Build a rig, study its motion, make it yours.'));
  attach(shell.subject, heading);
  const generate = button('Generate character', () => customization?.generate(), 'p-primary');
  generate.disabled = true;
  generate.dataset.action = 'generate-character';
  attach(shell.primary, generate);
  const seedOutput = el('output', 'p-current-seed');
  seedOutput.setAttribute('aria-label', 'Current character seed');
  attach(shell.primary, seedOutput);
  const loading = el('div', 'p-loading', 'Opening character…');
  loading.setAttribute('role', 'status');
  attach(shell.stage, loading);
  // The renderer and artwork preview share the scene, never the controls panel.
  const scene = el('div', 'cf-scene');
  const preview = el('div', 'cf-preview');
  preview.setAttribute('role', 'region');
  preview.setAttribute('aria-label', 'Character preview');
  preview.hidden = true;
  attach(shell.stage, scene);
  attach(shell.stage, preview);

  let species: CharacterSpecies = 'rabbit';
  let tab: Workspace = parameters.get('tab') === 'motion' ? 'motion'
    : ['customization', 'colors'].includes(parameters.get('tab') ?? '') ? 'customization' : 'creation';
  let mode: CharacterMode = parameters.get('motion') === 'walk' ? 'walk' : 'hop';
  let paused = parameters.get('paused') === '1';
  let ready = false;
  let lastWalkError: string | null = null;
  const panels = new Map<Workspace, HTMLElement>();
  const tabButtons = new Map<Workspace, HTMLButtonElement>();
  const modeButtons = new Map<CharacterMode, HTMLButtonElement>();
  let cycle: HTMLInputElement | undefined;
  let beat: HTMLOutputElement | undefined;
  let travelLabel: HTMLLabelElement | undefined;
  let pause: HTMLButtonElement | undefined;
  let walk: HTMLButtonElement | undefined;
  let sceneControls: HTMLElement | undefined;
  let speciesChoice: ReturnType<typeof choices<CharacterSpecies>> | undefined;

  function updateUrl(): void {
    if (!ready || signal.aborted) return;
    const next = new URLSearchParams(parameters);
    next.delete('tab'); next.delete('motion'); next.delete('species'); next.delete('paused');
    if (tab !== 'creation') next.set('tab', tab);
    if (mode === 'walk') next.set('motion', 'walk');
    if (species !== 'rabbit') next.set('species', species);
    if (paused) next.set('paused', '1');
    if (customization) next.set('colorSeed', String(customization.getSeed()));
    history.replaceState(history.state, '', `#/character?${next}`);
  }
  function updateReadouts(): void {
    if (signal.aborted || !view || !ready) return;
    const pose = view.getCharacterMotion();
    if (cycle && beat && pose) {
      cycle.value = String(Math.min(99, Math.round(pose.phase * 100)));
      cycle.disabled = mode === 'idle';
      beat.value = mode === 'idle' && pose.beat !== 'settling' ? 'Idle' : pose.beat;
      cycle.setAttribute('aria-label', mode === 'walk' ? 'Walk cycle' : 'Hop cycle');
      cycle.setAttribute('aria-valuetext', beat.value);
    }
    if (travelLabel) travelLabel.hidden = mode !== 'walk';
    if (walk) {
      walk.disabled = species !== 'rabbit';
      walk.title = species !== 'rabbit' ? 'The first walk is calibrated for Bunny.' : '';
    }
    const error = view.getCharacterWalkError();
    if (error && error !== lastWalkError) shell.showError(new Error(error));
    lastWalkError = error;
    if (customization) seedOutput.value = `${CHARACTER_SPECIES.find(item => item.type === species)!.name} · Seed ${customization.getSeed()}`;
    scene.querySelector('canvas')?.setAttribute('aria-label', `Interactive ${species} ${tab === 'creation' ? 'rig' : 'motion'} preview`);
  }
  function setPaused(next: boolean): void {
    if (!view) return;
    view.setPaused(next || tab === 'customization');
    paused = next;
    if (pause) {
      pause.textContent = paused ? 'Resume' : 'Pause';
      pause.setAttribute('aria-pressed', String(paused));
    }
    updateReadouts();
    updateUrl();
  }
  function selectMotion(next: CharacterMode): void {
    if (!view) return;
    view.setCharacterMode(next);
    mode = next;
    for (const [value, control] of modeButtons) control.setAttribute('aria-pressed', String(value === mode));
    updateReadouts();
    updateUrl();
  }
  function switchTab(next: Workspace): void {
    if (!view || !creation) return;
    if (next === 'creation') creation.activate();
    else view.setCharacterRig(null);
    tab = next;
    for (const [value, panel] of panels) panel.hidden = value !== tab;
    for (const [value, control] of tabButtons) control.setAttribute('aria-pressed', String(value === tab));
    preview.hidden = tab !== 'customization';
    scene.hidden = tab === 'customization';
    if (sceneControls) sceneControls.hidden = tab === 'customization';
    shell.root.dataset.characterTab = tab;
    view.setPaused(paused || tab === 'customization');
    if (tab !== 'customization') view.fit();
    updateReadouts();
    updateUrl();
    shell.status(`${next} controls`);
  }
  try {
    species = characterSpecies(parameters.get('species'));
    // Validate before allocating the renderer so a malformed URL cannot leave a scene behind.
    if (parameters.has('colorSeed')) appearanceSeed(parameters.get('colorSeed')!);
    const world = generateWorld(42);
    let simulation = new GameSimulation(world, new Navigation(world), { foraging: false, autoSelect: true });
    view = await createGameView(scene, {
      mode: 'character', simulation, signal,
      onGroundClick: point => { if (tab === 'creation') safe(() => creation?.pick(point))(); },
      onFrame: updateReadouts,
      onError: cause => { if (!signal.aborted) shell.showError(cause); },
    });
    if (signal.aborted) { view.destroy(); return { destroy }; }
    const session = el('div', 'cf-session');
    speciesChoice = choices('Character species', CHARACTER_SPECIES.map(item => ({ value: item.type, label: item.name })), species, next => {
      safe(() => {
        const previous = species;
        try {
          customization!.setSpecies(next);
          species = next;
          shell.root.dataset.characterSpecies = species;
          updateReadouts();
          updateUrl();
          view!.fit();
        } catch (cause) {
          species = previous;
          // choices updates its pressed state after this callback.
          queueMicrotask(() => speciesChoice?.set(previous));
          throw cause;
        }
      })();
    }, signal);
    session.append(el('h2', 'p-label', 'Character'), speciesChoice.element);
    const tabs = el('div', 'cf-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Character workspace');
    for (const [id, label] of [['creation', 'Creation'], ['motion', 'Motion'], ['customization', 'Customization']] as const) {
      const control = button(label, () => switchTab(id));
      control.dataset.characterWorkspace = id;
      tabButtons.set(id, control);
      tabs.append(control);
    }
    session.append(tabs);
    attach(shell.sessionControls, session);
    const content = el('div', 'cf-content');
    attach(shell.toolsContent, content);
    for (const [id, label] of [['creation', 'Character creation'], ['motion', 'Character motion'], ['customization', 'Character parameters']] as const) {
      const panel = el('div', `cf-workspace cf-${id}`);
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-label', label);
      panel.hidden = true;
      panels.set(id, panel);
      content.append(panel);
    }
    creation = mountCharacterCreation(panels.get('creation')!, view, signal, shell.showError, () => {
      shell.status('Rig updated');
    }, () => characterDefinitionRecipe(view!.getCharacterAppearance() ?? originalCharacterAppearance(), creation!.getState()));
    const motion = panels.get('motion')!;
    const modes = el('div', 'cf-modes');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Character motion');
    for (const [id, label] of [['idle', 'Idle'], ['walk', 'Walk'], ['hop', 'Hop'], ['shallows', 'Shallows']] as const) {
      const control = button(label, () => selectMotion(id));
      modeButtons.set(id, control);
      modes.append(control);
      if (id === 'walk') walk = control;
    }
    motion.append(el('h2', 'p-label', 'Motion'), modes);
    const transport = el('div', 'cf-transport');
    pause = button(paused ? 'Resume' : 'Pause', () => setPaused(!paused));
    pause.setAttribute('aria-pressed', String(paused));
    const restart = button('Restart', () => {
      const next = new GameSimulation(world, new Navigation(world), { foraging: false, autoSelect: true });
      next.character.facingDirection = simulation.character.facingDirection;
      view!.setSimulation(next);
      simulation = next;
      view!.setCharacterMode(mode);
      view!.setCharacterWalkSpeed(Number(travel.value));
      setPaused(paused);
    });
    const step = button('Frame', () => { setPaused(true); view!.stepCharacterFrame(); updateReadouts(); });
    step.setAttribute('aria-label', 'Step one frame');
    step.title = 'Pause and advance 1/60 second of animation.';
    transport.append(pause, restart, step);
    motion.append(transport);
    function select(label: string, items: readonly (readonly [string, string])[], change: (value: string) => void): { label: HTMLLabelElement; input: HTMLSelectElement } {
      const row = el('label', 'cf-field', label);
      const input = el('select');
      input.setAttribute('aria-label', label);
      for (const [value, name] of items) {
        const option = el('option', '', name); option.value = value; input.append(option);
      }
      let accepted = input.value;
      input.addEventListener('change', safe(() => {
        try { change(input.value); accepted = input.value; }
        catch (cause) { input.value = accepted; throw cause; }
      }), { signal });
      row.append(input); motion.append(row);
      return { label: row, input };
    }
    const travelControl = select('Walk travel speed', [['1', 'Steady'], ['0.75', 'Slow'], ['1.25', 'Brisk']], value => view!.setCharacterWalkSpeed(Number(value)));
    const travel = travelControl.input;
    travelLabel = travelControl.label;
    select('Facing direction', [['1', 'Right'], ['-1', 'Left']], value => view!.setCharacterFacing(value === '-1' ? -1 : 1));
    select('Playback speed', [['1', '1x'], ['0.5', '0.5x'], ['0.25', '0.25x']], value => view!.setCharacterPlaybackSpeed(Number(value)));
    const cycleLabel = el('label', 'rig-range');
    beat = el('output');
    cycle = el('input');
    cycle.type = 'range'; cycle.min = '0'; cycle.max = '99'; cycle.step = '1';
    cycle.setAttribute('aria-label', 'Hop cycle');
    cycle.addEventListener('input', safe(() => {
      setPaused(true); view!.setCharacterHopPhase(Number(cycle!.value) / 100); updateReadouts();
    }), { signal });
    cycleLabel.append(el('span', '', 'Cycle'), beat, cycle);
    motion.append(cycleLabel, el('p', 'p-muted', 'Walk is calibrated for Bunny. The other species retain Idle, Hop and Shallows.'));
    customization = await mountCharacterCustomization(
      panels.get('customization')!, preview, parameters.get('colorSeed'), signal, shell.showError,
      (appearance, artwork) => {
        if (signal.aborted) return;
        if (appearance.species && appearance.species !== 'rabbit' && mode === 'walk') selectMotion('idle');
        view!.setCharacterAppearance(appearance, artwork);
        creation!.setSpecies(appearance.species ?? 'rabbit');
        species = appearance.species ?? 'rabbit';
        shell.root.dataset.characterSpecies = species;
        if (tab !== 'creation') view!.setCharacterRig(null);
        updateReadouts();
        updateUrl();
      }, () => creation!.getState(), species,
    );
    if (signal.aborted) return { destroy };
    if (!customization) throw new Error('The character artwork controls did not finish loading.');
    const display = section('Scene');
    sceneControls = display;
    display.classList.add('cf-display');
    const zoom = el('div', 'cf-transport');
    zoom.append(button('−', () => view!.zoomBy(1 / 1.5)), button('+', () => view!.zoomBy(1.5)), button('Fit', () => view!.fit()));
    zoom.children[0].setAttribute('aria-label', 'Zoom out');
    zoom.children[1].setAttribute('aria-label', 'Zoom in');
    zoom.children[2].setAttribute('aria-label', 'Fit view');
    display.append(zoom, el('p', 'p-muted', 'Pick a part directly in Creation. F fits the view; + / − zoom. R generates a character, or resets the rig in Creation.'));
    content.append(display);
    scene.addEventListener('wheel', event => {
      event.preventDefault();
      if (event.deltaY) safe(() => view!.zoomBy(event.deltaY < 0 ? 1.5 : 1 / 1.5))();
    }, { signal, passive: false });
    window.addEventListener('keydown', event => {
      if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, button, [contenteditable="true"]')) return;
      if (event.ctrlKey || event.metaKey || event.altKey || !ready) return;
      const key = event.key.toLowerCase();
      if (key === 'r') safe(() => tab === 'creation' ? creation!.reset() : customization!.generate())();
      else if (tab === 'customization') return;
      else if (key === 'f') safe(() => view!.fit())();
      else if (key === '+' || key === '=') safe(() => view!.zoomBy(1.5))();
      else if (key === '-') safe(() => view!.zoomBy(1 / 1.5))();
      else return;
      event.preventDefault();
    }, { signal });
    ready = true;
    if (species !== 'rabbit' && mode === 'walk') mode = 'idle';
    selectMotion(mode);
    switchTab(tab);
    loading.remove();
    generate.disabled = false;
    shell.status('Character ready');
    return {
      destroy,
      snapshot: () => ({
        family: 'character', species, tab, seed: customization?.getSeed(), paused, mode,
        appearance: customization?.getAppearance(), rig: creation?.getState(),
        motion: view?.getCharacterMotion(), camera: view?.getCameraState(),
      }),
      worldToScreen: point => view!.worldToScreen(point),
    };
  } catch (cause) {
    if (signal.aborted) { destroy(); return { destroy }; }
    destroy();
    throw cause;
  }
}
