import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBiomePrototypeSelector,
  normalizeBiomePrototypeRule,
} from '../src/editor/stylized/BiomePrototypeSelector.js';

/** Stands in for RegionalCharacterField with a hand-placed district boundary. */
function characterField(channelsByX) {
  return {
    signature: 'test-field',
    sampleChannel(x, _z, channel) {
      const entry = x < 0 ? channelsByX.left : channelsByX.right;
      return entry[channel] ?? 0.28;
    },
  };
}

function histogram(select, args, samples = 2000) {
  const counts = new Map();
  for (let index = 0; index < samples; index += 1) {
    const chosen = select((index + 0.5) / samples, ...args);
    counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
  }
  return counts;
}

test('a biome only draws prototypes that claim it', () => {
  const select = createBiomePrototypeSelector({
    rules: [
      { tileIds: [4, 6] }, // meadow clump
      { tileIds: [1, 3] }, // dry blade
      { tileIds: [12] }, // reed
    ],
  });

  assert.deepEqual([...histogram(select, [4]).keys()], [0]);
  assert.deepEqual([...histogram(select, [3]).keys()], [1]);
  assert.deepEqual([...histogram(select, [12]).keys()], [2]);
});

test('an unclaimed prototype stays eligible everywhere', () => {
  const select = createBiomePrototypeSelector({
    rules: [{ tileIds: [4] }, {}],
  });
  assert.deepEqual([...histogram(select, [4]).keys()].sort(), [0, 1]);
  // Tile 9 is claimed by nobody in particular, so only the open rule applies.
  assert.deepEqual([...histogram(select, [9]).keys()], [1]);
});

test('a biome no rule claims falls back to the whole set rather than nothing', () => {
  // buildStableChunkManifest rejects an out-of-range index, so an unclaimed
  // biome must still resolve to something rather than throwing.
  const select = createBiomePrototypeSelector({
    rules: [{ tileIds: [4] }, { tileIds: [6] }],
  });
  const chosen = [...histogram(select, [10]).keys()].sort();
  assert.deepEqual(chosen, [0, 1]);
});

test('regional character shifts the mix inside one biome', () => {
  const field = characterField({
    left: { meadow: 0.95, scrub: 0.1 },
    right: { meadow: 0.1, scrub: 0.95 },
  });
  const select = createBiomePrototypeSelector({
    regionalCharacterField: field,
    rules: [
      { tileIds: [4], character: 'meadow', characterStrength: 2 },
      { tileIds: [4], character: 'scrub', characterStrength: 2 },
    ],
  });

  const meadowDistrict = histogram(select, [4, -100, 0]);
  const scrubDistrict = histogram(select, [4, 100, 0]);

  // Same biome, same rules, opposite mixes — this is what stops one biome
  // looking uniform across a map.
  assert.ok(meadowDistrict.get(0) > meadowDistrict.get(1) * 3);
  assert.ok(scrubDistrict.get(1) > scrubDistrict.get(0) * 3);
  // Neither is ever impossible: the floor keeps both reachable.
  assert.ok(meadowDistrict.get(1) > 0);
  assert.ok(scrubDistrict.get(0) > 0);
});

test('canopy preference separates a wood interior from its fringe', () => {
  const select = createBiomePrototypeSelector({
    rules: [
      { tileIds: [6], canopy: 'core' },
      { tileIds: [6], canopy: 'edge' },
      { tileIds: [6], canopy: 'open' },
    ],
  });

  const core = histogram(select, [6, 0, 0, { patchCoverage: 0.95, patchEdge: 0.05 }]);
  const fringe = histogram(select, [6, 0, 0, { patchCoverage: 0.6, patchEdge: 0.9 }]);
  const glade = histogram(select, [6, 0, 0, { patchCoverage: 0.02, patchEdge: 0.02 }]);

  assert.ok(core.get(0) > core.get(1));
  assert.ok(fringe.get(1) > fringe.get(0));
  assert.ok(glade.get(2) > glade.get(0));
});

test('a missing habitat leaves canopy rules inert instead of failing', () => {
  const select = createBiomePrototypeSelector({
    rules: [{ tileIds: [6], canopy: 'core' }, { tileIds: [6], canopy: 'open' }],
  });
  const counts = histogram(select, [6]);
  assert.deepEqual([...counts.keys()].sort(), [0, 1]);
});

test('selection is deterministic for the same roll', () => {
  const select = createBiomePrototypeSelector({
    rules: [{ tileIds: [4], weight: 3 }, { tileIds: [4], weight: 1 }],
  });
  for (const roll of [0, 0.25, 0.5, 0.7499, 0.75, 0.999]) {
    assert.equal(select(roll, 4), select(roll, 4));
  }
  // Weights partition the roll exactly as a cumulative table would.
  assert.equal(select(0.7499, 4), 0);
  assert.equal(select(0.75, 4), 1);
});

test('usesCanopy tells callers whether sampling the habitat field is worth it', () => {
  const plain = createBiomePrototypeSelector({ rules: [{ tileIds: [4] }, {}] });
  assert.equal(plain.usesCanopy, false);
  const canopied = createBiomePrototypeSelector({ rules: [{ canopy: 'core' }, {}] });
  assert.equal(canopied.usesCanopy, true);
});

test('rules reject unknown channels, unknown canopy values and bad weights', () => {
  assert.throws(() => normalizeBiomePrototypeRule({ character: 'swamp' }), /character channel/);
  assert.throws(() => normalizeBiomePrototypeRule({ canopy: 'underground' }), /canopy preference/);
  assert.throws(() => normalizeBiomePrototypeRule({ weight: -1 }), /must be positive/);
  assert.throws(() => createBiomePrototypeSelector({ rules: [] }), /at least one/);
});
