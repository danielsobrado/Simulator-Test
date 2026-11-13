import * as THREE from 'three';
import { unitRandom } from './proceduralGeometry.js';

/**
 * Buttress roots grown onto an authored trunk at load, so a bole spreads into the
 * ground instead of standing on it. Sized from the trunk itself: authored stems run
 * from a few centimetres to over a metre, so no one radius suits a whole pool.
 * Each root is a fin, 72 triangles: tall and thin where it leaves the bole, flat
 * where it creeps into the soil. Built once per prototype, never during a chunk build.
 */
const ROOT_RINGS = 8;
const ROOT_SIDES = 8;
const MIN_STEM_RADIUS = 0.06;

/**
 * How a species meets the ground, in stem radii. Conifers spread shallow roots
 * from a strongly swollen foot; broadleaves raise buttresses; wetland and
 * tropical giants stand on tall plank fins.
 */
export const ROOT_PROFILES = Object.freeze({
  conifer: Object.freeze({ count: [4, 5], rise: [1, 1.5], reach: [2, 3], thickness: [0.45, 0.6], swell: 0.4 }),
  broadleaf: Object.freeze({ count: [5, 7], rise: [2, 3], reach: [3, 5], thickness: [0.55, 0.75], swell: 0.6 }),
  buttress: Object.freeze({ count: [4, 6], rise: [3.2, 4.4], reach: [4, 6], thickness: [0.45, 0.6], swell: 0.7 }),
});

const lerp = ([low, high], t) => low + (high - low) * t;

/** Where the mesh's edges cross the plane y = level, as [x, z] pairs. */
function sliceAt(geometry, level) {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const count = index ? index.count : position.count;
  const vertex = (corner) => (index ? index.getX(corner) : corner);
  const points = [];
  for (let corner = 0; corner + 2 < count; corner += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = vertex(corner + edge);
      const b = vertex(corner + ((edge + 1) % 3));
      const ya = position.getY(a);
      const yb = position.getY(b);
      if ((ya < level) === (yb < level)) continue;
      const t = (level - ya) / (yb - ya);
      points.push([
        position.getX(a) + (position.getX(b) - position.getX(a)) * t,
        position.getZ(a) + (position.getZ(b) - position.getZ(a)) * t,
      ]);
    }
  }
  return points;
}

/** Centre and median radius of a cross-section, with limbs well outside dropped. */
function sectionRing(points) {
  if (points.length < 3) return null;
  const centre = (set) => [
    set.reduce((sum, [x]) => sum + x, 0) / set.length,
    set.reduce((sum, [, z]) => sum + z, 0) / set.length,
  ];
  const median = (set, [x, z]) => {
    const radii = set.map(([px, pz]) => Math.hypot(px - x, pz - z)).sort((a, b) => a - b);
    return radii[Math.floor(radii.length / 2)];
  };
  const first = centre(points);
  const limit = median(points, first) * 2;
  const stem = points.filter(([x, z]) => Math.hypot(x - first[0], z - first[1]) <= limit);
  if (stem.length < 3) return null;
  const [x, z] = centre(stem);
  return { x, z, radius: median(stem, [x, z]) };
}

function detectAuthoredRoots(geometry, position, best, footX, footZ, minY, height) {
  if (position.count < 80) return false;
  const footBand = minY + Math.min(1.5, height * 0.10);
  const sectorMax = new Float64Array(8);
  let maxFootR = 0;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    if (y > footBand) continue;
    const dx = position.getX(i) - footX;
    const dz = position.getZ(i) - footZ;
    const r = Math.hypot(dx, dz);
    if (r > best.radius * 8) continue;
    if (r > maxFootR) maxFootR = r;
    const angle = Math.atan2(dz, dx);
    const bucket = ((Math.floor(((angle + Math.PI) / (Math.PI * 2)) * 8) % 8) + 8) % 8;
    if (r > sectorMax[bucket]) sectorMax[bucket] = r;
  }
  const activeSectors = [...sectorMax].filter((r) => r > 1e-4);
  if (activeSectors.length >= 4) {
    const minSectorR = Math.min(...activeSectors);
    if (maxFootR > best.radius * 1.25 && maxFootR > minSectorR * 1.14) {
      return true;
    }
  }
  if (maxFootR > best.radius * 1.18) {
    const ring16 = sectionRing(sliceAt(geometry, minY + height * 0.16));
    const ring45 = sectionRing(sliceAt(geometry, minY + height * 0.45));
    if (ring16 && ring45 && ring45.radius > 1e-4 && ring16.radius / ring45.radius < 1.25) {
      return true;
    }
  }
  return false;
}

