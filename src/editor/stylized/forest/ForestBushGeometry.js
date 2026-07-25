import * as THREE from 'three';
import { finalizeGeometry, mergeParts, unitRandom } from './proceduralGeometry.js';

/**
 * Procedural understory prototypes: the rounded dome bushes and fern tufts that
 * fill glades and forest fringes. Built once at startup, never during a chunk
 * build, and ground-pivoted at y=0 like every other scatter prototype.
 *
 * Prototypes are unit-ish scale; per-instance size comes from the bush manifest's
 * `minScale`/`maxScale`, so one prototype covers a whole size range.
 */

function domeLobe({ key, channel, radius, flatten, offsetX, offsetZ, offsetY }) {
  const geometry = new THREE.DodecahedronGeometry(0.5, 0);
  const jitter = 0.82 + unitRandom(key, channel) * 0.36;
  geometry.scale(
    radius * 2 * jitter,
    radius * 2 * flatten * jitter,
    radius * 2 * jitter * (0.88 + unitRandom(key, channel + 1) * 0.24),
  );
  geometry.translate(offsetX, offsetY, offsetZ);
  return geometry;
}

/** Lumpy dome from overlapping flattened lobes — the reference's mound bushes. */
function domeBush({ key, lobes, radius, flatten }) {
  const parts = [];
  for (let index = 0; index < lobes; index += 1) {
    const angle = (index / lobes) * Math.PI * 2 + unitRandom(key, 5 + index) * 1.1;
    const ring = index === 0 ? 0 : radius * (0.28 + unitRandom(key, 17 + index) * 0.3);
    const lobeRadius = radius * (index === 0 ? 1 : 0.62 + unitRandom(key, 29 + index) * 0.3);
    parts.push(domeLobe({
      key,
      channel: 41 + index * 2,
      radius: lobeRadius,
      flatten,
      offsetX: Math.cos(angle) * ring,
      offsetZ: Math.sin(angle) * ring,
      // Lobes sink slightly so the dome reads as growing out of the ground.
      offsetY: lobeRadius * flatten * (0.72 + unitRandom(key, 61 + index) * 0.2),
    }));
  }
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
    kind: 'dome',
    lobes: 4,
    radius: 0.62,
    flatten: 0.68,
  }),
  bush_dome_small: Object.freeze({
    kind: 'dome',
    lobes: 2,
    radius: 0.34,
    flatten: 0.74,
  }),
  fern_tuft: Object.freeze({
    kind: 'fern',
    blades: 7,
    length: 0.72,
    width: 0.2,
    tilt: 0.44,
  }),
});

export const FOREST_BUSH_PROTOTYPES = Object.freeze(Object.keys(BUSH_ARCHETYPES));

export function createBushPrototypeGeometry(prototypeId) {
  const archetype = BUSH_ARCHETYPES[prototypeId];
  if (!archetype) {
    throw new Error(`No bush archetype is defined for "${prototypeId}".`);
  }
  const parts = archetype.kind === 'dome'
    ? domeBush({
      key: prototypeId,
      lobes: archetype.lobes,
      radius: archetype.radius,
      flatten: archetype.flatten,
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
