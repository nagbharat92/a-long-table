import './pilot/pilot.css';
import { createShell, type PilotController } from './pilot/ui';
import { resolveRoute, routeTitle, type PilotRoute } from './pilot/directory';

declare global {
  interface Window {
    __pilot?: {
      route: string;
      snapshot: () => unknown;
      worldToScreen?: (point: { x: number; y: number }) => { x: number; y: number };
    };
  }
}

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('The pilot mount is missing.');
let controller: PilotController | undefined;
let lifetime = new AbortController();
let revision = 0;

async function route(): Promise<void> {
  const current = ++revision;
  const preview = document.querySelector<HTMLElement>('aside[data-parallel-preview]');
  lifetime.abort();
  controller?.destroy();
  controller = undefined;
  delete window.__pilot;
  lifetime = new AbortController();
  const [path, query = ''] = location.hash.slice(1).split('?');
  const parameters = new URLSearchParams(query);
  let id: PilotRoute;
  try {
    id = resolveRoute(path, parameters);
  } catch (cause) {
    const shell = createShell('unknown', lifetime.signal);
    root!.replaceChildren(shell.root);
    if (preview) shell.previewControls.append(preview);
    document.title = 'Explorer not found / a long table';
    shell.subject.textContent = 'Explorer not found';
    shell.showError(cause);
    return;
  }
  if (path === '/trees' || path === '/foraging') {
    history.replaceState(null, '', `#/foliage?${parameters}`);
  }
  const shell = createShell(id, lifetime.signal);
  root!.replaceChildren(shell.root);
  if (preview) shell.previewControls.append(preview);
  else if (document.querySelector('meta[name="parallel-preview-version"]')) {
    const observer = new MutationObserver(() => {
      const controls = document.querySelector<HTMLElement>('aside[data-parallel-preview]');
      if (controls) {
        shell.previewControls.append(controls);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
    lifetime.signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  }
  document.title = id === 'home' ? 'a long table' : `${routeTitle(id)} / a long table`;
  const loading = document.createElement('p');
  loading.className = 'p-loading';
  loading.setAttribute('role', 'status');
  loading.textContent = `Opening ${id === 'home' ? 'the island' : routeTitle(id)}...`;
  shell.stage.append(loading);
  try {
    let mounted: PilotController;
    if (id === 'home' || id === 'ui') {
      const { mountHome, mountUiLibrary } = await import('./pilot/home');
      if (current !== revision) return;
      mounted = id === 'home' ? await mountHome(shell, parameters) : await mountUiLibrary(shell, parameters);
    } else if (id === 'character') {
      const { mountCharacterFamily } = await import('./pilot/character-family');
      if (current !== revision) return;
      mounted = await mountCharacterFamily(shell, parameters);
    } else if (id === 'foliage') {
      const { mountFoliageFamily } = await import('./pilot/foliage-family');
      if (current !== revision) return;
      mounted = await mountFoliageFamily(shell, parameters);
    } else if (id === 'island' || id === 'navigation') {
      const { mountWorldFamily } = await import('./pilot/world-family');
      if (current !== revision) return;
      mounted = await mountWorldFamily(shell, parameters, id);
    } else {
      const { mountPlay } = await import('./pilot/play');
      if (current !== revision) return;
      mounted = await mountPlay(shell, parameters);
    }
    if (current !== revision) { mounted.destroy(); return; }
    loading.remove();
    controller = mounted;
    window.__pilot = { route: id, snapshot: () => mounted.snapshot?.(), worldToScreen: mounted.worldToScreen };
    shell.root.dataset.ready = 'true';
  } catch (cause) {
    if (current === revision) {
      loading.remove();
      shell.showError(cause);
    }
  }
}

window.addEventListener('hashchange', () => { void route(); });
void route();
