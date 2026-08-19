# Workshop compatibility baseline

Phase 0 freezes the current procedural-workshop persistence, semantic and generated-geometry behavior before the geometry-framework ownership changes begin.

## Source of truth

- `config/workshop-compatibility.yaml` is the fixture and contract catalogue.
- `test/fixtures/workshop-compatibility/legacy-assets.json` contains persisted pre-v7 records that must continue to load.
- `npm run qa:workshop:compat` runs every fixture twice, verifies deterministic persistence and generation, and writes `tmp/workshop-compatibility/report.json`.
- `npm run qa:workshop:compat:visual` additionally requires the representative screenshots produced by `npm run qa:workshop -- --runs 1`.

The compatibility runner is local-only. It does not add or require GitHub Actions.

## Persisted contract

Current workshop asset documents are version **7**. The store accepts versions 1 through 7 and rewrites loaded records to version 7 while preserving the stable asset key. The normalized recipe fields and identifier patterns are declared in `config/workshop-compatibility.yaml` so a schema or ID change becomes an explicit review item.

The fixture set freezes:

- classic, stepped and tapered walls
- gatehouse
- round and square towers
- manor material defaults
- component transforms
- opening attachments and window assemblies
- imported surface-texture persistence
- composition rectangles/circles and the connected L-roof case
- straight-skeleton rectangle and concave L footprints
- generated near geometry plus the current coarse/shell LOD bundle when the LOD gate accepts it

## Captured report

For each generated fixture the report records:

- normalized persisted document
- composition plan and RPG semantic output
- component IDs, parent IDs, kinds, transform policies and assembly membership
- material-region IDs
- world bounds
- vertices and triangles
- draw-part/material/component statistics
- material-slot counts
- near/coarse/shell LOD configuration and triangle/envelope statistics

Numbers are rounded to the configured precision only when serializing the snapshot. Generation itself is not quantized.

## Visual references

The existing deterministic browser QA owns visual capture. Phase 0 uses these representative checkpoints:

- `1-03-radial-attached.png` — radial opening attachment on a gatehouse tower
- `1-07-material-area-override.png` — semantic material override on the manor
- `1-10-composition-l-roof.png` — connected composition with a straight-skeleton roof

They are generated under `tmp/workshop-qa`; the compatibility `--visual` mode fails if any representative capture is missing. This keeps binary screenshots out of source control while still making them a required local migration check.

## Known current limitations

These are observations of the current implementation, not requirements for the replacement architecture:

- LOD creation can be refused when the coarse envelope or saving gate fails; shell generation can deliberately fall back to the coarse tier.
- Opening assemblies currently accept only `window` and `door` kinds.
- Composition primitives are currently limited to rectangle, circle and wall.
- Composition planning currently emits empty `portals` and `stairSockets`; future phases may populate them without preserving emptiness as a feature.
- Component IDs are compatibility-sensitive because persisted transforms and opening data address components by ID.
- Visual captures are generated artifacts and therefore require the local Playwright/WebGPU QA environment.

Do not preserve a known limitation merely because it appears in this Phase 0 record. If a later phase intentionally changes a captured behavior, update the compatibility fixture/report expectation in the same reviewed change and document the migration.
