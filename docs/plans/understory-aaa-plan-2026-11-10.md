# Understory plan — 2026-11-10

This is a work order for an implementing agent. Every phase names the files, the
change, the values, the test and the numbers that decide pass or fail. Do the
phases in order, one commit per phase, on `main`. Do not add anything this
document does not ask for.

Read `CLAUDE.md`, [perf-qa.md](../perf-qa.md),
[authored-natural-assets.md](../authored-natural-assets.md) and
[asset-startup-and-variant-residency.md](../asset-startup-and-variant-residency.md)
first. Their rules apply to every phase: no `viewport*Texture` nodes, no scene
lights, no new terrain samplers, no authored GLB in `bootstrapLayers`, every
new variant carries `tileIds`.

"Understory" here means everything between the grass blades and the tree
crowns: floor plants, herbs and ferns, shrubs and saplings, stumps, roots and
deadfall.

## 1. Why it does not read as AAA today

Found by reading the code and the asset builder on 2026-11-10.

1. **Every understory prop is a 350-triangle model with a 256 px texture
   painted in numpy.** `tools/blender/biome_understory/` builds about fifty of
   them with `MAX_TRIANGLES = 350` and procedural albedo from `textures.py`. A
   fern is a handful of large cards with a drawn-on frond. Up close the
   silhouette is the card, not the plant.
2. **The shader throws the surface detail away.** `applySkywardNormal`
   (`forest/foliageLight.js`) replaces the material's normal with a 72 % blend
   toward straight up, and the rigid plant motion writes `normalNode` again.
   Either one drops a normal map, so no leaf has veins, ribs or a lit edge.
3. **Plants ignore the canopy above them.** A fern under closed forest is lit
   exactly like one in a meadow. The habitat field knows the canopy cover; the
   understory never reads it for light.
4. **There is one height class.** A wood's floor has accents (one plant every
   8 m or so) but no layering: nothing knee-high in drifts, nothing
   head-high between the trunks.

What is already good and stays: stable placement, per-biome gating
(`tileIds`, `character`, `canopy`), per-instance biome tint and snow, plant
motion profiles, variant streaming, and the palette ramp that keeps every plant
in the scene's hue.

### 1.1 The two constraints that shape every decision

- **The frame is CPU-bound on draw count, not on triangles or pixels**
  ([performance-plan-2026-11-10.md](performance-plan-2026-11-10.md) §1): about
  20–25 µs per draw, 3.2 ms of GPU at 8.1 M triangles, roughly 13 ms of GPU
  spare at 60 FPS. So this plan spends triangles and texture detail and keeps
  the number of prototypes nearly flat. Each prototype is one draw.
- **The look is graded, not photographic.** `gradeUnderstory`
  (`forest/foliagePalette.js`) maps green pixels by luminance onto the biome's
  base-to-tip ramp. A scanned leaf therefore gives its **shape, cutout, normal
  and light-dark pattern**; its hue comes from the ramp. That is why scans from
  several regions can sit in one wood.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Where do the plants come from? | Poly Haven photoscanned models, all CC0. Fifteen named in §4.2. No Sketchfab, no generated models. |
| How are they made game-ready? | Headless Blender (`F:\Blender 5.2\blender.exe`), one new script beside the existing builder. Decimate with UVs preserved; keep the scan's own textures. No retopology by hand, no baking. |
| Texture size | Download 2k. Author at 1024. The runtime optimizer publishes scatter props at 512 (existing tier). |
| One atlas for all plants? | No. Each GLB keeps its own textures. A shared atlas would not remove a draw (one `InstancedMesh` per prototype) and the pipeline embeds textures per GLB. |
| LODs? | None. The ground-detail layer has one band and lives in the 3×3 chunk ring. Triangle targets in §4.2 are sized for that. |
| Draw count | Fifteen prototypes in, five out. At most +6 ground-detail draws at any forest pose. Gate in §8. |
| Blender MCP | Not used by the pipeline: the add-on was not reachable on 2026-11-10 and a work order must be reproducible. The script runs headless. |
| Colour | The ramp stays. Albedo luminance is normalised per asset so the ramp gets a full range. |
| New shader work | Three changes, all arithmetic: normal maps survive, canopy shade per instance, wet sheen. No pass, no light, no new texture binding beyond the plants' own normal map. |

