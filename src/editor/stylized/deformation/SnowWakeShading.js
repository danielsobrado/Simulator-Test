import { frameUniform } from '../../../render/FrameUniforms.js';
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  clamp,
  float,
  int,
  max,
  mix,
  select,
  smoothstep,
  uniformArray,
  vec2,
  vec3,
} from 'three/tsl';
import { groundDeformationNode } from './groundDeformationNode.js';
import {
  SNOW_WAKE_BERM_SHARE,
  SNOW_WAKE_CAPACITY,
  SNOW_WAKE_CUT_FRACTION,
  SNOW_WAKE_LIFETIME,
  SNOW_WAKE_STEP,
  SnowWakeSpine,
  wakeDepthForSpeed,
  wakeFade,
  wakeWidthForSpeed,
} from './snowWakeMath.js';

/**
 * The deep-snow wake as the terrain material draws it: a TSL node function that
 * reads the shared deformation field plus a small spine of uniforms and returns
 * the height offset across the trail and the shading a snow material applies.
 *
 * Reuse rather than a second field: the shared field (`groundDeformationState`)
 * is already a player-centred texture of pressed ground that the terrain, the
 * grass and `FootprintShading` all read, so the wake does not add another one.
 * It could not carry the wake itself, though — the field stores one unsigned
 * press per texel with no room left (R depth, G stamp time, B/A window id), it
 * has no notion of a path or of which way the body was facing, its 6.25 cm texels
 * cannot hold a banked section metres wide, and a fast trail runs beyond the
 * 16 m window that follows the player. So the wake reads the field for the press
 * already there (a footfall inside the trail deepens it) and adds only the spine
 * uniforms the field cannot hold.
 */

/** A footprint's press, in metres, so field and wake share one scale. */
const FIELD_PRESS_METRES = 0.1;
/** Offset at which the pressed/raised shading saturates, metres. */
const SHADE_DEPTH_METRES = 0.14;
/** Below this baked snow weight the ground is not deep enough to cut. */
const SNOW_GATE = 0.05;

/**
 * The wake's CPU state: the pure spine from `snowWakeMath`, plus the uniform
 * arrays the shader reads. Kept here, not in the maths, because the maths must
 * stay free of Three.js (see the module header there).
 *
 * @param {object} [options]
 * @param {number} [options.capacity] samples kept
 * @param {number} [options.step] metres between samples
 */
export function createSnowWakeState({
  capacity = SNOW_WAKE_CAPACITY,
  step = SNOW_WAKE_STEP,
} = {}) {
  const spine = new SnowWakeSpine({ capacity, step });
  // Per slot: (x, z, depth, fade). `axes` carries the right axis and half-width.
  const points = uniformArray(Array.from({ length: capacity }, () => new THREE.Vector4()), 'vec4');
  const axes = uniformArray(
    Array.from({ length: capacity }, () => new THREE.Vector4(1, 0, 0, 0)),
    'vec4',
  );
  // (x, z, radius): a circle holding the whole live trail, so a fragment outside
  // it skips the per-sample loop with one distance test. Its centre is whole
  // metres and the samples are stored relative to it: canonical coordinates run
  // to hundreds of kilometres, where float32 steps by centimetres, but a
  // difference of whole numbers is exact.
  const bounds = frameUniform(new THREE.Vector3());
  const uniforms = { points, axes, count: frameUniform(0), step: frameUniform(step), bounds };

  return {
    capacity,
    spine,
    uniforms,
    /**
     * Offer the body's current position to the spine. It commits a sample only
     * once `step` metres have been travelled, so an idle body lays nothing and a
     * moving one lays a uniform trail.
     */
    record(clock, x, y, z, motion) {
      return spine.update(clock, x, y, z, motion);
    },
    /**
     * Repack the spine into the shader arrays, deriving each sample's depth and
     * width from the speed it was laid at and fading it by its age. Call once a
     * frame; it is the only thing that writes the uniforms.
     */
    sync(clock, { life = SNOW_WAKE_LIFETIME } = {}) {
      const count = spine.count;
      uniforms.count.value = count;
      let minX = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxZ = -Infinity;
      let widest = 0;
      if (count === 0) return 0;
      const newest = spine.indexAt(count - 1);
      const anchorX = Math.round(spine.x[newest]);
      const anchorZ = Math.round(spine.z[newest]);
      for (let order = 0; order < count; order += 1) {
        const index = spine.indexAt(order);
        const speed = spine.speed[index];
        const depth = wakeDepthForSpeed(speed) * spine.strength[index];
        const width = wakeWidthForSpeed(speed);
        const fade = wakeFade(Math.max(0, clock - spine.laid[index]), life);
        points.array[order].set(spine.x[index] - anchorX, spine.z[index] - anchorZ, depth, fade);
        axes.array[order].set(spine.rightX[index], spine.rightZ[index], width, 0);
        minX = Math.min(minX, spine.x[index]);
        maxX = Math.max(maxX, spine.x[index]);
        minZ = Math.min(minZ, spine.z[index]);
        maxZ = Math.max(maxZ, spine.z[index]);
        widest = Math.max(widest, width);
      }
      // Every sample lies within this reach of the anchor, banks and kernel included.
      const reach = Math.max(
        Math.hypot(minX - anchorX, minZ - anchorZ),
        Math.hypot(maxX - anchorX, minZ - anchorZ),
        Math.hypot(minX - anchorX, maxZ - anchorZ),
        Math.hypot(maxX - anchorX, maxZ - anchorZ),
      );
      uniforms.bounds.value.set(anchorX, anchorZ, reach + widest + spine.step);
      return count;
    },
    clear() {
      spine.reset();
      uniforms.count.value = 0;
    },
  };
}

