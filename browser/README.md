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

Home pairs a live island preview with pinned Play and a directory of complete explorer families: `#/character`, `#/foliage`, `#/island` and `#/navigation`. `#/ui` is development tooling. Old `#/foraging` and `#/trees` links open Foliage. Hash destinations work in static project subdirectories. Phaser and reference data remain separately chunked, but the live Home now requests them asynchronously.

The approved right-panel UI was migrated into this main project on October 28, 2026. `src/pilot/` is the shared application shell and adapters, not a separate app or checkout. Character includes Bunny, Bear and Cat with Creation, Motion and Customization. Foliage contains all 16 asset editors, including Trees. Island retains V1, V2, their journals and the frozen V1 link. Navigation retains terrain editing and route inspection. Generate stays pinned above each explorer's scrolling controls. There is no global experience tab strip.

`npm run dev` holds updates independently per tab on port 5185. Apply an update explicitly in Preview settings. Private Character, Foliage, world-family, Home/UI and Play changes notify only their matching routes; shared or unknown files notify all routes. Old chunks remain available until the preview exits. After a server restart, apply an update before navigating to an experience not previously loaded. `npm run dev:hot` opts into Vite HMR on port 5187. `npm run preview` serves the production build on port 5186 without update controls. All servers bind loopback and fail if the port is occupied.

Each route starts a fresh session. Seeds reproduce generated choices, not manual edits. Reloading, leaving a route or applying an update discards unsaved state; download recipes first when needed. Category changes and tabs within an explorer preserve its manual edits. This migration adds no save system.

## Original simulation and rig reference

The following details describe the retained Play model and original rig implementation. The integrated explorer-family adapters above supersede the old page layouts and route-specific controls below. Character-family, foliage-family and world-family modules are versioned inside this repository; they do not depend on sibling project folders.

- **Play:** select the character, click ground to walk, or click a ripe bush to gather. Gathering takes 0.8 seconds and yields 3 berries. Bushes regrow after 20 simulation seconds.
- **Island Explorer:** seeded low/middle/high terrain, ramp connectivity, elevation inspection and authoritative walkability. Experimental relief is not enabled in Play.
- **Character Explorer:** one top bar and one panel, with separate Creation and Motion controls. Creation opens an eight-part trial rig of the approved 18 x 29 rabbit, with exploded inspection, part selection, pivots, angles and joint pads. Motion performs the expressive articulated hop shared with gameplay, with independent head, ears, arms, feet, eyes and nose. Open `#/character?tab=motion` directly for Motion. Zoom uses integer source-pixel magnification; Fit restores the largest view that fits.
- **Foraging Explorer:** the real gathering system with bush selection and ripe/depleted/growing fixture controls. Pause freezes simulation time.
- **Navigation Explorer:** an editable terrain fixture or either island mode. Existing EasyStar handles weighted path search; our adapter preserves cliff rules, clearance, continuous destinations and safe route simplification. The fixture editor changes only this session.

Use +/- or the wheel to zoom; F fits the view. R generates another island, or resets the authored navigation/character fixture. Seed changes validate input and preserve the previous world on failure.

Sessions are intentionally temporary: Home/reload starts a fresh simulation. This migration does not add saved inventory or offline progression. Seed, inspection and pause options can be reproduced in the URL, for example `#/island?seed=42&levels=1&paused=1`.

## Character rig exploration

The first experiment uses layered cutout parts, not a mesh deforming the entire sprite. Body is the root; head follows body, ears follow head, and arms and feet follow body. Transform parenting is independent from attachment draw order. The supplied sprite has no separately visible elbows, knees or tail, so this recipe does not invent them.

Creation supports clicking a visible part or choosing it in the panel. **Squash / stretch**, **Angle**, **Position X/Y** and **Pivot** edit that selected part. The separate **Whole rig** section contains **Explode**, **Range test**, **Joints**, **Joint pads** and **Rig data** / **Download rig**. Explode spreads the pieces for inspection; Range test previews all joint angles. Editing an angle ends that preview without overwriting other parts' saved angles. Joints draws the hierarchy and pivots; Joint pads highlights authored joint fill and hidden torso outlines. R or **Reset rig** restores the initial setup. Creation freezes the shared motion clock; switching modes preserves each mode's zoom and controls.