/**
 * Axis and radius of the stem, or null if it has none. Measured on cross-sections
 * of the surface, not its vertices: decimated authored stems carry only a handful
 * of vertices, unevenly placed, and a vertex band reads them lopsided. The slices
 * sit above any authored flare, and the narrowest is kept, so neither a wide foot
 * nor a fork is mistaken for the bole.
 */
export function measureStem(geometry) {
  const position = geometry.getAttribute('position');
  if (!position) return null;
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox.min.y;
  const height = geometry.boundingBox.max.y - minY;
  if (height <= 0.5) return null;
  const low = minY + Math.min(1.8, height * 0.12);
  const span = Math.min(0.9, height * 0.08);
  let best = null;
  for (const share of [0, 0.5, 1]) {
    const ring = sectionRing(sliceAt(geometry, low + span * share));
    if (ring && ring.radius >= MIN_STEM_RADIUS && (!best || ring.radius < best.radius)) best = ring;
  }
  const foot = sectionRing(sliceAt(geometry, minY + Math.min(0.25, height * 0.015)));
  // A sapling's bole can taper under the minimum by then: take it at its foot.
  if (!best) {
    if (foot && foot.radius >= MIN_STEM_RADIUS) best = foot;
  }
  if (!best) return null;
  const footX = foot ? foot.x : best.x;
  const footZ = foot ? foot.z : best.z;
  const hasAuthoredRoots = detectAuthoredRoots(geometry, position, best, footX, footZ, minY, height);
  return { ...best, footX, footZ, minY, height, hasAuthoredRoots };
}

function uvRange(geometry) {
  const uv = geometry.getAttribute('uv');
  if (!uv) return null;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let index = 0; index < Math.min(uv.count, 256); index += 1) {
    minU = Math.min(minU, uv.getX(index));
    maxU = Math.max(maxU, uv.getX(index));
    minV = Math.min(minV, uv.getY(index));
    maxV = Math.max(maxV, uv.getY(index));
  }
  return { minU, spanU: maxU - minU, minV, spanV: maxV - minV };
}

/** Compass headings of a tree's roots, stable for its seed. */
export function rootHeadings(seed, profile = ROOT_PROFILES.broadleaf) {
  const count = Math.round(lerp(profile.count, unitRandom(seed, 290)));
  return Array.from({ length: count }, (_, root) => (
    ((root + (unitRandom(seed, 300 + root * 7) - 0.5) * 0.6) / count) * Math.PI * 2
  ));
}

/**
 * @param {THREE.BufferGeometry} trunk the prototype's bark
 * @param {string} seed stable per prototype, so a tree's roots never change
 * @param {object} [options]
 * @param {object} [options.profile] one of ROOT_PROFILES
 * @param {number} [options.maxReach] metres from the stem axis a root may run
 * @param {object} [options.stem] measureStem(trunk), when the caller has it
 * @returns {THREE.BufferGeometry | null} in the trunk's frame, or null with no stem
 */
