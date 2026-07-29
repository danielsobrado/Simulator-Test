import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findWaterAcceptanceRoute,
  WaterAcceptanceTracker,
} from '../src/editor/performance/qa/WaterAcceptance.js';

function sampleWater(x) {
  if (x < 0) {
    return { coverage: 0, depth: 0, surfaceHeight: 0, bedHeight: 0 };
  }
  return {
    coverage: 1,
    depth: Math.min(4, x / 3 + 1),
    surfaceHeight: 2,
    bedHeight: -2,
    bodyId: 'ocean',
    kind: 1,
  };
}

test('water acceptance route finds a deterministic dry-to-deep crossing', () => {
  const route = findWaterAcceptanceRoute({
    getWaterSample: (x) => sampleWater(x),
    getGroundHeight: (x) => (x < 0 ? 0 : -Math.min(4, x / 3)),
    searchRadius: 32,
    sampleStep: 2,
    minimumDepth: 2,
    maximumDryDistance: 12,
  });

  assert.ok(route);
  assert.ok(route.start.x < 0);
  assert.ok(route.target.x >= 0);
  assert.equal(route.bodyId, 'ocean');
});

test('water acceptance route fails clearly when no shoreline exists', () => {
  const route = findWaterAcceptanceRoute({
    getWaterSample: () => ({ coverage: 0, depth: 0, surfaceHeight: 0, bedHeight: 0 }),
    getGroundHeight: () => 0,
    searchRadius: 16,
    sampleStep: 4,
  });

  assert.equal(route, null);
});

test('water acceptance tracker gates enter, dive, surface, exit and performance', () => {
  const tracker = new WaterAcceptanceTracker({
    route: { start: {}, target: {} },
    qualityTier: 'high',
  });
  tracker.observe({ player: { waterState: 'dry', waterDepth: 0, headSubmerged: false } });
  tracker.observe({ player: { waterState: 'wading', waterDepth: 0.5, waterBodyId: 'a' } });
  tracker.observe({ player: { waterState: 'swimming', waterDepth: 2, waterBodyId: 'a' } });
  tracker.observe({
    player: {
      waterState: 'submerged',
      waterDepth: 3,
      waterBodyId: 'a',
      headSubmerged: true,
      underwaterBlend: 1,
    },
    counters: {
      waterProjectedCausticFrames: 2,
      waterProjectedCausticCpuMs: 1.2,
    },
  });
  tracker.observe({
    player: {
      waterState: 'swimming',
      waterDepth: 2,
      waterBodyId: 'a',
      headSubmerged: false,
    },
  });
  tracker.observe({ player: { waterState: 'dry', waterDepth: 0, headSubmerged: false } });

  const result = tracker.buildResult({
    summary: { frameCount: 100, dt: { p95Ms: 12 }, hitchRate: 0 },
    thresholds: {
      maximumFrameP95Ms: 33.3,
      maximumHitchRate: 0.02,
      maximumProjectedCausticCpuMs: 4,
    },
  });

  assert.equal(result.pass, true);
});
