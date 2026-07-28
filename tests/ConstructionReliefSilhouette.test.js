import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildModuleMasonry,
} from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { packCurvedWall } from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';

/**
 * Software orthographic silhouette of merged stone geometry.
 *
 * Projects world X/Y into a binary mask. Relief must not grow the outer wall
 * footprint, openings, or ruined crown — only interior face shading changes.
 */

const WIDTH = 320;
const HEIGHT = 160;

function createQaWall() {
  const soft = constructionStyle('soft-limestone-rubble');
  // Straight then curved: first half along +X, second bends toward +Z.
  const path = createCubicBezierPathFromStroke([
    [0, 0],
    [6, 0],
    [12, 0],
    [14, 1],
    [18, 4],
    [21, 7],
    [24, 8],
  ], { simplifyTolerance: 0.02 });
  const doorSegment = path.segments[0].id;
  const windowSegment = path.segments[Math.min(2, path.segments.length - 1)].id;
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'qa-relief-silhouette',
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key: 'soft-limestone-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path,
    features: [
      {
        id: 'door-1',
        kind: 'door',
        segmentId: doorSegment,
        arcFraction: 0.55,
        width: 2.2,
        height: 2.6,
        sill: 0,
        profile: 'round',
        dressed: true,
        group: null,
      },
      {
        id: 'window-1',
        kind: 'window',
        segmentId: windowSegment,
        arcFraction: 0.4,
        width: 1.2,
        height: 1.4,
        sill: 1.1,
        profile: 'round',
        dressed: true,
        group: null,
      },
    ],
    top: {
      style: 'ruined',
      base: 3.5,
      profile: [
        {
          segmentId: path.segments[Math.floor(path.segments.length / 2)].id,
          arcFraction: 0.2,
          height: 3.5,
        },
        {
          segmentId: path.segments[Math.floor(path.segments.length / 2)].id,
          arcFraction: 0.8,
          height: 2.1,
        },
      ],
    },
  });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style: soft });
  const openings = record.path.features.map((feature, index) => ({
    ...feature,
    s: Math.min(
      arcTable.totalLength - 1,
      Math.max(0.01, arcTable.totalLength * (index === 0 ? 0.28 : 0.62)),
    ),
  }));

  const packed = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style: soft,
    thickness: record.dimensions.thickness,
    seed: record.seed,
    seedOffset: 0,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
    openings,
  });
  return { record, arcTable, placements: packed.stones, openings, profile };
}

function rasterizeStoneSilhouette(geometry, {
  width = WIDTH,
  height = HEIGHT,
  bounds = null,
} = {}) {
  geometry.computeBoundingBox();
  const box = bounds ?? geometry.boundingBox;
  const pad = bounds ? 0 : 0.15;
  const minX = box.min.x - pad;
  const maxX = box.max.x + pad;
  const minY = box.min.y - pad;
  const maxY = box.max.y + pad;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const mask = new Uint8Array(width * height);

  const position = geometry.getAttribute('position');
  const toPixel = (x, y) => ([
    Math.floor(((x - minX) / spanX) * (width - 1)),
    Math.floor(((maxY - y) / spanY) * (height - 1)),
  ]);

  const coverTriangle = (ax, ay, bx, by, cx, cy) => {
    const [x0, y0] = toPixel(ax, ay);
    const [x1, y1] = toPixel(bx, by);
    const [x2, y2] = toPixel(cx, cy);
    const minPx = Math.max(0, Math.min(x0, x1, x2));
    const maxPx = Math.min(width - 1, Math.max(x0, x1, x2));
    const minPy = Math.max(0, Math.min(y0, y1, y2));
    const maxPy = Math.min(height - 1, Math.max(y0, y1, y2));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return;
    for (let py = minPy; py <= maxPy; py += 1) {
      for (let px = minPx; px <= maxPx; px += 1) {
        const w0 = (x1 - px) * (y2 - py) - (x2 - px) * (y1 - py);
        const w1 = (x2 - px) * (y0 - py) - (x0 - px) * (y2 - py);
        const w2 = (x0 - px) * (y1 - py) - (x1 - px) * (y0 - py);
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
          mask[py * width + px] = 1;
        }
      }
    }
  };

  for (let index = 0; index < position.count; index += 3) {
    coverTriangle(
      position.getX(index), position.getY(index),
      position.getX(index + 1), position.getY(index + 1),
      position.getX(index + 2), position.getY(index + 2),
    );
  }

  return { mask, width, height, minX, maxX, minY, maxY };
}

function differingFraction(a, b) {
  assert.equal(a.mask.length, b.mask.length);
  let differ = 0;
  for (let index = 0; index < a.mask.length; index += 1) {
    if (a.mask[index] !== b.mask[index]) differ += 1;
  }
  return differ / a.mask.length;
}

