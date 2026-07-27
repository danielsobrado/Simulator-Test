# P5 walkable rock collision headed acceptance

Date: **2026-07-28**  
Scenario: `collision-p5`

## Run

```text
http://localhost:5173/?qa=collision-p5&download=0
```

Wait for:

```js
window.__collisionP5Qa.status === 'ready'
window.__collisionP5Qa.target?.tier === 'walkable'
window.__collisionP5Qa.collision.world.prototypes > 0
window.__collisionP5Qa.collision.provider.components.rocks.walkable > 0
```

Inspect:

```js
window.__collisionP5Qa.target
window.__collisionP5Qa.collision.provider.components.rocks
window.__collisionP5Qa.collision.provider.components.rocks.details
window.__collisionP5Qa.motor
window.__perfQaReport
```

## Required movement checks

### Side collision

- Run directly into the steep side of the selected rock.
- Confirm the capsule stops or slides; it must not teleport onto the top.
- Repeat from four directions and at maximum run speed.
- Approach a concave-looking visual region and confirm the simplified proxy remains
  conservative rather than allowing penetration.

### Walking support

- Reach the rock through a naturally walkable slope or a valid low step.
- Confirm the player remains grounded while crossing the top.
- Confirm the reported support source is the walkable rock mesh.
- Confirm the reported normal follows the visible slope rather than always pointing
  straight up.
- Walk across triangle boundaries and confirm no vibration or height popping.

### Slope policy

- Confirm surfaces below the configured maximum slope are walkable.
- Confirm steeper faces block or slide the player.
- Confirm vertical and underside triangles never become support.
- Stand beside an overhang and confirm the player does not snap through it.

### Jumping and transitions

- Jump onto a valid rock top and confirm the fall lands on the mesh support.
- Jump toward a steep side and confirm it remains a side collision.
- Jump from rock to terrain and terrain to rock without a one-frame drop or snap.
- Walk off the edge and confirm normal gravity begins once support is lost.

## Transform and streaming checks

For rotated and scaled rock variants:

- collision follows Y rotation;
- collision follows authored uniform scale;
- collision uses the same burial amount as rendering;
- debug AABBs remain aligned after a floating-origin rebase;
- crossing collision chunk boundaries produces no collision gap;
- render mesh/proxy LOD changes do not change collision or rebuild BVHs.

Stream a new biome rock variant while stationary and confirm:

- one new prototype BVH is registered only when needed;
- existing instances continue referencing their previous prototype;
- unchanged tree colliders remain active;
- failed proxy generation retains the previous valid owner chunk and follows the
  bounded retry policy from PR #50.

## Authored proxy checks

When an asset contains `COLLIDER_WALKABLE`:

- the node is never visible in rendering;
- status reports `generated: false` for its prototype;
- the proxy triangle count is at or below `maximumProxyTriangles`;
- the proxy overlaps the visual rock by at least `minimumProxyOverlapRatio`.

With generated fallback enabled:

- generated prototypes are visible in counters/status;
- they remain under the triangle cap;
- no asset is silently reported as authored.

With authored-only mode enabled:

```yaml
rocks:
  allowGeneratedProxyFallback: false
  requireAuthoredProxy: true
```

`npm run validate:assets` must fail for every walkable rock asset without a reserved
collision mesh.

## Performance evidence

Capture at least:

```text
collisionCandidates
collisionQueryChunks
collisionRockMeshPrototypes
collisionRockMeshTriangles
collisionRockGeneratedPrototypes
collisionRockWalkableInstances
collisionMeshQueries
collisionMeshTriangleTests
collisionMeshContacts
collisionMeshSupportQueries
collisionMeshSupportTriangleTests
collisionMeshSupportHits
collisionBuildMs
collisionRockRefreshMs
```

Run:

1. open ground with no walkable rock candidate;
2. repeated movement around one large rock;
3. traversal across several large rocks in a dense scree area;
4. repeated render LOD transitions while standing on a rock.

Acceptance expectations:

- BVH count scales with unique walkable prototypes, not placements;
- triangle tests remain local to broadphase candidates and BVH leaves;
- no continuous BVH rebuild occurs from movement or render LOD;
- no GPU readback is introduced;
- no visible frame hitch occurs when a previously unseen prototype is first needed
  within the normal collision build budget.

## Regression routes

Also run:

```text
http://localhost:5173/?qa=collision-p2&download=0
http://localhost:5173/?qa=collision-p3&download=0
http://localhost:5173/?qa=collision-p4&download=0
```

Verify:

- the P2 wall still stops and slides;
- tree trunks still block independently of LOD;
- decorative and medium rocks retain their P4 behaviour;
- swimming, diving, current drift, surfacing, and bank protection remain unchanged.

## Automated gates

```bash
npm test
npm run build
npm run validate:assets
```

P5 is accepted only after the tests/build pass and the headed checks demonstrate
real walkable support, slope rejection, jump landing, and underside safety.
