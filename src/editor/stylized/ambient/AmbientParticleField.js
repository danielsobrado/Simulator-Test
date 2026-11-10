import { frameUniform } from '../../../render/FrameUniforms.js';
import * as THREE from 'three/webgpu';
import {
  abs, cameraPosition, cameraWorldMatrix, color, cos, cross, dot, float, floor, fract, hash,
  instanceIndex, max, mix, normalize, positionGeometry, positionWorld, sin, smoothstep, time as globalTime,
  uv, vec2, vec3,
} from 'three/tsl';

import { ambientParticleShapeAlpha } from './AmbientParticleShapes.js';
import { particleWaterDepthMask } from './ParticleWaterDepth.js';
import { stylizedFbm2 } from '../StylizedNoiseNodes.js';
import { particleBurstNodes } from './ParticleBurst.js';
import { waterVisualClock } from '../../water/WaterVisualClock.js';

const TWO_PI = Math.PI * 2;
/** Below this a field is not drawn at all. */
export const FIELD_VISIBILITY_THRESHOLD = 0.004;
/** Particles whose weight falls below this collapse to a point: vertex work only. */
const PARTICLE_CUTOFF = 0.003;
/** Fraction of the half-area over which particles fade before wrapping across. */
const EDGE_FADE_START = 0.36;
const HASH_OFFSETS = Object.freeze({
  x: 11.31, z: 57.17, y: 23.93, size: 91.71, phase: 131.07, speed: 171.39, tone: 211.53, variant: 251.9,
  jitterX: 293.1, jitterY: 331.7, jitterZ: 373.3, blink: 419.9,
  rotation: 463.3, aspect: 503.7,
});
/** Cornette-Shanks forward-scatter asymmetry, as the waterfall mist uses. */
const MIE_G = 0.6;
/** Sunlight a particle takes regardless of view: lit from every side. */
const SUN_BASE = 0.75;
const SKY_GAIN = 0.55;

/**
 * Per-particle region masks, so a field straddling a border (spray over the
 * sea meeting the beach, sand meeting the meadow) only shows on its own side.
 * They read the ground under the particle against the water levels; regions
 * with no such boundary (snow, jungle, meadow, water, any) are the CPU's alone.
 */
function regionMask(regions, ground, levels) {
  let mask = null;
  const add = (node) => { mask = mask ? max(mask, node) : node; };
  for (const region of regions) {
    if (region === 'surf') {
      add(smoothstep(levels.sea.add(0.4), levels.sea.sub(0.4), ground));
    } else if (region === 'sand') {
      const beach = smoothstep(levels.sea.sub(0.3), levels.sea.add(0.2), ground)
        .mul(smoothstep(levels.sea.add(7), levels.sea.add(3), ground));
      add(max(beach, levels.desert));
    } else if (region === 'lake') {
      add(smoothstep(levels.lake.add(0.3), levels.lake.sub(0.3), ground));
    } else {
      add(float(1));
    }
  }
  return mask ?? float(1);
}

/** Value noise in [-1, 1], as grass-test's gust and shaft terms expect. */
function signedNoise(point) {
  return stylizedFbm2(point).mul(2).sub(1);
}

function cornetteShanks(mu) {
  const g2 = MIE_G * MIE_G;
  return mu.mul(mu).add(1).mul((3 / (8 * Math.PI)) * (1 - g2) / (2 + g2))
    .div(mu.mul(-2 * MIE_G).add(1 + g2).pow(1.5));
}


/**
 * One ambient particle population (after grass-test's AmbientParticleField),
 * drawn in one instanced call and animated wholly on the GPU from the instance
 * index and time. Particles tile the world around the focus: each has a fixed
 * place on a toroidal grid `area` metres wide that the wind slides along, so
 * they stay put while the player walks through them, and fade near the
 * field's edge before wrapping across.
 *
 * `levels` holds live uniforms: `sea` and `lake` water heights and `desert`,
 * the share of hot desert around the focus (inland sand). `ground` is a
 * LocalGroundHeight. `light` is { sun, sky } colour uniforms and `sun` the sun
 * direction node.
 */
