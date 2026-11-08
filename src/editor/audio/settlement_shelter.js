import { COLLISION_LAYERS } from '../collision/CollisionLayers.js';

/** Probes at the head and 0.6 m either side of it (storm plan §6.4). */
const PROBE_OFFSETS = Object.freeze([0, -0.6, 0.6]);
/** A roof further above the head than this does not shelter the ear. */
const ROOF_REACH = 6;
const PART_ID = /^settlement:([^:]+):b(\d+)\./;

/**
 * Share (0..1) of three head probes that stand inside a settlement building
 * and under its roof, from the settlement collision boxes: a house is its wall
 * boxes, so the probe is inside when it lies within the walls' joint
 * footprint, in the building's own frame, and below their tops.
 *
 * @param {{ collectCandidates: Function }} world CollisionWorld
 * @param {{ x: number, y: number, z: number, yaw: number }} head canonical metres
 */
export function roofedShare(world, head, out = []) {
  const reach = 8;
  const candidates = world.collectCandidates({
    minX: head.x - reach, maxX: head.x + reach,
    minY: head.y - 4, maxY: head.y + ROOF_REACH,
    minZ: head.z - reach, maxZ: head.z + reach,
  }, COLLISION_LAYERS.solid, out);
  const buildings = new Map();
  for (const collider of candidates) {
    const match = PART_ID.exec(collider.sourceId);
    if (!match || !collider.position || !collider.dimensions) continue;
    const key = `${match[1]}:${match[2]}`;
    const parts = buildings.get(key) ?? [];
    parts.push(collider);
    buildings.set(key, parts);
  }
  if (!buildings.size) return 0;
  // Right of the listener: heading yaw faces (-sin, -cos).
  const rightX = Math.cos(head.yaw);
  const rightZ = -Math.sin(head.yaw);
  let hits = 0;
  for (const offset of PROBE_OFFSETS) {
    const x = head.x + rightX * offset;
    const z = head.z + rightZ * offset;
    for (const parts of buildings.values()) {
      if (insideBuilding(parts, x, head.y, z)) { hits += 1; break; }
    }
  }
  return hits / PROBE_OFFSETS.length;
}

/** Whether a point lies within the walls of one building and below their tops. */
export function insideBuilding(parts, x, y, z) {
  const rotation = parts[0].rotationY ?? 0;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // Into the building frame: the inverse of the box's turn about Y.
  const local = (px, pz) => [px * cos - pz * sin, px * sin + pz * cos];
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let top = -Infinity; let bottom = Infinity;
  for (const part of parts) {
    const [cx, cz] = local(part.position[0], part.position[2]);
    const [width, height, depth] = part.dimensions;
    minX = Math.min(minX, cx - width / 2); maxX = Math.max(maxX, cx + width / 2);
    minZ = Math.min(minZ, cz - depth / 2); maxZ = Math.max(maxZ, cz + depth / 2);
    top = Math.max(top, part.position[1] + height / 2);
    bottom = Math.min(bottom, part.position[1] - height / 2);
  }
  const [px, pz] = local(x, z);
  return px > minX && px < maxX && pz > minZ && pz < maxZ && y > bottom && y < top + 1;
}
