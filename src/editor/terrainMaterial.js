import { applyTerrainRockDetail } from './materials/TerrainRockDetail.js';
import { createSnowDetailNodes } from './stylized/SnowDetailShading.js';
import { resolveSnowSurfaceConfig } from './stylized/SnowSurfaceConfig.js';
import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  cos,
  distance,
  dot,
  float,
  max,
  mix,
  normalize,
  oneMinus,
  positionLocal,
  positionWorld,
  select,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  uniformArray,
} from 'three/tsl';
import { assignTerrainMaterialData } from '../render/postprocessing/PostProcessingMaterialData.js';
import { createTerrainMaterialBakedSurface } from './materials/TerrainMaterialBakedNodes.js';
import { antialiasSpecularRoughness } from './materials/TerrainMaterialSurfaceGradientNodes.js';
import { terrainGrassCover } from './materials/TerrainGrassCoverNodes.js';
import { terrainGrassVolume } from './materials/TerrainGrassVolumeNodes.js';
import { createAridSubstrateNodes } from './materials/AridSubstrateNodes.js';
import {
  attachTerrainMaterialBakeGpuState,
  createTerrainMaterialBakeGpuState,
} from './materials/TerrainMaterialBakeGpu.js';
import {
  acquireTerrainMaterialFamilyAtlas,
  attachTerrainMaterialFamilyAtlas,
} from './materials/TerrainMaterialFamilyAtlas.js';
import {
  stylizedDirtMask,
  stylizedFbm,
  stylizedNaturalTrailMask,
  stylizedPatchMask,
  stylizedPathWearMask,
  wrapNoiseOrigin,
} from './stylized/StylizedNoiseNodes.js';
import { createCoastSwashNodes, DEFAULT_COAST_SWASH } from './stylized/CoastSwashShading.js';
import { createCoastSandNodes } from './stylized/CoastSandShading.js';
import { createTerrainWaterContext } from './stylized/TerrainOceanMask.js';
import { createSnowSurfaceNodes } from './stylized/SnowSurfaceShading.js';
import { createTerrainDriftNodes } from './materials/TerrainDriftNodes.js';
import { createFrostShading } from './stylized/ambient/FrostShading.js';
import { applyJungleMist } from './stylized/ambient/jungleMistOutput.js';
import { createValleyFogNodes } from './stylized/mist/ValleyFogShading.js';
import { applyValleyFogOutput } from './stylized/mist/ValleyFogOutput.js';
import { createFootprintShading } from './stylized/deformation/FootprintShading.js';
import { createGlacierIceShading } from './stylized/GlacierIceShading.js';
import { acquireGroundLayers } from './stylized/path/terrainGroundLayers.js';
import { GROUND_LAYERS } from './stylized/path/groundLayerIds.js';
import { createTerrainPathPaint, resolvePathPaint } from './stylized/path/terrainPathPaint.js';
import { createSnowWakeShading } from './stylized/deformation/SnowWakeShading.js';
import { snowWakeRecorder } from './stylized/deformation/SnowWakeRecorder.js';
import { createMeadowGroundShading } from './stylized/meadow/MeadowGroundShading.js';
import { applyMeadowGroundDetail } from './stylized/meadow/meadowGroundDetail.js';
import { periodicFbm2 } from './stylized/PeriodicNoiseNodes.js';
import { applyCloudShadow } from './stylized/CloudShadow.js';
import { spellLightIrradiance, spellWorldEnabled } from './vfx/render/SpellWorldLight.js';
import { createRainWetnessShading } from './stylized/RainWetnessShading.js';
import { applyBogGround } from './stylized/bog/BogGroundShading.js';
import { resolveSurfaceWetnessConfig } from './weather/surfaceWetnessConfig.js';
import {
  createSlotBakeGpuState,
  slotPatternOrigins,
  slotTexel,
  slotTexture,
  slotBilinearLoad,
  slotVector2,
} from './materials/TerrainSlotBindings.js';

const HEIGHT_SHADE_SCALE = 0.018;
const MINIMUM_HEIGHT_SHADE = 0.72;
const MAXIMUM_HEIGHT_SHADE = 1.22;

/**
 * Where the nearest-sampled biome tile is read from: the pixel's own cell,
 * nudged by up to `reachCells` along a smooth canonical noise. The biome
 * colour and the meadow ground pigment (both keyed off this one sample) then
 * interlock across a cell border in organic lobes instead of stepping in 2 m
 * squares. Pattern coordinates come from the slot's transition lattice, which
 * stays exact at planet scale; no lattice, or a zero reach, reads in place.
 */
