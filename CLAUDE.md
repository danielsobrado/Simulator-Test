# Project guidance

## Branches

Work only in `main`: commit there and push `main`. Do not create feature
branches or worktrees, and do not leave work on one — several sessions share
this checkout, and work parked on a side branch has ended up diverging from
`main` and needing hand-merged conflicts. Pull before starting, and commit
in-progress work rather than leaving it uncommitted for the next session.

## Azgaar terrain compatibility

Azgaar is the canonical terrain format. Keep its 13 standard biome IDs as the
engine's terrain IDs `0–12`, in Azgaar order, without collapsing them into
generic terrain groups. Persist non-standard biome definitions with the world
and allocate their terrain IDs deterministically from `32–254`.

Backward compatibility with the former plains/forest/desert/swamp/snow tile-ID
scheme is not required. Do not add legacy remapping or migration code unless a
future task explicitly asks for it.

## Biomes

A biome is rows in tables, never a tile-id branch in a shader or view. To add or
re-dress one, follow [adding a biome](docs/adding-a-biome.md): its palette rules,
the three plant layers, border behaviour and streaming. `tests/biomeContract.test.js`
enforces the checklist; a missing piece is fixed in the biome's rows, and waived
there only with a reason.

## QA and performance

Before changing terrain generation, chunk streaming, rendering, or residency
behavior, read and follow the [player movement performance QA guide](docs/perf-qa.md).
Use its deterministic harness to compare streaming-sensitive changes.

 `qa:perf` needs the app already serving (`npm run dev`), and its
hitch count tracks how much chunk streaming is still in flight — always compare
runs at the same `--warmup`, and prefer an A/B against the unmodified code over
comparing to the recorded baseline on a different machine.

Treat every `viewport*Texture` TSL node as a whole-scene, per-frame cost, never a
per-pixel one. Sampling `viewportDepthTexture` or `viewportOpaqueMipTexture` makes
the renderer copy the colour buffer, copy the depth buffer and build a mip chain
for the entire frame. The cost is **binary and not avoidable by visibility**:
measured, one such mesh costs the same as forty, and setting `visible = false` or
frustum-culling every one of them saves nothing. The only way out is to not build
those nodes into the material — keep them behind a build-time flag and compile a
variant without them for anything that does not need them
(`docs/perf-investigation-2026-07-28.md`).

## Spell VFX

Grimoire spells are procedural particles from one startup-baked atlas — see
[spell VFX](docs/spell-vfx.md). Keep the particle path to one instanced draw,
and do not add scene lights for effects: even one dimmed point light measurably
slows every lit material. Effect lights stay virtual (shader uniforms plus
ground light pools) unless a task explicitly measures otherwise; the terrain and
meadow see the brightest one through the `spellWorldLight` uniforms. Spells mark
the meadow through its spell map (`markGround`), and a held mark or press is
refreshed every 0.1–0.25 s, never stamped every frame.

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

## Settlements

Towns are drawn by `SettlementView` from derived plans — see
[settlement rendering](docs/settlement-rendering.md). Surface textures are
per-settlement dressings loaded on approach through `SettlementSurfaceLibrary`;
do not load them at startup, and keep tintable sets (plaster, stone, roof,
timber) neutral, because the workshop's vertex colours already carry the hue.
Procedural sets are generated in GPU memory from PTL recipes: keep that to one
asynchronously compiled pass, and add only presets that generate in seconds.
