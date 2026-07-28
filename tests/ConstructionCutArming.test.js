import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorController } from '../src/editor/EditorController.js';

/**
 * Arming is one-shot, and every path out of the gesture has to honour that.
 *
 * The cut flag is what turns the freehand drag from "draw a wall" into "carve
 * holes in the walls you cross". Leaving it set is not a cosmetic bug: the next
 * ordinary drag destroys masonry instead of building it, with no visible cue
 * that the tool changed meaning.
 */
function controller() {
  return Object.create(EditorController.prototype);
}

test('cancelling a gesture disarms the cut', () => {
  const editor = controller();
  editor.constructionCutArmed = true;
  editor.constructionDrawing = false;
  editor.constructionStroke = null;
  editor.constructionAnchorDrag = null;
  editor.hoveredArc = null;
  editor.flushTopEdit = () => {};

  editor.cancelConstructionGesture();

  // Cancelling clears `constructionDrawing`, which is the flag pointer-up checks
  // before disarming — so without this, switching tool or mode after pressing
  // Cut left the next wall drag carving.
  assert.equal(editor.constructionCutArmed, false);
});

test('arming survives until something ends the gesture', () => {
  const editor = controller();
  editor.constructionCutArmed = false;
  editor.emitState = () => {};

  editor.armConstructionCut();
  assert.equal(editor.constructionCutArmed, true);

  editor.armConstructionCut(false);
  assert.equal(editor.constructionCutArmed, false);
});

test('opening defaults update only the fields they name', () => {
  const editor = controller();
  editor.constructionOpening = { kind: null, profile: 'round', dressed: true };
  editor.emitState = () => {};

  editor.setConstructionOpening({ profile: 'pointed' });
  assert.deepEqual(editor.constructionOpening, {
    kind: null,
    profile: 'pointed',
    dressed: true,
  });

  // Choosing a kind must not reset the profile the user just picked.
  editor.setConstructionOpening({ kind: 'window' });
  assert.deepEqual(editor.constructionOpening, {
    kind: 'window',
    profile: 'pointed',
    dressed: true,
  });

  // Clearing the kind is a real value, not an absent one.
  editor.setConstructionOpening({ kind: null });
  assert.equal(editor.constructionOpening.kind, null);
  assert.equal(editor.constructionOpening.profile, 'pointed');
});
