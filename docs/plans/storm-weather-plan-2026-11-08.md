# Storm weather: heavy rain, blizzards and the intensity ladder (2026-11-08)

Research and design only; nothing here is implemented yet. The target feel is
the one Valheim gets from its weather — wind you can see in everything, the
distance closing in, sound that tells you the weather before you look up — as a
reference for feel, not a copy of its systems or look.

Read first: [CLAUDE.md](../../CLAUDE.md) (no scene lights for effects, no
`viewport*Texture` nodes in world materials, spell lights stay virtual),
[perf-qa.md](../perf-qa.md), and the recent snow commits on `main` this builds
on: flake size cap and world-wind drift (`1d819c8b`), snow light calibration
(`b294928c`), rock snow (`ae1fa3b6`, `57a0c405`), glacier drifts (`fc3349e9`).

## 1. What exists, and what is missing

The weather already has most of the parts. What it lacks is **one value that
moves smoothly and that every part reads**: today each system reads
`weatherSettings.weatherMode` and `weatherIntensity` directly, so changing the
mode is a cut, and `storm` is a separate mode rather than the top of a ladder.

| Area | Exists (file) | Gap for storms |
| --- | --- | --- |
| Mode + intensity | `weather_controller.js` (`off/overcast/meadow/rain/snow/sandstorm/storm/wind`, intensity 0–1.6) | Modes switch instantly; `storm` has no precipitation of its own; nothing picks rain vs snow from climate |
| Rain streaks | `CinematicRainField.js`: one instanced draw, 10 000 drops, 48 m box, slant from `wind × sampleWorldWind(center).envelope` | Fixed count (intensity is opacity only); one population; slant reads the gust at the camera, not per drop |
| Rain impacts | `rain_system.js` + `rain_splash_placement.js`: 220 hard / 120 water splashes, re-placed every 8 m | Fixed count; no puddles |
| Snowfall | `snowfall/SnowfallField.js` + `snowfallFieldMaterial.js`: one instanced draw, three populations (far/mid/near-soft), angular size cap 0.014 rad, world-anchored wrap, `setRegionalSnow` | Own sinusoidal gust (`gustFactor`, 11 s) separate from the world wind; drift capped at 5 m/s; density by opacity only |
| World wind | `wind/WorldWindPass.js`, `worldWindState.js`, `windFieldModel.js`: 128² gust texture, 384 m window, `prevailingWindFromWeather` → intensity 0.45–2.4 | Gust shape (`gust.threshold/peak`) is config, not live; intensity is a step with the settings |
| Lightning | `storm_ground.js` + `storm_ground_materials.js`: 32 ground strikes inside 48 m, flashes timed **in the shader** from `uTime` | Nothing on the CPU knows when a flash happens, so the sky cannot flash and thunder cannot follow; strikes are spell-close, not weather-far |
| Sky / fog | `SkyLookController.setOvercast` → `overcastSkyLook` (`SkyLook.js`): greys colours, sun −85 %, fog ×1.6, cloud lid | Overcast stops at fog ×1.6; `boundRegionalFogScale` caps regional fog; no whiteout, no flash |
| Wetness | `surfaceWetness.js`: `surfaceWetnessUniform` (wet 40 s / dry 240 s), `buildingWetnessUniform`, read by terrain, bark, foliage, impostors, towns, with `canopyShelter` | No puddles or puddle ripples on land |
| Snow on the ground | `materials/SnowAccumulation.js` → baked `weights.a` in `TerrainMaterialBakedNodes.js`, canopy caps (`canopySnow.js`), rock snow, grass frost | All baked/biome-driven; nothing accumulates during a snowfall |
| Air in snow country | `SnowCountryWeight.js`, `snowCountryLook.js`, `AmbientEffectsSystem.js` (diamond dust, spindrift, `windiness`) | Spindrift does not follow a storm |
| Water | `RippleField` drops (`main.js`: `drops + rain × 24`), `updateSeaState({ storm, rain })` | Fine; only needs the new value |
| Audio | `audio/soundscape_weights.js` (`rainLight/Medium/Heavy` triangular crossfade, `meadow/alpine` wind × gust), `ambient_soundscape.js` beds (1.6 s fades) through one ambient gain; CC0 bank in `public/audio/cc0/` with `CATALOG.md`; procedural `thunder`/`lightning` voices in `vfx/audio/spellSoundBank.js` | No strong-wind/blizzard bed, no gust one-shots, no thunder bed, no roof/canopy rain, no muffling, no weather sub-bus |

