import { DEFAULT_SIMULATION_CONFIG } from '../sim/config/defaultSimulationConfig.js';

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid simulation configuration: ${path} must be an object.`);
  }
}

function assertPositive(value, path) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid simulation configuration: ${path} must be positive.`);
  }
}

function assertPositiveSafeInt(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid simulation configuration: ${path} must be a positive integer.`);
  }
}

function assertNonNegInt(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid simulation configuration: ${path} must be a non-negative integer.`);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid simulation configuration: ${path} must be boolean.`);
  }
}

function assertSafeTickProduct(value, path) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid simulation configuration: ${path} exceeds the safe integer range.`);
  }
}

export function validateSimulationConfig(simulation) {
  if (simulation == null) return simulation;
  assertObject(simulation, 'simulation');

  assertNonNegInt(simulation.schemaVersion ?? DEFAULT_SIMULATION_CONFIG.schemaVersion, 'simulation.schemaVersion');
  assertNonNegInt(simulation.projectionVersion ?? DEFAULT_SIMULATION_CONFIG.projectionVersion, 'simulation.projectionVersion');
  if (simulation.strictValidation !== undefined) {
    assertBoolean(simulation.strictValidation, 'simulation.strictValidation');
  }
  if (simulation.retainDestroyedEntities !== undefined) {
    assertBoolean(simulation.retainDestroyedEntities, 'simulation.retainDestroyedEntities');
  }
  assertPositiveSafeInt(
    simulation.maxEventsPerTick ?? DEFAULT_SIMULATION_CONFIG.maxEventsPerTick,
    'simulation.maxEventsPerTick',
  );

  const time = simulation.time ?? {};
  assertObject(time, 'simulation.time');
  const resolvedTime = { ...DEFAULT_SIMULATION_CONFIG.time, ...time };
  for (const key of [
    'ticksPerHour', 'hoursPerDay', 'daysPerWeek', 'daysPerMonth', 'monthsPerYear',
    'initialYear', 'initialMonth', 'initialDay',
  ]) {
    assertPositiveSafeInt(resolvedTime[key], `simulation.time.${key}`);
  }
  assertNonNegInt(resolvedTime.initialHour, 'simulation.time.initialHour');
  if (resolvedTime.initialMonth > resolvedTime.monthsPerYear) {
    throw new Error('Invalid simulation configuration: simulation.time.initialMonth must not exceed monthsPerYear.');
  }
  if (resolvedTime.initialDay > resolvedTime.daysPerMonth) {
    throw new Error('Invalid simulation configuration: simulation.time.initialDay must not exceed daysPerMonth.');
  }
  if (resolvedTime.initialHour >= resolvedTime.hoursPerDay) {
    throw new Error('Invalid simulation configuration: simulation.time.initialHour must be less than hoursPerDay.');
  }
  const ticksPerDay = resolvedTime.ticksPerHour * resolvedTime.hoursPerDay;
  const ticksPerWeek = ticksPerDay * resolvedTime.daysPerWeek;
  const ticksPerMonth = ticksPerDay * resolvedTime.daysPerMonth;
  const ticksPerYear = ticksPerMonth * resolvedTime.monthsPerYear;
  assertSafeTickProduct(ticksPerDay, 'simulation.time.ticksPerDay');
  assertSafeTickProduct(ticksPerWeek, 'simulation.time.ticksPerWeek');
  assertSafeTickProduct(ticksPerMonth, 'simulation.time.ticksPerMonth');
  assertSafeTickProduct(ticksPerYear, 'simulation.time.ticksPerYear');

  const geography = simulation.geography ?? {};
  assertObject(geography, 'simulation.geography');
  for (const key of [
    'roadSpeedKmPerHour', 'trailSpeedKmPerHour', 'riverDownstreamSpeedKmPerHour',
    'riverUpstreamSpeedKmPerHour', 'seaSpeedKmPerHour', 'maxGeneratedSeaLaneKm',
  ]) {
    if (geography[key] !== undefined) assertPositive(geography[key], `simulation.geography.${key}`);
  }

  if (simulation.commodities !== undefined) {
    assertObject(simulation.commodities, 'simulation.commodities');
    for (const [id, def] of Object.entries(simulation.commodities)) {
      assertObject(def, `simulation.commodities.${id}`);
      assertPositive(def.unitMassKg, `simulation.commodities.${id}.unitMassKg`);
      assertPositive(def.baseValue, `simulation.commodities.${id}.baseValue`);
      if (def.spoilagePerDay !== undefined && (!Number.isFinite(def.spoilagePerDay) || def.spoilagePerDay < 0)) {
        throw new Error(`Invalid simulation configuration: simulation.commodities.${id}.spoilagePerDay must be >= 0.`);
      }
    }
  }

  return simulation;
}
