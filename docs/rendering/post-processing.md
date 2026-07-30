# World post-processing

The world viewport uses the WebGPU/TSL stack in
`src/render/postprocessing/`. `PostProcessingController` owns the graph,
temporal history, retained graph resources, invalidation and diagnostics.
`InfiniteTerrainView.render()` gives the volumetric god-ray path first refusal,
then the post-processing controller, then falls back to the ordinary scene
render.

## Render graph

`PostProcessingGraph` constructs this order:

1. One HDR scene pass writes colour, normal, velocity, material data and depth.
2. Screen-space shafts optionally add HDR radiance.
3. SSR optionally builds an eight-level minimum linear-depth hierarchy, traces
   selected surfaces, temporally resolves the trace, and additively composites
   it.
4. TAA or TAAU optionally resolves the scene into full-resolution HDR history.
5. Depth of field optionally blurs the resolved image. Bloom deliberately reads
   the pre-DOF resolved image.
6. Bloom optionally builds a 2–6 level half-resolution HDR pyramid using a
   Karis-weighted 13-tap prefilter, 13-tap downsampling and tent upsampling.
7. Exposure, bloom composition, contrast, saturation and the selected tone
   curve run in linear HDR.
8. Vignette optionally runs on display-linear colour.
9. `renderOutput(..., renderer.outputColorSpace)` performs the single output
   colour-space conversion. The pipeline disables its automatic output colour
   transform to prevent a second conversion.
10. Contrast-adaptive sharpening and film grain optionally run after output
    conversion.
11. An enabled non-`final` debug view replaces the normal output.

TAAU is the only mode that applies `renderScale`: the scene/MRT pass is rendered
at the reduced scale and reconstructed to output resolution. Plain TAA and a
disabled anti-aliasing node always render the scene pass at scale 1.

Effect enables, AA mode, bloom level count, tone-map mode, shaft sample count and
debug view are graph topology. Changing one selects or builds another retained
graph and resets temporal history. Numeric values represented by uniforms do not
rebuild the graph. A display resize retains only the active topology and disposes
stale-sized inactive graphs.

## MRT layout

The scene pass calls `setMRT(mrt(...))` once. Its full-resolution attachments are:

| Name | Format and type | Colour space | Contents |
|---|---|---|---|
| `output` | RGBA, half float | HDR linear | Scene colour and alpha |
| `normal` | RGBA, unsigned byte | none | Packed view-space normal |
| `velocity` | RG, half float | none | Three.js velocity in NDC convention |
| `material` | RGBA, unsigned byte | none | Packed material-data contract |
| `depth` | scene depth attachment | none | Raw device depth |

Linear depth is derived from the scene pass when required. TAA stores separate
ping-pong half-float colour and float linear-depth histories at output
resolution. SSR stores equivalent histories at its configured resolution.

## Material-data contract

The material attachment channels are:

| Channel | Meaning | Encoding |
|---|---|---|
| R | roughness | normalized `0..1` |
| G | reactive mask | normalized `0..1`; larger values reduce temporal history |
| B | reflection class | integer class divided by 255 |
| A | bloom boost | normalized `0..1`; multiplied by `bloom.bloomBoost` |

Reflection class IDs are `NONE=0`, `WATER=1`, `ICE=2`, `WET_STONE=3`,
`POLISHED_STONE=4`, and `MAGICAL_MIRROR=5`. Use
`encodeReflectionClass()`/`decodeReflectionClass()` rather than hand-encoding
the blue channel.

The pass-level default is `(roughness=1, reactive=0, reflectionClass=NONE,
bloomBoost=0)`. `packMaterialData()` is the JavaScript reference encoder and
`packMaterialDataNode()` is its TSL equivalent.

### Important MRT limitation

Do **not** assign `material.mrtNode`. Three.js r185 can compile that per-material
override through non-MRT paths such as screen-space shafts or `compileAsync`;
WGSL then receives an empty `OutputType` struct and pipeline creation fails.

Registration therefore uses `assignMaterialData()` or
`assignMaterialCategory()`, which validates that the material is a
`NodeMaterial` and stores frozen metadata in
`material.userData.postProcessingMaterialData`. Convenience helpers are:

- `assignTerrainMaterialData`
- `assignWaterMaterialData`
- `assignGrassMaterialData`
- `assignTreeFoliageMaterialData`
- `assignBushFoliageMaterialData`
- `assignParticleMaterialData`

The current scene pass writes the pass-level default for every draw.
`userData.postProcessingMaterialData` is the registration contract for a later
attribute/pass-level override, but the current graph does not read that metadata
into individual pixels. Consequently the current material attachment remains
the default unless the pass implementation is extended; registered reflection,
reactive and bloom values do not yet alter SSR/TAA/bloom output. Keep registering
materials now so that material creation sites remain explicit and are ready for
that extension.

