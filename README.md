# SimCity DnD

A D&D-inspired city builder built with Three.js, with biome-driven regions, settlement simulation, adventuring parties, monsters, factions, and a streamed campaign-scale world.

## World editor

The editor now runs on an effectively unbounded logical world rather than one fixed tile array.

- Global signed cell and chunk coordinates.
- `64 × 64` terrain pages with `65 × 65` canonical shared height samples.
- Deterministic procedural terrain outside modified or imported regions.
- Predictive camera and player-driven terrain prefetch.
- Separate load and unload radii to prevent border thrashing.
- A fixed reusable WebGPU terrain-slot pool.
- Bounded CPU chunk caching with deterministic eviction.
- Background chunk generation in a module worker.
- Floating-origin rebasing for long-distance precision.
- Sparse terrain, height, object, campaign, and voxel persistence.
- Portable compressed Azgaar world-guidance atlas persistence.
- Local-first chunk content with optional URL fallback.
- Dense binary encoding for fully modified or imported chunks.
- IndexedDB browser saves (localStorage is still read as a fallback for older browser saves).
- Native saves use infinite-world document version 6 only.
- Azgaar Fantasy Map Generator Full JSON import into the infinite streamed world.
- Camera-driven GPU marching-cubes voxel streaming with no geometry readbacks.
- Selectable Edit / Orbit and first-person Player modes.
- Terrain painting, raise, lower, and smooth brushes.
- Slope-aware building placement with foundations.
- Instanced settlement rendering from procedurally textured models.
- Rolling average FPS in the title area.

Run it with:

```bash
npm install
npm run verify
npm run dev
```

Three.js is pinned to r185.1. World generation, streaming, player movement, rendering, terrain limits, and editor settings are in `editor.config.yaml`. Object definitions are in `config/objects.yaml`.

## Infinite terrain streaming

The logical world is divided into fixed pages:

```text
unbounded world cells
  → 64 × 64 terrain chunks
  → 65 × 65 shared height samples
  → bounded CPU cache
  → fixed GPU terrain slots
```

Only pages around the active Edit or Player camera are resident. The streamer also predicts the camera position from its velocity and starts loading forward pages before the current chunk border is crossed.

The default terrain settings are:

```yaml
world:
  chunkSize: 64
  loadRadius: 2
  unloadRadius: 3
  prefetchSeconds: 1.5
  maxResidentChunks: 49
  maxCpuChunks: 81
  floatingOriginThreshold: 4096
```

Clean pages regenerate from the world seed and canonical global coordinates. Only changed cells, changed heights, placed objects, campaign metadata, and voxel stamps are saved.

Neighboring chunks cannot split at their boundaries because both sides request the same global height samples. Shared edge edits update all resident pages that reference those samples.

## Save format

Native document version 6 stores:

- Generator seed and version.
- Optional Azgaar macro base terrain, climate/hydrology guidance, physical scale,
  rectangular bounds, and rivers.
- Chunk and tile dimensions.
- Modified terrain chunks only; clean generated chunks are reproducible and omitted.
- Placed objects.
- Sparse voxel stamps.
- Imported campaign metadata.

Sparse chunks use index/value pairs. Dense imported or heavily modified chunks use base64 little-endian binary payloads with explicit empty sentinels.

Browser saves use IndexedDB. Native documents must be version 6 (infinite world). Older dense map formats (versions 1–5) are no longer loadable — re-export from a current session or import Azgaar Full JSON.

## Azgaar import

Use **Import** and select an Azgaar **Full JSON** export. The import dialog shows
the source scale, automatically preserves the source aspect ratio, and allows
the physical world width to be overridden.

The conversion runs in a worker and writes a **version 6 infinite-world
document** containing a compressed `azgaar-macro-v2` guidance atlas. The default
atlas long edge is
`import.azgaarAtlasLongEdge: 2000`; the shorter edge follows the Azgaar map
aspect ratio. Atlas pixels describe continent-scale geography rather than
literal playable cells. Imports are capped at four million atlas cells to keep
worker memory bounded when configuration or save data is malformed.

The chunk worker converts canonical world coordinates into atlas coordinates
and generates detailed `64 × 64` terrain pages only as the camera or player
approaches them. Generated clean pages are evicted and regenerated
deterministically. Only edits remain as sparse overrides, so memory and save
growth are not proportional to the physical world area.

Azgaar biome IDs are the canonical terrain IDs. All 13 standard biomes remain
distinct, including savanna versus grassland, every forest type, cold desert,
tundra, glacier, and wetland. Exported biome colors are retained. Maps with
additional biome definitions receive deterministic terrain IDs in the reserved
`32–254` range. Names, colors, habitability, movement cost, and relief-icon
metadata travel with the world document.

The macro source imports:

- Interpolated elevation with deterministic local relief.
- All 13 standard Azgaar biomes plus map-defined custom biomes.
- River centerlines used to generate local water channels.
- Temperature, precipitation, Azgaar's water-distance field, feature IDs, river
  IDs/flux/confluence, population, settlement score, and harbor/haven data.
- Deterministic coast and river distances plus normalized moisture, wetness,
  continentalness, mountain, ruggedness, valley, snow, forest, agriculture, and
  harbor-potential fields.
- Continuous biome-weight queries for physical terrain and rendering while the
  canonical Azgaar biome ID remains discrete for simulation.
