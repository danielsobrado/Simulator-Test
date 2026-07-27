import { findPrimitiveTopSupport } from './CharacterContacts.js';

const SUPPORT_EPSILON = 1e-6;

function withinSupportWindow(height, referenceY, maximumUp, maximumDown) {
  return height <= referenceY + maximumUp + SUPPORT_EPSILON
    && height >= referenceY - maximumDown - SUPPORT_EPSILON;
}

export function findCharacterSupport({
  x,
  z,
  referenceY,
  radius,
  terrainProvider,
  candidates = [],
  maximumUp = 0,
  maximumDown = 0,
  maximumSlopeCosine = 0,
  onPrimitiveTest = null,
}) {
  if (!terrainProvider) throw new Error('Character support requires a terrain provider.');
  if (onPrimitiveTest !== null && typeof onPrimitiveTest !== 'function') {
    throw new Error('Character support primitive-test callback must be a function.');
  }
  const terrain = terrainProvider.sample(x, z, radius);
  let best = withinSupportWindow(terrain.height, referenceY, maximumUp, maximumDown)
    ? Object.freeze({
      ...terrain,
      walkable: terrain.normal.y >= maximumSlopeCosine,
      collider: null,
    })
    : null;

  for (const collider of candidates) {
    onPrimitiveTest?.(collider);
    const support = findPrimitiveTopSupport({
      x,
      z,
      radius,
      collider,
      maximumSlopeCosine,
    });
    if (!support
        || !withinSupportWindow(support.height, referenceY, maximumUp, maximumDown)) {
      continue;
    }
    if (!best || support.height > best.height + SUPPORT_EPSILON) {
      best = Object.freeze({ ...support, walkable: true });
    }
  }
  return best;
}
