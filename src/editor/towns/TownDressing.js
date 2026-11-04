import { drainJob } from '../world/settlements/SettlementArrayJobs.js';
import { rect, rectHitsPolyline, rectsOverlap } from '../world/settlements/SettlementGeometry.js';
import { townHash as hash } from './townHash.js';
import { STONEHOLD_LANDMARKS } from './TownPrefabCatalog.js';

/**
 * Lived-in clutter round every house, and stone paving on town streets.
 *
 * The planner leaves generous plots; Skyrim's holds feel dense because every
 * gap is full — barrels by the door, a woodpile down the side, a fenced kitchen
 * garden behind. Each candidate is tested against every building, street and
 * piece already placed, so dressing never blocks a door or a road. Output is
 * plan-space props ({ kind, variant, x, z, yaw }) for TownLayout, so dressing
 * shares the prop clusters and colliders. Pure and deterministic.
 */

const PAVING_STEP = 1.9;
const YARD_DEPTH = 3.6;

class Occupancy {
  constructor(streets) {
    this.streets = streets.filter((street) => street.points?.length > 1);
    this.boxes = [];
  }

  claim(box) {
    this.boxes.push(box);
  }

  fits(box) {
    if (this.boxes.some((other) => rectsOverlap(box, other, 0.15))) return false;
    return !this.streets.some((street) => rectHitsPolyline(box, street.points, street.width / 2, 0.2));
  }
}

/** A point in a building's frame (local +z = front) carried to plan space. */
function toPlan(building, lx, lz) {
  const cos = Math.cos(building.yaw);
  const sin = Math.sin(building.yaw);
  return [building.x + lx * cos + lz * sin, building.z - lx * sin + lz * cos];
}

function tryProp(occupancy, out, building, prop) {
  const [x, z] = toPlan(building, prop.lx, prop.lz);
  const box = rect(x, z, prop.w, prop.d, building.yaw + prop.turn);
  if (!occupancy.fits(box)) return false;
  occupancy.claim(box);
  out.push({ kind: prop.kind, variant: prop.variant ?? 0, x, z, yaw: building.yaw + prop.turn });
  return true;
}

function yardFence(occupancy, out, building, size) {
  const [w, d] = size;
  const centre = [0, -d / 2 - YARD_DEPTH / 2 - 0.5];
  const [x, z] = toPlan(building, ...centre);
  const yard = rect(x, z, w + 1, YARD_DEPTH, building.yaw);
  if (!occupancy.fits(yard)) return;
  occupancy.claim(yard);
  const back = -d / 2 - YARD_DEPTH - 0.5;
  const half = (w + 1) / 2;
  for (let lx = -half + 2; lx <= half - 2 + 1e-6; lx += 4) {
    const [fx, fz] = toPlan(building, lx, back);
    out.push({ kind: 'fence', variant: 0, x: fx, z: fz, yaw: building.yaw });
  }
  for (const side of [-1, 1]) {
    const [fx, fz] = toPlan(building, side * half, -d / 2 - 0.5 - YARD_DEPTH / 2);
    out.push({ kind: 'fence', variant: 0, x: fx, z: fz, yaw: building.yaw + Math.PI / 2 });
  }
  const [bx, bz] = toPlan(building, half - 1.2, back + 1.2);
  out.push({ kind: 'bush', variant: 0, x: bx, z: bz, yaw: 0 });
}

/**
 * What the frontier and mountain families keep round a house, in the house's frame (front +z):
 * winter wood, curing racks, clan banners, street fire and a tree or rock behind, so a town reads
 * as lived in and set in its land (the hill-fort reference) instead of a lowland street.
 */
