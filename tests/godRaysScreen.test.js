import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import * as THREE from 'three';
import { validateEditorConfig } from '../src/config/validateEditorConfig.js';
import {
  StylizedGodRaysPostProcess,
  advectedDustDensityReference,
  dustModulationReference,
  exponentialHeightFogReference,
  godRaysCloudTransmissionReference,
  godRaysOcclusionContrastReference,
  godRaysRadialStepReference,
  godRaysScreenFalloffReference,
  godRaysScreenUvCoverageReference,
  godRaysSunSourceReference,
  godRaysVisibilityReference,
  projectSunToScreen,
  sunScreenFade,
} from '../src/editor/stylized/StylizedGodRaysPostProcess.js';
import { cloudMotionCoordinatesReference } from '../src/editor/stylized/AtmosphereMotion.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function frontCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

function enabledConfig() {
  return {
    enabled: true,
    technique: 'screen-space',
    intensity: 1.2,
    resolutionScale: 0.6,
    samples: 24,
    density: 0.96,
    decay: 0.92,
    weight: 0.35,
    exposure: 0.85,
    dustStrength: 0.65,
    dustScale: 4.5,
    dustSpeed: 0.04,
    cloudOcclusion: 0.9,
    volumetric: {
      intensity: 1,
      resolutionScale: 0.5,
      raymarchSteps: 40,
      density: 0.7,
      maxDensity: 0.45,
      distanceAttenuation: 2,
      blurSoftness: 0.85,
      cloudInfluence: 0.75,
      fogDensity: 0.018,
      fogBaseHeight: 2,
      fogHeightFalloff: 0.035,
      fogMaxDistance: 180,
    },
  };
}

test('projects a directional sun through camera transforms', () => {
  const camera = frontCamera();
  const center = projectSunToScreen(new THREE.Vector3(0, 0, -1), camera);
  assert.equal(center.visible, true);
  assert.ok(Math.abs(center.u - 0.5) < 1e-4);
  assert.ok(Math.abs(center.v - 0.5) < 1e-4);
  assert.ok(Math.abs(center.forward - 1) < 1e-5);

  const behind = projectSunToScreen(new THREE.Vector3(0, 0, 1), camera);
  assert.equal(behind.visible, false);
  assert.ok(behind.forward < 0);

  const right = projectSunToScreen(new THREE.Vector3(1, 0, -1).normalize(), camera);
  assert.ok(right.u > 0.5);
  const above = projectSunToScreen(new THREE.Vector3(0, 1, -1).normalize(), camera);
  assert.ok(above.v < 0.5);

  camera.rotateY(THREE.MathUtils.degToRad(-30));
  camera.updateMatrixWorld(true);
  assert.ok(projectSunToScreen(new THREE.Vector3(0, 0, -1), camera).u < 0.5);
});

test('sun projection honors a parented camera world position', () => {
  const parent = new THREE.Group();
  parent.position.set(10_000_000, 2_000_000, -3_000_000);
  const camera = frontCamera();
  parent.add(camera);
  parent.updateMatrixWorld(true);

  const info = projectSunToScreen(new THREE.Vector3(0, 0, -1), camera);
  assert.equal(info.visible, true);
  assert.ok(Math.abs(info.u - 0.5) < 1e-4);
  assert.ok(Math.abs(info.v - 0.5) < 1e-4);
});

test('two smooth dust octaves carve dark lanes and bright density patches', () => {
  assert.equal(dustModulationReference(0.5, 0.5, 0), 1);
  const darkLane = dustModulationReference(0.1, 0.5, 0.8);
  const dustyShaft = dustModulationReference(0.7, 0.5, 0.8);
  const brightDetail = dustModulationReference(0.7, 0.99, 0.8);
  assert.ok(darkLane < 0.3);
  assert.ok(dustyShaft > 1);
  assert.ok(brightDetail > dustyShaft);
});

test('default radial dust has readable slow motion instead of a fixed spoke multiplier', () => {
  const config = enabledConfig();
  const darkDensity = dustModulationReference(0.1, 0.5, config.dustStrength);
  const brightDensity = dustModulationReference(0.7, 0.5, config.dustStrength);
  const tenSecondDrift = config.dustSpeed * 10;

  assert.ok(
    brightDensity - darkDensity >= 0.25,
    'default dust contrast must visibly break up the integrated radial spokes',
  );
  assert.ok(
    tenSecondDrift >= 0.2 && tenSecondDrift <= 0.8,
    'default dust must cross a readable fraction of one smooth noise cell in ten seconds',
  );
});

