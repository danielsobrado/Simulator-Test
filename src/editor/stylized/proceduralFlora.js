import * as THREE from 'three/webgpu';

/**
 * Procedural geometry for the small things that live on a shore — after
 * grass-test's beach scatter, starfish and coastal groundcover.
 *
 * The donor builds these in code rather than shipping them, and that is the whole
 * reason this port is worth doing: a starfish is ten triangles, a leaf is two, and
 * none of them needs an asset, an atlas, a texture or a residency entry. They ride
 * the ground-detail layer's existing instancing, so a shore costs one draw call per
 * prototype and nothing to load.
 *
 * Every shape here is authored at unit scale — a radius-1 footprint, or a
 * metre-long twig — and the layer's per-instance scale does the rest. Nothing
 * reads a random source: variation across instances comes from the placement's own
 * deterministic scale and rotation, so a chunk's shore is identical every rebuild.
 *
 * Triangle budgets, because these are meant to be placed in their hundreds: the
 * star is 10, the shell 16, the leaf 2, and a twig is 8 segments of a 5-sided tube.
 */

/** Deterministic small-twig geometry: a tube along a bent curve, as the donor's. */
export function createDriftwoodGeometry({ length = 2.4, radius = 0.055, bend = 0.18 } = {}) {
  const half = length / 2;
  // Bent along the ground only: lifting the middle by the bend arched the log a
  // hand's breadth over the sand, a stick floating between its two ends.
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-half, 0, 0),
    new THREE.Vector3(-half * 0.35, 0, bend),
    new THREE.Vector3(half * 0.35, 0, -bend * 0.6),
    new THREE.Vector3(half, 0, 0),
  ]);
  const geometry = new THREE.TubeGeometry(curve, 8, radius, 5, false);
  // Bedded a third of its thickness into the sand rather than balanced on it.
  geometry.translate(0, radius * 0.35, 0);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A five-armed starfish: a centre vertex fanning to ten alternating rim points.
 *
 * `ridge` lifts the centre, which is the donor's near variant; the flat one is
 * what it draws further out, where the ridge is under a pixel and the vertex it
 * costs is not worth carrying.
 */
export function createStarfishGeometry({ ridge = 0.22, arms = 5, tipRadius = 1, notchRadius = 0.42 } = {}) {
  const positions = [];
  const indices = [];
  positions.push(0, ridge, 0);
  for (let index = 0; index < arms * 2; index += 1) {
    const angle = (index / (arms * 2)) * Math.PI * 2;
    const radius = index % 2 === 0 ? tipRadius : notchRadius;
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  }
  // A fan rather than two faces per arm: one centre vertex serves every triangle,
  // and the star is drawn from above at walking distance where its underside is
  // never seen.
  for (let index = 0; index < arms * 2; index += 1) {
    indices.push(0, 1 + index, 1 + ((index + 1) % (arms * 2)));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A scallop: a domed fan with a raised hinge edge, two-sided by material. Reads as
 * a shell at pebble scale for a handful of triangles, which is the only scale it
 * is ever placed at.
 */
export function createShellGeometry({ segments = 8, radius = 1, dome = 0.3 } = {}) {
  const positions = [0, dome, 0];
  const indices = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    // The hinge is a straight edge rather than a point, so a fan from a straight
    // base out to the rim gives the scallop its shape without a second row.
    const angle = Math.PI * t;
    positions.push(Math.cos(angle) * radius, 0, -Math.sin(angle) * radius * 0.62);
  }
  for (let index = 0; index < segments; index += 1) {
    indices.push(0, 1 + index, 2 + index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A creeping coastal leaf: four vertices, two triangles, laid flat. The donor's
 * shape, and the reason the ground cover is affordable — the whole inland band is
 * one draw call of two-triangle leaves.
 */
export function createLeafGeometry({ length = 1, width = 0.42 } = {}) {
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const positions = [
    0, 0, -halfLength,
    halfWidth, 0, -halfLength * 0.15,
    0, 0, halfLength,
    -halfWidth, 0, -halfLength * 0.15,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A lily pad: a flat disc with a notch cut from one edge, which is the whole
 * silhouette. Placed on the surface rather than the bed, so it rides the water
 * clock rather than standing in it.
 */
export function createLilyPadGeometry({ segments = 12, radius = 1, notch = 0.32 } = {}) {
  const positions = [0, 0, 0];
  const indices = [];
  // The rim runs all the way round except across the notch, so the pad is an open
  // fan rather than a closed disc — the gap is what makes it a lily pad.
  for (let index = 0; index <= segments; index += 1) {
    const angle = notch * Math.PI + (index / segments) * (Math.PI * 2 - notch * Math.PI * 2);
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  }
  for (let index = 0; index < segments; index += 1) {
    indices.push(0, 1 + index, 2 + index);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A clump of upright blades, tapering from a common root — the donor's ribbon, and
 * the shape behind seagrass, kelp and the red algae tufts alike.
 *
 * Authored one metre tall whatever the species, so its vertical coordinate is the
 * blade's height fraction and the sway shader can read it directly; the caller
 * scales the geometry to the species' natural height. `blades` and `segments` set
 * the cost directly: `blades * segments * 2` triangles.
 */
export function createRibbonPlantGeometry({
  blades = 5,
  segments = 3,
  height = 1,
  width = 0.12,
  spread = 0.35,
  curve = 0.25,
} = {}) {
  const positions = [];
  const indices = [];
  for (let blade = 0; blade < blades; blade += 1) {
    const phase = (blade / blades) * Math.PI * 2;
    const leanX = Math.cos(phase) * spread;
    const leanZ = Math.sin(phase) * spread;
    // Blades shorten as they fan outward, which is what makes a clump read as a
    // plant rather than as a bundle of identical strips.
    const scale = 1 - 0.35 * (blade / Math.max(1, blades));
    const base = positions.length / 3;
    for (let row = 0; row <= segments; row += 1) {
      const t = row / segments;
      const y = t * height * scale;
      const halfWidth = (width * scale * (1 - t)) / 2;
      // The tip drifts with the lean, so a clump opens outward the way the donor's
      // ribbons do instead of standing as a vertical fan.
      const x = leanX * t * height * scale + curve * t * t;
      const z = leanZ * t * height * scale;
      positions.push(x - halfWidth, y, z, x + halfWidth, y, z);
    }
    for (let row = 0; row < segments; row += 1) {
      const left = base + row * 2;
      const right = left + 1;
      const nextLeft = left + 2;
      const nextRight = right + 2;
      indices.push(left, nextLeft, right, right, nextLeft, nextRight);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
