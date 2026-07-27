function freezeEntries(entries) {
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

export function createCollisionP0QaFixture({
  stepHeight = 1.1,
  maxSlopeDegrees = 50,
  chunkWorldSize = 128,
} = {}) {
  if (!(stepHeight > 0)) throw new Error('Collision QA stepHeight must be positive.');
  if (!(maxSlopeDegrees > 0 && maxSlopeDegrees < 90)) {
    throw new Error('Collision QA maxSlopeDegrees must be within (0, 90).');
  }
  if (!(chunkWorldSize > 0)) throw new Error('Collision QA chunkWorldSize must be positive.');

  const validSlopeDegrees = Math.max(5, Math.min(maxSlopeDegrees - 10, 35));
  const steepSlopeDegrees = Math.min(85, maxSlopeDegrees + 15);
  const boundaryX = chunkWorldSize;

  return Object.freeze({
    id: 'collision-p0',
    version: 1,
    coordinateSpace: 'canonical-world',
    entries: freezeEntries([
      { id: 'tree', kind: 'tree', x: 8, z: -8, radius: 0.65, height: 6 },
      { id: 'medium-rock', kind: 'rock', x: 15, z: -8, radius: 1.4, height: 1.5, walkable: false },
      { id: 'large-walkable-rock', kind: 'rock', x: 23, z: -8, radius: 3.2, height: 3.4, walkable: true },
      { id: 'wall-corner-x', kind: 'box', x: 8, z: -20, width: 10, depth: 0.8, height: 3 },
      { id: 'wall-corner-z', kind: 'box', x: 3.4, z: -15.4, width: 0.8, depth: 10, height: 3 },
      { id: 'doorway-left', kind: 'box', x: 16, z: -20, width: 2, depth: 0.8, height: 3 },
      { id: 'doorway-right', kind: 'box', x: 21, z: -20, width: 2, depth: 0.8, height: 3 },
      { id: 'doorway-header', kind: 'box', x: 18.5, z: -20, width: 3, depth: 0.8, height: 0.7, baseHeight: 2.3 },
      { id: 'low-step', kind: 'step', x: 29, z: -20, width: 3, depth: 3, height: stepHeight * 0.75 },
      { id: 'high-step', kind: 'step', x: 34, z: -20, width: 3, depth: 3, height: stepHeight * 1.25 },
      { id: 'valid-ramp', kind: 'ramp', x: 41, z: -20, width: 4, depth: 8, height: 3, slopeDegrees: validSlopeDegrees },
      { id: 'steep-ramp', kind: 'ramp', x: 49, z: -20, width: 4, depth: 5, height: 4, slopeDegrees: steepSlopeDegrees },
      {
        id: 'chunk-boundary-construction',
        kind: 'construction',
        x: boundaryX,
        z: -34,
        width: 8,
        depth: 0.8,
        height: 3.5,
        minX: boundaryX - 4,
        maxX: boundaryX + 4,
      },
    ]),
  });
}
