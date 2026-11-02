# Tree trunks, crowns and root flares — improvement plan

Captured 2026-11-02 at `e353fc73`/`6bcd8b80` (after "root trees in the ground and
dissolve crowns into the sky"), dev server, `?qaVisual=1`, highfield light at 11:00.
Screenshots: [`docs/qa/trees-2026-11-02/`](../qa/trees-2026-11-02/).

| Shot | What it shows |
|------|---------------|
| `01-taiga-stand.jpg` | Eldara taiga: grass-scene spruces, sticks under tiered crowns |
| `02-spruce-trunk.jpg`, `03-spruce-collar.jpg` | Spruce foot from 6 m and 3 m |
| `04-savanna-stand.jpg` | Default world spawn: meadow `tree7/8/9` |
| `05-meadow-trunk.jpg`, `06-meadow-roots.jpg` | Meadow tree foot, buttress roots |

## What the screenshots show

1. **The taiga has no roots at all, and stands on an upside-down plinth.** Primary
   conifers (`grass-scene.glb`, which make up almost all of the taiga) go through
   `attachRootCollar`, not `attachTreeRoots` (`StylizedTreeView.js:511`). The collar is
   `CylinderGeometry(radius * 1.45, radius, …)`: top radius larger than the bottom, so
   it is an inverted cone. It reads as a pale hexagonal plate at the foot (`03`).
2. **Conifer trunks are poles.** Six sides, no taper, almost black. From a few metres
   away they read as fence posts under the crown (`02`, `03`).
3. **Buttress roots read as spider legs.** Where they exist (authored variants), they
   are 5-sided tubes 0.3–0.5 × the stem radius that taper to 8 %, and rise only
   1.1–2.3 × the stem radius. The bole never swells into them, so there is a visible
   seam. Their UVs take a 30 % × 40 % slice of the bark atlas, so the bark streaks
   smear (`06`). At grass height they disappear completely (`05`).
4. **Every bole is straight.** `BOLE_SWEEP` 5 % and `BOLE_WANDER` 1.8 % of height
   (`treeSway.js`) are too small to see; trunks read as uniform columns.
5. **Crowns repeat.** Near spawn, 93 of 96 trees are three meshes (`tree7/8/9`). Each
   one has the same rounded blob at the same crown-base height, so the stand looks
   like an orchard (`04`). Per-instance variation is only `crownAspectScale` plus a
   4.5 % tilt.

## Plan

Ordered by what changes the picture most for the least risk. Every phase changes tree
geometry, which rejects the baked atlases (`docs/stylized-environment.md`). Re-bake
with `npm run bake:impostors` in the same commit, and check `assetIntegrity.atlasCount`.

### Phase 1 — Root flares (biggest visible win) — done

Landed with three fixes found on the way: the stem is measured on cross-sections
(decimated barks have too few vertices for a vertex band), collision and the root
seat use the measured bole instead of the merged bark, and the bark's soil band is
narrowed to the contact so fins do not vanish into the floor.


1. **Retire the collar.** Send primary conifers through `attachTreeRoots`, with conifer
   parameters (below), and delete `createRootCollarGeometry`/`attachRootCollar`
   once nothing calls them. This fixes the inverted plinth.
2. **Swell the bole into the roots.** In `treeRoots.js`, using the axis `measureStem`
   already finds, push trunk vertices outward in the bottom ~1.5 stem radii:
   `r' = r · (1 + k·(1−h)³ · (0.6 + 0.4·cos(n·(θ−θ₀))))`. Align the lobes to the
   root headings, so each root grows out of a flute and there is no seam. This is a
   one-time edit per prototype at load, with no per-frame cost.
3. **Reshape the roots as buttresses, not tubes.**
   - Use 7 rings × 6 sides.
   - Give them a plank cross-section, about 1.8× taller than wide, starting at about
     0.55 stem radius and tapering to 15 %.
   - Rise 1.6–3 stem radii, and sink the last ring below the floor.
   - Keep each tree at ≤ 7 roots × ~72 triangles.
4. **Per-species root profile.** Pass a profile into `createTreeRootGeometry`:

   | Profile | Roots | Rise | Reach | Notes |
   |---------|-------|------|-------|-------|
   | conifer | 4–5 | low (1.2 r) | short | shallow spread, strong swell |
   | broadleaf | 5–7 | 1.6–2.4 r | 3–5 r | current shape, fuller |
   | tropical / wetland | 4–6 | 3–4 r | 4–6 r | tall plank buttresses |

5. **Fix the root UVs.** Map V from the root's height and length using the trunk's own
   bark density (metres per V), instead of a fixed 40 % slice. Then bark runs along
   the root at the trunk's scale.

### Phase 2 — Trunk shapes

1. **Rebuild the spruce stem.** At load, replace the six-sided pole in the
   grass-scene conifer prototypes with a 10-sided tapered stem. Keep the same base
   point and height, taper from 1.0 to about 0.2 into the crown, and add the Phase 1
   swell. Wrap the bark UVs at the trunk's density. Lift the near-black bark through
   `trees.barkGrade` for that prototype only.
2. **Visible bole form, per species.** In `treeSwayField`, make sweep and wander
   per-species uniforms instead of constants:
   - broadleaf: 8–10 % sweep, plus an S-curve (counter-sweep above mid-height),
     keyed by the instance phase;
   - conifer: stays near-straight, 2 %.

   Keep the total offset inside what the impostors tolerate (see Phase 4).
3. **Authored meadow trunks** keep their geometry. They only get the Phase 1 swell
   and roots.

### Phase 3 — Crown shapes

1. **Break the blob, per instance, in the shader.** Extend the crown `form` term in
   `treeSwayField` with:
   - **Lobing:** a low-frequency (3–4 lobe) radial push/pull of leaves around the
     crown axis, with phase per tree, so silhouettes become irregular.
   - **Crown-base lift:** lift or drop the lowest leaves by height fraction, driven by
     the existing `habitatFlags`. Core-of-stand trees get a long clear bole; edge
     trees keep low crowns.
   - **Lean toward light:** shift the upper crown a few percent toward the stand
     edge or clearing.
2. **Conifer tiers.** Rotate each height band of the spruce crown by a per-tree
   phase, so whorls do not stack identically tree to tree.
3. **More source silhouettes.** Check whether `meadow/tree1–6` can join the green
   meadow pool, retinted by the canopy grade, before authoring anything new. Each
   extra prototype costs another pair of full-capacity InstancedMeshes, so prefer
   shader variation and add at most one or two meshes.

### Phase 4 — Verification

- Run the tree fixture before and after (`node scripts/run-world-visual-trees-qa.mjs`).
  The impostor coverage ratio and luminance checks must still pass. Shader-only crown
  and bole deformation is not carried by impostors, so cap the amplitudes so that
  near and far still match at the LOD hand-off.
- Re-shoot the six poses in this document for an A/B, using the `qaVisual` cut,
  setting the `highfield` light at 11:00, and taking the same camera offsets.
- Run a perf A/B per [the perf QA guide](../perf-qa.md), with `--density dense-forest`
  at equal `--warmup`, against unmodified `main`. Report the added triangles per
  prototype.

## Suggested order

Phase 1 (1 → 2 → 3, then 4, then 5) is one commit with one re-bake. Phase 2.1 needs
the Phase 1 swell. Phase 2.2 and Phase 3 are shader-only and can follow together with
the second re-bake.
