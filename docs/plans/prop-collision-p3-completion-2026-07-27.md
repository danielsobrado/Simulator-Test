# Prop collision P3 completion

Date: **2026-07-27**  
Branch: `agent/prop-collision-p3`  
Base: `40daff29ead32e909ba2cb58299b57063c4f72e4`  
Parent plan: [`prop-collision-implementation-plan-2026-07-27.md`](prop-collision-implementation-plan-2026-07-27.md)

## Delivered

### Production runtime

- `config/collision.yaml` now enables collision in normal worlds.
- Runtime composition waits for initialized tree prototypes and manifests before attaching the player motor.
- P1 and P2 retain the deterministic primitive fixture.
- P3 and normal gameplay use the production tree provider.
- No render readback or physics engine was introduced.

### Canonical tree source

`StylizedSurfaceView` publishes the initialized `StylizedTreeView` through the collision composition bridge after tree assets finish loading.

The collision source consumes:

- baked prototype parts from `StylizedTreeView.prototypes`;
- canonical placements from `TreeManifestStore`;
- the same palette-resolved prototype index used by rendering;
- canonical placement X/Z, terrain height, rotation, authored scale, species, age, and stable ID;
- forest edits, path clearance, construction blockers, rock blockers, terrain revisions, and biome-palette revisions.

The source does not consume:

- `InstancedMesh` matrices;
- proxy or impostor geometry;
- LOD bands, fades, dither state, wind deformation, or canopy clusters;
- GPU buffers or readbacks.

### Trunk profile derivation

Each baked tree prototype receives one immutable collision profile.

- Only parts classified as `trunk` are inspected.
- Leaves are ignored completely.
- Radius is sampled from the lower trunk band rather than full trunk/branch bounds.
- Several vertical slices are evaluated and a conservative lower-radius profile is selected.
- Sparse low-poly trunks use a complete lower-band fallback.
- Invalid or implausibly broad results fail with the prototype ID and require an explicit override.
- Radius is clamped to `minimumTrunkRadius`.
- Height, centre offset, and grounded base are retained in prototype-local coordinates.

Overrides live in `collision.trees.prototypeOverrides` and may define:

```yaml
prototypeOverrides:
  "prototype:3":
    radius: 0.42
    height: 6.5
    centerX: 0.1
    centerZ: -0.2
    baseY: 0.05
```

Numeric prototype keys are also accepted.

### Instance colliders

Every active tree placement produces one blocking vertical capsule.

- Stable ID: `tree:<encoded placement stable ID>:trunk`.
- Radius and height use the placement's authored uniform scale.
- Local centre offset follows placement Y rotation.
- Base height uses the exact canonical placement ground height.
- Planted and generated trees use the same contract.
- Canopies and branches do not create physical walls.
- Tree capsules are blocking-only and cannot become walkable support.

### Streaming and edits

Tree colliders use the existing collision owner chunks and spatial bins.

- Initial chunks are built synchronously under collision residency count/time budgets.
- Loaded chunks retain a tree collision signature.
- Source-authority changes enqueue only currently loaded collision chunks.
- Rebuilds compare canonical manifest, resolved prototype, and profile signatures.
- Unchanged chunks retain their previous data and revision.
- Changed chunks replace all tree colliders atomically.
- Felling removes the stable collider.
- Planting adds a stable collider.
- Failed refreshes retain the previous valid collision chunk.
- Render-only LOD changes never rebuild collision.

### Debug and telemetry

Collider helpers use deterministic colours derived from `prototypeId`.

New counters:

```text
collisionTreeProfiles
collisionTreeChunkBuilds
collisionTreeChunkRefreshes
collisionTreeRefreshMs
collisionTreeChunks
collisionTreeColliders
collisionTreeRefreshQueueDepth
```

Runtime status includes provider profile count, loaded chunks, active tree colliders, queued refreshes, last error, and a sample tree target for P3 QA.

## P3 QA

Run:

```text
http://localhost:5173/?qa=collision-p3&download=0
```

After the production provider finds its first resident tree, the QA bootstrap positions the player south of that canonical trunk. The measured route runs directly toward it.

Development status:

```js
window.__collisionP3Qa
window.__collisionP3Qa.target
window.__editor.collision
window.__editor.characterMotor
```

## Automated coverage added

- lower-trunk extraction ignores leaves and upper branches;
- sparse low-poly fallback;
- invalid profile override requirements;
- profile immutability and deterministic signatures;
- authored placement scale and rotation;
- generated and planted stable IDs;
- atomic cut-tree removal;
- render-LOD independence;
- floating-origin invariance;
- canonical manifest-source boundary;
- collision-authority placement signatures;
- production configuration and override validation;
- production runtime composition;
- manifest-derived trunk blocking through the P2 character motor.

## Required verification

This connected environment cannot clone the repository or install its dependencies. Before marking the PR ready, run:

```bash
npm test
npm run build
```

Then complete the headed acceptance battery in [`../qa/prop-collision-p3-tree-trunks-2026-07-27.md`](../qa/prop-collision-p3-tree-trunks-2026-07-27.md).

## Deferred

- Decorative and blocking rock classification: P4.
- Walkable rock mesh proxies/BVHs: P5.
- Placed object and building collision: P6.
- Procedural construction collision: P7.