function ecotoneTileUv({ terrainUv, transitionPatterns, chunkWorldSize, cellsPerChunk, reachCells }) {
  if (!transitionPatterns || !(reachCells > 0)) return terrainUv;
  const localXZ = vec2(
    terrainUv.x.sub(0.5).mul(chunkWorldSize),
    float(0.5).sub(terrainUv.y).mul(chunkWorldSize),
  );
  // One noise drives both the direction and the length of the nudge: half the
  // cost of two independent offsets, and still a smooth field.
  const noise = periodicFbm2(transitionPatterns.latticePoint('broad', localXZ));
  const angle = noise.mul(4 * Math.PI);
  const offset = vec2(cos(angle), sin(angle))
    .mul(abs(noise.sub(0.5)).mul(2 * reachCells / cellsPerChunk));
  // UV v runs against canonical z, as localXZ above.
  return terrainUv.add(vec2(offset.x, offset.y.negate()));
}

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

/**
 * The terrain material. Its per-slot inputs are templates: every mesh drawn
 * with it supplies its own through TerrainSlotBindings, so one material (one
 * shader build) serves all slots. With `bakeGpuState`, the bake textures are
 * read from each mesh's own state too; without, the material carries a state
 * of its own, for a single mesh.
 */
export function createTerrainMaterial({
  tileTexture,
  heightTexture,
  surfaceMaskTexture,
  forestFloorTexture,
  chunkCenter: chunkCenterTemplate,
  // The slot's swash pattern origins (createCoastPatternOrigins). Without
  // them there is no swash: it cannot be drawn from canonical positions.
  coastPatterns: coastPatternsTemplate = null,
  transitionPatterns: transitionPatternsTemplate = null,
  chunkWorldSize,
  width = 32,
  stylizedConfig,
  bakeGpuState = null,
  // The ambient surface terms (blown snow/sand streaks, rime), resolved once by
  // the caller from the ambient layer's block. Null (or disabled) adds no nodes.
  surfaceEffects = null,
  surfaceDriftWind = null,
  // The live sun (a Vector3 the sky turns in place for each time of day), for
  // snow shading. Without it, the configured sun.
  sunDirection = null,
}) {
  const terrainUv = uv();
  const transitionPatterns = transitionPatternsTemplate
    && slotPatternOrigins('transitionPatterns', transitionPatternsTemplate);
  const tileSample = slotTexture('tileTexture', tileTexture, ecotoneTileUv({
    terrainUv, transitionPatterns, chunkWorldSize, cellsPerChunk: width,
    reachCells: stylizedConfig.ground?.ecotoneReachCells ?? 0,
  }));
  const tileColor = tileSample.rgb;
  const terrainHeight = slotTexture('heightTexture', heightTexture, terrainUv).r;
  const surfaceMask = slotTexture('surfaceMaskTexture', surfaceMaskTexture, terrainUv);
  const forestFloorSample = slotTexture('forestFloorTexture', forestFloorTexture, terrainUv);
  const forestFloor = forestFloorSample.r;
  // The don't-hover patch under trunks and boulders: ambient occlusion rather than
  // shadow, so it does not move with the sun and it holds past the shadow map.
  const contactShade = forestFloorSample.g;
  const chunkCenter = slotVector2('chunkCenter', chunkCenterTemplate);
  const heightShade = clamp(
    terrainHeight.mul(HEIGHT_SHADE_SCALE).add(1),
    MINIMUM_HEIGHT_SHADE,
    MAXIMUM_HEIGHT_SHADE,
  );

  // Metres from the chunk centre, canonical axes.
  const localXZ = vec2(
    terrainUv.x.sub(0.5).mul(chunkWorldSize),
    float(0.5).sub(terrainUv.y).mul(chunkWorldSize),
  );
  const worldXZ = wrapNoiseOrigin(chunkCenter).add(localXZ);
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
  const grassCoverage = surfaceMask.g;
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
  const pathMask = max(surfaceMask.r, naturalTrail);
  const pathWear = stylizedPathWearMask(pathMask, worldXZ, {
    vergeWidth: float(pathConfig.vergeWidth ?? 0.45),
    vergeCut: float(pathConfig.vergeCut ?? 0.72),
    edgeScale: float(pathConfig.edgeScale ?? 0.42),
    edgeWarp: float(pathConfig.edgeWarp ?? 0.18),
  });
  const dirt = max(pathWear.wear, proceduralDirt);
  const patch = stylizedPatchMask(worldXZ, patchSettings);
  const meadowGround = createMeadowGroundShading(stylizedConfig, tileSample, worldXZ);
  const grassTint = meadowGround?.root ?? mix(
    colorNode(stylizedConfig.color.bottom),
    mix(
      colorNode(stylizedConfig.patch.lush),
      colorNode(stylizedConfig.patch.dry),
      patch,
    ),
    stylizedConfig.patch.strength,
  ).mul(stylizedConfig.color.brightness);
  let groundColor = mix(tileColor, grassTint, grassCoverage);
  // Litter, moss and soil between the meadow's stems, before paths and duff paint over it.
  if (meadowGround?.detail && transitionPatterns) {
    groundColor = applyMeadowGroundDetail({
      color: groundColor,
      root: grassTint,
      soil: colorNode(stylizedConfig.dirt.color),
      coverage: grassCoverage,
      cameraDistance,
      patterns: transitionPatterns,
      localXZ,
      ...meadowGround.detail,
    });
  }
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
  const forestFloorTint = forestFloor
    .mul(forestFloorConfig.groundStrength ?? 0.68)
    .mul(oneMinus(dirt));
  groundColor = mix(
    groundColor,
    colorNode(forestFloorConfig.groundCoreColor ?? '#273c25'),
    forestFloorTint,
  );
  // Leaf litter between the canopy's grass islands (forestFloorTexture B).
  const litterStrength = forestFloorConfig.litterStrength ?? 0;
  if (litterStrength > 0) {
    groundColor = mix(
      groundColor,
      colorNode(forestFloorConfig.litterColor ?? '#5c4a30'),
      forestFloorSample.b.mul(litterStrength).mul(oneMinus(dirt)),
    );
  }

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
    const retention = float(farCover.forestRetention ?? 0.5);
    const farMask = smoothstep(farCover.startDistance, farCover.endDistance, cameraDistance)
      .mul(grassCoverage)
      .mul(oneMinus(forestFloor.mul(oneMinus(retention))))
      .mul(oneMinus(dirt));
    const { strand, variation: coverVariation } = terrainGrassCover({ transitionPatterns, localXZ });
    const farGrass = mix(
      grassTint,
      meadowGround?.tip ?? colorNode(farCover.tipColor),
      strand.mul(farCover.tipStrength),
    );
    groundColor = mix(
      groundColor,
      farGrass,
      farMask.mul(farCover.strength).mul(mix(float(0.62), float(1), coverVariation)),
    );
  }

  // grass-test's duff under trunks and stones (GroundMaterial): the ground there
  // turns to darker leaf-litter duff, then darkens toward the contact point.
  // Last, so nothing painted after it can lift the patch back off the ground.
  // `contactShade` is 0 on bare ground and 1 under a trunk's centre.
  const pathPaintSettings = resolvePathPaint(pathConfig.paint);
  if (stylizedConfig.contactShade?.enabled !== false) {
    const dull = mix(vec3(dot(groundColor, vec3(0.3, 0.59, 0.11))), groundColor, 0.5)
      .mul(vec3(1, 0.94, 0.76));
    const duff = mix(
      dull.mul(0.45),
      colorNode(pathPaintSettings?.color ?? '#b7a476').mul(vec3(0.42, 0.35, 0.26)),
      0.5,
    );
    groundColor = mix(groundColor, duff, smoothstep(0.02, 0.35, contactShade));
    groundColor = groundColor.mul(oneMinus(smoothstep(0.1, 0.6, contactShade).mul(0.4)));
  }
  groundColor = max(groundColor, vec3(0));
  const proceduralColor = groundColor.mul(heightShade);
  const ownBakeGpu = bakeGpuState ? null : createTerrainMaterialBakeGpuState(stylizedConfig.materialBake);
  const materialBakeGpu = bakeGpuState ? createSlotBakeGpuState(bakeGpuState) : ownBakeGpu;
  const familyAtlas = acquireTerrainMaterialFamilyAtlas(stylizedConfig.materialBake);
  const material = new THREE.MeshStandardNodeMaterial({
    metalness: 0,
    roughness: stylizedConfig.materialBake.render.fallbackRoughness,
    // Double-sided in every view mode, and set here so it never changes: a
    // side change rebuilds this node graph per slot (see ViewModeSurfacePolicy).
    side: THREE.DoubleSide,
  });
  if (meadowGround) material.addEventListener('dispose', meadowGround.dispose);
  if (ownBakeGpu) attachTerrainMaterialBakeGpuState(material, ownBakeGpu);
  attachTerrainMaterialFamilyAtlas(material, familyAtlas);
  try {
    const bakedSurface = createTerrainMaterialBakedSurface({
      terrainUv,
      tileColor,
      tileId: tileSample.a.mul(255).round(),
      grassColorOverride: meadowGround?.root ?? null,
      heightShade,
      cameraDistance,
      proceduralColor,
      worldXZ,
      terrainHeight,
      familyAtlas,
      gpuState: materialBakeGpu,
      stylizedConfig,
      pathMask,
      localXZ,
      transitionPatterns,
    });
    const grassVolume = farCover?.enabled ? farCover.volume : null;
    if (grassVolume?.enabled) {
      // After the bake: past nearDistance the procedural ground above is no longer drawn.
      const band = smoothstep(grassVolume.startDistance, grassVolume.fullDistance, cameraDistance);
      const volumeMask = band.mul(grassCoverage).mul(oneMinus(forestFloor)).mul(oneMinus(dirt));
      const volume = terrainGrassVolume({
        worldXZ, cameraDistance, mask: volumeMask, settings: grassVolume,
        view: positionWorld.sub(cameraPosition).normalize(),
      });
      // Most rays stop high in the layer: a linear tip ramp would pale the field past the cards.
      const tipShare = volume.y.mul(volume.y).mul(grassVolume.tipShare);
      const blades = mix(grassTint, meadowGround?.tip ?? colorNode(farCover.tipColor), tipShare).mul(heightShade);
      bakedSurface.color = mix(bakedSurface.color, blades, volumeMask.mul(volume.x));
    }
    // A desert's dried crust lies in patches with rippled sand between them: as a
    // half-blend under everything, the cracks ran beneath every ripple.
    const crackedFloor = meadowGround?.floor
      ? float(meadowGround.floor.layers.y.round().equal(GROUND_LAYERS.cracked)) : float(0);
    const floorBlend = meadowGround?.floor
      ? mix(meadowGround.floor.blend, meadowGround.floor.blend.smoothstep(0.45, 0.75), crackedFloor) : float(0);
    if (transitionPatterns && bakedSurface.normal) {
      // The ecotone nudge carries the water tile up to 2.8 m onto a dry bank, and
      // the ripples stopped on that lobe in a hard, dotted curve: there the
      // ripples read the pixel's own cell instead. A water cell is never sand, so
      // they are gone by half occupancy, which the bilinear mask always reaches at
      // that cell's edge: fading by plain occupancy they stopped there, dotted.
      const ecotoneTileId = tileSample.a.mul(255).round();
      const aridTileId = select(ecotoneTileId.equal(stylizedConfig.water?.tileId ?? 0),
        slotTexel('tileTexture', tileTexture, terrainUv, width).a.mul(255).round(), ecotoneTileId);
      const arid = createAridSubstrateNodes({ tileId: aridTileId,
        bare: oneMinus(grassCoverage).mul(oneMinus(bakedSurface.snow ?? float(0)))
          .mul(oneMinus(pathMask)).mul(oneMinus(smoothstep(0, 0.5, surfaceMask.b))),
        patterns: transitionPatterns, localXZ, cameraDistance, arid: stylizedConfig.biomeLooks?.arid,
        dunes: stylizedConfig.biomeLooks?.surface?.dunes,
        crust: floorBlend.mul(crackedFloor) });
      Object.assign(bakedSurface, arid.apply(bakedSurface.color, bakedSurface.roughness, bakedSurface.normal));
    }
    if (bakedSurface.rock && bakedSurface.normal) {
      // Snow country's faces are snow-plastered (biome-looks rock tint): their
      // bedding seams read as fine contour stripes across the snow mountains.
      const groundSnow = stylizedConfig.biomeLooks?.snow?.ground;
      const groundSnowByTile = groundSnow?.some((value) => value > 0) ? uniformArray(Array.from(groundSnow), 'float') : null;
      const snowCountry = groundSnowByTile
        ? slotBilinearLoad('tileTexture', tileTexture, terrainUv, (value) =>
          groundSnowByTile.element(value.a.mul(255).round().toInt()))
        : float(0);
      bakedSurface.color = applyTerrainRockDetail({
        strata: oneMinus(snowCountry),
        // Stone and strata on the rock snow leaves bare: over the whole colour of a
        // snowed slope the strata ruled the snow in contour stripes.
        color: bakedSurface.color, rock: bakedSurface.rock.mul(oneMinus(bakedSurface.snow ?? float(0))),
        normal: bakedSurface.normal,
        local: vec2(terrainUv.x.sub(0.5), float(0.5).sub(terrainUv.y)).mul(chunkWorldSize),
        chunkCenter, height: positionWorld.y, textures: acquireGroundLayers(),
      });
    }
    // grass-test's path surface over the baked ground: textured dirt with a
    // broken contour and a worn verge (stylized/path/terrainPathPaint.js).
    const bakedRoughness = bakedSurface.roughness
      ?? float(stylizedConfig.materialBake.render.fallbackRoughness);
    const pathPaint = createTerrainPathPaint({
      terrainUv,
      chunkWorldSize,
      chunkCenter,
      pathMask: pathMask.mul(oneMinus(bakedSurface.snow ?? float(0))),
      verge: pathWear.verge.mul(oneMinus(bakedSurface.snow ?? float(0))),
      settings: pathPaintSettings,
      textures: pathPaintSettings ? acquireGroundLayers() : null,
      // Wet ground and the bed under water wear grit whatever their tile: per-tile
      // scans switched along the cell grid at every waterline in straight steps.
      floor: meadowGround?.floor
        ? { ...meadowGround.floor, blend: floorBlend, wet: max(bakedSurface.wetness ?? float(0), surfaceMask.b).smoothstep(0.05, 0.45) }
        : null,
    });
    const paintedSurface = pathPaint
      ? { ...bakedSurface, ...pathPaint.apply(bakedSurface.color, bakedRoughness) }
      : { ...bakedSurface, roughness: bakedRoughness };
    // The floor scan is soil structure: it read as bare rock under snow and as moss on stone.
    if (pathPaint && bakedSurface.snow) {
      paintedSurface.color = mix(paintedSurface.color, bakedSurface.color, max(bakedSurface.snow, bakedSurface.rock));
    }
    const coastPatterns = coastPatternsTemplate && slotPatternOrigins('coastPatterns', coastPatternsTemplate);
    // The interpolated mesh height keeps narrow wash fronts smooth between
    // vertices; the nearest-filtered height texture would make texel terraces.
    const coastalHeight = positionWorld.y;
    const waterContext = coastPatterns ? createTerrainWaterContext(terrainUv, coastalHeight, width + 1) : null;
    const oceanMask = waterContext?.ocean ?? float(0);
    const sand = coastPatterns && createCoastSandNodes({
      localXZ, patterns: coastPatterns, groundHeight: coastalHeight,
      sandMask: oneMinus(grassCoverage).mul(oneMinus(bakedSurface.snow ?? float(0))),
      waterCoverage: surfaceMask.b, config: stylizedConfig.water?.coast?.sand,
      oceanMask,
      organic: waterContext?.organic,
      cold: waterContext?.cold,
    });
    const beachSurface = sand ? sand.apply(paintedSurface.color, paintedSurface.roughness) : paintedSurface;
    if (waterContext) {
      // Snow lying at the waterline stays snow: a damp brown ring on it read as mud.
      const wet = waterContext.wet.mul(oneMinus(grassCoverage).max(.15)).mul(oneMinus(bakedSurface.snow ?? float(0)));
      beachSurface.color = beachSurface.color.mul(float(1).sub(wet.mul(.22)));
      // Damp sediment retains a broad, quiet highlight. The former universal
      // 0.38 override erased substrate roughness and amplified bank-normal bands.
      // Liquid films/swash and rain retain their separate surface responses.
      const bankRoughness = mix(float(.64), float(.74), waterContext.organic)
        .max(waterContext.cold.mul(.68));
      beachSurface.roughness = mix(beachSurface.roughness, bankRoughness, wet);
      // Under cold water the bed is grey glacial silt: the plain soil showing
      // through clear shallows drew a brown band between pool and snow.
      const silt = waterContext.cold.mul(surfaceMask.b.max(waterContext.wet));
      beachSurface.color = mix(beachSurface.color, colorNode('#6f7a7e'), silt.mul(.85));
    }
    // Swash, foam and wet sand where the ground meets the sea.
    const swash = coastPatternsTemplate && createCoastSwashNodes({
      localXZ,
      patternOrigins: coastPatterns,
      groundHeight: coastalHeight,
      config: { ...DEFAULT_COAST_SWASH, ...(stylizedConfig.water?.coast ?? {}) },
      shorelineFadeDepth: stylizedConfig.water?.optics?.shorelineFadeDepth ?? 0.35,
      oceanMask,
    });
    const swashed = swash ? swash.apply(beachSurface.color, beachSurface.roughness) : null;
    const coastSurface = swashed ? {
      color: mix(swashed.color, beachSurface.color, bakedSurface.snow ?? float(0)),
      roughness: mix(swashed.roughness, beachSurface.roughness, bakedSurface.snow ?? float(0)),
    } : beachSurface;
    const shoreSurface = applyBogGround({
      color: coastSurface.color,
      roughness: coastSurface.roughness ?? float(stylizedConfig.materialBake.render.fallbackRoughness),
      tileId: tileSample.a.mul(255).round(),
      wet: waterContext?.damp,
    });
    // Rain darkens and slicks exposed ground; snow and canopy shelter it.
    const surface = createRainWetnessShading({
      snow: bakedSurface.snow ?? float(0),
      canopy: bakedSurface.canopy ?? float(0),
      config: resolveSurfaceWetnessConfig(stylizedConfig.wetness),
    }).apply(
      shoreSurface.color,
      shoreSurface.roughness ?? float(stylizedConfig.materialBake.render.fallbackRoughness),
    );
    const footprints = createFootprintShading({
      terrainUv,
      chunkWorldSize,
      chunkCenter,
      groundHeight: terrainHeight,
      snow: bakedSurface.snow ?? float(0),
      // Any dry ground in a biome that takes prints (desert sand, bog mud): the
      // dirt between sparse tussocks prints too, so grass cover does not gate it.
      ground: oneMinus(surfaceMask.b),
    });
    // The trail a body cuts through deep snow, over the prints it leaves there.
    // Disabled or snowless, it compiles to nothing.
    const wake = createSnowWakeShading({
      terrainUv,
      chunkWorldSize,
      chunkCenter,
      snow: bakedSurface.snow,
      state: snowWakeRecorder.state,
      config: stylizedConfig.snowWake,
    });
    const snowSettings = resolveSnowSurfaceConfig(stylizedConfig.snowSurface);
    const snowPressed = max(pathMask, footprints.pressed);
    const snowDetail = bakedSurface.snow ? createSnowDetailNodes({
      terrainUv, chunkWorldSize, chunkCenter, snow: bakedSurface.snow, material,
      groundHeight: terrainHeight, pathMask: snowPressed, baseNormal: bakedSurface.normal, settings: snowSettings,
      sun: sunDirection ? normalize(uniform(sunDirection)) : null,
      reliefEnabled: stylizedConfig.enhancements?.snowRelief === true,
    }) : null;
    const snowNormal = bakedSurface.normal && snowDetail
      ? snowDetail.normal(bakedSurface.normal).toVar()
      : bakedSurface.normal;
    const snowSurface = bakedSurface.snow ? createSnowSurfaceNodes({
      terrainUv, chunkWorldSize, chunkCenter, snow: bakedSurface.snow, stylizedConfig, sunDirection,
      baseNormal: snowNormal, pathMask: snowPressed, settings: snowSettings,
    }) : null;
    const drift = createTerrainDriftNodes({worldXZ,grassCoverage,snow:bakedSurface.snow,
      wetness:bakedSurface.wetness,pathMask,pressed:footprints.pressed,settings:surfaceEffects?.blownStreaks,wind:surfaceDriftWind});
    const driftColor = drift ? drift.apply(surface.color) : surface.color;
    const detailedSnowColor = snowDetail ? snowDetail.color(driftColor) : driftColor;
    const printed = footprints.apply(snowSurface ? snowSurface.apply(detailedSnowColor) : detailedSnowColor);
    // Glacier biomes show bare ice through the snow (biome-looks `glacier`).
    const glacierTable = stylizedConfig.biomeLooks?.glacier;
    const glacierShareByTile = glacierTable?.some((value) => value > 0) ? uniformArray(Array.from(glacierTable), 'float') : null;
    const glacierIce = bakedSurface.snow && glacierShareByTile ? createGlacierIceShading({
      terrainUv, chunkWorldSize, chunkCenter,
      // Decoded per cell and then filtered: the ecotone swaps border cells to the
      // neighbouring biome one by one, and a per-cell share drew 2 m blue squares.
      tileShare: slotBilinearLoad('tileTexture', tileTexture, terrainUv, (value) =>
        glacierShareByTile.element(value.a.mul(255).round().toInt())),
    }) : null;
    const iced = glacierIce ? glacierIce.apply(printed) : printed;
    material.colorNode = wake ? wake.apply(iced) : iced;
    const filteredRoughness = bakedSurface.normal
      ? antialiasSpecularRoughness(surface.roughness, bakedSurface.normal)
      : surface.roughness;
    material.roughnessNode = filteredRoughness;
    if (snowSurface) {
      const snowGlow = snowDetail ? snowSurface.emissive.add(snowDetail.shade) : snowSurface.emissive;
      // Glints and backscatter belong to the powder, not to the bare ice beside it.
      material.emissiveNode = glacierIce ? snowGlow.mul(glacierIce.share.oneMinus()) : snowGlow;
    }
    if (bakedSurface.normal) material.normalNode = footprints.relief(bakedSurface.normal);
    if (snowDetail) {
      material.roughnessNode = snowDetail.roughness(filteredRoughness);
      if (snowNormal) material.normalNode = snowNormal;
    }
    if (glacierIce) {
      material.roughnessNode = glacierIce.roughness(material.roughnessNode);
      if (material.normalNode) material.normalNode = glacierIce.normal(material.normalNode);
    }
    // Rime on the up-facing faces, keyed on the same baked snow: the deposition the
    // terrain would otherwise wash out. Needs a surface normal, so it too compiles
    // to nothing where the terrain has no normal to read.
    const frost = surfaceEffects?.frost?.enabled && bakedSurface.normal && bakedSurface.snow
      ? createFrostShading({
        normal: bakedSurface.normal,
        worldXZ,
        // Rime is powder's: on bare glacier ice the per-texel snow weight drew it in 2 m squares.
        cold: glacierIce ? bakedSurface.snow.mul(glacierIce.share.oneMinus()) : bakedSurface.snow,
        settings: surfaceEffects.frost,
      })
      : null;
    if (frost) {
      material.colorNode = frost.applyColor(material.colorNode);
      material.roughnessNode = frost.applyRoughness(material.roughnessNode);
    }
    // A spell's light on the ground round it: one uniform light rather than a
    // scene light, skipped behind a uniform branch while no spell is lit.
    if (spellWorldEnabled) {
      const spellLight = material.colorNode.mul(spellLightIrradiance(positionWorld, vec3(0, 1, 0)));
      material.emissiveNode = material.emissiveNode ? material.emissiveNode.add(spellLight) : spellLight;
    }
    // Valley mist pooling in the gorges below the view, marched against the
    // camera-local height patch. It blends last, over everything, because it sits
    // in the air in front of the ground rather than on it. Null (no config, no
    // patch, quality zero) adds nothing; a runtime weight of zero skips its loop.
    const fog = surfaceEffects?.valleyFog
      ? createValleyFogNodes({
        heightSampler: surfaceEffects.valleyFog.patch,
        config: surfaceEffects.valleyFog.settings,
        time: surfaceEffects.valleyFog.uniforms.time,
        weight: surfaceEffects.valleyFog.uniforms.weight,
        quality: surfaceEffects.valleyFog.quality,
        sunDirection: surfaceEffects.valleyFog.uniforms.sunDirection,
        sunColor: surfaceEffects.valleyFog.uniforms.sunColor,
        fogColor: surfaceEffects.valleyFog.uniforms.fogColor,
      })
      : null;
    applyValleyFogOutput(material, fog);
    // Jungle ground mist, blended over the lit output like the grass and trees
    // that stand in it; a zero region weight skips it with one compare.
    applyJungleMist(material, surfaceEffects?.ambientEffects);
    // Geometry displacement and the baked surface normal are derived from the same heightfield.
    material.positionNode = positionLocal.add(vec3(0, 0, terrainHeight));
    applyCloudShadow(material, stylizedConfig.sky);
    return assignTerrainMaterialData(material);
  } catch (error) {
    material.dispose();
    throw error;
  }
}