## 3. Phase 0 — baseline

1. If `npm run qa:look` exists
   ([environment-coherence-plan-2026-11-10.md](environment-coherence-plan-2026-11-10.md)
   phase 0), run it and keep the folder as
   `docs/qa/understory/baseline/`. If it does not exist yet, capture these four
   shots by hand through `window.__worldVisualQa` at 1600×900, hour 12, weather
   off, player mode, height 1.7, pitch −0.08, fov 68, and save them there:

   | Name | World | x | z | yaw |
   | --- | --- | --- | --- | --- |
   | `core-deciduous` | procedural | 8901 | 15277 | 0 |
   | `core-rainforest` | procedural | 12991 | −1419 | −0.785 |
   | `core-temperate-rainforest` | procedural | 10119 | 5719 | 0.785 |
   | `core-taiga` | procedural | −6951 | 10379 | 0.785 |

   For each, also save a second shot with pitch −0.45 (looking at the floor).
2. Record the draw census at the forest pose:

   ```bash
   node scripts/probe-render-census.mjs chunk-cross "&x=2005&z=2941" tmp/understory/census-before.json
   ```

   Note the `StylizedGroundDetailView` and bush draw and triangle totals. The
   performance plan measured 72 ground-detail draws for 730 k triangles and 17
   bush draws for 741 k.

No commit.

## 4. Phase 1 — fetch the scans

### 4.1 Files

| File | Action |
| --- | --- |
| `scripts/understory-sources.config.mjs` | New. The table in §4.2 as data. |
| `scripts/fetch-understory-sources.mjs` | New. Downloads and verifies. |
| `assets/source-cache/` | New folder, added to `.gitignore`. Downloads live here. |
| `assets/source-library/polyhaven.lock.json` | New, committed. One entry per file: asset id, relative path, URL, md5, size, authors. |
| `assets/README.md` | New section "Poly Haven understory scans": the fifteen ids, their authors from the lock file, "CC0 1.0", and the two commands of this plan. |
| `package.json` | Add `"fetch:understory-sources": "node scripts/fetch-understory-sources.mjs"`. |

### 4.2 The fifteen assets

All ids were read from `https://api.polyhaven.com/assets?t=models` on
2026-11-10. "Source tris" is the API's `polycount`.

| Poly Haven id | Source tris | Game name | Layer | Class | Target tris | Target height (m) |
| --- | --- | --- | --- | --- | --- | --- |
| `fern_02` | 6 232 | `forest-fern-02` | ground | herb | 1 200 | 0.75 |
| `shrub_sorrel_01` | 3 319 | `forest-sorrel-01` | ground | floor | 500 | 0.16 |
| `periwinkle_plant` | 67 388 | `forest-periwinkle-01` | ground | floor | 800 | 0.22 |
| `nettle_plant` | 46 195 | `forest-nettle-01` | ground | herb | 900 | 0.85 |
| `weed_plant_02` | 17 062 | `meadow-weed-02` | ground | herb | 700 | 0.55 |
| `calathea_orbifolia_01` | 16 688 | `tropical-calathea-01` | ground | herb | 1 200 | 0.7 |
| `anthurium_botany_01` | 4 134 | `tropical-anthurium-01` | ground | herb | 900 | 0.8 |
| `moss_01` | 246 170 | `forest-moss-01` | ground | floor | 400 | 0.12 |
| `tree_stump_01` | 41 046 | `forest-stump-01` | ground | wood | 800 | 0.7 |
| `dry_branches_medium_01` | 16 803 | `forest-deadfall-02` | ground | wood | 700 | 0.35 |
| `root_cluster_01` | 225 261 | `forest-roots-01` | ground | wood | 800 | 0.45 |
| `shrub_03` | 16 955 | `bush-forest-scan-01` | bush | shrub | 1 800 | 1.5 |
| `shrub_02` | 52 317 | `bush-meadow-scan-01` | bush | shrub | 2 000 | 1.2 |
| `wild_rooibos_bush` | 76 521 | `bush-arid-rooibos-01` | bush | shrub | 1 600 | 1.1 |
| `pine_sapling_small` | 398 144 | `bush-taiga-sapling-01` | bush | shrub | 2 200 | 1.9 |

