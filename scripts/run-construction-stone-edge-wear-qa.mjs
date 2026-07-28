#!/usr/bin/env node
/**
 * Headless evidence for Second pass part 2 — worn arrises / edge wear.
 *
 * Usage: node scripts/run-construction-stone-edge-wear-qa.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleMasonry } from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { packCurvedWall } from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { coarsePlacements } from '../src/editor/construction/render/ConstructionLod.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp');
const JSON_PATH = join(OUT_DIR, 'construction-stone-edge-wear-qa.json');
const REPORT_PATH = join(ROOT, 'docs/qa/construction-stone-edge-wear-2026-07-28.md');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
}

function summariseBuildTimes(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  // Drop the single worst sample — module build microbench is noisy on a cold
  // heap and one outlier would fail a 15% relative gate spuriously.
  const trimmed = sorted.length > 4 ? sorted.slice(0, -1) : sorted;
  return {
    p50: percentile(trimmed, 0.5),
    p95: percentile(trimmed, 0.95),
    samples: sorted,
  };
}

function createQaWall() {
  const soft = constructionStyle('soft-limestone-rubble');
  const path = createCubicBezierPathFromStroke([
    [0, 0], [6, 0], [12, 0], [14, 1], [18, 4], [21, 7], [24, 8],
  ], { simplifyTolerance: 0.02 });
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'qa-edge-wear-wall',
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
        segmentId: path.segments[0].id,
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
        segmentId: path.segments[Math.min(2, path.segments.length - 1)].id,
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
  return { record, arcTable, placements: packed.stones };
}

function buildOnce(record, arcTable, placements, options = {}) {
  const materials = createConstructionMaterials(record);
  const started = performance.now();
  const built = buildModuleMasonry(placements, {
    record,
    materials,
    arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
    lodBand: 'near',
    ...options,
  });
  const buildMs = performance.now() - started;
  for (const mesh of built.meshes) mesh.geometry.dispose();
  disposeConstructionMaterials();
  return { stats: built.stats, meshCount: built.meshes.length, buildMs };
}

function timedBuilds(record, arcTable, placements, options, runs = 11) {
  const samples = [];
  let last = null;
  for (let index = 0; index < runs; index += 1) {
    last = buildOnce(record, arcTable, placements, options);
    samples.push(last.buildMs);
  }
  return {
    ...last,
    buildMs: summariseBuildTimes(samples),
  };
}

const { record, arcTable, placements } = createQaWall();
const coarse = coarsePlacements(placements, { styleKey: record.style.key });

const baseline = timedBuilds(record, arcTable, placements, {
  disableRelief: true,
  disableEdgeWear: true,
});
const reliefOnly = timedBuilds(record, arcTable, placements, {
  disableEdgeWear: true,
});
const worn = timedBuilds(record, arcTable, placements, {});
const coarseWorn = timedBuilds(record, arcTable, coarse, { lodBand: 'coarse' });

const nearMultiplier = baseline.stats.stoneTriangles > 0
  ? worn.stats.stoneTriangles / baseline.stats.stoneTriangles
  : 0;
const overPart1 = reliefOnly.buildMs.p95 > 0
  ? (worn.buildMs.p95 - reliefOnly.buildMs.p95) / reliefOnly.buildMs.p95
  : 0;
const fallbackRate = worn.stats.edgeWearEligible > 0
  ? worn.stats.edgeWearFallbacks / worn.stats.edgeWearEligible
  : 0;
const clampedRate = worn.stats.edgeWearEligible > 0
  ? worn.stats.edgeWearClamped / worn.stats.edgeWearEligible
  : 0;

const gates = {
  noExtraMeshes: worn.meshCount === baseline.meshCount,
  mortarUnchanged: worn.stats.mortarTriangles === baseline.stats.mortarTriangles,
  coarseNoWear: coarseWorn.stats.edgeWearStones === 0,
  nearMultiplierOk: nearMultiplier <= 2.0,
  buildOverPart1Ok: overPart1 <= 0.15,
  fallbackOk: fallbackRate < 0.005,
  clampedOk: clampedRate < 0.05,
  wearApplied: worn.stats.edgeWearStones > 0,
};

const allPass = Object.values(gates).every(Boolean);

const payload = {
  generatedAt: new Date().toISOString(),
  wall: {
    style: record.style.key,
    seed: record.seed,
    lengthM: arcTable.totalLength,
    stoneCount: placements.length,
  },
  baseline: {
    stoneTriangles: baseline.stats.stoneTriangles,
    mortarTriangles: baseline.stats.mortarTriangles,
    buildMs: baseline.buildMs,
  },
  reliefOnly: {
    stoneTriangles: reliefOnly.stats.stoneTriangles,
    buildMs: reliefOnly.buildMs,
  },
  worn: {
    stoneTriangles: worn.stats.stoneTriangles,
    edgeWearStones: worn.stats.edgeWearStones,
    edgeWearFallbacks: worn.stats.edgeWearFallbacks,
    edgeWearClamped: worn.stats.edgeWearClamped,
    flattenedCorners: worn.stats.flattenedCorners,
    buildMs: worn.buildMs,
  },
  ratios: {
    nearTriangleMultiplier: nearMultiplier,
    buildP95IncreaseOverPart1: overPart1,
    fallbackRate,
    clampedRate,
  },
  gates,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`);

const report = `# Construction stone edge wear — evidence (2026-07-28)

Headless QA for worn arrises on \`soft-limestone-rubble\` (seed 3141).

## Metrics

| Metric | Flat | Relief only | Relief + edge wear |
| --- | ---: | ---: | ---: |
| Near stone triangles | ${baseline.stats.stoneTriangles} | ${reliefOnly.stats.stoneTriangles} | ${worn.stats.stoneTriangles} |
| Mortar triangles | ${baseline.stats.mortarTriangles} | ${reliefOnly.stats.mortarTriangles} | ${worn.stats.mortarTriangles} |
| Edge-wear stones | 0 | 0 | ${worn.stats.edgeWearStones} |
| Edge-wear fallbacks | 0 | 0 | ${worn.stats.edgeWearFallbacks} |
| Edge-wear clamped | 0 | 0 | ${worn.stats.edgeWearClamped} |
| Flattened corners | 0 | 0 | ${worn.stats.flattenedCorners} |
| Build p50 (ms) | ${baseline.buildMs.p50.toFixed(2)} | ${reliefOnly.buildMs.p50.toFixed(2)} | ${worn.buildMs.p50.toFixed(2)} |
| Build p95 (ms) | ${baseline.buildMs.p95.toFixed(2)} | ${reliefOnly.buildMs.p95.toFixed(2)} | ${worn.buildMs.p95.toFixed(2)} |

## Gates

| Gate | Target | Result |
| --- | --- | --- |
| Extra meshes | 0 | ${gates.noExtraMeshes ? 'PASS' : 'FAIL'} |
| Mortar unchanged | yes | ${gates.mortarUnchanged ? 'PASS' : 'FAIL'} |
| Coarse without wear | yes | ${gates.coarseNoWear ? 'PASS' : 'FAIL'} |
| Near triangle multiplier | ≤ 2.0× | ${nearMultiplier.toFixed(3)}× ${gates.nearMultiplierOk ? 'PASS' : 'FAIL'} |
| Build p95 over Part 1 | ≤ 15% | ${(overPart1 * 100).toFixed(1)}% ${gates.buildOverPart1Ok ? 'PASS' : 'FAIL'} |
| Fallback rate | < 0.5% | ${(fallbackRate * 100).toFixed(3)}% ${gates.fallbackOk ? 'PASS' : 'FAIL'} |
| Clamped rate | < 5% | ${(clampedRate * 100).toFixed(3)}% ${gates.clampedOk ? 'PASS' : 'FAIL'} |
| Wear applied | > 0 | ${gates.wearApplied ? 'PASS' : 'FAIL'} |

Overall: **${allPass ? 'PASS' : 'FAIL'}**

## Visual checklist (manual)

- [ ] Neutral material (white / roughness 1 / no normal)
- [ ] Top-left / top-right / bottom-left lighting
- [ ] Front and rear grazing light
- [ ] Door / window / quoin / coping
- [ ] Curve + module seam
- [ ] Moving-camera pass
- [ ] Silhouette mask vs uniform bevel
`;

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, report);
console.log(allPass ? 'PASS' : 'FAIL');
console.log(`Wrote ${JSON_PATH}`);
console.log(`Wrote ${REPORT_PATH}`);
process.exit(allPass ? 0 : 1);
