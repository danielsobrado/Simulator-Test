import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSpikeReport, RENDER_CREATION_COUNTERS, RENDER_REFRESH_COUNTERS } from '../src/editor/performance/qa/renderSpikeReport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const inputPath = path.resolve(process.argv[2] ?? path.join(root, 'tmp', 'perf-qa-latest.json'));
const outPath = path.join(root, 'tmp', 'perf-qa-latest.json');

fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
let data = raw.result?.value ?? raw.result?.result?.value ?? raw;
if (typeof data === 'string') {
  data = JSON.parse(data);
}

if (inputPath !== outPath) {
  fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
}

const summary = data.summary ?? data;
const hitchFrames = data.hitchFrames ?? [];
const counters = data.counters ?? {};
const scenario = data.scenario ?? {};
const collision = data.collision ?? null;

console.log('=== PERF QA PARSE ===');
console.log(`scenario: ${scenario.id ?? '?'} ${scenario.speed ?? ''}`);
console.log(`frames: ${summary.frameCount}  durationMs: ${summary.durationMs}  avgFps: ${summary.avgFps}`);
console.log(`dt p50/p95/p99/max: ${summary.dt?.p50Ms} / ${summary.dt?.p95Ms} / ${summary.dt?.p99Ms} / ${summary.dt?.maxMs}`);
console.log(`hitches: ${summary.hitchCount}  rate: ${summary.hitchRate}`);
console.log(`counters: ${JSON.stringify(counters)}`);
console.log(`phase max stylized/render: ${summary.phases?.stylized?.maxMs} / ${summary.phases?.render?.maxMs}`);
console.log(`phase max terrainCommit: ${summary.phases?.terrainCommit?.maxMs}`);
const renderSpikes = renderSpikeReport(data);
console.log('--- render spikes: render p50 + 5 ms ---');
if (!renderSpikes.available) console.log(renderSpikes.reason);
else {
  console.log(`render p50=${renderSpikes.p50Ms} ms; threshold=${renderSpikes.thresholdMs} ms; attributed=${renderSpikes.attributed}/${renderSpikes.spikes.length} (${(renderSpikes.attributedShare * 100).toFixed(1)}%)`);
  console.log(`exclusive stage p50 ms: ${JSON.stringify(renderSpikes.stageP50)}`);
  console.log(`draws per callback p50, by refresh type: ${JSON.stringify(renderSpikes.refreshP50)}`);
  console.table(renderSpikes.spikes.map(frame => ({
    frame: frame.index, dtMs: frame.dtMs, renderMs: frame.renderMs,
    ...Object.fromEntries(Object.entries(RENDER_CREATION_COUNTERS).map(([label, name]) => [label, frame.counters[name] ?? 0])),
    ...Object.fromEntries(Object.entries(RENDER_REFRESH_COUNTERS).map(([label, name]) => [label, frame.counters[name] ?? 0])),
    auxiliary: Object.entries(frame.counters).filter(([name, value]) => name.startsWith('renderScene:') && value > 0)
      .map(([name, value]) => `${name.slice('renderScene:'.length)}=${value}`).join(', '),
    causes: JSON.stringify(frame.causes),
  })));
}
console.log(`hitch dts: ${hitchFrames.map((frame) => frame.dtMs).join(', ')}`);

if (collision) {
  console.log('--- collision gate ---');
  console.log(
    `collision total p50/p95/p99/max: ${collision.timingsMs?.total?.p50Ms}`
    + ` / ${collision.timingsMs?.total?.p95Ms}`
    + ` / ${collision.timingsMs?.total?.p99Ms}`
    + ` / ${collision.timingsMs?.total?.maxMs}`,
  );
  console.log(
    `collision gate: ${collision.gate?.passed ? 'PASS' : 'FAIL'}`
    + ` measured=${collision.gate?.measuredP95Ms}`
    + ` target=${collision.gate?.provisionalP95TargetMs}`,
  );
  console.log(
    `collision readiness: ${collision.readiness?.ready ? 'ready' : 'not-ready'}`
    + ` failure=${collision.readiness?.failure?.message ?? 'none'}`,
  );
  console.log(`collision counts: ${JSON.stringify(collision.counts ?? {})}`);
}

const loadingHitches = hitchFrames
  .filter((frame) => (frame.streaming?.loading ?? 0) > 0)
  .map((frame) => `${frame.index}:${frame.dtMs}ms load=${frame.streaming.loading} focus=${frame.streaming.focusChunk}`);
console.log(`hitch while streaming loads: ${loadingHitches.join(' | ') || '(none)'}`);

const subPhases = [
  'workerComplete',
  'queueWait',
  'commitQueueWait',
  'tilePixels',
  'surfaceMask',
  'textureCommit',
  'rockManifestBuild',
  'grassResourceAllocation',
  'grassScatter',
  'grassTrample',
  'grassBufferUpload',
  'maxQueuedCommitAgeMs',
  'attributeBytesUploaded',
  'textureBytesUploaded',
];
const reported = Object.fromEntries(
  subPhases
    .filter((name) => counters[name] !== undefined || counters[`${name}Ms`] !== undefined)
    .map((name) => [name, counters[name] ?? counters[`${name}Ms`]]),
);
console.log(`sub-phases: ${JSON.stringify(reported)}`);

const postWarmupHitches = hitchFrames.filter((frame) => frame.dtMs > (summary.hitchMs ?? 33.3));
const grassRebuilds = counters.grassRebuilds ?? 0;
const terrainUploads = counters.terrainUploadPages ?? 0;
console.log('--- acceptance hints (chunk-cross) ---');
console.log(`grassRebuilds=${grassRebuilds} (target ≤3 on a straight one-chunk crossing after warmup)`);
console.log(`terrainUploadPages=${terrainUploads}`);
console.log(`post-warmup hitch count=${postWarmupHitches.length} (target 0 over 33.3 ms once streaming settled)`);
console.log(`maxQueuedCommitAgeMs=${counters.maxQueuedCommitAgeMs ?? 'n/a'}`);
console.log(`attributeBytesUploaded=${counters.attributeBytesUploaded ?? 0}`);
console.log(`textureBytesUploaded=${counters.textureBytesUploaded ?? 0}`);

console.log(`source: ${inputPath}`);
console.log(`report: ${outPath} (${fs.statSync(outPath).size} bytes)`);

if (scenario.id === 'collision-p8' && collision?.gate?.passed !== true) {
  process.exitCode = 1;
}