## Reactive-mask assignments

The predefined categories are:

| Category | Roughness | Reactive | Reflection class | Bloom boost |
|---|---:|---:|---|---:|
| terrain | 1.00 | 0.00 | none | 0 |
| water | 0.08 | 0.85 | water | 0 |
| grass | 1.00 | 0.65 | none | 0 |
| tree foliage | 1.00 | 0.55 | none | 0 |
| bush foliage | 1.00 | 0.55 | none | 0 |
| particle | 1.00 | 1.00 | none | 0 |

The runtime also tracks short global reactive events without clearing history:
terrain/voxel/construction edits last 2 frames, streamed chunks and
weather/spell starts last 3, and chunk/vegetation/impostor LOD changes last 2
plus any supplied transition frames. `notifyReactive(event, transitionFrames)`
coalesces repeated events to their longest remaining lifetime.

At present `PostProcessingInvalidation.isReactive()` is not sampled by the TAA
or SSR nodes; only material attachment G is sampled. These event lifetimes are
therefore bookkeeping for the pending global-mask integration, not an active
whole-frame rejection signal.

## Registering materials

### A new reflective material

1. Create a Three.js `NodeMaterial`; the helper rejects ordinary materials.
2. Reuse a category helper when it is semantically correct, for example
   `assignWaterMaterialData(material)`.
3. Otherwise call `assignMaterialData(material, { roughness, reflectionClass,
   reactive, bloomBoost })`, using a value from `REFLECTION_CLASSES`.
4. Return or install the same material returned by the helper.
5. Add reference/contract tests for the class and expected metadata.
6. Verify the `material` and `reflection-class` debug views after the MRT
   metadata override is implemented. Under the current limitation, expect the
   pass-level default in those views.

### A new animated or reactive material

Choose a reactive value proportional to how unreliable prior-frame pixels are:
`1` for particles or rapidly changing translucency, approximately `0.5–0.7` for
wind-driven foliage, and `0` for static opaque geometry. Register through
`assignMaterialData()` or add a named category plus convenience helper in
`PostProcessingMaterialData.js`. Do not confuse this per-pixel metadata with
`notifyReactive()`: the latter records short world-transition events and
currently does not feed the material mask.

## History reset events

`invalidate(reason)` clears TAA colour/depth validity, SSR validity, both
ping-pong read indices, jitter index and the previous view-projection matrix.
It records the reason in history and diagnostics. Valid reasons are:

- startup and graph/resource changes: `INITIAL_FRAME`, `RESIZE`,
  `RENDER_SCALE_CHANGED`, `POST_GRAPH_REBUILT`, `MANUAL_RESET`
- camera discontinuities: `CAMERA_MODE_CHANGED`, `CAMERA_TELEPORT`,
  `CAMERA_FOV_CHANGED`, `PLAYER_SPAWNED`, `ACTIVE_CAMERA_REPLACED`
- world discontinuities: `FLOATING_ORIGIN_REBASE`, `WORLD_LOADED`,
  `WORLD_IMPORTED`, `SAVE_RESTORED`, `MASS_CHUNK_REASSIGNMENT`

Callers must invalidate for every camera projection discontinuity or scene
identity jump. The controller already handles startup, resize, render-scale and
graph changes; `main.js` wires world loads/imports/restores, floating-origin
rebases, mode/camera changes, player spawn and teleports. A reason being defined
does not make detection automatic: new FOV-changing code, for example, must call
`invalidate(CAMERA_FOV_CHANGED)`.

## Settings reference

Settings are normalized, deeply frozen and persisted as plain objects. Unknown
keys warn and are ignored; invalid enum values fall back to defaults. Store
edits become preset `custom` unless `markCustom: false`; coalesced edits flush at
most once per animation frame.

- `enabled` (`true`): master world post-processing switch.
- `preset` (`balanced`): `off`, `low`, `balanced`, `high`, `ultra`, or `custom`.
- `renderScale` (`1`, `0.67..1`): scene scale in TAAU mode only.
- `antiAliasing`
  - `enabled=true`; `mode=traa` (`traa|traau`)
  - `jitterSamples=8` (`1..16`, though the implemented Halton table contains 8)
  - `feedback=0.90` (`0.70..0.97`)
  - `varianceGamma=1.25` (`0.75..2.50`)
  - `depthRejectionMinMeters=0.05` (`0..10`)
  - `depthRejectionScale=0.02` (`0..1`)
  - `reactiveStrength=0.90` (`0..1`)
  - `motionRejectionPixels=32` (`1..256`)
  - `historyClampStrength=1.0` (`0..2`); normalized but currently not consumed
    by `TaaResolveNode`.