Creation always supports **Position X/Y** for the selected part, from -3 to +3 source pixels in half-pixel steps, relative to its parent's axes (positive X is right; positive Y is down before parent rotation). Positioning is the sole rig model; the Original comparison was retired on 2026-10-25. Moving the head also moves its ears; moving the body moves the whole hierarchy. Setup pivots and rotation behavior are unchanged. **Reset position** clears only the selected part's offset. **Reset rig** or R clears all edits. Offsets survive visits to Motion within the same Character Explorer session, but not Home/reload. The position range is exploratory, not a gap-free guarantee; translation does not reconstruct hidden joint artwork. Motion and gameplay are unchanged.

**Squash / stretch** edits the selected part, with independent values remembered for all eight parts. This selected-part rule replaces the body-only control (2026-10-25). Its exaggerated endpoints are intended for single-frame squash and stretch experiments: full left is 20% height and 200% width; center is the exact neutral shape; full right is 250% height and 40% width. Intermediate values interpolate linearly from Neutral. These endpoints replace the mild trial range (2026-10-25). Scaling happens around that part's current pivot. With Head selected, the head changes shape, ear attachments follow, and the body, arms and feet stay unchanged. Children keep their own artwork scale; their separate shape edits are preserved. With Body selected, head and shoulder attachments follow while foot poses stay fixed; selecting a foot explicitly reshapes that foot. This is not IK, and manual edits can expose gaps. Shaping never rewrites pivots, local angles or offsets; manual offsets and Explode spacing are not scaled. **Reset rig** or R restores all parts to Neutral; **Reset position** clears only the selected part's offset. Shape values survive selection changes and visits to Motion in this session but do not alter Motion or gameplay. Pose edits preserve the current zoom. **Fit** / F frames the actual deformed, rotated and exploded bounds; zoom controls can still magnify the pose for inspection.

The recipe lives in `src/core/character-rig.ts`; its Phaser attachment renderer is `src/render/character-rig.ts`, and creation controls are isolated in `src/character-creation.ts`. The recipe partitions existing visible pixels and samples the original palette for joint underpainting. The complete forehead, including the shared outline at source row 6, belongs to Head. Ear cutouts contain only their stems above that row, and their default pivots sit on the shared boundary at Y = 6. This prevents forehead strokes from remaining rigid inside independently positioned ears during head deformation. Arm cuts follow their actual stepped silhouettes instead of rectangular torso slices. Body has its own hidden fill, side strokes and lower hip border behind the arms and feet, so its contour deforms with Body rather than borrowing fragments from independently shaped limbs. The feet retain their original cutouts, pivots and shaping behavior. Joint pads also highlights the authored torso underpainting. These hidden pixels are authored, not recovered. The assembled zero-angle, Neutral layers reproduce the original RGBA image without changing either PNG. Explode is an inspection offset only: it never changes bind pivots or exported geometry.

**Limits:** hidden pixels are inferred, not recovered artwork. Trial angles are deliberately small: body +/-6 degrees, head and feet +/-12, arms +/-18, ears +/-22. These are exploration limits, not a guarantee for every combination of manual edits. The on-screen check samples nine points in a 1 x 1 source-pixel area at each of seven assembled joint centers; it does not certify the surrounding silhouette, outlines, arbitrary pivots or every possible pose. Pixel-art rotations still need visual review and potentially hand-corrected replacement frames. Motion and gameplay now use the same cutout artwork with their own authored pose curves, not Creation's temporary edits.

Downloads contain a versioned JSON recipe with source registration, ownership priority, attachment order, hierarchy, rounded pads, ordered torso underpainting, edited pivots, trial limits and the current effective pose. The source `rabbit.png` is required separately. There is no arbitrary-sprite import, hidden-art reconstruction, rig re-import, paint editor, IK, timeline or mesh editor in this first experiment. Edits remain in this tab until Home/reload unless exported.

Downloads use version 5, include parent-local pose offsets and their trial limit, and keep setup pivots separate. Each layer's optional `underpainting` records ordered source-palette samples and rectangles, applied after rounded pads but before owned source pixels, only where the original image is opaque. This is required to reproduce the completed torso behind its limbs. `partShape` records the scale endpoints and attachment inheritance rule. Each part's pose records its normalized `squashStretch` amount (-1 to 1) and current local scale, including zero / unit values at Neutral. Children inherit rotation and attachment displacement, not artwork scale. Body shaping leaves foot attachments unscaled. Explode remains inspection-only.

### Shared expressive hop

