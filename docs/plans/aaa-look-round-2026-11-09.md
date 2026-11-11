# AAA look review and next improvement round (2026-11-09)

Source: 23 captures of `main` at `b1c8f90f` (storm phases 1–7 landed), 1600×900,
hardware WebGPU, through `window.__worldVisualQa`, with snapped weather
(`setLighting({ hour, weather })`, then `warmWeather(8)`). Downscaled shots and
a contact sheet are in `docs/qa/aaa-look-2026-11-09/`, which is local only because `docs/qa` is git-ignored. The script is
`tmp/aaa-look2.mjs`, which is not tracked.

Poses: procedural world for forest, grassland, rainforest, taiga, wetland,
coast and desert (biome poses from `docs/qa/visual-audit-2026-10-15`); Eldara
for tundra, glacier, snow at eye level, and the town street (poses from recent
snow and house sessions). The old Eldara biome poses in
`docs/qa/world-visual-quality-2026-10-14/biomes/shore-review-poses.json` now
put the camera in the sea or on bare snowfield. They are out of date and need
re-selecting before anyone uses them again.

## What already reads well

- **Forest at eye level in clear weather:** the trees have varied silhouettes,
  the grass sways and catches light, and the paths read.
- **The forest in a rain storm:** the darker, desaturated palette, fog layers
  between tree rows, and rain streaks give a believable mood.
- **The wetland in a storm:** the canopy, depth fog and fireflies have
  atmosphere.
- **The glacier in clear weather:** the snow drifts, rock snow caps and crag
  stone hold up close and in the middle distance.
- **The town by day:** the masonry, timber framing, market stalls and NPCs read
  as a place; the lit windows and lantern in rain are a strong cue.

## Gaps, worst first

### P0: bugs that break a shot

1. **Wet ground and puddles go near black.**
   - Wetland in rain: the whole foreground, grass included, is a black pool
     with no sky reflection.
   - Coast storm: the wet sand is black-brown.
   - Darkening overshoots, and the puddle term reflects nothing, so standing
     water reads as a hole.
   - Owner: `RainWetnessShading.js`, `PuddleShading.js` (phase 7).
2. **The blizzard erases the world.**
   - Tundra snow storm: the frame is one flat grey card with a ghost boulder.
     There are no near-ground contrast, no readable flakes, and no horizon.
   - Phase 8 saw the same at storm 1.
   - The fog closes to well under 30 m.
   - AAA whiteouts keep a 40–80 m readable near field, with ground texture,
     rocks, and the player's footing in contrast. They also stream visible
     wind-driven flakes, and fade only the distance.
   - Owner: the phase 4 fog and whiteout terms, and the snowfall field.
3. **A snow storm in temperate or taiga ground leaves the ground dark.**
   - Taiga snow storm: the conifers and rocks are white, but the ground stays
     dark green-grey. The ground and foliage disagree.
   - Owner: the `SnowCover` → terrain feed (phase 7). It seems to gate on the
     snow-country tile share.
4. **The time of day doesn't take effect in captures.**
   - Hours 7, 18.6 and 21 all rendered as noon: same sun and sky, no
     night-time lanterns.
   - Either `WorldVisualQa.setLighting` loses the hour (the `highfield` preset
     may override it), or the day–night cycle is not driving the sky.
   - Verify first: until it works, nobody can review dusk, night or dawn.

### P1: weather that falls short of the Valheim bar

5. **Rain on water uses decal rings.**
   - The ripple circles on the sea and ponds are large, evenly spaced,
     same-sized discs.
   - They need many small rings with varied sizes and lifetimes, plus a
     roughened surface normal from rain.
6. **The sea in a storm is flat.**
   - Coast storm: no swell, whitecaps, spray or foam line, though `seaStorm`
     reaches 1.
   - The sea-state feed from phase 1 exists; the water shader needs to show
     it.
7. **Snowfall reads as sparse dots.**
   - Both clear snow country and the snow storm show small round specks.
   - Heavy snow needs wind-stretched streaks near the camera, layered depth,
     and a falling-curtain look in the middle distance.
   - Owner: the snowfall field, building on phase 3 density.
8. **The storm sky is a flat grey texture.**
   - It has no darker cloud bases, no low fast-moving scud under the deck, and
     no light break near the horizon.
   - The cloud deck needs a two-layer look and a horizon gradient.
9. **Rain shows no ground response.**
   - There are no splashes on hard surfaces, no runnels, and no wet sheen on
     the town cobbles.
   - The town in rain looks foggy, not wet.

### P2: art direction at clear weather

10. **Cumulus clouds are blurred cotton cut-outs.**
    - They have no lit side, no shadowed base, and no silhouette detail. The
      forest sky reads as a smeared wash.
    - Volumetric-looking clouds come from lighting the existing noise (a sun
      dot and base shading), not from raymarching.
