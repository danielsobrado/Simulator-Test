import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { propClusterFor, STONEHOLD_LANDMARKS } from '../../src/editor/towns/TownPrefabCatalog.js';

const kit = JSON.parse(fs.readFileSync(new URL('../../public/assets/environment/medieval-kit/medieval_kit_prefabs.json', import.meta.url)));
const metrics = JSON.parse(fs.readFileSync(new URL('../../assets-src/medieval-town-kit/previews/stonehold-aaa/metrics-lod0.json', import.meta.url)));

test('Stonehold reservations contain the baked visual footprint and scaled collision', () => {
  for (const reservation of STONEHOLD_LANDMARKS) {
    const [[module]] = propClusterFor(reservation.kind, reservation.variant);
    const bounds = metrics.modules[module].bounds;
    assert.ok(Math.max(...bounds[0].map(Math.abs)) <= reservation.w / 2, `${module}: width`);
    assert.ok(Math.max(...bounds[1].map(Math.abs)) <= reservation.d / 2, `${module}: depth`);
    const boxes = kit.moduleColliders[module];
    assert.ok(boxes.length > 0, module);
    for (const { c, s } of boxes) {
      assert.ok(c.every(Number.isFinite) && s.every(value => Number.isFinite(value) && value > 0), module);
      assert.ok(Math.abs(c[0]) + s[0] / 2 <= reservation.w / 2, `${module}: collision width`);
      assert.ok(Math.abs(c[2]) + s[2] / 2 <= reservation.d / 2, `${module}: collision depth`);
    }
  }
  const width = Math.max(...kit.moduleColliders.Stonehold_Twin_Outcrop.map(box => box.s[0]));
  assert.ok(width >= 20, 'an inhabited twin fortress has world-scale collision');
});
