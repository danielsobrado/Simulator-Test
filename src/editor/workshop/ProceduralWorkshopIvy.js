import { leaf, vineSegment } from './ProceduralWorkshopGeometry.js';
import { createRandom, mixSeed } from './ProceduralRandom.js';

function leafAt(target, random, point, radius, facing = 0) {
  target.push(leaf({
    radius,
    position: [
      point[0] + (random() - 0.5) * radius * 0.45,
      point[1] + (random() - 0.5) * radius * 0.32,
      point[2] + 0.012 + random() * 0.025,
    ],
    rotation: [
      (random() - 0.5) * 0.5,
      facing + (random() - 0.5) * 0.45,
      (random() - 0.5) * 1.8,
    ],
  }));
}

export function buildProceduralFacadeIvy(recipe, {
  width,
  height,
  frontZ,
  centerX = 0,
  seedOffset,
  topAtX = () => height,
  preferredSide = 0,
  openings = [],
}) {
  if (!recipe.ivy) return [];
  const random = createRandom(mixSeed(recipe.seed, seedOffset));
  const geometries = [];
  const stemCount = recipe.detail >= 3 ? 3 : recipe.detail >= 2 ? 2 : 1;
  const side = preferredSide === -1 || preferredSide === 1
    ? preferredSide
    : random() < 0.5 ? -1 : 1;
  const baseAnchor = centerX + side * width * (0.28 + random() * 0.13);
  const routeAroundOpenings = (point) => {
    for (const opening of openings) {
      const margin = 0.16;
      const top = opening.bottom + opening.springHeight + opening.radius;
      const halfWidth = opening.width / 2 + margin;
      if (
        point[1] >= opening.bottom - margin
        && point[1] <= top + margin
        && Math.abs(point[0] - opening.centerX) < halfWidth
      ) {
        point[0] = opening.centerX + side * halfWidth;
      }
    }
    return point;
  };

  for (let stem = 0; stem < stemCount; stem += 1) {
    const nodeCount = 7 + recipe.detail * 2 + stem;
    const stemSpread = (stem - (stemCount - 1) / 2) * width * 0.055;
    let previous = routeAroundOpenings([
      baseAnchor + stemSpread + (random() - 0.5) * 0.12,
      0.05 + random() * 0.08,
      frontZ + 0.045 + stem * 0.008,
    ]);
    for (let node = 1; node <= nodeCount; node += 1) {
      const progress = node / nodeCount;
      const wave = Math.sin(progress * (7.5 + stem * 0.8) + seedOffset * 0.07);
      const x = baseAnchor + stemSpread
        + wave * width * (0.035 + stem * 0.006)
        + (random() - 0.5) * width * 0.025;
      const localTop = Math.max(0.4, topAtX(x));
      const climb = localTop * (0.5 + stem * 0.09 + random() * 0.09);
      const current = routeAroundOpenings([
        x,
        0.06 + progress * climb,
        frontZ + 0.05 + Math.sin(progress * 5 + stem) * 0.012,
      ]);
      geometries.push(vineSegment({
        start: previous,
        end: current,
        radius: 0.021 + recipe.detail * 0.003 + (1 - progress) * 0.005,
      }));

      const leafCount = node % 3 === 0 ? 2 : 1;
      for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
        leafAt(
          geometries,
          random,
          current,
          0.105 + random() * 0.075 + (1 - progress) * 0.025,
          stem * 0.18,
        );
      }

      if (node >= 2 && node % 3 === 0) {
        const branchSide = (node + stem) % 2 === 0 ? -1 : 1;
        const branchLength = width * (0.045 + random() * 0.035);
        const branchEnd = routeAroundOpenings([
          current[0] + branchSide * branchLength,
          current[1] + branchLength * (0.35 + random() * 0.5),
          current[2] + 0.008,
        ]);
        geometries.push(vineSegment({
          start: current,
          end: branchEnd,
          radius: 0.017 + recipe.detail * 0.002,
        }));
        leafAt(geometries, random, branchEnd, 0.12 + random() * 0.065, branchSide * 0.25);
        if (recipe.detail >= 2) {
          leafAt(geometries, random, [
            (current[0] + branchEnd[0]) / 2,
            (current[1] + branchEnd[1]) / 2,
            branchEnd[2],
          ], 0.09 + random() * 0.05, -branchSide * 0.2);
        }
      }
      previous = current;
    }
  }

  const rootLeaves = 5 + recipe.detail * 3;
  for (let index = 0; index < rootLeaves; index += 1) {
    const spread = (random() - 0.5) * width * 0.16;
    const point = routeAroundOpenings([
      baseAnchor + spread,
      0.08 + random() * Math.min(0.8, height * 0.16),
      frontZ + 0.055 + random() * 0.045,
    ]);
    leafAt(geometries, random, point, 0.12 + random() * 0.09, spread * 0.5);
  }
  for (const geometry of geometries) {
    geometry.userData.workshopSemantic = Object.freeze({ kind: 'ivy' });
  }
  return geometries;
}