const REGIONAL_DRESSING = Object.freeze({
  Orc: (beside, w, d, roll) => [
    { kind: 'woodpile', lx: beside(1, 1.2), lz: -0.4, w: 1.3, d: 1.2, turn: Math.PI / 2 },
    { kind: 'drying_rack', lx: beside(-1, 2.4), lz: -0.6, w: 2.4, d: 1.2, turn: Math.PI / 2 },
    { kind: 'war_banner', lx: w / 2 - 0.3, lz: d / 2 + 1.0, w: 0.6, d: 0.6, turn: 0 },
    { kind: 'barrels', variant: roll(1) < 0.5 ? 0 : 1, lx: beside(-1, 1.4), lz: d / 2 - 0.9, w: 1.4, d: 1.4, turn: 0 },
    { kind: 'fire_post', lx: -w / 2 + 0.3, lz: d / 2 + 0.7, w: 0.5, d: 0.5, turn: 0 },
    { kind: 'tree', variant: roll(2) < 0.7 ? 0 : 1, lx: beside(1, 2.0), lz: -d / 2 - 1.6, w: 2.0, d: 2.0, turn: 0 },
  ],
  Frostgard: (beside, w, d, roll) => [
    { kind: 'woodpile', lx: beside(1, 1.2), lz: -0.4, w: 1.3, d: 1.2, turn: Math.PI / 2 },
    { kind: 'supply_sled', lx: beside(1, 1.4), lz: d / 2 - 0.7, w: 1.4, d: 2.0, turn: 0 },
    { kind: 'drying_rack', lx: beside(-1, 2.4), lz: -0.6, w: 2.4, d: 1.2, turn: Math.PI / 2 },
    { kind: 'boulders', lx: beside(-1, 2.0), lz: d / 2 - 0.4, w: 2.0, d: 1.6, turn: roll(3) * Math.PI },
    { kind: 'pine', variant: roll(2) < 0.6 ? 0 : 1, lx: beside(-1, 2.0), lz: -d / 2 - 1.6, w: 2.0, d: 2.0, turn: 0 },
    { kind: 'pine', variant: 0, lx: beside(1, 2.0), lz: -d / 2 - 2.2, w: 2.0, d: 2.0, turn: 0 },
  ],
  Stonehold: (beside, w, d, roll) => [
    { kind: 'cargo', lx: beside(1, 1.7), lz: -0.2, w: 1.7, d: 1.4, turn: 0.2 },
    { kind: 'brazier_pillar', lx: -w / 2 + 0.4, lz: d / 2 + 1.0, w: 0.8, d: 0.8, turn: 0 },
    { kind: 'boulders', lx: beside(1, 2.0), lz: -d / 2 - 1.4, w: 2.0, d: 1.6, turn: roll(3) * Math.PI },
  ],
});
/** Workshops of these families get an ore crane or a curing rack in the yard. */
const YARD_WORK = Object.freeze({ Stonehold: 'ore_crane', Orc: 'drying_rack', Frostgard: 'drying_rack' });

/**
 * @param {object} options
 * @param {object} options.plan settlement plan
 * @param {number} options.seed per-town seed
 * @param {Array<{building:object, size:number[], family?:string}>} options.placed buildings with their prefab footprint
 */
