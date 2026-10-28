import { GameSimulation } from '../core/game';
import { Navigation } from '../core/navigation';
import { generateWorld } from '../core/world';
import { createGameView, type GameView } from '../render/game-view';
import { action, el, section, type PilotController, type PilotShell } from './ui';

export async function mountPlay(shell: PilotShell, parameters: URLSearchParams): Promise<PilotController> {
  const rawSeed = parameters.get('seed') ?? '42';
  if (!/^\d{1,6}$/.test(rawSeed)) throw new Error('Island seed must be a whole number from 0 to 999999.');
  const seed = Number(rawSeed);
  const world = generateWorld(seed);
  const simulation = new GameSimulation(world, new Navigation(world), { foraging: true, autoSelect: false });
  let view: GameView | undefined;
  let userPaused = parameters.get('paused') === '1';
  let hover: { x: number; y: number } | null = null;
  let inspectedId: string | undefined;
  let lastBerries = 0;
  let pickupUntil = 0;
  let destroyed = false;
  const loading = el('p', 'p-loading', 'Opening the island...');
  shell.stage.append(loading);
  const pause = action(userPaused ? 'Resume' : 'Pause', () => {
    userPaused = !userPaused;
    syncPaused();
  }, shell.signal);
  pause.setAttribute('aria-pressed', String(userPaused));
  const count = el('output', 'p-chip p-play-counter');
  count.setAttribute('aria-label', 'Berries collected');
  const value = el('strong', '', '0');
  count.append(el('span', '', 'Berries'), value);
  shell.subject.append(el('h1', '', 'Play'), el('p', 'p-muted', 'Explore an island. Walk, forage, repeat.'));
  shell.primary.append(
    action('Generate island', () => {
      const next = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
      window.location.hash = `/play?seed=${next === seed ? (next + 1) % 1000000 : next}`;
    }, shell.signal, 'p-primary'),
    el('output', 'p-current-seed', `Seed ${seed}`),
  );
  const session = el('div', 'p-row');
  session.append(count, pause);
  shell.sessionControls.append(session);
  const hint = el('p', 'p-play-hint', 'Select the rabbit to begin.');
  const context = el('div', 'p-context');
  context.hidden = true;
  const contextTitle = el('div');
  const gather = action('Gather', () => {
    if (!inspectedId) return;
    if (!simulation.character.selected) {
      simulation.select(true);
    } else {
      simulation.gather(inspectedId);
    }
    update();
  }, shell.signal, 'p-primary');
  const progress = el('progress');
  progress.max = 1;
  progress.setAttribute('aria-label', 'Gathering progress');
  progress.hidden = true;
  context.append(contextTitle, progress, gather);
  const pickup = el('output', 'p-pickup');
  pickup.hidden = true;
  shell.sessionControls.append(hint, context, pickup);
  const camera = section('Camera and controls');
  const zoom = el('div', 'p-row');
  zoom.append(
    action('-', () => view?.zoomBy(1 / 1.5), shell.signal),
    action('+', () => view?.zoomBy(1.5), shell.signal),
    action('Fit', () => view?.fit(), shell.signal),
  );
  zoom.querySelectorAll('button')[0].setAttribute('aria-label', 'Zoom out');
  zoom.querySelectorAll('button')[1].setAttribute('aria-label', 'Zoom in');
  const tools = section('This island');
  const form = el('form', 'p-row');
  const label = el('label', '', 'Island seed');
  const input = el('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.value = String(seed);
  input.setAttribute('aria-label', 'Island seed');
  label.append(input);
  const apply = el('button', 'p-button', 'Open seed');
  apply.type = 'submit';
  const seedError = el('p', 'p-muted');
  seedError.setAttribute('role', 'alert');
  form.append(label, apply);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!/^\d{1,6}$/.test(input.value)) {
      seedError.textContent = 'Use a whole number from 0 to 999999. Your current island has not changed.';
      return;
    }
    window.location.hash = `/play?seed=${Number(input.value)}`;
    if (Number(input.value) === seed) window.location.reload();
  }, { signal: shell.signal });
  tools.append(form, seedError, el('p', 'p-muted', 'Opening a seed starts a fresh island. Collected berries and movement are not saved.'));
  tools.append(action('Start this island again', () => window.location.reload(), shell.signal));
  camera.append(zoom, el('p', 'p-muted', 'Click the rabbit to select it. Click ground to walk or a bush to gather. Scroll or + / - to zoom. F fits the island. Space pauses or resumes.'));
  shell.toolsContent.append(tools, camera);

  function syncPaused(): void {
    view?.setPaused(userPaused);
    pause.textContent = userPaused ? 'Resume' : 'Pause';
    pause.setAttribute('aria-pressed', String(userPaused));
    const next = new URLSearchParams({ seed: String(seed) });
    if (userPaused) next.set('paused', '1');
    history.replaceState(null, '', `#/play?${next}`);
  }
  function update(): void {
    if (!view || destroyed) return;
    if (simulation.berries !== lastBerries) {
      pickup.textContent = `+${simulation.berries - lastBerries} berries`;
      pickupUntil = performance.now() + 1800;
      lastBerries = simulation.berries;
      value.textContent = String(lastBerries);
      shell.status(`Collected ${lastBerries} berries.`);
    }
    const hovered = hover ? simulation.bushAt(hover, view.getCameraState().zoom) : undefined;
    if (hovered) inspectedId = hovered.id;
    const bush = simulation.bushes.find(item => item.id === (simulation.job?.bushId ?? inspectedId));
    for (const item of simulation.bushes) item.hovered = item.id === hovered?.id;
    const show = Boolean(bush);
    context.hidden = !show;
    if (bush && show) {
      const gathering = simulation.job?.bushId === bush.id;
      contextTitle.textContent = gathering ? simulation.job?.started ? 'Gathering' : 'On the way' : bush.state === 'ripe' ? 'Ripe berries' : 'Growing back';
      progress.hidden = !gathering;
      progress.value = bush.gatherProgress;
      gather.hidden = gathering;
      gather.disabled = bush.state !== 'ripe' || userPaused;
      gather.textContent = simulation.character.selected ? bush.state === 'ripe' ? 'Gather' : 'Not ready' : 'Select rabbit';
    }
    pickup.hidden = performance.now() >= pickupUntil;
    const hintText = userPaused ? 'Paused' : !simulation.character.selected ? 'Select the rabbit to begin.' : simulation.feedback || 'Click ground to walk. Click a bush to gather.';
    if (hint.textContent !== hintText) hint.textContent = hintText;
  }

  try {
    view = await createGameView(shell.stage, {
      mode: 'play',
      simulation,
      onGroundClick(point, pointer) {
        if (pointer.button !== 0 || userPaused) return;
        const bush = simulation.bushAt(point, view?.getCameraState().zoom ?? 1);
        if (bush) inspectedId = bush.id;
        simulation.click(point, view?.getCameraState().zoom ?? 1);
        update();
      },
      onHover(point) { hover = point; },
      onFrame: update,
      onError: shell.showError,
    });
  } catch (cause) {
    loading.remove();
    throw cause;
  }
  loading.remove();
  if (shell.signal.aborted) {
    view.destroy();
    return { destroy() {} };
  }
  syncPaused();
  shell.stage.addEventListener('wheel', event => {
    event.preventDefault();
    view?.zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { signal: shell.signal, passive: false });
  window.addEventListener('keydown', event => {
    if (event.target instanceof Element && event.target.closest('.p-panel')) return;
    if (event.key.toLowerCase() === 'f') view?.fit();
    else if (event.key === '+' || event.key === '=') view?.zoomBy(1.5);
    else if (event.key === '-') view?.zoomBy(1 / 1.5);
    else if (event.code === 'Space') { event.preventDefault(); userPaused = !userPaused; syncPaused(); }
  }, { signal: shell.signal });
  update();
  return {
    destroy() { destroyed = true; view?.destroy(); },
    worldToScreen(point) { return view?.worldToScreen(point) ?? point; },
    snapshot() {
      return {
        seed, berries: simulation.berries, elapsed: simulation.elapsed, paused: userPaused,
        character: structuredClone(simulation.character), bushes: structuredClone(simulation.bushes),
        camera: view?.getCameraState(), job: structuredClone(simulation.job),
      };
    },
  };
}