export function createTreeRootGeometry(trunk, seed, {
  profile = ROOT_PROFILES.broadleaf, maxReach = Infinity, stem = measureStem(trunk),
} = {}) {
  if (!stem) return null;
  const range = uvRange(trunk);
  // Bark density of the trunk, so a root's bark is the trunk's bark at its scale.
  const uPerMetre = range ? range.spanU / (Math.PI * 2 * stem.radius) : 0;
  const vPerMetre = range ? range.spanV / Math.max(stem.height, 0.001) : 0;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const footX = stem.footX ?? stem.x;
  const footZ = stem.footZ ?? stem.z;
  rootHeadings(seed, profile).forEach((angle, root) => {
    const channel = 300 + root * 7;
    const reach = Math.min(stem.radius * lerp(profile.reach, unitRandom(seed, channel + 1)), maxReach);
    const rise = stem.radius * lerp(profile.rise, unitRandom(seed, channel + 2));
    const thickness = stem.radius * lerp(profile.thickness, unitRandom(seed, channel + 3));
    const wander = (unitRandom(seed, channel + 4) - 0.5) * 0.8;
    const sink = thickness * 0.35;
    const first = positions.length / 3;
    let travelled = 0;
    let previous = null;
    for (let ring = 0; ring < ROOT_RINGS; ring += 1) {
      const t = ring / (ROOT_RINGS - 1);
      const heading = angle + wander * t * t;
      const out = stem.radius * 0.42 + reach * (t ** 1.12);
      const originX = footX + (stem.x - footX) * ((1 - t) ** 1.6);
      const originZ = footZ + (stem.z - footZ) * ((1 - t) ** 1.6);
      const cx = originX + Math.cos(heading) * out;
      const cz = originZ + Math.sin(heading) * out;
      // A fin from below the soil up to a crest that falls fast off the bole and
      // then creeps along the ground, so the root reads as rising out of the earth.
      const halfWidth = thickness * (1 - t * 0.72);
      // The tip dives into the soil, so a dip under it never shows it hanging.
      const dive = stem.radius * 0.6 * t * t;
      const crest = stem.minY + rise * ((1 - t) ** 1.75) + halfWidth * (1 - 0.5 * t) - dive;
      const floor = stem.minY - sink - dive;
      const cy = (crest + floor) / 2;
      const halfHeight = Math.max(0.005, (crest - floor) / 2);
      if (previous) travelled += Math.hypot(cx - previous[0], cy - previous[1], cz - previous[2]);
      previous = [cx, cy, cz];
      const perimeter = Math.PI * 2 * Math.sqrt((halfWidth ** 2 + halfHeight ** 2) / 2);
      const radialX = Math.cos(heading);
      const radialZ = Math.sin(heading);
      for (let side = 0; side < ROOT_SIDES; side += 1) {
        const around = (side / ROOT_SIDES) * Math.PI * 2;
        const across = Math.cos(around);
        const up = Math.sin(around);
        const sideX = -Math.sin(heading);
        const sideZ = Math.cos(heading);
        positions.push(cx + sideX * across * halfWidth, cy + up * halfHeight, cz + sideZ * across * halfWidth);
        // Blend cross-section ellipse normal with outward trunk radial normal so root shoulders
        // shade continuously with the trunk bark instead of catching flat sky-facing moss wedges.
        const nAcross = across / Math.max(halfWidth, 0.005);
        const nUp = (up * 0.48) / halfHeight;
        const nOut = (0.35 + 0.45 * (1 - t)) / Math.max(halfWidth, 0.005);
        const nx = sideX * nAcross + radialX * nOut;
        const ny = nUp;
        const nz = sideZ * nAcross + radialZ * nOut;
        const length = Math.hypot(nx, ny, nz) || 1;
        normals.push(nx / length, ny / length, nz / length);
        uvs.push(
          range ? range.minU + (side / ROOT_SIDES) * perimeter * uPerMetre : 0,
          range ? range.minV + travelled * vPerMetre : t,
        );
      }
    }
    for (let ring = 0; ring + 1 < ROOT_RINGS; ring += 1) {
      for (let side = 0; side < ROOT_SIDES; side += 1) {
        const next = (side + 1) % ROOT_SIDES;
        const a = first + ring * ROOT_SIDES + side;
        const b = first + ring * ROOT_SIDES + next;
        const c = a + ROOT_SIDES;
        const d = b + ROOT_SIDES;
        indices.push(a, b, c, b, d, c);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Swells the foot of the bole into flutes, one per root heading, so the roots
 * grow out of the trunk instead of being pushed into it. Edits the trunk in place.
 * Only the stem itself moves: vertices well off the axis (a low limb) stay put.
 */
export function swellTrunkBase(trunk, stem, headings, profile = ROOT_PROFILES.broadleaf) {
  const position = trunk.getAttribute('position');
  if (!position || headings.length === 0) return;
  const reachHeight = stem.radius * lerp(profile.rise, 0.5) * 1.2;
  const footX = stem.footX ?? stem.x;
  const footZ = stem.footZ ?? stem.z;
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    const h = (y - stem.minY) / reachHeight;
    if (h >= 1) continue;
    const hClamped = Math.max(0, h);
    const axisX = footX + (stem.x - footX) * hClamped;
    const axisZ = footZ + (stem.z - footZ) * hClamped;
    const dx = position.getX(index) - axisX;
    const dz = position.getZ(index) - axisZ;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-5 || distance > stem.radius * 2.5) continue;
    const theta = Math.atan2(dz, dx);
    let lobe = 0;
    for (const heading of headings) lobe = Math.max(lobe, Math.max(0, Math.cos(theta - heading)) ** 4);
    const scale = 1 + profile.swell * ((1 - hClamped) ** 2.6) * (0.45 + 0.55 * lobe);
    position.setX(index, axisX + dx * scale);
    position.setZ(index, axisZ + dz * scale);
  }
  position.needsUpdate = true;
  trunk.computeBoundingBox();
  trunk.computeBoundingSphere();
}