- `bloom`
  - `enabled=true`; `intensity=0.18` (`0..1.5`)
  - `threshold=3.0` (`0.5..8`); `knee=1.4` (`0.05..3`)
  - `levels=4` (`2..6`, integer); `bloomBoost=3` (`0..8`)
- `toneMapping`
  - `enabled=true`; `mode=agx` (`agx|aces|neutral|none`). `enabled=false`
    selects no tone curve; exposure/contrast/saturation adjustments still run.
  - `exposure=1` (`0.25..2.5`)
  - `contrast=1` and `saturation=1` (both `0.8..1.2`)
- `sharpen`: `enabled=true`; `amount=0.22` (`0..0.8`).
- `ssr`
  - `enabled=false`; `resolutionScale=0.5` (`0.25..0.75`)
  - `maxSteps=32` (`8..64`); `binarySteps=5` (`0..8`)
  - `maxDistanceMeters=80` (`10..200`)
  - `thicknessMeters=0.35` (`0.05..2`)
  - `roughnessCutoff=0.45` (`0..0.8`); `intensity=0.60` (`0..1`)
  - `temporalFeedback=0.85` (`0.70..0.97`); `edgeFade=0.08` (`0..0.5`)
- `screenSpaceShafts`
  - `enabled=true`; `resolutionScale=0.5` (`0.25..0.75`)
  - `samples=24` (`8..48`, integer); `intensity=0.40` (`0..2`)
  - `reach=0.82` (`0.1..1`); `decay=0.955` (`0.5..1`)
  - `highSunFadeStartDegrees=35`, `highSunFadeEndDegrees=55` (both `0..90`)
- `depthOfField`
  - `enabled=false`; `focusMode=player`
    (`player|selection|centre-raycast|manual`)
  - `manualFocusMeters=6.2` (`0.5..2000`); `focusSmoothing=4` (`0..32`)
  - `maxCoCPixels=3.5` (`0..8`); `taps=16` (`4..32`, integer).
    The current node has a fixed 16-tap shader, so normalized `taps` is not
    currently consumed.
  - `nearStartRatio=0.55`, `nearFullRatio=0.16` (`0..1`)
  - `farStartMeters=130` (`1..5000`), `farFullMeters=620` (`1..10000`)
- `vignette`: `enabled=false`; `intensity=0.12` (`0..0.5`);
  `innerRadius=0.35`, `outerRadius=1.05` (both `0..2`).
- `grain`: `enabled=false`; `intensity=0.012` (`0..0.05`).
- `diagnostics`: `enabled=false`; `debugView=final`;
  `showGpuTimings=false`.

GPU timing is asynchronous. Three.js r185 exposes only an aggregate render
timestamp, so `totalPost` may be populated while named pass timings remain
`null`; diagnostics intentionally avoid a GPU-to-CPU synchronization point.

## Presets

Quality presets preserve DOF, vignette, grain and diagnostics. They also leave
screen-space shaft settings at defaults because that technique is owned by its
separate UI.

- **Off:** disables the master switch.
- **Low:** AA and sharpen off; bloom intensity 0.08 with 2 levels; AgX; SSR off.
- **Balanced:** TAA feedback 0.90; bloom 0.18/4 levels; AgX; sharpen 0.22; SSR
  off.
- **High:** TAA feedback 0.92; bloom 0.22/5; sharpen 0.20; SSR at
  0.5 scale, 32 trace and 5 binary steps.
- **Ultra:** TAA feedback 0.94; bloom 0.24/6; sharpen 0.18; SSR at
  0.75 scale, 48 trace and 5 binary steps.

SSR's independent quality presets are low `(0.25,16,3)`, medium
`(0.50,32,5)`, and high `(0.75,48,5)` for resolution scale, max steps and
binary steps respectively.

## Debug views

Enable diagnostics and choose one of:

- `final`: normal graph result.
- `hdr-colour`: raw scene-pass HDR colour (shown through output conversion).
- `depth`: scene linear depth as greyscale.
- `normal`: packed view normal.
- `velocity`: RG velocity remapped from `[-1,1]` to `[0,1]`.
- `material`: raw RGBA material data.
- `reactive-mask`: material G as greyscale.
- `reflection-class`: material B decoded and scaled across classes 0–5.
- `bloom`, `ssr`, `taa-history`, `taa-rejection`: accepted setting values, but
  the current `DebugViewNode` has no specialized implementation and falls back
  to HDR colour.

Debug output is selected at graph build time and does not add a second scene
pass.

## Adding a post-processing node

1. Put a focused class or factory under `src/render/postprocessing/nodes/`.
   Accept upstream nodes and settings; expose `outputNode`.
2. Use an HDR half-float, `NoColorSpace` RTT before tone mapping. Use an
   unsigned-byte, `NoColorSpace` RTT only for work intentionally after output
   conversion.
