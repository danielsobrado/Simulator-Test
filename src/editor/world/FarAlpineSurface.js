import * as THREE from 'three/webgpu';
import {
  cameraViewMatrix, color, float, mix, mx_noise_float, normalWorldGeometry, normalize, positionWorld, smoothstep,
  texture, uniform, vec3, vec4,
} from 'three/tsl';
import { resolveAssetUrl } from '../assets/assetUrl.js';
import { snowLightUniforms } from '../stylized/sky/skyLight.js';
import { FAR_GLACIER_ICE } from '../materials/TerrainMaterialBakeFarColor.js';

const COLOR_FILE = 'assets/textures/settlement/stone-rock-color.webp';
const NORMAL_FILE = 'assets/textures/settlement/stone-rock-normal.webp';
/** Texture repeat, metres. */
const CRAG_METERS = 42;
const PERIOD_METERS = 4096;
const ROCK_TINT = '#8f9cae';
/** Bands of harder and softer rock, tilted a little with the broad noise. */
const STRATA_METERS = 34;
const STRATA_DEPTH = 0.22;
const NORMAL_STRENGTH = 1.1;
/** Facing-up over which a face goes from bare rock to holding snow. */
const HOLD_START = 0.56;
const HOLD_FULL = 0.72;
const HOLD_BREAKUP = 0.2;
/** Snow lies in the rock's cracks first. */
const HOLD_CRACKS = 0.35;

let shared = null;

export function acquireRockTextures() {
  if (shared) return shared;
  // CPU-only callers have no image decoder.
  if (typeof document === 'undefined') return { color: new THREE.Texture(), normal: new THREE.Texture() };
  const loader = new THREE.TextureLoader();
  const load = (file, colorSpace) => {
    const map = loader.load(resolveAssetUrl(import.meta.env?.BASE_URL ?? '/', file));
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = colorSpace;
    map.anisotropy = 8;
    return map;
  };
  shared = { color: load(COLOR_FILE, THREE.SRGBColorSpace), normal: load(NORMAL_FILE, THREE.NoColorSpace) };
  return shared;
}

/**
 * Rock and snow for the far terrain, per pixel, because a ring is far coarser
 * than a ridge: triplanar stone with strata on the faces, snow held on ledges
 * and in cracks. No viewport textures.
 */
export function createFarAlpineSurface({ vertexColor, snowCover, snowColor, iceCover = float(0) }) {
  const maps = acquireRockTextures();
  const origin = uniform(new THREE.Vector3());
  const p = positionWorld.add(origin).toVar();
  const up = normalize(normalWorldGeometry).toVar();
  const blend = up.abs().pow(vec3(4)).toVar();
  const weights = blend.div(blend.x.add(blend.y).add(blend.z)).toVar();
  const triplanar = (map, meters) => {
    const scale = float(1 / meters);
    return texture(map, p.zy.mul(scale)).rgb.mul(weights.x)
      .add(texture(map, p.xz.mul(scale)).rgb.mul(weights.y))
      .add(texture(map, p.xy.mul(scale)).rgb.mul(weights.z));
  };
  const crag = triplanar(maps.color, CRAG_METERS).toVar();
  const stone = crag.mul(2).toVar();
  const cracks = stone.dot(vec3(0.3, 0.55, 0.15)).clamp(0, 1).toVar();
  const broad = mx_noise_float(p.mul(0.011)).add(mx_noise_float(p.mul(0.043)).mul(0.5)).toVar();
  const strata = p.y.add(broad.mul(26)).div(STRATA_METERS).mul(Math.PI * 2).sin().mul(STRATA_DEPTH).add(1);
  const rock = stone.mul(color(ROCK_TINT)).mul(strata).mul(mix(vec3(1), vertexColor.mul(2), 0.35));
  const hold = smoothstep(HOLD_START, HOLD_FULL,
    up.y.add(broad.mul(HOLD_BREAKUP)).add(float(0.3).sub(cracks).mul(HOLD_CRACKS)));
  const snow = snowCover.mul(hold).toVar();
  // Below the snow the vertex colour keeps the biome; steep ground takes the rock.
  const bare = smoothstep(0.72, 0.92, up.y).oneMinus();
  const ground = mix(vertexColor.mul(broad.mul(0.4).add(1)), rock, bare);
  const offset = triplanar(maps.normal, CRAG_METERS).mul(2).sub(1).mul(NORMAL_STRENGTH).mul(snow.oneMinus());
  const lit = normalize(up.add(vec3(offset.x, 0, offset.y)));
  // The near snow's albedo and shade, or the two meet at a visible seam.
  const farShade = mix(vec3(1), snowLightUniforms.shadeTint, snowLightUniforms.shade);
  return {
    // A glacier's snow reads as its bare grey-blue ice from afar (GlacierIceShading).
    color: mix(ground, mix(color(snowColor), color(FAR_GLACIER_ICE), iceCover).mul(snowLightUniforms.brightness).mul(farShade), snow),
    normal: normalize(cameraViewMatrix.mul(vec4(lit, 0)).xyz),
    /** Keeps the rock fixed to the world across floating-origin snaps. */
    setOrigin(state) {
      origin.value.set(state.x % PERIOD_METERS, 0, state.z % PERIOD_METERS);
    },
  };
}
