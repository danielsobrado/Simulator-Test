import { leaf, vineSegment } from './ProceduralWorkshopGeometry.js';
import { createRandom, mixSeed } from './ProceduralRandom.js';

/**
 * Facade ivy.
 *
 * Strands are grown in *facade space*: `x` runs along the host surface, `y` is
 * height, and `outward` is distance clear of the surface. A projection step maps
 * that to world space, which is what lets one growth algorithm serve both flat
 * walls and round towers — for a tower, `x` is arc length, exactly the
 * convention the component editor already uses for radial attachment surfaces
 * (`ProceduralWorkshopComponentController.updateAttachmentPreview`).
 *
 * Before 2026-07-25 this was planar-only and placed one or two leaves per node,
 * so ivy on a round tower grew through the wall and read as scattered confetti
 * rather than clumped growth.
 */

/**
 * Golden angle. Spreads leaves within a cluster evenly without the lattice
 * regularity of a fixed step — the same idiom `ForestBushGeometry` uses to
 * distribute foliage lobes.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Per-leaf colour multipliers over the shared foliage material.
 *
 * Kept close to 1 and varying mostly in hue: the material already carries the
 * green, and strong uncoordinated variation would read as noise rather than
 * foliage (05-…md §8).
 */
const LEAF_TINTS = Object.freeze([
  [1, 1, 1],
  [0.86, 1.05, 0.8],
  [1.12, 1, 0.86],
  [0.78, 0.92, 0.72],
  [1.04, 0.96, 0.78],
]);

function leafTint(recipe, stableIndex) {
  const hash = mixSeed(recipe.seed ^ 0x27d4eb2f, stableIndex);
  return LEAF_TINTS[hash % LEAF_TINTS.length];
}

/**
 * Map a facade-space point to world space.
 *
 * `planar` keeps the historical behaviour. `round` treats `x` as arc length so a
 * strand wraps the tower instead of sliding off a tangent plane, and reports the
 * surface angle as `facing` so leaves sit in the local tangent plane.
 */
function project(surface, x, y, outward) {
  // Stand off by however far the local masonry is laid proud of the nominal
  // surface, so growth drapes over relief instead of passing through it.
  if (surface.relief) outward += surface.relief.sample(x, y);
  if (surface.type === 'round') {
    const angle = x / surface.radius;
    const distance = surface.radius + outward;
    return {
      position: [
        surface.centerX + Math.sin(angle) * distance,
        y,
        surface.centerZ + Math.cos(angle) * distance,
      ],
      facing: angle,
    };
  }
  return {
    position: [surface.centerX + x, y, surface.frontZ + outward],
    facing: 0,
  };
}

/**
 * A clump of overlapping leaves at one growth node.
 *
 * Clumping is what separates ivy from scattered leaves: mass reads first, then
 * individual leaves inside it.
 */
function leafCluster(target, recipe, random, {
  x,
  y,
  outward,
  surface,
  count,
  radius,
  twist = 0,
  stableIndex,
}) {
  for (let index = 0; index < count; index += 1) {
    const spin = index * GOLDEN_ANGLE + twist;
    const spread = radius * (0.35 + random() * 0.45);
    const point = project(
      surface,
      x + Math.cos(spin) * spread,
      y + Math.sin(spin) * spread * 0.8,
      outward + 0.012 + random() * 0.03,
    );
    target.push(leaf({
      radius: radius * (0.62 + random() * 0.62),
      position: point.position,
      rotation: [
        (random() - 0.5) * 0.7,
        point.facing + twist + (random() - 0.5) * 0.8,
        (random() - 0.5) * 2.1,
      ],
      color: leafTint(recipe, stableIndex + index),
    }));
  }
}

function clusterSize(recipe, random) {
  const base = recipe.detail >= 3 ? 4 : recipe.detail >= 2 ? 3 : 2;
  return base + Math.floor(random() * 3);
}

