# glTF asset optimization decision

**Status:** Implemented  
**Date:** 2026-07-26  
**Decision:** Adopt `gltfpack` from `zeux/meshoptimizer` as the reproducible
optimizer for runtime GLBs. Keep the Shopify and Khronos browser tools as
optional visual comparison aids. Do not add `gltf-pipeline`/Draco.

## Why this decision

The game needs two different improvements:

1. smaller assets to download, cache, and decode; and
2. geometry that is cheaper for the GPU to fetch and transform.

[`gltfpack`](https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md)
addresses both. Its default processing quantizes geometry and optimizes vertex
fetch and the vertex transform cache. Its meshoptimizer compression can then
reduce transfer size without discarding that GPU-friendly layout. It is also a
command-line tool, so the exact operation can be pinned, scripted, validated,
and repeated in CI.

This is a better fit than selecting a tool only for its smallest output file.
The game renders many instances of authored natural assets through a
Three.js r185, WebGPU-first renderer. Vertex layout and fetch efficiency matter
after an asset has loaded; download-only compression does not address that.

## Current project baseline

Pre-implementation snapshot of the natural-asset working tree on 2026-07-26:

| Runtime-authored GLB measure | Value |
|---|---:|
| GLBs referenced by `editor.config.yaml`, including `grass-scene.glb` | 32 |
| Total GLB bytes | 39,685,612 B (39.69 MB) |
| Embedded image buffer bytes | 22,401,403 B (22.40 MB) |
| Geometry buffer bytes | 17,123,492 B (17.12 MB) |
| Triangles | 248,122 |
| Mesh-compressed GLBs | 0 |

The newer extraction pipeline is already doing useful texture work. Its 22
published outputs use `EXT_texture_webp`, cap textures at 1024 px, and total
23,772,616 bytes. In that subset, 15,437,588 bytes are geometry and 8,239,442
bytes are embedded images. Geometry is therefore the larger remaining target
inside the curated subset.

These figures cover authored GLBs only. `gltfpack` will not reduce procedural
geometry built at runtime, tree-impostor PNGs, standalone textures, videos, or
world data.

The implemented pipeline now covers those 32 GLBs plus the two flight-only
wildlife GLBs. Its canonical prepared inputs total 48,401,368 bytes; the 34
published meshopt/KTX2 outputs total 36,390,380 bytes, saving 12,010,988 bytes
(24.8%) before HTTP compression. Gzip level 9 produces 35,364,420 bytes and
Brotli quality 9 produces 35,382,685 bytes. The small transport-compression
gain is expected because Meshopt and KTX2 have already compressed most of the
payload.

The quality-aware texture profiles deliberately use larger UASTC colour
textures for alpha-tested foliage and wildlife. This preserves cutout edges
while still allowing GPU-native block compression, so a texture-heavy
individual GLB can be larger than its WebP input even though the complete
runtime set is smaller.

## Verification

The implementation was verified on 2026-07-26 with:

- `npm run verify`: all production asset validators, 559 tests, and the Vite
  production build passed;
- a second clean regeneration produced the identical runtime-manifest SHA-256,
  confirming byte-stable output with the pinned tool and single-threaded
  texture encoder;
- two deterministic `chunk-cross` runs on the hardware WebGPU path
  (NVIDIA Lovelace): 136.22 and 147.32 average FPS, with p95 frame times of
  11.65 ms and 9.90 ms;
- a console-clean browser smoke pass showing the compressed scene rendered
  correctly;
- two cold-cache startup runs on NVIDIA Lovelace hardware: median authored
  asset readiness was 2,496.05 ms and median first frame was 12,662.30 ms;
  the 32 enabled GLBs transferred 33,345,940 encoded bytes per run;
- 78 KTX2 textures selected BC7 and occupied 70,705,792 bytes of compressed
  mip payload instead of an estimated 282,809,904 RGBA8 bytes, a measured 75%
  texture-residency reduction.

Those movement runs verify that the optimized assets work on the real GPU path.
They are not presented as a causal FPS comparison because no controlled pair of
pre-change runs was captured against the same complete code state.

## Candidate comparison

