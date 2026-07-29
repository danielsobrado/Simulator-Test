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
    turnAmplitude: wildlifeRange(seed, eventIndex, 11, 0.12, 0.28),
    turnCycles: wildlifeRange(seed, eventIndex, 12, 0.65, 1.3),
    turnPhase: wildlifeRandom01(seed, eventIndex, 13) * Math.PI * 2,
    radiusWander: wildlifeRange(seed, eventIndex, 14, 0.04, 0.1),
  });
}

export function sampleOrbitFlight(plan, progress) {
  const t = Math.min(1, Math.max(0, progress));
  const turnRate = plan.turnCycles * Math.PI * 2;
  const turnPhase = plan.turnPhase + t * turnRate;
  const angle = plan.startAngle + plan.arc * t
    + Math.sin(turnPhase) * plan.turnAmplitude;
  const angleDerivative = plan.arc
    + Math.cos(turnPhase) * plan.turnAmplitude * turnRate;
  const radialPhase = plan.turnPhase * 0.73 + t * turnRate * 0.61;
  const radialPulse = 1
    + Math.sin(t * Math.PI) * 0.12
    + Math.sin(radialPhase) * plan.radiusWander;
  const radialDerivative = Math.cos(t * Math.PI) * Math.PI * 0.12
    + Math.cos(radialPhase) * plan.radiusWander * turnRate * 0.61;
  const radius = plan.radius * radialPulse;
  const radiusDerivative = plan.radius * radialDerivative;
  const velocityX = Math.cos(angle) * radiusDerivative
    - Math.sin(angle) * radius * angleDerivative;
  const velocityZ = Math.sin(angle) * radiusDerivative
    + Math.cos(angle) * radius * angleDerivative;
  const speed = Math.hypot(velocityX, velocityZ) || 1;
  return Object.freeze({
    x: plan.centerX + Math.cos(angle) * radius,
    y: plan.baseY + Math.sin(t * Math.PI * 2 + plan.bobPhase) * 0.8,
    z: plan.centerZ + Math.sin(angle) * radius,
    tangentX: velocityX / speed,
    tangentZ: velocityZ / speed,
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
    flapRate: wildlifeRange(seed, eventIndex, 120 + index, 2.2, 3.4),
    glideCycle: wildlifeRange(seed, eventIndex, 140 + index, 4.5, 7.5),
    glidePhase: wildlifeRandom01(seed, eventIndex, 160 + index) * Math.PI * 2,
    glideThreshold: wildlifeRange(seed, eventIndex, 180 + index, 0.3, 0.48),
  })));
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Returns a signed wing pose: -1 is the bottom of a downstroke, 0 is a flat
 * glide, and 1 is the top of an upstroke. A smooth burst envelope leaves long,
 * genuinely flat glide intervals instead of merely slowing the flap.
 */
export function sampleWingFlap(member, elapsedSeconds) {
  const glideAngle = elapsedSeconds / member.glideCycle * Math.PI * 2 + member.glidePhase;
  const burstEnvelope = smoothstep(
    member.glideThreshold,
    Math.min(0.9, member.glideThreshold + 0.18),
    0.5 + Math.cos(glideAngle) * 0.5,
  );
  return Math.sin(elapsedSeconds * member.flapRate * Math.PI * 2 + member.phase)
    * burstEnvelope;
}
