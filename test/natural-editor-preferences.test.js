import assert from 'node:assert/strict';
import test from 'node:test';

import { NaturalEditorPreferences } from '../src/editor/ui/NaturalEditorPreferences.js';
import { NATURAL_EDITOR_UI_CONFIG } from '../src/editor/ui/NaturalEditorUiConfig.generated.js';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test('natural editor exposes four player-facing primary tools', () => {
  assert.deepEqual(
    NATURAL_EDITOR_UI_CONFIG.primaryTools.map(({ id }) => id),
    ['terrain', 'nature', 'build', 'decor'],
  );
  assert.equal(
    NATURAL_EDITOR_UI_CONFIG.primaryTools.some(({ id }) => id === 'select'),
    false,
  );
  assert.equal(
    NATURAL_EDITOR_UI_CONFIG.primaryTools.some(({ id }) => id === 'settings'),
    false,
  );
});

test('recent object picks are deterministic, unique and bounded', () => {
  const storage = new MemoryStorage();
  const preferences = new NaturalEditorPreferences(storage);
  const limit = NATURAL_EDITOR_UI_CONFIG.limits.recentObjects;

  for (let index = 0; index < limit + 4; index += 1) {
    preferences.remember(`object-${index}`);
  }
  preferences.remember(`object-${limit + 2}`);

  assert.equal(preferences.recentKeys().length, limit);
  assert.equal(preferences.recentKeys()[0], `object-${limit + 2}`);
  assert.equal(new Set(preferences.recentKeys()).size, preferences.recentKeys().length);
});

test('favorites persist without exceeding the configured bound', () => {
  const storage = new MemoryStorage();
  let preferences = new NaturalEditorPreferences(storage);
  const limit = NATURAL_EDITOR_UI_CONFIG.limits.favoriteObjects;

  for (let index = 0; index < limit + 3; index += 1) {
    preferences.toggleFavorite(`favorite-${index}`);
  }

  assert.equal(preferences.favoriteKeys().length, limit);
  assert.equal(preferences.isFavorite('favorite-0'), true);
  preferences.toggleFavorite('favorite-0');
  assert.equal(preferences.isFavorite('favorite-0'), false);

  preferences = new NaturalEditorPreferences(storage);
  assert.equal(preferences.isFavorite('favorite-0'), false);
  assert.equal(preferences.favoriteKeys().length, limit - 1);
});
