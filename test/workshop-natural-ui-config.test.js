import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const source = yaml.load(readFileSync(
  new URL('../config/workshop-radial-menus.yaml', import.meta.url),
  'utf8',
));

function allLanes() {
  return source.modes.flatMap((mode) => mode.lanes ?? []);
}

test('workshop radial exposes player concepts instead of renderer internals', () => {
  const modeIds = source.modes.map(({ id }) => id);
  const laneIds = allLanes().map(({ id }) => id);

  assert.deepEqual(modeIds, ['structure', 'materials', 'roof', 'colors', 'details']);
  assert.equal(modeIds.includes('textures'), false);
  assert.equal(laneIds.includes('pbr-maps'), false);
  assert.equal(laneIds.includes('detail-level'), false);

  const featureLane = allLanes().find(({ id }) => id === 'feature-toggles');
  assert.deepEqual(
    featureLane.items.map(({ value }) => value),
    ['windows', 'ivy'],
  );
});