`understory-sources.config.mjs` exports this as an array of
`{ id, name, layer, kind, targetTriangles, targetHeight, cutout }`. `kind` is
the class column. `cutout` is `false` for `moss_01`, `tree_stump_01`,
`dry_branches_medium_01` and `root_cluster_01`, and `true` for the rest.

### 4.3 The fetch script

For each id:

1. `GET https://api.polyhaven.com/files/<id>` and
   `GET https://api.polyhaven.com/info/<id>`, both with the header
   `User-Agent: world-builder-asset-fetch/1.0`. No other header, no query
   string beyond the id.
2. From the files response take `gltf['2k'].gltf`: download its `url` and every
   entry of its `include` map to
   `assets/source-cache/polyhaven/<id>/<include key>` (the `.gltf` itself at
   `<id>/<id>_2k.gltf`). Verify each file's md5 against the response; on a
   mismatch delete the file and fail.
3. If the files response has an `Alpha` key, download `Alpha['2k'].png` (or
   `.jpg` if there is no png) to `<id>/textures/<id>_alpha_2k.<ext>`.
4. Skip any file already present with the right md5, so the script is
   idempotent.
5. Write `assets/source-library/polyhaven.lock.json`, sorted by id then path,
   with authors from the info response's `authors` keys.

`--check` verifies the cache against the lock file and downloads nothing.

**Gate.** `npm run fetch:understory-sources` exits 0; a second run downloads
nothing; `-- --check` exits 0; the lock file lists fifteen ids. If an id returns
404, stop and report it. Do not substitute another asset.

**Commit.** `Understory sources: fifteen Poly Haven scans fetched by a locked, checksummed script`

## 5. Phase 2 — build the game meshes in Blender

### 5.1 Files

| File | Action |
| --- | --- |
| `tools/blender/understory_scans/build_understory_scans.py` | New. |
| `tools/blender/understory_scans/scan_common.py` | New. Helpers below. Keep each file under 350 lines. |
| `assets/runtime-sources/ground/scans/<name>.glb` | Output, eleven files. |
| `assets/runtime-sources/bushes/<name>.glb` | Output, four files. |
| `package.json` | Add `"build:understory-scans"` running the command below. |

```bash
"F:\Blender 5.2\blender.exe" -b --factory-startup --python tools/blender/understory_scans/build_understory_scans.py -- --config tmp/understory/sources.json
```

The npm script first writes `tmp/understory/sources.json` from
`understory-sources.config.mjs` (`node -e` import and `JSON.stringify`), then
calls Blender, so the table has one home.

### 5.2 Per asset, in this order

1. **Import** `assets/source-cache/polyhaven/<id>/<id>_2k.gltf`
   (`bpy.ops.import_scene.gltf`). Join every mesh object into one. Apply all
   transforms.
2. **Normalise.** Translate so the bounding box's lowest point is at z = 0 and
   its x/y centre at the origin. Scale uniformly so the height equals
   `targetHeight`. Apply. Poly Haven units vary per scan, so never trust the
   imported size.
3. **Reduce.** Add a `DECIMATE` modifier, `decimate_type = 'COLLAPSE'`,
   `delimit = {'UV'}`, `use_collapse_triangulate = True`,
   `ratio = targetTriangles / current triangles`, and apply it. If the result
   is more than 5 % over target, apply once more with the corrected ratio. Then
   `bpy.ops.mesh.delete_loose()` and remove zero-area faces
   (`bmesh.ops.dissolve_degenerate`, `dist = 1e-6`): the runtime optimizer
   asserts triangle parity and gltfpack drops degenerate triangles
   (`scripts/prepare-tropical-assets.mjs` documents the failure).
