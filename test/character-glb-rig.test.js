import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { ArmCastPose } from '../src/editor/character/glb/ArmCastPose.js';
import { CharacterAnimator } from '../src/editor/character/glb/CharacterAnimator.js';
import { FootPlacement } from '../src/editor/character/glb/FootPlacement.js';
import { collectHumanoidBones } from '../src/editor/character/glb/humanoidRig.js';
import { measureFootLandings } from '../src/editor/character/glb/footLandings.js';
import { calibrateLocomotionClip } from '../src/editor/character/glb/locomotionCalibration.js';
import { createStandingClip } from '../src/editor/character/glb/standingPose.js';
import { createReachScratch, reachWithTwoBones } from '../src/editor/character/glb/twoBoneReach.js';

/**
 * A minimal humanoid on the Meshy bone names: legs and arms hang straight down
 * with a slight bend, like a relaxed bind pose, soles at y = 0.
 */
function createRig() {
  const bone = (name, x, y, z, parent) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent?.add(b);
    return b;
  };
  const model = new THREE.Group();
  const hips = bone('Hips', 0, 1, 0, null);
  model.add(hips);
  const spine = bone('Spine', 0, 0.3, 0, hips);
  bone('Head', 0, 0.35, 0, spine);
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const upLeg = bone(`${side}UpLeg`, 0.1 * sign, -0.05, 0, hips);
    const leg = bone(`${side}Leg`, 0, -0.42, 0.02, upLeg);
    const foot = bone(`${side}Foot`, 0, -0.43, -0.02, leg);
    bone(`${side}ToeBase`, 0, -0.08, 0.1, foot);
    const arm = bone(`${side}Arm`, 0.18 * sign, 0.12, 0, spine);
    const foreArm = bone(`${side}ForeArm`, 0.02 * sign, -0.28, -0.02, arm);
    bone(`${side}Hand`, 0, -0.26, 0.02, foreArm);
  }
  model.updateMatrixWorld(true);
  return { model, bones: collectHumanoidBones(model) };
}

