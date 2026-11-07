import assert from 'node:assert/strict';
import test from 'node:test';

import { AZGAAR_STANDARD_BIOMES } from '../src/editor/AzgaarBiomeCatalog.js';
import { encodeMacroField } from '../src/editor/import/MacroAtlasCodec.js';
import { AzgaarMacroWorldGenerator } from '../src/editor/world/AzgaarMacroWorldGenerator.js';
import {
  couloirHeight,
  crestNotchHeight,
  DEFAULT_MOUNTAIN_RIDGES,
  resolveMountainRidges,
  ridgeHeight,
  ridgedField,
  ridgeStrength,
  validateMountainRidges,
} from '../src/editor/world/MountainRidges.js';
import { validateImportConfig } from '../src/config/validateImportConfig.js';

test('the ridged field folds into crests and stays in range', () => {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < 4000; i += 1) {
    const value = ridgedField(i * 37.3, i * -11.9, 5);
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  assert.ok(low >= 0 && high <= 1, `${low}..${high}`);
  assert.ok(high - low > 0.5, 'crests and gullies, not a flat field');
  assert.equal(ridgedField(123.4, -567.8, 9), ridgedField(123.4, -567.8, 9));
});

test('ridges rise only on high ground, and continuously', () => {
  const ridges = DEFAULT_MOUNTAIN_RIDGES;
  assert.equal(ridgeHeight(500, 500, 1, 0.2, ridges), 0, 'foothills stay smooth');
  const peak = Array.from({ length: 64 }, (_, i) => Math.abs(ridgeHeight(i * 50, i * 31, 1, 0.9, ridges)));
  assert.ok(Math.max(...peak) > 20, 'high ground carries real relief');
  // One 2 m cell apart the ground moves a little, never a cliff step.
  for (let i = 0; i < 200; i += 1) {
    const x = 1_000_000 + i * 97;
    const step = Math.abs(ridgeHeight(x + 1, 400, 1, 0.9, ridges) - ridgeHeight(x, 400, 1, 0.9, ridges));
    assert.ok(step < 2.5, `step ${step} at ${x}`);
  }
});

test('ridges are an import setting that validates', () => {
  assert.equal(resolveMountainRidges(undefined), null);
  assert.deepEqual(resolveMountainRidges(true), DEFAULT_MOUNTAIN_RIDGES);
  assert.equal(resolveMountainRidges({ heightMeters: 40 }).heightMeters, 40);
  assert.throws(() => resolveMountainRidges({ startRelief: 0.7, fullRelief: 0.5 }), /startRelief < fullRelief/);
  assert.throws(
    () => validateImportConfig({ import: { azgaarAtlasLongEdge: 2000, azgaarRidges: { heightMeters: -1 } } }),
    /Invalid editor configuration/,
  );
});

test('a couloir cuts a steep high face and leaves lowland alone', () => {
  const ridges = DEFAULT_MOUNTAIN_RIDGES;
  // Below the relief gate the strength is zero, so a couloir must not move the
  // ground at all — that is what keeps lowland free of the extra noise.
  for (let i = 0; i < 200; i += 1) {
    assert.equal(couloirHeight(i * 31, i * 17, 3, 0.25, ridges), 0, `lowland at ${i}`);
  }
  let carved = 0;
  let nonZero = 0;
  for (let i = 0; i < 400; i += 1) {
    const value = Math.abs(couloirHeight(i * 41, i * -23, 7, 0.9, ridges));
    if (value > 0) nonZero += 1;
    carved = Math.max(carved, value);
  }
  assert.ok(carved > 1, `a couloir cuts a steep high face (${carved.toFixed(2)} m)`);
  assert.ok(nonZero > 200, 'chutes run down most of the flank, not one point');
});

test('a crest notch cuts down at the ridge line and not between ridges', () => {
  const ridges = DEFAULT_MOUNTAIN_RIDGES;
  const seed = 918273;
  let deepest = 0;
  let highest = 0;
  let between = 0;
  let crests = 0;
  for (let i = 0; i < 200; i += 1) {
    for (let j = 0; j < 200; j += 1) {
      const x = i * 9.7;
      const z = j * 12.3;
      const value = crestNotchHeight(x, z, seed, 0.9, ridges);
      const ridge = ridgedField(x, z, seed);
      if (ridge > 0.85) {
        deepest = Math.min(deepest, value);
        highest = Math.max(highest, value);
        crests += 1;
      } else if (ridge < 0.35) {
        between = Math.max(between, Math.abs(value));
      }
    }
  }
  assert.ok(crests > 100, 'sampled enough of the ridge line');
  assert.ok(deepest < -1, `a saddle cuts the ridge line (${deepest.toFixed(2)} m)`);
  assert.ok(highest > 1, 'pinnacles stand between the saddles');
  assert.equal(between, 0, 'nothing is cut between ridges');
});

