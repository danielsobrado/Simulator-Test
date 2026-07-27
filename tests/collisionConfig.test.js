import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import {
  COLLISION_CONFIG_DEFAULTS,
  createCollisionConfig,
  validateCollisionConfig,
} from '../src/editor/collision/CollisionConfig.js';

function loadShippedConfig() {
  return yaml.load(readFileSync(new URL('../config/collision.yaml', import.meta.url), 'utf8'));
}

test('collision defaults and resolved config are deeply immutable', () => {
  const config = createCollisionConfig({});
  assert.equal(Object.isFrozen(COLLISION_CONFIG_DEFAULTS), true);
  assert.equal(Object.isFrozen(COLLISION_CONFIG_DEFAULTS.streaming), true);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.player), true);
  assert.throws(() => { config.player.radius = 9; }, TypeError);
});

test('the shipped collision config enables the runtime with every debug view off', () => {
  const source = loadShippedConfig();
  assert.equal(validateCollisionConfig(source), source);
  const config = createCollisionConfig(source);
  assert.equal(config.enabled, true);
  assert.equal(config.schemaVersion, 1);
  // Debug visualisations draw wireframe helpers over the world, so shipping one
  // switched on is a visible regression rather than a silent one.
  assert.deepEqual(config.debug, {
    colliders: false,
    broadphase: false,
    support: false,
    contacts: false,
  });
});

test('debug URL switches can enable all or individual visualisations', () => {
  const all = createCollisionConfig({}, '?collisionDebug=all');
  assert.deepEqual(all.debug, {
    colliders: true,
    broadphase: true,
    support: true,
    contacts: true,
  });

  const selective = createCollisionConfig({}, '?collisionDebug=colliders,support&collisionSupport=0');
  assert.equal(selective.debug.colliders, true);
  assert.equal(selective.debug.support, false);
  assert.equal(selective.debug.broadphase, false);
});

test('unload radius must cover collision residency', () => {
  const source = loadShippedConfig();
  source.streaming.unloadRadius = 0;
  assert.throws(
    () => createCollisionConfig(source),
    /unloadRadius must cover residentRadius/,
  );
});

test('capsule body height must exceed its diameter', () => {
  const source = loadShippedConfig();
  source.player.bodyHeight = source.player.radius * 2;
  assert.throws(
    () => createCollisionConfig(source),
    /bodyHeight must exceed the capsule diameter/,
  );
});

test('walkable rocks cannot be classified below collidable rocks', () => {
  const source = loadShippedConfig();
  source.rocks.minimumWalkableHeight = source.rocks.minimumCollidableHeight / 2;
  assert.throws(
    () => createCollisionConfig(source),
    /minimumWalkableHeight must not be below minimumCollidableHeight/,
  );
});
