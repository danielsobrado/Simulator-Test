import { PerfCounters } from './PerfCounters.js';

const MAX_CANDIDATES = 20_000;

function candidateGrid({ target, footprint }) {
  const columns = Math.ceil(Math.sqrt(target));
  const spacingX = footprint.width + 2;
  const spacingZ = footprint.depth + 3;
  const extent = Math.max(columns * 3, 24);
  const candidates = [];
  for (let ring = 1; ring <= extent && candidates.length < MAX_CANDIDATES; ring += 1) {
    for (let x = -ring; x <= ring; x += 1) {
      for (const z of [-ring, ring]) {
        candidates.push({ x: x * spacingX, z: z * spacingZ });
      }
    }
    for (let z = -ring + 1; z < ring; z += 1) {
      for (const x of [-ring, ring]) {
        candidates.push({ x: x * spacingX, z: z * spacingZ });
      }
    }
  }
  return candidates;
}

/**
 * Builds an in-memory-only deterministic masonry town for the performance
 * harness. It deliberately does not enter the campaign document or issue undo
 * commands; reloading the page restores the user's normal world.
 */
export function createObjectTownQaScene({
  target,
  proceduralAssetManager,
  objectMap,
  objectView,
}) {
  if (!Number.isInteger(target) || target < 1 || target > 256) {
    throw new Error('The object-town QA target must be an integer from 1 to 256.');
  }

  objectMap.clear();
  const record = proceduralAssetManager.create({
    label: 'QA Masonry Gatehouse',
    recipe: {
      archetype: 'gatehouse',
      style: 'granite',
      topStyle: 'slate',
      width: 8,
      depth: 3,
      height: 6,
      roofScale: 1.15,
      roofPitch: 42,
      detail: 3,
      seed: 0x51a7,
      weathering: 0.35,
      irregularity: 0.45,
      windows: true,
      ivy: false,
      remesh: true,
      albedo: true,
    },
  });
  const definition = objectMap.getDefinition(record.key);
  const candidates = candidateGrid({ target, footprint: definition.footprint });
  let placed = 0;
  let rejected = 0;
  for (const candidate of candidates) {
    if (placed >= target) break;
    if (Math.abs(candidate.x) <= definition.footprint.width
      && Math.abs(candidate.z) <= definition.footprint.depth) {
      continue;
    }
    const placement = {
      definitionKey: record.key,
      x: candidate.x,
      z: candidate.z,
      rotation: placed % 4,
    };
    if (!objectMap.validatePlacement(placement).valid) {
      rejected += 1;
      continue;
    }
    objectMap.place(placement);
    placed += 1;
  }
  if (placed !== target) {
    throw new Error(
      `Object-town QA could place only ${placed} of ${target} buildings (${rejected} rejected).`,
    );
  }

  objectView.refreshAll();
  PerfCounters.set('objectQaTarget', target);
  PerfCounters.set('objectQaPlaced', placed);
  PerfCounters.set('objectQaRejectedCandidates', rejected);
  return Object.freeze({ definitionKey: record.key, target, placed, rejected });
}
