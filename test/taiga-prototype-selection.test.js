import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { createSpeciesPrototypeIndex } from '../src/editor/stylized/forest/ForestSpeciesGeometry.js';
import { createShippedTreeRegistry } from './helpers/shippedTreeRegistry.js';

const surface = load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8')).stylizedSurface;

test('10000 stable candidates per cold biome choose boreal conifers in taiga and alpine crowns in tundra', () => {
  const { registry, sceneOf } = createShippedTreeRegistry(surface);
  for (const [tileId, profileKey, folder] of [[9, 'taiga', '/boreal/'], [10, 'tundra', '/alpine/']]) {
    for (let i = 0; i < 10000; i += 1) {
      const candidate = { stableId: `cold:${i}`, scale: 1 };
      const habitat = { tileId, profileKey, patchCoverage: 0.8, patchEdge: 0.2, slope: 0.1, waterWeight: 1 };
      const a = registry.select(candidate, habitat);
      assert.deepEqual(a, registry.select({ ...candidate }, habitat));
      assert.ok(sceneOf(a.prototypeIndex)?.includes(folder), `${profileKey} drew ${sceneOf(a.prototypeIndex)}`);
      if (tileId === 9) {
        // A dead tree is a snag, and nothing alive is.
        assert.equal(sceneOf(a.prototypeIndex).includes('boreal-snag'), a.ageClass === 'dead');
      }
    }
  }
});

test('excluded primary tree prototypes never enter a species pool', () => {
  const { map, fallback } = createSpeciesPrototypeIndex({ glbPrototypeCount: 5, generatedSpeciesIds: [],
    excludedPrimaryIndices: [3, 4] });
  for (const indices of [...map.values(), fallback]) assert.ok(!indices.includes(3) && !indices.includes(4));
  assert.throws(() => createSpeciesPrototypeIndex({ glbPrototypeCount: 2, generatedSpeciesIds: [],
    excludedPrimaryIndices: [5] }));
});