function growthInsideRegion(onMask, offMask, regionMask = null) {
  let growth = 0;
  let regionPixels = 0;
  for (let index = 0; index < onMask.length; index += 1) {
    if (regionMask && !regionMask[index]) continue;
    regionPixels += 1;
    // Flat silhouette empty, relief covered → footprint growth.
    if (offMask[index] === 0 && onMask[index] === 1) growth += 1;
  }
  return { growth, regionPixels };
}

/** Empty pixels far from the flat silhouette — true voids (openings / breaches). */
function deepVoidMask(flatMask, width, height, margin) {
  const covered = flatMask;
  const voids = new Uint8Array(flatMask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (covered[index]) continue;
      let nearCovered = false;
      for (let dy = -margin; dy <= margin && !nearCovered; dy += 1) {
        for (let dx = -margin; dx <= margin && !nearCovered; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (covered[ny * width + nx]) nearCovered = true;
        }
      }
      if (!nearCovered) voids[index] = 1;
    }
  }
  return voids;
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('relief does not meaningfully grow the wall silhouette', () => {
  const { record, arcTable, placements } = createQaWall();
  const materials = createConstructionMaterials(record);
  const options = {
    record,
    materials,
    arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
    lodBand: 'near',
  };
  const withRelief = buildModuleMasonry(placements, options);
  const withoutRelief = buildModuleMasonry(placements, {
    ...options,
    disableRelief: true,
  });

  const stoneOn = withRelief.meshes[1].geometry;
  const stoneOff = withoutRelief.meshes[1].geometry;
  stoneOn.computeBoundingBox();
  stoneOff.computeBoundingBox();
  const sharedBounds = {
    min: {
      x: Math.min(stoneOn.boundingBox.min.x, stoneOff.boundingBox.min.x) - 0.15,
      y: Math.min(stoneOn.boundingBox.min.y, stoneOff.boundingBox.min.y) - 0.15,
      z: Math.min(stoneOn.boundingBox.min.z, stoneOff.boundingBox.min.z),
    },
    max: {
      x: Math.max(stoneOn.boundingBox.max.x, stoneOff.boundingBox.max.x) + 0.15,
      y: Math.max(stoneOn.boundingBox.max.y, stoneOff.boundingBox.max.y) + 0.15,
      z: Math.max(stoneOn.boundingBox.max.z, stoneOff.boundingBox.max.z),
    },
  };
  const silhouetteOn = rasterizeStoneSilhouette(stoneOn, { bounds: sharedBounds });
  const silhouetteOff = rasterizeStoneSilhouette(stoneOff, { bounds: sharedBounds });

  const outerDiff = differingFraction(silhouetteOn, silhouetteOff);
  assert.ok(
    outerDiff <= 0.0025,
    `outer silhouette differing pixels ${(outerDiff * 100).toFixed(3)}% > 0.25%`,
  );

  // Global growth vs flat ExtrudeGeometry may include a few outline pixels from
  // topology differences; keep it inside the same 0.25% silhouette budget.
  const globalGrowth = growthInsideRegion(silhouetteOn.mask, silhouetteOff.mask);
  const growthFraction = globalGrowth.growth / globalGrowth.regionPixels;
  assert.ok(
    growthFraction <= 0.0025,
    `wall silhouette grew by ${(growthFraction * 100).toFixed(3)}% > 0.25%`,
  );

  // Opening / void integrity: deep empty regions in the flat silhouette must
  // stay empty. Margin ignores one-pixel outline AA between mesh topologies.
  const voidRegion = deepVoidMask(
    silhouetteOff.mask,
    silhouetteOn.width,
    silhouetteOn.height,
    2,
  );
  const voidGrowth = growthInsideRegion(
    silhouetteOn.mask,
    silhouetteOff.mask,
    voidRegion,
  );
  assert.equal(
    voidGrowth.growth,
    0,
    `opening/void silhouette grew by ${voidGrowth.growth} pixels`,
  );

  // Ruined-top band: upper 20% of the mask.
  const ruinedRegion = new Uint8Array(silhouetteOn.mask.length);
  const ruinedRows = Math.floor(silhouetteOn.height * 0.2);
  for (let index = 0; index < silhouetteOn.width * ruinedRows; index += 1) {
    ruinedRegion[index] = 1;
  }
  const ruinedGrowth = growthInsideRegion(
    silhouetteOn.mask,
    silhouetteOff.mask,
    ruinedRegion,
  );
  const ruinedFraction = ruinedGrowth.regionPixels > 0
    ? ruinedGrowth.growth / ruinedGrowth.regionPixels
    : 0;
  assert.ok(
    ruinedFraction <= 0.0025,
    `ruined-top silhouette grew by ${(ruinedFraction * 100).toFixed(3)}% > 0.25%`,
  );

  assert.ok(withRelief.stats.reliefStones > 0);
  assert.equal(withRelief.meshes.length, withoutRelief.meshes.length);
  assert.equal(withRelief.stats.mortarTriangles, withoutRelief.stats.mortarTriangles);

  for (const mesh of [...withRelief.meshes, ...withoutRelief.meshes]) {
    mesh.geometry.dispose();
  }
});
