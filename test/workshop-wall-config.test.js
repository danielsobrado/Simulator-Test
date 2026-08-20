import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import {
  DEFAULT_WALL_LEGACY_SAMPLE_SPACING,
  DEFAULT_WALL_MAX_MITER_RATIO,
  DEFAULT_WALL_SAMPLE_SPACING,
  MAX_WALL_LEGACY_POINTS,
  MAX_WALL_PLAN_SECTIONS,
  WALL_DEFINITION_VERSION,
  WALL_PROFILE_KINDS,
  WALL_TOP_FAMILIES,
} from '../src/editor/workshop/geometry/wall/WallConstants.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_CONTRACTS = Object.freeze([
  'stableWallIdentity',
  'curveBackedWalls',
  'lineArcQuadratic',
  'deterministicJoins',
  'semanticSurfaceFrames',
  'rpgFromPlan',
  'closedRendererMesh',
  'tessellationInvariantUv',
  'semanticRendererBridge',
  'legacyPresetCompatibility',
  'battlementsViaModifierAdapter',
]);

test('Phase 5 wall config mirrors runtime constants and required contracts', async () => {
  const config = yaml.load(await readFile(path.join(root, 'config', 'workshop-wall-kernel.yaml'), 'utf8'));
  assert.equal(config.version, 1);
  assert.equal(config.wallDefinitionVersion, WALL_DEFINITION_VERSION);
  assert.deepEqual(config.profileKinds, WALL_PROFILE_KINDS);
  assert.deepEqual(config.topFamilies, WALL_TOP_FAMILIES);
  assert.equal(config.planning.sampleSpacing, DEFAULT_WALL_SAMPLE_SPACING);
  assert.equal(config.planning.maxMiterRatio, DEFAULT_WALL_MAX_MITER_RATIO);
  assert.equal(config.planning.maxSections, MAX_WALL_PLAN_SECTIONS);
  assert.equal(config.legacyProjection.sampleSpacing, DEFAULT_WALL_LEGACY_SAMPLE_SPACING);
  assert.equal(config.legacyProjection.maxPoints, MAX_WALL_LEGACY_POINTS);
  for (const contract of REQUIRED_CONTRACTS) assert.equal(config.contracts[contract], true, contract);
  assert.equal(config.contracts.rendererMeshInspection, false);
});