4. **Check the silhouette** (cutout assets only). Before step 3 and after it,
   render two orthographic 512×512 alpha masks with Workbench (front, and top
   down), framing the same bounds. `coverage = opaque pixels after ÷ before`,
   the lower of the two views. If `coverage < 0.9`, restore the pre-decimation
   mesh, raise the triangle target by 25 % and repeat. Two retries at most.
   Record the final triangle count and coverage. If it still fails after two
   retries, keep the last result and list the asset under "below coverage" in
   the build report; do not hand-edit the mesh.
5. **Normals.** `use_auto_smooth` is gone in Blender 5: shade smooth, then for
   cutout assets add a `WeightedNormal` modifier (`keep_sharp = False`) and
   apply it. Cards keep their own facing; the runtime bends them (phase 4).
6. **Textures**, with numpy on the loaded image buffers:
   - Albedo: `diff`, resized to 1024×1024 (`image.scale`). Multiply RGB by the
     `arm` texture's red channel raised to 0.6 (ambient occlusion, softened).
   - Cutout assets: put the alpha in the albedo's A channel. Take it from the
     `Alpha` download when one exists, else from the diffuse texture's own
     alpha. Then sharpen it round the cutoff so the 512 px published mip
     keeps thin leaflets: alpha becomes `clamp((a − 0.5) × 4 + 0.5, 0, 1)`.
     (`scripts/lib/foliage-ktx2-mips.mjs` does a similar job for impostor
     mips; it is not called here.)
   - Luminance: over pixels with alpha > 0.5 (all pixels for opaque assets),
     compute the mean sRGB luma. Apply one gamma to RGB so that mean becomes
     **0.42** for cutout assets and **0.32** for wood and moss. This is what
     gives `understoryRamp` its range (`smoothstep(0.025, 0.8, luma × 1.15)`).
     Do not use the `save_image` lift from `understory_common.py` as well.
   - Normal: `nor_gl`, resized to 1024×1024, saved Non-Color.
   - Roughness: one scalar per asset, the mean of the `arm` green channel over
     the same pixels, clamped to 0.55–0.95.
7. **Material.** One Principled material named `Scan <name>`: Base Color from
   the albedo, Alpha from its A channel for cutout assets
   (`blend_method = 'CLIP'`, alpha threshold 0.5), Normal through a Normal Map
   node at strength 1, Roughness the scalar, Metallic 0. One material and one
   primitive per GLB: one draw.
8. **Name and export.** Root empty named `<name>`, mesh child `<name>-mesh`, as
   `place_and_export` in `understory_common.py` does; import that function
   rather than copying it (add the folder to `sys.path`). Export GLB with
   `export_apply=True, export_yup=True, export_tangents=True` and textures
   embedded as PNG.
9. **Preview.** Unless `--no-render`, render a 640×640 Eevee preview of each
   asset on a neutral ground with one sun, and a contact sheet
   `tmp/understory/scans/contact-sheet.png`, five columns. Reuse
   `render_preview` and `save_contact_sheet` from
   `build_biome_understory.py` by moving those two functions into
   `understory_common.py` and importing them in both scripts.

The script prints one line per asset (`name`, source triangles, final
triangles, coverage, mean luma, roughness) and writes the same as
`tmp/understory/scans/report.json`.

### 5.3 Gate

- Fifteen GLBs exist. Each has exactly one mesh primitive and one material.
- Final triangles are within +5 % of target, or within the two-retry ceiling
  (target × 1.5625).
- At most two assets are listed "below coverage". If more, stop and report the
  contact sheet: the decimation approach is wrong for these scans and needs a
  human decision.
- Open the contact sheet and send it to the user with the commit. The fern,
  the two tropical plants and the sapling must read as their plant at preview
  size. This is the one judgement call in the phase, and it is the user's.

Commit the fifteen GLBs under `assets/runtime-sources/` with the scripts.

**Commit.** `Understory scans: fifteen game meshes built headless from the Poly Haven sources`

## 6. Phase 3 — publish and place

### 6.1 Config: `editor.config.yaml`