The design below adds **one module** (the storm state), **one CPU scheduler**
(lightning), and extends the rest in place.

## 2. The intensity state machine

### 2.1 One value, five named levels

`storm` is a single number `S ∈ [0, 1]`. Levels are keyframes on it, not
states that switch:

| Level | `S` | Meaning |
| --- | --- | --- |
| clear | 0.00 | the time-of-day look, prevailing breeze |
| light | 0.25 | drizzle or light flurries, thin cloud |
| moderate | 0.50 | steady rain/snow, overcast lid |
| heavy | 0.75 | downpour / heavy snow, gusts, distance closes in |
| storm | 1.00 | gale, thunderstorm (rain) or blizzard whiteout (snow) |

Every parameter in §3–§6 is a table over these five keys, evaluated with a
monotone piecewise-cubic (or plain smoothstep between neighbouring keys), so
the per-level tables below **are** the data. Keep them in
`config/weather-effects.yaml` under a new `storm:` block and validate them in
`WeatherEffectsConfig.js` like the existing `rain`/`snowfall` blocks.

### 2.2 Easing: rate-limited approach, then per-channel lag

The target `T` comes from the settings (the UI's mode + intensity) today and
from a weather scheduler later (the deterministic clock of
`03-deterministic-time-scheduler-plan-2026-07-24.md`). `S` approaches it:

```
dS/dt = clamp((T − S) / τ, −rDown, +rUp)
τ = 8 s, rUp = 1/90 s⁻¹ (clear → storm ≥ 90 s), rDown = 1/150 s⁻¹ (storm → clear ≥ 150 s)
```

The rate limit gives the long, even build of a real front; τ softens the start
and the arrival so nothing kinks. A UI change mid-ramp just moves `T`; the
value on screen never jumps (the same rule `SkyLookController.setPreset`
follows). A debug `?storm=<0..1>&stormSnap=1` sets `S = T` for captures and QA.

Real weather does not arrive all at once, so each consumer reads `S` through
its own lag, ordered **cloud → wind → precipitation → ground**:

| Channel | Derived from | Lag | Why |
| --- | --- | --- | --- |
| `cloud` | `S` led by +0.1 | τ 20 s | the sky darkens before the first drop |
| `wind` | `S` | τ 12 s, plus gusts (§3.3) | gusts arrive with the front |
| `precip` | `smoothstep(0.12, 1, S)` | τ 10 s | nothing falls until the cloud is in |
| `wetness` | `precip × rainShare` | integrator, existing `SurfaceWetness` 40 s / 240 s | ground dries long after |
| `snowCover` | `precip × snowShare` | integrator (§5.2), ~6 min to full, melts only outside snow country | snow builds and stays |
| `lightning` | `smoothstep(0.78, 1, S) × rainShare` | none (event process) | only real thunderstorms |

Ramp-down runs the same order: precipitation stops first because its
threshold is crossed first, then the wind drops, then the cloud breaks, while
the ground stays wet or snowed.

### 2.3 Rain or snow: climate decides, the storm does not

Precipitation type is not part of the storm state. Per frame:

```
snowShare = max(snowCountry.snowfall-weight, smoothstep(snowLine − 150 m, snowLine + 50 m, groundHeight))
rainShare = 1 − snowShare
rain = precip × rainShare, snow = precip × snowShare
```

`SnowCountryWeight` already eases as the player walks (it resamples rings at
0/60/180 m every second), so walking from a valley storm up into a pass
crossfades rain → sleet → blizzard with no extra state. Around
`snowShare ≈ 0.5` both fields run at half density: that is sleet and needs no
third system. Hot arid biomes (Azgaar 1–2, `arid: sand` in `biome-looks.yaml`)
map `precip` to the existing `SandstormWeatherSystem` instead; that is out of
scope here beyond leaving the hook.

The existing `setRegionalSnow` stays as the floor: snow country snows lightly
whatever the storm says, and the storm only makes it heavier
(`snow = max(regional, precip × snowShare)`), exactly the rule
`SnowWeatherSystem.effectiveIntensity` already applies.

### 2.4 Where it lives and what reads it

New `src/editor/weather/storm/StormState.js` (state + easing, pure, unit
tested), `stormCurves.js` (key tables + evaluation), and `stormUniforms` as
`frameUniform`s for shaders: `cloud`, `wind`, `rain`, `snow`, `wetness` (the
existing `surfaceWetnessUniform`), `snowCover`, `flash`. CPU consumers get one
frozen snapshot per frame (`stormFrame`).

`main.js` today derives four ad-hoc values from the raw settings —
`weatherAudioLevels`, `seaStormForWeather`, `weatherOvercast`, and the rain
passed to `surfaceWetness.update`. All four become reads of `stormFrame`; the
UI's modes become presets that set `T` (`rain` = 0.5, `storm` = 1, `snow` = 0.5
with the type still from climate, `overcast` = cloud only). `weather_controller.js`
passes the snapshot to each system's `update` instead of `applySettings` toggling
`group.visible`; a group hides itself when its own channel is below 1e-3.

