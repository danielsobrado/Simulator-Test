# Adding a biome

A biome is a tile id plus one row in each of a few tables. Nothing about a
biome lives in code: the layers read their column by tile id, the scatter
places what lists that id, and the streaming fetches what the ids near the
player need. `tests/biomeContract.test.js` fails, naming the missing piece,
when a biome's row is incomplete.

Azgaar's thirteen biomes are ids 0–12. A custom biome takes an id from 32–254
(`CLAUDE.md`); `import.azgaarRegionalBiomes` in `editor.config.yaml` carves one
out of an imported map, as Stonehold Badlands (32) shows.

## The approach: one hue family, three layers, one row

The look target is in [look-bible.md](look-bible.md). For a biome it comes down
to three things.

1. **One hue family.** Grass, ground plants and shrubs share the biome's grass
   pigment. Crowns sit a step darker and cooler in the same family. Soil and
   litter are the warm neutral under it. Value, height and leaf shape tell the
   layers apart; hue does not.
2. **Three plant layers.** A floor that closes over the ground (the meadow), an
   accent layer standing out of it (ground details, 0.2–1 m), and a shrub layer
   (bushes, 1–3 m). A wood adds trees and debris on top. A biome missing a
   layer reads as empty at eye level, however good the others are.
3. **One row per table.** Tune the biome in its rows, then look at its
   neighbours in the same capture run. Do not special-case a tile id in a
   shader or a view.

## Checklist

| # | What | Where | Notes |
| --- | --- | --- | --- |
| 1 | Name, soil, canopy, rock | `config/biome-looks.yaml` `byTileId` | Columns are described at the top of that file and in [biome-looks.md](biome-looks.md). `soil` is required for anything that grows grass: without it bare ground shows the map colour. |
| 2 | Grass pigment | `grass.meadow.palette.byTileId` | `base` (root) and `tip`. See the palette rules below. |
| 3 | Grass habit | `grass.meadow.growth.byTileId` and `shapes.byTileId` | Heights, blade width, density, patch size, silhouette. Density 0 means no grass. |
| 4 | Floor between stems | `grass.meadow.groundDetail.byTileId` | Litter colour and amount, moss, soil, and which two floor scans. |
| 5 | Layer membership | `tileIds` of `grass`, `groundDetails`, `bushes`, `rocks`, `trees`, and `flowers`, `forestDebris`, `tropicalKit` where they apply | A layer that does not list the id places nothing there. |
| 6 | Layer density | each layer's `densityByTile` | Absent means the full `perChunk` budget. This is what makes a desert sparse and a wood full. |
| 7 | Objects | `assets.groundDetailVariants`, `bushVariants`, `treeVariants`, `rockVariants` | Add the id to the `tileIds` of existing variants that belong, then add new ones. Minimums are in the next table. |
| 8 | Understory look | `understory` in the look row | A style on top of the biome's own ramp (dusty, frost-dulled, greyed): `tint`, `tone`, `saturation`. Not for matching the grass; shared shrubs already take the local ramp. |
| 9 | Weather and surface | `snow`, `water`, `ripples`, `prints`, `arid`, `dunes` in the look row | Optional; unlisted columns are neutral. |
| 10 | Sky | [sky-regions.md](sky-regions.md) | Only if the biome needs its own air. |

Then run `node --test tests/biomeContract.test.js` and `npm test`.

### Objects a biome needs

| Kind of biome | Floor accents | Shrubs | Trees | Rocks |
| --- | --- | --- | --- | --- |
| Bare (desert, badlands, ice) | 2 or more | 1, sparse | none | look row `rock`, `formations` |
| Open (grassland, savanna, tundra) | 6 or more, with 2 tall silhouettes | 2 or more | 2 or more, sparse | look row `rock` |
| Wood (forest, rainforest, taiga, wetland) | 8 or more across two heights | 3 or more | 3 or more, plus a dead or young one | look row `rock`, moss raised in wet woods |

The test enforces the floor of this table: a name, a rock look, a floor
accent, a shrub, a ground-detail row, and for a grass biome a soil, a canopy
and a palette, and two tree variants where trees grow. The counts above are
the art target, not a gate. A piece that truly does not apply goes in the
test's `WAIVED` table with its reason.

Asset rules are in [authored-natural-assets.md](authored-natural-assets.md):
painted props under 350 triangles, scans up to their configured target, a
scan's hue always from the ramp.

### Palette rules

- Pick the grass `base` and `tip` first. Everything else follows from them:
  `resolveFoliagePalette` builds the plant ramp from this pair, leaning a little
  to the canopy grade.
