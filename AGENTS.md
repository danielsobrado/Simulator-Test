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


Code Files are not too big unless really necessary and are always SOLID, refactor if needed