| Reader | Reads | File |
| --- | --- | --- |
| Rain field + splashes | `rain`, `wind` | `CinematicRainField.js`, `rain_system.js` |
| Snowfall | `snow`, `wind` | `snow_system.js`, `snowfall/*` |
| World wind | `wind` | `WorldWindPass.js` |
| Sky, fog, light | `cloud`, `snow` (whiteout), `flash` | `SkyLookController.js`, `SkyLook.js`, `cloudLighting.js` |
| Lightning + thunder | `lightning` | `storm_ground.js`, new `LightningScheduler.js` |
| Ground | `wetness`, `snowCover` | `surfaceWetness.js`, `TerrainMaterialBakedNodes.js`, `canopySnow.js`, rock snow |
| Ambient air | `wind`, `snow` | `AmbientEffectsSystem` (`windiness`) |
| Sea, ripples | `rain`, `wind` | `main.js` (`updateSeaState`, `waterInteraction.update`) |
| Audio | all of the above + shelter | `soundscape_weights.js`, `ambient_soundscape.js` |

## 3. Precipitation rendering

### 3.1 Populations near / mid / far

Both fields keep one instanced draw each. The rain field gains populations the
way the snowfall already has them (a `layers` list in the config, the same
`snowfallPopulations` resolution):

| Rain population | Box | Share | Streak length | Width | Notes |
| --- | --- | --- | --- | --- | --- |
| near | 12 m | 0.25 | 0.5–0.9 m | 0.8–1.4 cm | drives the slant you read; angular caps below |
| mid | 48 m (today's field) | 0.6 | 0.45–0.9 m | 1.26 cm | as now |
| far | 110 m, top 60 m | 0.15 | 2–4 m | 3–5 cm | long sheets that sell distance; fog fades them |

Snow keeps its three layers (far 46.8 m, mid 16.6 m, near-soft 6.5 m) and
gains the storm-only behaviour of §3.4.

Both fields need the angular caps the snowfall got in `1d819c8b`: a rain streak
1 m from the eye is otherwise a 20 px wide bar. Cap width at 0.002 rad
(~3 px at 1600 px / 60°), floor it at 0.0008 rad (~1 px, so far drops do not
shimmer to nothing), and cap length at 0.09 rad (~125 px).

### 3.2 Density: count, not opacity

Today rain and snow scale **only opacity** with intensity. That keeps every
light-rain drop's vertex and fragment work while the drops fade to nothing,
and it cannot make a storm denser than the authored count. The snowfall's
comment already warns against scaling both (coverage would go with the square
of intensity). The fix is to scale **count** and keep opacity:

- Allocate each field at its storm count (table 3.5).
- Cull a flake/drop when its stratified key exceeds its layer's density:
  the snowfall already stores `(index + random) / count` in `snowSeed.w` and
  never reads it; rain uses `hash(instanceIndex + k)`. A culled instance gets
  zero size, so it costs four vertices and no fragments.
- Interleave populations in the buffer (layer = pattern by index) instead of
  contiguous runs, so `instanceCount = ceil(maxCount × maxLayerDensity)` trims
  the vertex work too without dropping one whole layer first.
- Keep an opacity ramp only at the very bottom (`min(1, density / 0.15)`) so
  the first flakes fade in rather than pop, and so light regional snowfall
  reads as before. Capture regional snowfall before/after: this is a look
  change for it.

### 3.3 Wind slant and gusts

The rain already slants by `wind / fallSpeed`; the snow drifts with the world
wind since `1d819c8b`. For storms:

- **One gust signal.** Drop the snowfall's private `gustFactor` (11 s sine)
  in favour of the world wind: sample `sampleWindFieldCpu` at the camera once
  per frame on the CPU (WorldWindPass already answers CPU queries) and feed the
  same envelope to both fields. Keep `snowWindIntegral`'s analytic-integral
  idea: integrate the sampled speed on the CPU into `drift` so a gust never
  makes flakes jump.
- **Per-drop gust, not per-field.** The rain field samples the wind texture at
  `center.xz` — the same value for every drop. Sample at the drop's own xz (one
  fetch per vertex, the cost the wind texture was built for) so a gust visibly
  sweeps across the rain.
