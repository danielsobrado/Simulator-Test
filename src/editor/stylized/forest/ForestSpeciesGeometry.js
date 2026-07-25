import * as THREE from 'three';
import { finalizeGeometry, mergeParts, unitRandom } from './proceduralGeometry.js';

/**
 * Procedural tree prototypes for the species the source GLB does not cover.
 *
 * `grass-scene.glb` supplies only dark conifers, so `conifer_narrow` and
 * `conifer_wide` keep using those baked prototypes. The broadleaf archetypes —
 * round crowns, white-barked birch, flat tropical crowns and sparse wetland
 * stands — are built here.
 *
 * Built once at startup and cached, never during a chunk build. Age variation is
 * applied per instance by `ForestSpeciesRegistry` (`heightScale`, `trunkScale`,
 * `crownScale`), so geometry is generated per species, not per age — otherwise
 * every extra prototype would cost another pair of full-capacity InstancedMeshes.
 *
 * Output matches the `extractPrototypeParts` contract: parts tagged 'trunk' or
 * 'leaf', pivoted on the trunk base at y=0 and centred on XZ. Geometry is
 * de-indexed so merges succeed across primitive types and so crowns read as
 * hard-edged facets rather than smooth blobs.
 */

const CROWN_SEGMENTS = 0;
const TRUNK_RADIAL_SEGMENTS = 6;

function trunk({ height, baseRadius, topRadius, lean = 0 }) {
  const geometry = new THREE.CylinderGeometry(
    topRadius,
    baseRadius,
    height,
    TRUNK_RADIAL_SEGMENTS,
    1,
  );
  geometry.translate(0, height * 0.5, 0);
  if (lean !== 0) {
    geometry.rotateZ(lean);
  }
  return geometry;
}

/**
 * Root flare at the trunk base. `attachRootCollar` cannot be reused here: it
 * merges an indexed cylinder, and these prototypes are de-indexed for faceting,
 * so the merge would fail and the flare would be dropped.
 */
function rootFlare({ baseRadius }) {
  const radius = Math.max(0.16, baseRadius * 1.5);
  const height = Math.max(0.18, radius * 0.7);
  const geometry = new THREE.CylinderGeometry(
    baseRadius,
    radius,
    height,
    TRUNK_RADIAL_SEGMENTS + 1,
    1,
  );
  geometry.translate(0, height * 0.42, 0);
  return geometry;
}

/** Angled limb from the trunk toward a crown lobe, so crowns are not floating. */
function limb({ fromY, toX, toY, toZ, radius }) {
  const length = Math.hypot(toX, toY - fromY, toZ);
  const geometry = new THREE.CylinderGeometry(radius * 0.7, radius, length, 4, 1);
  geometry.translate(0, length * 0.5, 0);
  const direction = new THREE.Vector3(toX, toY - fromY, toZ).normalize();
  geometry.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
  );
  geometry.translate(0, fromY, 0);
  return geometry;
}

function crownLobe({ x, y, z, radiusX, radiusY, radiusZ }) {
  const geometry = new THREE.DodecahedronGeometry(0.5, CROWN_SEGMENTS);
  geometry.scale(radiusX * 2, radiusY * 2, radiusZ * 2);
  geometry.translate(x, y, z);
  return geometry;
}

/**
 * Lobes on a ring plus a crowning lobe. `flatten` < 1 gives the wide, shallow
 * tropical crown; `lift` raises the ring so tall species carry the mass high.
 */
function lobeCluster({
  speciesId,
  count,
  spread,
  centerY,
  radius,
  flatten,
  jitter,
}) {
  const lobes = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2
      + unitRandom(speciesId, 11 + index) * jitter;
    const ringRadius = spread * (0.68 + unitRandom(speciesId, 23 + index) * 0.42);
    const lobeRadius = radius * (0.74 + unitRandom(speciesId, 37 + index) * 0.44);
    lobes.push(crownLobe({
      x: Math.cos(angle) * ringRadius,
      y: centerY + (unitRandom(speciesId, 53 + index) - 0.5) * radius * 0.9,
      z: Math.sin(angle) * ringRadius,
      radiusX: lobeRadius,
      radiusY: lobeRadius * flatten,
      radiusZ: lobeRadius * (0.86 + unitRandom(speciesId, 71 + index) * 0.28),
    }));
  }
  lobes.push(crownLobe({
    x: 0,
    y: centerY + radius * flatten * 0.52,
    z: 0,
    radiusX: radius * 0.94,
    radiusY: radius * flatten * 0.94,
    radiusZ: radius * 0.94,
  }));
  return lobes;
}