| Candidate | Size reduction | GPU-oriented geometry | Reproducible build step | Fit for this project |
|---|---|---|---|---|
| **`gltfpack`** | Meshopt, quantization, optional WebP/KTX2 and simplification | **Yes:** vertex cache/fetch optimization, quantized attributes, mesh merging where safe | **Yes:** CLI/native binary or npm package | **Adopt** |
| [Shopify glTF Compressor](https://github.com/Shopify/gltf-compressor) | Strong interactive texture format, resolution, and quality tuning; some mesh/animation export options | Not its primary purpose | No stable CLI release; browser workflow is manual | Use only to find visual texture-quality thresholds |
| [Cesium `gltf-pipeline`](https://github.com/CesiumGS/gltf-pipeline) | GLB/glTF conversion and Draco geometry compression | Draco is primarily a compact interchange codec; this pipeline does not offer `gltfpack`'s complete GPU-oriented mesh pass | Yes, CLI/Node | Reject: the game already uses GLB 2.0 and would need a second decoder path for little project-specific benefit |
| [Khronos glTF-Compressor](https://github.com/KhronosGroup/glTF-Compressor) | Interactive KTX2, WebP, Draco, Meshopt, and quantization comparisons | Can compare Meshopt and quantization | Primarily a WebGL viewer/application, not the simplest deterministic content pipeline | Use only as an independent visual comparison lab |

The two browser tools remain useful for an artist deciding whether a particular
normal map tolerates a lower resolution or whether ETC1S artifacts are visible.
They should not be the source of production assets: manual export settings are
easy to lose and difficult to reproduce across 32 files.

`gltf-pipeline` is valuable when a project needs glTF 1.0 conversion,
glTF/GLB cross-conversion, separate-resource packaging, or an established Draco
pipeline. None is a current requirement here. Adding `DRACOLoader` beside a
meshopt path would increase runtime and maintenance surface without improving
the chosen pipeline.

## Recommended production profile

Use `gltfpack` as the final geometry step after extraction, grounding,
normalization, texture resizing, and WebP conversion:

```text
source GLB
  -> existing glTF Transform extraction/curation
  -> gltfpack geometry optimization + meshopt compression
  -> validation and manifest hashing
  -> public runtime GLB
```

The implementation pins native `gltfpack` 1.2 by release checksum. Both
profiles share:

```powershell
gltfpack -i input.glb -o output.glb -cc -kn -km -ke -vpf `
  -tq 8 -tl color,normal 1024 -tl attrib 512 -tj 1
```

Opaque assets use the `standard` profile:

```powershell
-tc color,attrib -tu normal
```

Assets containing any non-opaque material use the `alphaCritical` profile:

```powershell
-tc attrib -tu color,normal
```

The intent of each option is:

- `-cc`: meshoptimizer compression using `EXT_meshopt_compression`, with the
  more compression-friendly encoding;
- `-kn`: keep named nodes because runtime prototype grouping and extraction use
  node names;
- `-km`: keep named materials because tree and grass extraction identifies
  trunk/leaf/rock materials by name;
- `-ke`: retain non-asset `extras`; extraction provenance in `asset.extras`
  must also remain intact.
- `-vpf`: retain floating-point positions because the runtime bakes authored
  mesh transforms into reusable CPU-side prototype geometry.
- `-tc color,attrib -tu normal`: use compact ETC1S for standard colour/data
  textures and higher-quality UASTC for normal maps;
- `-tc attrib -tu color,normal`: keep alpha-critical colour/cutout edges and
  normal maps in higher-quality UASTC while retaining ETC1S for data textures;
- `-tq 8`: use texture quality 8;
- `-tl color,normal 1024 -tl attrib 512`: cap colour/normal maps at 1024 px and
  data maps at 512 px;
- `-tj 1`: keep texture encoding deterministic.

The current set selects 17 `standard` and 17 `alphaCritical` assets
deterministically from source material alpha modes.

Keep the default normal, tangent, colour, and texture-coordinate quantization
because it is part of the GPU-memory and vertex-fetch benefit. Positions remain
floating-point to preserve the runtime's CPU transform-baking contract. Do
**not** enable these options in the first rollout:

- `-si`: automatic simplification can change near-field silhouettes. The game
  already owns its proxy and impostor LOD policy, so simplification must be
  selected and visually approved per LOD asset.
- `-mi`: runtime code builds its own stable instancing and intentionally
  discards showroom placements.
- `-tw`: the extraction pipeline has already made one quality-90 WebP
  conversion. Re-encoding those textures would introduce generation loss.

Serve GLBs with Brotli or gzip at the HTTP layer. Meshoptimizer's `-cc` output is
designed to remain compressible by general-purpose transport compression.
After deployment, verify negotiation and cache safety against the real host:

```bash
npm run verify:asset-serving -- --url https://deployment.example
```

The check requires a successful GLB response, `Content-Encoding: br` or
`gzip`, and `Vary: Accept-Encoding`. The repository has no production URL
configured, so deployment verification remains a release-environment step.

### Runtime prerequisite

Every production GLTF loader now registers the meshopt decoder and a
renderer-detected KTX2 loader:

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ktx2Loader = new KTX2Loader().detectSupport(renderer);
const loader = new GLTFLoader()
  .setMeshoptDecoder(MeshoptDecoder)
  .setKTX2Loader(ktx2Loader);
```

Vite bundles the Basis Universal JavaScript/WASM transcoder from the pinned
Three.js 0.185.1 dependency, so runtime loading has no CDN dependency.

Three.js r185 in this repository supports both `EXT_meshopt_compression` and
`KHR_meshopt_compression`. Use the established `EXT`/`-cc` path first. Evaluate
`KHR`/`-cz` separately only if its smaller result is material and the pinned
Three.js decoder, glTF validator, target browsers, and asset inspection all
pass.

## Implemented KTX2 phase

WebP reduces download size, but browsers normally decode it to uncompressed GPU
texture memory. KTX2/Basis Universal can transcode to a GPU-native compressed
format, reducing texture residency and upload bandwidth. Khronos documents the
portable glTF path as
[`KHR_texture_basisu`](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXDeveloperGuide.md).

The optimizer losslessly stages existing WebP inputs as PNG before invoking
`gltfpack`. This is required because `gltfpack` deliberately preserves an
existing `EXT_texture_webp` source instead of recompressing it. The published
files require `KHR_texture_basisu`; validators reject a texture-bearing runtime
GLB that does not.

ETC1S is used for colour/data maps and UASTC for normal maps. Transparency,
foliage edges, normal response, mip behavior, colour space, and decoded GPU
residency remain explicit visual/profiling gates. Alpha-critical colour maps
also use UASTC. WebP remains the compact offline extraction format, not a
runtime fallback.

The headed hardware QA confirms that the target NVIDIA adapter transcodes the
current KTX2 set to BC7. That result is adapter-specific; other GPUs can select
ASTC, ETC2, or another supported target.

## Texture tiers

**Added 2026-07-26.** Transcoding, not download, dominates the asset phase of
startup: 110 KTX2 textures at 1024×1024 cost a median 270 ms each and 29.3 s
cumulative across the transcoder workers. The scatter layers contributed most of
that count.

`RUNTIME_TEXTURE_TIERS` therefore splits the colour/normal ceiling in two:

| tier | ceiling | assets |
| --- | --- | --- |
| `hero` | 1024 | tree variants and the shared scene |
| `scatter` | 512 | rocks, bushes, ground details, aquatic plants, wildlife |

Scatter props are drawn small and in bulk — a ground tuft or a boulder never
fills more of the screen than its own silhouette — so halving the dimension
quarters the block count where it is least visible. Trees keep the full size:
they are the hero silhouettes the camera stands next to.

Each base profile gains a scatter counterpart, giving four:
`standard`, `alphaCritical`, `standardScatter`, `alphaCriticalScatter`. Alpha
handling is unchanged and still selected from the source materials; the tier is
orthogonal to it. Data (`attrib`) textures stay at their existing 512 ceiling —
they are already the smaller half of the budget and are read for their values
rather than their detail.

`runtimeAssetTextureTiers` in `scripts/lib/runtime-asset-sources.mjs` derives the
tier from which configured variant list a scene appears in. A scene listed under
both a tree and a scatter layer keeps the hero tier: being shared is a reason to
encode it once at the higher quality. Both `optimize-runtime-assets.mjs` and
`validate-runtime-assets.mjs` read the same map, so the validator recomputes the
expected profile exactly as the optimizer chose it.

`RUNTIME_ASSET_PROFILE_VERSION` moved to `2`. Re-encoding rewrote 24 GLBs and
took the published payload from ~35 MiB to ~26.5 MiB; boot-time transcodes fell
to 37 at a 94 ms median, 3.7 s cumulative. The remaining 1024² textures are the
hero tier, as intended.

See [asset startup and variant residency](asset-startup-and-variant-residency.md)
for the loading-side half of the same investigation.

## Implemented build safety and measurement

`npm run optimize:runtime-assets` now uses a content-addressed cache keyed by
the source SHA-256, pinned `gltfpack` version, pipeline/profile versions,
selected profile, and exact optimizer arguments. Cache entries contain their
own output/report hashes and are ignored if corrupt. This avoids repeating
expensive KTX2 encoding without permitting stale artifacts.

All 34 outputs are built into staging and must pass structural, semantic, and
official glTF validation before publication. Publication uses a Windows-safe
two-phase per-file swap with rollback; the manifest is written last as the
commit marker. Validation checks names, extras, animations, skins, extensions,
world-space bounds, draw-part count, material/triangle assignments, triangle
count, and logical vertex/index bytes.

The pinned official Khronos glTF Validator must report no output errors or new
warnings. Its release predates KTX2/Meshopt, so the pipeline narrowly recognizes
its known `image/ktx2` format warnings. Source warnings may be inherited only
when the same code and message were already present; the crow and seagull
retain their known skinned-non-root warnings, while genuine output errors still
fail the build.

The manifest records per-asset source/output/gzip/Brotli bytes, logical decoded
vertex/index bytes, bounds, semantic structure, selected profile, exact flags,
cache key, hashes, and official-validator summary. Current logical vertex data
falls from 15,583,176 to 6,296,044 bytes (59.6% less), and logical index data
falls from 2,879,220 to 1,466,436 bytes (49.1% less).

`npm run qa:assets:startup -- --runs 2 --headed` performs cold-cache hardware
WebGPU runs and records navigation-to-assets-ready, navigation-to-first-frame,
GLB network timing/bytes, Meshopt task percentiles, KTX2 task percentiles,
selected GPU formats, and compressed versus RGBA8 texture residency in
`tmp/asset-startup-qa-latest.json`.

## Adoption plan and gates

### 1. Establish reproducibility

- Pin the native `gltfpack` release and record its checksum. Do not depend on an
  unpinned global installation.
- Use the repository script that optimizes from extraction output into a
  staging directory and transactionally publishes only after validation.
- Never optimize an optimized GLB. Always regenerate from the extraction/source
  asset to avoid cumulative quantization or texture loss.
- Record input hash, output hash, tool version, flags, compressed bytes,
  decoded accessor bytes, bounds, mesh/material/node counts, and triangle count
  in the asset manifest.

### 2. Protect runtime contracts

Extend asset validation so it fails if:

- configured node or material names disappear;
- `asset.extras` extraction provenance changes;
- scene count, prototype count, material-part grouping, bounds, grounding, or
  triangle count changes unexpectedly;
- a compressed file does not declare the expected meshopt extension;
- the application loader cannot decode every configured GLB.

Continue to run the official
[`glTF-Validator`](https://github.com/KhronosGroup/glTF-Validator) over every
published output.

### 3. Pilot before bulk conversion

Use three assets with different risk:

- `stylized-oak.glb`: largest file and a high-value size case;
- one multi-material tree: validates trunk/leaf names and part grouping;
- one alpha-heavy bush or aquatic plant: validates texture and edge behavior.

For each pilot, compare:

- raw and Brotli/gzip transfer bytes;
- cold-cache time from request start until prototype readiness;
- decode/parse CPU time and peak JS/ArrayBuffer memory;
- decoded vertex/index byte counts and attribute component types;
- node, material, primitive, triangle, prototype, and draw-call counts;
- fixed-camera screenshots and near/mid/far LOD transitions.

### 4. Performance acceptance

This change touches streamed render assets, so follow
[player movement performance QA](perf-qa.md):

- use the real hardware WebGPU path and close other app-rendering tabs;
- run at least two before/after `chunk-cross` samples in the same session;
- compare p50/p95/p99 frame time, hitches, render time, and upload counters;
- reject a statistically credible regression in steady-state frame time or
  streaming hitches, even if the files are smaller.

The movement harness starts measurement after stylized assets are ready. Use
the separate `qa:assets:startup` harness for cold-load/decode and GPU-residency
claims.

Adopt the bulk conversion only when:

- every runtime contract and visual check passes;
- total configured authored-GLB transfer size falls materially;
- cold-load readiness improves or remains within measurement noise;
- decoded geometry bytes decrease;
- headed WebGPU QA is neutral or better.

Do not promise a specific FPS gain from file compression. The strongest expected
benefits are lower transfer/cache size, lower geometry-buffer footprint, faster
vertex fetch, and faster cold loading. Actual frame-time improvement depends on
whether authored geometry is a bottleneck in the measured scene.

## Final recommendation

The project has adopted **`gltfpack`** for conservative geometry optimization,
meshoptimizer compression, and KTX2 while preserving names, materials,
animations, skins, and extras. It is
the only candidate that combines a deterministic CLI pipeline with direct
GPU-oriented mesh optimization.

Keep the Shopify and Khronos compressors as optional artist-facing comparison
tools, and do not introduce the Cesium/Draco pipeline.
