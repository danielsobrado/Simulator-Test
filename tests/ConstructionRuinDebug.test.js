import assert from 'node:assert/strict';
import test from 'node:test';
import { RUIN_REMOVAL_REASON } from '../src/editor/construction/masonry/ConstructionSupportRoles.js';
import {
  isConstructionRuinDebugEnabled,
  ruinDebugStateForRemoval,
  RUIN_DEBUG_STATE,
} from '../src/editor/construction/render/ConstructionRuinDebug.js';

test('constructionRuinDebug query enables the overlay', () => {
  assert.equal(isConstructionRuinDebugEnabled(''), false);
  assert.equal(isConstructionRuinDebugEnabled('?foo=1'), false);
  assert.equal(isConstructionRuinDebugEnabled('?constructionRuinDebug=1'), true);
  assert.equal(isConstructionRuinDebugEnabled('constructionRuinDebug=1'), true);
});

test('removal reasons map to ghost colour classes', () => {
  assert.equal(
    ruinDebugStateForRemoval(RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED),
    RUIN_DEBUG_STATE.ARCH,
  );
  assert.equal(
    ruinDebugStateForRemoval(RUIN_REMOVAL_REASON.UNSUPPORTED),
    RUIN_DEBUG_STATE.UNSUPPORTED,
  );
  assert.equal(
    ruinDebugStateForRemoval(RUIN_REMOVAL_REASON.CLUSTER_DAMAGE),
    RUIN_DEBUG_STATE.PRELIMINARY,
  );
});
