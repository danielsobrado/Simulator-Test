import * as THREE from 'three';
import {
  finalizeGeometry,
  mergeParts,
  spherifyNormals,
  unitRandom,
} from './proceduralGeometry.js';

// Matches the tree crowns, so a shrub under a tree is lit on the same terms.
const BUSH_NORMAL_SPHERIFY = 0.85;

/**
 * Procedural understory prototypes: the rounded dome bushes and fern tufts that
 * fill glades and forest fringes. Built once at startup, never during a chunk
 * build, and ground-pivoted at y=0 like every other scatter prototype.
 *
 * Prototypes are unit-ish scale; per-instance size comes from the bush manifest's
 * `minScale`/`maxScale`, so one prototype covers a whole size range.
 */

function distortRadially(geometry, key, channel, amount) {
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    const jitter = 1 + (unitRandom(key, channel + index) - 0.5) * amount;
    positions.setXYZ(
      index,
      positions.getX(index) * jitter,
      positions.getY(index) * jitter,
      positions.getZ(index) * jitter,
    );
  }
  positions.needsUpdate = true;
  return geometry;
}

function shrubCore({
  key,
  channel,
  radius,
  flatten,
  offsetX,
  offsetZ,
  offsetY,
  detail = 1,
}) {
  const geometry = distortRadially(
    new THREE.IcosahedronGeometry(0.5, detail),
    key,
    channel,
    0.12,
  );
  const jitter = 0.92 + unitRandom(key, channel + 101) * 0.16;
  geometry.scale(
    radius * 2 * jitter,
    radius * 2 * flatten * jitter,
    radius * 2 * jitter * (0.9 + unitRandom(key, channel + 102) * 0.2),
  );
  geometry.translate(offsetX, offsetY, offsetZ);
  return geometry;
}

function foliageCluster({ key, channel, radius, position }) {
  const geometry = distortRadially(
    new THREE.IcosahedronGeometry(0.5, 0),
    key,
    channel,
    0.14,
  );
  geometry.scale(
    radius * (0.86 + unitRandom(key, channel + 41) * 0.3) * 2,
    radius * (0.72 + unitRandom(key, channel + 42) * 0.26) * 2,
    radius * (0.86 + unitRandom(key, channel + 43) * 0.3) * 2,
  );
  geometry.translate(position.x, position.y, position.z);
  return geometry;
}

function foliageClustersForLobe({ key, channel, lobe, count }) {
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    const sample = channel + index * 7;
    const angle = (
      index * Math.PI * (3 - Math.sqrt(5))
      + unitRandom(key, sample) * 0.55
    );
    // Keep most clusters on the upper and side silhouette. A few lower puffs
    // hide the core/terrain seam without producing a floating spherical bush.
    const elevation = -0.18 + unitRandom(key, sample + 1) * 1.03;
    const horizontal = Math.sqrt(Math.max(0, 1 - elevation * elevation));
    const shell = 0.74 + unitRandom(key, sample + 2) * 0.12;
    const clusterRadius = lobe.radius * (
      0.14 + unitRandom(key, sample + 3) * 0.09
    );
    parts.push(foliageCluster({
      key,
      channel: 700 + sample,
      radius: clusterRadius,
      position: {
        x: lobe.x + Math.cos(angle) * horizontal * lobe.radius * shell,
        y: lobe.y + elevation * lobe.radius * lobe.flatten * shell,
        z: lobe.z + Math.sin(angle) * horizontal * lobe.radius * shell,
      },
    }));
  }
  return parts;
}

/** Paired leafy mounds with fine outer clusters, matching a dense garden shrub. */
function pairedShrub({ key, lobes, clustersPerLobe }) {
  const parts = [];
  lobes.forEach((lobe, index) => {
    parts.push(shrubCore({
      key,
      channel: 41 + index * 211,
      radius: lobe.radius,
      flatten: lobe.flatten,
      offsetX: lobe.x,
      offsetZ: lobe.z,
      offsetY: lobe.y,
      detail: lobe.detail,
    }));
    parts.push(...foliageClustersForLobe({
      key,
      channel: 130 + index * 307,
      lobe,
      count: clustersPerLobe,
    }));
  });
  return parts;
}

/**
 * Fan of narrow tapered blades. Double-sided in the material, so two triangles
 * per blade are enough to read as a fern from player height.
 */
function fernBlade({ key, channel, length, width, angle, tilt }) {
  const halfWidth = width * 0.5;
  const positions = new Float32Array([
    -halfWidth, 0, 0,
    halfWidth, 0, 0,
    halfWidth * 0.34, length * 0.62, 0,
    -halfWidth, 0, 0,
    halfWidth * 0.34, length * 0.62, 0,
    -halfWidth * 0.34, length * 0.62, 0,
    -halfWidth * 0.34, length * 0.62, 0,
    halfWidth * 0.34, length * 0.62, 0,
    0, length, 0,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0, 1, 0, 1, 0.62,
    0, 0, 1, 0.62, 0, 0.62,
    0, 0.62, 1, 0.62, 0.5, 1,
  ]), 2));
  geometry.computeVertexNormals();
  geometry.rotateX(tilt * (0.7 + unitRandom(key, channel) * 0.6));
  geometry.rotateY(angle);
  return geometry;
}

