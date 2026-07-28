import assert from 'node:assert/strict';
import test from 'node:test';
import { ConstructionGroundProvider } from '../src/editor/construction/simulation/ConstructionGroundProvider.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { ConstructionSpatialIndex } from '../src/editor/construction/ConstructionSpatialIndex.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { executeConstructionCommand } from '../src/editor/construction/ConstructionCommands.js';

const GROUND = 10;

function terrainView(height = GROUND) {
  return { getCanonicalHeight: () => height };
}

/** A wall along z = 0 from x = 0 to x = 30, nearly straight. */
function wallRecord(overrides = {}) {
  return {
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 3,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([
      [0, 0], [10, 0.01], [20, -0.01], [30, 0],
    ], { simplifyTolerance: 0.001 }),
    features: [],
    ...overrides,
  };
}

function provider(records = [wallRecord()], height = GROUND) {
  const store = new ConstructionStore(records);
  const spatialIndex = new ConstructionSpatialIndex({ chunkWorldSize: 64 });
  for (const record of store.list()) spatialIndex.update(record);
  return {
    store,
    spatialIndex,
    ground: new ConstructionGroundProvider({
      store,
      spatialIndex,
      terrainView: terrainView(height),
    }),
  };
}

test('the centreline of a wall reads terrain plus its height', () => {
  const { ground } = provider();
  const surface = ground.heightAt(15, 0);
  assert.ok(surface !== null, 'the centreline must be over the wall');
  assert.ok(Math.abs(surface - (GROUND + 3.5)) < 0.05, `got ${surface}`);
});

test('a point past the wall thickness is not over it', () => {
  const { ground } = provider();
  assert.equal(ground.heightAt(15, 1.5), null);
  assert.equal(ground.heightAt(15, -1.5), null);
});

test('the wall edge is inclusive within its half thickness', () => {
  const { ground } = provider();
  assert.ok(ground.heightAt(15, 0.35) !== null, 'inside half thickness');
  assert.ok(ground.heightAt(15, 0.85) === null, 'beyond half thickness');
});

test('points anywhere off the ribbon return null', () => {
  const { ground } = provider();
  for (const [x, z] of [[-20, 0], [60, 0], [15, 12], [15, -12], [0, 40]]) {
    assert.equal(ground.heightAt(x, z), null, `(${x}, ${z}) should be off the wall`);
  }
});

test('a raised profile section lifts the walkable surface', () => {
  const base = wallRecord();
  const segmentId = base.path.segments[1].id;
  const { ground, store } = provider([{
    ...base,
    top: {
      style: 'flat',
      base: 3.5,
      profile: [
        { segmentId, arcFraction: 0.2, height: 3.5 },
        { segmentId, arcFraction: 0.5, height: 7 },
        { segmentId, arcFraction: 0.8, height: 3.5 },
      ],
    },
  }]);
  const record = store.get('construction-1');
  assert.ok(record.top.profile.length === 3);
  const peakArc = 15;
  const raised = ground.heightAt(peakArc, 0);
  assert.ok(raised !== null);
  assert.ok(raised > GROUND + 4, `expected a raised surface, got ${raised}`);
});

test('a ruined section sags below the nominal height', () => {
  const { ground } = provider([{ ...wallRecord(), top: { style: 'ruined', base: 4 } }]);
  let sagged = 0;
  for (let x = 2; x < 28; x += 1) {
    const surface = ground.heightAt(x, 0);
    if (surface !== null && surface < GROUND + 4 - 0.05) sagged += 1;
  }
  assert.ok(sagged > 4, 'a ruin must be lower than its nominal height somewhere');
});

test('a crenellated wall returns the merlon base, not the merlon top', () => {
  const { ground } = provider([{
    ...wallRecord(),
    top: { style: 'crenellated', base: 3.5 },
  }]);
  // Walking the wall-walk between merlons is the right gameplay answer, and it
  // is much cheaper than a per-merlon test.
  for (let x = 4; x < 26; x += 0.5) {
    const surface = ground.heightAt(x, 0);
    if (surface === null) continue;
    assert.ok(surface <= GROUND + 3.5 + 1e-6, `merlon collided at ${x}: ${surface}`);
  }
});

test('the cache follows the record revision', () => {
  const { ground, store } = provider();
  const before = ground.heightAt(15, 0);
  const record = store.get('construction-1');
  store.update('construction-1', {
    ...record,
    top: { ...record.top, base: 6 },
  });
  const after = ground.heightAt(15, 0);
  assert.ok(after > before + 2, `expected the raise to take effect: ${before} -> ${after}`);
});

test('changing the wall height carries an untouched top with it', () => {
  // `top.base` defaults to the wall height and is authoritative once set, so a
  // height change has to bring it along — otherwise dragging "Wall height"
  // moves the stones and leaves the walkable surface behind.
  const { ground, store } = provider();
  const before = ground.heightAt(15, 0);
  const change = executeConstructionCommand(store, {
    type: 'set_dimensions',
    constructionId: 'construction-1',
    dimensions: { height: 6 },
  });
  assert.equal(change.after.top.base, 6);
  assert.ok(ground.heightAt(15, 0) > before + 2);
});

test('an authored top survives a wall height change', () => {
  const base = wallRecord();
  const segmentId = base.path.segments[1].id;
  const { store } = provider([{
    ...base,
    top: {
      style: 'flat',
      base: 3.5,
      profile: [{ segmentId, arcFraction: 0.5, height: 5 }],
    },
  }]);
  const change = executeConstructionCommand(store, {
    type: 'set_dimensions',
    constructionId: 'construction-1',
    dimensions: { height: 9 },
  });
  assert.equal(change.after.top.profile.length, 1, 'the authored profile stays');
  assert.equal(change.after.top.base, 3.5, 'and its base is not overwritten');
});

test('overlapping walls yield the higher surface', () => {
  const tall = {
    ...wallRecord(),
    id: 'construction-2',
    dimensions: { height: 6, thickness: 0.8 },
  };
  const { ground } = provider([wallRecord(), tall]);
  const surface = ground.heightAt(15, 0);
  assert.ok(Math.abs(surface - (GROUND + 6)) < 0.05, `got ${surface}`);
});

test('composing with terrain never drops the player below grade', () => {
  const { ground } = provider();
  const compose = ground.createGroundHeightFn(() => GROUND);
  assert.equal(compose(15, 12), GROUND, 'off the wall it is pure terrain');
  assert.ok(compose(15, 0) > GROUND, 'on the wall it is raised');

  // A wall whose top sits below grade must not sink the player.
  const sunken = new ConstructionGroundProvider({
    store: new ConstructionStore([wallRecord()]),
    spatialIndex: null,
    terrainView: terrainView(-100),
  });
  const composeSunken = sunken.createGroundHeightFn(() => GROUND);
  assert.equal(composeSunken(15, 0), GROUND);
});

test('off-wall queries are rejected by the grid without a curve search', () => {
  const { ground } = provider();
  ground.heightAt(15, 0);
  assert.ok(ground.stats.curveSearches > 0, 'an on-wall query does search the curve');

  const searchesBefore = ground.stats.curveSearches;
  for (let i = 0; i < 2000; i += 1) ground.heightAt(-500 - i, 400 + i);
  assert.equal(
    ground.stats.curveSearches,
    searchesBefore,
    'clearly off-wall points must never reach the closest-point search',
  );
  assert.ok(ground.stats.queries > 2000);
});
