import * as THREE from 'three/webgpu';
import { color, mix, positionGeometry, vec3 } from 'three/tsl';
import { stylizedFbm2 } from '../StylizedNoiseNodes.js';
import {
  createFallenBranchGeometry,
  createFallenLogGeometry,
  createLeafLitterGeometry,
  createMossMoundGeometry,
  createStumpGeometry,
} from './forestDebrisGeometry.js';

/**
 * Cushions of moss stems a few centimetres across, darker between them, with
 * broad dry patches: the flat vertex colour alone read as a green plastic disc.
 */
function mossSurfaceColor() {
  const at = positionGeometry.xz;
  const cushions = stylizedFbm2(at.mul(16)).mul(0.5).add(0.5);
  const patches = stylizedFbm2(at.mul(2.2).add(5.3)).mul(0.5).add(0.5);
  // A multiplier: the material's vertexColors already applies the moss colour.
  const tufted = vec3(mix(0.35, 1.15, cushions.smoothstep(0.25, 0.75)));
  return mix(tufted, tufted.mul(color('#b9a46a')), patches.smoothstep(0.55, 0.9).mul(0.6));
}

const KINDS = Object.freeze({
  fallenLog: Object.freeze({ geometry: createFallenLogGeometry, roughness: 0.95 }),
  stump: Object.freeze({ geometry: createStumpGeometry, roughness: 0.95 }),
  fallenBranch: Object.freeze({ geometry: createFallenBranchGeometry, roughness: 0.95 }),
  leafLitter: Object.freeze({ geometry: createLeafLitterGeometry, roughness: 0.9, side: THREE.DoubleSide }),
  mossMound: Object.freeze({ geometry: createMossMoundGeometry, roughness: 1, colorNode: mossSurfaceColor }),
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
          ...(builder.colorNode ? { colorNode: builder.colorNode() } : {}),
        }),
        kind: 'detail',
      }],
      tileIds: entry.tileIds ?? null,
      weight: entry.weight ?? 1,
    });
  }
  return definitions;
}
