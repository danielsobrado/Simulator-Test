# Project guidance

## Azgaar terrain compatibility

Azgaar is the canonical terrain format. Keep its 13 standard biome IDs as the
engine's terrain IDs `0–12`, in Azgaar order, without collapsing them into
generic terrain groups. Persist non-standard biome definitions with the world
and allocate their terrain IDs deterministically from `32–254`.

Backward compatibility with the former plains/forest/desert/swamp/snow tile-ID
scheme is not required. Do not add legacy remapping or migration code unless a
future task explicitly asks for it.

## QA and performance

Before changing terrain generation, chunk streaming, rendering, or residency
behavior, read and follow the [player movement performance QA guide](docs/perf-qa.md).
Use its deterministic harness to compare streaming-sensitive changes.

 `qa:perf` needs the app already serving (`npm run dev`), and its
hitch count tracks how much chunk streaming is still in flight — always compare
runs at the same `--warmup`, and prefer an A/B against the unmodified code over
comparing to the recorded baseline on a different machine.

## Asset startup

Only the trees and the shared scene may block the first frame.
Every other authored variant streams in per biome through
`StylizedVariantResidency`, one install per frame — see
[asset startup and variant residency](docs/asset-startup-and-variant-residency.md).
Do not add an authored GLB to a `Promise.all` in `bootstrapLayers`; register it
as a residency layer instead, and give it `tileIds` so it can be withheld from
worlds that lack its biomes.

When a scatter view installs prototypes, it must append rather than rebuild, and
bump its `prototypeRevision` — the resident-window update key is otherwise blind
to the prototype set and a variant arriving under a stationary camera would never
be drawn.

## Workshop art direction

Buildings must read as constructed stonework, not noise-displaced boxes
(`docs/plans/procedural-medieval-construction/04-masonry-and-stone-generation.md`
§19). Two consequences when touching workshop generation:

- Per-unit shaping goes through `stoneJitter`; it stays inside the course band the
  packer assigned, and structural dressings (voussoirs, quoins, ashlar, coping)
  are scaled down rather than shaped like field masonry.
- Readability comes from bevel lighting plus baked per-vertex crevice occlusion,
  not from outlines (`05-…md` §13). If a material declares `vertexColors`, every
  geometry merged into it must carry the attribute — use `harmonizeVertexColors`.

The world renderer and the workshop preview must agree on tone mapping and
exposure, or a baked asset will not look the way it did while authoring.

Code Files are not too big unless really necessary and are always SOLID, refactor if needed
