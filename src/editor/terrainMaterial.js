import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  distance,
  dot,
  float,
  max,
  mix,
  oneMinus,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { assignTerrainMaterialData } from '../render/postprocessing/PostProcessingMaterialData.js';
import { createTerrainMaterialBakedColor } from './materials/TerrainMaterialBakedNodes.js';
import {
  attachTerrainMaterialBakeGpuState,
  createTerrainMaterialBakeGpuState,
} from './materials/TerrainMaterialBakeGpu.js';
import {
  stylizedDirtMask,
  stylizedFbm,
  stylizedNaturalTrailMask,
  stylizedPatchMask,
  stylizedPathWearMask,
} from './stylized/StylizedNoiseNodes.js';

const HEIGHT_SHADE_SCALE = 0.018;
const MINIMUM_HEIGHT_SHADE = 0.72;
const MAXIMUM_HEIGHT_SHADE = 1.22;

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

export function createTerrainMaterial({
  tileTexture,
  heightTexture,
  surfaceMaskTexture,
  forestFloorTexture,
  chunkCenter,
  chunkWorldSize,
  stylizedConfig,
}) {
  const terrainUv = uv();
  const tileColor = texture(tileTexture, terrainUv).rgb;
  const terrainHeight = texture(heightTexture, terrainUv).r;
  const surface = texture(surfaceMaskTexture, terrainUv);
  const forestFloor = texture(forestFloorTexture, terrainUv).r;
  const heightShade = clamp(
    terrainHeight.mul(HEIGHT_SHADE_SCALE).add(1),
    MINIMUM_HEIGHT_SHADE,
    MAXIMUM_HEIGHT_SHADE,
  );

  const worldXZ = vec2(
    chunkCenter.x.add(terrainUv.x.sub(0.5).mul(chunkWorldSize)),
    chunkCenter.y.add(float(0.5).sub(terrainUv.y).mul(chunkWorldSize)),
  );
  const cameraDistance = distance(cameraPosition, positionWorld);
  const dirtSettings = {
    scale: float(stylizedConfig.dirt.scale),
    coverage: float(stylizedConfig.dirt.coverage),
    softness: float(stylizedConfig.dirt.softness),
    warp: float(stylizedConfig.dirt.warp),
  };
  const patchSettings = {
    scale: float(stylizedConfig.patch.scale),
    bias: float(stylizedConfig.patch.bias),
  };
  const grassCoverage = surface.g;
  const proceduralDirt = stylizedDirtMask(worldXZ, dirtSettings).mul(grassCoverage);
  const pathConfig = stylizedConfig.path ?? {};
  const naturalTrailConfig = pathConfig.naturalTrail;
  const naturalTrail = naturalTrailConfig?.enabled
    ? stylizedNaturalTrailMask(worldXZ, {
      scale: float(naturalTrailConfig.scale),
      level: float(naturalTrailConfig.level),
      width: float(naturalTrailConfig.width),
      softness: float(naturalTrailConfig.softness),
      warp: float(naturalTrailConfig.warp),
    }).mul(grassCoverage)
    : float(0);
  const pathMask = max(surface.r, naturalTrail);
  const pathWear = stylizedPathWearMask(pathMask, worldXZ, {
    vergeWidth: float(pathConfig.vergeWidth ?? 0.45),
    vergeCut: float(pathConfig.vergeCut ?? 0.72),
    edgeScale: float(pathConfig.edgeScale ?? 0.42),
    edgeWarp: float(pathConfig.edgeWarp ?? 0.18),
  });
  const dirt = max(pathWear.wear, proceduralDirt);
  const patch = stylizedPatchMask(worldXZ, patchSettings);
  const grassTint = mix(
    colorNode(stylizedConfig.color.bottom),
    mix(
      colorNode(stylizedConfig.patch.lush),
      colorNode(stylizedConfig.patch.dry),
      patch,
    ),
    stylizedConfig.patch.strength,
  ).mul(stylizedConfig.color.brightness);
  let groundColor = mix(tileColor, grassTint, grassCoverage);
  // Verge first, then the bare tread on top, so the path reads as a worn centre
  // with a scuffed margin instead of a hard-edged stripe.
  groundColor = mix(
    groundColor,
    mix(grassTint, colorNode(stylizedConfig.dirt.color), pathConfig.vergeBlend ?? 0.55),
    pathWear.verge,
  );
  groundColor = mix(
    groundColor,
    colorNode(stylizedConfig.dirt.color),
    max(pathWear.tread, proceduralDirt),
  );
  // Layered soil variation keeps the path from reading as one flat tan ribbon.
  const rutStrength = pathConfig.rutStrength ?? 0;
  if (rutStrength > 0) {
    const rutScale = pathConfig.rutScale ?? 1.6;
    const ruts = stylizedFbm(worldXZ.mul(rutScale)).sub(0.5)
      .add(stylizedFbm(worldXZ.mul(rutScale * 4.1).add(vec2(7.1, 3.7))).sub(0.5).mul(0.35));
    groundColor = groundColor.mul(
      float(1).add(ruts.mul(rutStrength).mul(pathWear.mask)),
    );
  }
  const forestFloorConfig = stylizedConfig.trees?.forestFloor ?? {};
  // Canopy tint belongs to the living forest floor, not exposed earth. Applying
  // it after the dirt/path layers without this guard recolours their warm soil
  // into broad grey-green swaths wherever the forest field overlaps a worn area.
  // Keeping the masks mutually exclusive also preserves the same dirt colour the
  // grass and flower shaders use at the transition.
  const forestFloorTint = forestFloor
    .mul(forestFloorConfig.groundStrength ?? 0.68)
    .mul(oneMinus(dirt));
  groundColor = mix(
    groundColor,
    colorNode(forestFloorConfig.groundCoreColor ?? '#273c25'),
    forestFloorTint,
  );

  const variation = stylizedFbm(worldXZ.mul(stylizedConfig.ground.variationScale)).sub(0.5);
  const grain = stylizedFbm(worldXZ.mul(stylizedConfig.ground.grainScale)).sub(0.5);
  const variationColor = colorNode(stylizedConfig.ground.variationColor);
  groundColor = groundColor.add(
    variationColor.sub(groundColor)
      .mul(variation)
      .mul(stylizedConfig.ground.variationStrength)
      .mul(dirt),
  );
  groundColor = groundColor.add(
    variationColor.sub(groundColor)
      .mul(grain)
      .mul(stylizedConfig.ground.grainStrength)
      .mul(dirt),
  );

  const farCover = stylizedConfig.groundCover;
  if (farCover?.enabled) {
    // A wooded floor is shaded, not bare. Removing the far cover outright under
    // canopy left distant forest as flat unbroken ground, which — together with
    // the `groundCoreColor` tint and the thinned blade density — is what made the
    // forest interior read as near-black. `forestRetention` thins it instead.
    const retention = float(farCover.forestRetention ?? 0.5);
    const farMask = smoothstep(farCover.startDistance, farCover.endDistance, cameraDistance)
      .mul(grassCoverage)
      .mul(oneMinus(forestFloor.mul(oneMinus(retention))))
      .mul(oneMinus(dirt));
    const direction = vec2(farCover.direction[0], farCover.direction[1]);
    const strandA = smoothstep(
      farCover.strandThreshold,
      1,
      abs(sin(dot(worldXZ, direction).mul(farCover.frequency)
        .add(stylizedFbm(worldXZ.mul(farCover.noiseScale)).mul(farCover.noiseWarp)))),
    );
    const crossDirection = vec2(direction.y.negate(), direction.x);
    const strandB = smoothstep(
      Math.min(0.98, farCover.strandThreshold + 0.08),
      1,
      abs(sin(dot(worldXZ, crossDirection).mul(farCover.frequency * 1.37)
        .add(stylizedFbm(worldXZ.mul(farCover.noiseScale * 1.7).add(vec2(4.7, 9.2)))
          .mul(farCover.noiseWarp)))),
    );
    const strand = max(strandA, strandB.mul(0.7));
    const coverVariation = smoothstep(
      0.2,
      0.82,
      stylizedFbm(worldXZ.mul(farCover.noiseScale * 0.55).add(vec2(13.1, 5.3))),
    );
    const farGrass = mix(
      grassTint,
      colorNode(farCover.tipColor),
      strand.mul(farCover.tipStrength),
    );
    groundColor = mix(
      groundColor,
      farGrass,
      farMask.mul(farCover.strength).mul(mix(float(0.62), float(1), coverVariation)),
    );
  }

  groundColor = max(groundColor, vec3(0));
  const proceduralColor = groundColor.mul(heightShade);
  const materialBakeGpu = createTerrainMaterialBakeGpuState(stylizedConfig.materialBake);
  const resolvedColor = createTerrainMaterialBakedColor({
    terrainUv,
    tileColor,
    heightShade,
    cameraDistance,
    proceduralColor,
    gpuState: materialBakeGpu,
    stylizedConfig,
  });

  const material = new THREE.MeshLambertNodeMaterial();
  material.colorNode = resolvedColor;
  // Leave normalNode on the material default: PlaneGeometry's local +Z is
  // transformed through the mesh's -90° X rotation into world +Y and then into
  // view space. A literal local +Z here bypasses those transforms and makes the
  // ground light as though its normal points toward the camera.
  material.positionNode = positionLocal.add(vec3(0, 0, terrainHeight));
  attachTerrainMaterialBakeGpuState(material, materialBakeGpu);
  return assignTerrainMaterialData(material);
}
