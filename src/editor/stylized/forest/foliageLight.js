import * as THREE from 'three/webgpu';
import { cameraViewMatrix, faceDirection, float, mix, normalViewGeometry, normalWorld, positionGeometry, positionView, smoothstep, vec4 } from 'three/tsl';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

/** Share of a plant's normal bent to the sky, leaving a little authored form. */
const SKYWARD_NORMAL = 0.72;
/** Crown in-scatter: metres over which it ramps, and its share of the sky fill. */
const CROWN_AIR_START = 14;
const CROWN_AIR_END = 220;
const CROWN_AIR = 0.42;
/** Share of the sky fill a crown's and a trunk's shaded faces take. */
const CROWN_FILL = 0.55;
const BARK_FILL = 0.6;
/** Share of the ground's bounce light a downward face takes. */
const CROWN_BOUNCE = 0.5;
const BARK_BOUNCE = 0.7;
/**
 * Stone takes several times bark's share: under this scene's thin ambient a backlit
 * boulder (atlas albedo ~0.25) otherwise renders as a black lump on bright ground.
 */
const ROCK_FILL = 3.5;
const ROCK_BOUNCE = 4;
const UNDERSTORY_FILL = 1.65;
const UNDERSTORY_BOUNCE = 2.1;
const BLOSSOM_FILL = 1.15;
const BLOSSOM_BOUNCE = 1.4;
const BUILDING_FILL = 2.2;
const BUILDING_BOUNCE = 2.6;
/** Metres up a trunk over which the bounce off the ground fades. */
const BOUNCE_REACH = 5;

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
  /** The hemisphere's ground colour: light coming back up off the forest floor. */
  groundColor: uniform(new THREE.Color('#000000')),
  sunDirection: uniform(new THREE.Vector3(0, 1, 0)),
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
  if (hemisphere) foliageLight.groundColor.value.copy(hemisphere.groundColor);
  else foliageLight.groundColor.value.setRGB(0, 0, 0);
  foliageLight.fill.value = Math.min(Math.max(hemisphere?.intensity ?? 0, 0) * 0.35, 0.7);
  // Light intensity and colour are already included in the lighting model.
  foliageLight.strength.value = sky?.directional ? 0.12 : 0;
  if (sky?.directional) foliageLight.sunDirection.value.copy(sky.directional.position)
    .sub(sky.directional.target.position).normalize();
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
export function treeFoliageEmission(crown, skyEdge = null, visibility = float(1)) {
  const air = treeAir();
  const edge = skyEdge ?? float(0);
  const underside = normalWorld.y.negate().max(0);
  return foliageSkyFill(crown, CROWN_FILL).mul(visibility)
    .add(crown.mul(foliageLight.groundColor).mul(foliageLight.fill).mul(underside).mul(CROWN_BOUNCE).mul(visibility))
    .add(foliageLight.skyColor.mul(foliageLight.fill).mul(air.add(edge)));
}

function treeAir() {
  return smoothstep(CROWN_AIR_START, CROWN_AIR_END, positionView.length()).mul(CROWN_AIR);
}

/**
 * The same air and fill on bark, and the floor's own light on its lower faces: lit
 * only by the sun and a thin ambient, a shaded trunk is a black bar in a green wood.
 */
export function treeBarkEmission(bark, { height = positionGeometry.y, up = normalWorld.y } = {}) {
  const low = smoothstep(0, BOUNCE_REACH, height).oneMinus();
  const facing = up.negate().mul(0.5).add(0.5);
  return foliageSkyFill(bark, BARK_FILL)
    .add(bark.mul(foliageLight.groundColor).mul(foliageLight.fill).mul(facing).mul(low).mul(BARK_BOUNCE))
    .add(foliageLight.skyColor.mul(foliageLight.fill).mul(treeAir()));
}

/** Sky fill and floor bounce for scattered stones, which sit wholly in the bounce. */
export function rockShadeEmission(stone) {
  const facing = normalWorld.y.negate().mul(0.5).add(0.5);
  return foliageSkyFill(stone, ROCK_FILL)
    .add(stone.mul(foliageLight.groundColor).mul(foliageLight.fill).mul(facing).mul(ROCK_BOUNCE))
    .add(foliageLight.skyColor.mul(foliageLight.fill).mul(treeAir()));
}

/**
 * Sky fill, ground-colour bounce and distance air in-scatter for understory plants,
 * shrubs and bush proxies so they sit in the same light and horizon haze as stones.
 */
export function understoryShadeEmission(plant, { blossom = false } = {}) {
  const fill = blossom ? BLOSSOM_FILL : UNDERSTORY_FILL;
  const bounce = blossom ? BLOSSOM_BOUNCE : UNDERSTORY_BOUNCE;
  const facing = normalWorld.y.negate().mul(0.5).add(0.5);
  return foliageSkyFill(plant, fill)
    .add(plant.mul(foliageLight.groundColor).mul(foliageLight.fill).mul(facing).mul(bounce))
    .add(foliageLight.skyColor.mul(foliageLight.fill).mul(treeAir()));
}

/**
 * Shared sky fill, warm ground bounce and distance air in-scatter for settlements,
 * workshop buildings and placed structures so masonry, plaster, timber and roofs
 * share the soft-shaded atmospheric integration of the terrain's boulders.
 */
export function buildingShadeEmission(surface, { fill = BUILDING_FILL, bounce = BUILDING_BOUNCE } = {}) {
  const facing = normalWorld.y.negate().mul(0.5).add(0.5);
  return foliageSkyFill(surface, fill)
    .add(surface.mul(foliageLight.groundColor).mul(foliageLight.fill).mul(facing).mul(bounce))
    .add(foliageLight.skyColor.mul(foliageLight.fill).mul(treeAir()));
}
