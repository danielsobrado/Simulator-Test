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

Added 2026-07-25: `qa:perf` needs the app already serving (`npm run dev`), and its
hitch count tracks how much chunk streaming is still in flight — always compare
runs at the same `--warmup`, and prefer an A/B against the unmodified code over
comparing to the recorded baseline on a different machine.

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