export function planDressing(options) { return drainJob(planDressingJob(options)); }
export function* planDressingJob({ plan, seed, placed, family = null }) {
  const townStyleKey = plan.profile?.kitStyleKey ?? plan.profile?.style?.key;
  const isTownGoblin = family === 'Goblin' || ['timber-thatch', 'swamp-thatch', 'goblin'].includes(townStyleKey);
  const occupancy = new Occupancy(plan.streets ?? []);
  for (const { building, size } of placed) {
    occupancy.claim(rect(building.x, building.z, size[0] + 0.6, size[1] + 0.6, building.yaw));
  }
  for (const prop of plan.props ?? []) occupancy.claim(rect(prop.x, prop.z, 1.6, 1.6, prop.yaw ?? 0));
  const out = [];
  for (const [index, { building, size, family: buildingFamily }] of placed.entries()) {
    if (!['house', 'townhouse', 'shop', 'tavern', 'smithy', 'bakery', 'apothecary', 'farmhouse', 'warehouse',
      'chapel', 'keep', 'hall', 'guildhall', 'guardhouse', 'library']
      .includes(building.kind)) continue;
    const isGoblin = (buildingFamily || building.kitFamily) === 'Goblin'
      || (!buildingFamily && !building.kitFamily && isTownGoblin);
    const loreRealm = building.loreRealm ?? plan.profile?.identity?.loreRealm ?? null;
    const [w, d] = size;
    const roll = (salt) => hash(seed, index, salt);
    // Offsets clear the house's own 0.3 m claim plus the 0.15 m fit clearance.
    const beside = (side, width) => side * (w / 2 + 0.5 + width / 2);
    const regional = REGIONAL_DRESSING[buildingFamily || building.kitFamily];
    const candidates = regional && !isGoblin ? regional(beside, w, d, roll) : isGoblin ? [
      { kind: 'baskets', lx: beside(-1, 1.3), lz: d / 2 - 0.8, w: 1.3, d: 1.0, turn: 0 },
      { kind: 'cauldron', lx: beside(1, 1.5), lz: d / 2 - 0.5, w: 1.5, d: 1.5, turn: 0 },
      { kind: 'drying_rack', lx: beside(1, 2.4), lz: -0.4, w: 2.4, d: 1.2, turn: Math.PI / 2 },
      { kind: 'totem', lx: beside(-1, 0.8), lz: d / 2 + 0.6, w: 0.8, d: 0.8, turn: 0 },
      { kind: 'torch_pole', lx: w / 2 - 0.3, lz: d / 2 + 0.8, w: 0.6, d: 0.6, turn: 0 },
      { kind: 'barricade', lx: beside(-1, 2.0), lz: -d / 2 + 0.8, w: 2.0, d: 0.9, turn: 0.2 },
    ] : [
      { kind: 'barrels', variant: roll(1) < 0.5 ? 0 : 1, lx: beside(-1, 1.4), lz: d / 2 - 0.9, w: 1.4, d: 1.4, turn: 0 },
      { kind: loreRealm === 'umbrakor' ? 'brazier' : 'planter', lx: beside(1, 1.0), lz: d / 2 - 0.4, w: 1.0, d: 0.6, turn: 0 },
      { kind: loreRealm === 'stonehold' ? 'cargo' : 'woodpile', lx: beside(1, 1.2), lz: -0.4, w: 1.3, d: 1.2, turn: Math.PI / 2 },
      { kind: 'barrels', variant: 1, lx: beside(-1, 1.0), lz: -d / 2 + 0.8, w: 1.0, d: 1.0, turn: 0.3 },
      { kind: loreRealm === 'umbrakor' ? 'shrine' : loreRealm === 'stonehold' ? 'ward_pillar' : 'bush', lx: beside(-1, 1.4), lz: 0.3, w: 1.4, d: 1.4, turn: 0 },
    ];
    const yardWork = YARD_WORK[buildingFamily || building.kitFamily];
    if (yardWork && ['smithy', 'warehouse'].includes(building.kind)) {
      candidates.push({ kind: yardWork, lx: beside(-1, 2.4), lz: -d / 2 - 1.6, w: 2.4, d: 2.4, turn: 0 });
    }
    if ((buildingFamily || building.kitFamily) === 'Stonehold') {
      candidates.push(
        { kind: 'ward_pillar', lx: w / 2 - 0.4, lz: d / 2 + 1.1, w: 1.4, d: 1.4, turn: 0 },
        { kind: 'mine_cart', lx: beside(-1, 1.4), lz: 0.2, w: 1.4, d: 2.2, turn: 0 },
        { kind: 'mine_vent_stack', lx: beside(1, 2.4), lz: -d / 2 - 1.6, w: 2.4, d: 2.3, turn: 0 },
      );
    }
    if (building.kind === 'smithy') {
      const isStonehold = (buildingFamily || building.kitFamily) === 'Stonehold' || loreRealm === 'stonehold';
      candidates.push(
        { kind: 'grindstone', lx: beside(1, 1.0), lz: d / 2 - 0.8, w: 1.0, d: 0.8, turn: 0 },
        { kind: isStonehold ? 'smelter_stack' : 'armorer_stand', lx: beside(-1, 2.0), lz: d / 2 - 0.4, w: 2.0, d: 1.4, turn: 0 },
      );
    } else if (building.kind === 'bakery') {
      candidates.push({ kind: 'bake_oven', lx: beside(1, 1.9), lz: d / 2 - 0.4, w: 1.9, d: 1.6, turn: 0 });
    } else if (building.kind === 'apothecary') {
      candidates.push({ kind: 'alchemist_stall', lx: beside(1, 2.2), lz: d / 2 - 0.3, w: 2.2, d: 1.5, turn: 0 });
    } else if (building.kind === 'tavern') {
      candidates.push(
        { kind: 'tavern_tables', lx: beside(1, 1.8), lz: d / 2 + 0.4, w: 1.8, d: 1.6, turn: 0 },
        { kind: 'trough', lx: beside(1, 1.8), lz: d / 2 - 0.6, w: 1.8, d: 0.8, turn: 0 },
        { kind: 'notice_board', lx: beside(-1, 1.7), lz: d / 2 - 0.4, w: 1.7, d: 0.6, turn: 0 },
        { kind: 'brazier', lx: w / 2 - 0.4, lz: d / 2 + 0.9, w: 0.8, d: 0.8, turn: 0 },
      );
    } else if (building.kind === 'chapel') {
      candidates.push(
        { kind: 'statue', lx: beside(1, 2.1), lz: d / 2 + 0.4, w: 2.1, d: 2.1, turn: 0 },
        { kind: 'shrine', lx: beside(-1, 1.3), lz: d / 2 - 0.6, w: 1.3, d: 1.2, turn: 0 },
        { kind: 'brazier', lx: -1.4, lz: d / 2 + 0.9, w: 0.8, d: 0.8, turn: 0 },
        { kind: 'brazier', lx: 1.4, lz: d / 2 + 0.9, w: 0.8, d: 0.8, turn: 0 },
      );
    } else if (['keep', 'hall', 'guildhall', 'guardhouse'].includes(building.kind)) {
      candidates.push(
        { kind: 'guard_post', lx: beside(-1, 2.0), lz: d / 2 - 0.3, w: 2.0, d: 1.3, turn: 0 },
        { kind: 'brazier', lx: -1.4, lz: d / 2 + 0.9, w: 0.8, d: 0.8, turn: 0 },
        { kind: 'brazier', lx: 1.4, lz: d / 2 + 0.9, w: 0.8, d: 0.8, turn: 0 },
        { kind: 'notice_board', lx: beside(1, 1.7), lz: d / 2 - 0.5, w: 1.7, d: 0.6, turn: 0 },
      );
    } else if (['warehouse', 'shop'].includes(building.kind)) {
      candidates.push({ kind: 'cargo', lx: beside(1, 1.7), lz: -0.2, w: 1.7, d: 1.4, turn: 0.2 });
    }
    for (const [salt, candidate] of candidates.entries()) {
      if (roll(10 + salt) < 0.62) tryProp(occupancy, out, building, candidate);
    }
    if (!isGoblin && loreRealm !== 'umbrakor' && (buildingFamily || building.kitFamily) !== 'Stonehold'
      && !['chapel', 'keep', 'guardhouse'].includes(building.kind) && roll(20) < 0.55) {
      yardFence(occupancy, out, building, size);
    }
    yield;
  }
  // For Stonehold / Dwarven settlements, roof the inner city (core + mid zones) inside a
  // hollow mountain cavern massif, leaving only the small outer edge buildings outside.
  const isStoneholdTown = family === 'Stonehold' || plan.profile?.identity?.loreRealm === 'stonehold';
  if (isStoneholdTown) {
    // Inhabited formations belong outside the street grid, with room for their cliffs.
    const count = (plan.profile?.rank ?? 0) >= 2 ? 4 : 2;
    for (let i = 0; i < 8 && out.filter(prop => prop.kind.startsWith('stonehold_')).length < count; i += 1) {
      const landmark = STONEHOLD_LANDMARKS[Math.floor(hash(seed, i, 941) * STONEHOLD_LANDMARKS.length)];
      const angle = (i + 0.5) * Math.PI / 4;
      const radius = (plan.profile?.radius ?? 48) + Math.hypot(landmark.w, landmark.d) / 2 + 8;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const box = rect(x, z, landmark.w, landmark.d, angle + Math.PI);
      if (occupancy.fits(box)) {
        occupancy.claim(box);
        out.push({ kind: landmark.kind, variant: landmark.variant, x, z, yaw: angle + Math.PI });
      }
      yield;
    }
  }
  if (isStoneholdTown && (plan.profile?.rank ?? 0) >= 1) {
    const mountainRadius = (plan.profile?.radius ?? 48) * 0.68;
    for (let x = -mountainRadius * 0.75; x <= mountainRadius * 0.75; x += 11.2) {
      for (let z = -mountainRadius * 0.75; z <= mountainRadius * 0.75; z += 9.4) {
        if (Math.hypot(x, z) <= mountainRadius * 0.85) {
          out.push({ kind: 'mountain_vault', variant: 0, x, z, yaw: 0 });
        }
      }
    }
    const ringSteps = Math.max(12, Math.round((2 * Math.PI * mountainRadius) / 7.8));
    for (let i = 0; i < ringSteps; i += 1) {
      const angle = (2 * Math.PI * i) / ringSteps;
      const rx = Math.sin(angle) * mountainRadius;
      const rz = Math.cos(angle) * mountainRadius;
      const isGateSlot = i === 0;
      out.push({
        kind: isGateSlot ? 'mountain_gate' : 'mountain_cliff',
        variant: 0,
        x: rx,
        z: rz,
        yaw: angle,
      });
    }
  }
  return out;
}

