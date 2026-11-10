import { frameUniform } from '../../../render/FrameUniforms.js';
import { createFallingLeafTexture } from './FallingLeafTextures.js';
import * as THREE from 'three/webgpu';
import {
  attribute,
  cos,
  cross,
  dot,
  float,
  fract,
  max,
  mix,
  normalize,
  sin,
  step,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
} from 'three/tsl';

import { skyLightUniforms } from '../sky/skyLight.js';
import { fallingLeafPalette } from '../forest/foliagePalette.js';
import { MAX_LEAF_SHELTERS } from './fallingLeafPlaces.js';
import { setRuntimeUserData } from '../../../render/materials/runtimeUserData.js';

const TAU = Math.PI * 2;

/** Shared uniforms: the camera-centred box the leaves wrap in, time, wind, how many fall. */
export function createFallingLeavesUniforms({ boxSize, boxHeight, palette = fallingLeafPalette().map(color => color.toArray()) }) {
  return {
    time: frameUniform(0),
    center: uniform(new THREE.Vector3()),
    wind: frameUniform(new THREE.Vector2()),
    amount: frameUniform(0),
    boxSize: frameUniform(boxSize),
    boxHeight: frameUniform(boxHeight),
    palette: palette.map(rgb => frameUniform(new THREE.Color().fromArray(rgb))),
    // Buildings near the camera (fallingLeafPlaces): centre x, z in render
    // space, then yaw cos, sin; and half width, half depth, roof top y. A
    // negative half width is an empty slot.
    shelterPlacement: uniformArray(Array.from({ length: MAX_LEAF_SHELTERS }, () => new THREE.Vector4(0, 0, 1, 0))),
    shelterSize: uniformArray(Array.from({ length: MAX_LEAF_SHELTERS }, () => new THREE.Vector4(-1, -1, 0, 0))),
  };
}

/** Rotate `v` about unit `axis` by `angle` (Rodrigues). */
function rotateAbout(v, axis, angle) {
  const c = cos(angle);
  const s = sin(angle);
  return v.mul(c).add(cross(axis, v).mul(s)).add(axis.mul(dot(axis, v)).mul(float(1).sub(c)));
}

/** 1 when a render-space point is inside any shelter; see insideShelter. */
function shelteredNode(point, { shelterPlacement, shelterSize }) {
  let sheltered = float(0);
  for (let index = 0; index < MAX_LEAF_SHELTERS; index += 1) {
    const placement = shelterPlacement.element(index);
    const extent = shelterSize.element(index);
    const planX = point.x.sub(placement.x);
    const planZ = placement.y.sub(point.z);
    const localX = placement.z.mul(planX).sub(placement.w.mul(planZ)).abs();
    const localZ = placement.w.mul(planX).add(placement.z.mul(planZ)).abs();
    const inside = step(localX, extent.x).mul(step(localZ, extent.y)).mul(step(point.y, extent.z));
    sheltered = max(sheltered, inside);
  }
  return sheltered;
}

/**
 * Every leaf's path is a function of its seed and time, so the CPU never
 * touches an instance. A leaf falls through a box around the camera and wraps
 * back to the top; its position wraps horizontally in world space, so leaves
 * stay put while the camera walks through them. Seeds above `amount` fold to
 * nothing, which is how density follows the canopy.
 *
 * Unlit, and dimmed by the sky's light like the water.
 */
export function createFallingLeavesMaterial(uniforms, { size, fallSpeed }) {
  const corner = attribute('leafCorner', 'vec2');
  const seed = attribute('leafSeed', 'vec4');
  const { time, center, wind, amount, boxSize, boxHeight } = uniforms;

  const speed = mix(float(fallSpeed * 0.7), float(fallSpeed * 1.3), seed.z);
  const fall = fract(seed.w.add(time.mul(speed).div(boxHeight)));
  // Drift with the wind while falling, plus a lazy side-to-side swing.
  const swing = sin(time.mul(mix(0.8, 1.6, seed.x)).add(seed.y.mul(TAU))).mul(0.9);
  const drift = wind.mul(time.mul(0.6)).add(vec2(swing, swing.mul(0.6)));
  const anchor = vec2(seed.x, seed.y).mul(boxSize).add(drift);
  const offset = fract(anchor.sub(center.xz).div(boxSize)).sub(0.5).mul(boxSize);
  const origin = vec3(
    center.x.add(offset.x),
    center.y.add(boxHeight.mul(float(0.6).sub(fall))),
    center.z.add(offset.y),
  );

  const axis = normalize(vec3(seed.x.sub(0.5), seed.z.add(0.2), seed.y.sub(0.5)));
  const angle = time.mul(mix(1.5, 4, seed.z)).add(seed.w.mul(TAU));
  // Indoors, under a roof or inside a wall, a leaf is folded away.
  const visible = step(seed.w, amount).mul(shelteredNode(origin, uniforms).oneMinus());
  const scaled = vec3(corner.x, corner.y, 0).mul(size).mul(mix(0.7, 1.3, seed.x)).mul(visible);

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  material.positionNode = origin.add(rotateAbout(scaled, axis, angle));

  // A neutral painted leaf supplies veins and shading. Pigment is a uniform,
  // so entering a different grove changes hue without rebuilding its texture.
  const leafTexture = createFallingLeafTexture([[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  const layer = seed.z.mul(3).floor().min(2);
  const leaf = texture(leafTexture, uv()).depth(layer);
  const pigment = mix(mix(uniforms.palette[0], uniforms.palette[1], step(1, layer)), uniforms.palette[2], step(2, layer));
  material.alphaTest = 0.5;
  material.opacityNode = leaf.a;
  material.colorNode = leaf.rgb.mul(pigment).mul(mix(0.8, 1.05, seed.y)).mul(skyLightUniforms.brightness);
  setRuntimeUserData(material, 'leafTexture', leafTexture);
  const dispose = () => {
    leafTexture.dispose();
    material.removeEventListener('dispose', dispose);
  };
  material.addEventListener('dispose', dispose);
  material.depthWrite = true;
  return material;
}
