import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { ProceduralAssetStore } from '../src/editor/workshop/ProceduralAssetStore.js';
import { createProceduralObjectLodParts } from '../src/editor/workshop/ProceduralAssetManager.js';
import { createProceduralWorkshopComponentParts } from '../src/editor/workshop/ProceduralWorkshopComponentParts.js';
import { planWorkshopComposition } from '../src/editor/workshop/ProceduralWorkshopComposition.js';
import { buildStraightSkeleton } from '../src/editor/workshop/ProceduralStraightSkeleton.js';
import {
  assertDeterministic,
  snapshotLod,
  snapshotParts,
  stableJson,
  stableValue,
  uniqueOwnedParts,
} from './lib/workshopCompatibility.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'config', 'workshop-compatibility.yaml');
const legacyPath = path.join(
  root,
  'test',
  'fixtures',
  'workshop-compatibility',
  'legacy-assets.json',
);

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function loadConfig() {
  const config = yaml.load(await readFile(configPath, 'utf8'));
  if (!config || typeof config !== 'object' || config.version !== 1) {
    throw new Error('Workshop compatibility config must use version 1.');
  }
  if (!Number.isInteger(config.precision) || config.precision < 0 || config.precision > 9) {
    throw new Error('Workshop compatibility precision must be an integer from 0 to 9.');
  }
  if (!Array.isArray(config.fixtures) || config.fixtures.length === 0) {
    throw new Error('Workshop compatibility config requires fixtures.');
  }
  const ids = config.fixtures.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, 'Workshop compatibility fixture ids must be unique.');
  return config;
}

function capturePersistence(fixture, precision) {
  const store = new ProceduralAssetStore();
  const record = store.add({ label: fixture.label, recipe: fixture.recipe });
  const document = store.toDocument();

  const restored = new ProceduralAssetStore();
  restored.replaceAll(document);
  const roundTrip = restored.toDocument();
  assertDeterministic(document, roundTrip, `${fixture.id} persistence`, precision);

  return {
    record,
    document: stableValue(document[0], precision),
  };
}

function disposeCapture(nearParts, lodParts) {
  disposeModelParts(uniqueOwnedParts(nearParts, lodParts));
}

function captureGenerated(record, fixture, config) {
  if (fixture.geometry === false) return null;
  const nearParts = createProceduralWorkshopComponentParts(record.recipe);
  let lodParts = null;
  try {
    lodParts = createProceduralObjectLodParts(record, nearParts, config.lod ?? {});
    return {
      near: snapshotParts(nearParts, config.precision),
      lod: snapshotLod(lodParts, config.precision),
    };
  } finally {
    disposeCapture(nearParts, lodParts);
  }
}

function captureFixture(fixture, config) {
  const persistence = capturePersistence(fixture, config.precision);
  return {
    id: fixture.id,
    persisted: persistence.document,
    plan: stableValue(planWorkshopComposition(persistence.record.recipe), config.precision),
    generated: captureGenerated(persistence.record, fixture, config),
  };
}

function captureSkeleton(entry, precision) {
  const result = buildStraightSkeleton(entry.polygon);
  return stableValue({
    id: entry.id,
    polygon: result.polygon,
    footprintArea: result.footprintArea,
    projectedFaceArea: result.projectedFaceArea,
    faces: result.faces.map((face) => ({
      edgeIndex: face.edgeIndex,
      sourceEdge: face.sourceEdge,
      vertices: face.vertices,
    })),
  }, precision);
}

async function captureLegacy(precision) {
  const source = JSON.parse(await readFile(legacyPath, 'utf8'));
  const store = new ProceduralAssetStore();
  store.replaceAll(source);
  const migrated = store.toDocument();

  const restored = new ProceduralAssetStore();
  restored.replaceAll(migrated);
  assertDeterministic(migrated, restored.toDocument(), 'legacy asset migration', precision);
  return stableValue(migrated, precision);
}

async function assertVisualReferences(config) {
  const directory = path.join(root, config.visualQa.outputDirectory);
  const missing = [];
  for (const file of config.visualQa.representativeCheckpoints ?? []) {
    try {
      await access(path.join(directory, file));
    } catch {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing workshop visual references: ${missing.join(', ')}. `
      + `Run "${config.visualQa.command}" first.`,
    );
  }
}

async function captureReport(config) {
  const first = config.fixtures.map((fixture) => captureFixture(fixture, config));
  const second = config.fixtures.map((fixture) => captureFixture(fixture, config));
  assertDeterministic(first, second, 'workshop fixtures', config.precision);

  const skeletons = (config.straightSkeletons ?? []).map((entry) => (
    captureSkeleton(entry, config.precision)
  ));
  const repeatedSkeletons = (config.straightSkeletons ?? []).map((entry) => (
    captureSkeleton(entry, config.precision)
  ));
  assertDeterministic(skeletons, repeatedSkeletons, 'straight skeleton fixtures', config.precision);

  return stableValue({
    version: config.version,
    assetVersion: first[0]?.persisted?.version ?? null,
    fixtures: first,
    legacyAssets: await captureLegacy(config.precision),
    straightSkeletons: skeletons,
    visualReferences: {
      command: config.visualQa.command,
      outputDirectory: config.visualQa.outputDirectory,
      checkpoints: config.visualQa.representativeCheckpoints,
    },
  }, config.precision);
}

async function main() {
  const config = await loadConfig();
  if (hasFlag('visual')) await assertVisualReferences(config);

  const report = await captureReport(config);
  const outputPath = path.join(root, config.reportPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, stableJson(report, config.precision), 'utf8');

  console.log(
    `Workshop compatibility: ${report.fixtures.length} fixtures, `
    + `${report.straightSkeletons.length} skeleton cases, asset v${report.assetVersion}.`,
  );
  console.log(`Report: ${path.relative(root, outputPath)}`);
}

main().catch((error) => {
  console.error(`Workshop compatibility failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
