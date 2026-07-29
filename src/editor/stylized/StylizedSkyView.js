import * as THREE from 'three/webgpu';
import {
  clamp,
  dot,
  float,
  max,
  mix,
  normalize,
  oneMinus,
  positionLocal,
  pow,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import { cloudMotionCoordinatesNode } from './AtmosphereMotion.js';
import { directionFromAngles } from './StylizedGodRaysPostProcess.js';
import { stylizedFbm } from './StylizedNoiseNodes.js';

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

function cloudCoverageNode({ config, time, direction }) {
  const projected = direction.xz.div(max(direction.y.add(0.55), 0.16));
  const cloudUv = cloudMotionCoordinatesNode({
    projected,
    timeNode: time,
    scale: config.sky.cloudScale,
    speed: config.sky.cloudSpeed,
  });
  const cloudNoise = stylizedFbm(cloudUv);
  const cloudShape = smoothstep(
    config.sky.cloudDensity,
    config.sky.cloudDensity + config.sky.cloudSharpness,
    cloudNoise,
  );
  const cloudFloor = smoothstep(
    config.sky.cloudFloor,
    config.sky.cloudFloor + 0.08,
    direction.y,
  );
  const cloudCeiling = oneMinus(smoothstep(
    config.sky.cloudCeiling - 0.08,
    config.sky.cloudCeiling,
    direction.y,
  ));
  return {
    coverage: cloudShape.mul(cloudFloor).mul(cloudCeiling),
    shape: cloudShape,
  };
}

function createSkyMaterial({ config, time, sunDirection }) {
  const direction = normalize(positionLocal);
  const horizon = smoothstep(
    config.sky.horizonLine - config.sky.horizonSpread,
    config.sky.horizonLine + config.sky.horizonSpread,
    direction.y,
  );
  let color = mix(
    colorNode(config.sky.lowColor),
    colorNode(config.sky.highColor),
    horizon,
  );

  const sunAlignment = clamp(dot(direction, sunDirection), 0, 1);
  const sunInner = Math.cos(config.sky.sunSize);
  const sunOuter = Math.cos(config.sky.sunSize + config.sky.sunEdgeSoftness);
  const sunDisc = smoothstep(sunOuter, sunInner, sunAlignment);
  const sunGlow = pow(sunAlignment, config.sky.sunGlowFalloff)
    .mul(config.sky.sunGlowIntensity);
  color = color.add(colorNode(config.sky.sunGlowColor).mul(sunGlow));
  color = mix(color, colorNode(config.sky.sunColor).mul(config.sky.sunEmission), sunDisc);

  const {
    coverage: cloudCoverage,
    shape: cloudShape,
  } = cloudCoverageNode({ config, time, direction });
  const cloudMask = cloudCoverage.mul(config.sky.cloudOpacity);
  const cloudEdge = smoothstep(0.15, 0.85, cloudShape);
  const cloudColor = mix(
    colorNode(config.sky.cloudCore),
    colorNode(config.sky.cloudEdge),
    cloudEdge,
  );
  const cloudRim = pow(sunAlignment, config.sky.cloudRimFalloff)
    .mul(config.sky.cloudRimStrength)
    .mul(cloudEdge);
  const litCloud = cloudColor.add(colorNode(config.sky.cloudRim).mul(cloudRim));
  color = mix(color, litCloud, cloudMask);

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  material.colorNode = max(color, vec3(0));
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  return material;
}

function createCloudTransmissionMaterial({ config, time, cloudOcclusion }) {
  const direction = normalize(positionLocal);
  const { coverage } = cloudCoverageNode({ config, time, direction });
  const transmission = oneMinus(
    coverage.mul(cloudOcclusion),
  );
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  material.colorNode = vec3(transmission);
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.toneMapped = false;
  return material;
}

export class StylizedSkyView {
  constructor({ terrainView, config }) {
    this.terrainView = terrainView;
    this.config = config;
    this.time = uniform(0);
    this.cloudOcclusion = uniform(
      config.sky.godRays?.cloudOcclusion ?? config.sky.cloudOpacity,
    );
    this.sunDirectionValue = directionFromAngles(config.sky.sunElevation, config.sky.sunAzimuth);
    this.sunDirection = vec3(
      this.sunDirectionValue.x,
      this.sunDirectionValue.y,
      this.sunDirectionValue.z,
    );
    this.geometry = new THREE.SphereGeometry(1, 64, 32);
    this.material = createSkyMaterial({
      config,
      time: this.time,
      sunDirection: this.sunDirection,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.scale.setScalar(config.sky.radius);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'stylized-sky-dome';
    terrainView.scene.add(this.mesh);
    this.cloudMaskScene = new THREE.Scene();
    this.cloudMaskMaterial = createCloudTransmissionMaterial({
      config,
      time: this.time,
      cloudOcclusion: this.cloudOcclusion,
    });
    this.cloudMaskMesh = new THREE.Mesh(this.geometry, this.cloudMaskMaterial);
    this.cloudMaskMesh.scale.setScalar(config.sky.radius);
    this.cloudMaskMesh.frustumCulled = false;
    this.cloudMaskMesh.name = 'stylized-cloud-transmission-dome';
    this.cloudMaskScene.add(this.cloudMaskMesh);
    terrainView.godRays.setCloudMaskScene(this.cloudMaskScene, {
      cloudOcclusionUniform: this.cloudOcclusion,
    });

    // This rig is the scene's single lighting authority. Evict any fallback
    // lighting added before it was constructed (see `ObjectView`), otherwise the
    // world runs a second unshadowed sun from a different direction and every
    // building reads flat.
    for (const child of [...terrainView.scene.children]) {
      if (child.userData?.fallbackLighting) terrainView.scene.remove(child);
    }

    this.hemisphere = new THREE.HemisphereLight(
      config.sky.highColor,
      config.sky.groundLightColor,
      config.sky.ambientIntensity,
    );
    this.directional = new THREE.DirectionalLight(
      config.sky.directionalColor,
      config.sky.directionalIntensity,
    );
    this.directional.castShadow = config.sky.shadows;
    this.directional.shadow.mapSize.set(config.sky.shadowMapSize, config.sky.shadowMapSize);
    this.directional.shadow.bias = config.sky.shadowBias;
    this.directional.shadow.normalBias = config.sky.shadowNormalBias;
    this.directional.shadow.radius = config.sky.shadowRadius ?? 2.4;
    this.directional.shadow.camera.near = 1;
    this.directional.shadow.camera.far = config.sky.shadowDistance * 2;
    const extent = config.sky.shadowDistance;
    this.directional.shadow.camera.left = -extent;
    this.directional.shadow.camera.right = extent;
    this.directional.shadow.camera.top = extent;
    this.directional.shadow.camera.bottom = -extent;
    terrainView.scene.add(this.hemisphere, this.directional, this.directional.target);
    terrainView.godRays.setVolumetricLight(this.directional);
    terrainView.scene.fog = new THREE.FogExp2(config.sky.fogColor, config.sky.fogDensity);
  }

  setRadius(radius) {
    if (Number.isFinite(radius) && radius > 0) {
      this.mesh.scale.setScalar(radius);
      this.cloudMaskMesh.scale.setScalar(radius);
    }
  }

  setFogDensity(density) {
    if (this.terrainView.scene.fog && Number.isFinite(density) && density >= 0) {
      this.terrainView.scene.fog.density = density;
    }
  }

  update(timestamp, camera) {
    if (!camera) return;
    const timeSeconds = timestamp / 1000;
    this.time.value = timeSeconds;
    this.terrainView.godRays.setTime(timeSeconds);
    this.mesh.position.copy(camera.position);
    this.cloudMaskMesh.position.copy(camera.position);
    this.directional.position.copy(camera.position).addScaledVector(
      this.sunDirectionValue,
      this.config.sky.lightDistance,
    );
    this.directional.target.position.copy(camera.position);
    this.directional.target.updateMatrixWorld();
  }

  dispose() {
    this.terrainView.scene.remove(
      this.mesh,
      this.hemisphere,
      this.directional,
      this.directional.target,
    );
    this.geometry.dispose();
    this.material.dispose();
    this.cloudMaskMaterial.dispose();
    this.terrainView.scene.fog = null;
    this.directional.dispose();
  }
}
