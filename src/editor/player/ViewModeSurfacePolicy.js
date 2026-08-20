import * as THREE from 'three';

const FAR_TERRAIN_OBJECT_NAME = 'macro-far-terrain';

function setMaterialSide(material, side) {
  if (!material) return 0;
  if (Array.isArray(material)) {
    return material.reduce((count, entry) => count + setMaterialSide(entry, side), 0);
  }
  if (material.side === side) return 0;
  material.side = side;
  material.needsUpdate = true;
  return 1;
}

/**
 * Orbit/edit inspection can cross the heightfield, so terrain must occlude the
 * world from either side. Player cameras keep front-face terrain for the normal
 * gameplay path and its lower fragment cost.
 */
export function applyTerrainInspectionMode(terrainView, inspectionMode) {
  if (!terrainView) return 0;
  const side = inspectionMode ? THREE.DoubleSide : THREE.FrontSide;
  let updated = 0;

  for (const slot of terrainView.slots ?? []) {
    updated += setMaterialSide(slot?.material, side);
  }

  const farTerrain = terrainView.scene?.getObjectByName?.(FAR_TERRAIN_OBJECT_NAME);
  updated += setMaterialSide(farTerrain?.material, side);
  return updated;
}