- `canopy` in the look row is the same hue as the grass tip or up to 20° cooler,
  and darker. A crown warmer or more saturated than the grass under it reads as
  a different game.
- `soil` is the grass base desaturated and warmed, at about half its value.
  Litter in the ground-detail row sits between soil and grass base.
- Vegetated ground at clear noon should measure saturation 0.30–0.55
  (`npm run qa:look`, look bible). Above that, lower the palette, not the grade.
- Rock `tint` is a near-neutral that leans to the soil. A cool grey stone on
  warm soil reads as pasted on.

## Transitions between biomes

A border must not be a line. These already blend, and a new biome gets them
for free as long as it is expressed through its rows:

| Layer | How it crosses a border |
| --- | --- |
| Terrain colour and meadow ground pigment | The biome tile is read through a noise nudge of up to `ecotoneReachCells` cells (`terrainMaterial.js`), so two grounds interlock in lobes. |
| Grass | Each blade takes the palette and habit of the tile under it, on the same nudged lattice, so the grass edge follows the ground edge. |
| Shrubs and ground plants | Per instance: the ramp of the tile the plant stands on, as a ratio against the ramp its material was built for (`biomes/understoryRampLooks.js`), times that tile's `understory` look. |
| Snow on ground and crowns | Blurred over one shared kernel (`biomeCanopySnowAt`), so a border tree carries what the ground under it does. |
| Ripples, prints | Regional, eased over about 1.5 s round the player ([biome-looks.md](biome-looks.md)). |
| Sky, fog, light | Regional and eased ([sky-regions.md](sky-regions.md)). |

What does not blend, and so limits what neighbours can look like:

- A shared shrub's ramp shift is one multiplier for the whole plant, taken from
  the middle of the two ramps. It moves the hue family; it does not reshape the
  ramp, so a shrub from a dark wood stays a little flatter on a pale steppe
  than a plant authored for it.
- Trees and props are placed by the tile they stand on, with no mixing band.
  Two woods of very different species meet at the lobed ground edge and no
  softer. Listing one or two species in both biomes softens it.
- Layer density steps at the border (`densityByTile`).

When adding a biome, capture one pose on each border it can have, not only its
interior.

## Streaming

The world is unbounded and runs in a browser tab, so a biome must cost nothing
until the player is near it.

- **Objects.** Every variant is a residency layer entry with `tileIds`.
  `StylizedVariantResidency` scans the tile ids in a window wider than any
  layer's residency, fetches at most two GLBs at once, and installs one per
  frame ([asset-startup-and-variant-residency.md](asset-startup-and-variant-residency.md)).
  A variant with no `tileIds` loads in every world: the contract test rejects
  that for shrubs, floor accents and the tropical kit.
- **Never at startup.** Only the trees and the shared scene may block the first
  frame (`CLAUDE.md`). Do not add a GLB to a `Promise.all` in `bootstrapLayers`.
- **Textures.** A biome's own textures ride in its GLBs, KTX2-compressed, and
  arrive with them. Ground scans are shared floor sets chosen by name in the
  ground-detail row, so a new biome normally adds none. Settlement surfaces
  load on approach through `SettlementSurfaceLibrary`
  ([settlement-rendering.md](settlement-rendering.md)).
- **Grass costs no assets.** It is procedural: a new biome's grass is a palette
  and a growth row.
- **Budgets.** A new layer or a raised `perChunk` needs the perf A/B of
  [perf-qa.md](perf-qa.md). 60 FPS is the hard limit.

## Limits to know before starting

- **Sixteen meadow palettes** (`MAX_MEADOW_PALETTES`): the base plus fifteen
  distinct `byTileId` pairs, eight in use. It is the radix of the blade's look
  code, so raising it again means checking the code still fits its float.
  Frosted biomes count as their frosted pair.
- **Sixteen growth profiles** (`MAX_MEADOW_GROWTH_PROFILES`), ten in use.
- **Three stand silhouettes, five plant silhouettes** (`meadowGrassShapes.js`).
  A biome's own grass is slender, reed or broadleaf. Its growth row may add up
  to two `accents`: other plants mixed in as clumps, each a silhouette (those
  three, or `lance` and `strap`), a share of the stems, and a height and width
  against the stand's. Give every grass biome at least one; a floor of one
  shape reads as a lawn.
- **Twelve uniform buffers in the blade's vertex stage** (WebGPU). It is at the
  limit: a new per-profile table goes into an existing array, as the accents
  did, or the pipeline fails to compile.
- **Per-layer `perChunk` caps** in `validateStylizedLodConfig.js`.
