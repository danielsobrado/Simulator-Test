import * as THREE from 'three/webgpu';
import {
  createFallenBranchGeometry,
  createFallenLogGeometry,
  createLeafLitterGeometry,
  createMossMoundGeometry,
  createStumpGeometry,
} from './forestDebrisGeometry.js';

const KINDS = Object.freeze({
  fallenLog: Object.freeze({ geometry: createFallenLogGeometry, roughness: 0.95 }),
  stump: Object.freeze({ geometry: createStumpGeometry, roughness: 0.95 }),
  fallenBranch: Object.freeze({ geometry: createFallenBranchGeometry, roughness: 0.95 }),
  leafLitter: Object.freeze({ geometry: createLeafLitterGeometry, roughness: 0.9, side: THREE.DoubleSide }),
  mossMound: Object.freeze({ geometry: createMossMoundGeometry, roughness: 1 }),
});

/** Turns `stylizedSurface.forestDebris.variants` into prototype definitions. */
export function createForestDebrisPrototypes(layer = {}) {
  const definitions = [];
  for (const [id, entry] of Object.entries(layer.variants ?? {})) {
    const builder = KINDS[entry?.kind ?? id];
    if (!builder || entry.enabled === false) continue;
    definitions.push({
      id,
      parts: [{
        geometry: builder.geometry(),
        material: new THREE.MeshStandardNodeMaterial({
          vertexColors: true,
          roughness: builder.roughness,
          metalness: 0,
          side: builder.side ?? THREE.FrontSide,
        }),
        kind: 'detail',
      }],
      tileIds: entry.tileIds ?? null,
      weight: entry.weight ?? 1,
    });
  }
  return definitions;
}
