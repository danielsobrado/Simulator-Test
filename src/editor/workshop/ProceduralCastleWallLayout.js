import { getComponentTransform } from './ProceduralWorkshopComponentTransforms.js';

const MAX_OPENINGS = 6;
const MIN_OPENING_WIDTH = 1.05;
const MAX_OPENING_WIDTH = 2.5;
const MIN_SPRING_HEIGHT = 1.15;
const MIN_EDITED_SPRING_HEIGHT = 0.45;
const OPENING_SIDE_CLEARANCE = 0.12;
const OPENING_PROFILE_SAMPLES = 16;
const TOP_CLEARANCE = 0.72;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function openingTargetWidth(shape) {
  return shape === 'stepped' ? 3.05 : 3.55;
}

export function getCastleWallOpeningCount(recipe) {
  if (!recipe.windows) return 0;
  return clamp(Math.round(recipe.width / openingTargetWidth(recipe.shape)), 1, MAX_OPENINGS);
}

function minimumTopAcrossOpening(recipe, centerX, width) {
  const trimAllowance = Math.max(0.2, width * 0.12);
  const halfSpan = width / 2 + trimAllowance;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= OPENING_PROFILE_SAMPLES; index += 1) {
    const progress = index / OPENING_PROFILE_SAMPLES;
    const x = centerX - halfSpan + halfSpan * 2 * progress;
    minimum = Math.min(minimum, getCastleWallTopHeight(recipe, x));
  }
  return minimum;
}

function transformOpening(recipe, opening, index) {
  const transform = getComponentTransform(recipe.componentTransforms, `arch-${index + 1}`);
  const bayLeft = -recipe.width / 2 + opening.bayWidth * index;
  const bayRight = bayLeft + opening.bayWidth;
  const maximumWidth = Math.min(
    MAX_OPENING_WIDTH,
    Math.max(MIN_OPENING_WIDTH, opening.bayWidth - OPENING_SIDE_CLEARANCE * 2),
  );
  const width = clamp(
    opening.width * transform.scale[0],
    MIN_OPENING_WIDTH,
    maximumWidth,
  );
  const centerClearance = width / 2 + OPENING_SIDE_CLEARANCE;
  const centerX = clamp(
    opening.centerX + transform.position[0],
    bayLeft + centerClearance,
    bayRight - centerClearance,
  );
  const radius = width / 2;
  const minimumProfileTop = minimumTopAcrossOpening(recipe, centerX, width);
  const maximumOpeningTop = Math.max(
    MIN_EDITED_SPRING_HEIGHT + radius,
    minimumProfileTop - TOP_CLEARANCE,
  );
  const springHeight = clamp(
    opening.springHeight * transform.scale[1],
    MIN_EDITED_SPRING_HEIGHT,
    Math.max(MIN_EDITED_SPRING_HEIGHT, maximumOpeningTop - radius),
  );
  const bottom = clamp(
    transform.position[1],
    0,
    Math.max(0, maximumOpeningTop - springHeight - radius),
  );

  return Object.freeze({
    centerX,
    width,
    radius,
    springHeight,
    bottom,
    bayWidth: opening.bayWidth,
  });
}

export function getCastleWallOpenings(recipe) {
  const count = getCastleWallOpeningCount(recipe);
  if (count === 0) return Object.freeze([]);

  const bayWidth = recipe.width / count;
  const minimumSpringHeight = Math.min(
    MIN_SPRING_HEIGHT,
    Math.max(0.55, recipe.height * 0.35),
  );
  const maximumRadius = Math.max(
    MIN_OPENING_WIDTH / 2,
    recipe.height - TOP_CLEARANCE - minimumSpringHeight,
  );
  const width = clamp(
    Math.min(bayWidth * 0.62, maximumRadius * 2),
    MIN_OPENING_WIDTH,
    MAX_OPENING_WIDTH,
  );
  const radius = width / 2;
  const maximumSpringHeight = Math.max(0.45, recipe.height - radius - TOP_CLEARANCE);
  const springHeight = clamp(
    recipe.height * (recipe.shape === 'stepped' ? 0.49 : 0.45),
    Math.min(minimumSpringHeight, maximumSpringHeight),
    maximumSpringHeight,
  );

  return Object.freeze(Array.from({ length: count }, (_, index) => transformOpening(
    recipe,
    Object.freeze({
      centerX: -recipe.width / 2 + bayWidth * (index + 0.5),
      width,
      radius,
      springHeight,
      bottom: 0,
      bayWidth,
    }),
    index,
  )));
}

export function getCastleWallTopHeight(recipe, x) {
  const normalized = clamp(x / recipe.width + 0.5, 0, 1);
  const openingCount = Math.max(1, getCastleWallOpeningCount(recipe));

  if (recipe.shape === 'stepped') {
    const bayCrest = 0.5 + 0.5 * Math.cos(normalized * openingCount * Math.PI * 2);
    const centerLift = 1 - Math.abs(normalized * 2 - 1);
    return recipe.height * (0.76 + bayCrest * 0.14 + centerLift * 0.08);
  }

  if (recipe.shape === 'tapered') {
    const centerLift = 1 - Math.abs(normalized * 2 - 1);
    const brokenEdge = Math.sin(normalized * Math.PI * 7 + recipe.seed * 0.0001) * 0.025;
    return recipe.height * (0.67 + centerLift * 0.27 + brokenEdge);
  }

  return recipe.height;
}

export function getCastleOpeningHalfWidth(opening, y) {
  const localY = y - opening.bottom;
  if (localY < 0 || localY > opening.springHeight + opening.radius) return 0;
  if (localY <= opening.springHeight) return opening.width / 2;
  const archY = localY - opening.springHeight;
  return Math.sqrt(Math.max(0, opening.radius ** 2 - archY ** 2));
}

export function isInsideCastleOpening(opening, x, y, padding = 0) {
  const halfWidth = getCastleOpeningHalfWidth(opening, y);
  return halfWidth > 0 && Math.abs(x - opening.centerX) < halfWidth + padding;
}

export function getCastleWallButtressPositions(recipe, openings) {
  if (openings.length === 0) {
    return Object.freeze([-recipe.width / 2, recipe.width / 2]);
  }
  const positions = [-recipe.width / 2, recipe.width / 2];
  for (let index = 0; index < openings.length - 1; index += 1) {
    positions.push((openings[index].centerX + openings[index + 1].centerX) / 2);
  }
  return Object.freeze(positions.sort((left, right) => left - right));
}
