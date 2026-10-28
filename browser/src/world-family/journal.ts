import { el } from '../pilot/ui';

// Verbatim build-journal content from the upstream island-versions.ts snapshot.
export function islandJournal(): HTMLDetailsElement {
  const history = el('details', 'p-world-journal');
  history.append(el('summary', '', 'Build journal'));
  const journal = el('section');
  journal.setAttribute('aria-label', 'Island build journal');
  journal.append(
    el('h2', 'p-label', 'From texture to landform'),
    el('p', '', 'We are rebuilding the island around connected shapes before adding surface detail. V1 keeps the original result available for comparison.'),
  );
  const table = el('table');
  const heading = el('tr');
  for (const title of ['Milestone', 'Status', 'What changed and why']) {
    const th = el('th', '', title);
    th.scope = 'col';
    heading.append(th);
  }
  const head = el('thead');
  head.append(heading);
  const body = el('tbody');
  for (const [milestone, status, explanation] of [
    ['V1 · Original island', 'Preserved', 'Generated terrain with textured ground, contour cliffs and stairs. Frozen on October 28, 2026.'],
    ['V2 · Landform', 'In review', 'One untextured island with connected elevations. Test silhouette, volume and scale before surface detail.'],
    ['V2 · Controlled variation', 'In review', 'Fresh coastlines and carved elevation layouts per seed, replacing stretched-reference variations. Shared outer cliff faces avoid mandatory terrace rings. Compare with the unchanged reference; structural checks are not visual approval.'],
    ['V2 · Space and proportion', 'In review', 'Variable open ground, shelf depth, mass offset and height relationships. Fixed lighting and character scale keep the comparison about form, not decoration.'],
    ['V2 · Elevation transitions', 'Planned', 'Make routes and openings belong to the landform. Not built yet.'],
    ['V2 · Materials', 'Planned', 'Add surface treatment after the shapes and transitions are resolved. Not built yet.'],
    ['V2 · Playable generation', 'Planned', 'Integrate reviewed shapes and connected routes with playable island generation. Not built yet.'],
  ]) {
    const row = el('tr');
    const th = el('th', '', milestone);
    th.scope = 'row';
    row.append(th, el('td', '', status), el('td', '', explanation));
    body.append(row);
  }
  table.append(head, body);
  journal.append(table,
    el('p', '', 'Posting outline: show V1, explain the shape problem, then compare each reviewed V2 milestone. Capture the version, seed and view with each image. Planned work is not a finished result.'),
    el('p', 'p-muted', 'V2 is a non-playable study with an authored reference and a separate landform seed, not a regenerated version of the V1 seed. Switching versions starts a fresh session; the link preserves supported review settings.'),
  );
  history.append(journal);
  return history;
}
