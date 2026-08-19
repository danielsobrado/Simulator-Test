import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { WORKSHOP_DIRTY_DOMAINS } from '../src/editor/workshop/invalidation/WorkshopDirtyDomains.js';
import { WORKSHOP_RELATIONSHIP_TYPES } from '../src/editor/workshop/relationships/WorkshopRelationshipGraph.js';
import {
  DEFAULT_WORKSHOP_SPATIAL_CELL_SIZE,
  DEFAULT_WORKSHOP_SPATIAL_MAX_QUERY_CELLS,
} from '../src/editor/workshop/spatial/WorkshopSpatialConstants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Phase 4 locality YAML matches runtime constants', async () => {
  const config = yaml.load(await readFile(path.join(root, 'config', 'workshop-locality.yaml'), 'utf8'));
  assert.equal(config.version, 1);
  assert.deepEqual(config.dirtyDomains, [...WORKSHOP_DIRTY_DOMAINS]);
  assert.deepEqual(config.relationships.types, [...WORKSHOP_RELATIONSHIP_TYPES]);
  assert.equal(config.spatial.cellSize, DEFAULT_WORKSHOP_SPATIAL_CELL_SIZE);
  assert.equal(config.spatial.maxQueryCells, DEFAULT_WORKSHOP_SPATIAL_MAX_QUERY_CELLS);
  assert.equal(config.contracts.rendererIndependent, true);
  assert.equal(config.contracts.incrementalSpatialUpdates, true);
});
