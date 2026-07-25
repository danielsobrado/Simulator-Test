import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCastleWallOpenings,
  getCastleWallTopHeight,
} from '../src/editor/workshop/ProceduralCastleWallLayout.js';

const recipe = Object.freeze({
  width: 14,
  height: 7,
  shape: 'stepped',
  windows: true,
  seed: 1848,
  componentTransforms: {},
});

function minimumTopAcrossOpening(sourceRecipe, opening) {
  const trimAllowance = Math.max(0.2, opening.width * 0.12);
  const halfSpan = opening.width / 2 + trimAllowance;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= 64; index += 1) {
    const x = opening.centerX - halfSpan + halfSpan * 2 * index / 64;
    minimum = Math.min(minimum, getCastleWallTopHeight(sourceRecipe, x));
  }
  return minimum;
}

test('semantic arch edits regenerate opening position and dimensions', () => {
  const base = getCastleWallOpenings(recipe);
  const edited = getCastleWallOpenings({
    ...recipe,
    componentTransforms: {
      'arch-1': {
        position: [0.35, 0.4, 0],
        rotation: [0, 0, 0],
        scale: [1.2, 1.35, 1],
      },
    },
  });

  assert.ok(edited[0].centerX > base[0].centerX);
  assert.ok(edited[0].bottom > base[0].bottom);
  assert.ok(edited[0].width > base[0].width);
  assert.ok(edited[0].springHeight > base[0].springHeight);
  assert.deepEqual(edited.slice(1), base.slice(1));
});

test('large arch edits remain inside their bay and wall profile', () => {
  const openings = getCastleWallOpenings({
    ...recipe,
    componentTransforms: {
      'arch-2': {
        position: [20, 20, 0],
        rotation: [0, 0, 0],
        scale: [3, 3, 1],
      },
    },
  });
  const opening = openings[1];
  const bayLeft = -recipe.width / 2 + opening.bayWidth;
  const bayRight = bayLeft + opening.bayWidth;
  const top = getCastleWallTopHeight(recipe, opening.centerX);

  assert.ok(opening.centerX - opening.width / 2 >= bayLeft);
  assert.ok(opening.centerX + opening.width / 2 <= bayRight);
  assert.ok(opening.bottom + opening.springHeight + opening.radius <= top);
});

test('moved narrow arches remain below the lowest covered top-profile sample', () => {
  const editedRecipe = {
    ...recipe,
    componentTransforms: {
      'arch-2': {
        position: [0.75, 20, 0],
        rotation: [0, 0, 0],
        scale: [0.6, 4, 1],
      },
    },
  };
  const opening = getCastleWallOpenings(editedRecipe)[1];
  const crown = opening.bottom + opening.springHeight + opening.radius;
  assert.ok(crown <= minimumTopAcrossOpening(editedRecipe, opening));
});

test('short walls keep transformed arch crowns inside the authored height', () => {
  const shortRecipe = {
    ...recipe,
    width: 12,
    height: 2,
    componentTransforms: {
      'arch-1': {
        position: [0.2, 1, 0],
        rotation: [0, 0, 0],
        scale: [1.4, 2, 1],
      },
    },
  };
  const openings = getCastleWallOpenings(shortRecipe);
  assert.ok(openings.every((opening) => (
    opening.bottom + opening.springHeight + opening.radius <= shortRecipe.height
  )));
});
