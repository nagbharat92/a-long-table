import { GROUND_ASSET_GROUPS, type GroundAssetTab } from '../foliage-family/foliage-tabs';
import { mountForagingExplorer } from '../foliage-family/foraging-explorer';
import { mountGrassExplorer } from '../foliage-family/grass-explorer';
import { mountTreeExplorer } from '../foliage-family/tree-explorer';
import { mountRockExplorer } from '../foliage-family/rock-explorer';
import { mountWoodExplorer } from '../foliage-family/wood-explorer';
import { mountMushroomExplorer } from '../foliage-family/mushroom-explorer';
import { mountNatureAssetExplorer } from '../foliage-family/nature-asset-explorer';
import { attachHost } from '../foliage-family/pilot-host';
import { el, type PilotController, type PilotShell } from './ui';
import './foliage-family.css';

/**
 * Isolated snapshot of a-long-table-foraging/browser/src. Core generation,
 * pixel art, tree motion and GPU render modules are copied without changes.
 * The editor entry points adapt composition, routes, lifecycle and exports only.
 */
export function mountFoliageFamily(shell: PilotShell, params: URLSearchParams): PilotController {
  const lifecycle = new AbortController();
  const root = el('div');
  const host = attachHost(root, shell);
  const parameters = new URLSearchParams(params);
  const requested = parameters.get('tab') ?? parameters.get('foliage') ?? parameters.get('asset') ?? 'bush';
  const aliases: Record<string, GroundAssetTab> = { tree: 'trees', rock: 'rocks', mushroom: 'mushrooms', plant: 'bush' };
  const tab = aliases[requested] ?? requested;
  const asset = GROUND_ASSET_GROUPS.flatMap(group => [...group.assets]).find(([id]) => id === tab);
  let destroyed = false;
  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    lifecycle.abort();
    shell.signal.removeEventListener('abort', destroy);
    host.release();
    shell.root.classList.remove('foliage-family');
    shell.stage.replaceChildren();
    shell.subject.replaceChildren();
    shell.primary.replaceChildren();
    shell.sessionControls.replaceChildren();
    shell.tray.replaceChildren();
    shell.tray.hidden = true;
    shell.toolsContent.replaceChildren();
  };
  shell.signal.addEventListener('abort', destroy, { once: true });
  const controller: PilotController = {
    destroy,
    snapshot: () => destroyed ? null : {
      family: 'foliage', tab, ...host.snapshot() as Record<string, unknown> | null,
    },
  };
  if (shell.signal.aborted) { destroy(); return controller; }
  shell.root.classList.add('foliage-family');
  if (!asset) {
    shell.subject.append(el('h1', '', 'Foliage Explorer'));
    shell.showError(new RangeError(`Unknown foliage asset "${requested}". Choose a supported foliage tab.`));
    return controller;
  }
  parameters.set('tab', asset[0]);
  const group = GROUND_ASSET_GROUPS.find(group => group.assets.some(([id]) => id === tab))!;
  const subtitle = group.name === asset[1] ? asset[1] : `${group.name} · ${asset[1]}`;
  shell.subject.replaceChildren(el('h1', '', 'Foliage Explorer'), el('p', 'p-muted', subtitle));
  shell.stage.setAttribute('aria-label', `${asset[1]} scene`);
  const mounts: Partial<Record<GroundAssetTab, typeof mountForagingExplorer>> = {
    bush: mountForagingExplorer,
    grass: mountGrassExplorer,
    trees: mountTreeExplorer,
    rocks: mountRockExplorer,
    wood: mountWoodExplorer,
    mushrooms: mountMushroomExplorer,
  };
  try {
    (mounts[asset[0]] ?? mountNatureAssetExplorer)(root, parameters, lifecycle.signal);
    if (!host.hasError()) shell.status(`${asset[1]} ready. Generate a new asset or edit its appearance.`);
  } catch (cause) {
    lifecycle.abort();
    shell.showError(cause);
  }
  return controller;
}
