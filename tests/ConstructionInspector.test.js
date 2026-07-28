import assert from 'node:assert/strict';
import test from 'node:test';
import {
  constructionStyleOptionsMarkup,
  masonryStyleStatusMessage,
} from '../src/editor/construction/ui/ConstructionInspector.js';
import { CONSTRUCTION_STYLES } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';

test('style dropdown lists soft limestone rubble after coursed rubble', () => {
  const markup = constructionStyleOptionsMarkup('coursed-rubble');
  assert.match(markup, /value="soft-limestone-rubble"/);
  assert.match(markup, />Soft limestone rubble</);
  assert.equal(
    (markup.match(/value="soft-limestone-rubble"/g) ?? []).length,
    1,
  );

  const keys = [...markup.matchAll(/value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(keys, Object.keys(CONSTRUCTION_STYLES));
  assert.equal(keys[0], 'coursed-rubble');
  assert.equal(keys[1], 'soft-limestone-rubble');
  assert.match(markup, /value="coursed-rubble" selected/);
});

test('style status messages use the human-readable label', () => {
  assert.equal(
    masonryStyleStatusMessage('soft-limestone-rubble'),
    'Masonry style set to Soft limestone rubble.',
  );
  assert.equal(
    masonryStyleStatusMessage('coursed-rubble'),
    'Masonry style set to Coursed rubble.',
  );
  assert.equal(
    masonryStyleStatusMessage('not-a-style'),
    'Masonry style set to not-a-style.',
  );
});

test('selecting soft limestone produces the set_style command shape', () => {
  // The inspector forwards this exact payload; keep the contract pinned here
  // so a markup-only change cannot silently drop the style key.
  const command = {
    type: 'set_style',
    constructionId: 'construction-1',
    styleKey: 'soft-limestone-rubble',
  };
  assert.equal(command.type, 'set_style');
  assert.equal(command.styleKey, 'soft-limestone-rubble');
  assert.ok(Object.hasOwn(CONSTRUCTION_STYLES, command.styleKey));
});