test('couloirs and crest notches stay centred and are deterministic', () => {
  const ridges = DEFAULT_MOUNTAIN_RIDGES;
  const seed = 918273;
  let sumCouloir = 0;
  let sumNotch = 0;
  let peak = 0;
  let count = 0;
  for (let i = 0; i < 200; i += 1) {
    for (let j = 0; j < 200; j += 1) {
      const x = i * 9.7;
      const z = j * 12.3;
      const couloir = couloirHeight(x, z, seed, 0.9, ridges);
      const notch = crestNotchHeight(x, z, seed, 0.9, ridges);
      sumCouloir += couloir;
      sumNotch += notch;
      peak = Math.max(peak, Math.abs(couloir), Math.abs(notch));
      count += 1;
    }
  }
  assert.ok(peak > 1, 'the terms are real');
  // Centred: the mean over high ground is a small fraction of the relief, so
  // the terms add detail without lifting or dropping the range as a whole.
  assert.ok(Math.abs(sumCouloir / count) < peak * 0.05, `couloirs stay centred (${sumCouloir / count})`);
  assert.ok(Math.abs(sumNotch / count) < peak * 0.05, `notches stay centred (${sumNotch / count})`);
  // Deterministic: the same vertex always gets the same cut.
  for (let i = 0; i < 20; i += 1) {
    const x = i * 137.1;
    const z = i * -211.7;
    assert.equal(couloirHeight(x, z, 5, 0.9, ridges), couloirHeight(x, z, 5, 0.9, ridges));
    assert.equal(crestNotchHeight(x, z, 5, 0.9, ridges), crestNotchHeight(x, z, 5, 0.9, ridges));
  }
});

test('the couloir and crest-notch strengths rise monotonically', () => {
  const ridges = DEFAULT_MOUNTAIN_RIDGES;
  const seed = 918273;
  const grid = [];
  for (let i = 0; i < 40; i += 1) {
    for (let j = 0; j < 40; j += 1) grid.push([i * 57.3, j * 63.7]);
  }
  let lastStrength = -1;
  let lastCouloir = -1;
  let lastNotch = -1;
  // From below the gate to full strength, neither the gate nor either term may
  // fall back: relief can only add mountain detail, never remove it.
  for (const relief of [0.2, 0.35, 0.5, 0.65, 0.9]) {
    let maxCouloir = 0;
    let maxNotch = 0;
    for (const [x, z] of grid) {
      maxCouloir = Math.max(maxCouloir, Math.abs(couloirHeight(x, z, seed, relief, ridges)));
      maxNotch = Math.max(maxNotch, Math.abs(crestNotchHeight(x, z, seed, relief, ridges)));
    }
    const strength = ridgeStrength(relief, ridges);
    assert.ok(strength >= lastStrength, `ridge strength is monotonic at ${relief}`);
    assert.ok(maxCouloir >= lastCouloir, `couloirs grow with relief at ${relief}`);
    assert.ok(maxNotch >= lastNotch, `notches grow with relief at ${relief}`);
    lastStrength = strength;
    lastCouloir = maxCouloir;
    lastNotch = maxNotch;
  }
  // Depth is a straight scale, so a deeper setting cuts deeper.
  const [x, z] = grid.find(([px, pz]) => Math.abs(couloirHeight(px, pz, seed, 0.9, ridges)) > 0.5);
  assert.ok(x !== undefined, 'found a carved vertex');
  const shallow = { ...ridges, couloirMeters: 4 };
  const deep = { ...ridges, couloirMeters: 16 };
  assert.ok(
    Math.abs(couloirHeight(x, z, seed, 0.9, deep)) > Math.abs(couloirHeight(x, z, seed, 0.9, shallow)),
    'a deeper couloir cuts more',
  );
});

