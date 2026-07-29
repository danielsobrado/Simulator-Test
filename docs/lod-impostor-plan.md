# Vegetation LOD, impostors and ground-cover pipeline

## Implementation status

The renderer phases are implemented. Production release additionally requires a
strictly validated offline tree-impostor manifest and atlas PNGs generated from
the current source GLB.

| Phase | Status | Delivered |
|---|---|---|
| 0 — correctness and measurement | Complete | Stable focus contract, projected-size policy, counters, memory gauges and regression tests |
| 1 — stable chunk manifests | Complete | Chunk-owned deterministic manifests, order-independent collision acceptance and local invalidation |
| 2 — ground-cover optimization | Complete | Grass clumps, influence textures, sliced builds, density falloff, resource release and combined flower batches |
| 3 — mesh LOD | Complete | Near meshes, simplified proxies, screen-space selection, hysteresis and dithered transitions |
| 4 — impostors and canopy clusters | Code complete; generated assets required | Multi-view albedo/normal atlases, runtime fallback baker, strict offline export, source compatibility checks and canopy clusters |
| 5 — GPU-driven culling | Complete | WebGPU compute frustum compaction and indirect impostor draws with a CPU fallback |

## Representation ladder

Tree representation is selected from projected height and capped by chunk radius:

1. Full source mesh in the near band.
2. Reduced geometric proxy in the middle band.
3. Multi-view normal-mapped impostor in the far band.
4. One aggregated canopy proxy per chunk in the extreme band.
5. Cull beyond the configured cluster radius.

Rocks use full meshes near the camera and reduced geometric proxies farther out.
Grass and flowers use deterministic density falloff rather than object impostors.
The terrain material carries procedural far-ground detail after geometry ends.

Both orthographic editor zoom and perspective player distance use the same
projected-pixel policy. Previous and next representations overlap during a stable
screen-door transition, so transparency sorting is not required.

## Stable placement

Procedural trees and rocks use chunk-owned manifests. Every candidate has a
stable identity and priority. A candidate survives only when no intersecting
candidate has a lower priority. The result is independent of focus-window
traversal order, worker completion order, LOD radius and approach direction.

A one-chunk halo resolves cross-boundary collisions, while only the target
chunk's owned records are emitted. Near meshes, impostors and clusters therefore
share the same authoritative source positions.

Terrain invalidation is chunk-local. Tile changes dirty the owning chunk, shared
height vertices dirty every affected neighbor, and reset/load operations advance
a global epoch. Unrelated distant edits do not rebuild the active vegetation
window.

## Tree impostor assets

The canonical production path is offline generation:

```bash
npm run bake:impostors
npm run validate:assets:production
```

The baker starts the application in a headless Chromium-family browser using the
WebGL backend for deterministic render-target readback. It renders each tree
prototype into an 8 × 2 atlas, performs alpha-aware color dilation around the
silhouette, exports albedo/coverage and view-space normal textures, and writes:

```text
public/assets/impostors/trees/manifest.json
public/assets/impostors/trees/prototype-<index>-albedo.png
public/assets/impostors/trees/prototype-<index>-normal.png
```

Manifest version 3 contains a deterministic source signature derived from the
current prototype geometry and tree/impostor configuration. Runtime loading
rejects stale versions, mismatched source signatures, missing prototypes,
non-contiguous prototype indices and invalid dimensions or paths. A rejected
manifest is disposed and runtime baking or the low-poly proxy fallback takes over.

Generated files are optional only for development. `npm run validate:assets`
permits the runtime fallback. `npm run verify` and release CI use the strict
production validator and fail when the generated assets are missing or stale.

The production workflow is `.github/workflows/tree-impostor-assets.yml`. It bakes,
runs the strict validator, tests and builds, uploads the generated files as an
Actions artifact, and commits only successfully verified atlas files. The baker
itself never changes Git state.

Atlas lookup happens in the impostor shader. Camera direction is transformed by
the stable per-tree yaw, and the surrounding azimuth/elevation frames are blended
without rebuilding instance records when the camera rotates. High camera angles
blend toward spherical billboarding so the editor camera does not see edge-on
cards.

## GPU culling

On the WebGPU backend, each impostor prototype owns source transform and parameter
buffers, a compacted visible-index buffer, six frustum planes and an indirect draw
buffer. A reset compute pass clears the indirect instance count and a culling pass
populates visible indices without CPU readback.

Because the final indirect instance count remains GPU-resident, the QA counters
do not claim a known GPU submitted count. They report requested, accepted and
capacity-dropped records for both modes; CPU culling additionally reports the
actual visible/submitted count.

WebGL or unsupported WebGPU paths use CPU frustum culling with the same records
and material.

## Grass and flowers

Grass stores clump transforms instead of one transform per blade. Rock and
placed-boulder interaction is rasterized into a small per-chunk RGBA influence
texture containing bend direction and flattening strength. The grass shader
samples that texture instead of duplicating trample values for every instance.

Grass builds are resumable and process a configured number of cells per slice.
The previous same-chunk geometry remains visible while a replacement completes;
stale geometry is hidden when a terrain slot changes ownership. Heavy resources
are released after a configurable number of inactive frames.

Flower variants are combined into side-by-side texture atlases and emitted by one
slot per terrain chunk.

## Verification

Run the production gate:

```bash
npm run verify
```

For development without committed impostor assets, use:

```bash
npm run validate:assets
npm test
npm run build
```

Then capture the movement battery:

```bash
npm run qa:perf -- --qa move --warmup 2 --duration 12 --speed run
npm run qa:perf -- --qa strafe --warmup 2 --duration 12 --speed run
npm run qa:perf -- --qa diagonal --warmup 2 --duration 12 --speed run
npm run qa:perf -- --qa chunk-cross --warmup 2 --duration 20 --speed run
npm run qa:perf:parse
```

Inspect these gauges:

```text
treeManifestBuilds
treeManifestQueueDepth
treeNearInstances
treeProxyInstances
treeImpostorInstances
treeCanopyClusters
treeImpostorRecordsRequested.cpu
treeImpostorRecordsRequested.gpu
treeImpostorRecordsAccepted.cpu
treeImpostorRecordsAccepted.gpu
treeImpostorRecordsDropped.cpu
treeImpostorRecordsDropped.gpu
treeImpostorSubmittedKnown.cpu
treeImpostorSubmittedKnown.gpu
treeImpostorSubmitted.cpu
treeImpostorAtlasBytes
grassLastChunkClumps
grassLastChunkEffectiveBlades
grassInstanceAttributeBytes
grassInfluenceTextureUploads
grassBuildSlices
grassResourceReleases
flowerLastChunkInstances
rendererDrawCalls
rendererTriangles
rendererGeometries
rendererTextures
```

Acceptance requires stable manifests across approach directions, no unrelated
world-edit rebuilds, no stale slot geometry, bounded near-mesh counts, successful
strict asset validation, zero WebGPU validation errors and no chunk-cross
regression in frame-time percentiles.