3. Implement `updateUniforms`, `resize` and idempotent `dispose` for every owned
   RTT/material. Keep parameter-only changes in uniforms.
4. Insert the node at the correct colour-space/depth point in
   `PostProcessingGraph`, wire resize/update/disposal, and add its logical GPU
   pass names.
5. Add its enable to defaults, normalization and
   `POST_PROCESSING_EFFECT_KEYS`; include topology-only values in
   `createPostProcessingTopologySignature`.
6. Add preset behavior only if it is a quality control. Preserve artistic
   controls when applying quality presets.
7. Add warmup variants, debug support where useful, Node-runnable reference
   tests and browser QA matrix coverage.
8. If it owns temporal state, put resources in `PostProcessingHistory`, latch
   them only after a successful render, and make all discontinuity reasons clear
   them.

## Avoiding processing UI

The post graph receives only `terrainView.scene` and its camera. Keep UI as DOM
siblings/overlays outside that Three.js scene; DOM inventory, map, settings and
other overlays are composited by the browser after the canvas and are therefore
not post-processed. Do not add HUD sprites or panels to `terrainView.scene` if
they must remain crisp. If a canvas UI is required, render it in a separate
scene after the post pipeline or composite it as a distinct final node.

The controller's `bypassProvider` is for renderer-level incompatibility, not UI
exclusion. The current provider bypasses this graph while the separate
volumetric god-ray technique owns rendering.

## Diagnosing ghosting

1. Reproduce with `diagnostics.enabled=true`; inspect `velocity`, `depth`,
   `reactive-mask`, `taa-history` and `taa-rejection`. Remember the last two
   currently fall back to HDR, so use browser captures/history state as well.
2. Check `history.lastResetReason`, `resetCount`, validity flags and console
   messages. A teleport, FOV change, camera replacement, resize, rebase, world
   load or graph rebuild must invalidate history.
3. In the velocity view, static geometry should be neutral and moving geometry
   coherent. Check instanced/animated materials for valid previous transforms.
4. Compare current and previous linear depth. Halos at disocclusions usually
   mean the minimum/scale rejection threshold is too permissive.
5. Check whether animated pixels have an appropriate reactive registration, and
   account for the current MRT limitation: metadata is not yet reaching G.
6. Temporarily lower `feedback`, increase `reactiveStrength`, lower
   `varianceGamma`, or reduce SSR `temporalFeedback` to identify which temporal
   path retains the bad sample. Do not treat tuning as a substitute for a
   missing reset or velocity.
7. Compare TAA disabled, TAA, and TAAU. TAAU adds Catmull–Rom reconstruction of
   the low-resolution source and is more sensitive to render-scale and jitter
   errors.

## Diagnosing colour-space errors

1. Confirm every HDR intermediate is half-float with `NoColorSpace`; material,
   velocity, normal and depth data must also use `NoColorSpace`.
2. Confirm exposure, bloom, contrast, saturation, tone mapping and vignette run
   before the single `renderOutput` conversion.
3. Confirm `RenderPipeline.outputColorTransform` remains `false` while the graph
   is active. A second renderer conversion causes washed-out or overly dark
   output.
4. Confirm sharpening and grain are after output conversion. Moving either into
   HDR/linear space changes their visual strength.
5. Compare post-processing Off against `toneMapping.mode=none`, then
   `hdr-colour` against `final`. This separates scene-lighting errors from tone
   curve/output conversion errors.
6. Verify renderer `outputColorSpace` and browser capture path. Never tag
   numeric MRTs or history textures as sRGB.

## QA commands

Install dependencies normally, then install Playwright's Chromium once:

```sh
npm install
npm run qa:postprocessing:install
```

Start the app in a separate terminal before either runner:

```sh
npm run dev
```

Create deterministic baseline captures and reports:

```sh
npm run qa:postprocessing
npm run qa:postprocessing -- --headed
npm run qa:postprocessing -- --only forest-close,route
```

Run the browser acceptance matrix (presets, scenes, TAAU, effects, debug views,
toggle/preset stress, resize, camera switching and rebase):

```sh
npm run qa:postprocessing:browser
npm run qa:postprocessing:browser -- --quick --headed
```

Both runners reject software or unidentified WebGPU adapters unless explicitly
given `--allow-software`. Baselines default to
`tmp/post-processing-qa/baseline`; browser reports, gallery and screenshots
default to `tmp/post-processing-qa`.

## Third-party algorithms

The TAA Catmull–Rom reconstruction and bloom Karis/downsample techniques were
substantially adapted from the Snowflow Demo post-processing implementation.
The required MIT attribution and full licence text are recorded in
`THIRD_PARTY_NOTICES.md`.