The shared hop is now articulated instead of scaling a single flat sprite. Its authored cycle has a grounded windup, quick push, floating apex, reach, compressed contact, rebound and settle. Body leads the impulse; head follows later. Both ears follow one shared world-space head response with slightly different compliance, rather than opposing inward/outward wave tracks. Arms hang toward gravity while carrying the body's motion, and feet push, tuck and reach. Eyes squint into effort and contact, open on takeoff, and move with the head; the original three-pixel nose has its own delayed bob. The supplied blink drawing and 4.7-second cadence remain in use. Head has no duplicate facial marks under those moving features.

Animation-specific ankle and shoulder pivots keep the moving limbs seated. A gravity-biased, critically damped angular response is sampled in seconds from primary head/body motion. The upright ear support and hanging arm response have different restoring behavior, but left/right pairs share a world-space direction. There are no separate mirrored angle or translation tracks pulling the ears together. Secondary angles are converted back to parent-local coordinates before rendering, with soft joint limits and an eased return to Neutral.

`src/core/character-kinematics.ts` solves single-link attachment and endpoint targets against the actual rig transforms. During grounded poses the feet keep flat soles on the contact plane while the body leans above them. They release smoothly into flight, follow the stretching hip with a small tuck, then return to contact without penetrating the floor. Targets are relative to the rabbit's current ground anchor; physical path traversal is unchanged. These are constrained cutout attachment solves, not a new multi-bone skeleton, terrain foot-placement system or soft-body simulation. Creation's setup pivots and independent manual positioning model are unchanged.

`src/core/character-motion.ts` samples smooth cyclic curves from an explicit, elapsed-time hop clock. Cadence eases toward actual travel speed rather than jumping immediately to it; physical `gaitDistance` remains the exact travelled distance. The steady-state cycle now spans 14 nominal world units (about 0.64 seconds at normal speed), replacing the crowded 9-unit cycle. Landing begins at 62% of the cycle, leaving about 0.24 seconds for grounded recovery at full speed. Maximum visual lift remains 2.4 world units. Shallows ease into a slower cadence naturally.

The recovery pass (2026-10-25) preserves the expressive launch but removes the rapid late head/ear counter-swings. Shape-preserving primary tracks and the shared secondary response settle to exact Neutral with zero endpoint velocity. A committed hop finishes its flight, landing and recovery after movement stops; a cancelled grounded windup eases out without inventing a jump. Head, appendages and face still recover with delayed follow-through. The subsequent gravity/contact pass replaces mirrored secondary poses with coherent world-space response and foot endpoint constraints. These changes do not move the ground anchor or change navigation, physical movement speed, harvesting or collision terrain. `characterPose` exposes the body summary; selection bounds include the articulated silhouette rather than a flat scaled rectangle.

`src/core/motion-clock.ts` analytically integrates eased speeds in elapsed seconds, including the distance under the speed curve. This avoids frame-dependent interpolation. Phaser's frame-count-based delta averaging is disabled via its supported `fps.smoothStep` setting. The view advances each visible frame with actual elapsed time instead of quantizing poses into 60 Hz steps; `GameSimulation` retains its existing internal movement substeps. Pause and hidden tabs do not accumulate catch-up time. A frame stalled longer than 0.25 seconds discards the excess instead of replaying a backlog. Timing is checked through the engine update path at 15, 30, 60, 120 and 144 Hz and with irregular frame intervals, including start, stop, restart and live speed changes.

`src/core/character-face.ts` separates the supplied eyes and nose only for Motion. `src/render/rabbit-motion.ts` attaches those features to the transformed head and renders all eight cutouts with nearest-neighbor filtering. At a fresh neutral pose the assembled drawing still reproduces the approved source pixels. Neither PNG is rewritten. Creation keeps its eight-part model, edit values, overlays, export and separate zoom.

Motion adds **Speed** (1x, 0.5x, 0.25x), **Frame** and **Cycle**. Live speed changes ease in elapsed time; changing speed while paused sets the rate for the next playback. Frame pauses and advances exactly 1/60 second of animation for inspection, independent of playback speed or display refresh rate. Cycle pauses and inspects a normalized hop pose without changing the character's ground position; choose Hop or Shallows to use it. Idle finishes an already committed hop and settles into a grounded bob, disables cycle posing, and can still be stepped to inspect recovery, idle or blinking. Slow playback affects only this Character Explorer tab, not gameplay. These controls and Creation edits remain session-local; reload/Home resets them.

