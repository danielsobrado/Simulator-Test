export const WATER_ACCEPTANCE_SCENARIO_ID = 'water-acceptance';

const DIRECTIONS = Object.freeze([
  Object.freeze({ x: 1, z: 0 }),
  Object.freeze({ x: -1, z: 0 }),
  Object.freeze({ x: 0, z: 1 }),
  Object.freeze({ x: 0, z: -1 }),
  Object.freeze({ x: Math.SQRT1_2, z: Math.SQRT1_2 }),
  Object.freeze({ x: -Math.SQRT1_2, z: Math.SQRT1_2 }),
  Object.freeze({ x: Math.SQRT1_2, z: -Math.SQRT1_2 }),
  Object.freeze({ x: -Math.SQRT1_2, z: -Math.SQRT1_2 }),
]);

const DEFAULT_ROUTE_OPTIONS = Object.freeze({
  searchRadius: 192,
  sampleStep: 4,
  minimumCoverage: 0.8,
  minimumDepth: 2.2,
  maximumDryDistance: 20,
  dryRunup: 2,
  routeSampleStep: 1,
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function isWet(sample, options) {
  return sample?.coverage >= options.minimumCoverage
    && sample?.depth >= options.minimumDepth
    && Number.isFinite(sample.surfaceHeight)
    && Number.isFinite(sample.bedHeight);
}

function isDry(sample) {
  return !sample || sample.coverage <= 0.05;
}

function yawDegreesForVector(x, z) {
  return Math.atan2(-x, -z) * 180 / Math.PI;
}

function candidateOffsets(radius, step) {
  const result = [];
  for (let z = -radius; z <= radius; z += step) {
    for (let x = -radius; x <= radius; x += step) {
      const distanceSquared = x * x + z * z;
      if (distanceSquared > radius * radius) continue;
      result.push({ x, z, distanceSquared });
    }
  }
  result.sort((left, right) => (
    left.distanceSquared - right.distanceSquared
      || left.z - right.z
      || left.x - right.x
  ));
  return result;
}

function validateRoute({ start, target, getWaterSample, getGroundHeight, options }) {
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const distance = Math.hypot(dx, dz);
  const samples = Math.max(2, Math.ceil(distance / options.routeSampleStep));
  let sawDry = false;
  let sawWet = false;
  let lastGround = null;

  for (let index = 0; index <= samples; index += 1) {
    const ratio = index / samples;
    const x = start.x + dx * ratio;
    const z = start.z + dz * ratio;
    const water = getWaterSample(x, z);
    const ground = getGroundHeight(x, z);
    if (!Number.isFinite(ground)) return false;
    if (lastGround !== null && Math.abs(ground - lastGround) > 6) return false;
    lastGround = ground;
    if (isDry(water)) sawDry = true;
    if (water?.coverage >= options.minimumCoverage) sawWet = true;
  }
  return sawDry && sawWet;
}

export function findWaterAcceptanceRoute({
  getWaterSample,
  getGroundHeight,
  origin = { x: 0, z: 0 },
  ...overrides
}) {
  if (typeof getWaterSample !== 'function' || typeof getGroundHeight !== 'function') {
    throw new Error('Water acceptance route requires water and terrain samplers.');
  }
  const options = { ...DEFAULT_ROUTE_OPTIONS, ...overrides };
  const offsets = candidateOffsets(options.searchRadius, options.sampleStep);

  for (const offset of offsets) {
    const target = { x: origin.x + offset.x, z: origin.z + offset.z };
    const targetWater = getWaterSample(target.x, target.z);
    if (!isWet(targetWater, options)) continue;

    for (const direction of DIRECTIONS) {
      for (
        let distance = options.sampleStep;
        distance <= options.maximumDryDistance;
        distance += options.sampleStep
      ) {
        const shorelineDry = {
          x: target.x + direction.x * distance,
          z: target.z + direction.z * distance,
        };
        if (!isDry(getWaterSample(shorelineDry.x, shorelineDry.z))) continue;
        const start = {
          x: shorelineDry.x + direction.x * options.dryRunup,
          z: shorelineDry.z + direction.z * options.dryRunup,
        };
        if (!isDry(getWaterSample(start.x, start.z))) continue;
        if (!validateRoute({ start, target, getWaterSample, getGroundHeight, options })) continue;

        const travelX = target.x - start.x;
        const travelZ = target.z - start.z;
        return Object.freeze({
          start: Object.freeze(start),
          target: Object.freeze(target),
          yawDegrees: yawDegreesForVector(travelX, travelZ),
          distance: Math.hypot(travelX, travelZ),
          bodyId: targetWater.bodyId ?? null,
          kind: targetWater.kind ?? 0,
          surfaceHeight: targetWater.surfaceHeight,
          targetDepth: targetWater.depth,
        });
      }
    }
  }
  return null;
}

export class WaterAcceptanceTracker {
  constructor({ route = null, qualityTier = 'high' } = {}) {
    this.route = route;
    this.qualityTier = qualityTier;
    this.states = new Set();
    this.bodyIds = new Set();
    this.transitions = [];
    this.frameCount = 0;
    this.wetFrames = 0;
    this.submergedFrames = 0;
    this.maxDepth = 0;
    this.maxUnderwaterBlend = 0;
    this.maxProjectedCausticCpuMs = 0;
    this.projectedCausticFrames = 0;
    this.originSnapCount = 0;
    this.originSnapViolations = 0;
    this.lastState = null;
    this.lastBodyId = null;
    this.lastDepth = null;
    this.hasBeenWet = false;
    this.hasBeenSubmerged = false;
    this.surfacedAfterSubmerge = false;
    this.returnedDry = false;
  }

  observe({ player, counters = {}, phaseId = null, originSnap = false }) {
    if (!player) return;
    this.frameCount += 1;
    const state = player.waterState ?? 'dry';
    const depth = Math.max(0, finite(player.waterDepth));
    const bodyId = player.waterBodyId ?? null;
    const wet = state !== 'dry' || depth > 0.01;
    const submerged = Boolean(player.headSubmerged) || state === 'submerged';
    const underwaterBlend = Math.max(0, Math.min(1, finite(player.underwaterBlend)));

    this.states.add(state);
    if (wet) {
      this.wetFrames += 1;
      this.hasBeenWet = true;
      if (bodyId !== null) this.bodyIds.add(bodyId);
    }
    if (submerged) {
      this.submergedFrames += 1;
      this.hasBeenSubmerged = true;
    } else if (this.hasBeenSubmerged && wet) {
      this.surfacedAfterSubmerge = true;
    }
    if (this.hasBeenWet && !wet) this.returnedDry = true;
    this.maxDepth = Math.max(this.maxDepth, depth);
    this.maxUnderwaterBlend = Math.max(this.maxUnderwaterBlend, underwaterBlend);
    this.projectedCausticFrames = Math.max(
      this.projectedCausticFrames,
      finite(counters.waterProjectedCausticFrames),
    );
    this.maxProjectedCausticCpuMs = Math.max(
      this.maxProjectedCausticCpuMs,
      finite(counters.waterProjectedCausticCpuMs),
    );

    if (this.lastState !== null && this.lastState !== state) {
      this.transitions.push(Object.freeze({ from: this.lastState, to: state, phaseId }));
    }
    if (originSnap) {
      this.originSnapCount += 1;
      if (wet && this.lastBodyId !== null && bodyId !== this.lastBodyId) {
        this.originSnapViolations += 1;
      }
      if (wet && this.lastDepth !== null && Math.abs(depth - this.lastDepth) > 2) {
        this.originSnapViolations += 1;
      }
    }
    this.lastState = state;
    this.lastBodyId = bodyId;
    this.lastDepth = depth;
  }

  buildResult({ summary, thresholds }) {
    const expectsProjectedCaustics = this.qualityTier === 'high' || this.qualityTier === 'ultra';
    const gates = Object.freeze({
      routeFound: Boolean(this.route),
      measuredFrames: (summary?.frameCount ?? 0) > 0,
      enteredWater: this.wetFrames > 0,
      reachedSwimming: this.states.has('swimming') || this.states.has('submerged'),
      submerged: this.hasBeenSubmerged,
      surfaced: this.surfacedAfterSubmerge,
      returnedDry: this.returnedDry,
      stableBodyIdentity: this.bodyIds.size <= 1,
      originStable: this.originSnapViolations === 0,
      projectedCausticsActive: !expectsProjectedCaustics || this.projectedCausticFrames > 0,
      projectedCausticsCpuBounded: !expectsProjectedCaustics
        || this.maxProjectedCausticCpuMs <= thresholds.maximumProjectedCausticCpuMs,
      frameP95Bounded: Number.isFinite(summary?.dt?.p95Ms)
        && summary.dt.p95Ms <= thresholds.maximumFrameP95Ms,
      hitchRateBounded: finite(summary?.hitchRate, 1) <= thresholds.maximumHitchRate,
    });
    return Object.freeze({
      pass: Object.values(gates).every(Boolean),
      gates,
      route: this.route,
      qualityTier: this.qualityTier,
      states: Object.freeze([...this.states]),
      bodyIds: Object.freeze([...this.bodyIds]),
      transitions: Object.freeze([...this.transitions]),
      metrics: Object.freeze({
        frameCount: this.frameCount,
        wetFrames: this.wetFrames,
        submergedFrames: this.submergedFrames,
        maxDepth: this.maxDepth,
        maxUnderwaterBlend: this.maxUnderwaterBlend,
        projectedCausticFrames: this.projectedCausticFrames,
        maximumProjectedCausticCpuMs: this.maxProjectedCausticCpuMs,
        originSnapCount: this.originSnapCount,
        originSnapViolations: this.originSnapViolations,
      }),
      thresholds: Object.freeze({ ...thresholds }),
    });
  }
}