- Source map information.
- States and provinces.
- Cultures and religions.
- Burgs.
- Rivers and routes.
- Markers, zones, and notes.

Political, settlement, route, marker, and note records are preserved as
campaign metadata. Full JSON imports also retain a compact copy of Azgaar's
cell and vertex geometry for the native vector world map. Heraldry and the
complete set of Azgaar editor-only visual layers are not rendered.

The imported rectangle is centered on the world origin. Terrain beyond its
bounds transitions into deep ocean over
`import.azgaarOceanTransitionKilometers`. Direct Azgaar `.map` files are not
supported; export Full JSON from Azgaar first.

### Distant-terrain backdrop

Streamed chunks only cover a small radius around the camera, so far geography
would otherwise read as empty sky. For imported Azgaar worlds, a coarse backdrop
mesh sampled from the in-memory macro atlas fills the horizon with continents and
mountains. It follows the floating origin, rebuilds only when the origin snaps,
and never touches the chunk streamer, so it does not change streaming behavior.
The sky sphere, fog, and camera far plane scale to `world.farTerrain.radiusMeters`.

```yaml
world:
  farTerrain:
    enabled: true
    radiusMeters: 60000   # how far the backdrop reaches
    resolution: 160       # backdrop grid vertices per side
    heightBias: 15        # sink below detailed terrain to avoid z-fighting
```

Set `enabled: false` to restore the near-only view (and the original fog). The
backdrop only appears once an Azgaar world is imported; procedural worlds keep
the near-only streamed terrain.

### Mountain relief

Azgaar worlds are often thousands of kilometers wide, which compresses real
mountain ranges into imperceptible bumps. Two import settings rescale imported
land elevation into dramatic, walkable mountains without shrinking the world or
altering coastlines:

- `import.azgaarVerticalExaggeration` multiplies land height (default `1`; at
  `48`, Eldara's peaks reach roughly 2 km).
- `import.azgaarReliefExponent` (default `1`) concentrates height into peaks
  when greater than `1`, so plains stay flat while summits tower.

Both default to `1` (no rescale) and are baked into the version 6 document at
import time, so streamed terrain reproduces the same relief deterministically.
High-frequency ruggedness scales with elevation, keeping peaks jagged and
lowlands smooth. Manual terrain sculpting still clamps to `terrain.maxHeight`,
so raising already-exaggerated mountains by hand is limited.

### Vector world map

Press **M** after importing an Azgaar Full JSON map to open the campaign-scale
world map. It uses the original Azgaar polygons rather than enlarging the macro
terrain atlas, so coastlines, regions, routes, settlements, and labels remain
sharp while zooming.

The map provides Political, Provinces, Cultures, Religions, Biomes, Heightmap,
and Physical views. Borders, routes, rivers, burgs, labels, and markers can be
toggled independently. Drag to pan, use the wheel or toolbar to zoom, hover for
cell details, and click a location to move the player there.

Worlds imported before vector cartography was added still use the legacy raster
preview. Re-import their original Full JSON once to add the detailed map data.

## World content providers

Terrain is deterministic and does not need to be downloaded or cached on disk.
Authored settlements, encounters, and other chunk content use a local-first
provider chain:

1. IndexedDB content for offline use.
2. An optional URL provider configured with `world.contentBaseUrl`.
3. Deterministic generation when no authored content exists.

Remote results are cached locally. Network failures fall back to local or empty
content without affecting terrain streaming.

## Camera modes

### Edit / Orbit

- Middle mouse or Space + drag pans.
- Right mouse drag rotates.
- Mouse wheel zooms.
- Terrain, object, selection, and voxel tools remain active.

### Player

- Click the viewport to capture the mouse.
- `W`, `A`, `S`, `D` move.
- `Shift` runs.
- `Space` jumps.
- Mouse movement looks around.
- `Esc` releases the mouse.
- Select **Edit / Orbit** to return to editing.

Player grounding uses the authoritative CPU heightfield and therefore remains readback-free. GPU-only caves, overhangs, and added voxel surfaces do not yet provide player collision.

## GPU marching cubes

The voxel terrain uses a fixed nine-slot WebGPU pool by default. Each resident chunk retains its density, smoothed-density, classification, vertex, normal, and indirect-draw buffers.

```text
sparse SDF stamps
  → GPU density generation
  → GPU smoothing
  → marching-cubes classification
  → GPU vertex and normal emission
  → indirect rendering
```

Generated density, triangle counts, positions, normals, and draw commands are never downloaded to JavaScript during normal operation.

## Object visuals

Placeable objects are generated in code. Models are assembled from primitives in
`src/editor/ObjectModelLibrary.js` and shaded with procedurally synthesized
colour, normal, and roughness maps, so there is no art build step and no GLB
pack to keep in sync.

```bash
npm run validate:assets
```

See `docs/object-pipeline.md` for the authoring contract.

## Current limits

- Object rendering is globally stored and is not yet independently simulation-LOD streamed.
- Voxel stamps are sparse and globally capped by configuration.
- The vector world map covers the core Azgaar views and overlays, but not editor-only layers such as heraldry, military, economy, trade animation, or the 3D/globe modes.
- Player collision does not query the GPU marching-cubes surface.
- Full visual runtime verification still requires a physical WebGPU browser.

These are explicit later phases, not hidden fallbacks or readback paths.
