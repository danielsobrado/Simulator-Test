import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

import { NATURAL_EDITOR_UI_CONFIG } from '../src/editor/ui/NaturalEditorUiConfig.generated.js';

const source = yaml.load(readFileSync(
  new URL('../config/editor-natural-ui.yaml', import.meta.url),
  'utf8',
));

test('generated natural editor config stays aligned with YAML', () => {
  assert.deepEqual(
    NATURAL_EDITOR_UI_CONFIG.primaryTools.map(({ id }) => id),
    source.primaryTools.map(({ id }) => id),
  );
  assert.deepEqual(
    NATURAL_EDITOR_UI_CONFIG.buildActions.map(({ id }) => id),
    source.buildActions.map(({ id }) => id),
  );
  assert.deepEqual(
    NATURAL_EDITOR_UI_CONFIG.worldActions.map(({ id }) => id),
    source.worldActions.map(({ id }) => id),
  );
  assert.deepEqual(NATURAL_EDITOR_UI_CONFIG.limits, source.limits);
  assert.deepEqual(NATURAL_EDITOR_UI_CONFIG.storage, source.storage);
  assert.deepEqual(NATURAL_EDITOR_UI_CONFIG.playerSettings, source.playerSettings);
});

test('player-facing taxonomy stays focused on world intent', () => {
  const primaryById = new Map(
    NATURAL_EDITOR_UI_CONFIG.primaryTools.map((tool) => [tool.id, tool]),
  );
  assert.deepEqual([...primaryById.keys()], ['terrain', 'nature', 'build', 'decor']);
  assert.equal(primaryById.get('nature').objectCategory, 'nature');
  assert.equal(primaryById.get('decor').objectCategory, 'civic');
  assert.deepEqual(
    NATURAL_EDITOR_UI_CONFIG.buildActions.map(({ id }) => id),
    ['wall', 'structures', 'defenses', 'workshop'],
  );
  assert.deepEqual(
    NATURAL_EDITOR_UI_CONFIG.worldActions.map(({ id }) => id),
    ['save', 'load', 'new'],
  );
});
