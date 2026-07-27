# Prop collision P2 character-motor QA

Date: **2026-07-27**  
Gameplay scope: **primitive QA colliders plus CPU terrain**

## Run

```text
http://localhost:5173/?qa=collision-p2&download=0
```

The scenario:

- spawns at canonical X=8, Z=-14;
- faces north toward the long wall at Z=-20;
- runs for three measured seconds after residency warm-up;
- enables collider and broadphase debug drawing;
- publishes `window.__collisionP2Qa`.

## Ready contract

```js
window.__collisionP2Qa.status === 'ready'
window.__collisionP2Qa.collision.residency.ready === true
window.__collisionP2Qa.motor.active === true
```

## Manual acceptance

1. Confirm the player stops before crossing the wall.
2. Approach the wall diagonally and confirm forward motion becomes a stable slide.
3. Enter and leave the inside corner without vibration or tunnelling.
4. Walk onto the low step and confirm the foot height snaps to its top.
5. Confirm the high step blocks the player.
6. Jump toward the low step and confirm no airborne auto-step occurs.
7. Cross the fixture chunk boundary and confirm movement pauses rather than entering an unready collision chunk.
8. Trigger a floating-origin rebase and confirm colliders, support, and movement remain aligned.
9. Enter water and verify wading, swimming, diving, bank protection, and underwater atmosphere remain unchanged.
10. Use `setPose` through the QA API and confirm the previous-valid collision state resets to the new pose.

## Useful status

```js
window.__collisionP2Qa.player
window.__collisionP2Qa.motor
window.__collisionP2Qa.collision
window.__editor.characterMotor.getStatus()
```

Relevant counters:

```text
collisionCandidates
collisionQueryChunks
collisionContacts
collisionSolverIterations
collisionSubsteps
collisionStepUps
collisionNotReadyStops
```

## Automated gates

```bash
npm test
npm run build
```
