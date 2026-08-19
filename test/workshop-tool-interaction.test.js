import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { WorkshopCommandBus, WorkshopDocument } from '../src/editor/workshop/kernel/index.js';
import { WorkshopHistory, WorkshopReplayRecorder } from '../src/editor/workshop/history/index.js';
import {
  HandleController,
  SelectionController,
  WorkshopToolController,
} from '../src/editor/workshop/interaction/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createBus() {
  return new WorkshopCommandBus(new WorkshopDocument({
    entities: [{ id: 'root', type: 'structure', properties: { width: 8 } }],
  }));
}

test('pointer-move previews replace each other and commit once', () => {
  const bus = createBus();
  const history = new WorkshopHistory(bus);
  const recorder = new WorkshopReplayRecorder(bus);
  const tools = new WorkshopToolController({ bus, replayRecorder: recorder });

  tools.beginGesture('resize', { label: 'Resize root' });
  tools.updateGesture({ type: 'entity.set-properties', id: 'root', properties: { width: 9 } });
  tools.updateGesture({ type: 'entity.set-properties', id: 'root', properties: { width: 10 } });
  tools.updateGesture({ type: 'entity.set-properties', id: 'root', properties: { width: 12 } });

  assert.equal(bus.document.revision, 0);
  assert.equal(history.undoDepth, 0);
  assert.equal(tools.previewDocument.getEntity('root').properties.width, 12);

  tools.commitGesture();
  assert.equal(bus.document.revision, 1);
  assert.equal(bus.document.getEntity('root').properties.width, 12);
  assert.equal(history.undoDepth, 1);
  assert.equal(recorder.toJSON().commands.length, 1);
  history.dispose();
});

test('gesture cancel drops preview without inverse mutation', () => {
  const bus = createBus();
  const tools = new WorkshopToolController({ bus });
  const committed = bus.document;
  tools.beginGesture('resize');
  tools.updateGesture({ type: 'entity.set-properties', id: 'root', properties: { width: 14 } });
  assert.notEqual(tools.previewDocument, committed);
  tools.cancelGesture();
  assert.equal(bus.document, committed);
  assert.equal(tools.previewDocument, committed);
});

test('stale gesture stays open after rejected commit so it can be cancelled', () => {
  const bus = createBus();
  const tools = new WorkshopToolController({ bus });
  tools.beginGesture('resize');
  tools.updateGesture({ type: 'entity.set-properties', id: 'root', properties: { width: 10 } });
  bus.dispatch({ type: 'entity.set-properties', id: 'root', properties: { width: 9 } });
  assert.throws(() => tools.commitGesture(), /stale/i);
  assert.equal(tools.isGestureActive, true);
  assert.equal(tools.cancelGesture(), true);
  assert.equal(bus.document.getEntity('root').properties.width, 9);
});

test('selection and handle controllers contain domain state without renderer dependencies', async () => {
  const selection = new SelectionController();
  selection.set(['root', 'roof'], { primaryId: 'roof' });
  assert.deepEqual(selection.selectedIds, ['roof', 'root']);
  assert.equal(selection.primaryId, 'roof');

  const handles = new HandleController();
  handles.replace([{
    id: 'handle:root:x',
    entityId: 'root',
    kind: 'resize-edge',
    axes: ['x'],
    properties: { side: 1 },
  }]);
  handles.setHovered('handle:root:x');
  assert.equal(handles.hoveredId, 'handle:root:x');

  for (const relative of [
    'src/editor/workshop/interaction/SelectionController.js',
    'src/editor/workshop/interaction/HandleController.js',
    'src/editor/workshop/interaction/WorkshopToolController.js',
  ]) {
    const source = await readFile(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /from ['"]three(?:\/webgpu)?['"]/);
  }
});
