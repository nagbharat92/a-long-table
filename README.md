# Tile Lab

A small, systems-driven foraging game in the spirit of Forager, built in Godot 4. The plan is to add one element at a time, keep the game playable after each one, and ship once a fixed number of elements is in.

**Play it:** https://nagbharat92.github.io/tile-lab/

Press **R** for a new island.

## What's in it so far

Element 1: the world.

- A seeded 64 x 48 island surrounded by ocean. The same seed always gives the same island.
- **Beaches** where the coast slopes gently into the water, usually in sheltered bays.
- **Cliffs** where the land drops steeply into the water, usually on exposed headlands.
- **Shallows**, the light-blue strip of shallow water up to 3 tiles from shore.

There is no player, harvesting, or building yet. Element 2 is a player walking on the island.

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

## Tests

```sh
godot --headless --path . --script res://tests/test_island.gd
godot --path . --script res://tests/test_interface.gd
```

`test_island.gd` generates 209 seeds and checks the water border, connectivity, sand and shallows placement, and that each seed is reproducible. `test_interface.gd` checks the R shortcut, and that the island fits on screen at whole-number zoom across several window sizes.

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
scripts/main.gd               camera, text overlay, R to refresh
tests/                        generation and interface checks
docs/                         exported web build for GitHub Pages
```
