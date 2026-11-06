import * as THREE from 'three/webgpu';
import { float, ivec2, mix, texture, vec3 } from 'three/tsl';
import { createMeadowGroundPalette } from './meadowGroundPalette.js';
import { resolveMeadowGroundDetail } from './meadowGroundDetailConfig.js';
import { meadowPatchColors } from './meadowColorNodes.js';
import { meadowCanopyView } from './meadowCanopy.js';
import { applyMeadowGroundStyle, meadowGroundStyle } from './meadowGroundStyle.js';

/**
 * Read biome pigment from tile alpha; no new terrain sampler or instance attribute.
 * Rows: 0 root, 1 tip + lush share (meadowPalettes.js), 2 litter colour + amount, 3 moss / soil / streaks
 * (meadowGroundDetailConfig.js), 4 canopy colour + strength (meadowCanopy.js),
 * 5 floor scan layers (terrainGroundLayers.js) + area style share.
 * The map is float and nearest-filtered, so it binds no sampler.
 *
 * `root` is the ground seen through the stand: the soil-side root from above,
 * leaning to the canopy's own colour as the view grazes.
 */
export function createMeadowGroundShading(config, tileSample, worldXZ) {
  const palette = createMeadowGroundPalette(config);
  if (!palette) return null;
  const detail = resolveMeadowGroundDetail(config.grass.meadow.groundDetail);
  const data = new Float32Array(256 * 6 * 4);
  for (let id = 0; id < 256; id++) {
    for (let channel = 0; channel < 3; channel++) {
      data[id * 4 + channel] = palette.roots[id * 3 + channel];
      data[(256 + id) * 4 + channel] = palette.tips[id * 3 + channel];
    }
    data[(256 + id) * 4 + 3] = palette.lush[id];
  }
  if (detail) {
    data.set(detail.litter, 512 * 4);
    data.set(detail.amounts, 768 * 4);
    data.set(detail.floors, 1280 * 4);
  }
  data.set(palette.canopies, 1024 * 4);
  palette.areaStyles.forEach((share, id) => { data[(1280 + id) * 4 + 2] = share; });
  const map = new THREE.DataTexture(data, 256, 6, THREE.RGBAFormat, THREE.FloatType);
  map.name = 'meadow-ground-biome-pigment';
  map.minFilter = map.magFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  const id = tileSample.a.mul(255).round().toInt();
  const { tint, dry, dryColor } = meadowPatchColors(worldXZ, palette.appearance);
  const dryPigment = dryColor.mul(palette.brightness);
  const row = index => texture(map, ivec2(id, index)).setSampler(false);
  const lush = row(1).a;
  const patchTint = mix(vec3(1), tint, lush);
  let soilRoot = mix(row(0).rgb.mul(patchTint), dryPigment, dry);
  let tip = mix(row(1).rgb.mul(patchTint), dryPigment.mul(1.06), dry.mul(0.45));
  const canopy = row(4);
  let canopyColor = mix(canopy.rgb.mul(patchTint), dryPigment, dry);
  let floorBlend = float(0);
  if (palette.appearance.groundStyle > 0) {
    const area = meadowGroundStyle(worldXZ, row(5).z.mul(palette.appearance.groundStyle));
    const style = { ...area, lush: area.lush.mul(lush) };
    floorBlend = style.dry.max(style.worn).smoothstep(0.15, 0.6);
    ({ root: soilRoot, tip } = applyMeadowGroundStyle(soilRoot, tip, style));
    ({ root: canopyColor } = applyMeadowGroundStyle(canopyColor, tip, style));
  }
  return {
    root: mix(soilRoot, canopyColor, meadowCanopyView(canopy.a)),
    tip,
    detail: detail ? { litter: row(2), amounts: row(3), settings: detail } : null,
    floor: detail ? { layers: row(5), blend: floorBlend } : null,
    map,
    dispose: () => map.dispose(),
  };
}
