import type { PilotShell } from '../pilot/ui';

interface Host {
  shell: PilotShell;
  read?: () => unknown;
  failed: boolean;
}

const hosts = new WeakMap<HTMLElement, Host>();

export function attachHost(root: HTMLElement, shell: PilotShell): { snapshot(): unknown; hasError(): boolean; release(): void } {
  const host: Host = { shell, failed: false };
  hosts.set(root, host);
  return {
    snapshot: () => host.read?.() ?? null,
    hasError: () => host.failed,
    release: () => { hosts.delete(root); },
  };
}

export function registerSnapshot(root: HTMLElement, read: () => unknown): void {
  const host = hosts.get(root);
  if (host) host.read = read;
}

export function reportError(root: HTMLElement, cause: unknown): void {
  const host = hosts.get(root);
  if (!host) return;
  host.failed = true;
  host.shell.status('The foliage preview needs attention.');
  host.shell.showError(cause);
}

/** Mount source-owned nodes directly into the shell before controls are populated. */
export function presentExplorer(root: HTMLElement, main: HTMLElement): void {
  const shell = hosts.get(root)?.shell;
  if (!shell) throw new Error('Foliage Explorer requires a pilot host.');
  const stage = main.querySelector<HTMLElement>('.forage-stage');
  const controls = main.querySelector<HTMLElement>('.customization-parameters');
  const primary = main.querySelector<HTMLElement>('.customization-footer');
  const library = main.querySelector<HTMLElement>('.forage-library');
  if (!stage || !controls || !primary || !library) throw new Error('The foliage editor is missing its scene or controls.');
  const comparison = stage.querySelector<HTMLElement>('.grass-study');
  shell.stage.append(stage);
  shell.sessionControls.append(library);
  shell.primary.append(primary);
  shell.tray.hidden = false;
  shell.tray.append(controls);
  if (comparison) {
    const details = document.createElement('details');
    details.className = 'foliage-comparisons';
    const summary = document.createElement('summary');
    summary.textContent = 'Compare silhouettes & motion';
    details.append(summary, comparison);
    shell.toolsContent.append(details);
  }
}

export function exportPng(canvas: HTMLCanvasElement, filename: string, signal: AbortSignal, fail: (cause: unknown) => void): void {
  canvas.toBlob(blob => {
    if (signal.aborted) return;
    if (!blob) { fail(new Error('Could not export the foliage PNG.')); return; }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