test('advected radial dust evolves continuously rather than blinking between frames', () => {
  const config = enabledConfig();
  const sample = (timeSeconds) => advectedDustDensityReference({
    u: 0.37,
    v: 0.62,
    timeSeconds,
    scale: config.dustScale,
    speed: config.dustSpeed,
    strength: config.dustStrength,
  });
  const start = sample(0);
  const nextFrame = sample(1 / 60);
  const tenSeconds = sample(10);

  assert.equal(sample(0), start, 'the dust field must be deterministic');
  assert.ok(
    Math.abs(nextFrame - start) < 0.01,
    'adjacent frames must remain temporally smooth',
  );
  assert.ok(
    Math.abs(tenSeconds - start) > 0.05,
    'the density field must visibly evolve over several seconds',
  );
});

test('clouds drift and subtly evolve without adjacent-frame popping', () => {
  const config = yaml.load(readFileSync(path.join(root, 'editor.config.yaml'), 'utf8'));
  const sky = config.stylizedSurface.sky;
  const sample = (timeSeconds) => cloudMotionCoordinatesReference({
    projectedX: 0.37,
    projectedY: -0.24,
    timeSeconds,
    scale: sky.cloudScale,
    speed: sky.cloudSpeed,
  });
  const start = sample(0);
  const nextFrame = sample(1 / 60);
  const tenSeconds = sample(10);
  const rigidTenSeconds = {
    x: 0.37 * sky.cloudScale + sky.cloudSpeed * 10,
    y: -0.24 * sky.cloudScale + sky.cloudSpeed * 10 * 0.37,
  };
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  assert.ok(distance(start, nextFrame) < 0.002, 'cloud motion must stay smooth frame to frame');
  assert.ok(distance(start, tenSeconds) > 0.1, 'cloud drift must be visible over several seconds');
  assert.ok(
    distance(tenSeconds, rigidTenSeconds) > 0.02,
    'cloud silhouettes must evolve instead of translating as a rigid texture',
  );
});

test('screen coverage includes exact edges and rejects outside samples', () => {
  assert.equal(godRaysScreenUvCoverageReference(0, 0), 1);
  assert.equal(godRaysScreenUvCoverageReference(0.5, 0.5), 1);
  assert.equal(godRaysScreenUvCoverageReference(1, 1), 1);
  assert.equal(godRaysScreenUvCoverageReference(-0.001, 0.5), 0);
  assert.equal(godRaysScreenUvCoverageReference(1.001, 0.5), 0);
  assert.equal(godRaysScreenUvCoverageReference(0.5, -0.001), 0);
  assert.equal(godRaysScreenUvCoverageReference(0.5, 1.001), 0);
});

test('god rays require mixed sky and occluder samples', () => {
  const clear = Array(16).fill(1);
  const blocked = Array(16).fill(0);
  const horizon = [...Array(8).fill(0), ...Array(8).fill(1)];
  assert.equal(godRaysOcclusionContrastReference(clear), 0);
  assert.equal(godRaysOcclusionContrastReference(blocked), 0);
  assert.equal(godRaysOcclusionContrastReference(horizon), 0);

  const sparseBranch = godRaysOcclusionContrastReference(
    [...Array(8).fill(1), 1, 1, 1, 1, 1, 1, 1, 0],
  );
  const outerBranch = godRaysOcclusionContrastReference(
    [...Array(8).fill(1), 1, 1, 1, 0, 1, 1, 1, 1],
  );
  const brokenCanopy = godRaysOcclusionContrastReference(
    [...Array(8).fill(1), 1, 0, 1, 0, 1, 0, 1, 0],
  );
  assert.ok(sparseBranch > 0);
  assert.ok(sparseBranch < 0.5);
  assert.ok(outerBranch > 0);
  assert.ok(brokenCanopy > 0.9);
  assert.ok(brokenCanopy > sparseBranch);
});

test('cloud transmission contributes to ray occlusion without activating uniform cloud', () => {
  const clearTransmission = godRaysCloudTransmissionReference(0, 0.9);
  const cloudTransmission = godRaysCloudTransmissionReference(0.5, 0.9);
  assert.equal(clearTransmission, 1);
  assert.equal(cloudTransmission, 0.55);
  assert.equal(godRaysVisibilityReference(0.5, clearTransmission), 0);
  assert.equal(godRaysVisibilityReference(1, cloudTransmission), 0.55);
  assert.equal(
    godRaysOcclusionContrastReference(Array(8).fill(cloudTransmission)),
    0,
  );
  assert.ok(godRaysOcclusionContrastReference([
    clearTransmission,
    cloudTransmission,
    clearTransmission,
    cloudTransmission,
    clearTransmission,
    cloudTransmission,
    clearTransmission,
    cloudTransmission,
  ]) > 0);
});

