#!/usr/bin/env node
/**
 * Headless evidence for Second pass part 1 — deterministic pillowed stone faces.
 *
 * Builds the QA soft-limestone wall with relief on/off, records triangle and
 * build-time budgets, and writes a markdown report. Visual screenshots remain a
 * Simulator-Test checklist item.
 *
 * Usage: node scripts/run-construction-stone-relief-qa.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { coarsePlacements } from '../src/editor/construction/render/ConstructionLod.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp');
const JSON_PATH = join(OUT_DIR, 'construction-stone-relief-qa.json');
const REPORT_PATH = join(ROOT, 'docs/qa/construction-stone-relief-2026-07-28.md');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
}

function createQaWall() {
  const soft = constructionStyle('soft-limestone-rubble');
  const path = createCubicBezierPathFromStroke([
    [0, 0],
    [6, 0],
    [12, 0],
    [14, 1],
    [18, 4],
    [21, 7],
    [24, 8],
  ], { simplifyTolerance: 0.02 });
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'qa-relief-wall',
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
  return { record, arcTable, placements: packed.stones, openings };
}

function buildOnce(record, arcTable, placements, { disableRelief = false, lodBand = 'near' } = {}) {
  const materials = createConstructionMaterials(record);
  const started = performance.now();
  const built = buildModuleMasonry(placements, {
    record,
    materials,
    arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
    lodBand,
    disableRelief,
  });
  const buildMs = performance.now() - started;
  for (const mesh of built.meshes) mesh.geometry.dispose();
  disposeConstructionMaterials();
  return { stats: built.stats, meshCount: built.meshes.length, buildMs };
}

function timedBuilds(record, arcTable, placements, options, runs = 7) {
  const samples = [];
  let last = null;
  for (let index = 0; index < runs; index += 1) {
    last = buildOnce(record, arcTable, placements, options);
    samples.push(last.buildMs);
  }
  samples.sort((a, b) => a - b);
  return {
    ...last,
    buildMs: {
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      samples,
    },
  };
}

const { record, arcTable, placements, openings } = createQaWall();
const coarse = coarsePlacements(placements, { styleKey: record.style.key });

const baseline = timedBuilds(record, arcTable, placements, { disableRelief: true });
const relieved = timedBuilds(record, arcTable, placements, { disableRelief: false });
const coarseFlat = timedBuilds(record, arcTable, coarse, {
  disableRelief: true,
  lodBand: 'coarse',
});
const coarseReliefAttempt = timedBuilds(record, arcTable, coarse, {
  disableRelief: false,
  lodBand: 'coarse',
});

const nearMultiplier = baseline.stats.stoneTriangles > 0
  ? relieved.stats.stoneTriangles / baseline.stats.stoneTriangles
  : 0;
const buildIncrease = baseline.buildMs.p95 > 0
  ? (relieved.buildMs.p95 - baseline.buildMs.p95) / baseline.buildMs.p95
  : 0;
const fallbackRate = relieved.stats.stones > 0
  ? relieved.stats.reliefFallbacks / relieved.stats.stones
  : 0;

const gates = {
  noExtraMeshes: relieved.meshCount === baseline.meshCount,
  mortarUnchanged: relieved.stats.mortarTriangles === baseline.stats.mortarTriangles,
  coarseUnchanged: coarseReliefAttempt.stats.stoneTriangles === coarseFlat.stats.stoneTriangles
    && coarseReliefAttempt.stats.reliefStones === 0,
  nearMultiplierOk: nearMultiplier <= 1.65,
  buildP95Ok: buildIncrease <= 0.2,
  fallbackOk: fallbackRate < 0.005,
  reliefApplied: relieved.stats.reliefStones > 0,
  placementCountUnchanged: relieved.stats.stones === baseline.stats.stones,
};

const allPass = Object.values(gates).every(Boolean);

const payload = {
  generatedAt: new Date().toISOString(),
  wall: {
    style: record.style.key,
    seed: record.seed,
    lengthM: arcTable.totalLength,
    height: record.dimensions.height,
    thickness: record.dimensions.thickness,
    openings: openings.map(({ id, kind, s, width, height }) => ({
      id, kind, s, width, height,
    })),
    stoneCount: placements.length,
  },
  baseline: {
    stoneTriangles: baseline.stats.stoneTriangles,
    mortarTriangles: baseline.stats.mortarTriangles,
    meshCount: baseline.meshCount,
    buildMs: baseline.buildMs,
  },
  relieved: {
    stoneTriangles: relieved.stats.stoneTriangles,
    mortarTriangles: relieved.stats.mortarTriangles,
    reliefStones: relieved.stats.reliefStones,
    reliefFallbacks: relieved.stats.reliefFallbacks,
    reliefClamped: relieved.stats.reliefClamped,
    reliefTriangles: relieved.stats.reliefTriangles,
    reliefBuildMs: relieved.stats.reliefBuildMs,
    meshCount: relieved.meshCount,
    buildMs: relieved.buildMs,
  },
  coarse: {
    stoneTriangles: coarseFlat.stats.stoneTriangles,
    reliefStones: coarseReliefAttempt.stats.reliefStones,
  },
  ratios: {
    nearTriangleMultiplier: nearMultiplier,
    buildP95Increase: buildIncrease,
    fallbackRate,
  },
  gates,
  checklist: {
    screenshots: [
      'front diffuse light',
      'front grazing light',
      '45-degree view',
      'near curve',
      'inside curve',
      'doorway',
      'ruined top',
      'near-to-coarse transition',
      'binary silhouette',
      'neutral material (white / roughness 1)',
      'moving-camera parallel pass',
    ],
  },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`);

const report = `# Construction stone face relief — evidence (2026-07-28)

Headless QA for deterministic pillowed near-LOD field stones
(\`soft-limestone-rubble\`, seed 3141).

## Wall fixture

| Property | Value |
| --- | --- |
| Style | soft-limestone-rubble |
| Seed | 3141 |
| Path length | ${arcTable.totalLength.toFixed(2)} m |
| Height | ${record.dimensions.height} m |
| Thickness | ${record.dimensions.thickness} m |
| Stones | ${placements.length} |
| Openings | door + window |
| Top | complete + ruined profile |

## Metrics

| Metric | Flat baseline | Relief enabled |
| --- | ---: | ---: |
| Near stone triangles | ${baseline.stats.stoneTriangles} | ${relieved.stats.stoneTriangles} |
| Mortar triangles | ${baseline.stats.mortarTriangles} | ${relieved.stats.mortarTriangles} |
| Coarse stone triangles | ${coarseFlat.stats.stoneTriangles} | ${coarseReliefAttempt.stats.stoneTriangles} |
| Relief stones | 0 | ${relieved.stats.reliefStones} |
| Relief fallbacks | 0 | ${relieved.stats.reliefFallbacks} |
| Relief clamped | 0 | ${relieved.stats.reliefClamped} |
| Mesh count | ${baseline.meshCount} | ${relieved.meshCount} |
| Module build p50 (ms) | ${baseline.buildMs.p50.toFixed(2)} | ${relieved.buildMs.p50.toFixed(2)} |
| Module build p95 (ms) | ${baseline.buildMs.p95.toFixed(2)} | ${relieved.buildMs.p95.toFixed(2)} |

## Gates

| Gate | Target | Result |
| --- | --- | --- |
| Extra meshes | 0 | ${gates.noExtraMeshes ? 'PASS' : 'FAIL'} |
| Mortar triangles unchanged | 0 delta | ${gates.mortarUnchanged ? 'PASS' : 'FAIL'} |
| Coarse unchanged / no relief | yes | ${gates.coarseUnchanged ? 'PASS' : 'FAIL'} |
| Near triangle multiplier | ≤ 1.65× | ${nearMultiplier.toFixed(3)}× ${gates.nearMultiplierOk ? 'PASS' : 'FAIL'} |
| Module build p95 increase | ≤ 20% | ${(buildIncrease * 100).toFixed(1)}% ${gates.buildP95Ok ? 'PASS' : 'FAIL'} |
| Relief fallback rate | < 0.5% | ${(fallbackRate * 100).toFixed(3)}% ${gates.fallbackOk ? 'PASS' : 'FAIL'} |
| Relief applied | > 0 stones | ${gates.reliefApplied ? 'PASS' : 'FAIL'} |
| Placement count unchanged | yes | ${gates.placementCountUnchanged ? 'PASS' : 'FAIL'} |

Overall: **${allPass ? 'PASS' : 'FAIL'}**

## Visual checklist (manual)

${payload.checklist.screenshots.map((item) => `- [ ] ${item}`).join('\n')}

## Notes

- Packing, \`placement.corners\`, and \`placement.mortarCorners\` are untouched.
- Relief is YAML-driven (\`stone-face-relief.yml\`) and sampled from seed + stableIndex + side.
- Coarse and shell LOD keep the flat bevelled prism.
`;

mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, report);
console.log(allPass ? 'PASS' : 'FAIL');
console.log(`Wrote ${JSON_PATH}`);
console.log(`Wrote ${REPORT_PATH}`);
process.exit(allPass ? 0 : 1);
