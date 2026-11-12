# Player movement performance QA

Deterministic harness for reproducing and measuring player-mode stutter while moving across the streamed world.

> The 2026-11-12 grass/shadow comparison is recorded in
> [grass-shadow-perf-2026-11-12.md](grass-shadow-perf-2026-11-12.md): 16 accepted
> headed NVIDIA WebGPU captures, A/B/A/B at grassland, closed rainforest,
> forest and town, `6f297b70` against `11484f90`. Current averages are
> 118.7–120.7, 109.9–110.5, 103.7–105.7 and 92.0–99.5 FPS respectively at
> 1280 × 720. All current collision and two-second recovery gates pass;
> frame p95 is below 16.667 ms, but individual frame spikes remain, up to
> 98.6 ms in town. GPU mean deltas are +0.113 / +0.691 / +0.551 / +0.048 ms:
> the two forest cases exceed the normal +0.20 ms stage budget, mainly in
> non-shadow render passes. One town sample exceeds the +0.25 ms CPU budget
> by 0.025 ms. The report preserves rejected focus-loss attempts, the shared
> stale-atlas limitation and the exact scope; this is not a full stress matrix.

> Dense-meadow buffer changes, the 21 test-fixture corrections, repeated hardware
> captures, and the passing 2026-10-07 matrix are recorded in
> [dense-grass-test-fixes-2026-10-07.md](dense-grass-test-fixes-2026-10-07.md).
> Grass preparation still lags movement; that report includes endpoint coverage
> and post-stop recovery alongside the hitch results.

> Authored terrain locality, worker-derived edited pages, construction geometry
> workers and spatial residency, and worker failure handling are recorded in
> [runtime-review-fixes-2026-10-07.md](runtime-review-fixes-2026-10-07.md).

> The prepared terrain/vegetation work and hardware captures for 2026-10-04
> are recorded in [perf-investigation-2026-10-04.md](perf-investigation-2026-10-04.md).
> Settle now includes scenery preparation. Older captures can have incomplete
> vegetation at measurement start even when their original settle gate passed.

> The 2026-07-25 collapse to 3 FPS and its fixes are written up in
> [perf-investigation-2026-07-25.md](perf-investigation-2026-07-25.md), including
> the two harness defects that made earlier numbers untrustworthy. Read that before
> comparing against any report captured before that date.
>
> The 2026-07-28 collapse to ~20 FPS is written up in
> [perf-investigation-2026-07-28.md](perf-investigation-2026-07-28.md). Short
> version: any material sampling `viewportDepthTexture` or
> `viewportOpaqueMipTexture` costs a full colour copy, depth copy and mip chain
> **per frame for the whole scene**. The cost is binary — one such mesh costs the
> same as forty, and hiding or frustum-culling them saves nothing; the nodes have
> to not be compiled in. Check `waterChunksRefractive` before blaming geometry
> for a whole-scene collapse. That document also records a residual `stylized`
> phase regression from the same day that has **not** been bisected yet.
>
> The 2026-07-29 critical-path review, harness fixes, density/construction/water
> matrix, and remaining cold-streaming costs are documented in
> [perf-investigation-2026-07-29.md](perf-investigation-2026-07-29.md).

## Quick start

```bash
# Terminal 1 — app must already be serving
npm run dev

# Terminal 2 — headed Chromium is required for authoritative WebGPU numbers
npm run qa:perf -- --headed

# Optional: print a short parse summary
npm run qa:perf:parse

# Vegetation density + construction wall + water acceptance matrix
npm run qa:perf:matrix -- --headed
```

From WSL, use the Windows browser to access the host's hardware WebGPU adapter:

```bash
# Keep Vite running in WSL; Windows can reach it through localhost.
npm run qa:perf:windows -- --qa chunk-cross --warmup 8 --duration 12 --settle
```

This command discovers Windows `node.exe` through PowerShell and launches the
existing harness in headed Windows Playwright Chromium. It requires Node.js and
the matching Playwright Chromium installed on Windows; the Linux browser download
does not install the Windows binary. If the browser is missing, run
`node node_modules/playwright/cli.js install chromium` from a Windows terminal in
this checkout. Reports are written to this checkout's `tmp` directory, and the
existing checks still reject software adapters and WebGL rendering.

