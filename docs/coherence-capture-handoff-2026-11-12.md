# Coherence capture handoff — 2026-11-12

All **52 review images** are captured in
[`docs/qa/environment-look/coherence-handoff-2026-11-12/`](qa/environment-look/coherence-handoff-2026-11-12/).
This folder is ignored by Git and stays in this shared checkout.

- [38-shot contact sheet](qa/environment-look/coherence-handoff-2026-11-12/contact-sheet.jpg)
- [Crown shadows off/on: four matching poses](qa/environment-look/coherence-handoff-2026-11-12/crown-shadows-before-after.jpg)
- [Understory before/after: ten matching poses](qa/environment-look/coherence-handoff-2026-11-12/understory-before-after.jpg)
- [Capture index and raw reports](qa/environment-look/coherence-handoff-2026-11-12/README.md)
- [Transfer archive: all PNGs, previews and reports](../tmp/coherence-capture-handoff-2026-11-12.zip)

The runtime is frozen at `34b8e9d82674287c11aca79a1632d80ac5af8bb1`, including
the density increases from `91298f26` and crown shadows enabled. The server's
snapshot digest is
`7a6666557883d053a729796a02330a1ca82286c00c6af9233110089b752bd4ea`.
Capture reports record the source snapshot, requested and resolved poses,
biome, scenery readiness, atlas integrity and image metrics.
The four crown on/off pairs and ten understory before/after pairs have
identical recorded camera poses. Wind, particles and cloud animation time
were not frozen, so these are visual comparisons rather than pixel-identical
image A/B tests. The understory baseline is `00a8dc14` from 2026-11-11 and
includes multiple subsequent changes, not an isolated density comparison.

## Standard capture results

All **38/38 images were captured**, with settled scenery, all 40 atlases
loaded, a fixed source snapshot and zero browser errors. **31 shots pass
their existing gates; seven fail.** The run correctly exits non-zero.

| Shot | Failed metric | Measured | Required |
| --- | --- | ---: | ---: |
| `wetland-rain-12` | Ground mean / p95 | 11.18 / 25.74 | ≥35 / ≥70 |
| `coast-storm-12` | Ground mean | 37.88 | ≥40 |
| `core-taiga-snow-12` | Ground mean | 52.79 | ≥150 |
| `town-off-21` | Full mean / noon mean | 0.5464 | ≤0.5 |
| `tundra-snow-12` | Ground contrast | 27.28 | ≥30 |
| `snow-eye-snow-12` | Ground contrast | 28.28 | ≥30 |
| `town-rain-12` | Ground p95 | 117.72 | ≥135 |

Review these failures against the images before changing gates. In particular,
the eye-level snowy taiga is much darker than its aerial view, and the
blizzard views are nearly white. No gate was relaxed for this handoff.

The current-state images use headed NVIDIA Lovelace WebGPU at 1600 × 900,
device scale 1. The separate movement measurements use 1280 × 720, device
scale 1, warmup 8 seconds, duration 12 seconds, full scenery settling and GPU
timestamps. Crown-shadow controls change only `?crownShadows=0`.

The 60 FPS preference in the
[work order](plans/coherence-polish-plan-2026-11-11.md) applies. Report frame
p95, maximum frame time and frames over 16.667 ms alongside average FPS;
an average above 60 does not prove that every frame met that limit.

## Performance samples

The documented forest route is `chunk-cross --x 2005 --z 2941`; town uses
`settlement-approach` (burg 18). These are the work order's movement routes,
separate from the fixed still-image poses. Each route gets one OFF/ON pair,
not the repeated A/B/A/B required for final acceptance. All quoted results
require hardware WebGPU, native foreground focus, settled scenery, complete
loaded atlases and zero browser errors.

| Route / crowns | Avg FPS | Frame p95 / max ms | Render CPU avg ms | GPU avg ms | Frames >16.667 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Forest off | 117.11 | 11.985 / 68.8 | 5.596 | 2.859 | 12 (0.85%) |
| Forest on | 113.94 | 12.175 / 35.6 | 5.853 | 2.878 | 10 (0.73%) |
| Town off | 105.85 | 12.900 / 36.4 | 5.807 | 3.961 | 24 (1.89%) |
| Town on | 100.52 | 13.600 / 64.5 | 6.040 | 4.128 | 32 (2.66%) |

Forest crown-shadow sample: **+0.257 ms render CPU / +0.019 ms GPU**. CPU
cost is 0.007 ms above the +0.25 ms stage budget; GPU cost is inside +0.20 ms.
Average FPS and frame p95 clear 60 FPS, but individual frames do not. The
off control also has such frames. No strict 60-FPS minimum or attribution of
those spikes to crown shadows is claimed. Repeated pairs remain necessary
before using this small CPU delta as an acceptance decision.

Town crown-shadow sample: **+0.233 ms render CPU / +0.167 ms GPU**, within
both stage budgets. All four runs pass the validity conditions above. Both
enabled runs average above 60 FPS and have frame p95 below 16.667 ms; neither
proves an uninterrupted 60-FPS floor. The shadow setting stays as authored
for the next AI's visual review. The original full-resolution screenshots,
raw performance reports, run logs and checksum inventory are in the transfer
archive. Isolated density A/B, repeated crown pairs, the full performance
matrix, weather browser suite and manual traversal were not run.

## Startup repair

The requested commit `91298f26` could not start the editor:

```text
Invalid editor configuration: stylizedSurface.groundDetails.perChunk must not exceed 256.
```

The authored budget was already 320 before that commit and became 400 in it.
`34b8e9d8` allows the authored 400 ground-accent budget and retains the 256
caps on aquatic and tropical layers. Instance buffers already size from
`residentRadius` and `perChunk`. A regression test covers the three bounds;
the growth-profile test now accounts for the previously committed density
overrides. All **4,294 tests pass** (`tmp/coherence-handoff-tests.log`). No
visual setting was changed during this capture task.

## Existing asset limitation

All 40 tree atlases load and report runtime readiness. However,
`npm run validate:impostors:required` fails with:

```text
Tree impostor source changed: src/editor/stylized/StylizedTreeView.js. Run npm run bake:impostors.
```

The second-pass plan already requires a rebake after the bark changes. These
captures preserve the current asset state so on/off comparisons share it.
They are evidence for the next AI's review, not final acceptance of the
unrebaked distant trees. The tropical scan rebuild is also still outstanding.

## Next review

The current rainforest and taiga images still show pronounced black/white
stipple on the centered trunks. The bark fix is **not visually verified**.
The rainforest trunk stipple remains visible with crown shadows both off
and on.
Rainforest still has a broad bare patch and green mound-like plant bases;
taiga still has pale slabs/boulders and black patches among the near blades.
Grassland still shows pale teal shrubs and gaps between the near stems.
These are visual observations, not a diagnosis of their owners.

Start with the nearest trunks in rainforest, taiga and temperate rainforest;
then compare the eye/floor pairs for grass gaps, black blade patches, plant
mounds and floating debris. Inspect the grassland shrubs, aerial tree discs
and snow edges, coast horizon and shoreline, noon clouds, and town paving,
rain and night lighting. Keep visual observations separate from measured
performance gates. No density tuning, shader tuning or asset rebuild is part
of this capture task.
