# a long table: browser edition

Browser-native game using Phaser 4.2.1, TypeScript and Vite. Navigation uses EasyStar 0.4.4 directly, not an older Phaser plugin. All game systems run in the browser.

## Run

Requires Node.js 22.12 or newer.

```sh
cd browser
npm ci
npm run dev
```

Open <http://localhost:5185/>.

The home screen links to `#/play`, `#/island`, `#/character`, `#/foraging` and `#/navigation`. Hash destinations work when deployed to a static project subdirectory without server rewrite rules. Each destination can be opened in another tab. Phaser and packed reference data are separate, content-hashed chunks and are not requested by Home.

## Destinations

- **Play:** select the character, click ground to walk, or click a ripe bush to gather. Gathering takes 0.8 seconds and yields 3 berries. Bushes regrow after 20 simulation seconds.
- **Island Explorer:** seeded low/middle/high terrain, ramp connectivity, elevation inspection and authoritative walkability. Experimental relief is not enabled in Play.
- **Character Explorer:** the real 18 x 29 PNG, blink, distance-driven hop and landing squash. Idle/Hop/Shallows use the same animation functions as gameplay. Zoom uses integer source-pixel magnification; Fit restores the largest view that fits.
- **Foraging Explorer:** the real gathering system with bush selection and ripe/depleted/growing fixture controls. Pause freezes simulation time.
- **Navigation Explorer:** an editable terrain fixture or either island mode. Existing EasyStar handles weighted path search; our adapter preserves cliff rules, clearance, continuous destinations and safe route simplification. The fixture editor changes only this session.

Use +/- or the wheel to zoom; F fits the view. R generates another island, or resets the authored navigation/character fixture. Seed changes validate input and preserve the previous world on failure.

Sessions are intentionally temporary: Home/reload starts a fresh simulation. This migration does not add saved inventory or offline progression. Seed, inspection and pause options can be reproduced in the URL, for example `#/island?seed=42&levels=1&paused=1`.

## Shared code and parallel development

`src/core/contracts.ts` defines world, traversal and actor data. World generation and terrain classification live in `world.ts`, pathfinding in `navigation.ts`, and character/gathering state in `game.ts`. `src/render/` is the shared Phaser adapter. Destinations compose these modules instead of copying them.

`src/destinations.ts` is the home registry. Only the active destination mounts a game; Home uses static images captured from the real scenes. Switching destinations disposes the old renderer and listeners. Hidden tabs pause simulation rather than replaying elapsed wall time.

Use separate branch worktrees and preview ports for simultaneous source edits. Worktrees do not share unfinished edits. Integrate contract changes first, then reviewed module changes. Only one writer should change contracts, package/build configuration or the central destination registry at a time.

## Baseline and compatibility

Fixtures in `src/fixtures/reference-*.json` are captured terrain baselines. They contain capture hashes and version identifiers:

- Coastline references: seeds 42, 43 and 12345.
- Separate experimental relief references: seeds 42 and 12345.

These JSON files are plain data, not executable engine code. Production imports only `packed-worlds.json`: shared coastlines are stored once, heights use lossless little-endian float32 bytes, masks/elevations are bit-packed, and ramp IDs are sparse. `npm run fixtures:pack` regenerates it from the original references; builds fail if it is stale. Tests compare every decoded array and ramp against the original data. The historical capture sources are retained separately in a recovery archive, not as a development dependency.

Those seeds preserve the captured terrain arrays exactly. Other seeds use the explicitly versioned browser OpenSimplex2S/Mulberry32 generator. Reference and procedural terrain are separate sources; seed numbers do not imply parity between generators. Seed 43 with relief preserves its reference coastline but uses browser-generated relief. The UI reports which source was used.

Bush placement is deterministic within the browser implementation. The source PNGs are copied unchanged. Permission recorded for the supplied character reference does not imply a broader artwork license. The branded source reference is not part of the browser public assets.

## Validation and builds

```sh
npm run build
npm test
npm run test:browser
npm run test:production
npm run check
npm run capture:previews
```

The browser suite uses the isolated development server and includes real input, gathering, painting, teardown, narrow viewports and density checks. `test:production` builds and checks all destinations and asset requests under `/a-long-table/`, without exposing development debug state. `check` runs the full sequence with one build. Browser checks accept `PLAYWRIGHT_CHANNEL=msedge-canary` to use installed Edge Canary; otherwise install the test browser with `npx playwright install chromium`.

Development traces go to `test-results/browser/` and production traces to `test-results/production/`. The GitHub Actions workflow runs `npm run check` on browser changes and deploys passing `main` builds to GitHub Pages. Pull requests and other branches never deploy.

`capture:previews` requires the development server and updates the five real scene thumbnails; generated review screenshots go to ignored `test-results/manual/`, or `CAPTURE_DIR`.

`npm run build` creates `dist/`, verifies reference freshness and strict types, and enforces JavaScript budgets: Home <=35,000 bytes (<=12,000 gzip); all chunks combined <=1,800,000 bytes (<=530,000 gzip). Gzip figures are computed locally, not a claim about a host's transfer encoding. These budgets include Phaser and protect against accidental eager engine/data loading and oversized regressions.

Deploy `dist/` rather than committing generated output. The live site is <https://nagbharat92.github.io/a-long-table/>. GitHub Pages uses the Actions build source and the `github-pages` environment. Push browser changes to `main`, or manually run **Browser checks and Pages** on `main`, to check and publish the site.
