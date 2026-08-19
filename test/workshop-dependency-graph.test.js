import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkshopDependencyGraph, WorkshopDocument } from '../src/editor/workshop/kernel/index.js';

test('dependency graph resolves deterministic impact in topological order', () => {
  const document = new WorkshopDocument({
    entities: [
      { id: 'root', type: 'structure' },
      { id: 'wall', type: 'wall', parentId: 'root' },
      { id: 'window', type: 'opening', parentId: 'wall' },
      { id: 'trim', type: 'detail', dependsOn: ['window'] },
      { id: 'material', type: 'material' },
    ],
  });
  const graph = new WorkshopDependencyGraph(document);

  assert.deepEqual(graph.dependenciesOf('window'), ['wall']);
  assert.deepEqual(graph.dependentsOf('window'), ['trim']);
  assert.deepEqual(graph.affected(['wall']), ['wall', 'window', 'trim']);
  assert.deepEqual(graph.topologicalOrder(), ['material', 'root', 'wall', 'window', 'trim']);
});

test('dependency graph rejects dependency cycles', () => {
  const document = new WorkshopDocument({
    entities: [
      { id: 'a', type: 'detail', dependsOn: ['b'] },
      { id: 'b', type: 'detail', dependsOn: ['a'] },
    ],
  });
  assert.throws(() => new WorkshopDependencyGraph(document), /dependency graph contains a cycle/i);
});
