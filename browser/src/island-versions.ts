import './island-versions.css';

type IslandVersion = 'v1' | 'v2';
const reviewSettings = new Map<IslandVersion, string>();

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, attributes: Record<string, string> = {}, text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
  if (text !== undefined) result.textContent = text;
  return result;
}

export function mountIslandVersions(root: HTMLElement, parameters: URLSearchParams, signal: AbortSignal): void {
  const requested = parameters.get('version');
  if (requested !== null && requested !== 'v1' && requested !== 'v2') {
    const error = node('main', { class: 'empty' });
    error.append(
      node('h1', {}, 'That island version does not exist.'),
      node('p', { role: 'alert' }, `Unknown island version: ${requested}. Choose V1 or V2.`),
      node('a', { class: 'button', href: '#/island?version=v1' }, 'Open V1'),
    );
    root.replaceChildren(error);
    return;
  }
  const version: IslandVersion = requested ?? (parameters.get('study') === 'landform' ? 'v2' : 'v1');
  const settings = new URLSearchParams(parameters);
  settings.delete('version');
  if (version === 'v2') settings.set('study', 'landform');
  else settings.delete('study');
  reviewSettings.set(version, settings.toString());

  const shell = node('main', { class: 'island-versions', 'data-island-version': version });
  const bar = node('nav', { class: 'island-version-bar', 'aria-label': 'Island versions' });
  const label = node('label', { class: 'island-version-choice' }, 'Version');
  const select = node('select', { 'aria-label': 'Island version' });
  select.append(
    node('option', { value: 'v1' }, 'V1 · Original island'),
    node('option', { value: 'v2' }, 'V2 · Landform rebuild'),
  );
  select.value = version;
  label.append(select);
  const description = node('span', { class: 'island-version-description' },
    version === 'v1' ? 'Preserved October 28, 2026' : 'In progress · Shape study');
  const history = node('details', { class: 'island-version-history' });
  history.append(node('summary', {}, 'Build journal'));
  const journal = node('section', { class: 'island-version-journal', 'aria-label': 'Island build journal' });
  journal.append(
    node('h2', {}, 'From texture to landform'),
    node('p', {}, 'We are rebuilding the island around connected shapes before adding surface detail. V1 keeps the original result available for comparison.'),
  );
  const table = node('table');
  const heading = node('tr');
  for (const title of ['Milestone', 'Status', 'What changed and why']) heading.append(node('th', { scope: 'col' }, title));
  const head = node('thead');
  head.append(heading);
  const body = node('tbody');
  for (const [milestone, status, explanation] of [
    ['V1 · Original island', 'Preserved', 'Generated terrain with textured ground, contour cliffs and stairs. Frozen on October 28, 2026.'],
    ['V2 · Landform', 'In review', 'One untextured island with connected elevations. Test silhouette, volume and scale before surface detail.'],
    ['V2 · Elevation transitions', 'Planned', 'Make routes and openings belong to the landform. Not built yet.'],
    ['V2 · Materials', 'Planned', 'Add surface treatment after the shapes and transitions are resolved. Not built yet.'],
    ['V2 · Procedural variation', 'Planned', 'Generate related islands using the approved shape language. Not built yet.'],
  ]) {
    const row = node('tr');
    row.append(node('th', { scope: 'row' }, milestone), node('td', {}, status), node('td', {}, explanation));
    body.append(row);
  }
  table.append(head, body);
  journal.append(table,
    node('p', {}, 'Posting outline: show V1, explain the shape problem, then compare each reviewed V2 milestone. Capture the version, seed and view with each image. Planned work is not a finished result.'),
    node('p', { class: 'muted' }, 'V2 is a fixed, non-playable study, not a regenerated version of the V1 seed. Switching versions starts a fresh session; the link preserves supported review settings.'),
  );
  history.append(journal);
  bar.append(label, description, history);
  const frame = node('iframe', { class: 'island-version-frame', title: version === 'v1' ? 'V1 original island' : 'V2 landform rebuild' });
  const error = node('p', { class: 'error-banner', role: 'alert', hidden: '' });
  const loading = node('p', { class: 'island-version-loading', role: 'status' }, `Opening ${version.toUpperCase()}…`);
  shell.append(bar, loading, error, frame);
  root.replaceChildren(shell);
  document.title = `Island Explorer · ${version.toUpperCase()} · a long table`;
  let leaving = false;

  function writeLink(current: URLSearchParams): void {
    current.set('version', version);
    historyReplace(current);
  }
  function historyReplace(current: URLSearchParams): void {
    window.history.replaceState(null, '', `#/island?${current}`);
  }
  function navigate(next: IslandVersion): void {
    if (leaving) return;
    leaving = true;
    const hash = frame.contentWindow?.location.hash;
    if (hash?.startsWith('#/island')) {
      const current = new URLSearchParams(hash.split('?')[1] ?? '');
      if ((version === 'v2') === (current.get('study') === 'landform')) {
        current.delete('version');
        reviewSettings.set(version, current.toString());
      }
    }
    const nextSettings = new URLSearchParams(reviewSettings.get(next));
    const currentSettings = new URLSearchParams(reviewSettings.get(version));
    if (!nextSettings.has('seed') && currentSettings.has('seed')) nextSettings.set('seed', currentSettings.get('seed')!);
    nextSettings.set('version', next);
    if (next === 'v2') nextSettings.set('study', 'landform');
    location.hash = `/island?${nextSettings}`;
  }
  select.addEventListener('change', () => navigate(select.value === 'v2' ? 'v2' : 'v1'), { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') history.open = false;
  }, { signal });
  document.addEventListener('click', event => {
    if (event.target instanceof Node && !history.contains(event.target)) history.open = false;
  }, { signal });

  function syncFrame(): void {
    if (signal.aborted || leaving || !frame.contentWindow) return;
    const outer = location.hash;
    if (!outer.startsWith('#/island')
      || new URLSearchParams(outer.split('?')[1] ?? '').get('version') !== version) return;
    const hash = frame.contentWindow.location.hash;
    if (!hash.startsWith('#/island')) {
      leaving = true;
      location.hash = hash || '#/';
      return;
    }
    const current = new URLSearchParams(hash.split('?')[1] ?? '');
    if (version === 'v1' && current.get('study') === 'landform') {
      navigate('v2');
      return;
    }
    if (version === 'v2' && current.get('study') !== 'landform') {
      navigate('v1');
      return;
    }
    current.delete('version');
    reviewSettings.set(version, current.toString());
    writeLink(current);
  }
  let interval: ReturnType<typeof setInterval> | undefined;
  frame.addEventListener('load', () => {
    if (signal.aborted) return;
    if (interval !== undefined) clearInterval(interval);
    const content = frame.contentDocument;
    if (!content?.querySelector('#app') || !frame.contentWindow) {
      error.textContent = `Could not open ${version.toUpperCase()}. Reload this page to try again.`;
      error.hidden = false;
      loading.hidden = true;
      return;
    }
    loading.hidden = true;
    content.addEventListener('click', event => {
      history.open = false;
      const targetElement = event.target;
      if (!targetElement || !('closest' in targetElement) || typeof targetElement.closest !== 'function') return;
      const link: HTMLAnchorElement | null = targetElement.closest('a');
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = new URL(link.href);
      if (target.origin !== location.origin) return;
      if (target.hash === '#/' || target.hash === '#') {
        event.preventDefault();
        leaving = true;
        location.hash = '#/';
      } else if (target.hash.startsWith('#/island')) {
        const next = new URLSearchParams(target.hash.split('?')[1] ?? '');
        if ((version === 'v1') === (next.get('study') === 'landform')) {
          event.preventDefault();
          navigate(version === 'v1' ? 'v2' : 'v1');
        }
      }
    }, { signal, capture: true });
    content.addEventListener('keydown', event => {
      if (event.key === 'Escape') history.open = false;
    }, { signal });
    frame.contentWindow.addEventListener('hashchange', syncFrame, { signal });
    // The existing explorers write review settings with replaceState, which emits no event.
    interval = setInterval(syncFrame, 300);
    syncFrame();
  }, { signal });
  signal.addEventListener('abort', () => {
    if (interval !== undefined) clearInterval(interval);
  }, { once: true });
  writeLink(new URLSearchParams(settings));
  const url = new URL(version === 'v1' ? `${import.meta.env.BASE_URL}versions/island-v1/index.html` : './', location.href);
  url.search = location.search;
  if (version === 'v2') url.searchParams.set('islandEmbed', 'v2');
  url.hash = `/island?${settings}`;
  frame.src = url.href;
}
