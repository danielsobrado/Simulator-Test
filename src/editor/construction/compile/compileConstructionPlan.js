import { normalizeConstructionRecord } from '../ConstructionSchema.js';
import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { planConstruction } from '../planning/ConstructionPlanner.js';
import { compileConstructionCollision } from './ConstructionCollisionCompiler.js';

export function compileConstructionPlan(input, options = {}) {
  const record = normalizeConstructionRecord(input);
  const renderPlan = planConstruction(record, options);
  const collision = compileConstructionCollision(
    record,
    sampleCubicBezierPath(record.path),
    options.collision ?? {},
  );
  return Object.freeze({ ...renderPlan, collision });
}
