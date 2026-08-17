import assert from 'node:assert/strict';
import test from 'node:test';

import { constructionStoneEdgeWearProfile } from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';

test('worked coursed-rubble dressings retain restrained soft-stone shaping', () => {
  const wear = constructionStoneEdgeWearProfile('coursed-rubble');
  const relief = constructionStoneReliefProfile('coursed-rubble');

  for (const category of ['coping', 'quoin', 'voussoir', 'merlon']) {
    assert.ok(wear.categories[category] > 0, `${category} edge wear should be enabled`);
    assert.ok(relief.categories[category] > 0, `${category} face relief should be enabled`);
    assert.ok(wear.categories[category] < wear.categories.field);
    assert.ok(relief.categories[category] < relief.categories.field);
  }
});
