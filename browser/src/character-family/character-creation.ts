import {
  characterRigRecipe, createCharacterRig, localRigAngle, rigParts, rigPose, RIG_HEIGHT, RIG_PART_SHAPE, RIG_POSITION_LIMIT, RIG_WIDTH, validateRigState,
  type CharacterRigState, type CharacterSpecies,
} from './core/character-rig';
import type { Point } from './core/contracts';
import type { GameView } from './render/game-view';

export interface CharacterCreation {
  pick(point: Point): void;
  activate(): void;
  reset(): void;
  getState(): CharacterRigState;
  setSpecies(species: CharacterSpecies): void;
}

export function mountCharacterCreation(
  panel: HTMLElement,
  view: GameView,
  signal: AbortSignal,
  onError: (error: unknown) => void,
  onChange: () => void,
  getCharacterRecipe?: () => object,
): CharacterCreation {
  let state = createCharacterRig();
  const savedStates = new Map<CharacterSpecies, CharacterRigState>();
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attributes: Record<string, string> = {}): HTMLElementTagNameMap[K] {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
    return result;
  }
  function listen(target: EventTarget, type: string, action: () => void): void {
    target.addEventListener(type, () => {
      try { action(); } catch (cause) { onError(cause); sync(); }
    }, { signal });
  }
  function commit(change: (next: CharacterRigState) => void): void {
    const next = structuredClone(state);
    change(next);
    validateRigState(next);
    view.setCharacterRig(next);
    view.setCharacterSetup(next);
    state = next;
    onChange();
    sync();
  }
  const partControls = node('section', undefined, { role: 'group', 'aria-label': 'Selected part' });
  const rigControls = node('section', undefined, { role: 'group', 'aria-label': 'Whole rig' });
  panel.append(partControls);
  function range(
    label: string, min: number, max: number, parent = partControls, step = 1,
  ): { input: HTMLInputElement; output: HTMLOutputElement } {
    const row = node('label', undefined, { class: 'rig-range' });
    const caption = node('span', label);
    const output = node('output', '', { 'aria-live': 'off' });
    const input = node('input', undefined, { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
    row.append(caption, output, input);
    parent.append(row);
    return { input, output };
  }
  const title = node('label', 'Part', { for: 'rig-part', class: 'rig-part-label' });
  const select = node('select', undefined, { id: 'rig-part', 'aria-label': 'Character part' });
  partControls.append(title, select);
  listen(select, 'change', () => {
    const id = rigParts(state).find(part => part.id === select.value)?.id;
    if (!id) throw new Error('Choose an existing character part.');
    commit(next => { next.selected = id; });
  });
  const shape = range('Squash / stretch', -100, 100);
  listen(shape.input, 'input', () => commit(next => { rigPose(next, next.selected).squashStretch = Number(shape.input.value) / 100; }));
  const angle = range('Angle', -12, 12);
  angle.input.title = 'Edit the selected part. Ends Range test without changing other parts\u2019 saved angles.';
  listen(angle.input, 'input', () => commit(next => {
    rigPose(next, next.selected).angle = Number(angle.input.value);
    next.stress = 0;
  }));
  const positionControls = node('div', undefined, { role: 'group', 'aria-label': 'Part positioning' });
  partControls.append(positionControls);
  function positionRange(axis: 'x' | 'y'): { input: HTMLInputElement; output: HTMLOutputElement } {
    const control = range(`Position ${axis.toUpperCase()}`, -RIG_POSITION_LIMIT, RIG_POSITION_LIMIT, positionControls, 0.5);
    control.input.title = `Offset in parent-local source pixels. ${axis === 'x' ? 'Positive moves right.' : 'Positive moves down.'} Does not change the setup pivot.`;
    listen(control.input, 'input', () => commit(next => { rigPose(next, next.selected).offset[axis] = Number(control.input.value); }));
    return control;
  }
  const positionX = positionRange('x');
  const positionY = positionRange('y');
  const resetPosition = node('button', 'Reset position', { type: 'button', class: 'rig-position-reset' });
  listen(resetPosition, 'click', () => commit(next => { rigPose(next, next.selected).offset = { x: 0, y: 0 }; }));
  positionControls.append(resetPosition);
  rigControls.append(node('h2', 'Whole rig'));
  panel.append(rigControls);
  const explode = range('Explode', 0, 100, rigControls);
  listen(explode.input, 'input', () => commit(next => { next.explode = Number(explode.input.value) / 100; }));
  const stress = range('Range test', -100, 100, rigControls);
  listen(stress.input, 'input', () => commit(next => { next.stress = Number(stress.input.value) / 100; }));
  stress.input.title = 'Pose all joints within their trial limits. Assemble the character to inspect seams.';
  const toggles = node('div', undefined, { class: 'row rig-toggles', role: 'group', 'aria-label': 'Rig overlays' });
  function toggle(label: string, key: 'joints' | 'padding'): HTMLButtonElement {
    const control = node('button', label, { type: 'button', 'aria-pressed': String(state[key]) });
    listen(control, 'click', () => commit(next => { next[key] = !next[key]; }));
    toggles.append(control);
    return control;
  }
  const joints = toggle('Joints', 'joints');
  const padding = toggle('Joint pads', 'padding');
  rigControls.append(toggles);
  const audit = node('output', '', {
    class: 'rig-audit', 'aria-label': 'Joint center check', 'aria-live': 'polite',
    title: 'Checks nine points in a 1 by 1 source-pixel area at each assembled joint. This is not a guarantee of clean outlines or all poses.',
  });
  rigControls.append(audit);
  const details = node('details', undefined, { class: 'rig-details' });
  details.append(node('summary', 'Pivot'));
  const pivotFields = node('div', undefined, { class: 'rig-pivot-fields' });
  function pivotInput(axis: 'x' | 'y', max: number): HTMLInputElement {
    const label = node('label', `Pivot ${axis.toUpperCase()}`);
    const input = node('input', undefined, {
      type: 'number', min: '0', max: String(max), step: '0.5', 'aria-label': `Pivot ${axis.toUpperCase()}`,
    });
    listen(input, 'change', () => {
      if (!input.value.trim() || !input.checkValidity()) throw new Error(`Pivot ${axis.toUpperCase()} must be from 0 to ${max} source pixels, in half-pixel steps.`);
      commit(next => { rigPose(next, next.selected).pivot[axis] = Number(input.value); });
    });
    label.append(input);
    pivotFields.append(label);
    return input;
  }
  const pivotX = pivotInput('x', RIG_WIDTH);
  const pivotY = pivotInput('y', RIG_HEIGHT);
  details.append(pivotFields);
  partControls.append(details);
  const rigData = node('details', undefined, { class: 'rig-details' });
  rigData.append(node('summary', 'Rig data'));
  const note = node('p', 'Trial rig. Hidden joint pixels are inferred, not recovered from the sprite.');
  rigData.append(note);
  const download = node('button', 'Download rig', { type: 'button' });
  listen(download, 'click', () => {
    const recipe = { ...characterRigRecipe(state), character: getCharacterRecipe?.() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' }));
    const link = node('a', undefined, { href: url, download: `${state.species ?? 'rabbit'}-rig.json` });
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  rigData.append(download);
  rigControls.append(rigData);
  const reset = node('button', 'Reset rig', { type: 'button', class: 'rig-reset' });
  function resetRig(): void {
    commit(next => Object.assign(next, createCharacterRig(state.species)));
  }
  listen(reset, 'click', resetRig);
  panel.append(reset);

  function sync(): void {
    const parts = rigParts(state);
    const ids = parts.map(part => part.id);
    // Keep the familiar control order; optional nodes are appended for their species.
    const ordered = ['body', 'head', 'left-ear', 'right-ear', 'left-arm', 'right-arm', 'left-foot', 'right-foot', 'tail'];
    const options = ordered.filter(id => ids.some(candidate => candidate === id));
    if ([...select.options].map(option => option.value).join() !== options.join()) {
      select.replaceChildren(...options.map(id => node('option', parts.find(part => part.id === id)!.name, { value: id })));
    }
    const part = parts.find(candidate => candidate.id === state.selected)!;
    const pose = rigPose(state, state.selected), offset = pose.offset;
    positionX.input.value = String(offset.x);
    positionY.input.value = String(offset.y);
    positionX.output.value = `${offset.x} px`;
    positionY.output.value = `${offset.y} px`;
    resetPosition.disabled = offset.x === 0 && offset.y === 0;
    select.value = state.selected;
    explode.input.value = String(Math.round(state.explode * 100));
    explode.output.value = `${Math.round(state.explode * 100)}%`;
    const squashStretch = pose.squashStretch;
    shape.input.title = `Reshape ${part.name.toLowerCase()} around its pivot. Squash: ${RIG_PART_SHAPE.squash.y * 100}% height, ${RIG_PART_SHAPE.squash.x * 100}% width. Stretch: ${RIG_PART_SHAPE.stretch.y * 100}% height, ${RIG_PART_SHAPE.stretch.x * 100}% width. Child attachments follow without resizing their artwork.`;
    shape.input.value = String(Math.round(squashStretch * 100));
    const shapeLabel = squashStretch === 0 ? 'Neutral'
      : `${squashStretch < 0 ? 'Squash' : 'Stretch'} ${Math.round(Math.abs(squashStretch) * 100)}%`;
    shape.output.value = shapeLabel;
    shape.input.setAttribute('aria-valuetext', shapeLabel);
    angle.input.min = String(-part.limit);
    angle.input.max = String(part.limit);
    angle.input.value = String(localRigAngle(state, part));
    angle.output.value = `${localRigAngle(state, part).toFixed(1).replace(/\.0$/, '')}\u00b0`;
    stress.input.value = String(Math.round(state.stress * 100));
    stress.output.value = `${Math.round(state.stress * 100)}%`;
    joints.setAttribute('aria-pressed', String(state.joints));
    padding.setAttribute('aria-pressed', String(state.padding));
    pivotX.value = String(pose.pivot.x);
    pivotY.value = String(pose.pivot.y);
    const result = view.getCharacterRigAudit();
    if (!result) throw new Error('The character joint check is not available.');
    const gaps = result.uncoveredJoints;
    audit.value = state.explode > 0 ? 'Assemble to inspect joints'
      : gaps.length ? `Check ${gaps.map(id => rigParts(state).find(part => part.id === id)!.name.toLowerCase()).join(', ')}`
        : `${result.jointCount} joint centers covered`;
    audit.classList.toggle('has-gaps', state.explode === 0 && gaps.length > 0);
  }
  view.setCharacterRig(state);
  view.setCharacterSetup(state);
  sync();
  return {
    pick(point) {
      const id = view.pickCharacterRigPart(point);
      if (id) commit(next => { next.selected = id; });
    },
    activate() { view.setCharacterRig(state); sync(); },
    reset: resetRig,
    getState: () => structuredClone(state),
    setSpecies(species) {
      if ((state.species ?? 'rabbit') === species) return;
      savedStates.set(state.species ?? 'rabbit', structuredClone(state));
      const next = savedStates.get(species) ?? createCharacterRig(species);
      commit(current => {
        delete current.species;
        Object.assign(current, structuredClone(next));
      });
    },
  };
}
