import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAR_TERRAIN_CONFIG_LIMITS,
  validateFarTerrainConfig,
} from '../src/config/validateFarTerrainConfig.js';

test('current far terrain grid is within validated resource bounds', () => {
  assert.doesNotThrow(() => validateFarTerrainConfig({
    enabled: true,
    radiusMeters: 60000,
    innerRadiusMeters: 256,
    radialResolution: 160,
    angularResolution: 256,
    radialFalloff: 2.2,
    rebuildRowsPerFrame: 24,
    snowLine: 26,
    rockSlopeStart: 0.18,
    rockSlopeFull: 0.62,
  }));
});

test('far terrain rejects non-finite shading inputs', () => {
  assert.throws(
    () => validateFarTerrainConfig({ snowLine: Number.NaN }),
    /snowLine must be finite/,
  );
  assert.throws(
    () => validateFarTerrainConfig({ rockSlopeStart: Number.NaN }),
    /rockSlopeStart must be finite/,
  );
  assert.throws(
    () => validateFarTerrainConfig({ rockSlopeStart: 0.5, rockSlopeFull: 0.4 }),
    /rockSlopeFull must exceed rockSlopeStart/,
  );
});

test('far terrain rejects grids large enough to exhaust renderer memory', () => {
  assert.throws(
    () => validateFarTerrainConfig({
      radialResolution: FAR_TERRAIN_CONFIG_LIMITS.maxRadialResolution,
      angularResolution: FAR_TERRAIN_CONFIG_LIMITS.maxAngularResolution,
    }),
    /grid must not exceed/,
  );
  assert.throws(
    () => validateFarTerrainConfig({ radialResolution: 100_000 }),
    /radialResolution must be an integer/,
  );
});