function worldPosition(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

function worldY(object) {
  return worldPosition(object).y;
}

/**
 * One second of gait: each thigh swings fore and aft and its knee bends only
 * while that leg swings forward (left in the first half, right in the second),
 * so each foot lifts and lands once per cycle.
 */
function createWalkClip(name = 'Walking', hipsDrift = 0) {
  const times = [0, 0.25, 0.5, 0.75, 1];
  const swing = (angle) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray();
  const leftUpLeg = [0, -0.2, 0, 0.2, 0].flatMap(swing);
  const rightUpLeg = [0, 0.2, 0, -0.2, 0].flatMap(swing);
  const leftLeg = [0, 1, 0, 0, 0].flatMap(swing);
  const rightLeg = [0, 0, 0, 1, 0].flatMap(swing);
  const leftArm = [0, 0.3, 0, -0.3, 0].flatMap(swing);
  const hips = times.flatMap((t) => [0, 1, hipsDrift * t]);
  return new THREE.AnimationClip(name, 1, [
    new THREE.QuaternionKeyframeTrack('LeftUpLeg.quaternion', times, leftUpLeg),
    new THREE.QuaternionKeyframeTrack('RightUpLeg.quaternion', times, rightUpLeg),
    new THREE.QuaternionKeyframeTrack('LeftLeg.quaternion', times, leftLeg),
    new THREE.QuaternionKeyframeTrack('RightLeg.quaternion', times, rightLeg),
    new THREE.QuaternionKeyframeTrack('LeftArm.quaternion', times, leftArm),
    new THREE.VectorKeyframeTrack('Hips.position', times, hips),
  ]);
}

test('a rig missing a humanoid bone is rejected by name', () => {
  const { model, bones } = createRig();
  bones.left.hand.name = 'LeftPalm';
  assert.throws(() => collectHumanoidBones(model), /missing humanoid bones: LeftHand/);
});

test('two-bone reach lands the end on a reachable target', () => {
  const { bones } = createRig();
  const chain = { root: bones.left.upLeg, mid: bones.left.leg, end: bones.left.foot };
  const target = worldPosition(bones.left.foot).add(new THREE.Vector3(0.05, 0.15, 0.1));
  reachWithTwoBones(chain, target, new THREE.Vector3(1, 0, 0), createReachScratch());
  assert.ok(worldPosition(bones.left.foot).distanceTo(target) < 1e-3);
});

test('foot placement plants each ankle on its own ground across a slope', () => {
  const { model, bones } = createRig();
  const ankleHeight = worldY(bones.left.foot);
  const slope = 0.3;
  const terrain = { heightAt: (x) => slope * x };
  const placement = new FootPlacement(model, terrain, 1.8, bones, 0);
  for (let frame = 0; frame < 120; frame += 1) {
    placement.beginFrame();
    placement.update(true, 0, 1 / 60);
  }
  for (const foot of [bones.left.foot, bones.right.foot]) {
    const ankle = worldPosition(foot);
    assert.ok(Math.abs(ankle.y - (slope * ankle.x + ankleHeight)) < 2e-3, `ankle at ${ankle.y}`);
  }
  assert.ok(model.position.y < 0, 'the pelvis sinks so the downhill foot can reach');
});

test('foot placement lets go of the ground in the air', () => {
  const { model, bones } = createRig();
  const standing = worldY(bones.left.foot);
  const placement = new FootPlacement(model, { heightAt: (x) => 0.3 * x }, 1.8, bones, 0);
  for (let frame = 0; frame < 120; frame += 1) {
    placement.beginFrame();
    placement.update(false, 0, 1 / 60);
  }
  assert.ok(Math.abs(worldY(bones.left.foot) - standing) < 1e-6);
  assert.equal(model.position.y, 0);
});

test('in-place calibration removes net root drift but keeps the sway', () => {
  const clip = createWalkClip('Walking', 0.4);
  const calibrated = calibrateLocomotionClip(clip, { inPlace: true, nodes: ['Hips'], axes: ['x', 'z'] });
  assert.notEqual(calibrated, clip);
  const values = calibrated.tracks.find((track) => track.name === 'Hips.position').values;
  assert.ok(Math.abs(values[values.length - 1] - values[2]) < 1e-9, 'no net drift in z');
  assert.equal(values[values.length - 2], 1, 'height untouched');
  assert.equal(calibrateLocomotionClip(clip, { inPlace: false }), clip);
});

test('footfall measurement finds the left landing and leaves the rig as it was', () => {
  const { model, bones } = createRig();
  const before = bones.left.upLeg.quaternion.clone();
  const landings = measureFootLandings(model, createWalkClip(), {
    left: bones.left.foot,
    right: bones.right.foot,
  });
  assert.equal(landings.left.length, 1);
  assert.equal(landings.right.length, 1);
  // Each foot comes down at the end of its own swing half.
  assert.ok(landings.left[0] > 0.25 && landings.left[0] <= 0.5, `left lands at ${landings.left[0]}`);
  assert.ok(landings.right[0] > 0.75 && landings.right[0] <= 1, `right lands at ${landings.right[0]}`);
  assert.ok(bones.left.upLeg.quaternion.equals(before));
});

test('the standing clip averages the walk upper body and keeps the legs', () => {
  const { model, bones } = createRig();
  const clip = createStandingClip(model, createWalkClip());
  const arm = clip.tracks.find((track) => track.name === 'LeftArm.quaternion');
  // The walk swings the arm symmetrically about its bind rotation, so the mean
  // is that rotation; the standing clip adds only a few hundredths of breath.
  const first = new THREE.Quaternion().fromArray(arm.values, 0);
  assert.ok(first.angleTo(bones.left.arm.quaternion) < 0.05);
  const leg = clip.tracks.find((track) => track.name === 'LeftUpLeg.quaternion');
  assert.ok(new THREE.Quaternion().fromArray(leg.values, 0).angleTo(bones.left.upLeg.quaternion) < 1e-6);
});

test('the cast raises the leading hand along the aim, and does nothing at zero weight', () => {
  const { model, bones } = createRig();
  const pose = new ArmCastPose(bones);
  const resting = worldPosition(bones.right.hand);
  pose.apply(0, 0, 0, 1, 0);
  assert.ok(worldPosition(bones.right.hand).equals(resting));
  pose.apply(1, 0, 0.2, 1, 0);
  model.updateMatrixWorld(true);
  const casting = worldPosition(bones.right.hand);
  assert.ok(casting.z > resting.z + 0.2, 'reaches forward');
  assert.ok(casting.y > resting.y + 0.3, 'and up');
});

test('the animator blends the rig without letting the bind pose leak in', () => {
  const { model, bones } = createRig();
  const hero = {
    id: 'test',
    targetHeight: 1.8,
    clips: { idle: null, walk: 'Walking', run: 'Running' },
    clipSpeedInHeights: { walk: 0.85, run: 2.4 },
    rootMotion: { inPlace: true, nodes: ['Hips'], axes: ['x', 'z'] },
    locomotion: { maxTimeScale: 3.2, minTimeScale: 0.5, swimCadence: 0.55 },
    footPlacement: true,
  };
  const body = new THREE.Group();
  body.add(model);
  const animator = new CharacterAnimator({
    body,
    model,
    clips: [createWalkClip('Walking', 0.2), createWalkClip('Running', 0.2)],
    bones,
    hero,
    terrain: { heightAt: () => 0 },
    solesY: 0,
  });
  const motion = {
    speed: 9, grounded: true, footY: 0, facing: 0, cast: 0, castAimX: 0, castAimY: 0, castAimZ: 1,
  };
  for (let frame = 0; frame < 60; frame += 1) animator.update(1 / 60, motion, false);
  const { idle, walk, run } = animator.locomotion;
  assert.ok(run > 0.99 && Math.abs(idle + walk + run - 1) < 1e-9);
  assert.ok(Number.isFinite(worldY(bones.left.foot)));
  animator.dispose();
});

test('a clock that runs backwards or ground that cannot be sampled never poisons the pose', () => {
  const { model, bones } = createRig();
  let broken = false;
  const terrain = { heightAt: (x) => (broken ? Number.NaN : 0.3 * x) };
  const placement = new FootPlacement(model, terrain, 1.8, bones, 0);
  for (let frame = 0; frame < 30; frame += 1) {
    placement.beginFrame();
    placement.update(true, 0, 1 / 60);
  }
  for (const dt of [-5, Number.NaN, 1e9]) {
    placement.beginFrame();
    placement.update(true, 0, dt);
  }
  broken = true;
  for (let frame = 0; frame < 30; frame += 1) {
    placement.beginFrame();
    placement.update(true, 0, 1 / 60);
  }
  assert.ok(Number.isFinite(placement.drop));
  assert.ok(Number.isFinite(model.position.y));
  assert.ok(Number.isFinite(worldY(bones.left.foot)));
});

for (const footPlacement of [true, false]) {
  test(`consolidated rig transforms preserve poses and footfalls (foot placement ${footPlacement})`, () => {
    const create = () => {
      const { model, bones } = createRig();
      const group = new THREE.Group(), body = new THREE.Group();
      group.add(body); body.add(model);
      const samples = [];
      const terrain = { heightAt: (x, z) => { samples.push([x, z]); return x * 0.15 + z * 0.05; } };
      const animator = new CharacterAnimator({ body, model, bones, terrain, solesY: 0,
        clips: [createWalkClip('Walking', 0.2), createWalkClip('Running', 0.2)],
        hero: { id: 'test', targetHeight: 1.8, footPlacement,
          clips: { idle: null, walk: 'Walking', run: 'Running' },
          clipSpeedInHeights: { walk: 0.85, run: 2.4 },
          rootMotion: { inPlace: true, nodes: ['Hips'], axes: ['x', 'z'] },
          locomotion: { maxTimeScale: 3.2, minTimeScale: 0.5, swimCadence: 0.55 } },
      });
      const fixture = { group, body, model, animator, samples, visits: 0 };
      group.traverse(node => {
        const update = node.updateMatrixWorld.bind(node);
        node.updateMatrixWorld = force => { fixture.visits++; return update(force); };
      });
      return fixture;
    };
    const candidate = create(), reference = create();
    // Reinsert the previous full-tree passes at their original consumption points.
    const blend = reference.animator.locomotion.update.bind(reference.animator.locomotion);
    reference.animator.locomotion.update = (...args) => {
      reference.body.updateMatrixWorld(true);
      return blend(...args);
    };
    if (footPlacement) {
      const mix = reference.animator.mixer.update.bind(reference.animator.mixer);
      reference.animator.mixer.update = dt => { mix(dt); reference.model.updateMatrixWorld(true); };
    }
    try {
      for (let frame = 0; frame < 90; frame++) {
        const motion = { speed: frame < 10 ? 0 : frame < 30 ? 4 : 9,
          footY: frame * 0.01, grounded: frame < 40 || frame >= 70,
          facing: frame * 0.03, cast: frame % 20 < 10 ? 0.8 : 0,
          castAimX: 0.2, castAimY: 0.3, castAimZ: 1 };
        for (const fixture of [candidate, reference]) {
          fixture.samples.length = 0;
          fixture.group.position.set(frame * 0.05, motion.footY, frame * 0.1);
          fixture.group.rotation.y = motion.facing;
          if (fixture === reference) fixture.group.updateMatrixWorld(true);
          else fixture.group.updateWorldMatrix(true, false);
          fixture.animator.update(1 / 60, motion, frame >= 40 && frame < 70, frame >= 50 && frame < 60, 1);
          // The ordinary renderer propagates the final layered pose for drawing.
          fixture.group.updateMatrixWorld(true);
        }
        assert.deepEqual(candidate.samples, reference.samples, 'ground samples and solve order match');
        assert.equal(candidate.animator.footfall, reference.animator.footfall);
        const matrices = fixture => {
          const values = [];
          fixture.model.traverse(node => values.push(...node.matrixWorld.elements));
          return values;
        };
        const expected = matrices(reference);
        matrices(candidate).forEach((value, index) => {
          assert.ok(Math.abs(value - expected[index]) < 1e-10, `frame ${frame}, matrix value ${index}`);
        });
      }
      assert.ok(candidate.visits < reference.visits, 'pose parity uses fewer full-tree matrix visits');
    } finally {
      candidate.animator.dispose();
      reference.animator.dispose();
    }
  });
}
