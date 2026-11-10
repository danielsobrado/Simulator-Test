import { frameUniform } from '../../../render/FrameUniforms.js';
import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraWorldMatrix,
  cameraViewMatrix,
  dot,
  exp,
  float,
  int,
  length,
  mix,
  normalize,
  smoothstep,
  step,
  uniformArray,
  uv,
  vec3,
  vec4,
} from 'three/tsl';

import { skyLightUniforms } from '../sky/skyLight.js';

/** Powder falls slowly: drag-limited, not ballistic. */
const GRAVITY = 2.6;
const DRAG = 2.2;

/**
 * Uniforms for the kick slots: per slot, `kicks` holds the footfall (x, y, z
 * render space, start time) and `motions` the kick's forward direction (x, z),
 * its strength and a seed.
 */
export function createSnowPowderUniforms(slots) {
  return {
    time: frameUniform(0),
    kicks: uniformArray(Array.from({ length: slots }, () => new THREE.Vector4(0, -1e5, 0, -1e3)), 'vec4'),
    motions: uniformArray(Array.from({ length: slots }, () => new THREE.Vector4()), 'vec4'),
  };
}

/**
 * Each puff reads its kick's slot and its own seed, and flies from the
 * footfall forward and up, slowing in the air and settling as it spreads and
 * fades. A slot not kicked for a while has aged out and draws nothing.
 */
export function createSnowPowderMaterial(uniforms, { lifetime, size, opacity }, sunDirection = null) {
  const slot = attribute('powderSlot', 'float');
  const seed = attribute('powderSeed', 'vec4');
  const kick = uniforms.kicks.element(int(slot));
  const motion = uniforms.motions.element(int(slot));

  const life = mix(float(lifetime * 0.6), float(lifetime * 1.2), seed.w);
  const age = uniforms.time.sub(kick.w);
  const t = age.div(life);
  const alive = step(0, age).mul(step(t, 1));

  const strength = motion.z;
  const forward = vec3(motion.x, 0, motion.y);
  const side = vec3(motion.y.negate(), 0, motion.x);
  const velocity = forward.mul(mix(0.3, 1.4, seed.x))
    .add(side.mul(seed.y.sub(0.5).mul(1.6)))
    .add(vec3(0, mix(0.5, 1.6, seed.z), 0))
    .mul(strength);
  // Horizontal travel eases off with drag; height rises then settles.
  const travel = float(1).sub(exp(age.mul(-DRAG))).div(DRAG);
  // Born scattered around the boot, not stacked on one point.
  const scatter = vec3(seed.x.sub(0.5), seed.z.mul(0.3), seed.y.sub(0.5)).mul(0.35);
  const center = kick.xyz
    .add(scatter)
    .add(velocity.mul(travel))
    .sub(vec3(0, age.mul(age).mul(GRAVITY * 0.5).mul(t), 0));

  const radius = mix(float(size * 0.45), float(size), t.clamp(0, 1).sqrt()).mul(alive);
  const corner = attribute('powderCorner', 'vec2');
  const right = cameraWorldMatrix.element(0).xyz;
  const up = cameraWorldMatrix.element(1).xyz;

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
  });
  // Sat on the snow rather than cut into it: a quad crossing the ground shows
  // its intersection as a hard hatched edge.
  const lifted = center.add(vec3(0, radius.mul(0.8), 0));
  material.positionNode = lifted.add(right.mul(corner.x.mul(radius))).add(up.mul(corner.y.mul(radius)));
  const soft = float(1).sub(smoothstep(0.25, 1, length(uv().sub(0.5).mul(2))));
  const fade = float(1).sub(t).mul(smoothstep(0, 0.2, t));
  material.opacityNode = soft.mul(fade).mul(opacity).mul(strength.min(1)).mul(alive);
  // Gods' End's powder catches warm direct light while its shaded side stays
  // cool. The forward-scatter lobe brightens a puff viewed toward the sun.
  const local = uv().sub(0.5).mul(2);
  const sphereNormal = normalize(vec3(local, dot(local, local).oneMinus().max(0).sqrt()));
  const sun = frameUniform(sunDirection ?? new THREE.Vector3(0.35, 0.85, 0.25));
  const lightView = normalize(cameraViewMatrix.mul(vec4(sun, 0)).xyz);
  const diffuse = dot(sphereNormal, lightView).add(0.75).div(1.75).max(0);
  const mu = lightView.z.negate();
  const phase = mu.mul(mu).add(1).mul(0.03614)
    .div(mu.mul(-1.1).add(1.3025).pow(1.5));
  const fill = skyLightUniforms.reflectionTint.mul(skyLightUniforms.brightness).mul(0.65);
  const lighting = fill.add(skyLightUniforms.sunColor.mul(diffuse.mul(0.55).add(phase.mul(0.935))));
  material.colorNode = vec3(0.86, 0.93, 0.98).mul(mix(0.82, 1, seed.y)).mul(lighting);
  return material;
}
