/** The forest habitat at a canonical point, or null before tree manifests exist. */
export function habitatAt(editor, x, z) {
  const sample = editor.stylizedSurface.treeView?.manifestStore?.forestField?.sample(x, z);
  if (!sample) return null;
  const { tileId, profileKey, patchCoverage, patchEdge, elevationWeight } = sample;
  return { tileId, profileKey, patchCoverage, patchEdge, elevationWeight };
}

/** First closed-canopy point on concentric grid rings around a canonical anchor. */
export function findCanopyPose(editor, { x, z, tileId, coverage = 0.75, step = 16, radius = 480 }) {
  if (![x, z, coverage, step, radius].every(Number.isFinite) || step <= 0 || radius < 0 || coverage < 0 || coverage > 1) {
    throw new Error('Invalid canopy search bounds.');
  }
  const field = editor.stylizedSurface.treeView?.manifestStore?.forestField;
  if (!field) return null;
  const store = editor.terrainView.worldStore, cell = store.tileSize;
  for (let ring = 0; ring <= Math.floor(radius / step); ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const px = x + i * step, pz = z + j * step;
        if (store.getTile(Math.floor(px / cell), Math.floor(-pz / cell)) !== tileId) continue;
        const patchCoverage = field.sample(px, pz)?.patchCoverage ?? 0;
        if (patchCoverage >= coverage) return { x: px, z: pz, patchCoverage };
      }
    }
  }
  return null;
}
