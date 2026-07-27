# P4 primitive rock collision headed acceptance

Date: **2026-07-27**  
Scenario: `collision-p4`

## Run

```text
http://localhost:5173/?qa=collision-p4&download=0
```

Wait for:

```js
window.__collisionP4Qa.status === 'ready'
```

Inspect:

```js
window.__collisionP4Qa.target
window.__collisionP4Qa.collision.provider.components.rocks
window.__collisionP4Qa.motor
window.__perfQaReport
```

## Required checks

### Classification

- Decorative stones have no collision helper and do not disturb movement.
- Medium rocks display orange primitive helpers and block the capsule.
- Large walkable-class rocks display purple P4 fallback helpers.
- `walkablePending` is non-zero when large prototypes are present.
- A purple fallback does not become player support in P4.

### Movement

- The automatic route runs into the selected rock and cannot pass through it.
- A slightly offset approach slides around the rock rather than stopping dead.
- Running at maximum configured speed does not tunnel through a narrow blocker.
- Dense scree does not make the player oscillate against decorative clutter.
- Water current drift cannot move the player through a rock.

### Transform parity

For at least one non-uniform prototype:

- rotate the approach around all four sides;
- confirm the helper follows the visual Y rotation;
- confirm the helper centre follows any authored local offset;
- confirm scale changes both visual and collision dimensions consistently;
- confirm the primitive is buried by the same amount as the visual rock.

### Streaming and edits

- Cross a collision chunk edge beside a rock with no temporary gap.
- Let a new biome rock variant stream in while standing still; loaded collision chunks refresh.
- Confirm unchanged trees remain collidable after the rock refresh.
- Change only rock render LOD state; collision signatures and collider counts remain stable.
- Trigger a floating-origin rebase near a rock; canonical bounds remain unchanged.

### Failure behaviour

Using a deliberately invalid development rock profile:

- profile derivation failure is visible through provider `lastError`;
- the previous valid collision chunk remains active;
- the frame loop continues;
- fixing/reloading the source allows the queued refresh to succeed.

## Performance evidence

Record at least:

```text
collisionCandidates
collisionQueryChunks
collisionPrimitiveTests
collisionRockProfiles
collisionRockColliders
collisionRockDecorativeInstances
collisionRockBlockingInstances
collisionRockWalkablePendingInstances
collisionNaturalRefreshQueueDepth
collisionBuildMs
collisionRockRefreshMs
```

Run two routes:

1. open ground near sparse rocks;
2. dense scree cluster traversal.

Acceptance expectations:

- decorative count may be high without increasing collider count;
- candidate count remains local to occupied bins;
- primitive tests remain bounded by candidates, substeps, and solver iterations;
- no collision refresh creates a visible frame hitch;
- no continuous refresh occurs from render-only LOD changes.

## Regression checks

Also run:

```text
http://localhost:5173/?qa=collision-p3&download=0
http://localhost:5173/?qa=collision-p2&download=0
```

Verify:

- tree trunks still block;
- a rock refresh never removes tree collision;
- the P2 wall fixture still stops and slides;
- swimming, diving, surfacing, and bank protection remain unchanged.

## P4 boundary

P4 is accepted when decorative clutter is ignored and medium/large rocks are safe primitive blockers.

Do not record “walkable rocks complete.” Purple `walkablePending` rocks require P5 triangle proxies and BVHs before their tops may become accurate support surfaces.
