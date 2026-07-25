# Procedural object pipeline

Placeable settlement objects are generated in code. There is no GLB pack, no
external texture, and no art build step: models and their materials are
synthesized at startup from the object catalog.

## Layers

1. `config/objects.yaml` — the catalog. Each entry carries placement data
   (footprint, foundation, allowed terrain) and names a procedural `model`.
2. `src/editor/ObjectModelLibrary.js` — one factory per `model`. Factories
   assemble primitives into render parts and pick a surface for each part.
3. `src/editor/assets/proceduralSurfaces.js` — shared three.js materials and
   the UV projection used to keep texel density consistent.
4. `src/editor/assets/proceduralTexturePixels.js` — dependency-free synthesis
   of the colour, normal, and roughness pixels for every surface kind.

## Surfaces

A surface kind bundles a generator with its shading metadata: base colour,
metalness, normal strength, relief, texel `density`, and an optional emissive
for lit windows and embers. Roughness is baked absolutely into its map, so
materials keep `roughness: 1` and let the texture drive the response.

Generators are deterministic and exactly periodic over one UV tile, which is
what makes the baked textures seam free under repeat wrapping. That property is
asserted directly in `tests/proceduralTexturePixels.test.js` — treat it as the
contract when adding a kind: every frequency must be a whole number of cycles
per tile, and every `floor`/`fract` must operate on an integer multiple of `u`
or `v`.

Textures are synthesized once per kind and shared by every part that asks for
it, so the whole catalog costs one small texture set per surface rather than one
per model. Shared materials and textures are flagged `userData.sharedSurface`
so per-model teardown never disposes them.

## Models

Factories receive the tile size and express every dimension as a multiple of it,
so models keep their proportions if the map scale changes. Helpers cover the
common shapes: `box`, `cylinder`, `cone`, `blob`, `stone`, plus `gableRoof` for
two-slab roofs and `uprights` for repeated posts.

Authoring rules:

- Pivot on the footprint centre in X/Z with the lowest geometry at Y = 0.
  Ground-hugging props may nestle slightly below zero.
- Stay inside the reserved footprint. `tests/objectModelLibrary.test.js`
  measures true vertex bounds and fails the build otherwise.
- Keep part counts moderate. Each part becomes one instanced mesh per
  definition, allocated lazily on first placement.

## Validation

```bash
npm run validate:assets   # catalog schema, model names, category coverage
npm test                  # surface, model, and footprint contracts
npm run verify            # the full gate
```

`validate:assets` runs the catalog through the real schema, so bad footprints,
foundations, or terrain keys fail there rather than at runtime. It also rejects
a model that no catalog entry can place.