export function buildProceduralFacadeIvy(recipe, {
  width,
  height,
  frontZ,
  centerX = 0,
  centerZ = 0,
  seedOffset,
  topAtX = () => height,
  preferredSide = 0,
  openings = [],
  radius = 0,
  surfaceType = 'planar',
  relief = null,
}) {
  if (!recipe.ivy) return [];
  const random = createRandom(mixSeed(recipe.seed, seedOffset));
  const geometries = [];
  let stableIndex = seedOffset * 1000;

  // A round host's facade width is its circumference, so strands may wrap.
  const surface = surfaceType === 'round' && radius > 0
    ? { type: 'round', radius, centerX, centerZ, relief }
    : { type: 'planar', frontZ, centerX, centerZ, relief };
  const facadeWidth = surface.type === 'round' ? Math.PI * 2 * radius : width;

  const stemCount = recipe.detail >= 3 ? 3 : recipe.detail >= 2 ? 2 : 1;
  const side = preferredSide === -1 || preferredSide === 1
    ? preferredSide
    : random() < 0.5 ? -1 : 1;
  const baseAnchor = side * facadeWidth * (0.28 + random() * 0.13);

  /**
   * An opening's position in facade space.
   *
   * `resolveWorkshopOpeningLayout` gives round hosts `centerX: 0` and carries the
   * real position in `angle`, so reading `centerX` on a tower would place every
   * opening at arc zero and route strands around the wrong part of the wall.
   */
  const openingFacadeX = (opening) => (surface.type === 'round'
    ? (opening.angle ?? 0) * surface.radius
    : opening.centerX);

  /** Signed facade-space distance, taking the short way round on a tower. */
  const facadeDelta = (a, b) => {
    if (surface.type !== 'round') return a - b;
    const half = facadeWidth / 2;
    let delta = (a - b) % facadeWidth;
    if (delta > half) delta -= facadeWidth;
    if (delta < -half) delta += facadeWidth;
    return delta;
  };

  const routeAroundOpenings = (point) => {
    for (const opening of openings) {
      const margin = 0.16;
      const top = opening.bottom + opening.springHeight + opening.radius;
      const halfWidth = opening.width / 2 + margin;
      const openingX = openingFacadeX(opening);
      if (
        point[1] >= opening.bottom - margin
        && point[1] <= top + margin
        && Math.abs(facadeDelta(point[0], openingX)) < halfWidth
      ) {
        point[0] = openingX + side * halfWidth;
      }
    }
    return point;
  };

  const addVine = (from, to, vineRadius) => {
    const start = project(surface, from[0], from[1], from[2]);
    const end = project(surface, to[0], to[1], to[2]);
    geometries.push(vineSegment({
      start: start.position,
      end: end.position,
      radius: vineRadius,
    }));
  };

  /**
   * Grow one strand. `climb` of -1 descends, which is how eaves and window-head
   * strands trail downward instead of sprouting upward from nothing.
   */
  const growStrand = ({ anchorX, anchorY, nodeCount, spreadScale, direction, reach }) => {
    let previous = routeAroundOpenings([
      anchorX + (random() - 0.5) * 0.12,
      anchorY,
      0.045,
    ]);
    for (let node = 1; node <= nodeCount; node += 1) {
      const progress = node / nodeCount;
      const wave = Math.sin(progress * (7.5 + spreadScale * 0.8) + seedOffset * 0.07);
      const x = anchorX
        + wave * facadeWidth * (0.035 + spreadScale * 0.006)
        + (random() - 0.5) * facadeWidth * 0.025;
      const current = routeAroundOpenings([
        x,
        anchorY + direction * reach * progress,
        0.05 + Math.sin(progress * 5 + spreadScale) * 0.012,
      ]);
      addVine(previous, current, 0.021 + recipe.detail * 0.003 + (1 - progress) * 0.005);

      // Density falls off toward the growing tip.
      const clusters = node % 3 === 0 ? 2 : 1;
      for (let index = 0; index < clusters; index += 1) {
        leafCluster(geometries, recipe, random, {
          x: current[0],
          y: current[1],
          outward: current[2],
          surface,
          count: clusterSize(recipe, random),
          radius: 0.085 + random() * 0.055 + (1 - progress) * 0.02,
          twist: spreadScale * 0.18,
          stableIndex,
        });
        stableIndex += 8;
      }

      if (node >= 2 && node % 3 === 0) {
        const branchSide = (node + spreadScale) % 2 === 0 ? -1 : 1;
        const branchLength = facadeWidth * (0.045 + random() * 0.035);
        const branchEnd = routeAroundOpenings([
          current[0] + branchSide * branchLength,
          current[1] + direction * branchLength * (0.35 + random() * 0.5),
          current[2] + 0.008,
        ]);
        addVine(current, branchEnd, 0.017 + recipe.detail * 0.002);
        leafCluster(geometries, recipe, random, {
          x: branchEnd[0],
          y: branchEnd[1],
          outward: branchEnd[2],
          surface,
          count: clusterSize(recipe, random),
          radius: 0.1 + random() * 0.05,
          twist: branchSide * 0.25,
          stableIndex,
        });
        stableIndex += 8;
      }
      previous = current;
    }
  };

  // Ground-up strands: the main growth.
  for (let stem = 0; stem < stemCount; stem += 1) {
    const anchorX = baseAnchor + (stem - (stemCount - 1) / 2) * facadeWidth * 0.055;
    const localTop = Math.max(0.4, topAtX(anchorX));
    growStrand({
      anchorX,
      anchorY: 0.05 + random() * 0.08,
      nodeCount: 7 + recipe.detail * 2 + stem,
      spreadScale: stem,
      direction: 1,
      reach: localTop * (0.5 + stem * 0.09 + random() * 0.09),
    });
  }

  // Edge-seeded strands trailing down from the eaves, and from window heads.
  // In the reference these downward trails are as prominent as the climbing
  // growth, and they are what tie the roof into the wall.
  if (recipe.detail >= 2) {
    // When the caller named a side it is steering ivy away from something — an
    // attached tower wing, on the manor — so the trailing strand has to honour
    // it too. Only a randomly chosen side is free to spread the other way.
    const explicitSide = preferredSide === -1 || preferredSide === 1;
    const eavesX = (explicitSide ? side : -side)
      * facadeWidth * (0.17 + random() * 0.14);
    growStrand({
      anchorX: eavesX,
      anchorY: Math.max(0.6, topAtX(eavesX)) - 0.08,
      nodeCount: 5 + recipe.detail,
      spreadScale: 1,
      direction: -1,
      reach: Math.max(0.5, height * (0.28 + random() * 0.2)),
    });
  }
  for (const opening of openings) {
    if (recipe.detail < 3 || random() < 0.45) continue;
    const headY = opening.bottom + opening.springHeight + opening.radius;
    leafCluster(geometries, recipe, random, {
      x: openingFacadeX(opening) + side * (opening.width / 2 + 0.1),
      y: headY - random() * 0.2,
      outward: 0.055,
      surface,
      count: clusterSize(recipe, random),
      radius: 0.09 + random() * 0.05,
      twist: side * 0.3,
      stableIndex,
    });
    stableIndex += 8;
  }

  // Ground-contact skirt, where growth is densest.
  const rootClusters = 2 + recipe.detail;
  for (let index = 0; index < rootClusters; index += 1) {
    const spread = (random() - 0.5) * facadeWidth * 0.16;
    leafCluster(geometries, recipe, random, {
      x: baseAnchor + spread,
      y: 0.08 + random() * Math.min(0.8, height * 0.16),
      outward: 0.055 + random() * 0.045,
      surface,
      count: clusterSize(recipe, random) + 1,
      radius: 0.1 + random() * 0.07,
      twist: spread * 0.5,
      stableIndex,
    });
    stableIndex += 8;
  }

  for (const geometry of geometries) {
    geometry.userData.workshopSemantic = Object.freeze({ kind: 'ivy' });
  }
  return geometries;
}
