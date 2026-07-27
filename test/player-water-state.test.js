import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAYER_WATER_DRY,
  PLAYER_WATER_SUBMERGED,
  PLAYER_WATER_SWIMMING,
  PLAYER_WATER_WADING,
  resolvePlayerWaterState,
} from '../src/editor/player/PlayerWaterState.js';

const config = Object.freeze({
  wadeDepth: 0.7,
  swimDepth: 1.35,
  transitionHysteresis: 0.12,
});

function water(surfaceHeight = 2) {
  return { coverage: 1, surfaceHeight, bodyId: 7 };
}

test('water states use hysteresis at wade and swim thresholds', () => {
  const dry = resolvePlayerWaterState({
    waterSample: water(),
    eyeY: 3,
    eyeHeight: 1.7,
    config,
  });
  assert.equal(dry.waterState, PLAYER_WATER_DRY);

  const wading = resolvePlayerWaterState({
    previous: dry,
    waterSample: water(),
    eyeY: 2.7,
    eyeHeight: 1.7,
    config,
  });
  assert.equal(wading.waterState, PLAYER_WATER_WADING);

  const retainedWading = resolvePlayerWaterState({
    previous: wading,
    waterSample: water(),
    eyeY: 2.84,
    eyeHeight: 1.7,
    config,
  });
  assert.equal(retainedWading.waterState, PLAYER_WATER_WADING);

  const swimming = resolvePlayerWaterState({
    previous: wading,
    waterSample: water(),
    eyeY: 2.15,
    eyeHeight: 1.7,
    config,
  });
  assert.equal(swimming.waterState, PLAYER_WATER_SWIMMING);
});

test('head submersion has an independent hysteresis band', () => {
  const swimming = resolvePlayerWaterState({
    previous: { waterState: PLAYER_WATER_SWIMMING, headSubmerged: false },
    waterSample: water(5),
    eyeY: 4.8,
    eyeHeight: 1.7,
    config,
  });
  assert.equal(swimming.waterState, PLAYER_WATER_SUBMERGED);
  assert.equal(swimming.headSubmerged, true);

  const retained = resolvePlayerWaterState({
    previous: swimming,
    waterSample: water(5),
    eyeY: 5.05,
    eyeHeight: 1.7,
    config,
  });
  assert.equal(retained.waterState, PLAYER_WATER_SUBMERGED);

  const surfaced = resolvePlayerWaterState({
    previous: retained,
    waterSample: water(5),
    eyeY: 5.2,
    eyeHeight: 1.7,
    config,
  });
  assert.equal(surfaced.waterState, PLAYER_WATER_SWIMMING);
  assert.equal(surfaced.headSubmerged, false);
});
