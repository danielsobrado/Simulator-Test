# Authored asset source library

This directory holds original downloadable source assets and offline extraction
outputs. The game must not stream whole showroom scenes from here. Runtime-ready
files live under `public/assets/`.

## Reconstructing the library

1. Open each source link below and download the GLB/glTF version allowed by its
   licence.
2. Rename the downloaded GLB exactly as shown and place it at the listed
   repository-relative path.
3. Install dependencies with `npm install`.
4. Extract the natural-asset packs and prepare the flight-only crow and seagull
   source GLBs without publishing an incomplete runtime set:

   ```bash
   node scripts/extract-authored-assets.mjs
   node scripts/prepare-wildlife-assets.mjs
   ```

5. Publish every configured runtime GLB through the Meshopt/KTX2 optimizer:

   ```bash
   npm run optimize:runtime-assets
   ```

6. Validate the complete source and runtime library:

   ```bash
   npm run validate:assets:production
   ```

`assets/extracted/manifest.json` and
`assets/extracted/wildlife-manifest.json` contain hashes, output paths and
provenance. `THIRD_PARTY_NOTICES.md` is the authoritative redistribution and
attribution record.

## Using assets in world-look settings

Open **Settings → Add GLB asset** to add a CORS-enabled GLB URL or a local
`.glb` file. Choose its target layer and the biome currently selected in
**Biome scenery assets**. The editor stores local files as blobs in IndexedDB;
the resulting `local-asset:` reference is browser-local, while URL references
remain portable. Loading the new asset performs one scene reload so Meshopt and
KTX2 support is configured against the actual renderer before the GLB parses.

After reload, the asset appears in that layer's biome dropdown. Saving a named
world-look preset captures the custom asset definitions, map source, god rays,
regional placement parameters and all explicit biome choices. A JSON preset can
also declare tree `trunkMaterial`, `leafMaterial`, `species`, `barkProfile`,
`prototypeGroups` and scale; when material names are omitted, the tree loader
tries common bark/trunk and leaf/foliage names.

Checked-in presets belong in `settings/` and are listed by
`settings/manifest.json`. Checked-in maps belong in `maps/` and are listed by
`maps/manifest.json`. Vite serves these authoring folders directly in
development and copies them to the same paths in production builds.

## Animals

