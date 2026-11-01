import * as THREE from 'three/webgpu';
import { cameraViewMatrix, faceDirection, mix, normalViewGeometry, positionView, smoothstep, vec4 } from 'three/tsl';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

/** Share of a plant's normal bent to the sky, leaving a little authored form. */
const SKYWARD_NORMAL = 0.72;
/** Crown in-scatter: metres over which it ramps, and its share of the sky fill. */
const CROWN_AIR_START = 25;
const CROWN_AIR_END = 240;
const CROWN_AIR = 0.32;

/**
 * A restrained sky fill shared by crowns and understory, updated once a frame.
 * Direct transmission uses the scene light's colour, intensity and shadows.
 */
export const foliageLight = Object.freeze({
  /** Transmission gain, applied to already-shadowed direct radiance. */
  strength: uniform(0.12),
  /** Sky fill lifting the canopy's shaded interior. */
  fill: uniform(0.3),
  skyColor: uniform(new THREE.Color('#ffffff')),
});

/**
 * Copies the hemisphere's linear colour and capped intensity into the fill.
 *
 * @param {{ directional?: THREE.DirectionalLight, hemisphere?: THREE.HemisphereLight } | null} sky
 */
export function syncFoliageLight(sky) {
  const hemisphere = sky?.hemisphere;
  if (hemisphere) foliageLight.skyColor.value.copy(hemisphere.color);
  else foliageLight.skyColor.value.setRGB(0, 0, 0);
  foliageLight.fill.value = Math.min(Math.max(hemisphere?.intensity ?? 0, 0) * 0.35, 0.7);
  // Light intensity and colour are already included in the lighting model.
  foliageLight.strength.value = sky?.directional ? 0.12 : 0;
}

export function foliageSkyFill(color, amount) {
  return color.mul(foliageLight.skyColor).mul(foliageLight.fill).mul(amount);
}

/**
 * Lights a ground plant as the meadow around it, whose normals face the sky.
 * Upright leaf normals catch almost no high sun, so tufts read near black against
 * the grass. Call after applyPlantMotion, which may replace `normalNode`.
 */
export function applySkywardNormal(material) {
  const authored = material.normalNode ?? normalViewGeometry.mul(faceDirection);
  const up = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz;
  material.normalNode = mix(authored, up, SKYWARD_NORMAL).normalize();
  return material;
}

/**
 * Only sky fill is emissive; sunlight must pass through the shadow system.
 * The added air lifts shaded leaves toward the sky behind them: exp² fog is still
 * near zero at the treeline, where crowns otherwise cut out of the sky.
 */
export function treeFoliageEmission(crown) {
  const air = smoothstep(CROWN_AIR_START, CROWN_AIR_END, positionView.length()).mul(CROWN_AIR);
  return foliageSkyFill(crown, 0.4).add(foliageLight.skyColor.mul(foliageLight.fill).mul(air));
}
