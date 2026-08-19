import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkshopCommandBus, WorkshopDocument } from '../src/editor/workshop/kernel/index.js';
import {
  generationControlId,
  getGenerationControl,
  registerWorkshopGeneratedCommands,
} from '../src/editor/workshop/automation/index.js';
import { replayWorkshopCommands, WorkshopReplayRecorder } from '../src/editor/workshop/history/index.js';

function createBus() {
  const bus = new WorkshopCommandBus(new WorkshopDocument({
    entities: [{ id: 'root', type: 'structure' }],
  }));
  registerWorkshopGeneratedCommands(bus);
  return bus;
}

const provenance = Object.freeze({
  ruleId: 'wall-opening',
  derivationKey: 'wall-main:opening:auto-2',
  sourceIds: ['root'],
});

test('generated pin detach suppress and reset use stable authored control records', () => {
  const bus = createBus();
  const targetId = 'generated:opening-2';
  const controlId = generationControlId(targetId);

  bus.dispatch({
    type: 'generated.pin',
    targetId,
    provenance,
    snapshot: { kind: 'window', width: 1.2 },
  });
  assert.equal(getGenerationControl(bus.document, targetId).id, controlId);
  assert.equal(getGenerationControl(bus.document, targetId).properties.mode, 'pinned');

  bus.dispatch({
    type: 'generated.detach',
    targetId,
    provenance,
    snapshot: { kind: 'window', width: 1.2 },
  });
  assert.equal(getGenerationControl(bus.document, targetId).properties.mode, 'detached');

  bus.dispatch({ type: 'generated.suppress', targetId, provenance });
  assert.equal(getGenerationControl(bus.document, targetId).properties.mode, 'suppressed');

  bus.dispatch({ type: 'generated.reset-to-auto', targetId });
  assert.equal(getGenerationControl(bus.document, targetId), null);
});

test('generated commands replay deterministically when handlers are configured', () => {
  const initial = new WorkshopDocument({ entities: [{ id: 'root', type: 'structure' }] });
  const bus = new WorkshopCommandBus(initial);
  registerWorkshopGeneratedCommands(bus);
  const recorder = new WorkshopReplayRecorder(bus);
  recorder.dispatch({
    type: 'generated.pin',
    targetId: 'generated:door-1',
    provenance,
    snapshot: { kind: 'door' },
  });

  const replayed = replayWorkshopCommands(initial, recorder.toJSON(), {
    configureBus: registerWorkshopGeneratedCommands,
  });
  assert.deepEqual(
    replayed.listEntities().map((entity) => entity.toJSON()),
    bus.document.listEntities().map((entity) => entity.toJSON()),
  );
});

test('pin and detach require semantic snapshots', () => {
  const bus = createBus();
  assert.throws(() => bus.dispatch({
    type: 'generated.pin',
    targetId: 'generated:window-1',
    provenance,
  }), /semantic snapshot/i);
});