| Download | Place downloaded GLB at | Licence | Runtime result |
|---|---|---|---|
| [Animated Crow – 3D Animal Model](https://sketchfab.com/3d-models/animated-crow-3d-animal-model-6e634f78d54341a89bbbb6ee1d24876a) | `assets/animals/animated_crow__3d_animal_model.glb` | CC BY 4.0 | `public/assets/animals/crow-flight.glb` |
| [Seagull – Stylized Animated 3D Model](https://sketchfab.com/3d-models/seagull-stylized-animated-3d-model-b331b360c0064536a6e517c1a93a349d) | `assets/animals/seagull__stylized_animated_3d_model.glb` | CC BY 4.0 | `public/assets/animals/seagull-flight.glb` |

Only the selected flying animation is published. The close, skinned tier is
opt-in through `stylizedSurface.wildlife.authored.enabled` in
`editor.config.yaml`; default distant flocks use generated impostor silhouettes
and do not load either GLB.

## Trees and mixed forest packs

| Download | Place downloaded GLB at | Licence | Extraction |
|---|---|---|---|
| [Low Poly Tree Scene Free](https://sketchfab.com/3d-models/low-poly-tree-scene-free-89daa5e21f0d4f08a59dba0d566e88bd) | `assets/trees/low_poly_tree_scene_free.glb` | CC BY 4.0 | 23 trees and two grass shapes; two trees and both grass shapes publish under `public/assets/{trees,ground}/tree-scene/` |
| [Low Poly Forest Tree Pack](https://sketchfab.com/3d-models/low-poly-forest-tree-pack-5ff5a51e74324845a4e4905f182dfb2b) | `assets/trees/low_poly_forest_tree_pack.glb` | CC BY 4.0 | Four trees and nine rocks; curated files publish under `public/assets/{trees,rocks}/forest-pack/` |
| [Stylized Tree](https://sketchfab.com/3d-models/stylized-tree-6d1aeea748f147789004bc03e1930d32) | `assets/trees/stylized_tree.glb` | CC BY 4.0 | `public/assets/trees/stylized-oak.glb`, decimated to 5% |

The 40.8 MiB tree scene is an offline source only. Never copy it wholesale to
`public/`. Its 23 tree exports are only three distinct geometries — `tree-02`
repeated 14 times and `tree-03` repeated 8, differing by node transform, which
the scatter already randomises — so publishing more of them buys nothing. All
four forest-pack trees are distinct and all four are published.

## Rocks

| Download | Place downloaded GLB at | Licence |
|---|---|---|
| [Rock](https://sketchfab.com/3d-models/rock-e06fc204468d418e906e78b98ae59692) | `assets/rocks/rock.glb` | CC BY-NC 4.0 |
| [Obj_Nat_Rock_01](https://sketchfab.com/3d-models/obj-nat-rock-01-62d63fd7d1dd416aac1496eb19c43cc0) | `assets/rocks/obj_nat_rock_01.glb` | CC BY 4.0 |
| [A Simple Rock](https://sketchfab.com/3d-models/a-simple-rock-bcfc084c997f4c019d404bb92dcc4d2c) | `assets/rocks/a_simple_rock.glb` | CC BY 4.0 |
| [3D Scan Rock](https://sketchfab.com/3d-models/3d-scan-rock-48a05d2336014bd0bd91eb71e68fcb60) | `assets/rocks/3d_scan_rock.glb` | CC BY 4.0 |
| [Ruined rock fence](https://sketchfab.com/3d-models/ruined-rock-fence-75e2716c378e4a68bac3577303671921) | `assets/rocks/ruined_rock_fence.glb` | CC BY 4.0 |

The ruined fence is split into nine individual stones. Standalone authored
runtime sources are preserved under `assets/runtime-sources/rocks/`.

## Bushes

| Download | Place downloaded GLB at | Licence |
|---|---|---|
| [Stylized Bush](https://sketchfab.com/3d-models/stylized-bush-9d9ce79d3ae040619e96d5b22c7de1a6) | `assets/bushes/stylized_bush.glb` | CC BY 4.0 |
| [Small bush](https://sketchfab.com/3d-models/small-bush-f6ed4c70fc024ac88e8e6a19991695af) | `assets/bushes/small_bush.glb` | CC BY 4.0 |
| [Bush by 7thFlare](https://sketchfab.com/3d-models/bush-6f1920d84d5445f9857da7ba8238fd38) | `assets/bushes/bush2.glb` | CC BY 4.0 |
| [Bush by lev26](https://sketchfab.com/3d-models/bush-844e6a315757431da97efb5f17383bb5) | `assets/bushes/bush.glb` | CC BY 4.0 |
| [Bamboo Bush](https://sketchfab.com/3d-models/bamboo-bush-d0d5eb345ff7420bb7f5c5239fcec637) | `assets/bushes/bamboo_bush.glb` | CC BY 4.0 |

Runtime preservation copies live under `assets/runtime-sources/bushes/`.

## Ground cover used by extraction

| Download | Place downloaded GLB at | Licence | Extraction |
|---|---|---|---|
| [Stylized grass](https://sketchfab.com/3d-models/stylized-grass-3a5a5c5be677403d9f56e451cd3dd4af) | `assets/grass/stylized_grass.glb` | CC BY 4.0 | Three runtime clumps plus their two sparse source shapes |
| [Weeds and grass](https://sketchfab.com/3d-models/weeds-and-grass-7e2b98aab6064d63bb2fc3fda8450c27) | `assets/grass/weeds_and_grass.glb` | CC BY 4.0 | Five blades, two blossoms, two weeds and two aquatic grasses |
| [LOTUS](https://sketchfab.com/3d-models/lotus-5627ae9572ce419fac75b68a2ac54594) | `assets/grass/lotus.glb` | CC BY 4.0 | 13 individual lotus assets; two runtime selections |
| [Clover Grass](https://sketchfab.com/3d-models/clover-grass-beeff00b4496409da82b7c1a9705039e) | `assets/grass/clover_grass.glb` | CC BY 4.0 | Offline individual clover; 10 912 triangles, too heavy to stream |
| [Simple grass chunks](https://sketchfab.com/3d-models/simple-grass-chunks-eb4f6dc9d4e3455ea3435385faf58b60) | `assets/grass/simple_grass_chunks.glb` | CC BY 4.0 | Eight chunks; the three under 40 triangles publish, the 2 681-52 188 triangle patches stay offline |

The published ground cover is chosen by triangle budget, not by preference: every
ambient detail prototype stays under 350 triangles, which
`tests/authoredAssetExtraction.test.js` enforces. `grass-blade-01`/`03` and
`grass-blade-04`/`05` are the same two shapes in `Green_Grass` and `Brown_Grass`,
which is how a wetland reads lush and a savanna dry without new geometry.

## Additional evaluated grass sources

These are retained for comparison and deliberate placed scenery. They are not
part of ambient runtime coverage.

| Download | Place downloaded GLB at | Licence |
|---|---|---|
| [Grass by lev26](https://sketchfab.com/3d-models/grass-5bd2b5c524c841feadee1f60858caa0a) | `assets/grass/grass.glb` | CC BY 4.0 |
| [Grass by Asia Matusik](https://sketchfab.com/3d-models/grass-6367d6fa23ca4db3baffd69eecbbfda5) | `assets/grass/grass2.glb` | CC BY 4.0 |
| [grass 04](https://sketchfab.com/3d-models/grass-04-2a7f850a53b146cd9790a004bdcd1abf) | `assets/grass/grass_04.glb` | CC BY 4.0 |
| [Grass cluster](https://sketchfab.com/3d-models/grass-claster-downoad-like-please-832eb6c9c5b24790b1ca24ad7dfdcdba) | `assets/grass/grass_claster__downoad__like_please.glb` | CC BY 4.0 |
| [Realistics grass 06](https://sketchfab.com/3d-models/realistics-grass-06-b5956b7d4d1f4ff6ae1dd1320dab0d12) | `assets/grass/realistics_grass_06.glb` | CC BY 4.0 |
| [Game ready grass](https://sketchfab.com/3d-models/game-ready-grass-1825750648ff48dc8b583b4a49b61699) | `assets/grass/game_ready_grass.glb` | Sketchfab Standard |
| [Grass by Kon](https://sketchfab.com/3d-models/grass-4f8d59e086f0499796fa12f14d4df5c4) | `assets/grass/grass3.glb` | Sketchfab Standard |
| [Realistic grass](https://sketchfab.com/3d-models/realistic-grass-ba0971efc9ac4176b8f7d2379cd7250b) | `assets/grass/realistic_grass.glb` | Sketchfab Standard |

Sketchfab Standard assets may be downloaded and used only under that licence.
They are intentionally excluded from extraction, publication and redistribution
by this project.

## Upstream code and texture repositories

- [cortiz2894/stylized-components](https://github.com/cortiz2894/stylized-components)
  supplies the MIT reference scene, shader behavior and flower/bark texture
  lineage. The preserved reference scene is
  `assets/runtime-sources/grass-scene.glb`.
- [ProblematicToucan/stylized-vegetation](https://github.com/ProblematicToucan/stylized-vegetation)
  supplies MIT foliage cards used under `public/assets/textures/leaf/`.
- [niceandgoodonline/simple-cheap-stylized-tree-shader-issue-demo](https://github.com/niceandgoodonline/simple-cheap-stylized-tree-shader-issue-demo)
  supplies the CC0 512a/512b foliage textures.

Always retain author, title, source URL and licence metadata when deriving a new
runtime asset.