test('couloirs and crest notches are validated import settings', () => {
  assert.equal(resolveMountainRidges(true).couloirMeters, DEFAULT_MOUNTAIN_RIDGES.couloirMeters);
  assert.equal(resolveMountainRidges(true).notchMeters, DEFAULT_MOUNTAIN_RIDGES.notchMeters);
  // One key overridden leaves the other at its default.
  assert.equal(resolveMountainRidges({ couloirMeters: 0 }).notchMeters, DEFAULT_MOUNTAIN_RIDGES.notchMeters);
  assert.throws(() => resolveMountainRidges({ couloirMeters: -1 }), /couloirMeters/);
  assert.throws(() => resolveMountainRidges({ notchMeters: Number.NaN }), /notchMeters/);
  assert.throws(
    () => validateImportConfig({ import: { azgaarAtlasLongEdge: 2000, azgaarRidges: { couloirMeters: -2 } } }),
    /Invalid editor configuration/,
  );
  // A world imported before these terms existed carries no depths: it still
  // validates, and both terms stay off rather than changing its mountains.
  const legacy = { heightMeters: 90, startRelief: 0.3, fullRelief: 0.65 };
  assert.doesNotThrow(() => validateMountainRidges(legacy, 'legacy ridges'));
  assert.equal(couloirHeight(1200, 800, 1, 0.9, legacy), 0);
  assert.equal(crestNotchHeight(1200, 800, 1, 0.9, legacy), 0);
});

function createSource(ridges) {
  return {
    kind: 'azgaar-macro-v2',
    version: 2,
    atlas: {
      width: 2,
      height: 2,
      fields: {
        elevation: encodeMacroField(Uint8Array.of(95, 95, 95, 95), 'u8'),
        biomeId: encodeMacroField(Uint8Array.of(9, 9, 9, 9), 'u8'), // taiga: tundra and glacier carry alpine relief instead
        moisture: encodeMacroField(Uint8Array.of(128, 128, 128, 128), 'u8', { scale: 1 / 255 }),
      },
    },
    physical: { widthMeters: 8192, heightMeters: 8192 },
    bounds: { minCellX: 0, minCellZ: 0, widthCells: 4096, heightCells: 4096 },
    oceanTransitionCells: 1,
    terrain: {
      minHeight: -16,
      maxHeight: 48,
      seaLevel: -1.5,
      verticalExaggeration: 40,
      reliefExponent: 1.5,
      ...(ridges ? { ridges } : {}),
    },
    biomes: AZGAAR_STANDARD_BIOMES,
    rivers: [],
  };
}

const metadata = Object.freeze({ seed: 42, version: 1, heightScale: 12, seaLevel: -1.5 });

test('a world imported with ridges carries them near and far; one without is unchanged', () => {
  const smooth = new AzgaarMacroWorldGenerator(createSource(null), metadata);
  const ridged = new AzgaarMacroWorldGenerator(createSource(DEFAULT_MOUNTAIN_RIDGES), metadata);
  let largest = 0;
  for (let i = 0; i < 64; i += 1) {
    const x = 400 + i * 47;
    const z = 900 + i * 29;
    largest = Math.max(largest, Math.abs(ridged.sampleHeight(x, z) - smooth.sampleHeight(x, z)));
    const nearGap = ridged.sampleHeight(x, z) - smooth.sampleHeight(x, z);
    const farGap = ridged.sampleMacroColumn(x, z).height - smooth.sampleMacroColumn(x, z).height;
    assert.ok(Math.abs(nearGap - farGap) < 1e-9, 'the far backdrop carries the same crests');
  }
  assert.ok(largest > 10, `ridges change high ground (${largest} m)`);
  assert.throws(
    () => new AzgaarMacroWorldGenerator(createSource({ heightMeters: 90, startRelief: 0.5, fullRelief: 0.2 }), metadata),
    /terrain ridges/,
  );
});

test('couloirs and crest notches reach the far backdrop too', () => {
  // A world with the crests but neither new term, against the shipped defaults:
  // every metre of difference comes from the couloirs and notches alone.
  const blunt = new AzgaarMacroWorldGenerator(
    createSource({ ...DEFAULT_MOUNTAIN_RIDGES, couloirMeters: 0, notchMeters: 0 }),
    metadata,
  );
  const carved = new AzgaarMacroWorldGenerator(createSource(DEFAULT_MOUNTAIN_RIDGES), metadata);
  let largest = 0;
  for (let i = 0; i < 40; i += 1) {
    for (let j = 0; j < 40; j += 1) {
      const x = 300 + i * 137;
      const z = 700 + j * 91;
      const nearGap = carved.sampleHeight(x, z) - blunt.sampleHeight(x, z);
      const farGap = carved.sampleMacroColumn(x, z).height - blunt.sampleMacroColumn(x, z).height;
      assert.ok(Math.abs(nearGap - farGap) < 1e-9, 'the far backdrop carries the new terms too');
      largest = Math.max(largest, Math.abs(nearGap));
    }
  }
  assert.ok(largest > 1, `couloirs and notches change high ground (${largest.toFixed(2)} m)`);
});