Add under `stylizedSurface.assets.groundDetailVariants`, after the forest kit
block. `scale: 1` everywhere because the builder already sized each mesh.

```yaml
      # Poly Haven scans (docs/plans/understory-aaa-plan-2026-11-10.md): real leaf
      # shape, cutout and normal; hue still comes from the understory ramp.
      - { scene: /assets/ground/scans/forest-fern-02.glb, motion: fern-frond, scale: 1, weight: 1.6, tileIds: [5, 6, 7, 8, 9], character: forest, characterStrength: 1.8, canopy: core, prototypeGroups: [[forest-fern-02]] }
      - { scene: /assets/ground/scans/forest-sorrel-01.glb, motion: broadleaf, scale: 1, weight: 1.4, tileIds: [6, 8], character: forest, characterStrength: 1.6, canopy: core, prototypeGroups: [[forest-sorrel-01]] }
      - { scene: /assets/ground/scans/forest-periwinkle-01.glb, motion: broadleaf, scale: 1, weight: 1.0, tileIds: [6, 8], character: forest, characterStrength: 1.6, canopy: core, prototypeGroups: [[forest-periwinkle-01]] }
      - { scene: /assets/ground/scans/forest-nettle-01.glb, motion: flexible-stem, scale: 1, weight: 1.0, tileIds: [4, 6, 8], character: scrub, characterStrength: 1.6, canopy: edge, prototypeGroups: [[forest-nettle-01]] }
      - { scene: /assets/ground/scans/meadow-weed-02.glb, motion: flexible-stem, scale: 1, weight: 0.8, tileIds: [4, 6, 14], character: meadow, characterStrength: 1.6, canopy: open, prototypeGroups: [[meadow-weed-02]] }
      - { scene: /assets/ground/scans/tropical-calathea-01.glb, motion: broadleaf, scale: 1, weight: 1.4, tileIds: [5, 7], character: forest, characterStrength: 1.8, canopy: core, prototypeGroups: [[tropical-calathea-01]] }
      - { scene: /assets/ground/scans/tropical-anthurium-01.glb, motion: broadleaf, scale: 1, weight: 1.1, tileIds: [7], character: forest, characterStrength: 1.8, canopy: core, prototypeGroups: [[tropical-anthurium-01]] }
      - { scene: /assets/ground/scans/forest-moss-01.glb, motion: rigid, conform: true, sway: false, scale: 1, heightOffset: -0.02, weight: 1.2, tileIds: [6, 8, 9, 12], character: forest, characterStrength: 1.8, canopy: core, prototypeGroups: [[forest-moss-01]] }
      - { scene: /assets/ground/scans/forest-stump-01.glb, motion: rigid, conform: true, sway: false, scale: 1, heightOffset: -0.05, weight: 0.35, tileIds: [6, 8, 9], character: forest, characterStrength: 1.6, canopy: any, prototypeGroups: [[forest-stump-01]] }
      - { scene: /assets/ground/scans/forest-deadfall-02.glb, motion: rigid, conform: true, sway: false, scale: 1, heightOffset: -0.03, weight: 0.6, tileIds: [5, 6, 8, 9], character: forest, characterStrength: 1.6, canopy: core, prototypeGroups: [[forest-deadfall-02]] }
      - { scene: /assets/ground/scans/forest-roots-01.glb, motion: rigid, conform: true, sway: false, scale: 1, heightOffset: -0.06, weight: 0.4, tileIds: [6, 7, 8, 12], character: forest, characterStrength: 1.6, canopy: core, prototypeGroups: [[forest-roots-01]] }
```

Write them in the file's existing block style (one key per line), not as flow
maps; the flow form above is only compact.

Add under `bushVariants`, copying the key set of the existing
`bush-swamp-buttonbush-01` entry:

