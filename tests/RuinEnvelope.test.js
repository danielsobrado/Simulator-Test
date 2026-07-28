import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRuinEnvelope,
  sampleRuinEnvelopeHeight,
} from '../src/editor/construction/masonry/RuinEnvelope.js';
import { CONSTRUCTION_SUPPORT_ROLE } from '../src/editor/construction/masonry/ConstructionSupportRoles.js';
import { buildShellGeometry } from '../src/editor/construction/render/ConstructionShell.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';

function survivor(s0, s1, top) {
  return {
    support: {
      role: CONSTRUCTION_SUPPORT_ROLE.FIELD,
      span: [s0, s1],
      bottom: 0,
      top,
      courseIndex: 0,
    },
  };
}

test('ruin envelope follows survivor crown and never exceeds it', () => {
  const envelope = createRuinEnvelope({
    survivors: [
      survivor(0, 2, 1.2),
      survivor(4, 6, 2.4),
    ],
    totalLength: 6,
    sampleSpacing: 0.5,
    fallbackHeightAt: () => 3.5,
  });
  assert.ok(sampleRuinEnvelopeHeight(envelope, 1) <= 1.2 + 1e-9);
  assert.ok(sampleRuinEnvelopeHeight(envelope, 5) <= 2.4 + 1e-9);
  // Empty stretch falls back to macro, not inventing taller stone.
  assert.equal(sampleRuinEnvelopeHeight(envelope, 3), 3.5);
});

test('sampleRuinEnvelopeHeight works after structured-clone drops heightAt', () => {
  const envelope = createRuinEnvelope({
    survivors: [survivor(0, 4, 1.8)],
    totalLength: 4,
    sampleSpacing: 1,
    fallbackHeightAt: () => 0,
  });
  const cloned = structuredClone({
    samples: envelope.samples,
  });
  assert.ok(sampleRuinEnvelopeHeight(cloned, 2) > 1.5);
});

test('shell geometry uses ruin envelope height instead of nominal', () => {
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'shell-ruin',
    revision: 1,
    seed: 1,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1, materials: {} },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([[0, 0], [2, 0], [4, 0], [6, 0]], {
      simplifyTolerance: 0.01,
    }),
    features: [],
  });
  const points = [
    { x: 0, z: 0, normalX: 0, normalZ: 1, distance: 0 },
    { x: 3, z: 0, normalX: 0, normalZ: 1, distance: 3 },
    { x: 6, z: 0, normalX: 0, normalZ: 1, distance: 6 },
  ];
  const terrainView = { getCanonicalHeight: () => 0 };
  const nominal = buildShellGeometry(points, {
    record,
    terrainView,
    origin: { x: 0, z: 0 },
  });
  const ruined = buildShellGeometry(points, {
    record,
    terrainView,
    origin: { x: 0, z: 0 },
    heightAt: () => 1.1,
  });
  assert.ok(nominal.boundingBox.max.y > 3);
  assert.ok(ruined.boundingBox.max.y < 1.3);
  nominal.dispose();
  ruined.dispose();
});
