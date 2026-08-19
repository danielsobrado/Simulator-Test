import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import {
  DEFAULT_WORKSHOP_HISTORY_ENTRIES,
  WORKSHOP_REPLAY_VERSION,
} from '../src/editor/workshop/interaction/WorkshopInteractionConstants.js';
import {
  WORKSHOP_GENERATED_MODES,
  WORKSHOP_GENERATION_CONTROL_TYPE,
} from '../src/editor/workshop/automation/WorkshopGeneratedConstants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Phase 3 interaction config mirrors code contracts', async () => {
  const config = yaml.load(await readFile(
    path.join(root, 'config', 'workshop-interaction.yaml'),
    'utf8',
  ));
  assert.equal(config.version, 1);
  assert.equal(config.history.maxEntries, DEFAULT_WORKSHOP_HISTORY_ENTRIES);
  assert.equal(config.replay.version, WORKSHOP_REPLAY_VERSION);
  assert.equal(config.generatedControls.entityType, WORKSHOP_GENERATION_CONTROL_TYPE);
  assert.deepEqual(config.generatedControls.modes, WORKSHOP_GENERATED_MODES);
  assert.equal(config.preview.oneCommitPerGesture, true);
  assert.equal(config.preview.cancelStrategy, 'discard-preview');
  assert.equal(config.contracts.runtimeRendererChanges, false);
});
