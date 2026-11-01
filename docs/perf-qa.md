# Player movement performance QA

Deterministic harness for reproducing and measuring player-mode stutter while moving across the streamed world.

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
