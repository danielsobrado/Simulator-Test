# Project agent guidance

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

## Workshop geometry and building chemistry

Before adding or substantially changing workshop geometry, walls, roofs,
openings, stairs/traversal, supports, procedural building detail, workshop
snapping, or workshop persistence, read and follow:

- [Workshop geometry framework](docs/architecture/workshop-geometry-framework.md)
- [Workshop implementation plan](docs/plans/workshop-geometry-framework-plan-2026-08-19.md)
- [Tiny Glade public-behavior review](docs/research/tiny-glade-workshop-behavior-review-2026-08-19.md)

Canonical workshop authoring state is semantic. Generated geometry is derived.
Automatic building chemistry belongs to the deterministic resolved layer unless
the user explicitly promotes it. Do not add new mesh-to-component inference,
whole-asset rebuilds for known local edits, per-piece scene objects for large
procedural detail sets, or new archetype-specific core branches when the
semantic/registry framework can represent the feature.

Code files are not too big unless really necessary and are always SOLID; refactor if needed.