Motion uses one gravity-biased **Follow-through** animation, shared with gameplay. The Stiff and Exaggerated experiments and their selector were removed on 2026-10-26. Head translation retains its two-dimensional cubic path with shared vector tangents, avoiding a stop at every pose key. The existing camera frame, floor-contact solve, non-mirrored pairs, facial attachments, elapsed-time clock and playback controls are unchanged. Creation's trial limits, edits and exports are unchanged.

The centering/idle pass (2026-10-26) centers the resting 18 x 29 silhouette in both Character Explorer tabs. Motion keeps a stable, symmetric frame with room for the full hop rather than following the idle or jumping pose.

The approved [Pinterest-reference revision](https://www.pinterest.com/pin/360288038962695642/) (2026-10-26) replaces the earlier 2.4-second elastic breath with a quicker 0.8-second grounded bob. The original Neutral drawing is the high pose; the torso settles 1.95 source pixels down over planted soles before pushing back up. The follow-through refinement increases the head/ear translation delays from 0.02/0.04 seconds to 0.11/0.16 seconds: the body drops first, then the head, and the body rises before the head catches up. The difference between the current body pose and delayed head pose also rocks the head gently in each direction; ears inherit that rocking 0.05 seconds later. The head and ear artwork keep their original proportions. An additional 0.45-pixel head dip seats the lowered pose, while torso height changes only from 100% to 99.04% as supporting squash. This direction supersedes the previous request for stronger head/torso deformation; no reference artwork is copied. Curves use elapsed animation time with smooth endpoints and an exact Neutral start, not frame-count-based or stepped playback. Locomotion weight blends the bob and wobble out on movement and back in after recovery. Gameplay gets the same idle; Creation remains a frozen editable rig. The hop, camera, pausing, stepping, slow playback, blinks and physical navigation retain their existing behavior.

The fast-hop smoothing pass (2026-10-26) reduces the torso squash-and-stretch amounts by half at normal running cadence (22 world units/second). The reduction eases in with zero endpoint slopes between Shallows cadence (9.9) and running cadence, so live terrain/speed transitions do not switch shapes abruptly. Shallows and slower cadences retain their exact authored shape tracks; Idle is unchanged. Jump height, flight timing, head shaping, head/ear follow-through angles, facial tracks, ground anchor, physical travel and playback controls are unchanged. Feet and arms continue solving against the softened torso instead of using stale attachment targets.

Character cutouts, facial features and Creation overlays use a dedicated single-texture WebGL batch through Phaser's render-node API. Phaser 4.2.1's multi-texture shader compares interpolated texture IDs with exact equality, which can discard fragments of rotated quads. Keeping these images on texture unit zero preserves their pixels without changing poses, artwork, filtering or the engine. Terrain and other scene objects retain their default multi-texture batching.

### Research basis

The recommended direction is a hybrid: rigid layered parts and rounded overlaps first, replacement drawings where rotations break the intended pixel silhouette, and selective mesh deformation only if a specific part requires it. No additional runtime dependency was added.

- [Spine: preparing assets](https://esotericsoftware.com/blog/How-to-cut-your-assets-for-animation) recommends drawing hidden portions, rounded overlapping ends, and separate front/back layers. A flattened sprite does not contain the artwork behind an occluding part.
- [Spine: images](https://esotericsoftware.com/spine-images) requires a separate image for each independently moving part. [Slots](https://esotericsoftware.com/spine-slots) decouple draw order from bones.
- [Spine: weights](https://esotericsoftware.com/spine-weights) describes weighted mesh deformation and recommends testing maximum motion ranges. Meshes add deformation controls, not missing artwork.
- [Spriter: getting started](https://brashmonkey.com/spriter_manual/getting%20started.htm) covers shoulder pivots, extreme-pose ordering checks and aligned image swaps.
- [Aseprite: rotation](https://www.aseprite.org/docs/rotate/) demonstrates different raster rotation algorithms. Nearest-neighbor sampling keeps hard colors but does not preserve every pixel cluster at arbitrary angles.
- [PixiMelon: pixel art idle animation](https://piximelon.com/guides/pixel-art-idle-animation/) describes a small chest rise, shoulders following and delayed secondary motion. [Sprite AI: idle loops](https://www.sprite-ai.art/guides/how-to-animate-pixel-art) illustrates rest/exhale/inhale poses. The initial breathing implementation used these principles. The subsequent approved Pinterest comparison shifts the existing cutout rig toward shape-stable vertical posing with continuous timing, rather than copying artwork or adopting fixed-frame playback.

## Shared code and parallel development

`src/core/contracts.ts` defines world, traversal and actor data. World generation and terrain classification live in `world.ts`, pathfinding in `navigation.ts`, and character/gathering state in `game.ts`. `src/render/` is the shared Phaser adapter. Destinations compose these modules instead of copying them.

`src/pilot/directory.ts` is the Home and route registry; `src/main.ts` mounts one explorer at a time and disposes its renderer and listeners on navigation. Home uses a live island. Hidden tabs pause simulation rather than replaying elapsed wall time.

The family modules were integrated from the approved UI pilot's source snapshots. Provenance records and `source-baseline.sha256` document the captured origins, not current live links. Island's panel-integrated V1 is not byte-identical to its frozen deployment; `public/world-family/v1/` retains that artifact. Other source worktrees remain untouched. Future edits should target this project's modules rather than update sibling copies.

Use separate branch worktrees and preview ports for simultaneous source edits. Worktrees do not share unfinished edits. Integrate contract changes first, then reviewed module changes. Only one writer should change contracts, package/build configuration or the central destination registry at a time.

## Baseline and compatibility

Fixtures in `src/fixtures/reference-*.json` are captured terrain baselines. They contain capture hashes and version identifiers:

- Coastline references: seeds 42, 43 and 12345.
- Separate experimental relief references: seeds 42 and 12345.

These JSON files are plain data, not executable engine code. Production imports only `packed-worlds.json`: shared coastlines are stored once, heights use lossless little-endian float32 bytes, masks/elevations are bit-packed, and ramp IDs are sparse. `npm run fixtures:pack` regenerates it from the original references; builds fail if it is stale. Tests compare every decoded array and ramp against the original data. The historical capture sources are retained separately in a recovery archive, not as a development dependency.

Those seeds preserve the captured terrain arrays exactly. Other seeds use the explicitly versioned browser OpenSimplex2S/Mulberry32 generator. Reference and procedural terrain are separate sources; seed numbers do not imply parity between generators. Seed 43 with relief preserves its reference coastline but uses browser-generated relief. The UI reports which source was used.

Bush placement is deterministic within the browser implementation. The source PNGs are copied unchanged. Permission recorded for the supplied character reference does not imply a broader artwork license. The branded source reference is not part of the browser public assets.

The favicon uses `public/assets/rabbit-head.png`: the first 19 rows of the original rabbit, including its ears, scaled uniformly 3x with nearest-neighbor sampling and centered on a transparent 64 x 64 canvas. The full-body game sprites remain unchanged.

## Validation and builds

```sh
npm run build
npm test
npm run test:browser
npm run test:world-family
npm run test:preview
npm run test:production
npm run check
npm run capture:previews
```

The browser suite uses a task-owned production preview and covers complete explorer families, real input, gathering, editing, teardown and narrow viewports. Original `tests/browser/` layout checks are retained as historical references; `tests/pilot/` is the integrated UI acceptance suite. `test:production` builds and checks every family and asset requests under `/a-long-table/`, with no development update controls. The read-only `window.__pilot` inspection surface supports interaction checks, not simulation mutation. `test:preview` changes disposable fixtures only. `check` runs the full sequence with one build. Browser checks accept `PLAYWRIGHT_CHANNEL=msedge-canary` to use installed Edge Canary; otherwise install the test browser with `npx playwright install chromium`.

Family acceptance traces go to `test-results/pilot/`, held-update traces to `test-results/preview/` and deployment traces to `test-results/production/`. The GitHub Actions workflow runs `npm run check` on browser changes and deploys passing `main` builds to GitHub Pages. Pull requests and other branches never deploy.

`capture:previews` is retained for the historical page layout, not the current explorer-family shell.

`npm run build` creates `dist/`, verifies reference freshness and strict types, and enforces JavaScript budgets: initial entry <=35,000 bytes (<=12,000 gzip); all chunks combined <=2,750,000 bytes (<=950,000 gzip). The combined budget includes the newly integrated complete explorer families, Phaser and reference data. The live Home loads its scene asynchronously; the initial-entry budget still rejects static engine/data imports. Gzip figures are computed locally, not a claim about a host's transfer encoding.

Deploy `dist/` rather than committing generated output. The live site is <https://nagbharat92.github.io/a-long-table/>. GitHub Pages uses the Actions build source and the `github-pages` environment. Push browser changes to `main`, or manually run **Browser checks and Pages** on `main`, to check and publish the site.
