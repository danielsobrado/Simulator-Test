import * as THREE from 'three/webgpu';
import {
  clamp,
  float,
  max,
  mix,
  oneMinus,
  select,
  smoothstep,
  texture,
  vec3,
} from 'three/tsl';

const MIN_WEIGHT_SUM = 0.0001;
const DEBUG_CURVATURE_SCALE = 8;

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

function normalizedWeights(textureNode) {
  const total = max(
    textureNode.r.add(textureNode.g).add(textureNode.b).add(textureNode.a),
    MIN_WEIGHT_SUM,
  );
  return textureNode.div(total);
}

function debugColor({ view, samples }) {
  switch (view) {
    case 'macroTint':
      return samples.macroTint.rgb;
    case 'terrainShape': {
      const slope = clamp(samples.terrainShape.r, 0, 1);
      const curvature = clamp(
        samples.terrainShape.g.mul(DEBUG_CURVATURE_SCALE).mul(0.5).add(0.5),
        0,
        1,
      );
      return vec3(slope, curvature, 0);
    }
    case 'materialWeights':
      return vec3(
        samples.materialWeights.r,
        samples.materialWeights.g,
        max(samples.materialWeights.b, samples.materialWeights.a),
      );
    case 'wetnessShoreline':
      return vec3(samples.wetnessShoreline.r, samples.wetnessShoreline.g, 0);
    case 'farColor':
      return samples.farColor.rgb;
    case 'farNormal':
      return vec3(
        samples.farNormal.r.mul(0.5).add(0.5),
        samples.farNormal.g.mul(0.5).add(0.5),
        0.5,
      );
    case 'canopyWater':
      return vec3(samples.canopyWater.r, samples.canopyWater.g, 0);
    default:
      return null;
  }
}

export function createTerrainMaterialBakedColor({
  terrainUv,
  tileColor,
  heightShade,
  cameraDistance,
  proceduralColor,
  gpuState,
  stylizedConfig,
}) {
  if (!gpuState) return proceduralColor;

  const render = stylizedConfig.materialBake.render;
  const samples = {
    macroTint: texture(gpuState.textures.macroTint, terrainUv),
    terrainShape: texture(gpuState.textures.terrainShape, terrainUv),
    materialWeights: texture(gpuState.textures.materialWeights, terrainUv),
    wetnessShoreline: texture(gpuState.textures.wetnessShoreline, terrainUv),
    farColor: texture(gpuState.textures.farColor, terrainUv),
    farNormal: texture(gpuState.textures.farNormal, terrainUv),
    canopyWater: texture(gpuState.textures.canopyWater, terrainUv),
  };

  const requestedDebugColor = debugColor({
    view: stylizedConfig.materialBake.debug.view,
    samples,
  });
  if (requestedDebugColor) {
    return select(gpuState.ready.greaterThan(0.5), requestedDebugColor, proceduralColor);
  }

  const weights = normalizedWeights(samples.materialWeights);
  const grassColor = mix(
    tileColor,
    colorNode(stylizedConfig.color.bottom).mul(stylizedConfig.color.brightness),
    render.grassTintStrength,
  );
  const dirtColor = colorNode(stylizedConfig.dirt.color);
  const rockColor = colorNode(render.rockColor);
  const snowColor = colorNode(render.snowColor);
  let midColor = grassColor.mul(weights.r)
    .add(dirtColor.mul(weights.g))
    .add(rockColor.mul(weights.b))
    .add(snowColor.mul(weights.a));

  const macroMultiplier = clamp(samples.macroTint.rgb.mul(2), vec3(0.65), vec3(1.35));
  midColor = midColor.mul(macroMultiplier);
  midColor = mix(
    midColor,
    colorNode(render.shorelineColor),
    samples.wetnessShoreline.g.mul(render.shorelineStrength),
  );
  midColor = mix(
    midColor,
    colorNode(stylizedConfig.trees?.forestFloor?.groundCoreColor ?? '#273c25'),
    samples.canopyWater.r
      .mul(render.canopyStrength)
      .mul(oneMinus(weights.g)),
  );
  midColor = midColor
    .mul(float(1).sub(samples.wetnessShoreline.r.mul(render.wetDarkening)))
    .mul(heightShade);

  const nearMacro = mix(vec3(1), macroMultiplier, render.nearMacroStrength);
  const nearDetailed = mix(
    proceduralColor
      .mul(nearMacro)
      .mul(float(1).sub(
        samples.wetnessShoreline.r.mul(render.wetDarkening * render.nearWetnessScale),
      )),
    midColor,
    render.nearMaterialBlend,
  );

  const nearBlendEnd = render.nearDistance + render.transitionDistance;
  const farBlendEnd = render.farDistance + render.transitionDistance;
  const nearBlend = smoothstep(render.nearDistance, nearBlendEnd, cameraDistance);
  const farBlend = smoothstep(render.farDistance, farBlendEnd, cameraDistance);

  const bakedColor = select(
    cameraDistance.lessThan(render.nearDistance),
    nearDetailed,
    select(
      cameraDistance.lessThan(nearBlendEnd),
      mix(nearDetailed, midColor, nearBlend),
      select(
        cameraDistance.lessThan(render.farDistance),
        midColor,
        select(
          cameraDistance.lessThan(farBlendEnd),
          mix(midColor, samples.farColor.rgb, farBlend),
          samples.farColor.rgb,
        ),
      ),
    ),
  );

  return select(gpuState.ready.greaterThan(0.5), bakedColor, proceduralColor);
}
