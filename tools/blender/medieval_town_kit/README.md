# Medieval town kit (Blender generator)

Procedurally builds a modular, game-ready medieval town kit in Blender 5.2 and
assembles a sample terraced town from it.

```
"F:\Blender 5.2\blender.exe" -b --factory-startup --python tools/blender/medieval_town_kit/build_kit.py -- [--no-render] [--no-export] [--shots overview,street,plaza,lane,interior,interior_upper,interior_smithy,interior_apothecary,interior_chapel,catalog,prefabs]
```

About 20 s end to end. Outputs:

| Path | What |
|---|---|
| `assets-src/medieval-town-kit/medieval_town_kit.blend` | Kit catalog (`Kit/*`) + assembled town (`Town/*`) |
| `assets-src/medieval-town-kit/textures/` | 18 shared tileable albedo+normal PNGs |
| `assets-src/medieval-town-kit/previews/` | Outdoor (`overview`, `street`, `plaza`, `lane`), indoor (`interior`, `interior_upper`, `interior_smithy`, `interior_apothecary`, `interior_chapel`), `catalog`, and `prefabs` renders |
| `public/assets/environment/medieval-kit/medieval_kit.glb` | Every module once (183 modules), at its origin, named by module |
| `public/assets/environment/medieval-kit/medieval_town.glb` | The town; ~2.5k nodes instancing shared kit meshes |
| `public/assets/environment/medieval-kit/medieval_town_layout.json` | Group/placement tree to rebuild the town from the kit |

## Lego contract

- 2 m grid, 3 m stories, 1.5 m terrace steps (`medkit/config.py`).
- Walls span local X 0..2 m, centred on y=0, exterior −Y. Corner posts cover joints.
- Floor slabs cover one cell with their top at the story base.
- Stairs climb +Y over two cells (interior: `Stairs_Interior_L/R` paired with `Floor_Stairwell_L/R` at `j=0` and walkable `Floor_Landing_L/R` at `j=1`; stone: one/two terraces).
- Placed pieces are linked duplicates parented to empties:
  `BLD_<name>` → `<name>_Story<k>` / `<name>_Roof`. Move a building, lift a story
  or swap a roof by moving its empty. `Door_Leaf` pivots on its hinge (`interactable: door`).

## Textures and UVs

All 18 materials sample 13 textures. UVs are planar in module space, scaled by
each material's tile size, so neighbouring modules tile seamlessly. Cloth
colours are tints (`baseColorFactor`) over one cloth texture.

## Layout

- `medkit/texture_patterns.py` — numpy texture generators
- `medkit/mesh.py` — geometry builder (box/beam/extrude/lathe/blob)
- `medkit/modules/*` — module families: walls, floors, roofs, terrain, props, street_props, nature, interior, interior_trade, accents
- `medkit/buildings.py`, `furnish.py` — enterable buildings with role-specific DnD interiors (`inn`, `shop`, `apothecary`, `smithy`, `bakery`, `church`, `keep`, `library`, `store`, `house`)
- `medkit/village_plan.py` — the sample town as data (height map, stairs, buildings, props)
- `medkit/terrain_builder.py`, `village.py` — assembly
- `medkit/render.py`, `export.py` — previews and glTF and layout export

## Regional families, prefabs and generated maps

- **Families** (`medkit/prefab_families.py`):
  - Tudor: half-timber with slate gables.
  - Nordic: clapboard, 60° gables, crossed finials and pent roofs.
  - Med: render over stone, terracotta hip roofs, loggias and a courtyard villa.
  - Goblin (Grukmar marsh): stilts, shanty walls, shaggy reed roofs.
  - Orc (Grukmar uplands): low, broad, one-story halls with a dark fieldstone
    socle, heavy split-log boarding, low 35° reed thatch and a deep front
    porch. Big halls and the `_Tall` siblings get a boarded loft. Also
    `Orc_CityWall` (palisade) and `Orc_Gatehouse` (gate tower on a stone pad).
  - Frostgard: horizontal hewn logs with crossed corner ends on rugged granite
    plinths. Homes take sod roofs held by eave logs; halls take steep, plain
    slate. Louvred smoke vents ride the ridge instead of chimneys, and there are
    no roof horns.
  - Stonehold: granite with basalt bands and pilasters, shouldered squared
    openings, few grilled windows, flat parapeted roofs with three-flue stacks,
    and vaulted portals on shopfronts. `Stonehold_Gatehouse` is two towers
    around a vaulted gate with a portcullis.

  The regional modules are in `modules/walls_frontier.py`,
  `roofs_regional.py`, `palisade.py` and `walls_stonehold.py`. The new textures
  (`granite`, `sod`) are in `texture_patterns_regional.py`. Other regional
  materials are tints of the shared textures (`materials.py`). The briefs they
  follow are `docs/asset-bible/regions/<realm>.md` and
  `05-differentiation-matrix.md`. `review_shots.py` has a shot per family plus
  `families_tavern` and `families_house`, which put one base across families
  side by side.
