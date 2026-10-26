# a long table

A small, systems-driven foraging game, built for the browser with Phaser, TypeScript and Vite.

## Run locally

Requires Node.js 22.12 or newer.

```sh
cd browser
npm ci
npm run dev
```

Open <http://localhost:5185/>. The home screen links to Play, Island Explorer, Character Explorer, Foraging Explorer and Navigation Explorer. Each explorer uses the same underlying game systems and can run independently in another tab.

Select the character, click ground to move, or click a ripe bush to gather berries. Use +/- or the mouse wheel to zoom, F to fit, and R to regenerate. Sessions reset when returning Home; there is no saved progression yet.

## Project layout

```text
browser/src/core/           terrain, navigation, character and foraging simulation
browser/src/render/         shared Phaser renderer and pixel artwork adapter
browser/src/destinations.ts  game and explorer registry
browser/src/main.ts          home, routing, controls and inspectors
browser/src/fixtures/        captured reference data and compact runtime encoding
browser/public/             approved character PNGs and real-scene previews
browser/scripts/            reference packing and production size budgets
browser/tests/              simulation, compatibility and browser regression tests
browser/dist/               generated static site (ignored)
```

## Build and checks

From `browser/`:

```sh
npm run build             # exact-reference check, strict types, static build and size budgets
npm test                  # simulation and regression tests
npm run test:browser       # real input, explorers, teardown, layout and display density
npm run test:production    # build and check every destination under /a-long-table/
npm run check             # all of the above, building once
```

Install a Playwright browser with `npx playwright install chromium` if needed. For an installed Edge Canary, prefix browser checks with `PLAYWRIGHT_CHANNEL=msedge-canary`.

GitHub Actions runs the same build, size budgets, unit tests and browser checks for browser-code pushes and pull requests. Development and production browser runs keep separate artifacts so they can run without overwriting one another.

`npm run preview` serves the production build at <http://localhost:5186/>. Relative assets and hash routes support project subdirectories without rewrite rules.

## Publish

The live game is at <https://nagbharat92.github.io/a-long-table/>.

Push browser changes to `main` to run all checks and deploy `browser/dist/` through GitHub Pages Actions. A failed check prevents deployment. The workflow can also be run manually on `main`. Pages must use **GitHub Actions** as its build source; generated output is not committed.

## Browser-native baseline

The project contains only browser code, assets, reference data and web tooling. No external game editor or exported native engine is required.

Captured terrain fixtures remain as **test/reference data**. Their compact runtime representation preserves all captured float32 heights, land masks, elevations and ramp geometry exactly. Other seeds use the versioned browser generator. See [browser documentation](browser/README.md) for compatibility, controls and parallel-development boundaries.