/**
 * @param {object} options
 * @param {object} options.terrainUv chunk uv
 * @param {number} options.chunkWorldSize metres
 * @param {object} options.chunkCenter vec2 uniform, canonical chunk centre
 * @param {object} options.snow 0..1 baked snow weight — the deep-cover gate
 * @param {object} options.state a `createSnowWakeState` state
 * @param {object} options.config needs `enabled: true`; disabled builds nothing
 * @returns {{ height: object, apply: (color: object) => object } | null} null when
 *   disabled, so a caller that adds nothing to its material compiles no wake code
 */
export function createSnowWakeShading({
  terrainUv,
  chunkWorldSize,
  chunkCenter,
  snow,
  state,
  config = {},
}) {
  // Returning null, not a zero node: "off" must remove the loop from the shader,
  // not run it and multiply by zero.
  if (config?.enabled !== true || !state || !snow) return null;
  const { points, axes, count, step, bounds } = state.uniforms;

  const localMeters = vec2(terrainUv.x, terrainUv.y).mul(chunkWorldSize);
  const originMeters = vec2(
    chunkCenter.x.sub(chunkWorldSize * 0.5),
    chunkCenter.y.negate().sub(chunkWorldSize * 0.5),
  ).round();
  // The fragment's canonical XZ relative to the trail's whole-metre anchor, in the
  // axes the shared field is addressed in and the spine is recorded in (see
  // groundDeformationNode). Whole origin minus whole anchor is exact at any scale.
  const fragment = vec2(originMeters.x, originMeters.y.negate()).sub(vec2(bounds.x, bounds.y))
    .add(vec2(localMeters.x, localMeters.y.negate()));

  // The shared field: press already in the ground here. Gated by the trail's own
  // presence so an idle wake does not re-tint the footprints FootprintShading has.
  const active = select(count.greaterThan(1), float(1), float(0));
  const fieldPress = groundDeformationNode(originMeters, localMeters)
    .mul(FIELD_PRESS_METRES)
    .mul(active);

  // Signed offset, metres: negative in the cut, positive over the banks. Unrolled
  // over the fixed capacity (a JS constant) rather than a shader loop, so the
  // graph is the same size every frame. `Fn` wraps it because `If` needs a
  // function context.
  const offset = Fn(() => {
    const trail = float(0).toVar();
    // Deep snow, a trail that has moved, and inside its circle: anywhere else
    // the whole loop is skipped.
    const nearTrail = fragment.length().lessThan(bounds.z);
    If(snow.greaterThan(SNOW_GATE).and(count.greaterThan(1)).and(nearTrail), () => {
      const peak = (SNOW_WAKE_CUT_FRACTION + 1) * 0.5;
      for (let slot = 0; slot < state.capacity; slot += 1) {
        const point = points.element(int(slot));
        const axis = axes.element(int(slot));
        const rel = fragment.sub(vec2(point.x, point.y));
        const right = vec2(axis.x, axis.y);
        const lateral = abs(rel.dot(right));
        const along = abs(rel.dot(vec2(right.y.negate(), right.x)));
        // A slot past the live count must not stamp: it holds a stale position.
        const live = select(count.greaterThan(slot), float(1), float(0));
        // The stamp is local to the sample: full strength for half a step either
        // side, so neighbours (one step apart) meet at full strength and the trail
        // is one trench rather than a dashed row; it rolls off over the next half.
        const near = float(1).sub(smoothstep(step.mul(0.5), step, along));
        const width = max(axis.z, float(1e-4));
        const depth = max(point.z, float(0));
        const t = clamp(lateral.div(width), 0, 1);
        const cut = float(1).sub(smoothstep(0, SNOW_WAKE_CUT_FRACTION, t));
        const berm = smoothstep(SNOW_WAKE_CUT_FRACTION, peak, t)
          .mul(float(1).sub(smoothstep(peak, 1, t)));
        const stamp = berm.mul(SNOW_WAKE_BERM_SHARE).sub(cut)
          .mul(depth).mul(near).mul(point.w).mul(live);
        trail.assign(select(abs(stamp).greaterThan(abs(trail)), stamp, trail));
      }
    });
    const bank = max(trail, float(0));
    // The deeper of the wake's own cut and any press the field already holds.
    const cut = max(trail.negate(), float(0)).max(fieldPress);
    return bank.sub(cut);
  })();

  const pressed = clamp(offset.negate(), 0, SHADE_DEPTH_METRES).div(SHADE_DEPTH_METRES);
  const raised = clamp(offset, 0, SHADE_DEPTH_METRES).div(SHADE_DEPTH_METRES);
  // Pressed snow goes a shade darker and greyer; the lifted bank reads fresher,
  // which is what makes a line through fresh snow read as cut rather than painted.
  const pressedTint = vec3(0.72, 0.7, 0.68);
  const bankTint = vec3(1.04, 1.05, 1.07);
  return {
    height: offset,
    /** @param {object} color the snow colour from the layers before this one */
    apply(color) {
      const shaded = mix(color, color.mul(pressedTint), pressed.mul(snow).mul(0.85));
      return mix(shaded, color.mul(bankTint), raised.mul(snow).mul(0.5));
    },
  };
}