/** Paving tiles (2 m) along a town's streets and over its square, as plan-space placements. */
export function planPaving(plan) { return drainJob(planPavingJob(plan)); }
export function* planPavingJob(plan) {
  const tiles = [];
  const rank = plan.profile?.rank ?? 0;
  if (rank < 1) return tiles;
  for (const street of plan.streets ?? []) {
    if (street.kind === 'walk' && rank < 2) continue;
    const across = Math.max(1, Math.ceil(street.width / 2));
    for (let i = 1; i < street.points.length; i += 1) {
      const [ax, az] = street.points[i - 1];
      const [bx, bz] = street.points[i];
      const length = Math.hypot(bx - ax, bz - az);
      if (length < 0.1) continue;
      const yaw = Math.atan2(bx - ax, bz - az);
      const nx = Math.cos(yaw);
      const nz = -Math.sin(yaw);
      for (let s = 0; s < length; s += PAVING_STEP) {
        const t = s / length;
        for (let k = 0; k < across; k += 1) {
          const offset = (k - (across - 1) / 2) * 2;
          tiles.push({ x: ax + (bx - ax) * t + nx * offset, z: az + (bz - az) * t + nz * offset, yaw });
          if (tiles.length % 32 === 0) yield;
        }
      }
    }
  }
  for (const square of plan.squares ?? []) {
    const { radius } = square;
    for (let x = -radius; x <= radius; x += 2) {
      for (let z = -radius; z <= radius; z += 2) {
        if (Math.hypot(x, z) <= radius - 0.5) tiles.push({ x: square.x + x, z: square.z + z, yaw: 0 });
        if (tiles.length % 32 === 0) yield;
      }
    }
  }
  return tiles;
}
