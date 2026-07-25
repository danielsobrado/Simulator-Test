import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  distance,
  dot,
  float,
  fract,
  max,
  min,
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
import { stylizedDirtMask, stylizedFbm, stylizedPatchMask } from './stylized/StylizedNoiseNodes.js';

const CELL_GRID_COLOR = vec3(0.035, 0.045, 0.038);
const HEIGHT_SHADE_SCALE = 0.018;
const MINIMUM_HEIGHT_SHADE = 0.72;
const MAXIMUM_HEIGHT_SHADE = 1.22;

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

function gridLine(coordinate, width) {
  const wrapped = fract(coordinate);
  const edge = min(wrapped, vec2(1).sub(wrapped));
  return oneMinus(smoothstep(0, width, min(edge.x, edge.y)));
}

export function createTerrainMaterial({
  tileTexture,
  heightTexture,
  surfaceMaskTexture,
  forestFloorTexture,
  chunkCenter,
  chunkWorldSize,
  width,
  height,
  stylizedConfig,
}) {
  const terrainUv = uv();
  const mapSize = vec2(width, height);
  const tileColor = texture(tileTexture, terrainUv).rgb;
  const terrainHeight = texture(heightTexture, terrainUv).r;
  const surface = texture(surfaceMaskTexture, terrainUv);
  const forestFloor = texture(forestFloorTexture, terrainUv).r;
  const cellGrid = gridLine(terrainUv.mul(mapSize), 0.045);
  const heightShade = clamp(
    terrainHeight.mul(HEIGHT_SHADE_SCALE).add(1),
    MINIMUM_HEIGHT_SHADE,
    MAXIMUM_HEIGHT_SHADE,
  );

  const worldXZ = vec2(
    chunkCenter.x.add(terrainUv.x.sub(0.5).mul(chunkWorldSize)),
    chunkCenter.y.add(float(0.5).sub(terrainUv.y).mul(chunkWorldSize)),
  );
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
  const pathMask = surface.r;
  const proceduralDirt = stylizedDirtMask(worldXZ, dirtSettings).mul(grassCoverage);
  // The path mask fades out across its blend band. The tread is the inner, fully
  // bare part; the remainder is the verge, where grass thins but does not vanish.
  const pathConfig = stylizedConfig.path ?? {};
  const treadStart = float(pathConfig.vergeWidth ?? 0.45);
  const tread = smoothstep(treadStart, 1, pathMask);
  const dirt = max(tread, proceduralDirt);
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
  const verge = pathMask.sub(tread).max(0);
  groundColor = mix(
    groundColor,
    mix(grassTint, colorNode(stylizedConfig.dirt.color), pathConfig.vergeBlend ?? 0.55),
    verge,
  );
  groundColor = mix(groundColor, colorNode(stylizedConfig.dirt.color), dirt);
  // Ruts: banded noise stretched along the path so wheel tracks follow it.
  const rutStrength = pathConfig.rutStrength ?? 0;
  if (rutStrength > 0) {
    const ruts = stylizedFbm(worldXZ.mul(vec2(
      pathConfig.rutScale ?? 1.6,
      (pathConfig.rutScale ?? 1.6) * 0.18,
    ))).sub(0.5);
    groundColor = groundColor.mul(
      float(1).add(ruts.mul(rutStrength).mul(tread)),
    );
  }
  const forestFloorConfig = stylizedConfig.trees?.forestFloor ?? {};
  groundColor = mix(
    groundColor,
    colorNode(forestFloorConfig.groundCoreColor ?? '#273c25'),
    forestFloor.mul(forestFloorConfig.groundStrength ?? 0.68),
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
    const cameraDistance = distance(cameraPosition, positionWorld);
    const farMask = smoothstep(farCover.startDistance, farCover.endDistance, cameraDistance)
      .mul(grassCoverage)
      .mul(oneMinus(forestFloor))
      .mul(oneMinus(dirt));
    const direction = vec2(farCover.direction[0], farCover.direction[1]);
    const strand = smoothstep(
      farCover.strandThreshold,
      1,
      abs(sin(dot(worldXZ, direction).mul(farCover.frequency)
        .add(stylizedFbm(worldXZ.mul(farCover.noiseScale)).mul(farCover.noiseWarp)))),
    );
    const farGrass = mix(
      grassTint,
      colorNode(farCover.tipColor),
      strand.mul(farCover.tipStrength),
    );
    groundColor = mix(groundColor, farGrass, farMask.mul(farCover.strength));
  }

  groundColor = max(groundColor, vec3(0));

  const material = new THREE.MeshLambertNodeMaterial();
  const cellShaded = mix(groundColor, CELL_GRID_COLOR, cellGrid.mul(0.08));
  material.colorNode = cellShaded.mul(heightShade);
  material.normalNode = vec3(0, 0, 1);
  material.positionNode = positionLocal.add(vec3(0, 0, terrainHeight));
  return material;
}