const ARCHETYPES = Object.freeze({
  broadleaf_round: Object.freeze({
    trunkHeight: 3.6,
    trunkBase: 0.34,
    trunkTop: 0.22,
    crownCenter: 5.4,
    crownRadius: 2.5,
    crownSpread: 1.7,
    lobes: 5,
    flatten: 0.94,
    jitter: 0.5,
    limbRadius: 0.13,
  }),
  // Birch: slender, tall, high oval crown. Bark colour comes from the palette.
  broadleaf_tall: Object.freeze({
    trunkHeight: 6.4,
    trunkBase: 0.24,
    trunkTop: 0.13,
    crownCenter: 8.2,
    crownRadius: 2.0,
    crownSpread: 1.15,
    lobes: 4,
    flatten: 1.24,
    jitter: 0.42,
    limbRadius: 0.09,
  }),
  tropical_tall: Object.freeze({
    trunkHeight: 8.2,
    trunkBase: 0.3,
    trunkTop: 0.2,
    crownCenter: 9.6,
    crownRadius: 2.3,
    crownSpread: 2.5,
    lobes: 5,
    flatten: 0.62,
    jitter: 0.6,
    limbRadius: 0.11,
  }),
  wetland_sparse: Object.freeze({
    trunkHeight: 3.0,
    trunkBase: 0.4,
    trunkTop: 0.24,
    crownCenter: 4.4,
    crownRadius: 2.2,
    crownSpread: 2.1,
    lobes: 3,
    flatten: 0.78,
    jitter: 0.85,
    limbRadius: 0.14,
  }),
});

/** Species that reuse the baked GLB conifer prototypes instead of generated geometry. */
export const FOREST_GLB_CONIFER_SPECIES = Object.freeze([
  'conifer_narrow',
  'conifer_wide',
]);

export const FOREST_GENERATED_SPECIES = Object.freeze(Object.keys(ARCHETYPES));

export function createSpeciesPrototypeGeometry(speciesId) {
  const archetype = ARCHETYPES[speciesId];
  if (!archetype) {
    throw new Error(`No procedural archetype is defined for species "${speciesId}".`);
  }
  const lean = (unitRandom(speciesId, 3) - 0.5) * 0.08;
  const trunkParts = [
    trunk({
      height: archetype.trunkHeight,
      baseRadius: archetype.trunkBase,
      topRadius: archetype.trunkTop,
      lean,
    }),
    rootFlare({ baseRadius: archetype.trunkBase }),
  ];
  const lobes = lobeCluster({
    speciesId,
    count: archetype.lobes,
    spread: archetype.crownSpread,
    centerY: archetype.crownCenter,
    radius: archetype.crownRadius,
    flatten: archetype.flatten,
    jitter: archetype.jitter,
  });
  for (let index = 0; index < archetype.lobes; index += 1) {
    const lobe = lobes[index];
    lobe.computeBoundingBox();
    const center = lobe.boundingBox.getCenter(new THREE.Vector3());
    trunkParts.push(limb({
      fromY: archetype.trunkHeight * 0.72,
      toX: center.x,
      toY: center.y,
      toZ: center.z,
      radius: archetype.limbRadius,
    }));
  }

  const trunkGeometry = finalizeGeometry(mergeParts(trunkParts));
  const leafGeometry = finalizeGeometry(mergeParts(lobes));
  const bounds = trunkGeometry.boundingBox.clone().union(leafGeometry.boundingBox);
  return {
    speciesId,
    height: bounds.max.y - bounds.min.y,
    width: Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z),
    parts: [
      { geometry: trunkGeometry, kind: 'trunk' },
      { geometry: leafGeometry, kind: 'leaf' },
    ],
  };
}

export function createForestSpeciesPrototypeGeometry(
  speciesIds = FOREST_GENERATED_SPECIES,
) {
  return speciesIds.map((speciesId) => createSpeciesPrototypeGeometry(speciesId));
}

/**
 * Palette overrides so each species reads distinctly through the shared leaf and
 * trunk materials. `broadleaf_tall` is the reference image's white-trunked birch.
 */
export const FOREST_SPECIES_PALETTES = Object.freeze({
  broadleaf_round: Object.freeze({
    leafBottom: '#3f7a2c',
    leafTop: '#8fc63f',
    variationColor: '#2f6a34',
    barkTint: '#7a6244',
    barkTintStrength: 0.55,
    barkBrightness: 1.2,
  }),
  broadleaf_tall: Object.freeze({
    leafBottom: '#4c8a33',
    leafTop: '#a8d152',
    variationColor: '#3b7440',
    barkTint: '#e8e6dd',
    barkTintStrength: 0.88,
    barkBrightness: 1.45,
  }),
  tropical_tall: Object.freeze({
    leafBottom: '#256b2c',
    leafTop: '#63b23a',
    variationColor: '#1f5c33',
    barkTint: '#6f5c42',
    barkTintStrength: 0.5,
    barkBrightness: 1.15,
  }),
  wetland_sparse: Object.freeze({
    leafBottom: '#42632c',
    leafTop: '#87a24a',
    variationColor: '#3a5c3a',
    barkTint: '#5d5541',
    barkTintStrength: 0.6,
    barkBrightness: 1.05,
  }),
});

/**
 * Maps every species onto the prototype indices that can render it. Conifers use
 * the baked GLB range; generated broadleaf species use their own single
 * prototype. Species with no prototype fall back to the whole GLB range so a
 * misconfigured palette still renders something.
 */
export function createSpeciesPrototypeIndex({ glbPrototypeCount, generatedSpeciesIds }) {
  const glbRange = Array.from({ length: glbPrototypeCount }, (_, index) => index);
  const map = new Map();
  for (const speciesId of FOREST_GLB_CONIFER_SPECIES) {
    map.set(speciesId, glbRange);
  }
  generatedSpeciesIds.forEach((speciesId, offset) => {
    map.set(speciesId, [glbPrototypeCount + offset]);
  });
  return { map, fallback: glbRange };
}
