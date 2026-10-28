export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function action(label: string, run: () => void, signal: AbortSignal, className = ''): HTMLButtonElement {
  const button = el('button', `p-button ${className}`, label);
  button.type = 'button';
  button.addEventListener('click', run, { signal });
  return button;
}

export function section(title: string): HTMLElement {
  const node = el('section', 'p-section');
  node.append(el('h2', 'p-label', title));
  return node;
}

export function choices<T extends string | number>(
  label: string,
  items: readonly { value: T; label: string }[],
  selected: T,
  change: (value: T) => void,
  signal: AbortSignal,
): { element: HTMLDivElement; set(value: T): void } {
  const element = el('div', 'p-choices');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', label);
  const buttons = items.map(item => {
    const button = action(item.label, () => { change(item.value); set(item.value); }, signal);
    element.append(button);
    return button;
  });
  function set(value: T): void {
    items.forEach((item, index) => buttons[index].setAttribute('aria-pressed', String(item.value === value)));
  }
  set(selected);
  return { element, set };
}

export function slider(label: string, min: number, max: number, step: number, value: number, change: (value: number) => void, signal: AbortSignal): HTMLLabelElement {
  const row = el('label', 'p-slider');
  const heading = el('span', 'p-slider-heading');
  const output = el('output', '', String(value));
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.setAttribute('aria-label', label);
  heading.append(el('span', '', label), output);
  row.append(heading, input);
  input.addEventListener('input', () => {
    output.value = input.value;
    change(input.valueAsNumber);
  }, { signal });
  return row;
}

export function download(name: string, content: Blob | string): void {
  const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type: 'application/json' }) : content);
  const link = el('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface PilotController {
  destroy(): void;
  snapshot?(): unknown;
  worldToScreen?(point: { x: number; y: number }): { x: number; y: number };
}

export interface PilotShell {
  root: HTMLElement;
  stage: HTMLDivElement;
  subject: HTMLDivElement;
  primary: HTMLDivElement;
  sessionControls: HTMLDivElement;
  tray: HTMLDivElement;
  toolsContent: HTMLDivElement;
  previewControls: HTMLDivElement;
  signal: AbortSignal;
  showError(cause: unknown): void;
  status(text: string): void;
}

export function createShell(route: string, signal: AbortSignal): PilotShell {
  const root = el('main', 'pilot');
  root.dataset.route = route;
  root.dataset.skin = 'ink';
  const stage = el('div', 'p-stage');
  stage.setAttribute('aria-label', `${route} scene`);
  const panel = el('aside', 'p-panel');
  panel.setAttribute('aria-label', 'Study controls');
  const header = el('div', 'p-panel-header');
  const navigation = el('nav', 'p-route-nav');
  navigation.setAttribute('aria-label', 'Project');
  if (route !== 'home') {
    const home = el('a', 'p-route-link', 'Home');
    home.href = '#/';
    navigation.append(home);
  }
  navigation.append(el('span', 'p-project-label', route === 'home' ? 'Browser edition' : 'a long table'));
  const subject = el('div', 'p-subject');
  const primary = el('div', 'p-primary-controls');
  const scroll = el('div', 'p-panel-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Editing and tools');
  const sessionControls = el('div', 'p-session-controls');
  const tray = el('div', 'p-tray');
  tray.hidden = true;
  const live = el('output', 'p-sr-only');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const error = el('div', 'p-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const toolsContent = el('div', 'p-tools');
  const previewControls = el('div', 'p-preview-controls');
  const shell: PilotShell = {
    root, stage, subject, primary, sessionControls, tray, toolsContent, previewControls, signal,
    showError(cause) {
      error.replaceChildren(el('strong', '', 'The study needs attention'), el('p', '', cause instanceof Error ? cause.message : String(cause)));
      error.append(action('Dismiss', () => { error.hidden = true; }, signal));
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
      console.error('[UI pilot]', cause);
    },
    status(text) { if (live.textContent !== text) live.textContent = text; },
  };
  const settings = el('details', 'p-settings');
  settings.append(el('summary', '', 'Preview settings'));
  const notes = el('p', 'p-muted', 'Switching experiences, reloading or applying a preview update discards unsaved edits. Download a recipe to keep manual choices.');
  const look = section('Frame study');
  const skin = choices('Frame study', [{ value: 'ink', label: 'Ink / solid' }, { value: 'line', label: 'Line / outlined' }], 'ink', value => {
    root.dataset.skin = value;
  }, signal);
  look.append(skin.element);
  settings.append(look, notes, previewControls);
  header.append(navigation, subject, primary);
  scroll.append(error, sessionControls, tray, toolsContent, settings);
  panel.append(header, scroll);
  root.append(stage, panel, live);
  return shell;
}
