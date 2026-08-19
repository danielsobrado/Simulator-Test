import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LegacyWorkshopEditSession } from '../src/editor/workshop/interaction/LegacyWorkshopEditSession.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workshopDir = path.join(root, 'src', 'editor', 'workshop');

const IDENTITY = Object.freeze({
  position: Object.freeze([0, 0, 0]),
  rotation: Object.freeze([0, 0, 0]),
  scale: Object.freeze([1, 1, 1]),
});

function state(positionX = 0) {
  return {
    componentTransforms: positionX === 0 ? {} : {
      'structure-main': {
        ...IDENTITY,
        position: [positionX, 0, 0],
      },
    },
    openingAttachments: {},
    openingAssemblies: {},
  };
}

async function jsFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await jsFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(target);
  }
  return result;
}

test('live component controller is a small semantic migration layer', async () => {
  const livePath = path.join(workshopDir, 'ProceduralWorkshopComponentController.js');
  const source = await readFile(livePath, 'utf8');

  assert.ok(source.split('\n').length < 180, 'live component controller regrew into a monolith');
  assert.match(source, /extends LegacyProceduralWorkshopComponentController/);
  assert.match(source, /LegacyWorkshopEditSession/);
  assert.match(source, /beginGesture/);
  assert.doesNotMatch(source, /this\.history\s*=\s*\[/);
  assert.doesNotMatch(source, /this\.future\s*=\s*\[/);
});

test('legacy component controller core cannot be imported directly elsewhere', async () => {
  const livePath = path.join(workshopDir, 'ProceduralWorkshopComponentController.js');
  const forbiddenImport = 'LegacyProceduralWorkshopComponentController.js';
  for (const file of await jsFiles(workshopDir)) {
    if (file === livePath) continue;
    const source = await readFile(file, 'utf8');
    assert.equal(
      source.includes(forbiddenImport),
      false,
      `${path.relative(root, file)} bypasses the semantic live controller`,
    );
  }
});

test('live edit session commits one gesture and round-trips undo redo', () => {
  const initial = state();
  const edited = state(1.25);
  const session = new LegacyWorkshopEditSession(initial);

  session.beginGesture(initial, { label: 'Transform component' });
  session.record(initial, edited, { label: 'Transform component' });
  assert.deepEqual(session.state, edited);
  assert.equal(session.canUndo, true);

  assert.deepEqual(session.undo(), initial);
  assert.equal(session.canRedo, true);
  assert.deepEqual(session.redo(), edited);
  session.dispose();
});

test('cancelled live gesture drops preview and preserves committed state', () => {
  const committed = state(0.5);
  const preview = state(2.5);
  const session = new LegacyWorkshopEditSession(committed);

  session.beginGesture(committed, { label: 'Reshape component' });
  assert.deepEqual(session.previewState(preview), preview);
  assert.deepEqual(session.state, committed);
  assert.deepEqual(session.cancelGesture(), committed);
  assert.equal(session.canUndo, false);
  session.dispose();
});

test('external definition synchronization clears stale component history', () => {
  const initial = state();
  const edited = state(1);
  const regenerated = state(3);
  const session = new LegacyWorkshopEditSession(initial);

  session.record(initial, edited);
  assert.equal(session.canUndo, true);
  assert.equal(session.synchronize(regenerated), true);
  assert.deepEqual(session.state, regenerated);
  assert.equal(session.canUndo, false);
  assert.equal(session.canRedo, false);
  session.dispose();
});
