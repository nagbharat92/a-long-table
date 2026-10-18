# a long table

A small, systems-driven foraging game in the spirit of Forager, built in Godot 4. The plan is to add one element at a time, keep the game playable after each one, and ship once a fixed number of elements is in.

**Play it:** https://nagbharat92.github.io/a-long-table/

Click the character to select it, then click the ground to move. Use **+ / -** or the mouse wheel to zoom and follow it; **Fit** returns to the whole island. Press **R** for a new island.

## What's in it so far

Element 1: the world.

- A seeded 128 x 96 island surrounded by ocean. The same seed always gives the same island.
- **Beaches** where the coast slopes gently into the water, usually in sheltered bays.
- **Cliffs** where the land drops steeply into the water, usually on exposed headlands.
- **Shallows**, the light-blue strip of shallow water up to 6 tiles from shore.

Element 2: one character.

- A small cream-and-sage character with an oversized head, a compact torso, tiny feet and softly lagging ears.
- A clear up-and-down hop, landing squash, slight head/ear follow-through, quiet idle breathing and blinking. Hop cadence follows distance travelled, so shallows slow the animation too.
- A floating gold marker stays above the ears; the shadow and selection ring stay at the ground position while the character bounces.
- Mouse-only indirect movement, with a dotted planned route that disappears on arrival.
- Continuous movement with terrain-weighted pathfinding: grass and sand at normal speed, shallows at 45% speed, deep water and cliff faces blocked. Diagonals cannot cut blocked corners.
- Unreachable clicks resolve to the nearest reachable position with room for the character.
- Zoom follows the selected character. Fit restores the whole island.

Only one character spawns. Navigation is shared, each character owns its movement state, and a separate selection controller commands selected characters. The same interfaces support additional characters and group selection later.

There is no harvesting or building yet.

The current animation baseline is the whole-body hop. The experimental head-led walk was reverted.

## How the island is made

Everything comes from one height field. Land is anything above sea level.

1. Two large, slow noise layers shape the landmass, so islands differ in shape and not only at the edges. A third, finer layer adds a little coastline detail.
2. Two smoothing passes remove single-tile spikes and notches.
3. Only the largest landmass is kept, and enclosed lakes are filled.
4. The coast is shaped by exposure. Sheltered shores slope gently and become beaches. Exposed shores drop steeply and become cliffs.
5. Shallow water is limited to a few tiles from shore.

Later elements are meant to read from the same height field.

## Run locally

Requires Godot 4.7 or later.

- **Editor:** open `project.godot` and press Play.
- **Browser:** serve the `docs/` folder, for example `python3 -m http.server 8765 --directory docs`, then open http://localhost:8765.
- **Character playground:** open http://localhost:8765/?character-lab to compare Idle, Hop and Shallows using the same rig as the game. In Godot, run `character_lab.tscn` directly.

## Tests

```sh
godot --headless --path . --script res://tests/test_island.gd
godot --headless --path . --script res://tests/test_character.gd
godot --path . --script res://tests/test_character_visual.gd
godot --path . --script res://tests/test_interface.gd
```

`test_island.gd` generates 209 seeds and checks the water border, connectivity, sand and shallows placement, and that each seed is reproducible. `test_character.gd` covers obstacles, unreachable targets, cliffs, terrain speed and route costs, continuous motion, redirection, and independent/group commands. `test_character_visual.gd` covers hop height, landing, settling, speed-linked cadence, frame-rate independence, selection bounds and the shared playground rig. `test_interface.gd` checks pointer selection and movement commands, no keyboard movement, zoom/follow/Fit, the R shortcut, and fitting across window sizes. Fit uses whole-number magnification, or reciprocal scales on small screens.

## Publishing the web build

The site is served from `docs/` on the `main` branch.

1. Place the Godot 4.7.2 web templates (`web_nothreads_debug.zip`, `web_nothreads_release.zip`) in `build/templates/`. They are not committed.
2. Export:

   ```sh
   godot --headless --path . --export-release Web docs/index.html
   ```

3. Commit and push `docs/`.

## Project layout

```
scripts/island_generator.gd   height field, coast, and shallows
scripts/terrain_view.gd       pixel-art rendering
scripts/terrain_rules.gd      shared terrain geometry and classification
scripts/world_navigation.gd   weighted routes and reachable destinations
scripts/character.gd          independent movement, selection bounds, marker, route
scripts/character_visual.gd   separate body parts and distance-driven hop
scripts/character_lab.gd      isolated close-up preview of the real character rig
scripts/selection_controller.gd selection and commands for registered characters
scripts/main.gd               scene, camera, mouse input, zoom, R to refresh
tests/                        generation and interface checks
docs/                         exported web build for GitHub Pages
```