WSL can expose an NVIDIA GPU through `/dev/dxg` even without `/dev/dri`.
`nvidia-smi` and `glxinfo -B` can confirm that bridge, but accelerated OpenGL does
not prove that the Linux browser can create a WebGPU adapter. On this WSL setup,
Windows Chromium selected the NVIDIA Lovelace adapter and executed a WebGPU
compute shader with `isFallbackAdapter: false`; Linux Chromium returned no
adapter. No driver replacement is needed for the Windows harness route.
See [Microsoft's WSL GPU documentation](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)
and [Playwright's browser installation guide](https://playwright.dev/docs/browsers).

Or open the app with query params (overlay + optional JSON download):

```text
http://localhost:5173/?qa=chunk-cross&warmup=2&duration=12&speed=run&download=0
```

When a run finishes, the report is available as:

- `tmp/perf-qa-latest.json` (CLI runner)
- `window.__perfQa.getReport()` / `window.__perfQaReport` (browser)
- automatic download when `download=1` (default in the browser)

## Query parameters

| Param | Default | Meaning |
|-------|---------|---------|
| `qa` | — | Scenario id, or `1` / `true` → `move` |
| `x`, `z` | `0` | Spawn pose (render-space) |
| `yaw`, `pitch` | `0` | Look angles in degrees |
| `warmup` | `2` | Seconds to settle streaming before measuring |
| `settle` | off | After `warmup`, wait for collision, terrain, construction, and scenery preparation to remain ready for 60 consecutive frames. Scenery includes prepared fields, manifests, meadow compaction, material jobs, variants, and draw preparation. `scenario.settle` records the additional wait or timeout blockers. |
| `settleTimeout` | `120` | Seconds `settle` may wait past `warmup` before measuring anyway |
| `duration` | `12` (`20` for `chunk-cross`) | Measured motion seconds |
| `speed` | `run` | `walk` or `run` |
| `explorationBoost` | off | `1` enables the configured fast-travel multiplier; recorded with effective player settings |
| `spellWorld` | on | `0` compiles the terrain and meadow without the spell world light, the spell press-and-mark map and grass marks — the A/B control for spell work that touches world shaders (see [spell VFX](spell-vfx.md)) |
| `biomeSnow` | on | `0` zeroes every snow column of the biome look table (`config/biome-looks.yaml`): no biome ground snow, canopy caps, grass frost, snow-country air or regional snowfall — the A/B control for biome snow work (see [biome looks](biome-looks.md)). Snow above the terrain's snow line stays |
| `seaPolish` | on | `0` disables the new surf and crossing ripple layers for A/B controls; resolved settings remain in the report |
| `hitchMs` | `~33.3` | Frame-dt threshold that counts as a hitch |
| `autostart` | `1` | Start as soon as stylized assets are ready |
| `download` | `1` | Auto-download the JSON report when done |
| `density` | `standard` | `standard`, `dense-forest`, `high-grass`, or `dense-mixed` QA load envelope |
| `gpuTimings` | off | `1` samples asynchronous WebGPU render-pass timestamps every eight measured frames. The optional `gpuRender` report includes totals and render-context timings. Unsupported adapters are reported explicitly. |
| `constructionStyle` | default style | Wall style key for the `construction-ring` walls (and the castle captures that reuse them); an unknown key falls back to the default |

### Scenarios

| Id | Behavior |
|----|----------|
| `move` | Hold forward (`W`, +Shift when running) |
| `strafe` | Hold right (`D`) |
| `diagonal` | Hold `W`+`D` |
| `chunk-cross` | Long forward run intended to cross chunk boundaries |
| `edited-world` | Authored biome/height patches, a distant override, and paint/sculpt every three seconds during diagonal movement |
| `object-town` | Deterministic 64/256-building masonry town; set `buildings=64` or `256` |
| `settlement-approach` | Frozen Eldara map, imported burg 18; approach its main street. `--revisit --turn-on-revisit` repeats in the same browser and turns the camera 180 degrees halfway through the return run. |
| `construction-ring` | Twelve deterministic 96 m wall constructions around a clear movement corridor (see the note below before using it to measure walls) |
| `water-acceptance` | External phase driver: dry → swim → dive → surface → dry |

**Measuring walls with `construction-ring`.** The walls run from z = -48 to 48,
and the default spawn (0, -24) faces -z, so the player leaves the corridor in
about two seconds and spends the rest of the run with every wall behind the
camera: the default run measures terrain streaming, not walls. To measure walls,
approach them instead and compare styles with `constructionStyle`:

```bash
npm run qa:perf -- --headed --qa construction-ring --x 0 --z -100 --yaw 180   --warmup 40 --duration 12 --settle --constructionStyle coursed-rubble
```

From z = -100 a 12 s run crosses every wall LOD band and ends inside the
corridor. Use `--settle`: the first frame compiles for 25–30 s, and a time
based warmup that ends inside that stall starts measuring with streaming and
collision still in flight. On 2026-09-26 one such run recorded 29 frames at
3 FPS with the player standing still, waiting for collision. Discard a run
whose `scenario.settle.settled` is false.

Density profiles are QA-only multipliers applied before worker and stylized
systems are created. `dense-forest` doubles tree placement/candidate budgets,
`high-grass` doubles `bladesPerCell`, and `dense-mixed` does both. They do not
change Azgaar biome IDs, tile persistence, or production configuration.
When the active grass system is meadow, the grass profiles also double each
meadow band's density and the far-card density. The matrix checks those active
densities; changing only the unused clump setting does not establish meadow stress.

The harness enters walk mode at a fixed pose, bypasses pointer lock, and injects keys so runs are repeatable without mouse capture.

## What the report contains

Report kind: `simcity-dnd-perf-qa` (version `2`).

- **Scenario + config snapshot** — spawn, keys, density profile, hitch threshold, and player/world/stylized knobs used for the run
- **Summary** — frame count, duration, avg FPS, dt min/p50/p95/p99/max/mean, hitch count/rate
- **Phase timings** — CPU time inside the animation loop for:
  - `terrainCommit` (budgeted memcpy commits from the worker page queue)
  - `player`
  - `floatingOrigin`
  - `streaming` (sync kickoff of `updateStreaming` only)
  - `stylized`
  - `voxel`
  - `render`
- **Counters** — totals for grass/flower/tree/rock rebuilds, terrain slot assigns/uploads, floating-origin snaps
- **Backend gauges** — `rendererWebGPUBackend` / `rendererWebGLBackend` make an unexpected fallback visible in every report
- **Water CPU gauges** — `waterProjectedCausticCpuMs` measures the post-effect
  excluding its scene pass; `waterProjectedCausticSceneCpuMs` measures that pass,
  and `waterProjectedCausticPipelineCpuMs` preserves their total. Older reports
  called the whole pipeline the caustic cost. Use frame timings and the full
  pipeline gauge when assessing dive stalls; passing the effect's 4 ms gate
  does not excuse a scene-rendering hitch.
- **Hitch frames** — every frame with `dt > hitchMs`, including phase breakdown, counter deltas, streaming/voxel/player snapshots
- **Samples** — downsampled frames, plus any hitch, expensive phase (≥8 ms), or non-empty counter-delta frame

## CLI scripts

| Script | Role |
|--------|------|
| `npm run qa:perf` | `scripts/run-perf-qa.mjs` — Playwright Chromium, waits for `window.__perfQa.status === 'done'`, writes `tmp/perf-qa-latest.json` |
| `npm run qa:perf:matrix` | Runs standard/dense-forest/high-grass/dense-mixed, the construction corridor, imported settlement approach and camera-turn revisit, then the deterministic water acceptance route; writes `tmp/perf-matrix-latest.json` |
| `npm run qa:perf:parse` | `scripts/parse-perf-qa.mjs` — prints a short summary from a report or CDP extract JSON |
| `npm run qa:look` | `scripts/run-environment-look-qa.mjs` — 38 biome, hour and weather shots with canopy checks and luminance gates; writes PNGs, JPEGs, a contact sheet and `report.json` |

`qa:look` requires the dev server on port 5174 and holds the shared
`tmp/perf-browser-<platform>.lock` for its entire headed hardware WebGPU run.
It exits non-zero on failed look gates, biome/canopy checks or browser errors;
its captures are visual evidence, not performance measurements.

`--resources` on the movement runner or matrix records
`capture.resourcesAfterRecovery` using the existing tracked-world accounting.
It runs after measured movement and recovery. It counts scene geometry/instance
arrays, material texture sources/mips, prepared placement arrays and interaction
buffers; it is not driver GPU memory or a whole-process memory measurement.

The matrix is a gate, not only a batch runner. It exits non-zero unless:

- all required cases produced measured frames on WebGPU with no WebGL backend;
- collision readiness and its p95 gate passed in every movement case;
- measured p95 stayed at or below 33.3 ms and hitch rate at or below 2%;
- the report proves the requested tree/candidate/grass multipliers were applied;
- meadow cases record movement-end coverage, reach full scenery readiness within
  two seconds after stopping, and finish recovery with no missing or
  below-density in-view grass tiles;
- the construction corridor had at least 12 resident wall modules and non-zero masonry;
- the imported settlement workload was active and its same-browser camera-turn revisit passed the frame, collision, settling and meadow recovery gates;
- the water route passed entry, swim, dive, surface, dry-exit, caustic, origin, and frame gates.

The direct movement runner also exits non-zero on initial or revisit settling
timeout, after saving the diagnostic report. A timed-out capture is not acceptance
evidence. Matrix summaries retain `measuredCounters` for actual meadow page
publication, repacking, mandatory origin maintenance, deferred pages, settlement
plan/index work, placement evaluations and instance-row comparisons. Source
admission bytes and actual page-write bytes are separate measurements.

Deterministic CPU work-count comparisons for these paths are recorded in
[critical-path-review-fixes-2026-10-19.md](critical-path-review-fixes-2026-10-19.md).
They do not replace hardware frame pacing or scenery-recovery acceptance.

The next review's registry cache, isolated settlement worker, retries, skyline
publication/readiness and durable simulation history are recorded in
[critical-path-second-review-fixes-2026-10-20.md](critical-path-second-review-fixes-2026-10-20.md).
That report includes deterministic work-count comparisons, real Chromium worker
and IndexedDB checks, and passing production verification after rebaking the
stale tree atlas. Hardware frame pacing remains unverified.

The verdict and any failure messages are stored in `gate` inside
`tmp/perf-matrix-latest.json`. The runner also owns
`tmp/perf-matrix.lock`; a concurrent matrix exits immediately instead of
silently sharing the GPU and corrupting both measurements. A stale lock is
recovered when its recorded PID is no longer alive.

Matrix movement cases observe up to 20 seconds of recovery and record
`recovery.grass` separately from full scenery readiness. Grass-only recovery
does not replace the two-second full recovery gate. Implementation and retained
hardware evidence are documented in
[performance-improvements-2026-10-16.md](performance-improvements-2026-10-16.md).

Recovery now uses the last retained movement frame as a conservative time
origin. Movement-end detail/grass snapshots stay in the page while recovery is
observed; the large frame report transfers afterward, so its serialization
cannot block the recovery it measures. `recovery.observerDelayMs` records the
remaining handoff before observation begins. This delay is no longer free
recovery time. Older captures
timed only from observer entry, so compare their recovery figures with that
limitation. Frame pacing statistics still include only measured movement.

Performance, water-acceptance, and Gods’ End asset browser runners also share
`tmp/perf-browser-<platform>.lock`. They wait for the previous hardware browser
run to close before launching Chromium; waiting times out after five minutes.
This guards those runners, not manually opened app tabs or concurrent CPU builds.

Extra CLI flags for `qa:perf`:

```bash
npm run qa:perf -- --qa move --duration 8 --warmup 1 --speed walk --url http://localhost:5173
npm run qa:perf -- --headed --qa object-town --buildings 256 --warmup 8 --duration 14
npm run qa:perf -- --headed --qa diagonal --density dense-mixed --warmup 8 --duration 14
npm run qa:perf -- --headed --qa construction-ring --warmup 10 --duration 14
npm run qa:perf -- --headed --cpu-profile tmp/diagonal.cpuprofile
npm run qa:perf -- --headed --qa edited-world --warmup 8 --duration 12 --settle --drain-seconds 15
npm run qa:perf -- --headed --qa construction-ring --settle --gpuTimings 1
npm run qa:perf:matrix -- --headed --warmup 8 --duration 8
npm run qa:perf:matrix -- --headed --water-only
npm run qa:perf -- --headed
```

`--drain-seconds 15` observes scenery readiness after the measured keys are
released. Its separate `recovery` result does not enter movement FPS statistics.
`--revisit` restarts the same route in the same browser and records a separate
`revisit` report. Add `--turn-on-revisit` for a 180° camera turn halfway through
that second measurement; the report records this route override explicitly.
With `--drain-seconds`, both measurements receive separate recovery observations.
`--grass-diagnostics` adds bounded end-of-movement tile diagnostics to each leg.
`meadowVisibleMissingTiles` counts the whole drawable range;
`meadowInViewMissingTiles` counts the conservative horizontal viewing cone.
Their density-lag counterparts track lower-capacity publications. The cone
prioritizes preparation and is not a renderer frustum-culling change.

The runner records bounded scenery queue snapshots once per second during warmup,
stopping before measured movement starts. `preparationQueuesDuringWarmup` helps
identify settle blockers; `preparationQueuesAtStart` can already include work
from the first movement frame. Neither diagnostic enters the measured phase.

Browser exceptions and `console.error` messages invalidate a capture. The runner
saves their count and a bounded list in `capture.browserErrors`, preserves the
report, and exits non-zero. Check this evidence before quoting FPS; failed asset
loading can change the scene to a cheaper or more expensive fallback. Capture
against frozen runtime sources: an HMR reload can change the workload and clear
caches during a run.

Headed performance captures also activate their own test window and retain
`capture.focus`. Losing foreground focus invalidates the capture. A background
window can produce different CPU/render scheduling despite the frame-rate and
background-throttling flags. On Windows, `capture.focus.native` verifies the
foreground window's process ID every 100 ms. DOM focus alone is insufficient:
Chromium can report `document.hasFocus() === true` while another application owns
the Windows foreground. The monitor activates only the browser PID identified
through the current Playwright connection. It does not close or modify other
windows. Keep that test window foreground during movement and recovery; a failed
focus record is not an engine timing result. Older DOM-only focus records cannot
establish native foreground ownership.

The movement and water runners activate their owned blank window before loading
the app, then start a fresh document/native focus observation as soon as navigation
commits. This lets Windows activate the window before cold shader compilation can
block it; it does not bypass foreground checks during the workload.
If `AppActivate` is refused, startup temporarily joins the helper's input queue
to the foreground queue and calls `SetForegroundWindow` on the CDP-owned browser's
main window. The queues are detached immediately. Activation ends before monitoring;
the monitor never reacquires focus to conceal a foreground loss.

Run `node scripts/check-perf-browser-focus.mjs` with Windows Node to verify the
monitor. Its two owned test windows check both successful activation and rejection
of a background browser whose emulated DOM focus still reports true. The control
records native samples and exits non-zero if either check fails.

The runner rejects software/fallback adapters. Headless Chromium commonly fails
that gate on Windows, so use `--headed` for comparisons. `--cpu-profile` writes
a Chrome sampled CPU profile alongside the JSON without making profiling the
default measurement path.

## Code map

| Path | Role |
|------|------|
| `src/editor/world/ChunkRenderPixels.js` | Worker/main tilePixels + halo chamfer surface-mask pixels |
| `src/editor/world/TerrainCommitQueue.js` | Frame-budgeted memcpy commits (max 1/frame, ~2 ms) |
| `src/editor/world/generateWorldChunk.js` | Worker page generation including render pixels |
| `src/editor/stylized/chunkRockSignature.js` | Per-chunk rock influence signatures for grass |
| `src/editor/stylized/StylizedBuildQueue.js` | Frame-budgeted grass/flower heavy builds |
| `src/editor/performance/qa/PerfQaHarness.js` | Orchestration, overlay, `window.__perfQa` |
| `src/editor/performance/qa/FrameProfiler.js` | Per-frame dt + phase marks |
| `src/editor/performance/qa/PerfCounters.js` | Global rebuild/upload counters |
| `src/editor/performance/qa/parseQaParams.js` | URL scenario parsing |
| `src/editor/performance/qa/buildPerfReport.js` | JSON report assembly |
| `src/main.js` | Phase marks around the live animation loop |
| `src/editor/player/PlayerController.js` | Harness input bypass (`setHarnessActive` / `setHarnessKeys` / `setPose`) |

Counters are incremented from stylized rebuild paths and terrain `assignSlot` / `uploadPage` commit.

## Close other tabs rendering the app

A second browser tab running the app renders continuously against the same GPU and
silently ruins a run. Measured on 2026-07-26, identical code and scenario:

| | With an app tab open elsewhere | Tab closed |
|--|--|--|
| Avg FPS | 141, 148, 158 | 202, 205, 208 |
| Hitches | 10, 11, 11 | 5, 7, 8, 9 |

That is a ~30% swing — far larger than most changes worth measuring, and it points
the wrong way (it looks exactly like a regression in whatever you just changed).
The harness cannot detect it. **Close every other tab serving the app before an A/B,
and be suspicious of any run whose absolute FPS is well below the usual band.**

## Attribution caveat

Frame `dt` comes from `requestAnimationFrame` timestamps. Long **async** main-thread work that finishes *between* frames (for example `assignSlot` after a worker fetch) shows up as a large `dt` on the *next* callback, while that hitch frame’s phase timers can look cheap.

So:

- Large `dt` + `terrainUploadPages` / `loading > 0` → treat as streaming/commit hitch
- Large `phases.stylized` (or other phase) on a sample → sync CPU cost inside that named section
- Expensive sync work on frame N can inflate `dt` on frame N+1

## Baseline finding (chunk-cross)

Captured against local Vite (`?qa=chunk-cross&warmup=2&duration=12&speed=run&hitchMs=33.3`) in the Cursor/Electron WebGPU host.

| Metric | Value |
|--------|-------|
| Avg FPS | ~100.9 |
| dt p50 / p95 / p99 | ~6.9 / 7.0 / 14 ms |
| Max dt | ~1048 ms |
| Hitches (`>33.3` ms) | 11 (~0.91% of frames) |

**Counters (one run):** 9 grass, 6 flower, 1 tree, 1 rock rebuilds; 7 terrain assigns; 7 terrain uploads; 0 floating-origin snaps.

### Interpretation

1. Steady-state walking is smooth (p95 ≈ 7 ms).
2. The stutter reproduces as a **chunk-boundary streaming spike**, not continuous grass/player CPU.
3. Strongest hitch cluster (~frames 1107–1113): focus moved `0:0 → 0:1`, `loading` counted down `6 → 0`, and each hitch coincided with `terrainUploadPages` increments. Spike train roughly **1049 → 340 → ~290 ms**.
4. Early hitches (~150–250 ms) appeared right after the measure phase began (post-warmup settle).
5. Phase timers on those hitch frames stayed small (~2–14 ms), which matches async upload work completing outside the marked loop body.
6. `stylized` phase max reached ~948 ms once (rebuild spike); keep samples that include counter deltas / expensive phases when diagnosing rebuild cost.

### Measured: grass `residentRadius` 1 → 2 is a regression (2026-07-26)

A cheap far blade band was added (`nearRadius` rings keep the tapered five-triangle
blade, rings beyond it drop to a single triangle) so that grass geometry could reach
past the near ring. The draw-side saving is real — 40 triangles per clump down to 8 —
but the extra ring is **not** affordable on it.

`--qa chunk-cross --warmup 2 --duration 12 --speed run`, two runs each:

| Metric | `residentRadius: 2` | `residentRadius: 1` |
|--------|--------------------|---------------------|
| Hitches (>33.3 ms) | 11, 10 | 5, 8 |
| dt p95 | 6.3, 8.77 ms | 6.19, 6.6 ms |
| dt p99 | 11.8, 15.1 ms | 10.7, 13.6 ms |
| Avg FPS | 195, 174 | 201, 191 |
| `grassBuildSlices` | 36 | 12 |
| `grassScatterMs` | 58.2 | 21.6 |
| `attributeBytesUploaded` | 33.3 MB | 27.0 MB |

**Why:** the cost is in *building* the ring, not drawing it. A far-ring chunk still
runs full per-chunk scatter generation — `outerRingDensity` halves its clump count
but `buildCells` still walks every cell — so 16 extra chunks tripled the grass build
slices. Cheaper blades cannot pay that back.

**Before raising `residentRadius` again,** make far-ring scatter coarser (skip cells
rather than only thinning clumps per cell). The band machinery itself stays in place
and costs nothing when no ring reaches past `nearRadius`: `farGeometry` is not even
allocated in that case.

The band is no longer inert, though — see "grass two-band LOD and density coverage"
below, which sets `nearRadius: 0` so the eight chunks around the camera take the
cheap blade without adding a ring, and reworks the per-chunk build this measurement
blamed. That measurement predates the rework, so it is the baseline to re-run
against rather than the current answer.

### Measured: grass density 4× is free, `bladesPerClump` is the lever (2026-07-26)

Counterpart to the finding above. Blades are baked into the clump's **shared**
vertex buffer, so an instance is a clump, not a blade:

```
clumpsPerCell = ceil(bladesPerCell / bladesPerClump)
```

Only `clumpsPerCell` drives instance memory, per-chunk build work and buffer
uploads. `bladesPerClump` is paid once in a buffer shared by every instance, and
after that only in raster. Raising **both together** multiplies visible density
while holding `clumpsPerCell` fixed.

`48/8` → `192/32` (4× blades, `clumpsPerCell` 6 either way):

| Metric | 48 / 8 | 192 / 32 | 384 / 64 |
|--------|--------|----------|----------|
| Effective blades per chunk | 97,400 | **389,600** | 779,200 |
| Clumps (instances) | 12,175 | 12,175 | 12,175 |
| `grassBuildSlices` | 12 | 12 | 12 |
| `grassInstanceAttributeBytes` | 340,900 | 340,900 | 340,900 |
| Hitches (>33.3 ms) | 7, 5, 8 | 5, 8, 8 | 11 |
| dt p95 | 6.5, 6.19, 6.6 | 6.4, 6.49, 6.8 | 6.5 |
| dt p99 | 13.4, 10.7, 13.6 | 11.3, 12.0, 15.1 | 13.4 |

4× density is indistinguishable from baseline — every streaming counter is byte
identical and the frame metrics sit inside run-to-run spread. **8× (384/64) is
where it starts to cost**: 11 hitches on its single run, at the top of the spread.
Settled on `192/32`; go higher only with more runs than one.

Raising `bladesPerCell` *alone* is the expensive form — it increases
`clumpsPerCell`, which is the streaming-cost term.

**Clump footprint** (`CLUMP_RADIUS` in `StylizedGrassSlot.js`) is separate and also
close to free. The first pass went 3.55 → 7.5 blade-widths, spreading each clump
from 0.24 m to 0.51 m; this measured at 203.8/207.9 FPS before and 201.6/204.7
after, hitches 7/5 → 9/8. The upstream-parity pass then moved to the upstream
0.06 m blade width and a 12.5 blade-width footprint (0.75 m radius), because the
barely-overlapping 7.5 footprint still exposed circular tufts at player height.
The same low-discrepancy clump records now overlap into visually continuous cover;
the follow-up A/B is recorded below. `clumpsFormCarpet` in `grassLodMath.js`
guards the relationship if density changes again.

`chunk-cross --warmup 8 --duration 14 --speed run`, real NVIDIA WebGPU adapter:

| Metric | 7.5 footprint, pre-parity sample | 12.5 footprint + per-blade parity |
|--------|----------------------------------|-----------------------------------|
| Avg FPS | 193.7 | 200.5, 208.7 |
| dt p95 | 7.4 ms | 6.4, 6.9 ms |
| dt p99 | 11.4 ms | 8.4, 8.9 ms |
| Hitches (>33.3 ms) | 3 | 5, 5 |
| Grass build slices | 12 | 12, 12 |
| Last-chunk clumps | 12,173 | 12,173, 12,173 |
| Last-chunk effective blades | 389,536 | 389,536, 389,536 |

The extra footprint and per-blade centre/facing attributes do not increase
streaming work or instance uploads. Frame throughput improved within normal
run-to-run variance; the two extra hitches are in the historical 5–9 spread and
did not move p95/p99 upward.

### Grass two-band LOD and density coverage (2026-09-27, **A/B outstanding**)

Three changes, all in the grass pass. Only the first is expected to move frames;
the second and third are about where the cost lands and what the falloff looks
like.

**1. The far band is live.** `nearRadius` is now 0 instead of 1, so the eight chunks
around the camera draw the single-triangle blade and only the camera's own chunk
keeps the tapered five-triangle one. This adds no ring and no chunk — the resident
set is the same nine chunks either way — so it is a pure draw-side saving of 40
triangles per clump to 8 across eight of the nine chunks, with no extra build work.
Before this, `nearRadius === residentRadius` meant `farGeometry` was never built at
all and the band did nothing.

**2. The per-chunk build no longer lands in one frame.** A page arrives from the
worker at the world's full density; the chunk then takes a prefix of each cell's
clumps, removes what the canopy covers, and uploads. That was two passes over two
freshly allocated copies of the chunk — roughly 1.4 MB of garbage and two full
walks — inside a single frame. It is now one resumable pass
(`grassScatterBuild.js`) writing straight into the instance buffers:
`streaming.grassScatterGroupsPerSlice` source cells a frame, sixteen frames for a
64² page. Nothing is allocated, and the canopy filter is applied in the same pass
the prefix is taken in.

This is aimed directly at the `residentRadius: 2` regression above, whose cost was
`grassScatterMs` and build slices rather than drawing. It does **not** make the
worker's scatter coarser, which is what that measurement asked for, so a second ring
is still a separate decision.

**3. Ring boundaries are thinned instead of stepped.** The per-ring compaction can
only keep whole clumps per cell, so a chunk's density is a step and the boundary
between two rings is where it shows. `stylizedSurface.grass.lod.coverage` retires
blades by their own rank to make up the difference, evaluated per blade from the
blade's distance to the camera, so the falloff is continuous in space rather than
per chunk. The last ring also thins out over `outerFadeMeters` past the residency
radius, which hands over to the terrain shader's faked ground cover and stops a
chunk popping as it enters residency.

Cost: a handful of arithmetic per blade plus one `vec4` uniform write per chunk per
frame. It thins (blades are removed) rather than shrinks blades, and widens the
survivors by the retired share, capped at 1.35x — the donor's measured fill limit.

**Not measured on hardware.** The numbers above are reasoned from the triangle and
allocation counts, not taken from a run: this pass had no GPU machine. Run
`qa:perf --qa chunk-cross --warmup 8 --duration 12` plus `qa:perf:matrix` before
treating any of it as settled, and compare `grassLodNearChunks` /
`grassLodFarChunks` / `grassLodNearTriangles` / `grassLodFarTriangles` (new
counters) against `grassBuildSlices` and `grassScatterMs` for the same run. The
specific things to look for:

| What | Where | Expected |
|------|-------|----------|
| The far band is drawing | `grassLodFarChunks` > 0, `grassLodFarTriangles` ≈ ⅕ of near per clump | 8 chunks on the cheap blade |
| Build spread over frames | `grassBuildSlices` per rebuild | 16 per chunk, not 1 |
| No allocation churn | hitch count during chunk-cross | at or below the 5–8 baseline spread |
| The falloff is a gradient | walk a straight line out of the grass ring and watch `grassLodRetiredShare` | rises smoothly, no step at a ring line |

If the hitch count rises, `streaming.grassScatterGroupsPerSlice` is the dial: lower
it to spread each chunk over more frames, at the cost of grass appearing later.

### Fix landed: worker render pixels + commit queue

**Root hitch cause:** CPU `writeSurfaceMaskPixels` did O(chunkCells × searchArea) `getTile` neighbor scans on the main thread when committing a streamed page (~331k `getTile` calls per 64² page).

**Current path:**

1. Worker generates **render-ready pages**: `tiles`, `heights`, `tilePixels`, `surfaceMaskPixels`, plus optional `grassScatter` / `flowerScatter`.
2. Surface mask uses halo fill + two-pass chamfer distance transform in `ChunkRenderPixels.js` (O(halo²), no nested `getTile` storms).
3. Main-thread commit is typed-array copies + `needsUpdate` only (`TerrainCommitQueue`, default `maxCommitsPerFrame: 1`, `commitBudgetMs: 2`).
4. Concurrent worker requests stay parallel; only commits are serialized.
5. Per-chunk rock signatures (`chunkRockSignature.js`) and grass/flower/tree/rock build queues (`StylizedBuildQueue`) keep stylized rebuilds scoped and budgeted.
6. Grass/flower/instance attribute uploads use Three.js `updateRanges` (WebGPU partial `writeBuffer`) so only used instances are uploaded.
7. Grass geometry no longer rebuilds when rocks stream — rock influence is the trample texture only.

| Path | Role |
|------|------|
| `src/editor/world/ChunkRenderPixels.js` | Halo + chamfer DT mask + tilePixels |
| `src/editor/world/TerrainCommitQueue.js` | Budgeted memcpy commit queue |
| `src/editor/InfiniteTerrainView.js` | Slot wiring, `flushUploadQueue` → commit drain, editor `uploadPage` |
| `src/editor/stylized/StylizedBuildQueue.js` | Grass/flower/tree/rock builds per frame |
| `src/editor/stylized/vegetationScatter.js` | Worker/main grass + flower scatter builders |
| `src/editor/stylized/attributeUpload.js` | Partial attribute upload ranges |

### Harness must run on real hardware

`run-perf-qa.mjs` launches Chromium with `--ignore-gpu-blocklist --use-angle=default
--enable-gpu-rasterization` plus `--disable-gpu-vsync --disable-frame-rate-limit`, and
aborts with exit code 2 if WebGPU resolves to a software adapter.

Both matter:

- With only `--enable-unsafe-webgpu`, headless Chromium quietly falls back to a
  software adapter. Runs then report ~1 FPS regardless of code quality, and a
  scenario can collapse to a single multi-second frame — the report still writes,
  so the numbers look real.
- With vsync on, everything above the refresh rate reads as a flat 60 FPS, so a
  regression stays invisible until it drops under the cap.

The adapter is recorded as `adapter` in the report. Treat any run without it, or
with `fallback: true`, as void.

Until 2026-10-21 the editor's JS heap sat at 2.3–3.3 GB at ordinary poses, against
a hard 4 GB ceiling. The largest single cost was the river channel and valley
indexes: millions of string-keyed buckets along every Azgaar river, about 450 MB.
They now bucket coarsely and derive fine blocks on demand
(`water/SegmentBlockIndex.js`). The heap at the Eldara forest pose fell from
3.26 GB to 1.1 GB, with `bog-cross` frame times unchanged. Near towns and dense biomes a tab can exceed it, die and reload. A
harness then reports this as a navigation ("Execution context was destroyed",
or `__worldVisualQa` undefined), not as a crash. The ceiling cannot be raised:
Chromium builds V8 with pointer compression, which caps each renderer's heap at
4 GB. `--js-flags=--max-old-space-size=8192` is accepted and ignored, and
`performance.memory.jsHeapSizeLimit` stays at 4192 MB. The only fix is a
smaller heap.

### Fix landed: canonical distance fields were regenerating terrain per lookup

**Symptom:** player-mode movement fell to ~13 FPS (`diagonal`, p50 dt 83 ms) while
standing still stayed at ~183 FPS. `stylized` averaged 69 ms/frame; `render` stayed
under 2 ms, so this was never a GPU or draw-call problem.

**Root cause:** `TileDistanceField.chunkField` scans a chunk plus a halo through
`tileAt`, and `InfiniteWorldStore.getTile` had no memo, so every cell ran
`sampleTile` → `fractalNoise` + climate sampling. At `waterRangeMeters: 80` and
`tileSize: 2` the halo is 41 cells, making each field build 146² ≈ 21k procedural
samples, of which only 19% are the chunk's own cells — neighbouring chunks
re-generated the same halo. A CPU profile put 55% of all samples in `fractalNoise`.

This is the same class of bug as the original `writeSurfaceMaskPixels` storm,
reintroduced through the water/path clearance fields.

**Current path:**

1. `InfiniteWorldStore` memoizes generated tiles in per-chunk `Uint8Array` blocks
   with a `filled` mask (`generatedTileBlocks`, capped at 512 blocks). A lone
   lookup still costs one sample; contiguous scans reuse their neighbours' work.
   Only `setBaseTerrain` can stale it, since overrides are consulted first.
2. `getTile` skips building the string cell key entirely when there are no tile
   overrides — the distance fields make millions of lookups per frame.
3. `ScatterClusterField` caches slope on its sample grid and interpolates it,
   instead of taking four procedural height lookups per candidate.
4. `placementSignature` is an order-independent sum of per-placement hashes, with
   no sort and no `localeCompare`.
5. `TreeManifestStore.context` compares the forest-edit document by reference
   rather than re-serializing it per chunk build.
6. Tree, rock and bush build queues share a per-frame ceiling
   (`streaming.stylizedFrameBudgetMs`, default 6 ms) so three separately budgeted
   queues cannot stack into one stall.

Measured on the real WebGPU backend (`--headed`), `diagonal`,
`--warmup 8 --duration 14`:

| Scenario | Before | After |
|----------|--------|-------|
| `diagonal` avg FPS | 13.5 | ~174 |
| `diagonal` p50 dt | 83 ms | 5.1 ms |
| `diagonal` p95 dt | ~150 ms | 7.8 ms |
| Hitches (`diagonal`) | 89 | 9 |

**Still open:** a handful of single `stylized` jobs cost ~57 ms because a full tree
LOD rebuild rewrites instances for every visible chunk, and `plan.signature`
changes each frame while LOD bands cross-fade, so the rebuild is re-triggered.
Slicing that rebuild per chunk is the next win. There is also one reproducible
~676 ms hitch whose `stylized` phase is only ~3.6 ms, i.e. async GPU/pipeline work
outside the marked loop.

### Scatter rows, smithy index and meadow boundary cells (2026-10-31)

Source review of `8d9ba29`, verified against and A/B-tested on `cb19788c`. Same
machine and session, alternating arms, `--gpuTimings 1 --drain-seconds 8
--grass-diagnostics`. `settlement-approach` needs `--warmup 8 --settle`: without
them the runner rejects both arms for incomplete scenery at measurement start.

Focus-valid runs, baseline → change:

| Metric | `chunk-cross` (2 → 1) | `settlement-approach` (2 → 2) | Its revisit (2 → 2) |
|--------|-----------------------|-------------------------------|---------------------|
| Avg FPS | 135.4, 133.6 → 134.8 | 84.4, 84.8 → 86.3, 87.0 | 113.5, 111.4 → 113.6, 113.2 |
| dt p95 ms | 10.3, 10.3 → 10.5 | 15.9, 15.6 → 15.2, 14.9 | 12.2, 12.2 → 11.9, 12.1 |
| dt p99 ms | 15.8, 14.2 → 15.6 | 31.2, 28.9 → 29.9, 29.1 | 13.5, 13.6 → 13.8, 13.7 |
| CPU p95 ms | 9.3, 9.2 → 9.4 | 15.0, 14.6 → 14.2, 13.9 | 11.5, 11.4 → 11.2, 11.2 |
| Hitches | 1, 2 → 1 | 7, 5 → 7, 7 | 0, 0 → 0, 0 |
| GPU avg ms | 1.97, 1.98 → 1.97 | 3.28, 3.31 → 3.24, 3.26 | 2.53, 2.56 → 2.55, 2.58 |
| Rows compared | 9708, 7804 → 5464 | 31455, 34167 → 33329, 27075 | 39613, 41318 → 29858, 30241 |

Rock, bush, tree and settlement instance counts match, GPU pass counts match,
meadow stems stay within a tile of each other, and recovery stays ready. Frame
pacing did not move outside run-to-run spread, except a small settlement approach
gain that needs more runs. CPU profiles (inclusive, one run per arm, whole capture):

| Function | Baseline | Change |
|----------|----------|--------|
| `nearestTown`, settlement approach | 196 ms | 25 ms |
| meadow `refreshLayout` (+ `refreshBoundary`), chunk-cross | 214 ms | 138 ms |
| meadow `refreshLayout` (+ `refreshBoundary`), settlement approach | 251 ms | 169 ms |
| Rock `iterateRebuild`, chunk-cross | 4.5 ms | 14.7 ms |
| `writeInstances`, chunk-cross | 12.6 ms | 18.7 ms |

The review's P1 was an overestimate for these routes: about 800 rocks and 500
bushes are too few for publication to spike a frame. The row reuse lowers
comparisons, not frame time, and its value is in heavier scenes, which were not
measured. `MeadowBandBatch.rebase` is not worth changing yet: both routes recorded
0 origin snaps and 0 `meadowOriginMaintenanceBytes`. Neither is
`WorldAmbience` sampling preparation: 7–45 ms inclusive across 27–64 s captures.
The cost left on these routes is `SettlementSite.prepare` (about 3.8 s on the
approach, in resumable slices) and `buildChunkLodPlan`, which bushes rebuild
every frame while rocks cache it.

### Source review of `50760ba9` against profiles (2026-10-31)

`chunk-cross --warmup 8 --duration 12 --settle --gpuTimings 1 --cpu-profile`,
inclusive main-thread time over the whole capture. Only the first run kept native
focus, so these are profile shares, not frame-pacing evidence.

| Review claim | Measured | Outcome |
|--------------|----------|---------|
| Tree LOD publication spikes, ~57 ms | `iterateTreeLod` 51.5 ms over 59 rebuilds, ~1 ms each | The 57 ms note above is stale; left alone |
| Ground-detail `reset()` churn | `detailVisibility: false` ships, so it never runs | Left alone |
| Variant install can exceed the budget | 28 installs, 95–120 ms total; worst single 17–29 ms | `stylizedVariantApplyMaxMs` added; not staged yet |
| Unbounded chunk tile cache | True, small sets | Capped at four scan windows |
| Impostor culling is redundant | `GpuTreeImpostorBatch.update` 510–544 ms | Fixed below |
| Contact shade rescans rocks | `paintContactShade` 2.7 ms | Left alone |

Each populated impostor batch used two command encoders per frame. Reset and cull
now share one `renderer.compute` call, and the cull is skipped while the view,
origin and records are unchanged. `update` fell to 402–413 ms while moving
(two runs per arm); the skip itself only pays while the camera is still.

### Meadow stems no longer shift on retirement (2026-10-31)

Retiring a tile whose stem count differed from the page tail rewrote every later
tile. Each stem carries its tile in `instanceTile`, so a tile may now span several
runs (`slot.ranges`): stems past the new draw count drop into the holes, and a
resize leaves other tiles in place. No dead stems enter the draw.

`chunk-cross --warmup 8 --duration 12 --settle --gpuTimings 1 --drain-seconds 8
--grass-diagnostics`, two alternating runs per arm, measured counters:

| Metric | Baseline | Change |
|--------|----------|--------|
| `meadowAttributeBytesUploaded` | 395, 377 MB | 196, 195 MB |
| `meadowRepackBytes` | 277, 263 MB | 70, 69 MB |
| `meadowOversizedPageBytes` | 189, 181 MB | 21, 22 MB |
| `meadowPageCommitsDeferred` | 2139, 2055 | 577, 553 |

Every run lost native focus, so these captures are void as frame-pacing evidence
and no FPS gain is claimed. The counters above do not depend on focus. The gain
is less deferred grass, not frame time: `writeBuffer` CPU stayed flat at about
420 ms per third of the capture while moving, in both arms. Roughly 65% of its
2.4–2.8 s falls in the first third of the capture, which is startup, so bytes
are not what that time is paying for. An earlier reading blamed meadow uploads for it.

After a live run, 359,461 stems on 17 pages had no holes and no stem with the
wrong origin or source. 128 tiles were split, the worst into 10 runs; each run
is a separate range upload, so watch that count if uploads ever become call-bound.

### Water distance blocks build across frames (2026-10-31)

The worst CPU run while moving was one `WaterDistanceField` block built inside an
aquatic candidate: 18–30 ms of `isOceanCell` scanning and chamfer sweeps. The block
now advances per row under the scenery deadline (`prepare`), and the candidate
returns `CANDIDATE_PENDING` to retry unchanged next step, so output is identical.
All impostor batches also share one `renderer.compute` call instead of one per species.

`chunk-cross --warmup 8 --duration 12 --settle --gpuTimings 1 --drain-seconds 8
--grass-diagnostics`, focus-valid runs only, two per arm:

| Metric | Baseline | Change |
|--------|----------|--------|
| dt p99 ms | 20.5, 32.1 | 17.9, 17.0 |
| dt max ms | 37.8, 65.2 | 34.4, 34.8 |
| Hitches | 5, 10 | 2, 3 |
| `placementPreparation` max ms | 19.2, 30.0 | 4.5, 5.0 |
| Longest app run ms | 18.0, 29.8 | 5.6, 6.0 |
| Avg FPS | 113.6, 96.0 | 107.1, 110.1 |
| dt p95 ms | 12.4, 15.8 | 12.9, 12.1 |
| `StylizedTreeView.update` ms | 739, 803 | 593, 637 |

Avg FPS and p95 overlap; the gain is in the tail. Ground detail 655, impostors 699,
near trees 64 and tropical 98 match in every valid run. Two further change runs are
void: one timed out, and one lost focus and fell to 47 FPS.

Render submission is the largest remaining CPU cost: about 5.5 ms for 192 draws,
with 11,505 uniforms re-checked per frame, 8,347 of them in the default object
group. `renderGroup` does not help, because three clones non-shared groups per draw.
`sharedUniformGroup` would, but it takes bind groups across every material, so it
was left alone. GPU time is only about 2 ms, so GPU quality is not the limit here.

### Water single pass and per-object textures (2026-11-01)

A probe on `bindings.updateForRender` put most object-group checks in two shared
materials. Water was a transparent `DoubleSide` material, so three submitted each
wet chunk as a back pass and a front pass. Every per-object texture also carried
an identity `mat3`, only so `TextureNode.setup` would keep its OBJECT update.
Water now sets `forceSinglePass`, and `perObjectTexture` holds a marker uniform
the shader never reads. Terrain fell from about 122 to 85 checked uniforms per
draw, and each sample loses a matrix multiply.

Clean export of `cd869141` against the change, `chunk-cross --warmup 8 --duration
12 --settle --gpuTimings 1`, alternating arms. Only runs that exited 0 with native
focus are kept; the first pair came from a faster session:

| Metric | Baseline | Change |
|--------|----------|--------|
| Draw calls, 14 wet chunks | 192 | 178 |
| Render CPU avg ms, first pair | 4.68 | 4.42 |
| Render CPU avg ms, repeat | 5.31, 5.30 | 5.19, 5.17, 5.14 |
| Avg FPS, first pair | 137.4 | 142.3 |
| Avg FPS, repeat | 116.9, 118.4 | 119.2, 119.1, 120.6 |
| dt p95 ms, repeat | 12.3, 11.7 | 11.5, 11.7, 11.7 |
| Hitches, repeat | 4, 2 | 3, 5, 3 |
| GPU avg ms, repeat | 2.45, 2.47 | 2.42, 2.46, 2.46 |

Render CPU falls 3–6%; GPU and hitches overlap. Saving scales with wet chunks, so
coastal routes should gain more, unmeasured. Six further runs timed out or lost
focus. Shoreline captures at (238, 416), yaw 150 differ between repeats of the
same build as much as between arms, and `qa:water:acceptance` passes. Underwater
was gate-checked, not compared by eye.

### World-state uniforms in the frame group (2026-11-01)

Terrain's remaining 85 per-draw uniforms were about a third per-object; most of
the rest were singletons shared by every lit material. Seventeen modules (cloud
shadow, sky light and look, sun haze, wind, sea state, wetness, foliage light,
valley fog, spell light and similar) now take `frameUniform`. A value there is
read once per frame per material, so it must not change between two renders of
one frame. Reflection captures only swap impostor and vegetation state, so that
holds. Camera-dependent values (`VfxLightingUniforms`) and `TreeWindTime`, which
is per config, stay in the object group.

The uniform probe fell from about 9,880 to 4,050 object checks per frame, with
frame checks up from 99 to 405. Export of `aec243b6` against the change, same
flags as above, alternating arms, all eight runs clean with native focus:

| Metric | Baseline | Change |
|--------|----------|--------|
| Avg FPS | 133.4, 135.4, 130.6, 132.7 | 135.0, 137.1, 136.9, 137.5 |
| Render CPU avg ms | 4.70, 4.67, 4.77, 4.70 | 4.54, 4.50, 4.51, 4.51 |
| dt p95 ms | 10.6, 10.4, 10.7, 10.8 | 10.7, 10.5, 10.4, 10.1 |
| Hitches | 2, 0, 2, 2 | 3, 0, 2, 3 |
| GPU avg ms | 2.14, 2.16, 2.19, 2.17 | 2.14, 2.13, 2.11, 2.11 |

Render CPU falls about 4%, separated in every run. Halving the checks saves far
less than half of submission, so re-profile before chasing the remainder. Land and
shore captures match once cloud position is allowed for: two baseline repeats
differ from each other as much as from the change. `qa:water:acceptance --headed`
passes on WebGPU with no browser errors. Storm, dusk and snow transitions were not
captured.

### Automatic WebGL fallback (2026-11-01)

`terrainRendererProfile` keeps terrain inside WebGL's 16 texture units, but read only
`forceWebGL`. A fallback found during `renderer.init()` came after materials were
chosen, so terrain bound 24 textures and failed to link. On this machine headless
Chromium finds an adapter and `requestDevice` then fails loading `dxil.dll`, so
startup now opens and destroys a device (`canCreateWebGPUDevice`) and sets
`forceWebGL` when it cannot. Headless `qa:water:acceptance` went from 8 shader errors
and exit 1 to none and exit 0, on the WebGL backend. Headed stays on WebGPU and passes.

Capture from a frozen export when other sessions share the checkout: an edit mid-run
reloads Vite, and the runner dies with "Execution context was destroyed" or reads an
undefined `__editor`, leaving any older report at its output path.

### Highfield meadow continuity and tour hitches (2026-11-01)

The band at `original-04` stays with calm wind and stays on the same ground when
the camera moves ±10 m, so it is the height step, not wind or a LOD ring. Far
"chunks" were cards at full height swing: they vanish with a flat stand. Widening
short stems made cones. `e9c00c17` → `447d773b` raises biome 4 `shortHeight` to
0.24, keeps 35% of the swing on cards (`MEADOW_CARD_HEIGHT_CONTRAST`), and sets
`rootBrightness` 1, `gradientPower` 1.4 and `bendIsolated` 4.

`node scripts/run-highfield-tour-qa.mjs`, the 45 s loop from `original-04` with its
points saved in each report, three alternating pairs, DOM focus only:

| Lap | Metric | Baseline | Change |
|-----|--------|----------|--------|
| First | dt p95 ms | 10.1, 10.2, 14.2 | 12.4, 9.9, 10.4 |
| First | dt p99 ms | 15.1, 16.0, 21.5 | 17.8, 13.8, 16.2 |
| First | dt max ms | 78, 80, 100 | 96, 79, 79 |
| First | Hitches | 8, 7, 9 | 10, 6, 9 |
| Repeat | dt p95 ms | 8.8, 9.1, 9.4 | 9.7, 9.0, 9.1 |
| Repeat | dt max ms | 49, 54, 55 | 45, 41, 53 |
| Repeat | Hitches | 2, 1, 2 | 2, 2, 1 |

Preparation took 3–10 ms. No run came near the old 37–44 hitches, and every lap
stays under 0.2% hitches. The first lap's worst frames repeat in all six runs near
(-8799, 7779) and (-8931, 7851), 76–100 ms after ordinary frames, with meadow batch
commit and publication counters moving: first-visit preparation, gone on repeat.

Every `chunk-cross` control lost native focus to another process, so they are void
as pacing evidence; average FPS was 137–140 against 133–135. Treat that ~4% as a
likely overdraw cost until re-measured. Tracked geometry bytes match at the fixed
pose. The `lod` fixture fails the same three biome 10 pairs in both arms with zero
coverage, so that failure predates this change.

### Far grass volume replaces cards past 90 m (2026-11-01)

`groundCover.volume` marches a 0.55 m grass layer, six steps, inside the terrain
colour after the bake, because past `nearDistance` the procedural ground is not
drawn. It uses noise only, no viewport textures, and is compiled out when disabled.
`far.distance` fell from 180 to 90 m. `447d773b` → `ef6ff9c1`, three alternating
pairs, all `chunk-cross` runs with valid native focus and `--gpuTimings 1`:

| Metric | Cards to 180 m | Volume past 90 m |
|--------|----------------|------------------|
| `chunk-cross` avg FPS | 139.2, 135.6, 137.8 | 142.0, 140.3, 140.9 |
| `chunk-cross` dt p95 ms | 10.3, 10.7, 10.1 | 10.0, 10.5, 10.3 |
| `chunk-cross` dt p99 ms | 14.5, 17.1, 14.8 | 14.2, 14.7, 14.8 |
| `chunk-cross` hitches | 0, 3, 0 | 0, 0, 0 |
| GPU avg ms | 2.02, 2.07, 2.06 | 1.99, 2.00, 2.02 |
| Tour first lap hitches | 6, 7, 9 | 7, 6, 8 |
| Tour repeat dt p99 ms | 12.6, 11.6, 11.5 | 10.3, 10.4, 10.6 |

Removing cards pays for the march. These valid controls also overlap the void
`e9c00c17` figures above, so the ~4% FPS drop recorded there is not established.
Checked only at `original-04`: other biomes and steep ground have not been
reviewed, and the band past 90 m reads slightly paler than cards did.

### Ground areas and floor scans (2026-11-01)

The area field (`meadowGroundStyle.js`) adds three noise fields to terrain fragments
and blade and card vertices. One array texture (`terrainGroundLayers.js`) replaces the
path dirt, so the sampler count is unchanged, and near ground takes two taps instead
of one. Its six 1K RGBA layers cost about 33 MB of GPU memory with mips, against about
1.9 MB before. `chunk-cross --warmup 8 --duration 12 --settle --gpuTimings 1`,
alternating arms, all settled with no browser errors:

| Metric | Baseline | Change |
|--------|----------|--------|
| Avg FPS | 87.9, 94.1 | 99.3, 92.2 |
| Hitches | 13, 9 | 2, 7 |
| GPU avg ms | 2.51, 2.21 | 2.39, 2.55 |
| GPU p95 ms | 3.30, 2.96 | 3.22, 3.18 |

Every run lost native focus, so these are void as frame-pacing evidence. The change
arm also carried another session's uncommitted snow work, and predates the per-biome
`areaStyle` share.

The repeat compares clean exports of `50574994` and `dd331c47` on the same flags,
ABBA order. Runs that lost native focus are dropped; all five kept runs passed it,
settled and had no browser errors:

| Metric | Baseline | Change |
|--------|----------|--------|
| Avg FPS | 149.1, 148.8 | 146.2, 150.0, 146.3 |
| dt p95 ms | 9.7, 9.6 | 9.8, 9.7, 10.2 |
| dt p99 ms | 12.7, 13.3 | 14.1, 12.8, 14.0 |
| Hitches | 0, 2 | 1, 0, 0 |
| GPU avg ms | 1.95, 1.95 | 1.97, 1.94, 1.99 |
| GPU p95 ms | 2.21, 2.26 | 2.31, 2.25, 2.30 |

Hitches and GPU average overlap. The change sits about 1% lower on average FPS and
0.05 ms higher on GPU p95, which is within what five runs can separate. This route is
one biome path, so it does not measure every floor pairing.

### Forest understory (2026-11-02, **focus-clean A/B outstanding**)

Forest biomes were mostly lawn: at the procedural world's sampled points, 43% of
temperate forest had coverage under 0.2, because `regionalForest` scaled coverage
before `coverageContrast`. And `candidateBudgetPerChunk` was silently clamped to
8 × `trees.perChunk`, so 144 meant 96. Biomes 5–9 now set `regionalForestFloor`,
`trees.perChunk` is 28 with a budget of 220 and 110 accepted, bushes keep
`understoryDensity` under canopy, and the bog's logs and stumps also grow in
forests. Tree placements roughly doubled (2.4× at the visual-QA poses).

`chunk-cross`, warmup 8, `--settle`, 20 s, from `x=2005 z=2941` (biome 7), clean
export of `db67556f` against the change. **Every run lost native foreground focus
to another window, so treat these as indicative, including the FPS figures:**

| Run | Base FPS | Change FPS | Base GPU avg ms | Change GPU avg ms |
|-----|----------|------------|-----------------|-------------------|
| Forest | 119.9, 94.3, 104.7 | 99.0, 96.0, 47.1 | 2.36, 2.68, 2.48 | 2.83, 3.13, 3.43 |
| Spawn | 95.2, 101.8 | 113.5, 105.2 | 2.31, 2.73 | 2.25, 2.22 |

The 47.1 run has a 3.4 s frame that no other forest run shows, cause unknown. GPU
time is the steadier signal: about +0.6 ms in closed forest, nothing at spawn.

A follow-up adds to that unmeasured cost: bushes in a wood no longer pass the
regional scrub channel (1302 to 1903 placements at one temperate core), taiga bush
and ground-detail shares rise, and dry woods grow a fern. Run the A/B on this state.

A second follow-up adds more unmeasured per-frame work: the `forestDebris` layer
(up to 256 candidates a chunk in the three nearest rows, 72 leaves a litter drift),
and `groundDetail.fadeEnd` from 34 m to 56 m, which runs five more noise octaves
on terrain pixels out to that distance.

Tree roots add about 280 triangles a tree, and bark and crowns gained emissive and
edge terms, so that A/B also needs running on this state with baked atlases present.
`87ba800b` to the following commit had no atlases at all (`atlasCount` 0).

### Landforms and the grassland benchmark (2026-11-01)

`TerrainLandforms.js` adds warped swells, gullies and knolls to both generators,
about ±6 m at p1/p99 and steepest near 0.64. Rivers and beaches read the finished
height. Eldara's far backdrop skips landforms because `heightBias` keeps it below
them. Biome 4 grass rises to 0.82 m tall in 17 m swaths, grassland bushes keep full
cluster density and flower candidates triple. Existing settlement plans are stale,
so `SETTLEMENT_PLAN_VERSION` is 19.

Landforms use their own short coast fade in Eldara. The 10-raw-unit detail fade left
them at 10% on the settlement route, because a quarter of that map's land is within
3 units of the coast. Bringing them that close exposed a latent bug: a block build
that threw stayed in `WaterDistanceField.pendingBlocks`, and the dead job then
stored `undefined`. Failed builds are now dropped. The original throw was not
identified; it did not recur over three settlement runs and one Eldara capture.

Export of `d2ce9910` with the same two uncommitted device-limit files, against the
change. `chunk-cross` from `original-04`, `--warmup 8 --duration 12 --settle
--gpuTimings 1`, alternating arms, all settled, focused and free of browser errors:

| Metric | Baseline | Change |
|--------|----------|--------|
| Avg FPS | 142.4, 144.7 | 118.7, 141.4 |
| dt p95 ms | 10.2, 9.8 | 10.7, 10.3 |
| dt p99 ms | 13.1, 13.2 | 18.3, 14.8 |
| Hitches | 2, 2 | 10, 2 |
| GPU avg ms | 2.69, 2.71 | 2.85, 2.84 |

The first change run is an unexplained outlier, and only two pairs were taken on the
final code. An earlier revision, three pairs with a smaller plain share, read 146.0,
149.3, 134.3 → 141.8, 143.5, 137.4 FPS with GPU 2.70 → 2.81 ms and hitches 2, 1, 3 →
2, 3, 5. Expect about 0.15 ms GPU and a few percent FPS; the arms were not split
to attribute it. `settlement-approach`: baseline 99.9 FPS, 6 hitches; change 97.5
and 97.4 FPS, 6 and 8 hitches, one baseline run. `qa:water:acceptance --headed`
passed with the coast fade, before the distance-field fix.

### Shore bands, snow on soil, cliff strata and ripple fade (2026-11-05)

A/B of `ee75bf3a` against `bb74ec08`, each a clean `git archive` export served on
its own Vite port (no other app tab open), arms alternated. The change adds one
fbm inside the coastal-band branch (`CoastSandShading.js`), one grit tap on wet
ground within 45 m (`terrainPathPaint.js`), a height blend inside the existing
transition branch, and a few sines on rock faces; the ripple fade only removes
work. `--warmup 8 --duration 12 --settle --gpuTimings 1`, all settled:

| Route | Metric | Baseline | Change |
|-------|--------|----------|--------|
| `chunk-cross` | GPU avg ms | 2.246, 2.282 | 2.271, 2.251 |
| | GPU p95 ms | 2.555, 2.605 | 2.685, 2.570 |
| | Avg FPS | 139.6, 127.2 | 136.0, 144.4 |
| | Hitches | 1, 4 | 5, 2 |
| `move --x -5815 --z 11 --yaw 45 --speed walk` (hot-desert pond, 11–14 refractive chunks) | GPU avg ms | 1.388, 1.449 | 1.442, 1.386 |
| | GPU p95 ms | 1.507, 1.657 | 1.755, 1.578 |
| | Avg FPS | 158.7, 166.8 | 167.7, 165.4 |
| | Hitches | 5, 4 | 3, 4 |

GPU time is level on both routes (pond means 1.419 → 1.414 ms). Seven of the eight
runs lost native foreground focus (`capture.focus.native.passed` false; only one
pond baseline passed), so the FPS and hitch rows are void as frame-pacing
evidence; the GPU timestamp rows are the result.

### Cold desert pass: rock looks, water tint, snow drifts, mineral stone (2026-11-06)

A/B of the shader side of `170e3f8f`, `8b2922ef`, `007d6ef4`, `cd03d3a6` and
`cbda611e` (`rockWeathering.js`, `StylizedLodRuntime.js`, `SnowAccumulation.js`,
`StylizedWaterMaterial.js`, `AridSubstrateNodes.js`), reverse-applied in the
shared checkout for the baseline arm and restored after. The change adds one
per-instance vec4 on rocks, three noise taps on mineral ground within 560 m, a
warped two-octave drift lookup in the CPU bake, and a uniform tint and depth
margin on water. `chunk-cross --x 11453 --z 9877` (a cold-desert pond), `--warmup 8
--settle`, headed WebGPU on Windows; other sessions' browsers were open on the GPU.

| Metric | Baseline | Change |
|--------|----------|--------|
| GPU avg ms (`--gpuTimings 1`, 12 s) | 2.706, 2.386 | 2.052, 1.880 |
| GPU p95 ms | 5.906, 4.110 | 2.913, 2.686 |
| Avg FPS, focus-valid runs only (20 s) | 140.8, 148.5 | 152.4 |
| Hitches, focus-valid runs | 11, 11 | 7 |

A second series alternated the arms A/B/A/B/A/B with no other session active
(`--gpuTimings 1`, 12 s each; the baseline modules were fetched from Vite before
each B run so it was really served, and the files restored after):

| Metric | Baseline (B1–B3) | Change (A1–A3) |
|--------|------------------|----------------|
| GPU avg ms | 2.743, 2.733, 2.336 (median 2.733) | 2.309, 2.798, 2.243 (median 2.309) |
| GPU p95 ms | 5.297, 4.917, 3.155 (median 4.917) | 4.550, 4.202, 3.157 (median 4.202) |

No regression: GPU time is level or lower in the change arm in both series. The
lower medians are within the spread between runs, not a measured gain. Six of the ten runs lost native focus and are
void for FPS (they ranged 75–146 FPS in both arms); two more aborted on a Vite
reload from another session's edit.

### Storm weather matrix (2026-11-09)

Closes the "storm, dusk and snow transitions were not captured" gap for storms
(dusk is still open). This is the §7 matrix of
`docs/plans/storm-weather-plan-2026-11-08.md` on a frozen snapshot of `b1c8f90f`
(storm phases 1–7). The runs were `chunk-cross --warmup 8 --duration 12 --settle
--gpuTimings 1`, headed WebGPU, with
`?storm=<level>&stormSnap=1&stormKind=<kind>` and `?storm=0` as the A arm, in two
interleaved rounds. All nine completed runs kept native focus. `rain05-1` did not
run, because another session held the perf lock.

| Case | GPU avg ms | GPU p95 ms | dt p95 ms | Draws | Weather CPU ms |
|------|-----------|-----------|-----------|-------|----------------|
| clear (`storm=0`) | 2.35, 2.21 | 2.92, 2.62 | 12.49 (cold), 9.50 | 203 | 0.036, 0.029 |
| rain 0.5 | 2.28 | 2.71 | 11.23 | 206 | 0.117 |
| rain 1 | 2.25, 2.25 | 2.61, 2.64 | 11.80, 10.35 | 206 | 0.122, 0.115 |
| snow 0.5 | 2.50, 2.53 | 3.01, 3.02 | 9.80, 10.10 | 203–204 | 0.031, 0.033 |
| snow 1 | 2.52, 2.54 | 2.91, 3.01 | 10.00, 9.60 | 203–204 | 0.029 |

Against the §7 budget, from these numbers:

- **GPU:** rain is level with clear (within run spread). Snow adds about
  +0.25 ms at both levels, well under +0.8 ms. Snow costs the same at 0.5 and 1,
  so its cost is a fixed per-pass cost rather than one that grows with particle
  count.
- **Draws:** rain adds +3 and snow +0–1, which meets the "≤ 3" budget.
- **CPU:** rain's weather update adds about +0.09 ms, under +0.15 ms.

The first clear run was cold (2 hitches). Compare against `clear-2`.

`qa:weather:browser` now runs rain and snow at storm 0.25, 0.5, 0.75 and 1, as well
as the six modes. The modes are snapped too, since a UI change ramps the storm
over minutes. All 14 cases pass with no shader errors. WGSL compile logs that carry
only warnings ("code is unreachable") no longer count as shader errors; they had
been failing the warmup gate on HEAD. The harness camera sits high over the
ground, so at storm 1 the fog reads as a flat grey card. Judge storm looks from
ground-level poses instead. Puddles did not show in the phase 7 rain capture, and
that gap is still open.

### Renderer GPU preference

`InfiniteTerrainView` requests `powerPreference: 'high-performance'`
(`renderer.powerPreference`, default `high-performance`). Without it the browser may
place the world view on integrated graphics on hybrid machines, which costs an order
of magnitude for identical scene content. The workshop preview renderer already
asked for it; the world renderer did not.

### Fix landed: ACES tone mapping and soft shadows in the world renderer (2026-07-25)

`InfiniteTerrainView` gained ACES tone mapping at exposure 1.12 and
`PCFSoftShadowMap`, and `ObjectView`'s duplicate unshadowed directional light
became a fallback that `StylizedSkyView` evicts. The world previously ran two
suns from different directions and no tone mapping at all, while buildings were
authored in the workshop preview under ACES at 1.12 — so a baked asset never
looked the way it did while authoring.

A/B on the same machine and session, `--headed --qa diagonal --warmup 8
--duration 14 --speed run`, real WebGPU backend:

| Shadow filter | Avg FPS | dt p50 / p95 | Hitches |
|---|---|---|---|
| `PCFSoftShadowMap` (shipped), run 1 | 178.6 | — | 10 |
| `PCFSoftShadowMap` (shipped), run 2 | 163.8 | 5.4 / 8.7 ms | 9 |
| `PCFShadowMap` (previous) | 182.0 | 5.0 / 7.4 ms | 11 |

The concern was that a wider shadow filter kernel would cost frame time. It does
not, but note *why* the conclusion is safe: **run-to-run variance on the shipped
configuration alone (163.8–178.6 FPS, ~9%) is larger than its gap to hard shadows
(3.4 FPS, ~2%), and the hitch counts overlap.** A single pair of runs would not
have supported that claim in either direction. Removing the second directional
light plausibly offsets the wider kernel.

If you re-measure this, run the shipped configuration at least twice before
comparing anything to it.

> An earlier revision of this section reported 146.2 vs 134.3 FPS from a
> **headless** run. Those numbers measured the WebGL backend, not WebGPU — see
> [Harness must run on real hardware](#harness-must-run-on-real-hardware) — and
> have been replaced by the headed figures above.

### Terrain normal and forest-floor/dirt layering (2026-07-26)

Large ground bands were isolated with fixed-pose A/B captures. Disabling
directional shadows left their shape intact; disabling procedural dirt removed
it. Two terrain-material layering defects made those intended dirt patches read
like shadow streaks:

1. The forest-floor tint was applied on top of exposed dirt and path tread,
   shifting warm soil toward `groundCoreColor`.
2. `normalNode` was assigned a **literal** local +Z even though node-material
   normals are consumed in view space, so every surface read as one flat plane.
   Removing it let the plane's default transformed normal correctly rotate its
   local +Z into world +Y.

   **Superseded 2026-08-19.** `terrainMaterial.js` assigns `material.normalNode`
   again, but from a *computed* surface-gradient normal
   (`createTerrainSurfaceNormal`) derived from the same heightfield as the
   geometry displacement and transformed into view space
   (`TerrainMaterialSurfaceGradientNodes.js`). The defect above was the constant
   vector, not the assignment itself — do not "fix" the current assignment by
   reverting it. `test/terrain-material-baked-lod.test.js` and
   `test/terrain-material-family-lod.test.js` pin the current contract; this
   section is kept only as the record of the original defect.

The existing `PCFSoftShadowMap`, 2048 map, 120 m half-extent, bias, normal bias,
and radius remain unchanged. A headed `chunk-cross --warmup 8 --duration 14
--speed run` on the real NVIDIA WebGPU adapter after the fix measured 219.1 FPS,
4.3/6.6/8.8 ms p50/p95/p99, and 3 hitches over 33.3 ms.

### Instrumented sub-phases

Counters (last-sample gauges + cumulative `*Ms` / byte totals where noted):

| Name | Meaning |
|------|---------|
| `workerComplete` | Worker generation wall time for a page |
| `queueWait` | Time a generation job waited before a worker picked it up |
| `commitQueueWait` | Time a finished page waited in the commit queue |
| `tilePixels` / `surfaceMask` | Worker render-pixel enrichment cost |
| `textureCommit` | Main-thread memcpy + `needsUpdate` for one page |
| `grassScatter` | Grass instance fill (worker compact or main fallback) |
| `grassTrample` | Influence texture rebuild |
| `grassBufferUpload` | Grass attribute range upload bookkeeping |
| `maxQueuedCommitAgeMs` | Oldest commit still waiting (gauge) |
| `attributeBytesUploaded` / `textureBytesUploaded` | Uploaded byte totals |

### QA gates

Re-run `npm run qa:perf` (`?qa=chunk-cross`) and check:

| Gate | Target |
|------|--------|
| Procedural tile samples during page commit | 0 |
| Terrain commits in one frame | ≤ 1 while moving |
| Grass rebuilds during straight boundary crossing | ≤ 3 |
| Main-thread terrain commit p95 | < 2 ms |
| Main-thread stylized build p95 | < 4 ms |
| Post-warmup hitches over 33.3 ms | 0 |
| Maximum queued commit age | reported |
| Texture and instance bytes uploaded per frame | reported |

Also:

- Chunk-boundary hitch spikes should shrink vs the ~1 s baseline (no main-thread mask storms).
- `terrainCommit` phase should stay small (memcpy only); large `dt` with `terrainUploadPages` should be rare.
- Grass/flower rebuilds should follow per-chunk signatures + build-queue budgets, not full resident rebuilds on every focus step.

### Water slots own their surface bounds (2026-11-10; town CPU gate failed)

Phase 1 of [the performance work order](plans/performance-plan-2026-11-10.md).
Water slots share the terrain plane's buffers but own their culling volumes.
Each wet upload decodes channel 1's surface-height offsets, adds the page's
surface origin, and fits local Z bounds with 6 m of swell/surf/storm padding.
Dry-slot visibility, materials and refraction selection stay unchanged. Terrain
uses the same bounds calculation with its existing 2 m padding.

Frozen runtime exports of `e437410f` and the phase 1 implementation (tested as
`4524c8c7`), served on ports 5186 and 5187. These exports exclude the shared
checkout's uncommitted weather, material and visual-harness edits. Headed NVIDIA
Lovelace WebGPU, 1280×720, `--warmup 8 --duration 12 --settle --gpuTimings 1`;
forest is `chunk-cross --x 2005 --z 2941`, town is `settlement-approach`.
Each series alternates A, B, A, B. All runs in the table settled, recorded zero
browser errors and passed native foreground focus. No FPS or hitch claim is made.

| Route / series | Metric | Baseline A | Change B | Work-order gate |
|---|---|---|---|---|
| Forest repeat | Render CPU avg ms | 5.420, 5.565 | 5.236, 5.211 | Pass: both ≤ 5.4925 |
| Forest repeat | GPU avg ms | 3.010, 3.019 | 2.992, 2.970 | Pass: both within +0.10 ms of A mean |
| Forest repeat | Final draw-call gauge | 250, 248 | 448, 233 | Includes auxiliary renders; use the per-pass census below |
| Town initial | Render CPU avg ms | 8.764, 8.034 | 8.233, 8.579 | Fail: B2 > 8.399 |
| Town initial | GPU avg ms | 3.914, 3.881 | 3.889, 3.936 | Pass |
| Town initial | Final draw-call gauge | 549, 548 | 549, 548 | Reported, no draw-reduction claim |
| Town repeat | Render CPU avg ms | 8.314, 8.131 | 8.441, 8.243 | Fail: both > 8.2225 |
| Town repeat | GPU avg ms | 3.905, 3.898 | 3.912, 3.905 | Pass |
| Town repeat | Final draw-call gauge | 548, 548 | 549, 548 | Reported, no draw-reduction claim |

Forest render CPU averages 5.4925 → 5.2235 ms, a 4.9% reduction. Town means are
8.399 → 8.406 ms initially and 8.2225 → 8.342 ms on repeat. The initial town
control spread alone is 0.730 ms; these results do not establish a town CPU gain.
The strict per-run town ceiling nevertheless fails in both series, so phase 1
is **not accepted under the work order**. No subsequent phase had been implemented
at that handover.

The initial forest series is excluded: another automated Chromium with WebGPU
enabled was observed during it, and three of its four runs lost native focus.
Its change B1 measured 7.238 ms render CPU and 3.845 ms GPU. The entire forest
series was repeated, rather than using that outlier to claim a result.
Raw reports are `tmp/p1-forest-{a1,b1,a2,b2,a3,b3,a4,b4}.json` and
`tmp/p1-town-{a1,b1,a2,b2,a3,b3,a4,b4}.json`; the forest timing table
uses runs 3–4, and both town series are retained above.

The matching forest census (`tmp/p1-census-a.json`, `tmp/p1-census-b.json`)
reports `output 1280x720||persp :: stylized-water` at **34 → 18 draws** and
279 k → 147 k triangles. This passes the phase's ≤ 20 main-pass water-draw gate.

Correctness and visual checks:

- The 18 focused bounds/dry-water tests pass, including the five new
  `test/water-slot-bounds.test.js` cases. ESLint passes for all four changed JS
  files. Wet heights plus origin/padding, dry uploads, reuse, front/back camera
  culling, shared buffers and the unchanged terrain box/sphere are covered.
- `qa:world:visual --suite shore --only marine-coast,marine-coast-overview,original-05-shore`
  passes all three poses on hardware WebGPU, with assets ready and zero browser
  errors (`tmp/p1-world-visual/report.json`). Inspected the overview and shoreline.
- Inspected culling-on/unculled pairs at −60°, 0° and +60° for the coast and a
  current Eldara river: no missing water at screen edges. Water time was fixed at
  123.4 s; materials and quality were unchanged. Coast artifacts are in
  `tmp/p1-water-turns/`; valid river artifacts are in `tmp/p1-river-turns/`.
  Both reports record NVIDIA WebGPU and zero browser errors.
- The historical `water-aaa-audit-2026-10-16/manifest.json` river pose resolves to
  ocean (kind 1) at its old positive Z, so its first captures were rejected as
  river evidence. Re-selected through the existing `selectImportedWaterPoses`
  helper and asserted river kind 3 and biome 6. The valid bank is
  `(-6524373.395576, -1768732.198768)`, targeting
  `(-6524358.856998, -1768747.654606)`; surface height is 25.200708 m and camera
  height 38.700708 m. The report preserves this pose and selection metadata.
- `qa:water:acceptance --headed` passes every gate at high quality with native
  focus, zero browser/GPU validation errors, and 7.0 ms frame p95
  (`tmp/p1-water-acceptance.json`).
- `npm test`: **4262 passed, 1 failed** (`tmp/p1-tests.log`). The unrelated
  `tests/ProceduralAssetStore.test.js:92` fixture omits `walls: 'default'`, which
  `normalizeProceduralRecipe` returns. Reproduced the identical assertion using
  `node --test --test-name-pattern="procedural asset recipes are normalized and bounded"`
  against an immutable export of `e437410f` (`tmp/p1-baseline-test.log`). No
  workshop code or fixture was changed. The work order's full-suite gate therefore
  remains unmet as well as its town CPU gate.

### Settlement interiors: 256 m cells and 32-bit indices (2026-11-10)

Phase 2 of [the performance work order](plans/performance-plan-2026-11-10.md).
`InteriorBatchStore` now uses 256 m cells, a 262140-vertex cap and `Uint32Array`
indices. Numeric-buffer pages remain 12288 elements, bounding each copy to
49152 bytes. Generated room geometry, materials, planning and culling code are
unchanged. Tests also update the existing rendering/numeric-buffer contracts.

Frozen exports of `21a20604` (includes phase 1) and implementation `45cfdebc`,
served on ports 5186/5187; uncommitted weather and look-harness edits are excluded
from these runtimes. Headed NVIDIA Lovelace WebGPU, 1280×720,
`--warmup 8 --duration 12 --settle --gpuTimings 1`. Each route alternates A, B,
A, B; forest adds `--x 2005 --z 2941`. All eight runs settled with zero browser
errors. Only town A2 and forest B2 retained native focus, so no FPS or hitch
figures are claimed; these are the work order's CPU-phase/GPU-timestamp gates.

| Route | Metric | Baseline A1, A2 | Change B1, B2 | Gate |
|---|---|---|---|---|
| Town | Render CPU avg ms | 8.645, 8.590 | 6.841, 6.792 | Pass: both ≤ 7.1175 (A mean − 1.5 ms) |
| Town | GPU avg ms | 3.970, 3.913 | 3.881, 3.869 | Pass: within +0.30 ms of A mean |
| Town | Final draw-call gauge | 550, 549 | 388, 389 | Reported; includes auxiliary passes |
| Forest | Render CPU avg ms | 5.588, 5.245 | 5.379, 5.338 | Pass: both ≤ 5.4165 (A mean) |
| Forest | GPU avg ms | 3.068, 3.011 | 3.000, 2.980 | Pass |
| Forest | Final draw-call gauge | 236, 235 | 236, 236 | Reported |

Town render CPU averages **8.6175 → 6.8165 ms**, saving 1.801 ms (20.9%). Forest
timings overlap the control spread; no forest gain is attributed to this phase.
Reports are `tmp/p2-{town,forest}-{a1,b1,a2,b2}.json`. An earlier unpaired town
control is retained as `tmp/p2-town-preliminary-a.json`; the balanced series was
started fresh after another session's environment captures released the GPU lock.

The matching census (`tmp/p2-census-a.json`, `tmp/p2-census-b.json`) gives
**249 → 89 main-pass interior draws**, passing the ≤ 90 gate. Wood goes 51 → 16,
plain 38 → 13, and each of the other five roles 32 → 12. Each role's triangle
count is unchanged, totalling **1.992 M** in both arms.

Correctness and visual checks:

- 31 targeted tests pass. They retain exact expanded attributes/winding and check 256 m
  positive/negative boundaries, indices above 65535 through 262139, capacity
  splitting, bounds from emitted vertices, shared-material disposal and a
  maximum buffer copy of exactly 49152 bytes. ESLint passes for all four JS files.
- `npm test`: **4268 passed, zero failures** (`tmp/p2-tests.log`). This is a
  working-tree result: it includes another session's uncommitted correction of
  the pre-existing `walls: 'default'` recipe fixture failure noted in phase 1.
  That fixture and the other session's changes are outside this phase's commit.
- Matched burg 18 doorway and furnished-room captures at hours 12 and 21 pass
  all eight cases on hardware WebGPU with zero browser errors. Both arms select
  the same current settlement-plan room and camera poses. Inspected
  `tmp/p2-town-visual/comparison.png`: open door leaf, furniture, window daylight
  and night lighting match. Each arm also has a second night-room capture 600 ms
  later for live flicker; animation phases and fireflies vary between captures.
  Fixture, poses and readiness are in `tmp/p2-town-visual/report.json`.
- `qa:water:acceptance --headed` passes every gate on NVIDIA WebGPU with native
  foreground focus, zero browser/GPU validation errors and 6.9 ms frame p95
  (`tmp/p2-water-acceptance-foreground.json`). The first attempt lost focus
  during route discovery and produced no report. A second attempt passed the
  functional gates but lost focus (`tmp/p2-water-acceptance-retry.json`), so it
  was rejected as authoritative evidence. The final foreground run exits 0 and
  records `performanceAuthoritative: true`.

The phase 2 draw, CPU, GPU, visual and water gates pass. The full-suite result
above retains its explicit working-tree provenance; this phase does not include
the other session's uncommitted fixture correction. Phases 3–6 had not started
at that handover.

### World uniforms: excluded state retained, strict CPU gate missed (2026-11-10)

Phase 3 of [the performance work order](plans/performance-plan-2026-11-10.md).
Implementation `376f1348` moved 170 plain world-state uniforms to the existing
frame group. Follow-up `48e5ee27` restored the shared tree mesh/proxy clock to
the object group, applying the TreeWindTime exclusion to the registered clock
as well as its fallback. The retained change is 169 calls in 34 modules.
Camera state, reflection reprojection/validity/origins, per-object callbacks,
and the work order's excluded files remain outside the migration.

Frozen exports of `a2e7cce8` and `376f1348`, ports 5186/5187, headed NVIDIA
Lovelace WebGPU, 1280×720, `--warmup 8 --duration 12 --settle --gpuTimings 1`.
Both routes alternated A/B/A/B. All eight runs settled, retained native focus
and had zero browser errors. These measurements precede the tree-clock
follow-up; no phase-3 performance pass is inferred for that follow-up.

| Route | Metric | Baseline A1, A2 | Change B1, B2 | Gate |
|---|---|---|---|---|
| Forest | Render CPU avg ms | 5.191, 5.358 | 5.359, 5.639 | Fail: both exceed A mean 5.2745 |
| Forest | GPU avg ms | 3.003, 2.995 | 3.008, 3.021 | Pass: within +0.10 ms |
| Forest | Final draw-call gauge | 234, 440 | 393, 237 | Includes captures/auxiliary passes |
| Town | Render CPU avg ms | 6.918, 6.750 | 6.926, 7.021 | Fail: both exceed A mean 6.834 |
| Town | GPU avg ms | 3.842, 3.848 | 3.841, 3.877 | Pass: within +0.10 ms |
| Town | Final draw-call gauge | 388, 389 | 389, 388 | Reported |

Render CPU means are 5.2745 → 5.499 ms in the forest and 6.834 → 6.9735 ms in
town. The predicted phase-3 CPU saving was not demonstrated. Raw reports are
`tmp/p3-{forest,town}-{a1,b1,a2,b2}.json`.

The forest uniform probes (`tmp/p3-uniforms-{a,b}.json`) count raw `:none:`
entries exactly as requested, including built-ins and unions of material
variants:

| Material | Before | Experiment | Limit | Result |
|---|---|---|---|---|
| terrain-slot | 22 | 5 | 6 | Pass |
| meadow-grass-blades | 29 | 2 | 5 | Pass |
| Meadow leaves | 17 | 9 | 6 | Fail |
| stylized-flowers | 10 | 2 | 4 | Pass |
| stylized-water | 17 | 15 | 6 | Fail |

The leaf owner audit (`tmp/p3-uniform-owners.json`) found Three.js material
references for alphaTest, metalness and roughness: their inner UniformNode
reports `none`, but their owner updates per object. Four more values belong
to camera-derived CharacterOcclusion outside the named migration directories.
Water's protected capture state includes three controller uniforms and three
PlanarReprojection uniforms; the probe unions labels across material variants.
These values were preserved rather than moved to satisfy a conflicting count.
The restored tree clock adds an excluded object uniform to materials that use it.
The live owner trace in `tmp/p3-world-visual/report.json` confirms all six
capture values on each of two water variants, plus an object-updated alphaTest
reference and a built-in mat4: eight entries per variant, fifteen in the union.

The user explicitly authorized retaining safe optimizations, documenting failed
gates, and evaluating phase 6 against its own CPU/GPU ceilings. This also leaves
phase 1's historical strict town-gate failure visible above; neither failure is
being relabelled as a pass. The formerly failing workshop fixture was fixed by
the separate `a2e7cce8` commit before this phase's baseline.

Focused frame-group/camera tests and ESLint passed; `npm test` at `376f1348`
passed all 4271 tests (`tmp/p3-tests.log`). The later phase-3/4/5 integration
suite passed 4275 (`tmp/p345-tests.log`); all four uniform-group tests pass
after the tree-clock correction.

- Forest/coast at hours 12 and 21: eight matched captures pass on hardware
  WebGPU with assets/readiness verified and zero browser errors
  (`tmp/p3-world-visual/report.json`). Inspected the forest noon pair and coast
  noon/night pairs: scenery and reflected trees/sky match; wind, cloud and
  reflection-refresh phases vary. Both coast arms report valid cube and planar
  captures. The forest pose reports valid cube capture and inactive planar
  capture in both arms. The first visual attempt timed out waiting for the GPU
  lock and produced no captures; the complete retry supplies this evidence.
- Town open-door/furnished-room comparisons at hours 12 and 21: all eight pass,
  with identical fixture/camera selection and zero browser errors. Inspected
  `tmp/p3-town-visual/comparison.png`: doors, furniture, window daylight and
  interior night lighting match; animated fireflies/flicker change phase.
- `qa:weather:browser --headed`: all 14 cases pass on NVIDIA WebGPU with zero
  shader/runtime errors (`tmp/p3-weather-report.json`). Its 20 recorded console
  entries are warnings, including Three.js deprecations and unreachable shader
  code, rather than exceptions or GPU validation errors.
- `qa:water:acceptance --headed` exits 0, passes every gate, retains native
  foreground focus and records `performanceAuthoritative: true`, with zero
  browser/GPU validation errors and 7.3 ms frame p95
  (`tmp/p3-water-acceptance.json`).

### Bilinear template-size experiment: reverted (2026-11-10)

Phase 4 of [the performance work order](plans/performance-plan-2026-11-10.md)
was implemented in `b8a17e35` and reverted in `99edfd99`. The only runtime edit
replaced `textureSize(node(null))` with the template image dimensions. Its
64×32 graph test confirmed four texture nodes and no texture-size node.

Frozen NVIDIA WebGPU forest probes compare phase 3 `376f1348` on port 5187
with `b8a17e35` on port 5188 (`tmp/p3-uniforms-b.json`,
`tmp/p4-uniforms-b.json`):

| Terrain metric | Before | Experiment | Required |
|---|---|---|---|
| Update nodes per draw | 114 | 105 | ≤ 104 |
| Object-group textures per check | 25 | 25 | ≤ 23 |

Texture checks did not move, triggering the plan's immediate revert rule.
No frame-time benefit or visual acceptance is claimed for this experiment;
its A/B performance and visual runs were therefore not pursued. The three
focused binding tests passed, as did ESLint. The integration suite including
the experiment and phases 3/5 passed all 4275 tests (`tmp/p345-tests.log`).
The reverted graph test is retained in the experiment commit's history.

### Scatter spacing: numeric buckets and one scratch neighbour list (2026-11-10)

Phase 5 implementation `88cb2a08` replaces string bucket keys and the neighbour
generator with exact numeric keys and one scratch array per manifest builder.
Lookup retains offset-Z, offset-X, then bucket order. Candidate positions,
priorities, accepted order and spacing rules remain unchanged.

An integer bucket origin is subtracted after flooring canonical coordinates.
This preserves the original bucket boundaries while allowing small scatter
at imported-world coordinates: using absolute bucket coordinates with the
proposed ±1048576 guard would reject those normal worlds. The numeric key
formula and RangeError guard apply to the resulting local bucket coordinates,
in both fill and lookup. No placement coordinate is rebased.

The five resumable-manifest tests pass, including pre-change literal IDs and
signatures `9:0236005c` at chunk `(2,-1)` and `9:4947de17` for small objects at
imported chunk `(73939,74206)`, plus the numeric-span RangeError. The literals
were recorded before changing the index (`tmp/p5-before.json`). ESLint passes.
The integration suite including phases 3/4/5 passed all 4275 tests.

Frozen `b8a17e35` and `88cb2a08`, ports 5188/5189. Both arms include the same
subsequently reverted phase-4 experiment; only the scatter change differs.
The phase-3 tree-clock follow-up is absent from both arms. Headed NVIDIA
WebGPU forest runs use `--x 2005 --z 2941 --warmup 8 --duration 12 --settle
--gpuTimings 1 --cpu-profile <file>`, alternated A/B/A/B. All four settled,
retained native foreground focus and had zero browser errors.

| Profile | createSpacingIndex self ms | neighbours / collectNeighbours self ms | Sum ms | bucketKey self ms |
|---|---|---|---|---|
| A1 | 431.820 | 1749.624 | 2181.444 | 0 |
| B1 | 189.685 | 209.185 | 398.870 | 48.614 |
| A2 | 394.703 | 1793.019 | 2187.722 | 0 |
| B2 | 205.174 | 223.366 | 428.540 | 10.280 |

The gate's sampled self-time mean falls **2184.583 → 413.705 ms**, or 18.9%
of baseline, passing the ≤50% limit. Including the new key/range helper makes
the change mean 443.152 ms, still only 20.3% of baseline. Capture durations
were 54.879/54.418 s for A and 50.229/48.536 s for B; this is whole-profile
scatter self time, not a frame-time reduction. Profiles are
`tmp/p5-forest-{a1,b1,a2,b2}.cpuprofile`.

| Route | Metric | Baseline A1, A2 | Change B1, B2 | Gate |
|---|---|---|---|---|
| Forest (profiled) | Render CPU avg ms | 5.901, 5.643 | 5.680, 5.827 | B2 fails A mean 5.772 by 0.055 ms |
| Forest (profiled) | GPU avg ms | 2.997, 2.961 | 2.975, 2.976 | Pass: within +0.10 ms |
| Forest (profiled) | Final draw-call gauge | 235, 236 | 234, 234 | Reported |
| Town | Render CPU avg ms | 6.866, 7.096 | 7.031, 6.714 | B1 fails A mean 6.981 by 0.050 ms |
| Town | GPU avg ms | 3.859, 3.860 | 3.851, 3.855 | Pass: within +0.10 ms |
| Town | Final draw-call gauge | 389, 389 | 387, 388 | Reported |

The scatter-specific gate passes; the strict common forest/town CPU gates do not.
The user's documented acceptance exception retains the safe optimization
without claiming those failed render gates passed. The town series used the
same flags without CPU profiling; all four runs settled with native focus and
zero browser errors. Reports are `tmp/p5-{forest,town}-{a1,b1,a2,b2}.json`.
`qa:water:acceptance --headed` passed every functional gate with zero browser/GPU
validation errors (`tmp/p5-water-acceptance.json`), but lost native foreground
focus, so `performanceAuthoritative` is false and its 7.2 ms p95 is rejected as
pacing evidence. The repeat (`tmp/p5-water-acceptance-foreground.json`) also
passed the functional gates with zero browser/GPU validation errors, but lost
native focus and exited 1. Its 7.9 ms p95 is likewise rejected. No authoritative
pacing pass is claimed for this frozen phase-5 arm; final-runtime water and
matrix checks provide the subsequent integration validation.

### Quality headroom: two-cascade trial rejected, reflection-only fallback (2026-11-10)

Phase 6 was evaluated after the user explicitly authorized proceeding with
documented earlier gate failures. The phase-4 experiment remains reverted.
`d43b6be7` changed only the requested two YAML values: reflection resolution
128 → 256 and shadow cascades 1 → 2. Mobile overrides were not changed.
The tree-clock correction is included in the actual trial runtime `48e5ee27`,
frozen on port 5194.

The first headed NVIDIA WebGPU forest trial, 1280×720,
`--warmup 8 --duration 12 --settle --gpuTimings 1`, measured **8.027 ms render
CPU** against the **5.67 ms** ceiling, and **3.369 ms GPU** against 3.75 ms.
It settled with zero browser errors. Native foreground focus was lost, so
its pacing/FPS results are rejected; CPU phase time and GPU timestamps remain
the work order's focus-independent gate evidence. The runner exit was 1 due
to focus (`tmp/p6-two-cascades-trial.json`). No acceptance pass is claimed for
this failed trial, and its remaining quality/matrix runs were stopped early.

The prescribed fallback `42f0aa0c` restores **one cascade** and keeps **256 px
water reflections**, with every other enhancement setting unchanged. It is
frozen on port 5195; the original pre-phase-1 commit `e437410f` is frozen on
5190 for the final A/B. This fallback does not ship long-range cascaded shadows.
The existing shadow-distance setting remains 120 m.

All **4275 tests pass** on the fallback (`tmp/p6-final-tests.log`), using the
same `node --test` invocation as `npm test`. Its headed NVIDIA WebGPU 720p
comparisons use `--warmup 8 --duration 12 --settle --gpuTimings 1`, forest
`--x 2005 --z 2941`, A/B/A/B on each route. All eight settled, retained native
foreground focus and had zero browser errors.

| Route | Metric | Pre-phase-1 A1, A2 | Fallback B1, B2 | Gate |
|---|---|---|---|---|
| Forest | Render CPU avg ms | 5.971, 5.554 | 5.347, 5.529 | Pass: both ≤ 5.67 and ≤ A mean 5.7625 |
| Forest | GPU avg ms | 3.105, 3.031 | 3.021, 3.015 | Pass: both ≤ 3.75 |
| Forest | Final draw-call gauge | 251, 249 | 234, 235 | Reported |
| Town | Render CPU avg ms | 8.559, 8.350 | 6.872, 6.957 | Pass: both ≤ 8.85 and ≤ A mean 8.4545 |
| Town | GPU avg ms | 3.892, 3.906 | 3.865, 3.874 | Pass: within +0.10 ms of A mean |
| Town | Final draw-call gauge | 548, 548 | 388, 388 | Reported |

Render CPU means are **5.7625 → 5.438 ms** in the forest and
**8.4545 → 6.9145 ms** in town. These are cumulative comparisons against
`e437410f`, including the separately committed `a2e7cce8` weather/shader/fixture
work; they are not isolated phase-6 gains. The original plan's baseline had
included uncommitted shader edits, so its historical values and this clean
commit baseline are distinct. The phase-6 fixed ceilings pass in both runs.
Reports are `tmp/p6-final-{forest,town}-{a1,b1,a2,b2}.json`.

At 2560×1440, both additional forest runs settle with zero browser errors and
native focus. GPU averages are **6.975 and 6.917 ms**, both below the **8.3 ms**
ceiling (`tmp/p6-final-1440p-{b1,b2}.json`). Reported viewport size is
2560×1440 at device scale 1. These runs also record render CPU of 5.336 and
5.187 ms; the phase's 1440p gate concerns GPU time.

Final-runtime `qa:water:acceptance --headed` passes every gate and exits 0,
with native foreground focus, `performanceAuthoritative: true`, zero
browser/GPU validation errors and **7.0 ms frame p95**
(`tmp/p6-final-water-acceptance.json`). This validates the retained scatter
change, corrected tree clock and reflection fallback together; the earlier
frozen phase-5 focus failures remain failures above.

Visual checks on `42f0aa0c`, NVIDIA WebGPU, 1600×900:

- Forest at hours 7 and 18.6, plus a 35 m overview at hour 7, coast at hour 12
  and the previously verified Eldara river at hour 12 have ready assets,
  zero browser errors and the expected one cascade/256 px reflection settings
  (`tmp/p6-world-visual-p6-final/report.json`). Inspected the forest morning/
  evening pair, coast and river. One-cascade shadow coverage is retained;
  no extension beyond the existing 120 m setting or new cascade seam is claimed.
- The first frame labelled town showed the wooded approach at the performance
  scenario's starting coordinate, so it is rejected as town visual evidence.
  The replacement uses the same burg-18 plan-derived fixture as phase 3 and
  checks a doorway, furnished room and street at hour 12. All three pass with
  ready assets, exact room camera height, NVIDIA WebGPU and zero errors
  (`tmp/p6-town-visual/report.json`). Inspected the actual street/building image.
- A lower river-bank view at hour 12 makes tree reflections visible. Paired
  reflections-on/off captures at water time 123.4 s show the gold/green canopy
  silhouettes on the surface when enabled, without obvious blocky edges.
  The existing water-review harness verifies biome 6, river kind 3, readiness,
  fixed source and zero browser errors (`tmp/p6-reflection-closeup/report.json`).
  The earlier steep river overview was insufficient to judge silhouette edges,
  which is why this additional angle was captured. This is a visual check,
  not a quantitative aliasing comparison against 128 px.

The first full headed matrix exits 1 because the settlement browser lost native
focus. Both outbound and return runs exist, but share the failed focus monitor
and runner exit. The other five workloads and water pass their gates. Its
unaltered reports are retained under `tmp/p6-matrix-first/`, with the matrix in
`tmp/p6-final-matrix.json`. No town pacing result from that attempt is claimed.
The complete matrix was repeated after foreground availability was confirmed;
no implementation or quality setting was changed for the repeat.

The **full headed matrix repeat exits 0**, using the `qa:perf:matrix` script
on the frozen fallback at port 5195, 1280×720, warmup 8 s, movement 10 s and
20 s recovery observation. It is a full run, not a water-only refresh.
`tmp/p6-final-matrix-retry.json` records `gate.passed: true`, no gate failures,
the correct base URL and all required density multipliers. The raw reports,
matrix and authoritative water report are archived under `tmp/p6-matrix-final/`.

| Workload | Frame p95 ms | Hitch rate % | Native focus | Collision gate | Browser errors |
|---|---|---|---|---|---|
| Standard | 7.4 | 0 | Pass | Pass | 0 |
| Dense forest | 7.6 | 0 | Pass | Pass | 0 |
| High grass | 8.3 | 0.06 | Pass | Pass | 0 |
| Dense mixed | 8.58 | 0.07 | Pass | Pass | 0 |
| Construction ring | 15.7 | 0.70 | Pass | Pass | 0 |
| Settlement approach | 13.96 | 0.42 | Pass | Pass | 0 |
| Settlement return/180° turn | 11.3 | 0.08 | Pass | Pass | 0 |
| Water acceptance | 6.7 | 0.01 | Pass | Pass | 0 |

All workloads settled. Every p95 is below 33.3 ms and every hitch rate below
2%; grass coverage/recovery, stress-density and water behavioral gates pass.
Town outbound and return share one browser and one native focus/error monitor
that starts before the first run and stops after the return. The table's return
focus/error values refer to that complete session, not a separate nested
capture. The matrix water run records `performanceAuthoritative: true` and zero
GPU validation errors. No FPS/hitch result from a lost-focus attempt is used.

### Performance work order outcome (2026-11-10)

| Phase | Retained result |
|---|---|
| 1 | Water bounds/culling retained: 34 → 18 forest water draws. Historical strict town CPU failure remains documented. |
| 2 | Interior batching retained: 249 → 89 main-pass interior draws; isolated town render saving 1.801 ms. |
| 3 | 169 world uniforms moved to the frame group; protected camera/reflection/tree clocks retained. CPU/raw-count gate failures retained under the user's explicit exception. |
| 4 | Reverted as required: texture checks stayed at 25; no experiment remains in the runtime. |
| 5 | Numeric spacing buckets/scratch list retained: named self time −81.1% (−79.7% including key helper), exact placement fixtures unchanged. Common gate/frozen-water focus misses remain documented. |
| 6 | 256 px reflections, one cascade. Two cascades rejected at 8.027 ms forest CPU. Final CPU/GPU ceilings, visuals, tests, water and full matrix pass. |

The shipped runtime matches frozen `42f0aa0c` (runtime snapshot SHA-256
`3ca35b493937c72bb4cfc97acc21fb165667d28bf4bf1aa1fcefae44b2c187c4`).
Subsequent performance-report commits do not change its runtime files. No
long-range cascaded-shadow improvement is shipped, and phase 4's later
performance/visual checks were skipped after its mandatory revert. Earlier
failed gates were documented and explicitly retained by the user, not relabelled.
