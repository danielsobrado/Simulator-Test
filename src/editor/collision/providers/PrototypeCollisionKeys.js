export function prototypeCollisionKeys({ prototypeCount, prototypeIndicesByAsset }) {
  if (!Number.isSafeInteger(prototypeCount) || prototypeCount < 0) {
    throw new Error('Collision prototype count must be a non-negative safe integer.');
  }
  const keys = Array.from({ length: prototypeCount }, (_, index) => `prototype:${index}`);
  for (const [assetKey, indices] of prototypeIndicesByAsset ?? []) {
    if (typeof assetKey !== 'string' || !assetKey.trim() || !Array.isArray(indices)) continue;
    for (let offset = 0; offset < indices.length; offset += 1) {
      const index = indices[offset];
      if (!Number.isSafeInteger(index) || index < 0 || index >= keys.length) continue;
      keys[index] = indices.length === 1 ? assetKey : `${assetKey}#${offset}`;
    }
  }
  return Object.freeze(keys);
}
