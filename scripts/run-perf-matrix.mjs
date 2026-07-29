#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePerfMatrix } from './perf-matrix-gates.mjs';
import { acquirePerfRunLock } from './perf-run-lock.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tmp', 'perf-matrix');
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
const releaseRunLock = acquirePerfRunLock(path.join(root, 'tmp', 'perf-matrix.lock'));
process.once('exit', releaseRunLock);

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function runScript(script, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

function reportSummary(report) {
  const stylized = report.config?.world?.stylizedSurface;
  return {
    scenario: report.scenario,
    summary: report.summary,
    collision: report.collision,
    adapter: report.adapter,
    density: {
      treesPerChunk: stylized?.trees?.perChunk ?? null,
      candidateBudgetPerChunk:
        stylized?.trees?.habitat?.candidateBudgetPerChunk ?? null,
      maxAcceptedPerChunk:
        stylized?.trees?.habitat?.maxAcceptedPerChunk ?? null,
      bladesPerCell: stylized?.grass?.bladesPerCell ?? null,
    },
    counters: {
      rendererWebGPUBackend: report.counters?.rendererWebGPUBackend ?? 0,
      rendererWebGLBackend: report.counters?.rendererWebGLBackend ?? 0,
      treeRebuilds: report.counters?.treeRebuilds ?? 0,
      treeManifestBuilds: report.counters?.treeManifestBuilds ?? 0,
      treeImpostorInstances: report.counters?.treeImpostorInstances ?? 0,
      grassLastChunkEffectiveBlades:
        report.counters?.grassLastChunkEffectiveBlades ?? 0,
      grassLastChunkTriangles: report.counters?.grassLastChunkTriangles ?? 0,
      waterChunksWet: report.counters?.waterChunksWet ?? 0,
      waterChunksRefractive: report.counters?.waterChunksRefractive ?? 0,
      constructionModulesResident:
        report.counters?.constructionModulesResident ?? 0,
      constructionStones: report.counters?.constructionStones ?? 0,
      attributeBytesUploaded: report.counters?.attributeBytesUploaded ?? 0,
    },
  };
}

const baseUrl = readArg('url', 'http://localhost:5173');
const duration = readArg('duration', '10');
const warmup = readArg('warmup', '8');
const viewportWidth = readArg('viewportWidth', '1280');
const viewportHeight = readArg('viewportHeight', '720');
const headed = hasFlag('headed');
const includeWater = !hasFlag('skip-water');
const waterOnly = hasFlag('water-only');
const cases = [
  { id: 'standard', qa: 'diagonal', density: 'standard' },
  { id: 'dense-forest', qa: 'diagonal', density: 'dense-forest' },
  { id: 'high-grass', qa: 'diagonal', density: 'high-grass' },
  { id: 'dense-mixed', qa: 'diagonal', density: 'dense-mixed' },
  { id: 'construction-ring', qa: 'construction-ring', density: 'standard' },
];

fs.mkdirSync(outDir, { recursive: true });
const matrixPath = path.join(root, 'tmp', 'perf-matrix-latest.json');
const previousMatrix = waterOnly && fs.existsSync(matrixPath)
  ? JSON.parse(fs.readFileSync(matrixPath, 'utf8'))
  : null;
const results = waterOnly ? (previousMatrix?.cases ?? []) : [];
for (const entry of waterOnly ? [] : cases) {
  const outPath = path.join(outDir, `${entry.id}.json`);
  const args = [
    '--url', baseUrl,
    '--qa', entry.qa,
    '--density', entry.density,
    '--duration', duration,
    '--warmup', warmup,
    '--viewportWidth', viewportWidth,
    '--viewportHeight', viewportHeight,
    '--out', outPath,
  ];
  if (headed) args.unshift('--headed');
  const execution = await runScript('scripts/run-perf-qa.mjs', args);
  const report = fs.existsSync(outPath)
    ? reportSummary(JSON.parse(fs.readFileSync(outPath, 'utf8')))
    : null;
  results.push({ id: entry.id, execution, report });
}

let water = null;
if (includeWater) {
  const args = ['--existing-server', '--url', baseUrl];
  if (headed) args.push('--headed');
  const execution = await runScript('scripts/run-water-acceptance-qa.mjs', args);
  const source = path.join(root, 'tmp', 'water-acceptance-latest.json');
  water = {
    execution,
    report: fs.existsSync(source)
      ? reportSummary(JSON.parse(fs.readFileSync(source, 'utf8')))
      : null,
    acceptance: fs.existsSync(source)
      ? JSON.parse(fs.readFileSync(source, 'utf8')).waterAcceptance
      : null,
  };
}

const measuredCaseConfig = {
  baseUrl,
  durationSeconds: Number(duration),
  warmupSeconds: Number(warmup),
  viewport: {
    width: Number(viewportWidth),
    height: Number(viewportHeight),
  },
  headed,
};
const matrix = {
  version: 1,
  generatedAt: new Date().toISOString(),
  config: {
    ...(waterOnly && previousMatrix?.config
      ? previousMatrix.config
      : measuredCaseConfig),
    includeWater,
    waterOnlyRefresh: waterOnly,
  },
  cases: results,
  water,
};
matrix.gate = evaluatePerfMatrix(matrix, {
  requireCases: !waterOnly,
  requireWater: includeWater,
});
fs.writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`);
console.log(JSON.stringify({
  outPath: matrixPath,
  cases: results.map(({ id, execution, report }) => ({
    id,
    exitCode: execution.code,
    avgFps: report?.summary?.avgFps ?? null,
    p95Ms: report?.summary?.dt?.p95Ms ?? null,
    maxMs: report?.summary?.dt?.maxMs ?? null,
    hitchCount: report?.summary?.hitchCount ?? null,
  })),
  water: water && {
    exitCode: water.execution.code,
    pass: water.acceptance?.pass ?? null,
    p95Ms: water.report?.summary?.dt?.p95Ms ?? null,
  },
  gate: matrix.gate,
}, null, 2));

if (
  results.some((entry) => entry.execution.code !== 0 || !entry.report)
  || (water && (water.execution.code !== 0 || !water.report))
  || !matrix.gate.passed
) {
  process.exitCode = 1;
}