11. **The horizon and aerial perspective are weak.**
    - Forest-air and desert: distant land meets the sky in a hard line or a
      flat white band.
    - Distance needs a blue-grey aerial gradient that scales with the view
      distance, and a slight haze on the hills.
12. **Biome transitions are hard masks.**
    - Forest-air: the snow sheet meets green grass with a sharp brown ring.
    - Desert: large flat patches of cracked soil against sand.
    - Edges need noise-broken blends and transition flora such as tussocks,
      scree and sparse grass.
13. **Grass and ground colour are uniform.**
    - The forest-floor grass is one saturated lime green.
    - Grassland shows blotchy dark-grey dither patches and a white bald patch.
    - Small bushes render as pale translucent ghosts (grassland, hour 7),
      which looks like a dithered LOD or impostor fault.
    - Needs hue and value variation, dry tips, flowers and clover patches.
14. **Tree crowns light flat.**
    - The leaf-card clumps share one light level, with no inner-crown
      occlusion and no back-lit translucency.
    - The storm doesn't visibly bend crowns, though grass sways.
15. **The coast in clear weather is untextured.**
    - Turquoise is uniform out to the horizon, there is no shore foam line,
      and underwater props read as floating sprites.
16. **Fog shows dither noise.**
    - Town in rain: dark speckle across the ground and the tree crowns, and a
      hard horizontal edge on the near cobbles.
    - Alpha-dithered LODs and the fog are interacting.

17. **Night fog renders as a brown slab.**
    - Town at hour 21, captured after D: a warm brown band of glowing mist
      fills the middle of the square, with a hard top edge.
    - It reads as a box, not as air.
    - Likely the valley-mist or regional fog colour taken from a night sky
      look. Belongs to F.

## Next round: workstreams

Each workstream fits one session. They touch disjoint files except where noted.
All follow CLAUDE.md: no `viewport*Texture`, no scene lights, no new terrain
samplers, perf A/B for rendering changes.

| # | Workstream | Fixes | Main files | Notes |
| --- | --- | --- | --- | --- |
| A | Wet ground and puddles | 1, 9 | `RainWetnessShading.js`, `PuddleShading.js`, terrain wet terms | Cap darkening near 0.6× albedo; puddles reflect the sky colour via existing env and fresnel terms; cobble sheen. Capture wetland, coast and town in rain. |
| B | Blizzard visibility and snowfall look | 2, 7 | phase 4 fog/whiteout, `snowfall/` | A visibility floor of about 50 m near-field at storm 1; wind-stretched flakes. Capture tundra and taiga snow at 0.5, 0.75 and 1. |
| C | Snow cover outside snow country | 3 | `SnowCover`, `TerrainStormSnowNodes.js` | Ground accumulation follows `frame.snow`, not the tile share. Same files as B's terrain side: run after B, or merge B and C. |
| D | Time-of-day capture | 4 | `WorldVisualQa.js`, `SkyLookController.js` | **Done.** `setLighting` paused the clock and then forced the `highfield` preset, so the hour moved only the sun and moon. Without a named preset it now applies the hour's time blend. A preset chosen after a blend is no longer skipped as a repeat. |
| E | Storm sea and rain on water | 5, 6 | water and sea shaders | Swell and whitecaps from `seaStorm`; many small varied rain rings. |
| F | Sky: lit cumulus and storm deck | 8, 10, 11, 17 | `overcastSkyLook`, cloud and sky nodes | Sun-lit cloud tops and shaded bases; storm scud layer; aerial horizon gradient. Phase 4 owns these files, so follow its structure. |
| G | Ground variety and transitions | 12, 13 | terrain blend, grass and scatter | Noise-broken biome edges; grass hue and value variance; investigate the ghost bushes. |
| H | Foliage lighting | 14, 16 | tree and leaf materials, dithered LOD | Inner-crown AO and translucency; storm crown bend; dither and fog speckle. |

Suggested order: D first (cheap, and it unblocks review). Then A, B+C and E in
parallel; then F, G and H.

After each workstream, recapture with `tmp/aaa-look2.mjs` at the same poses
and append before/after pairs here.

## Environment coherence: phase 1 stop (2026-11-11)

Implementation of the [environment coherence work order](environment-coherence-plan-2026-11-10.md)
stopped at its phase 1 taiga rule. The user explicitly confirmed this stop;
phases 2–6 were not implemented. The tracked `qa:look` harness, canopy-pose
helpers, metric tests and initial storm-ground/blizzard edits had already
landed together in shared-checkout commit `a2e7cce8`. This section records
their acceptance status; workstreams A, B and C remain open.

The first 38-shot attempt on 2026-11-10 used `45cfdebc` plus the then-pending
environment edits. It captured 36 shots on NVIDIA Lovelace WebGPU with zero
browser errors. Both `core-wetland` shots rejected the supplied anchor
`(-5773, -7687)`: no canopy coverage of at least 0.75 existed within its
480 m search. A separate, wider diagnostic search selected `(-4365, -7367)`
in biome 12 with coverage 0.933. The fixture now uses that anchor; the
production search limit and coverage threshold remain 480 m and 0.75.
The original report is retained at
`docs/qa/environment-look/baseline/report.json`; it is a failed baseline,
not an accepted 38-shot reference.

