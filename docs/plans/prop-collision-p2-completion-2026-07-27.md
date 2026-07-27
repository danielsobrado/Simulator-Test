# Prop collision P2 completion

Date: **2026-07-27**  
Branch: `agent/prop-collision-p2`  
Base: `dc7452801dae8bf997ead9b7c8465cfcb307de3c`  
Parent plan: [`prop-collision-implementation-plan-2026-07-27.md`](prop-collision-implementation-plan-2026-07-27.md)

## Delivered

### Character state

- The player keeps a separate capsule foot height and camera eye height.
- Existing eye height, walking, running, jump, gravity, and water controls retain their meanings.
- Player status exposes support source, support normal, collision readiness, contacts, step state, and the previous valid canonical position.
- Pose resets, harness spawning, walk-mode entry, and floating-origin rebases preserve the collision contract.

### Primitive narrowphase

- Capsule against Y-oriented boxes.
- Capsule against spheres using rounded vertical separation.
- Capsule against vertical capsules/cylinders.
- Stable world-space horizontal normals and penetration depths.
- Configured skin width for numerical separation.
- Deterministic deepest-contact selection and corner resolution.

### Motion solver

- One candidate collection for the complete swept move, including ground-snap and step-up clearance.
- Distance-bounded substeps prevent tunnelling at the configured maximum player speed and clamped frame delta.
- Iterative penetration resolution slides along walls and resolves multiple contacts.
- Solver iterations and substeps have hard ceilings.
- A not-ready destination retains the previous valid canonical position.

### Terrain, slopes, and steps

- `TerrainCollisionProvider` wraps the CPU-authoritative canonical heightfield.
- Terrain normals are sampled across the capsule footprint.
- Excessively steep uphill motion loses only its uphill component, preserving tangent and downhill movement.
- Grounded players may step onto a walkable primitive only after raised clearance, horizontal clearance, and downward support checks.
- High, narrow, unsupported, and airborne steps are rejected.
- Existing terrain ground snap remains authoritative where no primitive support is selected.

### Runtime integration

- P1 and P2 use one runtime bootstrap and one collision world.
- The collision config loaded by `loadEditorConfig` is shared through a module bridge; the bootstrap does not parse a second YAML copy.
- Player movement converts render-local X/Z to canonical coordinates once before the motor and converts the result back once afterward.
- The merged W3 swimming and underwater movement remain compatible.

## Runtime scope

`config/collision.yaml` remains disabled for normal worlds until P3 supplies production tree colliders. The P2 motor is active for:

- `?qa=collision-p2`;
- the existing `?qa=collision-p1` broadphase fixture; or
- explicit collision debug activation.

This avoids enabling an empty production prop-collision store before its first real provider exists.

## QA

Run:

```text
http://localhost:5173/?qa=collision-p2&download=0
```

The deterministic route spawns south of the long fixture wall and runs forward. The capsule must stop at the wall without crossing it. Debug colliders and broadphase bins are enabled automatically.

Development status:

```js
window.__collisionP2Qa
window.__editor.collision
window.__editor.characterMotor
```

## Automated coverage

Focused dependency-free tests cover:

- box, sphere, and vertical-capsule contacts;
- rotated box normals;
- non-walkable and narrow support rejection;
- maximum-speed tunnelling;
- wall stop and diagonal wall slide;
- inside-corner determinism;
- low-step acceptance;
- high-step and airborne-step rejection;
- readiness stops;
- zero displacement;
- terrain slope constraints;
- jump and landing;
- foot/eye separation;
- solver work limits;
- candidate vertical-clearance coverage;
- composition of the shared config and player;
- all existing W3 swimming physics cases.

## Required before ready

```bash
npm test
npm run build
```

Headed acceptance must also verify wall stop/slide, low/high steps, a floating-origin rebase, chunk-boundary readiness, jumping, and swimming transitions in the P2 fixture.