export class AmbientParticleField {
  constructor({ name, settings, ground, levels, light, sun, puffTexture = null, clock = null }) {
    this.name = name;
    this.settings = settings;
    this.clock = clock ?? (settings.burst && settings.waterDepth ? waterVisualClock : globalTime);
    this.intensity = frameUniform(0);
    this.current = 0;
    this.target = 0;
    this.center = frameUniform(new THREE.Vector3());
    /** fract((drift - center) / area + 0.5), computed in doubles on the CPU. */
    this.wrap = frameUniform(new THREE.Vector2());
    this.windAxis = frameUniform(new THREE.Vector3(1, 0, 0));
    this.drift = { x: 0, z: 0 };
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.material = this.createMaterial({ ground, levels, light, sun, puffTexture });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, settings.count);
    this.mesh.name = `ambient-${name}`;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    // Every particle is placed by positionNode; instance transforms stay identity.
    const identity = new THREE.Matrix4();
    for (let index = 0; index < settings.count; index += 1) this.mesh.setMatrixAt(index, identity);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  levelNode(name, levels) {
    if (name === 'sea') return levels.sea;
    if (name === 'lake') return levels.lake;
    return float(name);
  }

  createMaterial({ ground, levels, light, sun, puffTexture }) {
    const s = this.settings;
    const time = this.clock;
    const index = instanceIndex.toFloat();
    // Swarms share their placement; each member jitters around it.
    const group = s.swarm ? floor(index.div(s.swarm.members)) : index;
    const random = (key, source = index) => hash(source.add(HASH_OFFSETS[key]));
    const seedPhase = random('phase');
    const seedSpeed = random('speed');

    const area = float(s.area);
    const relX = fract(random('x', group).add(this.wrap.x)).sub(0.5);
    const relZ = fract(random('z', group).add(this.wrap.y)).sub(0.5);
    const edge = max(abs(relX), abs(relZ)).mul(2);
    const edgeFade = smoothstep(EDGE_FADE_START * 2, 1, edge).oneMinus();

    // Slow wander, on its own phase per particle so they never move as a lattice.
    const wanderRate = time.mul(s.wander.frequency).mul(seedSpeed.mul(0.6).add(0.7));
    let x = this.center.x.add(relX.mul(area)).add(sin(wanderRate.add(seedPhase.mul(TWO_PI))).mul(s.wander.radius));
    let z = this.center.z.add(relZ.mul(area))
      .add(cos(wanderRate.mul(0.83).add(seedPhase.mul(TWO_PI * 1.7))).mul(s.wander.radius));
    let jitterY = float(0);
    if (s.swarm) {
      const jitterRate = time.mul(s.swarm.frequency);
      const spread = float(s.swarm.radius);
      x = x.add(sin(jitterRate.mul(random('jitterX').add(0.6)).add(random('jitterZ').mul(TWO_PI))).mul(spread)
        .mul(random('jitterY').mul(0.7).add(0.3)));
      z = z.add(cos(jitterRate.mul(random('jitterZ').add(0.55)).add(random('jitterX').mul(TWO_PI))).mul(spread)
        .mul(random('jitterX').mul(0.7).add(0.3)));
      jitterY = sin(jitterRate.mul(random('jitterY').add(0.8)).add(seedPhase.mul(TWO_PI))).mul(s.swarm.radius * 0.6);
    }

    // Saltation: each blown grain skips downwind in its own short arc, at its
    // own speed and a slightly different heading, most close to the ground.
    let particleAxis = this.windAxis;
    let hopArc = null;
    let hopFade = float(1);
    if (s.hop) {
      const heading = random('variant').sub(0.5).mul(s.hop.spread * Math.PI / 180);
      const c = cos(heading);
      const n = sin(heading);
      const flat = vec3(this.windAxis.x.mul(c).sub(this.windAxis.z.mul(n)), 0, this.windAxis.x.mul(n).add(this.windAxis.z.mul(c)));
      const phase = fract(time.mul(mix(float(0.6), float(1.5), seedSpeed).mul(s.hop.rate)).add(seedPhase));
      const hopLength = mix(float(0.5), float(1.4), random('tone')).mul(s.hop.length);
      const along = phase.sub(0.5).mul(hopLength);
      x = x.add(flat.x.mul(along));
      z = z.add(flat.z.mul(along));
      const peak = random('y', group).pow(3).mul(s.height[1] - s.height[0]);
      hopArc = sin(phase.mul(Math.PI)).mul(peak);
      hopFade = smoothstep(0, 0.12, phase).mul(smoothstep(0.82, 1, phase).oneMinus());
      const climb = cos(phase.mul(Math.PI)).mul(peak).mul(Math.PI).div(hopLength.max(0.01));
      particleAxis = normalize(vec3(flat.x, climb, flat.z));
    }

    const groundHeight = ground.heightNode(x, z);
    let base;
    if (s.base === 'focus') base = this.center.y;
    else if (s.base === 'ground') base = s.floor === null ? groundHeight : max(groundHeight, this.levelNode(s.floor, levels));
    else base = this.levelNode(s.base, levels);

    const range = Math.max(s.height[1] - s.height[0], 1e-3);
    const seedY = random('y', group);
    const burst = s.burst ? particleBurstNodes(time, seedPhase, seedSpeed,
      mix(range * 0.25, range, seedY), s.burst) : null;
    let height;
    let verticalFade = hopFade;
    if (burst) {
      height = burst.height;
      verticalFade = burst.fade;
    } else if (hopArc) {
      height = hopArc;
    } else if (s.rise !== 0) {
      const speed = mix(float(0.6), float(1.4), seedSpeed).mul(s.rise / range);
      const t = fract(seedY.add(time.mul(speed)));
      height = t.mul(range);
      verticalFade = smoothstep(0, 0.1, t).mul(smoothstep(0.9, 1, t).oneMinus());
    } else {
      height = seedY.mul(range).add(sin(wanderRate.mul(0.6).add(seedPhase.mul(9))).mul(s.wander.radius * 0.4));
    }
    const y = base.add(s.height[0]).add(height).add(jitterY);
    const center = vec3(x, y, z);

    let weight = regionMask(s.regions, groundHeight, levels).mul(edgeFade).mul(verticalFade).mul(this.intensity);
    if (s.waterDepth) {
      weight = weight.mul(particleWaterDepthMask(this.levelNode(s.base, levels).sub(groundHeight), s.waterDepth));
    }
    if (s.gusts) {
      // Gust patches sweep downwind: the surface lifts in waves, not evenly.
      const drift = vec2(this.windAxis.x, this.windAxis.z).mul(time.mul(s.gusts.speed));
      const point = vec2(x, z).sub(drift).mul(s.gusts.scale);
      const gust = signedNoise(point).add(signedNoise(point.mul(2.3).add(vec2(5.1, -2.7))).mul(0.4));
      weight = weight.mul(smoothstep(s.gusts.threshold, s.gusts.threshold + 0.35, gust));
    }
    const size = mix(float(s.size[0]), float(s.size[1]), random('size'))
      .mul(burst?.scale ?? 1)
      .mul(weight.greaterThan(PARTICLE_CUTOFF).select(float(1), float(0)));

    const toParticle = center.sub(cameraPosition);
    const view = normalize(toParticle);
    let offset;
    if (s.shape === 'streak' || s.shape === 'shaft') {
      // Turned about its own axis to face the camera: along the wind for a
      // streak, along the sun's rays for a shaft.
      const axis = s.shape === 'shaft' ? sun : particleAxis;
      const side = normalize(cross(axis, view).add(cameraWorldMatrix.element(1).xyz.mul(1e-3)));
      if (s.shape === 'shaft') {
        offset = axis.mul(positionGeometry.y.add(0.5).mul(s.length)).add(side.mul(positionGeometry.x.mul(size)));
      } else {
        offset = axis.mul(positionGeometry.x.mul(size).mul(s.stretch)).add(side.mul(positionGeometry.y.mul(size)));
      }
    } else {
      const right = cameraWorldMatrix.element(0).xyz;
      const up = cameraWorldMatrix.element(1).xyz;
      let horizontal = positionGeometry.x.mul(size), vertical = positionGeometry.y.mul(size);
      if (s.shape === 'puff') {
        // Preserve quad area while varying silhouette and orientation per puff.
        const aspect = mix(float(0.65), float(1.35), random('aspect'));
        const angle = random('rotation').mul(TWO_PI), c = cos(angle), n = sin(angle);
        const x = horizontal.mul(aspect), y = vertical.div(aspect);
        horizontal = x.mul(c).sub(y.mul(n)); vertical = x.mul(n).add(y.mul(c));
      }
      offset = right.mul(horizontal).add(up.mul(vertical));
    }

    const additive = s.blending === 'additive';
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    material.name = `ambient-${this.name}`;
    // Scene fog would add its colour to an additive particle; those fade with distance themselves.
    material.fog = !additive;
    material.positionNode = center.add(offset);

    const local = uv().sub(0.5).mul(2);
    let alpha = ambientParticleShapeAlpha(s.shape, local, random('variant'), puffTexture, burst?.erosion);
    const distance = cameraPosition.distance(positionWorld);
    alpha = alpha.mul(smoothstep(s.nearFade, s.nearFade * 3, distance));
    if (additive) alpha = alpha.mul(smoothstep(s.area * 0.3, s.area * 0.5, distance).oneMinus());
    if (s.soft > 0 && s.base !== 'focus') {
      // Fade where the quad meets the ground or water, so no billboard shows a cut line.
      alpha = alpha.mul(smoothstep(0, s.soft, positionWorld.y.sub(base)));
    }
    if (s.blink) {
      const pulse = sin(time.mul(s.blink.rate).mul(random('blink').mul(0.8).add(0.6)).add(seedPhase.mul(TWO_PI)))
        .mul(0.5).add(0.5);
      alpha = alpha.mul(pulse.pow(s.blink.sharpness));
    }
    if (s.twinkle > 0) {
      const flash = sin(time.mul(s.twinkle).mul(seedSpeed.add(0.5)).add(seedPhase.mul(TWO_PI))).mul(0.5).add(0.5);
      alpha = alpha.mul(flash.pow(6).mul(0.85).add(0.15));
    }

    const tone = mix(float(1 - s.toneVariation), float(1 + s.toneVariation), random('tone'));
    const albedo = color(s.color).mul(tone).mul(s.brightness);
    // mu is 1 looking straight into the sun.
    const mu = dot(normalize(positionWorld.sub(cameraPosition)), sun);
    const phase = cornetteShanks(mu);
    if (s.backlit < 1) alpha = alpha.mul(mix(float(s.backlit), float(1), phase.div(cornetteShanks(float(1))).clamp(0, 1)));

    if (s.lighting === 'emissive') {
      material.colorNode = albedo.mul(s.emissive);
    } else {
      material.colorNode = albedo.mul(light.sun.mul(phase.mul(s.scatter).add(SUN_BASE)).add(light.sky.mul(SKY_GAIN)));
    }
    material.opacityNode = alpha.mul(s.opacity).mul(weight);
    return material;
  }

