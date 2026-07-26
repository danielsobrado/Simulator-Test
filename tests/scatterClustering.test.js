import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import {
  ForestHabitatField,
  createForestPlacementEvaluator,
} from '../src/editor/stylized/forest/ForestHabitatField.js';
import { ScatterClusterField } from '../src/editor/stylized/forest/ScatterClusterField.js';
import { buildStableChunkManifest } from '../src/editor/stylized/StableScatterManifest.js';

const surface = yaml.load(readFileSync(
  new URL('../editor.config.yaml', import.meta.url),
  'utf8',
)).stylizedSurface;

function distribution(sample) {
  const values = [];
  for (let z = -512; z <= 512; z += 4) {
    for (let x = -512; x <= 512; x += 4) values.push(sample(x, z));
  }
  values.sort((left, right) => left - right);
  return {
    openShare: values.filter((value) => value < 0.01).length / values.length,
    denseShare: values.filter((value) => value > 0.3).length / values.length,
    p99: values[Math.floor(values.length * 0.99)],
  };
}

function placementGrouping(placements, radius = 24) {
  let grouped = 0;
  let isolated = 0;
  for (let index = 0; index < placements.length; index += 1) {
    let neighbours = 0;
    for (let other = 0; other < placements.length; other += 1) {
      if (index === other) continue;
      if (Math.hypot(
        placements[index].x - placements[other].x,
        placements[index].z - placements[other].z,
      ) < radius) neighbours += 1;
    }
    if (neighbours >= 2) grouped += 1;
    if (neighbours === 0) isolated += 1;
  }
  return {
    groupedShare: grouped / placements.length,
    isolatedShare: isolated / placements.length,
  };
}

function buildWindow({ kind, perChunk, radiusForScale, candidateEvaluator }) {
  const placements = [];
  for (let chunkZ = -3; chunkZ <= 3; chunkZ += 1) {
    for (let chunkX = -3; chunkX <= 3; chunkX += 1) {
      placements.push(...buildStableChunkManifest({
        kind,
        chunkX,
        chunkZ,
        chunkSize: 64,
        tileSize: 2,
        perChunk,
        maxAccepted: kind === 'tree' ? 72 : Number.POSITIVE_INFINITY,
        tileIds: [4],
        tileAt: () => 4,
        heightAt: () => 0,
        prototypeCount: 1,
        minScale: kind === 'tree' ? 0.85 : 0.9,
        maxScale: kind === 'tree' ? 1.15 : 1.5,
        radiusForScale,
        candidateEvaluator,
      }));
    }
  }
  return placements;
}

test('grassland trees form dense groves separated by open ground', () => {
  const field = new ForestHabitatField({
    seed: 123,
    tileSize: 2,
    tileAt: () => 4,
    heightAt: () => 0,
    config: surface.trees.habitat,
  });
  const measured = distribution((x, z) => field.sample(x, z).suitability);
  assert.ok(measured.openShare > 0.7, `open share was ${measured.openShare}`);
  assert.ok(measured.denseShare > 0.1, `dense share was ${measured.denseShare}`);
  assert.ok(measured.p99 > 0.35, `p99 suitability was ${measured.p99}`);
});

test('rocks occupy compact high-density groups instead of diffuse singleton patches', () => {
  const field = new ScatterClusterField({
    kind: 'rock',
    seed: 123,
    seedOffset: 0xa7,
    heightAt: () => 0,
    config: surface.rocks,
  });
  const measured = distribution((x, z) => field.sample(x, z).density);
  assert.ok(measured.openShare > 0.8, `open share was ${measured.openShare}`);
  assert.ok(measured.denseShare > 0.05, `dense share was ${measured.denseShare}`);
  assert.ok(measured.p99 > 0.6, `p99 density was ${measured.p99}`);
});

test('canonical tree manifests retain grove grouping after spacing rejection', () => {
  const field = new ForestHabitatField({
    seed: 123,
    tileSize: 2,
    tileAt: () => 4,
    heightAt: () => 0,
    config: surface.trees.habitat,
  });
  const placements = buildWindow({
    kind: 'tree',
    perChunk: surface.trees.habitat.candidateBudgetPerChunk,
    radiusForScale: (scale) => surface.trees.clearRadius * scale,
    candidateEvaluator: createForestPlacementEvaluator(field),
  });
  const measured = placementGrouping(placements);
  assert.ok(measured.groupedShare > 0.7, `grouped share was ${measured.groupedShare}`);
  assert.ok(measured.isolatedShare < 0.1, `isolated share was ${measured.isolatedShare}`);
});

test('canonical rock manifests retain multi-boulder groups after spacing rejection', () => {
  const field = new ScatterClusterField({
    kind: 'rock',
    seed: 123,
    seedOffset: 0xa7,
    heightAt: () => 0,
    config: surface.rocks,
  });
  const placements = buildWindow({
    kind: 'rock',
    perChunk: surface.rocks.perChunk,
    radiusForScale: (scale) => surface.rocks.radius * scale,
    candidateEvaluator: (candidate) => {
      const cluster = field.sample(candidate.x, candidate.z);
      return candidate.priority < cluster.density ? { clusterId: cluster.clusterId } : null;
    },
  });
  const measured = placementGrouping(placements);
  assert.ok(measured.groupedShare > 0.45, `grouped share was ${measured.groupedShare}`);
  assert.ok(measured.isolatedShare < 0.26, `isolated share was ${measured.isolatedShare}`);
});
