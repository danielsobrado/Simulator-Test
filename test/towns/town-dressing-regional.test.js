import assert from 'node:assert/strict';
import test from 'node:test';

import { planDressing } from '../../src/editor/towns/TownDressing.js';
import { isTownProp, propClusterFor, STONEHOLD_LANDMARKS } from '../../src/editor/towns/TownPrefabCatalog.js';
import { rect, rectHitsPolyline, rectsOverlap } from '../../src/editor/world/settlements/SettlementGeometry.js';

// A row of well-spaced houses on an empty plan, so every candidate has room to land.
function dress(family) {
  const placed = Array.from({ length: 12 }, (_, index) => ({
    building: { kind: index % 4 === 0 ? 'smithy' : 'house', x: index * 24, z: 0, yaw: 0 },
    size: [8, 6],
    family,
  }));
  return planDressing({ plan: { streets: [], props: [], profile: {} }, seed: 99, placed, family });
}

const kinds = (props) => new Set(props.map((prop) => prop.kind));

test('frontier and mountain families dress houses with their own clutter, trees and rock', () => {
  const orc = kinds(dress('Orc'));
  assert.ok(orc.has('war_banner') && orc.has('drying_rack') && orc.has('tree'), [...orc].join());
  const frost = kinds(dress('Frostgard'));
  assert.ok(frost.has('pine') && frost.has('woodpile') && frost.has('boulders'), [...frost].join());
  const stone = kinds(dress('Stonehold'));
  assert.ok(stone.has('brazier_pillar') && stone.has('ore_crane'), [...stone].join());
  assert.ok(!stone.has('fence'), 'Stonehold yards are not fenced with planks');
  const tudor = kinds(dress('Tudor'));
  assert.ok(tudor.has('planter') && !tudor.has('war_banner'), [...tudor].join());
});

test('every regional dressing kind resolves to kit modules', () => {
  for (const kind of ['war_banner', 'fire_post', 'brazier_pillar', 'ore_crane', 'boulders', 'pine', 'tree']) {
    assert.ok(propClusterFor(kind, 0).length > 0, kind);
  }
});

test('inhabited Stonehold cliffs reserve their full footprint outside houses and roads', () => {
  const street = { points: [[0, -120], [0, 120]], width: 6 };
  const placed = [{ building: { kind: 'house', x: 62, z: 62, yaw: 0 }, size: [12, 10], family: 'Stonehold' }];
  const options = { plan: { streets: [street], props: [], profile: { radius: 48, rank: 2 } }, placed, seed: 99, family: 'Stonehold' };
  const result = planDressing(options);
  assert.deepEqual(result, planDressing(options));
  const landmarks = result.filter(prop => prop.kind.startsWith('stonehold_'));
  assert.ok(landmarks.length > 0 && landmarks.length <= 4);
  const boxes = [];
  for (const prop of landmarks) {
    const footprint = STONEHOLD_LANDMARKS.find(item => item.kind === prop.kind && item.variant === prop.variant);
    const box = rect(prop.x, prop.z, footprint.w, footprint.d, prop.yaw);
    assert.equal(rectHitsPolyline(box, street.points, street.width / 2, 0.2), false);
    assert.equal(rectsOverlap(box, rect(62, 62, 12.6, 10.6, 0), 0.15), false);
    assert.ok(Math.hypot(prop.x, prop.z) > 48 + Math.hypot(footprint.w, footprint.d) / 2);
    assert.ok(boxes.every(other => !rectsOverlap(box, other, 0.15)));
    boxes.push(box);
    for (const [module] of propClusterFor(prop.kind, prop.variant)) assert.equal(isTownProp(module), false, module);
  }
  assert.equal(isTownProp('Stonehold_Ward_Pillar'), true);
});
