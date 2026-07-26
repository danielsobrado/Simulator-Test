import { scatterRandom01 } from './scatterMath.js';

export function wildlifeRandom01(seed, eventIndex, channel) {
  return scatterRandom01(seed | 0, eventIndex | 0, eventIndex, channel);
}

export function wildlifeRange(seed, eventIndex, channel, minimum, maximum) {
  return minimum + wildlifeRandom01(seed, eventIndex, channel) * (maximum - minimum);
}

export function wildlifeDelaySeconds(config, seed, eventIndex, initial = false) {
  const minimum = initial ? config.initialDelayMin : config.intervalMin;
  const maximum = initial ? config.initialDelayMax : config.intervalMax;
  return wildlifeRange(seed, eventIndex, initial ? 1 : 2, minimum, maximum);
}

export function chooseWeightedWildlife(definitions, roll) {
  const total = definitions.reduce((sum, definition) => sum + definition.weight, 0);
  let target = Math.min(1 - Number.EPSILON, Math.max(0, roll)) * total;
  for (const definition of definitions) {
    target -= definition.weight;
    if (target < 0) return definition;
  }
  return definitions[definitions.length - 1] ?? null;
}

export function createOrbitFlightPlan({
  seed,
  eventIndex,
  centerX,
  centerZ,
  baseY,
  config,
}) {
  const radius = wildlifeRange(seed, eventIndex, 3, config.radiusMin, config.radiusMax);
  const direction = wildlifeRandom01(seed, eventIndex, 4) < 0.5 ? -1 : 1;
  return Object.freeze({
    centerX,
    centerZ,
    baseY: baseY + wildlifeRange(
      seed,
      eventIndex,
      5,
      config.altitudeMin,
      config.altitudeMax,
    ),
    radius,
    startAngle: wildlifeRandom01(seed, eventIndex, 6) * Math.PI * 2,
    arc: wildlifeRange(seed, eventIndex, 7, Math.PI * 0.8, Math.PI * 1.65) * direction,
    durationSeconds: wildlifeRange(
      seed,
      eventIndex,
      8,
      config.durationMin,
      config.durationMax,
    ),
    bobPhase: wildlifeRandom01(seed, eventIndex, 9) * Math.PI * 2,
  });
}

export function sampleOrbitFlight(plan, progress) {
  const t = Math.min(1, Math.max(0, progress));
  const angle = plan.startAngle + plan.arc * t;
  const radialPulse = 1 + Math.sin(t * Math.PI) * 0.12;
  const radius = plan.radius * radialPulse;
  const angularDirection = Math.sign(plan.arc) || 1;
  return Object.freeze({
    x: plan.centerX + Math.cos(angle) * radius,
    y: plan.baseY + Math.sin(t * Math.PI * 2 + plan.bobPhase) * 0.8,
    z: plan.centerZ + Math.sin(angle) * radius,
    tangentX: -Math.sin(angle) * angularDirection,
    tangentZ: Math.cos(angle) * angularDirection,
  });
}

export function createFlockMembers({ seed, eventIndex, count }) {
  return Object.freeze(Array.from({ length: count }, (_value, index) => Object.freeze({
    along: -index * wildlifeRange(seed, eventIndex, 20 + index, 2.2, 4.2),
    side: (index === 0 ? 0 : (index % 2 === 0 ? -1 : 1))
      * wildlifeRange(seed, eventIndex, 40 + index, 1.5, 4.5),
    height: wildlifeRange(seed, eventIndex, 60 + index, -1.2, 1.2),
    scale: wildlifeRange(seed, eventIndex, 80 + index, 0.82, 1.18),
    phase: wildlifeRandom01(seed, eventIndex, 100 + index) * Math.PI * 2,
  })));
}
