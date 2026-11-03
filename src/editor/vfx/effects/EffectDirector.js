import { sampleRange } from '../math/vfxRandom.js';
import { createSpawnParams } from '../particles/ParticleSimulator.js';
import { placeOnShape } from './EmitterShapes.js';

/**
 * Runs effect timelines. A recipe is a function `(fx, ctx)` that schedules
 * work on `fx` — bursts, rate emitters, lights, decals, shake, sound, and
 * per-frame callbacks — relative to its own start. Timing is what sells an
 * effect, so recipes are code that reads like a cue sheet:
 *
 *   fx.at(0, () => fx.burst('flash', 1, { kind: 'point', center }));
 *   fx.during(0.02, 1.2, (t) => ...);
 */
export function createEffectDirector(services) {
  const { simulator, types } = services;
  const params = createSpawnParams();
  const effects = new Set();
  let clock = 0;

  const createFx = (effect) => {
    // Kept sorted, so events scheduled from inside other events still fire in order.
    const schedule = (time, run) => {
      const { events } = effect;
      let index = events.length;
      while (index > 0 && events[index - 1].time > time) index -= 1;
      events.splice(index, 0, { time, run });
      effect.until = Math.max(effect.until, time);
    };
    const fx = {
      /** Seconds since the effect started. */
      get time() {
        return clock - effect.start;
      },
      random: simulator.random,
      at(time, run) {
        schedule(time, run);
        return fx;
      },
      /** `run(t, dt, elapsed)` every frame in [start, end); t is 0..1 over the window. */
      during(start, end, run) {
        effect.ticks.push({ start, end, run });
        effect.until = Math.max(effect.until, end);
        return fx;
      },
      /** Repeats `run(i)` every `interval` seconds from `start` while before `end`. */
      every(start, end, interval, run) {
        let index = 0;
        for (let time = start; time < end; time += interval) {
          const current = index;
          schedule(time, () => run(current));
          index += 1;
        }
        return fx;
      },
      /**
       * Emits `count` particles of `typeId` on `shape`. `overrides` are
       * per-spawn multipliers: sizeScale, lifeScale, heatScale, emissiveScale,
       * opacityScale, tint [r,g,b], axis {x,y,z}, axisLength, anchor {x,y,z}.
       * Function-valued overrides are called with (index, params).
       */
      burst(typeId, count, shape, overrides = {}) {
        const typeIndex = types.indexOf(typeId);
        const total = Math.max(0, Math.round(sampleRange(count, simulator.random)));
        for (let index = 0; index < total; index += 1) {
          placeOnShape(shape, params, simulator.random, index, total);
          const { vx, vy, vz } = params;
          params.reset();
          params.vx = vx; params.vy = vy; params.vz = vz;
          applyOverrides(params, overrides, index, simulator.random);
          simulator.emit(typeIndex, params);
        }
        return fx;
      },
      /**
       * Continuous emission over [start, end). `rate` (per second) and
       * `shapeAt` may be functions of the window's normalised time.
       */
      stream(typeId, start, end, rate, shapeAt, overrides = {}) {
        let accumulator = 0;
        fx.during(start, end, (t, dt) => {
          accumulator += (typeof rate === 'function' ? rate(t) : rate) * dt;
          const whole = Math.floor(accumulator);
          if (whole <= 0) return;
          accumulator -= whole;
          const shape = typeof shapeAt === 'function' ? shapeAt(t) : shapeAt;
          fx.burst(typeId, whole, shape, overrides);
        });
        return fx;
      },
      light(spec) {
        return services.lights.acquire(spec);
      },
      decal(spec) {
        return services.decals.spawn(spec);
      },
      /** A floating mass of water (WaterBlobLayer); null where nothing draws one. */
      waterBlob(spec) {
        return services.blobs?.spawn(spec) ?? null;
      },
      shake(amount, origin, radius) {
        services.shake.add(amount, origin, services.getListener(), radius);
      },
      /**
       * Presses the grass down over [start, end): `discAt(t)` returns
       * { x, z, radius, strength, inner } for the window's normalised time.
       * A growing radius makes a blast wave; a steady one keeps a scorch,
       * puddle or rune visible in a meadow.
       */
      press(start, end, discAt, interval = 0) {
        if (!services.pressGround) return fx;
        fx.during(start, end, throttled(interval, (t) => {
          const disc = discAt(t);
          if (disc && disc.radius > 0 && disc.strength > 0) {
            services.pressGround(disc.x, disc.z, disc.radius, disc.strength, disc.inner ?? 0.6);
          }
        }));
        return fx;
      },
      /**
       * Marks the grass over [start, end): `discAt(t)` returns
       * { x, z, radius, strength, inner } and `mark` names what the spell left —
       * 'scorch', 'singe', 'wither', 'frost', 'acid', 'moon', 'bloom', 'sickly'.
       * Stamped every `interval` seconds (every frame at 0); the meadow fades
       * it on its own once the window ends.
       */
      mark(start, end, mark, discAt, interval = 0) {
        if (!services.markGround) return fx;
        fx.during(start, end, throttled(interval, (t) => {
          const disc = discAt(t);
          if (disc && disc.radius > 0 && disc.strength > 0) {
            services.markGround(disc.x, disc.z, disc.radius, mark, disc.strength, disc.inner ?? 0.5);
          }
        }));
        return fx;
      },
      sound(name, origin, options) {
        services.sound?.play(name, origin, options);
      },
      /** Starts another recipe at `time`, e.g. impacts spawned by a projectile. */
      spawn(recipeId, context, time = fx.time) {
        schedule(time, () => services.play(recipeId, context));
        return fx;
      },
      groundHeight: services.groundHeight,
      /** The camera's position this frame (the audio listener), for view-dependent placement. */
      get camera() {
        return services.getListener();
      },
      /** Effects can extend their own life (lingering clouds, walls). */
      keepAliveUntil(time) {
        effect.until = Math.max(effect.until, time);
      },
    };
    return fx;
  };

  const play = (recipe, context) => {
    const effect = { start: clock, events: [], ticks: [], until: 0, origin: context };
    const fx = createFx(effect);
    recipe(fx, context);
    effects.add(effect);
    return effect;
  };

  const update = (dt) => {
    clock += dt;
    for (const effect of effects) {
      const elapsed = clock - effect.start;
      while (effect.events.length > 0 && effect.events[0].time <= elapsed) {
        effect.events.shift().run();
      }
      for (const tick of effect.ticks) {
        if (elapsed < tick.start || elapsed >= tick.end + dt) continue;
        const local = Math.min(elapsed, tick.end) - tick.start;
        tick.run(local / Math.max(1e-6, tick.end - tick.start), dt, local);
      }
      if (elapsed > effect.until + dt && effect.events.length === 0) effects.delete(effect);
    }
  };

  return {
    play,
    update,
    get activeCount() {
      return effects.size;
    },
    clear() {
      effects.clear();
    },
  };
}

/** A `during` callback run on its first frame and then at most every `interval` seconds. */
function throttled(interval, run) {
  if (!(interval > 0)) return run;
  let since = Infinity;
  return (t, dt, elapsed) => {
    since += dt;
    if (since < interval) return;
    since = 0;
    run(t, dt, elapsed);
  };
}

function applyOverrides(params, overrides, index, random) {
  for (const key in overrides) {
    let value = overrides[key];
    if (typeof value === 'function') value = value(index, params, random);
    if (value === undefined || value === null) continue;
    switch (key) {
      case 'tint':
        params.tintR = value[0]; params.tintG = value[1]; params.tintB = value[2];
        break;
      case 'axis':
        params.axisX = value.x; params.axisY = value.y; params.axisZ = value.z;
        break;
      case 'anchor':
        params.anchorX = value.x; params.anchorY = value.y; params.anchorZ = value.z;
        break;
      case 'velocityScale':
        params.vx *= value; params.vy *= value; params.vz *= value;
        break;
      case 'addVelocity':
        params.vx += value.x; params.vy += value.y; params.vz += value.z;
        break;
      default:
        params[key] = Array.isArray(value) ? sampleRange(value, random) : value;
    }
  }
}
