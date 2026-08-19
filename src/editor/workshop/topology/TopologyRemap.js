import { clamp01, WORKSHOP_GEOMETRY_TOLERANCE } from '../curves/GeometryTolerancePolicy.js';

function range2(value, field) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
    throw new Error(`${field} must contain two finite parameters.`);
  }
  if (value[0] < 0 || value[1] > 1 || value[1] < value[0]) {
    throw new Error(`${field} must be an ascending range inside 0..1.`);
  }
  return Object.freeze([value[0], value[1]]);
}

function normalizeRecord(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`Topology remap record ${index + 1} must be an object.`);
  }
  if (typeof input.sourceSegmentId !== 'string' || typeof input.targetSegmentId !== 'string') {
    throw new Error(`Topology remap record ${index + 1} requires source and target segment ids.`);
  }
  return Object.freeze({
    sourceSegmentId: input.sourceSegmentId,
    sourceRange: range2(input.sourceRange ?? [0, 1], 'Topology source range'),
    targetSegmentId: input.targetSegmentId,
    targetRange: range2(input.targetRange ?? [0, 1], 'Topology target range'),
  });
}

export class TopologyRemap {
  constructor(records = []) {
    if (!Array.isArray(records)) throw new Error('Topology remap records must be an array.');
    this.records = Object.freeze(records.map(normalizeRecord).sort((left, right) => (
      left.sourceSegmentId.localeCompare(right.sourceSegmentId)
      || left.sourceRange[0] - right.sourceRange[0]
      || left.targetSegmentId.localeCompare(right.targetSegmentId)
    )));
    Object.freeze(this);
  }

  recordsFor(segmentId) {
    return Object.freeze(this.records.filter(({ sourceSegmentId }) => sourceSegmentId === segmentId));
  }

  toJSON() {
    return this.records.map((record) => ({
      sourceSegmentId: record.sourceSegmentId,
      sourceRange: [...record.sourceRange],
      targetSegmentId: record.targetSegmentId,
      targetRange: [...record.targetRange],
    }));
  }
}

export function remapHostedCoordinate(remapInput, coordinate, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const remap = remapInput instanceof TopologyRemap ? remapInput : new TopologyRemap(remapInput);
  if (!coordinate || typeof coordinate !== 'object') throw new Error('Hosted coordinate must be an object.');
  const parameter = clamp01(coordinate.segmentParameter ?? 0);
  const candidates = remap.recordsFor(coordinate.segmentId);
  const record = candidates.find(({ sourceRange }) => (
    parameter >= sourceRange[0] - tolerance.parameter
    && parameter <= sourceRange[1] + tolerance.parameter
  ));
  if (!record) return null;
  const sourceSpan = record.sourceRange[1] - record.sourceRange[0];
  const ratio = sourceSpan <= tolerance.parameter
    ? 0
    : (parameter - record.sourceRange[0]) / sourceSpan;
  const targetSpan = record.targetRange[1] - record.targetRange[0];
  return Object.freeze({
    ...coordinate,
    segmentId: record.targetSegmentId,
    segmentParameter: clamp01(record.targetRange[0] + targetSpan * ratio),
  });
}