### Confirmed stop condition

At resolved taiga pose `(-7047, 10475)`, biome 9, canopy coverage 0.878,
`core-taiga-snow-12` measured ground mean **75.831** against the required
**150**. An isolated repeat measured **77.271**. In that repeat both
`editor.snowCover.value` and `stormSnowCoverUniform.value` were **1**, and
the storm's `snow` and `snowShare` were **1**. `setLighting` already calls
`snowCover.snap(...)`. This meets the work order's explicit instruction to
stop and report, rather than tune another snow control.

The isolated evidence is retained locally as `tmp/look-taiga-snow-cover.json`
and `tmp/look-taiga-snow-cover.png`. The tracked harness now also records
both snow-cover values in each shot's report. The phase 1 gate limits are
retained unchanged in `scripts/fixtures/environment-look-shots.json`;
a failing look run must continue to exit non-zero.

### Verification on resume

The resumed source was `e92e9d23`, including subsequent performance work from
the other session. No environment renderer or tuning values were changed on
resume. Comparisons with the first attempt are repeated observations across
those source states, not an isolated before/after claim for the storm edits.

- Full suite: **4,275 passed**, zero failures
  (`tmp/environment-phase1-tests.log`).
- Focused ESLint passed for the look runner, metrics, canopy adapter and their
  tests, plus the wet-ground tests. All 38 fixture shot names are unique and
  every gate and comparison reference validates.
- Weather shader acceptance: **14/14 cases passed** on NVIDIA Lovelace hardware
  WebGPU, zero shader errors (`tmp/weather-shader-qa/report.json`, finished
  2026-11-11). The runner also recorded 20 warnings, including WGSL
  unreachable-code warnings; these are not reported as zero browser messages.

No storm knob was advanced after the stop condition. No phase 2 night-bounce
fix, phase 3 biome changes, phase 4 ground tuning or phase 5 storm-sky tuning
was applied. Visual acceptance of phase 1 remains unmet.

### Resumed look gate results

The targeted repeat completed **12/12 captures**, all settled, with zero
browser errors and every declared biome/canopy check passing. Both corrected
wetland views resolve to biome 12 at coverage **0.933**. The 24 shared
full-image mean checks all pass: the selected shots range from **51.650** to
**207.929**, within 25–235. Of **35** numeric gate checks, **28 pass and 7
fail**; six shots fail overall. `qa:look` correctly exits **1**.

| Shot / metric | Nov 10 attempt | Nov 11 repeat | Required | Repeat |
| --- | ---: | ---: | ---: | --- |
| `wetland-rain-12` ground mean | 17.014 | 16.342 | ≥ 35 | Fail |
| `wetland-rain-12` ground p95 | 32.146 | 28.147 | ≥ 70 | Fail |
| `wetland-rain-12` ground mean / clear | 0.287 | 0.272 | ≤ 0.8 | Pass |
| `coast-storm-12` ground mean | 47.456 | 53.160 | ≥ 40 | Pass |
| `town-rain-12` ground p95 | 117.791 | 117.791 | ≥ 135 | Fail |
| `tundra-snow-12` ground contrast | 22.353 | 22.353 | ≥ 30 | Fail |
| `snow-eye-snow-12` ground contrast | 23.353 | 23.566 | ≥ 30 | Fail |
| `tundra-snow-12` full-image deviation | 12.331 | 12.363 | ≥ 12 | Pass |
| `core-taiga-snow-12` ground mean | 75.831 | 75.873 | ≥ 150 | Fail |
| `core-taiga-air-snow-12` ground mean | 181.195 | 181.299 | ≥ 150 | Pass |
| `town-off-21` full mean / noon | 0.507 | 0.525 | ≤ 0.5 | Fail |

The repeat again records snow cover and its shader uniform at **1** in both
taiga shots. The eye-level capture visibly retains its dark foreground; the
aerial gate passing does not satisfy the eye-level gate. Wetland brightness,
puddle highlights, wet-town highlights, blizzard ground contrast and town
night brightness also remain open. None of these limits was relaxed or
removed after the user confirmed the stop.

Local artifacts (the capture directory is git-ignored):

- [Resumed report](../qa/environment-look/phase1-stop-2026-11-11/report.json)
- [Contact sheet](../qa/environment-look/phase1-stop-2026-11-11/contact-sheet.jpg)
- [Taiga at eye level](../qa/environment-look/phase1-stop-2026-11-11/core-taiga-snow-12.jpg)

The contact sheet and corrected wetland eye-level view were inspected. A new
accepted 38-shot baseline and phases 2–6 remain outstanding; this stop record
does not mark any of those phases complete.