- **Raise the drift cap.** `SNOW_DRIFT_SPEED` is capped at 5 m/s in
  `snow_system.js`; a blizzard needs ~15 m/s horizontal against a 1.2 m/s fall,
  which is what makes it a blizzard.
- **Velocity stretch.** At `snow ≥ 0.75` stretch near and mid flakes along
  their screen-space velocity by `|v| × 1/60 s` (capped at 4× the flake
  diameter): that is the horizontal streaking that reads as a gale. Rain
  streaks already align with their velocity.
- **Gust shape live.** Make `gust.threshold` and `gust.peak` of
  `windFieldModel.js` uniforms of the pass: storm lowers the threshold
  0.48 → 0.30 (more frequent gusts) and raises the peak 0.86 → 1.0.

### 3.4 Camera-relative recycling

Already right and must stay right: both fields wrap world-anchored positions
with `fract` inside a box that follows the camera, with canonical phases
reduced on the CPU in double precision (`SnowfallField.updatePhases`). The rain
field wraps from `center` alone; give it the same CPU-side canonical phase as
the snowfall so a floating-origin rebase does not re-seed every drop. High wind
makes the wrap visible only if a box is smaller than ~3 s of travel at the gust
speed; at 15 m/s the far snow box (46.8 m) is fine, the near-soft box (6.5 m)
wraps every 0.4 s — cull the near-soft layer above `wind ≥ 0.8`, where the
streaked mid layer carries the near field anyway.

### 3.5 Per-level precipitation table

Rain (`rain` channel; counts are live instances after culling):

| Level | near | mid | far | fall m/s | opacity | splashes hard/water |
| --- | --- | --- | --- | --- | --- | --- |
| clear | 0 | 0 | 0 | — | — | 0 / 0 |
| light | 600 | 2 500 | 400 | 12 | 0.8 | 60 / 40 |
| moderate | 1 500 | 6 000 | 1 200 | 14 | 1 | 140 / 80 |
| heavy | 3 000 | 10 000 | 2 500 | 16 | 1 | 220 / 120 (today) |
| storm | 4 500 | 14 000 | 4 000 | 18 | 1 | 320 / 180 |

Snow (`snow` channel; populations as `weatherEffects.snowfall.layers`):

| Level | far | mid | near-soft | drift cap m/s | stretch | notes |
| --- | --- | --- | --- | --- | --- | --- |
| clear | 0 | 0 | 0 | — | — | regional floor still applies |
| light | 2 000 | 1 500 | 40 | 3 | off | ≈ today's regional snowfall |
| moderate | 6 700 | 5 200 | 144 | 5 | off | ≈ today's full 12 000 |
| heavy | 12 000 | 9 000 | 200 | 9 | 2× | |
| storm | 18 000 | 12 000 | 0 (culled) | 15 | 4× | whiteout §4.2 does the rest |

`count` validation in `WeatherEffectsConfig.js` caps at 20 000 per field; raise
it to 32 000 for the storm allocation.

### 3.6 Overdraw budget

Per-metre screen coverage of a uniform field is constant with depth (projected
area falls as 1/d², the frustum shell grows as d²), so coverage ≈
`ρ · Ω · area · f² · depth`. With today's rain (ρ ≈ 0.09 drops/m³, 0.0082 m²
streaks, f ≈ 1386 px, 24 m depth) that is ~24 000 px, under 2 % of a
1600 × 900 frame; the snowfall is similar, and its near-soft layer under the
angular cap costs ~380 px per flake whatever its distance. So drops are cheap;
what is not cheap is (a) big soft near particles, which the cap already
prevents, and (b) any full-screen veil. Budgets:

