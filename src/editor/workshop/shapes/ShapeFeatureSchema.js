import { shapeChoice, shapeId, shapeNumber, shapeRecord } from './ShapeValidation.js';

export const SHAPE_FEATURES = Object.freeze([
  { kind: 'dormer', label: 'Roof dormer' }, { kind: 'bay', label: 'Bay window' },
  { kind: 'jetty', label: 'Projecting upper floor' }, { kind: 'porch', label: 'Timber porch' },
  { kind: 'buttress', label: 'Stone buttress' },
  { kind: 'balcony', label: 'Curved balcony' },
  { kind: 'turret', label: 'Attached turret' },
]);

export const SHAPE_TURRET_ROOFS = Object.freeze(['cone', 'spire', 'bell', 'flat']);

export function normalizeShapeFeatures(value) {
  const inputs = value ?? [];
  if (!Array.isArray(inputs) || inputs.length > 24) throw new Error('A building supports at most 24 architectural features.');
  const features = inputs.map((input) => {
    const f = shapeRecord(input, 'Architectural feature');
    return Object.freeze({ id: shapeId(f.id, 'Feature id'),
      kind: shapeChoice(f.kind, 'architectural feature', 'dormer', SHAPE_FEATURES.map((v) => v.kind)),
      at: shapeNumber(f.at, 'Feature position', 0.5, 0, 1),
      width: shapeNumber(f.width, 'Feature width', 2, 0.6, 8),
      depth: shapeNumber(f.depth, 'Feature projection', 1.2, 0.25, 4),
      height: shapeNumber(f.height, 'Feature height', 1.8, 0.5, 16),
      bottom: shapeNumber(f.bottom, 'Feature elevation', 0.9, 0, 24),
      ...(f.kind === 'turret' ? { roof: shapeChoice(f.roof, 'turret roof', 'cone', SHAPE_TURRET_ROOFS) } : {}),
    });
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(features.map((f) => f.id)).size !== features.length) throw new Error('Duplicate architectural feature id.');
  if (features.filter((f) => f.kind === 'jetty').length > 1) throw new Error('A building supports one projecting upper floor.');
  return Object.freeze(features);
}