| scene | motion | scale | weight | tileIds | character | canopy |
| --- | --- | --- | --- | --- | --- | --- |
| `/assets/bushes/bush-forest-scan-01.glb` | woody-shrub | 1 | 1.2 | `[5, 6, 8]` | forest | core |
| `/assets/bushes/bush-meadow-scan-01.glb` | woody-shrub | 1 | 1.0 | `[3, 4, 6]` | scrub | edge |
| `/assets/bushes/bush-arid-rooibos-01.glb` | woody-shrub | 1 | 1.0 | `[1, 2, 3, 32]` | scrub | open |
| `/assets/bushes/bush-taiga-sapling-01.glb` | woody-shrub | 1 | 1.0 | `[9, 10]` | forest | edge |

**Remove** these five `groundDetailVariants` entries, which the scans replace.
Leave their GLBs in `assets/runtime-sources/`; delete only the config entries
and their published copies under `public/assets/`.

| Entry | Replaced by |
| --- | --- |
| `ground/forest/forest-bracken-01.glb` | `forest-fern-02` |
| the second `ground/swamp/swamp-fern-01.glb` entry (the one with `tileIds: [6, 5, 7, 8, 9]`; keep the `[12]` entry) | `forest-fern-02` |
| `ground/grass-chunks/chunk-01.glb` | `forest-sorrel-01`, `forest-nettle-01` |
| `ground/boreal/taiga-deadfall-01.glb` | `forest-deadfall-02` |
| `ground/stylized-grass/source-01.glb` | `forest-moss-01`, `forest-periwinkle-01` |

If a saved scene-settings preset pins one of the five, `BiomeAssetPalette`
already drops an ineligible pin; do not add migration code.

### 6.2 Publish and validate

```bash
npm run optimize:runtime-assets
```

```bash
npm run validate:assets
```

```bash
npm run qa:assets:startup -- --runs 2 --headed
```

If `optimize:runtime-assets` reports a rendered triangle count change for a
scan, the fault is a degenerate or duplicate triangle left by phase 2 step 3:
fix the builder, rebuild that asset, do not relax the optimizer.

**Gate.**

- `validate:assets` passes. The published scans are each ≤ 400 KiB; the
  published runtime set grows by at most 5 MiB in total.
- `qa:assets:startup`: GLBs loaded at boot and KTX2 transcodes at boot are
  unchanged from the run before this phase. The scans stream through
  `StylizedVariantResidency`; none loads at boot.
- `npm test` passes (update any test that counts ground-detail or bush
  variants).

**Commit.** `Understory scans placed: eleven floor plants and four shrubs, five painted props retired`

## 7. Phase 4 — shader: make the detail visible

Three changes. Each is arithmetic on values the material already has.

### 7.1 Normal maps survive the skyward bend and the wind

**Why.** `applySkywardNormal` reads `material.normalNode ?? normalViewGeometry`
and writes `normalNode`. A node material with `normalNode` set does not sample
its `normalMap`. The rigid branch of `applyPlantMotion` sets `normalNode`
first, with the same effect.

**Files.** `src/editor/stylized/forest/foliageLight.js`,
`src/editor/stylized/PlantMotionNodes.js`.

**Change.** In `foliageLight.js` add and export one helper and use it in
`applySkywardNormal`:

```js
/** A geometric view normal with the material's own normal map laid back over it. */
export function withAuthoredNormalMap(material, geometricNormal) {
  if (!material.normalMap) return geometricNormal;
  // Perturb the bent normal by the map's tangent-space offset from flat.
  const mapped = normalMap(texture(material.normalMap), vec2(UNDERSTORY_NORMAL_STRENGTH));
  return geometricNormal.add(mapped.sub(normalView)).normalize();
}
```

with `const UNDERSTORY_NORMAL_STRENGTH = 0.8;`, and in `applySkywardNormal`
the last assignment becomes
`material.normalNode = withAuthoredNormalMap(material, mix(authored, up, SKYWARD_NORMAL).normalize());`.
`normalMap`, `normalView`, `texture` and `vec2` come from `three/tsl`. If the
installed three version exposes the normal-map node under another name, use
the call the settlement wall material uses for its single normal-map sample
(see "Highfield foreground review" in
[lighting-atmosphere.md](../lighting-atmosphere.md)) and keep the helper's
behaviour.

