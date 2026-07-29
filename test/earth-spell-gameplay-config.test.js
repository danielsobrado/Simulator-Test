import assert from 'node:assert/strict';
import test from 'node:test';
import {
  earthSpellGameplayConfig,
  parseEarthSpellGameplayConfig,
} from '../src/editor/spells/earth_spell_gameplay_config.js';

test('generated spell defaults enable authoritative Earth terrain edits', () => {
  assert.deepEqual(earthSpellGameplayConfig, {
    enabled: true,
    operation: 'remove',
    shape: 'sphere',
    radiusM: 2.4,
    heightM: 2.4,
    strength: 0.72,
    falloff: 0.35,
    material: 0,
    maxRangeM: 10,
    commandExpiryMs: 3000,
    convergenceTimeoutMs: 5000,
  });
});

test('Earth gameplay parser clamps unsafe values and rejects unknown enums', () => {
  const parsed = parseEarthSpellGameplayConfig({
    spells: {
      earth: {
        gameplay: {
          terrain_edit_enabled: true,
          operation: 'erase-world',
          shape: 'capsule',
          radius_m: 999,
          height_m: -10,
          strength: 999,
          falloff: -1,
          material: 999,
          max_range_m: 999,
          command_expiry_ms: 1,
          convergence_timeout_ms: 999999,
        },
      },
    },
  });

  assert.equal(parsed.operation, 'remove');
  assert.equal(parsed.shape, 'sphere');
  assert.equal(parsed.radiusM, 32);
  assert.equal(parsed.heightM, 0.1);
  assert.equal(parsed.strength, 16);
  assert.equal(parsed.falloff, 0);
  assert.equal(parsed.material, 255);
  assert.equal(parsed.maxRangeM, 100);
  assert.equal(parsed.commandExpiryMs, 100);
  assert.equal(parsed.convergenceTimeoutMs, 30000);
});

test('invalid generated input falls back without throwing', () => {
  const fallback = Object.freeze({ ...earthSpellGameplayConfig, enabled: false });
  assert.equal(parseEarthSpellGameplayConfig('{', fallback), fallback);
});