function fernTuft({ key, blades, length, width, tilt }) {
  return Array.from({ length: blades }, (_, index) => fernBlade({
    key,
    channel: 83 + index,
    length: length * (0.7 + unitRandom(key, 97 + index) * 0.5),
    width,
    angle: (index / blades) * Math.PI * 2 + unitRandom(key, 103 + index) * 0.8,
    tilt,
  }));
}

const BUSH_ARCHETYPES = Object.freeze({
  bush_dome: Object.freeze({
    kind: 'shrub',
    clustersPerLobe: 12,
    lobes: Object.freeze([
      Object.freeze({
        radius: 0.49, flatten: 0.8, x: -0.3, y: 0.39, z: 0.05, detail: 2,
      }),
      Object.freeze({
        radius: 0.56, flatten: 0.79, x: 0.3, y: 0.45, z: -0.04, detail: 2,
      }),
    ]),
  }),
  bush_dome_small: Object.freeze({
    kind: 'shrub',
    clustersPerLobe: 10,
    lobes: Object.freeze([
      Object.freeze({ radius: 0.34, flatten: 0.82, x: -0.18, y: 0.28, z: 0.04 }),
      Object.freeze({ radius: 0.39, flatten: 0.78, x: 0.19, y: 0.32, z: -0.03 }),
    ]),
  }),
  bush_dome_wide: Object.freeze({
    kind: 'shrub',
    clustersPerLobe: 10,
    lobes: Object.freeze([
      Object.freeze({ radius: 0.48, flatten: 0.7, x: -0.34, y: 0.34, z: 0.04 }),
      Object.freeze({ radius: 0.52, flatten: 0.76, x: 0.08, y: 0.4, z: -0.08 }),
      Object.freeze({ radius: 0.42, flatten: 0.72, x: 0.45, y: 0.31, z: 0.08 }),
    ]),
  }),
  fern_tuft: Object.freeze({
    kind: 'fern',
    blades: 7,
    length: 0.72,
    width: 0.2,
    tilt: 0.44,
  }),
});

export const FOREST_BUSH_PROTOTYPES = Object.freeze([
  'bush_dome',
  'bush_dome_small',
  'bush_dome_wide',
]);

function addFoliageColorVariation(geometry, key) {
  geometry.computeBoundingBox();
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(positions.count * 3);
  const height = Math.max(
    Number.EPSILON,
    geometry.boundingBox.max.y - geometry.boundingBox.min.y,
  );
  for (let index = 0; index < positions.count; index += 1) {
    const normalizedHeight = (
      positions.getY(index) - geometry.boundingBox.min.y
    ) / height;
    const upwardLight = Math.max(0, normals.getY(index));
    const noise = (unitRandom(key, 4000 + index) - 0.5) * 0.12;
    const intensity = THREE.MathUtils.clamp(
      0.68 + normalizedHeight * 0.26 + upwardLight * 0.12 + noise,
      0.62,
      1.1,
    );
    colors[index * 3] = intensity * 0.94;
    colors[index * 3 + 1] = intensity * 1.04;
    colors[index * 3 + 2] = intensity * 0.95;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function createBushPrototypeGeometry(prototypeId) {
  const archetype = BUSH_ARCHETYPES[prototypeId];
  if (!archetype) {
    throw new Error(`No bush archetype is defined for "${prototypeId}".`);
  }
  const parts = archetype.kind === 'shrub'
    ? pairedShrub({
      key: prototypeId,
      lobes: archetype.lobes,
      clustersPerLobe: archetype.clustersPerLobe,
    })
    : fernTuft({
      key: prototypeId,
      blades: archetype.blades,
      length: archetype.length,
      width: archetype.width,
      tilt: archetype.tilt,
    });
  const geometry = finalizeGeometry(mergeParts(parts));
  // Ground the prototype so instances sit on the terrain rather than floating.
  geometry.translate(0, -geometry.boundingBox.min.y, 0);
  finalizeGeometry(geometry);
  // Shrubs are built from many small clusters, so flat face normals fragment them
  // worst of all. Ferns are flat blades whose normals already mean something, so
  // they keep theirs. Runs before the colour bake, which reads normals.
  if (archetype.kind === 'shrub') {
    spherifyNormals(geometry, { strength: BUSH_NORMAL_SPHERIFY });
  }
  addFoliageColorVariation(geometry, prototypeId);
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  return {
    prototypeId,
    doubleSided: archetype.kind === 'fern',
    height: size.y,
    width: Math.max(size.x, size.z),
    geometry,
  };
}

export function createForestBushPrototypeGeometry(
  prototypeIds = FOREST_BUSH_PROTOTYPES,
) {
  return prototypeIds.map((prototypeId) => createBushPrototypeGeometry(prototypeId));
}