test('god rays scatter the sun glow rather than the whole bright sky', () => {
  assert.equal(godRaysSunSourceReference(0), 1);
  assert.ok(godRaysSunSourceReference(0.08) > 0);
  assert.ok(godRaysSunSourceReference(0.16) > 0);
  assert.equal(godRaysSunSourceReference(0.22), 0);
  assert.equal(godRaysSunSourceReference(0.5), 0);
});

test('default ray taps cannot produce large displaced silhouette steps', () => {
  const config = enabledConfig();
  assert.ok(
    godRaysRadialStepReference(1, config.density, config.samples) <= 0.04,
    'radial samples must stay within 4% of screen distance',
  );
  assert.ok(
    config.resolutionScale >= 0.5,
    'ray target must retain at least half-resolution silhouette detail',
  );
});

test('radial falloff and sun visibility fade smoothly to zero', () => {
  const values = [0, 0.35, 0.7, 1.4, 2].map(godRaysScreenFalloffReference);
  assert.equal(values[0], 1);
  assert.ok(values[0] > values[1] && values[1] > values[2]);
  assert.equal(values[3], 0);
  assert.equal(values[4], 0);

  const info = (u, v, forward = 1) => ({
    u,
    v,
    forward,
    visible: forward > 0,
  });
  assert.equal(sunScreenFade(info(0.5, 0.5)), 1);
  assert.equal(sunScreenFade(info(0.5, 0.5, 0)), 0);
  assert.equal(sunScreenFade(info(0.5, 0.5, -0.4)), 0);
  const nearEdge = sunScreenFade(info(1.05, 0.5));
  const farther = sunScreenFade(info(1.2, 0.5));
  assert.ok(nearEdge > farther && farther > 0);
  assert.equal(sunScreenFade(info(1.5, 0.5)), 0);
  const grazing = sunScreenFade(info(0.5, 0.5, 0.03));
  assert.ok(grazing > 0 && grazing < 1);
});

test('exponential height fog thickens near its base and saturates smoothly with distance', () => {
  const settings = {
    cameraHeight: 2,
    density: 0.018,
    baseHeight: 2,
    heightFalloff: 0.035,
    maxDistance: 180,
  };
  const nearGround = exponentialHeightFogReference({
    ...settings,
    targetHeight: 2,
    distance: 80,
  });
  const highCanopy = exponentialHeightFogReference({
    ...settings,
    targetHeight: 80,
    distance: 80,
  });
  const near = exponentialHeightFogReference({
    ...settings,
    targetHeight: 2,
    distance: 20,
  });
  const far = exponentialHeightFogReference({
    ...settings,
    targetHeight: 2,
    distance: 500,
  });
  const capped = exponentialHeightFogReference({
    ...settings,
    targetHeight: 2,
    distance: settings.maxDistance,
  });
  assert.ok(nearGround > highCanopy);
  assert.ok(far > near);
  assert.equal(far, capped);
  assert.ok(nearGround >= 0 && nearGround <= 1);
});

test('god rays route only perspective cameras and reuse their pipeline', () => {
  const renderer = {
    samples: 4,
    toneMapping: THREE.ACESFilmicToneMapping,
    outputColorSpace: THREE.SRGBColorSpace,
  };
  const effect = new StylizedGodRaysPostProcess({
    renderer,
    scene: new THREE.Scene(),
    config: enabledConfig(),
    sunDirection: new THREE.Vector3(0, 0, -1),
    sunColor: '#fff4d6',
  });
  const perspective = frontCamera();
  const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  orthographic.updateMatrixWorld(true);
  effect.setCloudMaskScene(new THREE.Scene());

  assert.equal(effect.shouldRender(perspective), true);
  assert.equal(effect.shouldRender(orthographic), false);
  effect.ensurePipeline(perspective);
  const pipeline = effect.pipeline;
  assert.ok(effect.cloudPass);
  effect.ensurePipeline(frontCamera());
  assert.equal(effect.pipeline, pipeline);

  let renders = 0;
  effect.pipeline.render = () => {
    renders += 1;
  };
  assert.equal(effect.prewarm(perspective), true);
  assert.equal(renders, 1);
  effect.dispose();
  assert.equal(effect.pipeline, null);
  assert.equal(effect.scenePass, null);
  assert.equal(effect.cloudPass, null);
  assert.equal(effect.raysTexture, null);
  assert.equal(effect.shouldRender(perspective), false);
});