- Precipitation fragments ≤ 0.35 screen-equivalents at `storm`, ≤ 0.1 at
  `moderate` (measure with a `?weatherOverdraw=1` debug that renders the fields
  additively at 1/64 into a cleared target).
- No full-screen weather quad. Whiteout is fog (§4.2), which the materials
  already pay for.
- Vertex work: ≤ 64 000 instances total = 256 000 vertices at storm — well
  under 0.1 ms; the per-vertex wind fetch of §3.3 stays a single texture read.

## 4. Atmosphere

### 4.1 Cloud, light and fog per level

All through `overcastSkyLook` (extend it, do not add a second look path):
`setOvercast(cloud)` already greys colours and closes the lid by `t = 1`. Give
it a second argument, `storm`, for the darkening and fog beyond full overcast:

| Level | cloud | sun (directional) | ambient | fog density × | visibility target | cloud shadow |
| --- | --- | --- | --- | --- | --- | --- |
| clear | 0 | ×1 | ×1 | ×1 | preset | ×1 |
| light | 0.45 | ×0.6 | ×0.95 | ×1.3 | ~1 500 m | ×0.5 |
| moderate | 0.8 | ×0.25 | ×0.88 | ×1.8 | ~600 m | ×0.1 |
| heavy | 1 | ×0.15 | ×0.8 | ×3 | ~250 m | 0 |
| storm (rain) | 1 | ×0.1 | ×0.7 | ×5 | ~150 m | 0 |
| storm (snow) | 1 | ×0.1 | ×0.95 | ×12 | ~50 m | 0 |

For `FogExp2`-type fog visibility at 5 % contrast is `V ≈ 1.73 / density`;
convert each target against the active look's base density rather than
hard-coding density. `boundRegionalFogScale` limits regional fog headroom to
×1.4 over the base: storm fog must be applied **after** that bound (it is
weather, not region), like the bog murk is laid over the finished look.

Fog colour: rain storms pull fog toward a dark blue-grey (`#4a535c` at night
scale ×0.35); snow storms pull it toward the sky-lit snow colour so the world
fades to white rather than grey. Keep exposure in step with the world renderer
and the workshop preview (CLAUDE.md): change light, not tone mapping.

### 4.2 Blizzard whiteout

Whiteout = high fog density with a bright fog colour, plus three cheap cues, no
screen-space pass:

1. Fog colour → `skyLightUniforms`-scaled snow white, density per table 4.1.
2. Sky: raise the sky material's horizon fog band to the zenith with `snow`
   (the sky already takes `fogDensityScale`; add a `whiteout` term so the sun
   disc and stars vanish).
3. Snow field: at `snow ≥ 0.75` the far population brightens toward the fog
   colour (it *is* the fog up close) and the velocity stretch carries motion.