- **Whole regional towns** (`regional_towns.py`): run
  `-- OUT_DIR Orc|Frostgard|Stonehold [SEED]` to generate a town and render an
  isometric overview, an elevated hero view and an eye-level view through the
  main entrance. The renders include a ground and a light aerial haze.
  `medkit/town_styles.py` sets each family's town grammar:
  - Ground: earth or flagged lanes, upland or frost grass.
  - Regional terrace walls, railings and stairs (`modules/terrain_regional.py`).
  - Street fire posts and braziers.
  - Pines, boulders and crags.
  - The square: a clan hearth with war banners, an oath-stone circle, or an
    ore crane.
  - The crown building.
  - The town rim (palisade or windbreak), the orc gate tower, and the
    Stonehold rock backdrop.

  Dressing modules are in `modules/props_regional.py`. Run the families one
  after another, because each run rewrites the shared textures.
- **Land and towers:** frontier towns get meandering hill terraces
  (`TownStyle.terrain = 'hill'`). The town renders stand them on rolling land
  that climbs into a ridge, with faceted crags and trees; Stonehold sits under a
  rock mountain and Frostgard above a frozen lake. Stilted watchtowers
  (`modules/towers_regional.py`) stand on the town corners. They are also
  exported as `Orc_RoundTower` and `Frostgard_RoundTower`, so the game's
  defence towers turn regional.
- **Frostgard winter:** snow on roofs, pyramids, pines and ground, trodden snow
  lanes, a low pink winter sun with warm windows. These follow the Frostgard
  winter references.
- **Reference check:** `compare_refs.py -- SHEET REF IMG...` prints value,
  saturation, hue and contrast statistics against a reference and writes a
  contact sheet. The references are in `assets-src/medieval-town-kit/references`.
- **Prefabs** (`medkit/prefabs.py`, `prefab_export.py`): 245 buildings sized to
  the game planner's plots (including `Apothecary`, `Guildhall`, `Guardhouse`, and `Library`). They are exported as `medieval_kit_prefabs.json`,
  which holds parts, collision boxes, doors and lights. The game instances them
  per Azgaar burg (see `docs/towns.md`).
- **Generated towns** (`medkit/village_generator.py`): `-- --seed 11 --family Nordic`
  builds a new terraced town map. It writes `medieval_town_nordic_11.glb` and
  `previews/overview_nordic_11.png`.
- **Prefab close-ups:** `-- --no-export --no-render --prefabs Nordic_Tavern,Med_Villa`.

## Levels of detail

### Stonehold art review

Open `/stonehold-qa.html` on the running app for the actual WebGPU town material,
near/far models, daylight/dusk and an orbitable close view. Run its hardware check:

```
node scripts/run-stonehold-qa.mjs --headed
```

The twelve Stonehold recipes live in `stonehold_citadels.py`,
`stonehold_sanctums.py` and `stonehold_mountains.py`; `stonehold_formations.py`
owns their registry, shared scale and derived assembly. Shared rock, architecture,
water, fire and dressing builders keep generated detail inside each module mesh.
The eight inhabited formations use 5 metres per authoring unit, including their
UV density and semantic collision. They are reserved as outskirts landmarks,
not placed as small yard props. Mountain shell pieces already use metres.

`medkit/stonehold_surfaces.py` writes the shared weathered bronze, dressed basalt,
flow, foam, flame and roughness maps. The runtime stores roughness in the existing
normal array's alpha channel. Spray dithering is restricted to spray fragments;
the water does not sample scene depth or require a refraction copy.

For deterministic geometry checks and matching photographs (Blender executable
as in the build command above):

