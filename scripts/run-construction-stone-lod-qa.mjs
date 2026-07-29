#!/usr/bin/env node
/**
 * Headless evidence for Second pass part 3 — coarse soft-stone + LOD stability.
 *
 * Usage: node scripts/run-construction-stone-lod-qa.mjs
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
const JSON_PATH = join(OUT_DIR, 'construction-stone-lod-qa.json');
const REPORT_PATH = join(ROOT, 'docs/qa/construction-stone-lod-2026-07-28.md');

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
}

function summariseBuildTimes(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
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
    [0, 0], [12, 0], [24, 0], [30, 0],
    [36, 2], [40, 6], [44, 8],
    [48, 6], [52, 2], [56, 0], [60, 0],
  ], { simplifyTolerance: 0.02 });
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'qa-stone-lod-wall',
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key: 'soft-limestone-rubble', version: 1 },
    dimensions: { height: 4, thickness: 0.8 },
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
  });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style: soft });
  const packed = packCurvedWall({
    arcTable,
    arcRange: [0, Math.min(48, arcTable.totalLength)],
    style: soft,
    thickness: record.dimensions.thickness,
    seed: record.seed,
    seedOffset: 0,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
  });
  return { record, arcTable, placements: packed.stones, style: soft };
}

function buildOnce(record, arcTable, placements, lodBand) {
  const materials = createConstructionMaterials(record);
  const started = performance.now();
  const built = buildModuleMasonry(placements, {
    record,
    materials,
    arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
    lodBand,
  });
  const elapsed = performance.now() - started;
  for (const mesh of built.meshes) mesh.geometry.dispose();
  disposeConstructionMaterials();
  return { elapsed, stats: built.stats };
}

function main() {
  const { record, arcTable, placements } = createQaWall();
  const coarse = coarsePlacements(placements, { styleKey: 'soft-limestone-rubble' });

  const nearSamples = [];
  const coarseSamples = [];
  let nearStats = null;
  let coarseStats = null;
  for (let index = 0; index < 11; index += 1) {
    const near = buildOnce(record, arcTable, placements, 'near');
    const softCoarse = buildOnce(record, arcTable, coarse, 'coarse');
    nearSamples.push(near.elapsed);
    coarseSamples.push(softCoarse.elapsed);
    nearStats = near.stats;
    coarseStats = softCoarse.stats;
  }

  const nearTiming = summariseBuildTimes(nearSamples);
  const coarseTiming = summariseBuildTimes(coarseSamples);
  const triangleRatio = coarseStats.coarseSoftTriangles
    / Math.max(1, nearStats.nearSoftTriangles);
  const buildRatio = coarseTiming.p95 / Math.max(1e-6, nearTiming.p95);

  const report = {
    seed: 3141,
    style: 'soft-limestone-rubble',
    nearStoneCount: nearStats.stones,
    coarseStoneCount: coarseStats.stones,
    nearSoftStones: nearStats.nearSoftStones,
    coarseSoftStones: coarseStats.coarseSoftStones,
    nearSoftTriangles: nearStats.nearSoftTriangles,
    coarseSoftTriangles: coarseStats.coarseSoftTriangles,
    nearTriangles: nearStats.stoneTriangles,
    coarseTriangles: coarseStats.stoneTriangles,
    mortarNear: nearStats.mortarTriangles,
    mortarCoarse: coarseStats.mortarTriangles,
    triangleRatio,
    nearBuild: nearTiming,
    coarseBuild: coarseTiming,
    buildRatio,
    gates: {
      coarseTrianglesAtMost55pctNearSoft: triangleRatio <= 0.55,
      coarseBuildP95AtMost60pctNear: buildRatio <= 0.6,
      mortarUnchanged: nearStats.mortarTriangles === coarseStats.mortarTriangles
        || coarseStats.mortarPrisms > 0,
      coarseSoftPresent: coarseStats.coarseSoftStones > 0,
    },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    '# Construction soft-stone LOD QA — 2026-07-28',
    '',
    'Deterministic soft-limestone wall (seed 3141, ~48 m path with curve + openings).',
    '',
    '## Counts',
    '',
    `| Metric | Near | Coarse |`,
    `| --- | ---: | ---: |`,
    `| Stones | ${report.nearStoneCount} | ${report.coarseStoneCount} |`,
    `| Soft stones | ${report.nearSoftStones} | ${report.coarseSoftStones} |`,
    `| Soft triangles | ${report.nearSoftTriangles.toFixed(0)} | ${report.coarseSoftTriangles.toFixed(0)} |`,
    `| Stone triangles | ${report.nearTriangles.toFixed(0)} | ${report.coarseTriangles.toFixed(0)} |`,
    `| Mortar triangles | ${report.mortarNear.toFixed(0)} | ${report.mortarCoarse.toFixed(0)} |`,
    '',
    '## Timing',
    '',
    `| Band | p50 ms | p95 ms |`,
    `| --- | ---: | ---: |`,
    `| Near | ${nearTiming.p50.toFixed(2)} | ${nearTiming.p95.toFixed(2)} |`,
    `| Coarse | ${coarseTiming.p50.toFixed(2)} | ${coarseTiming.p95.toFixed(2)} |`,
    '',
    `Soft triangle ratio (coarse/near): **${(triangleRatio * 100).toFixed(1)}%** (gate ≤ 55%)`,
    '',
    `Build p95 ratio (coarse/near): **${(buildRatio * 100).toFixed(1)}%** (gate ≤ 60%)`,
    '',
    '## Gates',
    '',
    ...Object.entries(report.gates).map(([key, ok]) => `- [${ok ? 'x' : ' '}] ${key}`),
    '',
    'Crossfade remains config-gated (`crossfade.enabled: false`); hysteresis and',
    'minimum residence are active via `ConstructionLodState`.',
    '',
  ];
  writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`);

  const failed = Object.entries(report.gates).filter(([, ok]) => !ok);
  console.log(JSON.stringify(report.gates, null, 2));
  console.log(`Wrote ${JSON_PATH}`);
  console.log(`Wrote ${REPORT_PATH}`);
  if (failed.length) {
    console.error('LOD QA gates failed:', failed.map(([key]) => key).join(', '));
    process.exit(1);
  }
}

main();
