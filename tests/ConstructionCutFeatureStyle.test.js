import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WINDOW_SILL,
  cutFeatureStyle,
  resolveCutKind,
} from '../src/editor/construction/ConstructionCutStroke.js';

test('without a preference the stroke geometry decides the kind', () => {
  assert.equal(resolveCutKind('arch', null), 'arch');
  assert.equal(resolveCutKind('door', null), 'door');
  assert.equal(resolveCutKind('door'), 'door');
});

test('a preference only chooses between kinds of the same shape', () => {
  // A crossing left a hole through the wall. Gate and arch both pass through, so
  // one can become the other; asking for a door there would ask the solver to
  // close a hole the stroke already made.
  assert.equal(resolveCutKind('arch', 'gate'), 'gate');
  assert.equal(resolveCutKind('arch', 'door'), 'arch');
  assert.equal(resolveCutKind('arch', 'window'), 'arch');

  // A stroke that stopped against the wall left a recess: door or window.
  assert.equal(resolveCutKind('door', 'window'), 'window');
  assert.equal(resolveCutKind('door', 'door'), 'door');
  assert.equal(resolveCutKind('door', 'gate'), 'door');
});

test('a window sills above grade and keeps its crown where the cut put it', () => {
  const cut = { kind: 'door', width: 1.2, height: 2.4 };
  const door = cutFeatureStyle(cut, { kind: 'door' });
  const window = cutFeatureStyle(cut, { kind: 'window' });

  assert.equal(door.sill, 0);
  assert.equal(door.height, 2.4);
  assert.equal(window.sill, WINDOW_SILL);
  // Sill plus height is the head elevation; a window lands under the same arch
  // the door would have rather than sliding up the wall.
  assert.equal(window.sill + window.height, door.sill + door.height);
});

test('a cut too short for a sill still yields a valid opening', () => {
  // The schema's floor is 0.2m. Silling a short cut naively would produce a
  // negative height and be rejected at the command, after the stroke was drawn.
  const style = cutFeatureStyle({ kind: 'door', height: 0.5 }, { kind: 'window' });
  assert.ok(style.height >= 0.2, 'height must stay above the schema minimum');
  assert.ok(style.sill >= 0);
  assert.ok(style.sill < WINDOW_SILL, 'a short wall cannot afford the full sill');
});

test('profile and dressing come straight from the preference', () => {
  const style = cutFeatureStyle(
    { kind: 'arch', height: 3 },
    { profile: 'pointed', dressed: false },
  );
  assert.equal(style.profile, 'pointed');
  assert.equal(style.dressed, false);
});

test('the defaults reproduce what the cut used to hardcode', () => {
  // Before the openings grid every cut came out round, dressed and silled at
  // grade. With no preference passed, that must not change.
  const style = cutFeatureStyle({ kind: 'arch', height: 3 });
  assert.deepEqual(style, {
    kind: 'arch',
    height: 3,
    sill: 0,
    profile: 'round',
    dressed: true,
  });
});
