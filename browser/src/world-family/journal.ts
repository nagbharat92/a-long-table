import { el } from '../pilot/ui';

export function islandJournal(): HTMLDetailsElement {
  const history = el('details', 'p-world-journal');
  history.append(el('summary', '', 'Build journal'));
  const journal = el('section');
  journal.setAttribute('aria-label', 'Island build journal');
  journal.append(
    el('h2', 'p-label', 'From texture to landform'),
    el('p', '', 'V2 builds connected terrain from the island generator, then applies world-space materials and lighting. V1 remains available in the same explorer for comparison.'),
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
    ['V2 · Landform', 'Done', 'Island shapes closed by explicit user decision on November 15, 2026. Original ascents restored; no further shape or geometry work planned. This is not completion of playable traversal.'],
    ['V2 · Controlled variation', 'Done', 'Shape review closed by user decision. Fresh coastlines and carved elevation layouts per seed retain shared outer cliff faces without mandatory terrace rings.'],
    ['V2 · Space and proportion', 'Done', 'Shape review closed by user decision. Variable open ground, shelf depth, mass offset and height relationships are retained.'],
    ['V2 · Whole island', 'Done', 'Shape review closed by user decision. Full-scale geometry retains the existing coastline, highland coverage and connection rules. The sun demo shows the island and water without scale characters.'],
    ['V2 · Base grid', 'Original retained', 'The main island base stays on its original four-world-unit grid. The rejected finer coastline experiment and comparison control are retired, with no follow-up phase planned. Existing two-unit beach treads, seabed structures and legacy chamfer code remain unchanged.'],
    ['V2 · Elevation transitions', 'Partial', 'Whole-island ramps are geometry from the existing connection rules. Playable traversal and authored-study transition work are not integrated.'],
    ['V2 · Environment', 'In review', 'V1 habitat fields drive turf, meadow, moss and worn earth. Wet/dry beaches, animated shallow water, normal-based lighting and terrain shadows share world coordinates. Environment and Blockout compare the same seed. This is a visual preview, not visual approval or integrated gameplay.'],
    ['V2 · Base patch scale', 'In review', 'Reverted the coastal base-colour pullback. Base noise now uses a 96-world-unit scale instead of 64 for broader patches. Sand boundaries, crevice-width settings, geometry and water are unchanged.'],
    ['V2 · Grass', 'In review', 'Seeded surface strokes cover all green tops, replacing the rejected isolated clusters. Extra strokes follow actual lower upland junctions and gully banks, independently of colour-patch boundaries. GPU and software share the marks and terrain lighting. Beaches, ground masks and geometry are unchanged; raised tufts remain deferred.'],
    ['V2 · Coastal shading', 'In review', 'Lifted the local sky contribution on low coastal walls so tiny soil and rock faces read less like black dots. Jagged geometry, ground materials, upper cliffs and cast-shadow visibility are unchanged.'],
    ['V2 · Base water', 'In review', 'Replaced bright distance/noise-led coastal color with quiet blue-green water and cached depth from the actual terrain. Shelves remain visible beyond the old shore cutoff. Earlier streaks remain inspection-only. Terrain and lighting are unchanged.'],
    ['V2 · Water surface', 'In review', 'Gentle world-space wave normals catch the existing sun, with soft highlights, sky sheen and guarded bottom refraction. Depth fading hides the deeper seabed. The flat offshore sea and displaced beach band share one coast-damped surface response. Paused and reduced-motion views stay still.'],
    ['V2 · Beach wash', 'In review', 'A gentle displaced beach band covers and uncovers low sand over a slower 8-second cycle. Each connected beach receives one coherent front, with staggered timing between beaches. Dense white leading foam blends gradually back into blue water through a soft, fading trail rather than bright speckled residue. A fading wet-sand trace remains. Mixed contacts feather into a narrow, weak rock-water pulse, never rock run-up. Terrain, seabed palettes and offshore sea level stay fixed. Pause and layer controls cover GPU and software views.'],
    ['V2 · Water art', 'In review', 'Three editable blue depth colours follow the island and shelves even with the seabed hidden. Quiet seeded variation drifts more visibly in shallows than offshore. Wave ends taper displacement, foam and normal response together. Added wave-column attenuation keeps shallow shelf silhouettes beneath arriving water, with seed 153028 as a regression. Controls and reset preserve geometry, sunlight and paused time.'],
    ['V2 · Sun and shadows', 'In review', 'One adjustable sun lights terrain, stairs, beaches, foam and the full ocean. Geometry-based hard, filtered and contact-hardening shadows share direction and sky fill. Controls preserve the island and reproduce their settings in the URL. No new actors or playable traversal are introduced.'],
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
    el('p', 'p-muted', 'V2 has two non-playable views: landform studies use a separate landform seed; Whole island uses the V1 island seed and generation rules. Switching versions starts a fresh session; links preserve supported review settings.'),
  );
  history.append(journal);
  return history;
}
