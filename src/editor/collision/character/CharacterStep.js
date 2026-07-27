import { moveCharacterCapsule } from './CharacterCapsule.js';
import { findCharacterSupport } from './CharacterSupport.js';

const STEP_EPSILON = 1e-5;

export function tryCharacterStep({
  capsule,
  targetX,
  targetZ,
  candidates,
  terrainProvider,
  maximumSlopeCosine,
  stepHeight,
  skinWidth,
  collides,
}) {
  if (!(stepHeight > 0) || typeof collides !== 'function') return null;
  const raisedY = capsule.y + stepHeight + skinWidth;
  const raised = moveCharacterCapsule(capsule, targetX, raisedY, targetZ);
  if (collides(raised, candidates)) return null;

  const support = findCharacterSupport({
    x: targetX,
    z: targetZ,
    referenceY: raisedY,
    radius: capsule.radius,
    terrainProvider,
    candidates,
    maximumUp: 0,
    maximumDown: stepHeight + skinWidth,
    maximumSlopeCosine,
  });
  if (!support?.walkable
      || support.height > capsule.y + stepHeight + STEP_EPSILON
      || support.height < capsule.y - skinWidth) {
    return null;
  }

  const stepped = moveCharacterCapsule(capsule, targetX, support.height, targetZ);
  if (collides(stepped, candidates)) return null;
  return Object.freeze({ capsule: stepped, support });
}
