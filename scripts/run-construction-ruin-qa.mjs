#!/usr/bin/env node
/**
 * Headless evidence for support-aware ruined masonry (Part 4).
 *
 * Usage: node scripts/run-construction-ruin-qa.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { coarsePlacements } from '../src/editor/construction/render/ConstructionLod.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'tmp');
const JSON_PATH = join(OUT_DIR, 'construction-ruin-qa.json');
const REPORT_PATH = join(ROOT, 'docs/qa/construction-ruin-2026-07-28.md');

function createWall() {
  const path = createCubicBezierPathFromStroke([
    [0, 0], [8, 0], [16, 0], [24, 0], [30, 0],
  ], { simplifyTolerance: 0.02 });
  return normalizeConstructionRecord({
    version: 1,
    id: 'qa-ruin-wall',
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key: 'soft-limestone-rubble', version: 1 },
    dimensions: { height: 4, thickness: 0.8 },
    path,
    features: [],
    top: { style: 'ruined', base: 4, profile: [] },
  });
}

function main() {
  const record = createWall();
  const started = performance.now();
  const plan = planConstruction(record, { maxModuleLength: 12 });
  const elapsed = performance.now() - started;

  const survivors = plan.modules.flatMap((module) => module.placements ?? []);
  const coarse = coarsePlacements(survivors, { styleKey: record.style.key });
  const nearIds = new Set(survivors.map((stone) => stone.stableIndex));
  const resurrected = coarse.filter((stone) => (
    stone.category === 'field' && !nearIds.has(stone.stableIndex)
  ));

  const stats = plan.ruinStats ?? {};
  const gates = {
    hasRemovals: (stats.finalRemoved ?? 0) > 0,
    hasSurvivors: survivors.length > 0,
    footingPresent: survivors.some((stone) => (stone.heightRatio ?? 1) < 0.25),
    noCoarseResurrection: resurrected.length === 0,
    supportMsBounded: (stats.damageResolveMs ?? 0) + (stats.supportResolveMs ?? 0) < 50,
    plannerMsBounded: elapsed < 200,
  };

  const report = {
    seed: record.seed,
    moduleCount: plan.modules.length,
    survivors: survivors.length,
    coarseCount: coarse.length,
    elapsedMs: elapsed,
    ruinStats: stats,
    gates,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(REPORT_PATH, [
    '# Construction support-aware ruins QA — 2026-07-28',
    '',
    `Seed ${record.seed}, soft-limestone ruined wall (~30 m).`,
    '',
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| Modules | ${report.moduleCount} |`,
    `| Survivors | ${report.survivors} |`,
    `| Final removed | ${stats.finalRemoved ?? 0} |`,
    `| Isolated holes restored | ${stats.isolatedHolesRestored ?? 0} |`,
    `| Unsupported removed | ${stats.unsupportedRemoved ?? 0} |`,
    `| Damage resolve ms | ${(stats.damageResolveMs ?? 0).toFixed(2)} |`,
    `| Support resolve ms | ${(stats.supportResolveMs ?? 0).toFixed(2)} |`,
    `| Plan ms | ${elapsed.toFixed(2)} |`,
    '',
    '## Gates',
    '',
    ...Object.entries(gates).map(([key, ok]) => `- [${ok ? 'x' : ' '}] ${key}`),
    '',
  ].join('\n'));

  console.log(JSON.stringify(gates, null, 2));
  console.log(`Wrote ${JSON_PATH}`);
  console.log(`Wrote ${REPORT_PATH}`);
  if (!Object.values(gates).every(Boolean)) process.exit(1);
}

main();
