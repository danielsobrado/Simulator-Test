import * as THREE from 'three/webgpu';
import {
  atan,
  attribute,
  cameraPosition,
  clamp,
  cross,
  floor,
  length,
  min,
  mix,
  mod,
  normalize,
  positionLocal,
  sin,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { screenDitherThreshold } from '../lod/screenDither.js';

const TWO_PI = Math.PI * 2;

function createMaterial({ atlas, readTransform, readParameters, readAppearance }) {
  const cameraRight = uniform(new THREE.Vector3(1, 0, 0));
  const cameraUp = uniform(new THREE.Vector3(0, 1, 0));
  const sphericalBlend = uniform(0);
  const time = uniform(0);
  const windStrength = uniform(0.03);
  const transform = readTransform();
  const parameters = readParameters();
  const appearance = readAppearance();
  const scale = transform.w;
  const widthScale = appearance.x;
  const right = normalize(cameraRight);
  const up = normalize(mix(vec3(0, 1, 0), cameraUp, sphericalBlend));
  const backward = normalize(cross(right, up));
  const local = positionLocal;
  const canopyOffset = sin(time.mul(0.55).add(parameters.z.mul(TWO_PI)))
    .mul(windStrength)
    .mul(scale);
  const worldPosition = transform.xyz
    .add(right.mul(local.x.mul(atlas.width).mul(scale).mul(widthScale)))
    .add(up.mul(local.y.mul(atlas.height).mul(scale)))
    .add(right.mul(canopyOffset));

  const viewDelta = cameraPosition.sub(transform.xyz);
  const localAzimuth = mod(atan(viewDelta.x, viewDelta.z).sub(parameters.x).add(TWO_PI), TWO_PI);
  const columnPosition = localAzimuth.div(TWO_PI).mul(atlas.columns);
  const column0 = floor(columnPosition);
  const column1 = mod(column0.add(1), atlas.columns);
  const columnBlend = columnPosition.fract();
  const elevation = atan(viewDelta.y, length(viewDelta.xz));
  const lowElevation = atlas.lowElevationDegrees * Math.PI / 180;
  const highElevation = atlas.highElevationDegrees * Math.PI / 180;
  const rowPosition = clamp(
    elevation.sub(lowElevation).div(Math.max(0.0001, highElevation - lowElevation)),
    0,
    1,
  ).mul(Math.max(0, atlas.rows - 1));
  const row0 = floor(rowPosition);
  const row1 = min(row0.add(1), Math.max(0, atlas.rows - 1));
  const rowBlend = rowPosition.fract();
  const gutter = Math.max(0, atlas.gutter ?? 0);
  const tileScale = Math.max(0.001, (atlas.tileSize - gutter * 2) / atlas.tileSize);
  const tileOffset = gutter / atlas.tileSize;
  const localUv = uv().mul(tileScale).add(tileOffset);
  const sampleAtlas = (map, column, row) => texture(map, vec2(
    localUv.x.add(column).div(atlas.columns),
    localUv.y.add(row).div(atlas.rows),
  ));
  const blendAtlas = (map) => mix(
    mix(sampleAtlas(map, column0, row0), sampleAtlas(map, column1, row0), columnBlend),
    mix(sampleAtlas(map, column0, row1), sampleAtlas(map, column1, row1), columnBlend),
    rowBlend,
  );
  const albedo = blendAtlas(atlas.albedo);
  const encodedNormal = blendAtlas(atlas.normal).rgb;
  const viewNormal = encodedNormal.mul(2).sub(1);
  const worldNormal = normalize(
    right.mul(viewNormal.x)
      .add(up.mul(viewNormal.y))
      .add(backward.mul(viewNormal.z)),
  );
  const coverage = albedo.a.mul(parameters.y);
  const visible = step(screenDitherThreshold(parameters.z), coverage);

  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.positionNode = worldPosition;
  material.colorNode = albedo.rgb.mul(appearance.yzw);
  material.normalNode = worldNormal;
  material.opacityNode = visible;
  material.alphaTest = 0.5;
  material.transparent = false;
  material.depthWrite = true;
  material.fog = true;
  return {
    material,
    uniforms: { cameraRight, cameraUp, sphericalBlend, time, windStrength },
  };
}

export function createCpuTreeImpostorMaterial(atlas) {
  return createMaterial({
    atlas,
    readTransform: () => attribute('instanceTransform', 'vec4'),
    readParameters: () => attribute('instanceImpostorParams', 'vec4'),
    readAppearance: () => attribute('instanceImpostorAppearance', 'vec4'),
  });
}

export function createGpuTreeImpostorMaterial({
  atlas,
  transformRead,
  parameterRead,
  appearanceRead,
  visibleRead,
  instanceIndex,
  originUniform,
}) {
  return createMaterial({
    atlas,
    readTransform: () => {
      const transform = transformRead.element(visibleRead.element(instanceIndex));
      return vec4(transform.xyz.sub(originUniform), transform.w);
    },
    readParameters: () => parameterRead.element(visibleRead.element(instanceIndex)),
    readAppearance: () => appearanceRead.element(visibleRead.element(instanceIndex)),
  });
}

export function updateImpostorCameraUniforms(uniforms, camera, timestamp = 0) {
  camera.updateMatrixWorld();
  const elements = camera.matrixWorld.elements;
  uniforms.cameraRight.value.set(elements[0], elements[1], elements[2]).normalize();
  uniforms.cameraUp.value.set(elements[4], elements[5], elements[6]).normalize();
  const forwardY = Math.abs(elements[9]);
  uniforms.sphericalBlend.value = THREE.MathUtils.smoothstep(forwardY, 0.35, 0.82);
  uniforms.time.value = timestamp / 1000;
}
