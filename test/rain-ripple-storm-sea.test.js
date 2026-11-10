import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, uniform, vec2 } from 'three/tsl';
import { RAIN_RIPPLE_LAYERS, createRainRippleNode } from '../src/editor/stylized/RainRippleShading.js';
import { createSeaSurfaceNodes } from '../src/editor/stylized/SeaSurfaceShading.js';

test('rain ring lattices stay exact on the whole-metre chunk origin', () => {
  // A cell index is origin metres × cells per metre: it must stay an integer, or
  // the rings tear at every chunk border at planet scale.
  assert.ok(RAIN_RIPPLE_LAYERS.length >= 2, 'more than one ring size');
  for (const [cellMeters] of RAIN_RIPPLE_LAYERS) {
    assert.ok(Number.isInteger(1 / cellMeters), `${cellMeters} m does not divide a metre`);
    assert.ok(cellMeters < 1, 'rings smaller than the old 1 m discs');
  }
  const rain = createRainRippleNode({ localMeters: vec2(3, 4), originMeters: uniform(new THREE.Vector2()), time: uniform(0), rain: uniform(1) });
  assert.equal(typeof rain.ring.mul, 'function');
  assert.equal(typeof rain.slope.mul, 'function', 'a slope node for the normal');
});

test('the sea exposes storm foam and a shore foam line', () => {
  const sea = createSeaSurfaceNodes({
    terrainUv: vec2(0.5, 0.5), chunkWorldSize: 8, surfaceWorldHeight: float(0), waterDepth: float(0.3),
    waterCoverage: float(1), currentStrength: float(0), time: uniform(0),
    phaseOrigin: [uniform(0), uniform(0), uniform(0), uniform(0), uniform(0)],
    sunDirection: uniform(new THREE.Vector3(0, 0.2, -1)),
    config: { enabled: true, amplitude: 0.9, stormScale: 2.6, choppiness: 4, shallowDepth: 1.5, depthRatio: 0.42,
      slopeShading: 0.55, crestLift: 0.12, whitecapThreshold: 0.8, stormWhitecapThreshold: 0.45 },
  });
  assert.equal(typeof sea.whitecap().mul, 'function');
  assert.equal(typeof sea.shoreLine().mul, 'function');
});
