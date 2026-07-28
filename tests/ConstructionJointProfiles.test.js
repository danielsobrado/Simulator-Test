import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  CONSTRUCTION_JOINT_PROFILES,
  constructionJointProfile,
} from '../src/editor/construction/config/ConstructionJointProfiles.generated.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YAML_PATH = join(ROOT, 'src/editor/construction/config/masonry-joints.yml');
const GENERATED_PATH = join(
  ROOT,
  'src/editor/construction/config/ConstructionJointProfiles.generated.js',
);
const GENERATOR = join(ROOT, 'tools/generate-construction-joint-profiles.mjs');

function runGenerator(args = []) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function writeTempYaml(document) {
  const dir = mkdtempSync(join(tmpdir(), 'joint-profiles-'));
  const path = join(dir, 'masonry-joints.yml');
  writeFileSync(path, yaml.dump(document));
  return { dir, path };
}

const validBase = {
  version: 1,
  defaults: {
    headJoint: { min: 0.012, max: 0.03 },
    bedJoint: { min: 0.0084, max: 0.021 },
    coarseLodMultiplier: 1,
    mortarSafetyOverlap: 0.003,
    minimumRenderedWidth: 0.12,
    minimumRenderedHeight: 0.08,
  },
  styles: {},
};

function assertGeneratorRejects(document, messagePart) {
  const { dir, path } = writeTempYaml(document);
  try {
    const result = runGenerator(['--yaml', path, '--out', join(dir, 'out.js')]);
    assert.notEqual(result.status, 0, 'generator should fail');
    const err = `${result.stderr || ''}${result.stdout || ''}`;
    assert.match(err, new RegExp(messagePart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('generated config matches YAML source values', () => {
  const document = yaml.load(readFileSync(YAML_PATH, 'utf8'));
  const defaults = constructionJointProfile('default');
  assert.equal(defaults.headJoint.min, document.defaults.headJoint.min);
  assert.equal(defaults.headJoint.max, document.defaults.headJoint.max);
  assert.equal(defaults.bedJoint.min, document.defaults.bedJoint.min);
  assert.equal(defaults.bedJoint.max, document.defaults.bedJoint.max);
  assert.equal(defaults.coarseLodMultiplier, document.defaults.coarseLodMultiplier);
  assert.equal(defaults.mortarSafetyOverlap, document.defaults.mortarSafetyOverlap);
  assert.equal(defaults.minimumRenderedWidth, document.defaults.minimumRenderedWidth);
  assert.equal(defaults.minimumRenderedHeight, document.defaults.minimumRenderedHeight);

  const soft = constructionJointProfile('soft-limestone-rubble');
  const softYaml = document.styles['soft-limestone-rubble'];
  assert.equal(soft.headJoint.min, softYaml.headJoint.min);
  assert.equal(soft.headJoint.max, softYaml.headJoint.max);
  assert.equal(soft.bedJoint.min, softYaml.bedJoint.min);
  assert.equal(soft.bedJoint.max, softYaml.bedJoint.max);
  assert.equal(soft.coarseLodMultiplier, softYaml.coarseLodMultiplier);
});

test('generator --check passes for checked-in output', () => {
  const result = runGenerator(['--check']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('generator output is deterministic', () => {
  const first = runGenerator();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const afterFirst = readFileSync(GENERATED_PATH, 'utf8');
  const second = runGenerator();
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(readFileSync(GENERATED_PATH, 'utf8'), afterFirst);
});

test('default profile preserves legacy joint dimensions', () => {
  const profile = constructionJointProfile('coursed-rubble');
  assert.equal(profile.headJoint.min, 0.012);
  assert.equal(profile.headJoint.max, 0.03);
  assert.equal(profile.bedJoint.min, 0.0084);
  assert.equal(profile.bedJoint.max, 0.021);
  assert.equal(profile.coarseLodMultiplier, 1);
  assert.equal(profile, CONSTRUCTION_JOINT_PROFILES.default);
});

test('soft-limestone-rubble resolves its override', () => {
  const profile = constructionJointProfile('soft-limestone-rubble');
  assert.equal(profile.headJoint.min, 0.026);
  assert.equal(profile.headJoint.max, 0.04);
  assert.equal(profile.bedJoint.min, 0.02);
  assert.equal(profile.bedJoint.max, 0.03);
  assert.equal(profile.coarseLodMultiplier, 1.2);
  assert.notEqual(profile, CONSTRUCTION_JOINT_PROFILES.default);
});

test('generated objects are frozen', () => {
  assert.equal(Object.isFrozen(CONSTRUCTION_JOINT_PROFILES), true);
  for (const profile of Object.values(CONSTRUCTION_JOINT_PROFILES)) {
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.headJoint), true);
    assert.equal(Object.isFrozen(profile.bedJoint), true);
  }
});

test('unknown style keys fall back to default', () => {
  assert.equal(
    constructionJointProfile('does-not-exist'),
    CONSTRUCTION_JOINT_PROFILES.default,
  );
});

test('unknown fields are rejected', () => {
  assertGeneratorRejects(
    {
      ...validBase,
      defaults: { ...validBase.defaults, headJont: { min: 0.01, max: 0.02 } },
    },
    'unknown key "headJont"',
  );
});

test('reversed ranges are rejected', () => {
  assertGeneratorRejects(
    {
      ...validBase,
      defaults: {
        ...validBase.defaults,
        headJoint: { min: 0.04, max: 0.02 },
      },
    },
    'range is reversed',
  );
});

test('negative widths are rejected', () => {
  assertGeneratorRejects(
    {
      ...validBase,
      defaults: {
        ...validBase.defaults,
        bedJoint: { min: -0.01, max: 0.02 },
      },
    },
    'must be between 0 and 0.1',
  );
});

test('excessive widths are rejected', () => {
  assertGeneratorRejects(
    {
      ...validBase,
      defaults: {
        ...validBase.defaults,
        headJoint: { min: 0.01, max: 0.2 },
      },
    },
    'must be between 0 and 0.1',
  );
});
