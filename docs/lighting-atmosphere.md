# Lighting and atmosphere

Highfield's first lighting pass reuses the regional sky, day/night clock,
hemisphere fill, HDR environment, directional shadows and aerial perspective.
Geometry, shadow-map resolution and render passes are unchanged.

| Benchmark condition | Time selector | Weather mode | Intensity |
| --- | --- | --- | --- |
| Clear midday | Highfield (day) | off | 0 |
| Golden-hour sunset | Emberfall (golden hour) | off | 0 |
| Dry overcast midday | Highfield (day) | overcast | 1 |

Highfield uses a restrained blue sky, warm sunlight and less ambient fill to
retain shaded form. Emberfall keeps a warm low sun against cooler fill with
slightly denser distance haze. Their exposure scales are 0.96 and 0.94; the
existing scene finish still owns tone mapping and grading.

Overcast is weather layered over any time or regional look. It closes the
cloud deck, reduces direct light relative to fill, widens the existing shadow
filter and removes distinct cloud shadows at full cover. It starts no rain or
storm system and adds no rain wetness. Regional snowfall still follows the
existing snow-country rules. Choosing another weather mode clears the cloud
cover through the existing transition.

The HDR environment previously retained its morning intensity throughout the
day/night and weather cycle. Its intensity now follows resolved linear light
energy from the sun and hemisphere, relative to the configured sky. A late HDR
load uses the latest scale. The reference is explicitly the configured look,
instead of the default meadow preset. Exposure is applied only at the output.
The existing HDR texture is reused; this is an indirect-light approximation,
not real-time global illumination or a dynamically recaptured reflection.

## Reproducible acceptance

```sh
node --test test/lighting-atmosphere.test.js test/sky-look.test.js test/sky-region.test.js tests/SkyAmbient.test.js test/weather-controller.test.js
npm run dev
node scripts/run-world-visual-lighting-qa.mjs --highfield --out tmp/lighting-atmosphere/visual
npm run qa:perf -- --headed --qa chunk-cross --warmup 8 --duration 12 --settle --drain-seconds 5 --out tmp/lighting-atmosphere/perf.json
```

The three-view capture holds the grassland pose (`original-04`), geometry and
camera fixed, uses fresh contexts, and checks scenery readiness, converged
lighting, loaded HDR, zero rain wetness, one cinematic finish and browser
errors. It records the resolved look and environment intensity. As with the
full lighting suite, use a clean committed checkout or the immutable source
server for accepted captures.

Compare performance with the same route and hardware before and after, following
[the movement QA guide](perf-qa.md). Acceptance budgets remain p95 at or below
33.3 ms and hitch rate at or below 2%, with successful settling and hardware
WebGPU. Investigate streaming counters and CPU phases before adding lighting
passes. The earlier scenic-tour hitch counts are not a measured baseline for
this change.

Accepted on hardware on 2026-10-31 (NVIDIA WebGPU, frozen copies of the code).
The three-view capture passes. It first showed blue holes under full overcast:
the look lowered cloud density by a fixed offset, and a clear-skied region raised
it back, so density now eases to an absolute lid. Regional personality cannot
reopen it.

`chunk-cross`, every run focused. d4d5c706 against the same tree with only this
pass's shader files rolled back, so assets and the spell dock match:

| | FPS by run | p95 | p99 | Hitches |
| --- | --- | --- | --- | --- |
| Shaders rolled back | 120.1, 125.1, 121.3 | 10.9–11.6 ms | 16.9–22.2 ms | 5, 0, 3 |
| This pass | 125.1, 125.4, 123.9, 124.1, 120.8 | 10.9–11.7 ms | 15.5–19.4 ms | 1, 0, 1, 1, 3 |
| This pass, `contactOcclusion=0` | 127.4, 124.5 | 11.0–11.1 ms | 14.7–16.4 ms | 3, 3 |

The pass has no measurable cost on this route, and contact occlusion is within
run-to-run spread. `chunk-cross` meets no town, so the town material changes are
not exercised here.

An earlier single pair showed 130.0 against 109.9 FPS; disregard it. Its baseline
paired old code with live assets, which can fail the impostor signature check and
draw low-poly proxies, so an old-commit copy is not a clean baseline after the
trees change. The slow side matched a separate mode, about 108 FPS with p95 16 ms,
p99 32 ms and runs of 34 ms frames. It hit all three `contactOcclusion=0` runs that
came last in a base, head, no-occlusion cycle, and neither of the two in the
reversed series, so it follows something other than the shaders. Its cause is
unknown; if it appears, compare `renderSubmissionCpu` p95 (9 ms against 6 ms).

## Meadow blending pass

Ground plants, bushes and flower cards bend their normals to the sky
(`applySkywardNormal`), as the meadow's blades do; upright normals caught almost no
high sun and read near black against the grass. Cloud-shadow edges are 2.5× wider
than the dome's cloud edges. Crowns add distance in-scatter in `foliageLight.js`,
which the live trees and impostors share, so no impostor rebake is needed: exp² fog
is still near zero at the treeline. All of it is ALU; no pass or light is added.

`chunk-cross`, same session, focused, 12 s: 110.1, 107.1, 115.9 FPS before and
102.0, 115.5, 106.2, 103.7 after, with p95 12–13 ms against 11.7–14.4 ms. A fifth
after-run hit 70.9 FPS with 31 hitches and did not recur in the next two; its cause
is unknown. If it reappears, A/B this pass before blaming streaming.

## Terrain specular antialiasing

Wet sand drew a dotted moiré under the moon at grazing angles: its tight lobe met
per-pixel derivative normals. `antialiasSpecularRoughness` widens roughness by the
normal's screen-space variance, and wet sand and swash film roughness rose to 0.42
and 0.3 (`config/water-visual.yaml`). Hardware frame cost is not yet measured: the
A/B was abandoned because another session was using the GPU.

## Highfield foreground review

In the accepted `original-04` captures at `0b7ede54`, the road and distant trees
remained legible under cloud, but the foreground grass lost detail. The sky dome
showed a bright cloud base while the hemisphere still sampled the darker zenith
behind it. The hemisphere now includes the cloud base in daylight and a smaller
contribution from the horizon when the sun is low. Terrain, grass, foliage and
the HDR environment use the same resolved light. The blend runs when the sky
look changes and adds no render pass.

Workshop and settlement buildings now use the same normal-map sample for
surface lighting and specular filtering. The shader build test checks the
generated WGSL for a single normal texture read on a representative wall.

Meadow ribbon normals now use the same rotation as the stem vertices. With the
old signs, a quarter turn carried the shaded edge to the opposite side of the
blade, especially visible under a low sun. The material test turns roots, tips
and both edges through known angles and compares them with the vertex rotation.