4. Spindrift and diamond dust from `AmbientEffectsSystem` follow `windiness =
   wind` (the field already exists; it just needs the storm's value).

Spindrift shader cost is already paid in snow country; whiteout adds none.

### 4.3 Lightning for rain storms

The current strikes are a ground-hit effect inside 48 m with flashes timed in
the shader, so nothing else can react to them. For weather lightning:

- New `weather/LightningScheduler.js` (CPU, seeded `Rng`): a Poisson process
  with rate per level (below). Each event has a time, a bearing, a distance
  (log-uniform 0.4–8 km; < 1 % under 300 m) and a kind (`sheet` in-cloud 80 %,
  `bolt` 20 %). Deterministic for QA from the seed and the storm clock.
- **Flash** (`stormUniforms.flash`, 0..1): a double-pulse envelope (the same
  `flashA`/`flashB` shape `storm_ground_materials.js` uses), scaled by
  `1 / (1 + d/2 km)`. It lifts ambient and cloud emission for 60–250 ms through
  `cloudLighting.js` and the look's ambient — uniform writes, **not** a light.
  Brightening the directional light for a frame is allowed (it exists already)
  but adds no shadow change; do not add a light (CLAUDE.md).
- **Bolt**: reuse `StormLightningSystem`'s strike geometry with one active
  strike placed at the event's position on the horizon (≥ 300 m), its `flash`
  driven from the CPU uniform instead of the shader's own `uTime` gate. The
  shader-time gate stays for the spell-close strikes if anything still uses
  them; the weather path stops using it.
- **Thunder** (§6.3) is scheduled from the same event, delayed by `d / 343 s`.

| Level | events / min | bolts share | nearest allowed |
| --- | --- | --- | --- |
| < heavy | 0 | — | — |
| heavy | 0.5 (only above `S` 0.78) | 0.1 | 1.5 km |
| storm | 3 | 0.2 | 300 m |

Snow storms get no lightning (thundersnow is rare and reads as a bug).

## 5. Ground response

### 5.1 Rain: wetness, puddles, ripples

- **Wetness**: done — `SurfaceWetness.update(dt, stormFrame.rain)` instead of
  the raw intensity. Canopy shelter, building wet/dry rates and every reader
  stay as they are.
- **Puddles** (new, terrain only): a puddle mask from data the bake already has
  — flat (`slope < 4°`) and concave (`curvature`, used by `snowAccumulation`)
  ground, broken by the existing drift noise, gated by
  `smoothstep(0.45, 0.9, wetness)`. Bake the static part (flat × concave ×
  noise) into a spare channel of the terrain bake if one is free; otherwise
  derive it in the shader from the baked slope term. Where `puddle > 0`:
  roughness → 0.06, albedo × 0.6, normal → up (water surface), so the sky and
  sun reflect through the existing environment lighting. No reflection pass,
  no viewport texture.
- **Puddle ripples**: procedural rings in the puddle mask only — a hashed 0.4 m
  cell grid, one ring per cell with a random phase, radius `fract(t·rate + h)`,
  perturbing the puddle normal; rate from `rain`. Behind a uniform branch
  `If(rain > 0.01 && puddle > 0)` so dry frames pay one comparison. Open water
  already gets rain drops through `RippleField` (`drops + rain × 24`); keep
  that, driven by `stormFrame.rain`.
- **Splashes**: counts per table 3.5, from the existing placement.

### 5.2 Snow: build-up

Snow lying on the ground is baked per biome today. For a storm to *leave*
snow:

- New integrator `SnowCover` beside `SurfaceWetness` (same file pattern, own
  config `stylizedSurface.snowCover`): rises with `stormFrame.snow` to 1 in
  ~6 min of storm (`buildSeconds 360`), melts over `meltSeconds 600` only where
  `snowShare < 0.3` (in snow country it never melts). Writes
  `stormSnowCoverUniform`.
- Terrain: `snow = max(baked weights.a, snowCover × upFacing × (1 − water) ×
  driftNoise)` in `TerrainMaterialBakedNodes.js`, so the existing snow colour,
  roughness and `SnowLightingModel` response apply unchanged.
- Canopy: add `snowCover` to the per-instance canopy snow before the cap
  smoothstep (`canopySnow.js`); rock snow (`ae1fa3b6`) the same on its
  per-vertex deposition term; grass frost via the grass gate.
- Building snow on roofs is a follow-up (roof faces already read the building
  wetness vector; the same pattern applies).

### 5.3 Meadow and tree sway

Already one shared field (`sampleWorldWind`/`sampleWorldWindCanonical`): grass,
flowers and trees sway to the world wind. The storm sets the pass's intensity
from the `wind` channel instead of the settings' wind magnitude:

| Level | wind m/s (10 m) | `WorldWindPass.intensity` | gust threshold / peak |
| --- | --- | --- | --- |
| clear | 2 | 1.0 (calm reference) | 0.48 / 0.86 |
| light | 4 | 1.3 | 0.45 / 0.88 |
| moderate | 7 | 1.7 | 0.40 / 0.92 |
| heavy | 11 | 2.1 | 0.35 / 0.96 |
| storm | 16 | 2.4 (today's ceiling) | 0.30 / 1.0 |

The direction keeps the settings' wind vector (or the scheduler's front
bearing). Capture grass and trees at 2.4 before raising the ceiling: the
materials were tuned against `referenceStrength`, and bends past their clamp
read as broken, not windy.

## 6. Audio

### 6.1 Structure

Today every bed goes through one ambient gain to the master. Add a **weather
sub-bus** in `ambient_soundscape.js`: weather beds and one-shots → `GainNode`
→ `BiquadFilterNode` (lowpass) → ambient gain. Muffling then touches weather
only, not the forest or the stream. Beds stay sample loops faded toward their
weight (`FADE_SECONDS` 1.6 s, fine since the weights themselves move slowly).

### 6.2 Layers and crossfades

Weights come from `soundscapeWeights`, fed `stormFrame` instead of the raw
`{ rain, wind }`:

| Layer | Weight (from `stormFrame`) | Asset | Status |
| --- | --- | --- | --- |
| rain light / medium / heavy | existing triangular crossfades on `rain` (0.25 / 0.6 / >0.65) | `ambient/rain-*-01.mp3` | exists |
| rain storm | `smoothstep(0.85, 1, rain)` | new: torrential rain loop | add |
| rain on canopy | `rain × canopy share` (forest tiles) | new: rain on leaves loop | add |
| rain on roof | `rain × roofed` (§6.4) | new: rain on roof/planks loop | add |
| wind open / alpine | existing, `gust` from `wind` | `meadow-wind`, `alpine-wind` | exists |
| wind strong | `smoothstep(0.5, 0.9, wind)` | new: strong wind loop | add |
| blizzard howl | `snow × smoothstep(0.6, 1, wind)` | new: howling wind loop | add |
| gusts | one-shots, triggered by the CPU gust envelope crossing its threshold at the camera (§3.3), gain ∝ gust | new: 4–6 gust swells | add |
| thunder | one-shots from `LightningScheduler` | new: 4 near cracks + 6 far rumbles; procedural `thunder` voice as fallback | add |

Birds, crickets and calls already fall with `rain`; extend the same `dry`
factor to `max(rain, snow, wind − 0.5)` so a blizzard silences them too.

### 6.3 Thunder from where the flash was

For an event at distance `d` and bearing `b`:

- delay `d / 343 s` (a flash at 3 km rumbles ~9 s later — the gap players read
  as distance);
- gain `clamp(1 / (1 + d / 600 m), 0.08, 1)`;
- lowpass cutoff `8 kHz → 250 Hz` over 0.3–4 km (far thunder is rumble only),
  choosing a near-crack sample under 800 m and a rumble sample beyond;
- stereo pan from the bearing against the listener yaw — the `bearing`
  mechanism `AmbientOneShots` already uses for the sea.

`spellSoundBank.js`'s procedural `thunder` stays the fallback when samples have
not loaded, so the first storm is never silent.

### 6.4 Indoor and sheltered muffling

There is no shelter query yet. Add `shelter` (0..1) to `stormFrame`, sampled
at 4 Hz:

- `roofed`: three short upward rays (head, ±0.6 m) against the settlement
  collision provider (`SettlementCollisionProvider`) — the share that hits a
  roof within 6 m;
- `canopy`: the canopy share under the camera (the same signal
  `surfaceWetness`'s `canopyShelter` uses);
- underwater already silences everything (`SILENT_WEIGHTS`).

Weather sub-bus: lowpass `18 kHz → 900 Hz` and gain `0 → −8 dB` with `roofed`
(eased 0.4 s so stepping through a door is a smooth sweep); `canopy` takes the
lowpass only to 4 kHz. While roofed, the roof-rain bed replaces the
ground-rain beds rather than adding to them. Precipitation rendering also reads
`roofed`: under a roof the near rain/snow layers are culled (they would fall
through the roof), the mid/far stay visible through the door.

### 6.5 Sources (CC0 only)

The bank's rule is CC0 with every file listed in
`public/audio/cc0/CATALOG.md` (source link, size, duration, channels). Look on:

- **OpenGameArt.org** filtered to CC0 (the current rain and wind beds come from
  there);
- **Freesound.org** with the licence filter set to *Creative Commons 0*
  (search: "torrential rain loop", "rain on leaves", "rain on roof",
  "strong wind loop", "blizzard", "wind gust", "thunder close", "thunder
  distant rumble");
- **Wikimedia Commons** CC0 / public-domain audio (the jungle beds came from
  there).

Avoid "royalty-free" packs that are not CC0 (they need their own licence
record). Loops: 20–30 s, stereo, 44.1 kHz, encoded like the bank (MP3 ~96 kbps,
~250 KB per loop); one-shots mono. Budget ~2 MB for the whole storm set,
streamed on first storm through `sample_bank.js`, not at startup.

## 7. Perf budget

On the reference machine of `perf-qa.md` (dt p95 ≈ 10.5 ms, GPU ≈ 2.1 ms in
recent runs), compared A/B against the same code with `?storm=0`:

| Item | Budget at `storm` |
| --- | --- |
| GPU frame time | +0.8 ms total (precipitation ≤ 0.4, fog/sky/puddles ≤ 0.2, lightning ≤ 0.05) |
| Render CPU | +0.15 ms (state, scheduler, shelter rays at 4 Hz, uniform writes) |
| Draw calls | +3 at most (rain far layer is inside the rain draw; one bolt draw; no others) |
| Precipitation overdraw | ≤ 0.35 screen-equivalents (§3.6) |
| Shader variants | none new on world materials: puddles, snow cover, flash are uniforms behind uniform branches |
| Lights | none added (CLAUDE.md) |
| `viewport*Texture` | none (CLAUDE.md) |
| Audio | ≤ 8 concurrent weather voices; ~2 MB streamed samples |
| Startup | nothing loads before the first storm except the existing beds |

At `clear` the storm must cost nothing measurable: every channel below 1e-3
hides its group, and every shader term sits behind a uniform branch.

QA: add a `?storm=<0..1>&stormSnap=1&stormKind=rain|snow` override to the perf
harness and capture `--qa chunk-cross --warmup 8 --duration 12 --settle` at
0, 0.5 and 1 for each kind, A/B against `?storm=0` on the same machine and the
same `--warmup` (CLAUDE.md). The `perf-qa.md` note "storm, dusk and snow
transitions were not captured" is the gap this closes; record the matrix there.

## 8. Phased implementation plan

Each phase lands on `main` on its own, with tests and captures.

1. **Storm state** — `storm/StormState.js`, `stormCurves.js`, `stormUniforms`;
   unit tests for the rate limits, lag ordering and the rain/snow split;
   replace `weatherAudioLevels`, `seaStormForWeather`, `weatherOvercast` and the
   wetness input in `main.js`; modes become target presets; `?storm` override.
   No visual change beyond smooth transitions.
2. **Wind** — `WorldWindPass` reads `stormFrame.wind`; live gust uniforms; one
   CPU gust sample per frame shared by snow and rain; raise the snow drift cap.
   Capture grass and trees at 2.4.
3. **Precipitation density** — count-based density with stratified culling and
   interleaved populations in both fields; rain near/far populations and
   angular caps; canonical phases for rain; velocity stretch for snow; per-level
   tables in `weather-effects.yaml`. Capture regional snowfall before/after.
4. **Atmosphere** — `overcastSkyLook` storm extension, fog after the regional
   bound, whiteout sky term, `AmbientEffectsSystem.windiness` from the storm.
5. **Lightning** — `LightningScheduler`, CPU-driven flash uniform into
   `cloudLighting`/ambient, distant bolt from `StormLightningSystem`.
6. **Audio** — weather sub-bus, new CC0 beds and one-shots with `CATALOG.md`
   rows, thunder delay/pan/filter, gust one-shots, shelter query and muffling.
7. **Ground** — puddle mask and ripples, `SnowCover` integrator into terrain,
   canopy and rock snow.
8. **QA** — perf matrix of §7 recorded in `perf-qa.md`; a `qa:weather:browser`
   case per kind and level in `scripts/run-weather-shader-qa.mjs`.

Phases 1 → 2 → 3 are a chain. After phase 1, phases 4, 5, 6 and 7 touch
disjoint files and can run in parallel.

## 9. Open questions

- Who sets `T` long-term: the deterministic scheduler (plan 03) with fronts
  that move across the map, or a per-region random walk? The state machine
  does not care; the scheduler decides whether storms are shared world state.
- Whether `winterlight`'s near-uniform hemisphere fill (noted in the snow light
  calibration) should be fixed before blizzard captures, since flat light is
  what a whiteout should look like and the comparison would be muddied.
- Roof snow and roof drips are follow-ups once `SnowCover` exists.
