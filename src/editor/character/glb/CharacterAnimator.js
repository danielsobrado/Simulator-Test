/**
 * Turns the player's motion into a pose on an authored rig.
 *
 * Owns the mixer and everything layered over it, in the order the layers must
 * run each frame:
 *
 *   1. lean the body for swimming (everything below is solved in its frame);
 *   2. restore the mixer's own last output (foot placement bookkeeping);
 *   3. write the standing / walk / run blend at the shared stride phase;
 *   4. plant the feet on the ground under them;
 *   5. swim: stroke the arms and kick the legs;
 *   6. raise the arms into a cast.
 *
 * Each later layer works on the pose the earlier ones left, so reordering them
 * would, for instance, cast from arms the clip has not posed yet.
 */

import * as THREE from 'three';
import { ArmCastPose } from './ArmCastPose.js';
import { FootPlacement } from './FootPlacement.js';
import { FootstepTracker } from './FootstepTracker.js';
import { LocomotionBlend } from './LocomotionBlend.js';
import { calibrateLocomotionClip } from './locomotionCalibration.js';
import { measureFootLandings } from './footLandings.js';
import { createStandingClip } from './standingPose.js';
import { SwimMotion } from './SwimMotion.js';
import { SwimStroke } from './SwimStroke.js';

const MAX_STEP_SECONDS = 0.1;

function requireClip(clips, name, heroId) {
  const clip = clips.find((candidate) => candidate.name === name);
  if (!clip) throw new Error(`Character "${heroId}" has no animation clip "${name}".`);
  return clip;
}

export class CharacterAnimator {
  /**
   * @param {object} options
   * @param {THREE.Object3D} options.body pivot the swim lean turns about; the model's parent
   * @param {THREE.Object3D} options.model scaled rig, in its bind pose, placed with soles at `solesY`
   * @param {THREE.AnimationClip[]} options.clips
   * @param {ReturnType<import('./humanoidRig.js').collectHumanoidBones>} options.bones
   * @param {ReturnType<import('./CharacterRoster.js').resolveHeroCharacter>} options.hero
   * @param {{ heightAt(x: number, z: number): number }} options.terrain
   * @param {number} options.solesY
   */
  constructor({ body, model, clips, bones, hero, terrain, solesY }) {
    const walk = calibrateLocomotionClip(requireClip(clips, hero.clips.walk, hero.id), hero.rootMotion);
    const run = calibrateLocomotionClip(requireClip(clips, hero.clips.run, hero.id), hero.rootMotion);
    const idle = hero.clips.idle
      ? requireClip(clips, hero.clips.idle, hero.id)
      : createStandingClip(model, walk);

    // Offline measurements first, while the rig is still in its bind pose.
    const feet = { left: bones.left.foot, right: bones.right.foot };
    const landings = {
      walk: measureFootLandings(model, walk, feet),
      run: measureFootLandings(model, run, feet),
    };
    this.walkOffset = landings.walk.left[0] ?? 0;
    this.runOffset = landings.run.left[0] ?? 0;
    this.footsteps = new FootstepTracker(landings, { walk: this.walkOffset, run: this.runOffset });
    /** The foot that landed on the last update, or null. */
    this.footfall = null;
    this.footPlacement = hero.footPlacement
      ? new FootPlacement(model, terrain, hero.targetHeight, bones, solesY)
      : null;

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {
      idle: this.mixer.clipAction(idle),
      walk: this.mixer.clipAction(walk),
      run: this.mixer.clipAction(run),
    };
    for (const action of Object.values(this.actions)) {
      action.play();
      action.setEffectiveWeight(0);
    }
    this.locomotion = new LocomotionBlend({
      height: hero.targetHeight,
      clipSpeedInHeights: hero.clipSpeedInHeights,
      durations: { walk: walk.duration, run: run.duration },
      limits: hero.locomotion,
    });
    this.castPose = new ArmCastPose(bones);
    this.swimMotion = new SwimMotion({
      treadCadence: hero.locomotion.swimCadence,
      pivotHeight: body.position.y,
    });
    this.pivotHeight = body.position.y;
    this.swimStroke = new SwimStroke(model, bones);
    this.body = body;
    this.model = model;
    this.idleSeconds = 0;
  }

  reset() {
    this.locomotion.reset();
    this.swimMotion.reset();
    this.footsteps.reset();
    this.footfall = null;
  }

  /**
   * @param {number} dt seconds
   * @param {import('../CharacterMotionState.js').CharacterMotionState} motion
   * @param {boolean} swimming
   * @param {boolean} [submerged] the whole body is under water
   * @param {number} [surfaceHeight] world height of the water surface, if any
   */
  update(dt, motion, swimming, submerged = false, surfaceHeight = Number.NaN) {
    // Every layer below integrates over this step. A negative or huge one — a
    // clock that jumped, a tab that slept — would drive the exponential
    // settles past their targets, so it is clamped once, here.
    const step = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), MAX_STEP_SECONDS);
    const swim = this.swimMotion.update(
      step,
      swimming,
      submerged,
      motion.speed,
      motion.footY,
      surfaceHeight,
    );
    this.body.rotation.x = swim.pitch;
    this.body.position.y = this.pivotHeight + swim.lift;
    this.body.updateWorldMatrix(true, false);
    const blend = this.locomotion.update(step, motion.speed, motion.grounded, swimming);
    this.footfall = this.footsteps.update(blend.phase, blend, motion.grounded && !swimming);
    this.footPlacement?.beginFrame();

    const { idle, walk, run } = this.actions;
    this.idleSeconds = (this.idleSeconds + step) % idle.getClip().duration;
    idle.time = this.idleSeconds;
    walk.time = ((blend.phase + this.walkOffset) % 1) * walk.getClip().duration;
    run.time = ((blend.phase + this.runOffset) % 1) * run.getClip().duration;
    idle.setEffectiveWeight(blend.idle);
    walk.setEffectiveWeight(blend.walk);
    run.setEffectiveWeight(blend.run);
    this.mixer.update(0);
    // Foot placement propagates the authored pose before sampling its feet.
    if (this.footPlacement) this.footPlacement.update(motion.grounded && !swimming, motion.footY, step);
    else this.model.updateMatrixWorld(true);
    this.swimStroke.apply(swim.weight, swim.stroke, swim.strokePhase, swim.treadPhase);
    this.castPose.apply(
      motion.cast,
      motion.castAimX,
      motion.castAimY,
      motion.castAimZ,
      motion.facing,
    );
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}
