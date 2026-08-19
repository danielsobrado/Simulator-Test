import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkshopDocument } from '../src/editor/workshop/kernel/WorkshopDocument.js';
import { WorkshopRelationshipGraph } from '../src/editor/workshop/relationships/WorkshopRelationshipGraph.js';
import { WorkshopSpatialIndex } from '../src/editor/workshop/spatial/WorkshopSpatialIndex.js';

function rectangle(id, x, z) {
  return {
    id: `composition:${id}`,
    type: 'composition-rectangle',
    parentId: 'recipe',
    properties: {
      primitive: {
        id,
        kind: 'rectangle',
        position: [x, z],
        rotation: 0,
        dimensions: [4, 4],
        elevation: 0,
        height: 5,
        levels: 1,
        roofFamily: 'hip',
      },
    },
  };
}

function documentWithHall(x = 0, revision = 0) {
  return new WorkshopDocument({
    revision,
    entities: [
      { id: 'recipe', type: 'workshop-recipe' },
      rectangle('hall', x, 0),
      rectangle('wing', 12, 0),
      rectangle('far', 40, 0),
      { id: 'detail', type: 'detail', dependsOn: ['composition:hall'] },
    ],
  });
}

test('typed relationships are deterministic and queryable by type', () => {
  const graph = new WorkshopRelationshipGraph(documentWithHall());
  assert.deepEqual(graph.related('composition:hall', { type: 'DEPENDENCY' }), ['detail']);
  assert.deepEqual(graph.incoming('composition:hall', 'PARENT').map(({ from }) => from), ['recipe']);
  assert.deepEqual(graph.edges('DEPENDENCY'), [{
    type: 'DEPENDENCY',
    from: 'composition:hall',
    to: 'detail',
  }]);
});

test('semantic spatial queries are deterministic and incremental updates do not rescan the document', () => {
  const before = documentWithHall();
  const index = new WorkshopSpatialIndex(before, { cellSize: 8 });
  assert.deepEqual(index.neighborsOf('composition:hall', 8), ['composition:wing']);
  assert.deepEqual(index.queryRadius([0, 0], 20), ['composition:hall', 'composition:wing']);

  const after = documentWithHall(30, 1);
  let listCalls = 0;
  const incrementalView = {
    revision: after.revision,
    getEntity: (id) => after.getEntity(id),
    listEntities: () => {
      listCalls += 1;
      throw new Error('Incremental spatial update must not scan the document.');
    },
  };
  index.update(incrementalView, ['composition:hall']);
  assert.equal(listCalls, 0);
  assert.deepEqual(index.neighborsOf('composition:hall', 8), ['composition:far']);
});
