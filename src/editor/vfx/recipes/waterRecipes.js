import { RAMP } from '../atlas/ParticleAtlasLayout.js';
import { blastWave, markGrass } from '../effects/groundPress.js';
import { launchProjectile } from '../effects/projectile.js';
import { addScaled, copy, onGround, UP } from '../effects/vec.js';

/**
 * Water magic. Both spells press the ground through the shared `press` path,
 * so where they land decides how they read: a ring wave on a lake (fast and
 * far in a desert oasis, swallowed at once in glacier slush), a shallow crater
 * in snow, sand or bog mud, flattened then greener grass in a meadow.
 */

/**
 * Tidal Orb: a wobbling globe of water arcs to the target and bursts into a
 * crown of spray, a foam ring and a wave that races out and sloshes back.
 */
export function tidalOrb(fx, ctx) {
  const from = copy(ctx.origin);
  fx.at(0, () => fx.sound('cast-water', from));
  let light = null;
  const orb = launchProjectile(fx, {
    from, to: copy(ctx.target), speed: 16, path: 'arc', arc: 0.18,
    onFrame: (position) => {
      if (!light) light = fx.light({ position, ramp: RAMP.FROST, intensity: 30, range: 7, attack: 0.3, hold: 60, decay: 8, follow: () => orb.position });
      // Several overlapping globes jittered each frame: the surface wobbles.
      fx.burst('water.orb', 4, { kind: 'sphere', center: position, radius: 0.18, speed: 0 });
      fx.burst('water.glow', 1, { kind: 'point', center: position });
      if (fx.random() < 0.6) fx.burst('water.drop', 1, { kind: 'sphere', center: position, radius: 0.3, speed: [0.2, 1.2] }, { sizeScale: 0.7 });
    },
    onArrive: (position) => {
      light?.release();
      fx.spawn('tidalOrbImpact', { ...ctx, target: copy(position) });
    },
  });
}

export function tidalOrbImpact(fx, ctx) {
  const ground = onGround(fx, ctx.target, 0);
  fx.at(0, () => {
    fx.sound('splash', ground, { size: 1.2 });
    fx.shake(0.1, ground, 8);
    // The crown: fat drops thrown up and out, and a column at its heart.
    fx.burst('water.drop', 90, { kind: 'ring', center: addScaled(ground, UP, 0.2), radius: 0.6, speed: [2, 4.5], lift: [4.5, 7.5] });
    fx.burst('water.drop', 70, { kind: 'cone', origin: addScaled(ground, UP, 0.2), direction: UP, angle: 0.25, speed: [6, 11] }, { sizeScale: 1.2 });
    fx.burst('water.drop', 120, { kind: 'sphere', center: addScaled(ground, UP, 0.3), radius: 0.4, speed: [3, 8], up: 0.9, hemisphere: true }, { sizeScale: 0.7 });
    fx.burst('water.spray', 12, { kind: 'disk', center: ground, radius: 1.6, ground: fx.groundHeight, height: [0.2, 1.2], lift: [0.6, 1.8], outward: [1, 3] });
    fx.burst('water.ring', 1, { kind: 'point', center: addScaled(ground, UP, 0.08) });
    fx.burst('water.splash', 6, { kind: 'disk', center: ground, radius: 1.2, ground: fx.groundHeight, height: 0.05 }, { sizeScale: 2.5 });
    fx.light({ position: addScaled(ground, UP, 1), ramp: RAMP.FROST, intensity: 120, range: 10, attack: 0.02, hold: 0.15, decay: 1.2 });
  });
  // The wave racing out, then the water sloshing back as a smaller one.
  blastWave(fx, ground, 6, 0.5);
  blastWave(fx, ground, 3, 0.45, 0.7);
  fx.at(0.7, () => fx.burst('water.ring', 1, { kind: 'point', center: addScaled(ground, UP, 0.08) }, { sizeScale: 0.55 }));
  // Soaked grass stands up greener.
  markGrass(fx, ground, 4, 'bloom', 0.6, 6, { strength: 0.8, grow: 1.5 });
  fx.stream('water.spray', 0.2, 1.4, (t) => 6 * (1 - t), { kind: 'disk', center: ground, radius: 2, ground: fx.groundHeight, height: 0.3, lift: [0.3, 0.9] });
}

/**
 * Rain Call: a heavy cloud gathers over the target and pours for a few
 * seconds. Every drop that lands presses the ground: rings stipple a pool,
 * pits pock sand and snow, and the grass greens.
 */
export function rainCall(fx, ctx) {
  const ground = onGround(fx, ctx.target, 0);
  const radius = 5;
  const cloud = addScaled(ground, UP, 9);
  const duration = 7;
  fx.at(0, () => {
    fx.sound('rain', ground, { duration });
    fx.burst('water.cloud', 26, { kind: 'disk', center: cloud, radius: radius * 1.2, height: [-0.6, 0.9], spread: 0.25 }, { anchor: cloud });
  });
  fx.stream('water.cloud', 0.4, duration - 1.2, 5, { kind: 'disk', center: cloud, radius: radius * 1.1, height: [-0.4, 0.6] }, { anchor: cloud, lifeScale: 0.8 });
  const pour = (t) => Math.min(1, t * 5, (1 - t) * 4);
  fx.stream('water.rain', 0.6, duration, (t) => 260 * pour(t), {
    kind: 'disk', center: addScaled(cloud, UP, -0.8), radius, height: [-0.3, 0.3], lift: [-7, -5], spread: 0.2,
  });
  // A drop landing every few hundredths of a second, each a press of its own.
  fx.every(0.9, duration - 0.2, 0.06, (index) => {
    const angle = fx.random() * Math.PI * 2;
    const reach = Math.sqrt(fx.random()) * radius;
    const at = { x: ground.x + Math.cos(angle) * reach, z: ground.z + Math.sin(angle) * reach };
    const time = 0.9 + index * 0.06;
    fx.press(time, time + 0.02, () => ({ x: at.x, z: at.z, radius: 0.3 + fx.random() * 0.2, strength: 0.55, inner: 0.15 }));
  });
  markGrass(fx, ground, radius, 'bloom', 1, duration, { strength: 0.7, grow: 3 });
}
