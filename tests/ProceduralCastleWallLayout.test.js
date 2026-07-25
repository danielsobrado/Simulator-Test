import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCastleWallButtressPositions,
  getCastleWallOpeningCount,
  getCastleWallOpenings,
  getCastleWallTopHeight,
  intersectsCastleOpening,
  isInsideCastleOpening,
} from '../src/editor/workshop/ProceduralCastleWallLayout.js';

const recipe = Object.freeze({
  width: 14,
  height: 7,
  shape: 'stepped',
  windows: true,
  seed: 1848,
});

test('castle wall layout derives bounded repeated openings', () => {
  const openings = getCastleWallOpenings(recipe);
  assert.equal(getCastleWallOpeningCount(recipe), 5);
  assert.equal(openings.length, 5);
  assert.ok(openings.every((opening) => opening.width >= 1.05 && opening.width <= 2.5));
  assert.ok(openings.every((opening) => opening.springHeight + opening.radius < recipe.height));
  assert.deepEqual(getCastleWallOpenings(recipe), openings);
});

test('castle wall arches are open below the crown and closed above it', () => {
  const [opening] = getCastleWallOpenings(recipe);
  assert.equal(isInsideCastleOpening(opening, opening.centerX, opening.springHeight), true);
  assert.equal(
    isInsideCastleOpening(opening, opening.centerX, opening.springHeight + opening.radius + 0.1),
    false,
  );
  assert.equal(isInsideCastleOpening(opening, opening.centerX + opening.width, 0.5), false);
});

test('stone boxes intersecting an opening edge are reserved from wall masonry', () => {
  const [opening] = getCastleWallOpenings(recipe);
  const stoneHalfWidth = 0.45;
  const stoneHalfHeight = 0.24;
  const overlappingX = opening.centerX + opening.width / 2 + stoneHalfWidth * 0.7;

  assert.equal(
    isInsideCastleOpening(opening, overlappingX, 0.8),
    false,
  );
  assert.equal(
    intersectsCastleOpening(
      opening,
      overlappingX,
      0.8,
      stoneHalfWidth,
      stoneHalfHeight,
    ),
    true,
  );
  assert.equal(
    intersectsCastleOpening(
      opening,
      overlappingX,
      opening.bottom + opening.springHeight + opening.radius + 1,
      stoneHalfWidth,
      stoneHalfHeight,
    ),
    false,
  );
});

test('castle wall top profile remains bounded and buttresses cover ends and piers', () => {
  const openings = getCastleWallOpenings(recipe);
  const samples = Array.from({ length: 33 }, (_, index) => (
    getCastleWallTopHeight(recipe, -recipe.width / 2 + recipe.width * index / 32)
  ));
  assert.ok(samples.every((height) => height >= recipe.height * 0.7 && height <= recipe.height));
  assert.equal(getCastleWallButtressPositions(recipe, openings).length, openings.length + 1);
});

test('castle wall openings can be disabled without changing profile validity', () => {
  const solidRecipe = { ...recipe, windows: false };
  assert.equal(getCastleWallOpeningCount(solidRecipe), 0);
  assert.deepEqual(getCastleWallOpenings(solidRecipe), []);
  assert.deepEqual(
    getCastleWallButtressPositions(solidRecipe, []),
    [-solidRecipe.width / 2, solidRecipe.width / 2],
  );
});

test('short castle walls keep arch crowns inside the authored height', () => {
  const shortRecipe = { ...recipe, width: 12, height: 2 };
  const openings = getCastleWallOpenings(shortRecipe);
  assert.ok(openings.length > 0);
  assert.ok(openings.every((opening) => (
    opening.springHeight + opening.radius <= shortRecipe.height
  )));
});