`applyPlantMotion` needs no edit: `cloneDetailMaterial` calls it before
`applySkywardNormal`, which then wraps the rotated normal as `authored`.
Confirm that order in `StylizedBushView`'s material setup too; if a bush
material applies motion after the skyward bend, swap the two calls.

**Test.** Add to the existing shader build test (the one that checks generated
WGSL for a single normal texture read on a wall): a foliage material with a
`normalMap`, passed through `applyPlantMotion` (profile `fern-frond`) and
`applySkywardNormal`, compiles to WGSL containing exactly one sample of that
normal texture; the same material without a `normalMap` compiles to the same
WGSL as before this change.

### 7.2 Plants under canopy sit in its shade

**Why.** Sun shadows from the trees reach about 120 m and are soft; beyond
that, and between the shadow texels, understory is lit as open ground.

**File.** `src/editor/stylized/StylizedGroundDetailView.js`,
`placementAppearance`. The view already holds `forestFieldProvider`.

**Change.**

```js
/** Share of its light a plant under full canopy loses, on top of the sun's shadow. */
const CANOPY_SHADE = 0.28;
```

and in `placementAppearance`:

```js
    const coverage = this.forestFieldProvider?.()?.sample(placement.x, placement.z)?.patchCoverage ?? 0;
    ...
      colorVariation: (1 - range * 0.5 + placement.priority * range) * (1 - CANOPY_SHADE * coverage),
```

`colorVariation` already multiplies the plant's colour per instance
(`lod/StylizedDitheredMaterial.js`), so this costs no attribute and no shader
change. Do the same in the bush view's equivalent appearance function with the
same constant, imported from one place (`forest/ForestFloor.js`).

**Test.** A unit test on `placementAppearance` with a stub field: coverage 0
returns the old value; coverage 1 returns the old value × 0.72.

### 7.3 Wet leaves shine in rain

**File.** `src/editor/stylized/AuthoredFoliageMaterial.js`,
`applyUnderstoryPalette`.

**Change.** After the emissive assignment, for materials that have a roughness
(`'roughness' in material`):

```js
  // Rain film on leaves that face the sky: the sun glints, as on the terrain.
  const wet = surfaceWetnessUniform.mul(smoothstep(0.1, 0.7, normalWorld.y));
  material.roughnessNode = mix(float(Math.max(0.72, material.roughness ?? 1)), float(0.34), wet);
```

Import `surfaceWetnessUniform` from `../weather/surfaceWetness.js`, as
`TreeFoliageSurface.js` does. `cloneDetailMaterial` sets
`material.roughness = max(0.72, …)` after this call; that scalar is ignored
once `roughnessNode` exists, which is intended.

### 7.4 Gate

- `npm test` passes.
- Floor shots (pitch −0.45) of `core-deciduous` and `core-rainforest`: leaf
  ribs are visible as light and shade on the fern and the calathea. Send the
  before and after pair to the user.
- `npm run qa:weather:browser` passes.
- Performance A/B per
  [performance-plan-2026-11-10.md](performance-plan-2026-11-10.md) §2, forest
  pose, baseline = the commit before this phase:
  `summary.phases.render.avgMs` within +0.10 ms and `gpuRender.total.avgMs`
  within +0.25 ms of the baseline mean. If the GPU gate fails, lower the scans'
  published normal maps to 256 px with the extraction `textureSize` option and
  re-run once; if it still fails, revert §7.1 only.

**Commit.** `Understory shading: normal maps survive the skyward bend, canopy shade per plant, wet leaves`

## 8. Phase 5 — layering and density

**Why.** The scans are placed at accent density. A wood needs a floor layer in
drifts, a herb layer in clumps and a shrub layer between trunks.

**File.** `editor.config.yaml` only. The selectors already weight by canopy and
regional character; this phase sets how much of each class there is.

| Key | From | To | Reason |
| --- | --- | --- | --- |
| `stylizedSurface.groundDetails.perChunk` | 240 | 320 | One plant about every 7 m before the biome and canopy gates. |
| `groundDetails.densityByTile` for 6 and 8 | unset (1) | 1.25 | Closed temperate woods carry the most floor. |
| `groundDetails.densityByTile` for 9 | 0.45 | 0.6 | Taiga floor: moss, deadfall, sapling fringe. |
| `stylizedSurface.bushes.understoryDensity` | 0.9 | 1.0 | Shrub layer throughout a closed wood. |

