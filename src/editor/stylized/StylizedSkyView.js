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
  vec2,
  vec3,
} from 'three/tsl';
import { stylizedFbm } from './StylizedNoiseNodes.js';

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

function directionFromAngles(elevationDegrees, azimuthDegrees) {
  const elevation = THREE.MathUtils.degToRad(elevationDegrees);
  const azimuth = THREE.MathUtils.degToRad(azimuthDegrees);
  return new THREE.Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth),
  ).normalize();
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

  const projected = direction.xz.div(max(direction.y.add(0.55), 0.16));
  const cloudUv = projected.mul(config.sky.cloudScale).add(
    vec2(time.mul(config.sky.cloudSpeed), time.mul(config.sky.cloudSpeed * 0.37)),
  );
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
  const cloudMask = cloudShape.mul(cloudFloor).mul(cloudCeiling).mul(config.sky.cloudOpacity);
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

export class StylizedSkyView {
  constructor({ terrainView, config }) {
    this.terrainView = terrainView;
    this.config = config;
    this.time = uniform(0);
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
    terrainView.scene.fog = new THREE.FogExp2(config.sky.fogColor, config.sky.fogDensity);
  }

  setRadius(radius) {
    if (Number.isFinite(radius) && radius > 0) {
      this.mesh.scale.setScalar(radius);
    }
  }

  setFogDensity(density) {
    if (this.terrainView.scene.fog && Number.isFinite(density) && density >= 0) {
      this.terrainView.scene.fog.density = density;
    }
  }

  update(timestamp, camera) {
    if (!camera) return;
    this.time.value = timestamp / 1000;
    this.mesh.position.copy(camera.position);
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
    this.terrainView.scene.fog = null;
    this.directional.dispose();
  }
}
