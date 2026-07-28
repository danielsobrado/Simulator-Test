import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  clamp,
  getViewPosition,
  length,
  max,
  oneMinus,
  pass,
  pow,
  screenUV,
  sin,
  smoothstep,
  step,
  time,
  uniform,
  vec4,
} from 'three/tsl';
import {
  PERF_COUNTER_WATER_PROJECTED_CAUSTIC_CPU_MS,
  PERF_COUNTER_WATER_PROJECTED_CAUSTIC_FRAMES,
  PerfCounters,
} from '../performance/qa/PerfCounters.js';
import { validateProjectedWaterCausticsConfig } from './ProjectedWaterCaustics.js';

const SKY_DEPTH_THRESHOLD = 0.9999;

function colorVector(value) {
  const color = new THREE.Color(value);
  return new THREE.Vector3(color.r, color.g, color.b);
}

function buildProjectedCaustics({
  beauty,
  depthTexture,
  cameraMatrixWorld,
  cameraProjectionMatrixInverse,
  cameraPosition,
  surfaceHeight,
  blend,
  color,
  config,
}) {
  return Fn(() => {
    const depth = depthTexture.sample(screenUV).r;
    const viewPosition = getViewPosition(
      screenUV,
      depth,
      cameraProjectionMatrixInverse,
    );
    const worldPosition = cameraMatrixWorld.mul(viewPosition).xyz;
    const belowSurfaceDepth = max(surfaceHeight.sub(worldPosition.y), 0);
    const belowSurface = step(worldPosition.y, surfaceHeight);
    const geometry = oneMinus(step(SKY_DEPTH_THRESHOLD, depth));
    const distance = length(worldPosition.sub(cameraPosition));
    const shallow = oneMinus(smoothstep(
      config.depthFadeStart,
      config.depthFadeEnd,
      belowSurfaceDepth,
    ));
    const distanceFade = oneMinus(smoothstep(
      config.maxDistance * 0.7,
      config.maxDistance,
      distance,
    ));
    const point = worldPosition.xz.mul(config.scale);
    const phase = time.mul(config.speed);
    const waveA = sin(point.x.add(point.y.mul(0.73)).add(phase));
    const waveB = sin(point.x.mul(-0.62).add(point.y.mul(1.31)).sub(phase.mul(1.37)));
    const waveC = sin(point.x.mul(1.71).sub(point.y.mul(0.41)).add(phase.mul(0.63)));
    const interference = clamp(
      abs(waveA.add(waveB).mul(0.36).add(waveC.mul(0.28))),
      0,
      1,
    );
    const pattern = pow(interference, config.contrast);
    const amount = pattern
      .mul(shallow)
      .mul(distanceFade)
      .mul(belowSurface)
      .mul(geometry)
      .mul(blend)
      .mul(config.intensity);
    const source = beauty.sample(screenUV);
    return vec4(source.rgb.add(color.mul(amount)), source.a);
  })();
}

export class UnderwaterCausticsPostProcess {
  constructor({ renderer, scene, config, qualityStrength = 1 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.config = validateProjectedWaterCausticsConfig(config);
    this.qualityStrength = Math.max(0, Number(qualityStrength) || 0);
    this.enabled = this.config.enabled && this.qualityStrength > 0;
    this.disposed = false;
    this.blend = uniform(0);
    this.surfaceHeight = uniform(0);
    this.color = uniform(colorVector(this.config.color));
    this.cameraMatrixWorld = uniform(new THREE.Matrix4());
    this.cameraProjectionMatrixInverse = uniform(new THREE.Matrix4());
    this.cameraPosition = uniform(new THREE.Vector3());
    this.scenePass = null;
    this.pipeline = null;
  }

  update({ blend = 0, surfaceHeight = 0 } = {}) {
    this.blend.value = THREE.MathUtils.clamp(Number(blend) || 0, 0, 1);
    if (Number.isFinite(surfaceHeight)) this.surfaceHeight.value = surfaceHeight;
  }

  ensurePipeline(camera) {
    if (!this.scenePass) {
      this.scenePass = pass(this.scene, camera, { samples: this.renderer.samples });
      this.scenePass.name = 'Underwater Caustics Scene Pass';
    }
    this.scenePass.camera = camera;
    if (!this.pipeline) {
      const beauty = this.scenePass.getTextureNode('output');
      const depthTexture = this.scenePass.getTextureNode('depth');
      this.pipeline = new THREE.RenderPipeline(this.renderer);
      this.pipeline.outputNode = buildProjectedCaustics({
        beauty,
        depthTexture,
        cameraMatrixWorld: this.cameraMatrixWorld,
        cameraProjectionMatrixInverse: this.cameraProjectionMatrixInverse,
        cameraPosition: this.cameraPosition,
        surfaceHeight: this.surfaceHeight,
        blend: this.blend,
        color: this.color,
        config: {
          ...this.config,
          intensity: this.config.intensity * this.qualityStrength,
        },
      });
    }
  }

  updateCamera(camera) {
    camera.updateMatrixWorld();
    this.cameraMatrixWorld.value.copy(camera.matrixWorld);
    this.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    camera.getWorldPosition(this.cameraPosition.value);
  }

  render(camera) {
    if (!this.enabled || this.disposed || this.blend.value <= 0) return false;
    this.ensurePipeline(camera);
    this.updateCamera(camera);
    const startedAt = performance.now();
    this.pipeline.render();
    PerfCounters.inc(PERF_COUNTER_WATER_PROJECTED_CAUSTIC_FRAMES);
    PerfCounters.set(
      PERF_COUNTER_WATER_PROJECTED_CAUSTIC_CPU_MS,
      performance.now() - startedAt,
    );
    return true;
  }

  prewarm(camera) {
    if (!this.enabled || this.disposed) return false;
    this.ensurePipeline(camera);
    this.updateCamera(camera);
    const previousBlend = this.blend.value;
    this.blend.value = 0;
    this.pipeline.render();
    this.blend.value = previousBlend;
    return true;
  }

  getStatus() {
    return Object.freeze({
      enabled: this.enabled,
      active: this.enabled && this.blend.value > 0,
      blend: this.blend.value,
      surfaceHeight: this.surfaceHeight.value,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pipeline?.dispose();
    this.scenePass?.dispose();
    this.pipeline = null;
    this.scenePass = null;
    this.renderer = null;
    this.scene = null;
  }
}
