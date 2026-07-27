# Collision coordinate-space contract

Status: **P0 contract**  
Date: **2026-07-27**

## 1. Names are part of the contract

Collision code must name coordinate spaces explicitly:

- `cellX`, `cellZ`: signed integer tile coordinates.
- `chunkX`, `chunkZ`: signed integer terrain/collision chunk coordinates.
- `canonicalX`, `canonicalZ`: persistent world metres, independent of floating origin.
- `renderX`, `renderZ`: camera-local metres after subtracting the floating origin.
- `localX`, `localY`, `localZ`: prototype-local coordinates.

Do not use an unqualified `worldX` for persisted collision records. Existing APIs may retain that name, but new collision code must choose `canonical` or `render` explicitly.

## 2. Axis convention

The canonical cell-to-world mapping is:

```text
canonicalX = (cellX + 0.5) * tileSize
canonicalZ = -(cellZ + 0.5) * tileSize
```

Increasing cell X moves toward positive canonical X. Increasing cell Z moves toward negative canonical Z.

## 3. Floating origin

Persistent and deterministic systems store canonical coordinates.

```text
render = canonical - floatingOrigin
canonical = render + floatingOrigin
```

A floating-origin snap must not rebuild or mutate canonical collider records. Only render-local debug geometry needs repositioning.

## 4. Ownership rules

- Terrain, tree, rock, placed-object, and construction collision providers emit canonical records.
- Collision chunk ownership is derived from canonical coordinates.
- Prototype BVHs remain prototype-local.
- The player controller converts its render-local capsule to canonical once before collision queries and converts the resolved pose back once afterward.
- Render LOD matrices are never the source of collision coordinates.

## 5. Placed objects

`ObjectMap` stores placed-object X/Z in cells. A placed object's blocker or collider position is the canonical centre of its rotated footprint, not the raw `object.x` and `object.z` values.

`ObjectPlacementResolver` is the shared authority for terrain surface evaluation and render-local object/foundation transforms.

Current `main` already converts spatially queried construction footprints into canonical blocker centres inside `TreeManifestStore`. P0 preserves that implementation and uses the same footprint-centre convention for future collision providers.

## 6. Conversion authority

Use `src/editor/world/CoordinateSpaces.js` for collision-facing conversions. It delegates to the established world-coordinate functions and gives each space an explicit name.

The test contract covers positive and negative cells, chunk boundaries, footprint centres, and floating-origin round trips.