test('god ray settings switch techniques and update live uniforms safely', () => {
  const cloudOcclusionUniform = { value: 0.9 };
  const effect = new StylizedGodRaysPostProcess({
    renderer: { samples: 4 },
    scene: new THREE.Scene(),
    config: enabledConfig(),
    sunDirection: new THREE.Vector3(0, 0, -1),
    sunColor: '#fff4d6',
  });
  effect.setCloudMaskScene(new THREE.Scene(), { cloudOcclusionUniform });

  const settings = effect.setSettings({
    technique: 'volumetric',
    screenDensity: 1.35,
    screenDustSpeed: 0.075,
    cloudOcclusion: 0.4,
    volumetricRaymarchSteps: 57.6,
    volumetricBlurSoftness: 1.25,
    heightFogDensity: 0.024,
  });
  assert.equal(settings.technique, 'volumetric');
  assert.equal(settings.screenDensity, 1.35);
  assert.equal(effect.density.value, 1.35);
  assert.equal(settings.screenDustSpeed, 0.075);
  assert.equal(effect.dustSpeed.value, 0.075);
  assert.equal(cloudOcclusionUniform.value, 0.4);
  assert.equal(settings.volumetricRaymarchSteps, 58);
  assert.equal(effect.volumetricBlurSoftness.value, 1.25);
  assert.equal(effect.heightFogDensity.value, 0.024);

  const clamped = effect.setSettings({
    volumetricResolutionScale: 4,
    volumetricRaymarchSteps: 2,
    screenDustSpeed: 4,
    cloudOcclusion: -5,
  });
  assert.equal(clamped.volumetricResolutionScale, 1);
  assert.equal(clamped.volumetricRaymarchSteps, 8);
  assert.equal(clamped.screenDustSpeed, 0.2);
  assert.equal(effect.dustSpeed.value, 0.2);
  assert.equal(clamped.cloudOcclusion, 0);
  effect.dispose();
});

test('the scene clock explicitly drives animated dust in the god-ray RTT', () => {
  const effect = new StylizedGodRaysPostProcess({
    renderer: { samples: 4 },
    scene: new THREE.Scene(),
    config: enabledConfig(),
    sunDirection: new THREE.Vector3(0, 0, -1),
    sunColor: '#fff4d6',
  });

  effect.setTime(12.5);
  assert.equal(effect.atmosphereTime.value, 12.5);
  effect.setTime(Number.NaN);
  assert.equal(effect.atmosphereTime.value, 12.5);
  effect.dispose();
});

test('god rays configuration validates defaults and rejects unsafe budgets', () => {
  const config = yaml.load(readFileSync(path.join(root, 'editor.config.yaml'), 'utf8'));
  assert.equal(validateEditorConfig(config), config);
  assert.deepEqual(config.stylizedSurface.sky.godRays, enabledConfig());

  const tooManySamples = structuredClone(config);
  tooManySamples.stylizedSurface.sky.godRays.samples = 65;
  assert.throws(
    () => validateEditorConfig(tooManySamples),
    /godRays\.samples must be an integer from 1 to 64/,
  );

  const oversizedTarget = structuredClone(config);
  oversizedTarget.stylizedSurface.sky.godRays.resolutionScale = 1.1;
  assert.throws(
    () => validateEditorConfig(oversizedTarget),
    /godRays\.resolutionScale must be within/,
  );

  const negativeIntensity = structuredClone(config);
  negativeIntensity.stylizedSurface.sky.godRays.intensity = -0.1;
  assert.throws(
    () => validateEditorConfig(negativeIntensity),
    /intensity and dustSpeed must be non-negative/,
  );

  const excessiveCloudOcclusion = structuredClone(config);
  excessiveCloudOcclusion.stylizedSurface.sky.godRays.cloudOcclusion = 1.1;
  assert.throws(
    () => validateEditorConfig(excessiveCloudOcclusion),
    /stylized blend strengths must be within/,
  );

  const invalidTechnique = structuredClone(config);
  invalidTechnique.stylizedSurface.sky.godRays.technique = 'magic';
  assert.throws(
    () => validateEditorConfig(invalidTechnique),
    /godRays\.technique must be screen-space or volumetric/,
  );

  const tooManyVolumetricSteps = structuredClone(config);
  tooManyVolumetricSteps.stylizedSurface.sky.godRays.volumetric.raymarchSteps = 129;
  assert.throws(
    () => validateEditorConfig(tooManyVolumetricSteps),
    /volumetric\.raymarchSteps must be an integer from 8 to 128/,
  );
});