  setCount(count) {
    this.mesh.count = Math.max(1, Math.min(this.settings.count, Math.round(count)));
  }

  setIntensity(value) {
    const next = Math.max(0, Math.min(1, Number(value) || 0));
    this.current = next < FIELD_VISIBILITY_THRESHOLD ? 0 : next;
    this.intensity.value = this.current;
    this.mesh.visible = this.current > 0;
  }

  /**
   * @param {number} delta seconds
   * @param {{ x: number, y: number, z: number }} focus render space
   * @param {{ x: number, z: number }} wind drift velocity, m/s
   */
  update(delta, focus, wind) {
    const area = this.settings.area;
    this.drift.x = (this.drift.x + wind.x * delta) % area;
    this.drift.z = (this.drift.z + wind.z * delta) % area;
    this.center.value.set(focus.x, focus.y, focus.z);
    const wrapX = (this.drift.x - focus.x) / area + 0.5;
    const wrapZ = (this.drift.z - focus.z) / area + 0.5;
    this.wrap.value.set(wrapX - Math.floor(wrapX), wrapZ - Math.floor(wrapZ));
    const length = Math.hypot(wind.x, wind.z);
    if (length > 1e-4) this.windAxis.value.set(wind.x / length, 0, wind.z / length);
  }

  /** Keep the particles where they are in the world when the floating origin moves. */
  shiftWorld(shiftX, shiftZ) {
    this.drift.x -= shiftX;
    this.drift.z -= shiftZ;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