Leave `residentRadius`, `tropicalKit.perChunk`, every `weight` from phase 3 and
all tree settings alone. The per-prototype instance capacity is
`perChunk × 9` (`scatterMath.instanceCapacity`), so 320 raises each
ground-detail prototype's reserved slots from 2 160 to 2 880; that is memory,
not draws.

**Gate.**

- Census at the forest pose (command in §3): ground-detail draws ≤ baseline
  + 6; bush draws ≤ baseline + 3; ground-detail plus bush triangles ≤ baseline
  + 1.6 M.
- Performance A/B, forest pose and `settlement-approach`, baseline = the commit
  before phase 3 (the whole plan's cost):
  `summary.phases.render.avgMs` within +0.30 ms, `gpuRender.total.avgMs`
  within +0.60 ms, hitch count not higher than the baseline arm's worst run in
  runs with valid native focus.
- If the triangle or GPU gate fails: set `perChunk` back to 240, re-run. If it
  still fails: lower the four bush targets in §4.2 by 30 %, rebuild those four
  assets, republish, re-run once. Record what shipped.
- Eye-level and floor shots of the four core poses: at least three understory
  plants of two different height classes are in frame in each closed-forest
  shot. Send the eight before and after pairs to the user.

**Commit.** `Understory layering: denser floor and herb layers in closed woods, a full shrub layer`

## 9. Phase 6 — record

1. Update [authored-natural-assets.md](../authored-natural-assets.md): the
   "Runtime coverage" table (ground detail and bush counts), a paragraph on the
   scan pipeline (fetch, build, publish) and the 350-triangle rule's new
   wording: painted props stay under 350; scans follow the targets in this
   plan.
2. Update `assets/README.md` "Reconstructing the library" with the two
   commands.
3. Append the census and A/B tables to `docs/perf-qa.md` in the style of its
   existing sections.

**Commit.** `Understory scans recorded: pipeline, budgets and measured cost`

## 10. Not in this plan

- **Forest-floor ground textures** (Poly Haven `forest_leaves_03`,
  `dry_decay_leaves`, `forest_ground_04` are CC0 and suitable). The terrain's
  ground-layer array and its bake are a separate system with a fixed sampler
  budget; adding a layer needs an audit of that array first.
- **Leaf litter and moss geometry** from `forestDebris`. It is built in code
  and already fills closed-canopy floor; revisit after phase 5 captures.
- **Vines, hanging moss, buttress roots.** They attach to trees and need the
  tree prototypes and impostors to change.
- **LOD meshes or impostors for understory.** One band is enough inside the
  3×3 chunk ring; add them only if phase 5's triangle gate cannot be met.
- **A shared understory atlas or merged prototypes.** It would be the way to
  cut the layer's draw count; it is the asset task the performance plan already
  lists as out of scope.
- **Plants that bend around the player.** The meadow has this through its spell
  and footprint maps; rigid instanced props would need a per-instance push
  attribute updated at runtime.
- **Generated 3D models and Sketchfab downloads.** Licence and quality vary;
  every source here is CC0 with a checksum.
- **Per-leaf flutter.** It needs a per-vertex weight the scans do not carry.

## 11. Expected result

| Before | After |
| --- | --- |
| Ferns and herbs are a few painted cards | Scanned silhouettes at 500–1 200 triangles with real cutouts |
| Flat-lit leaves | Normal-mapped ribs and veins, a wet sheen in rain |
| Same light in a glade and under canopy | Up to 28 % darker under closed canopy, per plant |
| One height class of accents | Floor, herb and shrub layers, with stumps, roots and deadfall |
| 72 ground-detail draws at the forest pose | At most 78, with the cost measured and recorded |

What decides whether it reads as AAA is phase 2's contact sheet and phase 5's
eight capture pairs. Both go to the user.
