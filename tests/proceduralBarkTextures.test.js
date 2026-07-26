import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BARK_PROFILES,
  createProceduralBarkPixels,
} from '../src/editor/stylized/forest/ProceduralBarkTextures.js';

test('procedural bark profiles bake deterministic packed texture pairs', () => {
  const first = createProceduralBarkPixels({
    profile: 'spruce',
    seed: 83,
    resolution: 16,
  });
  const second = createProceduralBarkPixels({
    profile: 'spruce',
    seed: 83,
    resolution: 16,
  });

  assert.deepEqual(first.albedoHeight, second.albedoHeight);
  assert.deepEqual(first.normalRoughness, second.normalRoughness);
  assert.equal(first.albedoHeight.length, 16 * 16 * 4);
  assert.equal(first.normalRoughness.length, 16 * 16 * 4);
});

test('procedural bark profiles produce distinct surface character', () => {
  const spruce = createProceduralBarkPixels({
    profile: 'spruce',
    seed: 83,
    resolution: 16,
  });
  const birch = createProceduralBarkPixels({
    profile: 'birch',
    seed: 83,
    resolution: 16,
  });

  assert.notDeepEqual(spruce.albedoHeight, birch.albedoHeight);
  assert.notDeepEqual(spruce.normalRoughness, birch.normalRoughness);
  assert.ok(Object.isFrozen(BARK_PROFILES.spruce));
});

test('procedural bark rejects unknown profiles and invalid resolutions', () => {
  assert.throws(
    () => createProceduralBarkPixels({ profile: 'oak' }),
    /Unknown procedural bark profile/,
  );
  assert.throws(
    () => createProceduralBarkPixels({ resolution: 3 }),
    /integer of at least 4/,
  );
});
