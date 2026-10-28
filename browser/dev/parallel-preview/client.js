const endpoint = '/__parallel_preview';
const initialVersion = document.querySelector('meta[name="parallel-preview-version"]')?.content;
const host = document.createElement('aside');
host.dataset.parallelPreview = '';
host.setAttribute('aria-label', 'Development updates');
const shadow = host.attachShadow({ mode: 'open' });
shadow.innerHTML = `
  <style>
    :host { position:fixed; inset:var(--parallel-preview-inset,auto 12px 12px auto);
      transform:var(--parallel-preview-transform,none); z-index:var(--parallel-preview-z-index,10000); max-width:calc(100vw - 24px);
      font:12px/1.4 "Segoe UI",system-ui,sans-serif; color:var(--cp-text,#242424); }
    details { background:var(--cp-surface,#fff); border:1px solid var(--cp-border,#dedede);
      border-radius:10px; max-width:320px; box-shadow:0 2px 10px #0002; }
    summary { cursor:pointer; padding:8px 12px; border-radius:9px; }
    summary:hover { background:var(--cp-surface-soft,#f5f5f5); }
    summary:active { color:var(--cp-accent,#b11f4b); }
    .controls { display:grid; gap:12px; padding:4px 12px 12px; }
    label { display:flex; align-items:center; gap:8px; cursor:pointer; min-height:32px; }
    input { accent-color:var(--cp-accent,#b11f4b); }
    p { margin:0; overflow-wrap:anywhere; }
    button { font:inherit; padding:8px 12px; min-height:36px; border:1px solid var(--cp-border,#dedede);
      border-radius:6px; background:var(--cp-surface,#fff); color:inherit; cursor:pointer; }
    button:hover:not(:disabled) { background:var(--cp-surface-soft,#f5f5f5); border-color:var(--cp-border-strong,#919191); }
    button:active:not(:disabled) { color:var(--cp-accent,#b11f4b); border-color:currentColor; }
    button:disabled { opacity:.5; cursor:not-allowed; }
    :focus-visible { outline:2px solid var(--cp-accent,#b11f4b); outline-offset:3px; }
  </style>
  <details>
    <summary>Updates held</summary>
    <div class="controls">
      <label><input type="checkbox" checked>Hold updates in this tab</label>
      <p role="status" aria-live="polite">Connecting to preview.</p>
      <button type="button" disabled>Apply update</button>
      <p>Applying restarts only this tab. Unsaved runtime state will reset.</p>
    </div>
  </details>`;
document.body.append(host);
const details = shadow.querySelector('details');
const summary = shadow.querySelector('summary');
const hold = shadow.querySelector('input');
const status = shadow.querySelector('[role="status"]');
const apply = shadow.querySelector('button');
const storageKey = 'parallel-preview:hold';
const pendingRoutes = new Set();
let sharedPending = false;
let routeMode = 'hash';
let readyVersion;
let buildFailed = false;
let building = false;
let connected = false;
let navigationStarting = false;

try {
  hold.checked = sessionStorage.getItem(storageKey) !== 'false';
} catch (error) {
  console.warn('[parallel preview] Tab settings cannot be saved.', error);
}

function route() {
  return routeMode === 'hash'
    ? location.hash.replace(/^#/, '').split('?')[0] || '/'
    : location.pathname;
}

function relevant() {
  return sharedPending || pendingRoutes.has(route());
}

function render() {
  const pending = relevant();
  apply.disabled = !pending || buildFailed || building || !connected;
  summary.textContent = buildFailed ? 'Preview build failed'
    : !connected ? 'Preview disconnected'
    : pending ? 'Update available'
    : hold.checked ? 'Updates held' : 'Auto-update on';
  if (pending || buildFailed) details.open = true;
  if (!connected) status.textContent = 'Preview disconnected. This tab will not reload.';
  else if (buildFailed) return;
  else if (building) status.textContent = 'Building. Your current session is unchanged.';
  else status.textContent = pending
    ? 'An update is ready for this screen.'
    : hold.checked ? 'This tab stays unchanged until you apply an update.' : 'Updates apply only while this tab is visible.';
}

function maybeApply() {
  if (!hold.checked && relevant() && !buildFailed && !building && connected
    && document.visibilityState === 'visible' && !navigationStarting) {
    navigationStarting = true;
    location.reload();
  }
}

hold.addEventListener('change', () => {
  try {
    sessionStorage.setItem(storageKey, String(hold.checked));
  } catch (error) {
    console.warn('[parallel preview] Tab settings cannot be saved.', error);
  }
  render();
  maybeApply();
});
apply.addEventListener('click', () => {
  if (apply.disabled || navigationStarting) return;
  navigationStarting = true;
  location.reload();
});
for (const event of ['hashchange', 'popstate', 'visibilitychange']) {
  (event === 'visibilitychange' ? document : window).addEventListener(event, () => {
    render();
    maybeApply();
  });
}

const events = new EventSource(`${endpoint}/events`);
events.addEventListener('message', message => {
  let event;
  try {
    event = JSON.parse(message.data);
  } catch (error) {
    console.error('[parallel preview] Invalid update notification.', error);
    status.textContent = 'Could not read the update notification. Reload this tab manually when ready.';
    return;
  }
  connected = true;
  if (event.type === 'hello') {
    routeMode = event.routeMode;
    building = event.building;
    if ((readyVersion && readyVersion !== event.version) || (!readyVersion && initialVersion !== event.version)) {
      sharedPending = true;
    }
    readyVersion = event.version;
    buildFailed = Boolean(event.error);
    if (buildFailed) status.textContent = `Build failed. This session is unchanged. ${event.error}`;
  } else if (event.type === 'building') {
    building = true;
  } else if (event.type === 'error') {
    building = false;
    buildFailed = true;
    status.textContent = `Build failed. This session is unchanged. ${event.message}`;
  } else if (event.type === 'update') {
    building = false;
    buildFailed = false;
    readyVersion = event.version;
    if (event.version !== initialVersion) {
      if (event.routes === null) sharedPending = true;
      else for (const value of event.routes) pendingRoutes.add(value);
    }
  }
  render();
  maybeApply();
});
events.addEventListener('error', () => {
  connected = false;
  render();
});
window.addEventListener('pagehide', () => events.close(), { once: true });
render();