```
blender -b --factory-startup --python-exit-code 1 --python tools/blender/medieval_town_kit/stonehold_review.py -- --repeat
blender -b --factory-startup --python-exit-code 1 --python tools/blender/medieval_town_kit/stonehold_review.py -- --lod1 --no-render
```

The review checks finite, nondegenerate geometry and the 48k near / 12k far
triangle limits. `--repeat` compares geometry, UVs and baked vertex shading.
`--baseline <original-kit.glb>` adds matching before photographs of the Twin
Outcrop and Horned Sanctum. Previews and metrics go to
`assets-src/medieval-town-kit/previews/stonehold-aaa`; scratch GLBs and Blender
files go to `tmp/stonehold-aaa`. Rebuild both public kits with the normal build
commands after changing recipes. GLBs remain generated files under the existing
repository ignore policy.

`-- --lod1` builds the kit again with `config.LOD = 1` and writes only
`medieval_kit_lod1.glb`, without images. The far kit has the same module names,
but no chamfers, brackets, voussoirs, lantern finials or flower detail, and its
lathes use half the segments. New detail goes behind `config.detailed()` so the
far kit stays light. The game swaps a whole town to the far kit past 100 m (see
`docs/towns.md`).

## Jetties and cross-gables

Tudor specs set `jetty` and `cross_gable` (`prefab_families.py`). Story k of a
jettied building uses `Wall_Timber_J<level>*` on its front and
`Corner_Timber_J<level>_L/_R` on its front corners, where the level comes from
`building_spec.jetty_level`. The roof group moves forward by the top story's
jetty and uses the widened `Roof_Gable_S<span>J<level>` set.

## Dressed stone

Quoins, plinth copings, entry steps, sills, voussoirs and thresholds use
`stone_dressed` (`texture_patterns_weathered.dressed`): one tooled block per
piece, with no joints in the texture, chamfered and toned per piece. It is the
pale frame that makes the rubble between read as built, as on a Skyrim hold's
houses. Keep quoin arms clear of the corner cell's shutters (0.5 m / 0.28 m).
Roof slabs take one tone and square inner ends, so sections join without a
groove or a shade step, and a fascia along each eave gives the roof its
thickness.

## Shared look with SettlementView

The kit and the game's default town renderer share one material language
(docs/settlement-rendering.md, "Kit parity"): the slate tint (`roof`), aged
cloth dyes, pale crown glass that the game lights with firelight at dusk, and
paving bedded 3 cm proud with cobble sides (`PAVING_PROUD`, `PAVING_LAP`).
Interior furniture (`modules/interior.py`) is built the way SettlementView's
rooms are (`SettlementFurniture.js`): a planked trestle table, benches on
splayed legs, a stool by the hearth and a posted bed; the far kit keeps the
plain versions.
Change one side's tone and change the other's with it.

## Tuning live with Blender MCP

The MCP for Blender add-on (v1.8) listens on `localhost:9876` while Blender's
UI is open. Any client that speaks its JSON protocol can rebuild the kit from
source in the running Blender and render a QA street. For example, send
`{"type": "execute_code", "params": {"code": ...}}` with code that purges
`medkit.*` from `sys.modules` and re-imports it.
`live_closeups.py` does exactly that for named prefabs and renders them at
street eye level and three-quarter, lit like the game; its docstring shows the
call.

## Scans, accents and previews

- `medkit/scans.py` replaces procedural textures with CC0 Poly Haven scans. The
  scans live in `assets-src/medieval-town-kit/scans/<asset>/albedo.jpg` and
  `normal.jpg` (OpenGL convention). The tile size is the photograph's
  real-world size.
- `modules/accents.py` provides turrets, chimney breasts and stacks, oriels,
  balconies, trade signs, weathervanes, gable spikes, the fountain and hanging
  vines. `building_accents.AccentPlacer` places them from its own random
  stream, so tuning accents never reshuffles windows and doors.
- `BuildingSpec.gable_front` turns the roof group a quarter so the ridge runs
  front to back. `Roof_Gable_Fill_J*` closes the gap that a jettied front
  leaves.
- `medkit/game_look.py` lights previews with the game's sun and hemisphere
  values: the 'storybook' or 'configured' sky. It writes linear EXR and tone
  maps with three's ACESFilmic fit at exposure 1.12. Blender's sun follows the
  same 1/pi convention as three's directional light, so intensities carry over
  unchanged.
