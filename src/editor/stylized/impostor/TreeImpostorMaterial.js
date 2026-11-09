import { applyJungleMist } from '../ambient/jungleMistOutput.js';
import { treeBarkEmission, treeFoliageEmission } from '../forest/foliageLight.js';
import { decodeTreeCanopyVisibilityNode, decodeTreeFoliageMaskNode } from './TreeImpostorNormalEncoding.js';
import * as THREE from 'three/webgpu';
import {
  atan,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  float,
  cross,
  floor,
  fract,
  length,
  min,
  mix,
  mod,
  normalize,
  positionGeometry,
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
import {
  TREE_COLOR_VARIATION_MIN,
  TREE_COLOR_VARIATION_RANGE,
  unpackImpostorWidthNode,
} from '../forest/TreeAppearance.js';
import { applyCanopySnow, canopySnowCap, canopySnowTransmission, withStormSnow } from '../forest/canopySnow.js';
import { foliageMaterialClass } from '../forest/FoliageNodeMaterial.js';
import { orientedScreenDitherThreshold } from '../lod/screenDither.js';
import { assignTreeFoliageMaterialData } from '../../../render/postprocessing/PostProcessingMaterialData.js';
import { canonicalFromRender, sampleWorldWind, windWaveCoordinates } from '../../weather/wind/worldWindState.js';
import { applyTreeFoliageSnowSurface, configureTreeFoliageSurface } from '../forest/TreeFoliageSurface.js';
import { resolveTreeFoliageSettings, resolveTreeBarkSettings } from '../forest/treeSurfaceSettings.js';
import { wetSurfaceRoughness } from '../forest/TreeWetSurface.js';
import { surfaceWetnessUniform } from '../../weather/surfaceWetness.js';

const TWO_PI = Math.PI * 2;

export function treeImpostorBarkEmission(color, foliageMask, worldNormal, atlas) {
  // Billboard vertices are in [-.5,.5], not prototype metres. Restore height
  // above the foot so ground bounce fades over the same band as live bark.
  return treeBarkEmission(color, {
    height: positionGeometry.y.mul(atlas.height).add(atlas.centerY),
    up: worldNormal.y,
  }).mul(foliageMask.oneMinus());
}

function createMaterial({ atlas, readTransform, readParameters, readAppearance, ambientEffects }) {
  const cameraRight = uniform(new THREE.Vector3(1, 0, 0));
  const cameraUp = uniform(new THREE.Vector3(0, 1, 0));
  const sphericalBlend = uniform(0);
  const time = uniform(0);
  const windStrength = uniform(0.03);
  const transform = readTransform();
  const parameters = readParameters();
  const appearance = readAppearance();
  const scale = transform.w;
  // Crown width and canopy snow share x (TreeAppearance.packImpostorWidth).
  const { width: widthScale, snow: canopySnow } = unpackImpostorWidthNode(appearance.x);
  const right = normalize(cameraRight);
  const up = normalize(mix(vec3(0, 1, 0), cameraUp, sphericalBlend));
  const normalUp = normalize(cameraUp);
  const backward = normalize(cross(right, normalUp));
  const local = positionLocal;
  const field = sampleWorldWind(transform.xz);
  const wave = windWaveCoordinates(canonicalFromRender(transform.xz));
  const crownWeight = local.y.add(0.5).clamp(0, 1).pow(2);
  // Same slow, lean-dominated sway as the live crown (treeSway.js), so a tree
  // does not change rhythm when it hands over to its impostor.
  const seedPhase = parameters.z.mul(TWO_PI);
  const sway = sin(time.mul(0.85).add(seedPhase).add(wave.along.mul(0.06))).mul(0.65)
    .add(sin(time.mul(0.85 * 1.73).add(seedPhase.mul(1.9)).add(1.3)).mul(0.35));
  const canopyOffset = sway.mul(0.35).add(0.65)
    .mul(windStrength)
    .mul(field.envelope.clamp(0.35, 3.5))
    .mul(scale).mul(crownWeight);
  const worldPosition = transform.xyz
    .add(right.mul(local.x.mul(atlas.width).mul(scale).mul(widthScale)))
    .add(up.mul(local.y.mul(atlas.height).mul(scale)))
    // Keep the foot planted. Wind moves the crown in world axes; the old
    // screen-right offset slid the whole tree and turned whenever the camera did.
    .add(vec3(field.direction.x, 0, field.direction.y).mul(canopyOffset));

  const viewDelta = cameraPosition.sub(transform.xyz);
  const localAzimuth = mod(atan(viewDelta.x, viewDelta.z).sub(parameters.x).add(TWO_PI), TWO_PI);
  const columnPosition = localAzimuth.div(TWO_PI).mul(atlas.columns);
  const column0 = floor(columnPosition);
  const column1 = mod(column0.add(1), atlas.columns);
  const columnBlend = fract(columnPosition);
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
  const rowBlend = fract(rowPosition);
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
  const normalSample = blendAtlas(atlas.normal);
  const foliageMask = decodeTreeFoliageMaskNode(normalSample.a);
  const viewNormal = normalSample.rgb.mul(2).sub(1);
  const worldNormal = normalize(
    right.mul(viewNormal.x)
      .add(normalUp.mul(viewNormal.y))
      .add(backward.mul(viewNormal.z)),
  );
  const variation = parameters.z
    .mul(TREE_COLOR_VARIATION_RANGE)
    .add(TREE_COLOR_VARIATION_MIN);
  const colorMultiplier = mix(
    vec3(variation),
    appearance.yzw.mul(variation),
    foliageMask,
  );
  const signedFade = parameters.y;
  const fadeMask = step(
    orientedScreenDitherThreshold(parameters.z, signedFade),
    signedFade.abs(),
  );

  const barkSurface = resolveTreeBarkSettings({ barkSurface: atlas.barkSurface ?? {} });
  const material = new (foliageMaterialClass(barkSurface.enabled ? THREE.MeshStandardNodeMaterial : THREE.MeshLambertNodeMaterial))({ side: THREE.DoubleSide });
  material.positionNode = worldPosition;
  const barkWet = surfaceWetnessUniform.mul(barkSurface.enabled ? 0.7 : 0).mul(foliageMask.oneMinus());
  const crown = albedo.rgb.mul(colorMultiplier).mul(barkWet.mul(barkSurface.wetStrength * 0.45).oneMinus());
  const surface = configureTreeFoliageSurface(material, {
    settings: resolveTreeFoliageSettings({ foliageLighting: atlas.foliageSurface ?? {} }),
    visibility: decodeTreeCanopyVisibilityNode(normalSample.a), color: crown,
  });
  // The crown's snow cap, on the atlas's own normals and only on foliage texels.
  const cap = canopySnowCap(withStormSnow(canopySnow).mul(foliageMask), worldNormal.y);
  const snowed = applyCanopySnow({
    color: crown,
    emissive: atlas.foliageLighting ? treeFoliageEmission(crown, null, surface.visibility).mul(foliageMask) : null,
    cap,
  });
  if (atlas.barkLighting) {
    const barkFill = treeImpostorBarkEmission(crown, foliageMask, worldNormal, atlas);
    snowed.emissive = snowed.emissive ? snowed.emissive.add(barkFill) : barkFill;
  }
  if (atlas.foliageLighting) material.foliageTransmissionNode = foliageMask.mul(canopySnowTransmission(material.foliageTransmissionNode ?? float(0.8), cap));
  if (material.foliageWetnessNode) material.foliageWetnessNode = material.foliageWetnessNode.mul(foliageMask);
  if (material.foliageNeedleSpecularNode) material.foliageNeedleSpecularNode = material.foliageNeedleSpecularNode.mul(foliageMask);
  applyTreeFoliageSnowSurface(material, cap);
  // Canopy AO belongs only to foliage; bark uses its own baked material grade.
  if (material.aoNode) material.aoNode = mix(float(1), surface.visibility, foliageMask);
  if (barkSurface.enabled) material.roughnessNode = mix(
    wetSurfaceRoughness(float(barkSurface.roughness), barkWet, barkSurface), material.roughnessNode ?? float(0.98), foliageMask,
  );
  material.colorNode = snowed.color;
  material.emissiveNode = snowed.emissive;
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz);
  // Keep atlas alpha stable at full coverage. Feeding it into the stochastic
  // fade threshold re-dithered every soft foliage edge in screen space and made
  // distant crowns shimmer during camera motion.
  material.opacityNode = albedo.a.mul(fadeMask);
  material.alphaTest = 0.5;
  material.transparent = false;
  material.depthWrite = true;
  material.fog = true;
  applyJungleMist(material, ambientEffects);
  assignTreeFoliageMaterialData(material);
  return {
    material,
    uniforms: { cameraRight, cameraUp, sphericalBlend, time, windStrength },
  };
}

export function createCpuTreeImpostorMaterial(atlas, ambientEffects = null) {
  return createMaterial({
    atlas,
    ambientEffects,
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
  ambientEffects = null,
}) {
  return createMaterial({
    atlas,
    ambientEffects,
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
