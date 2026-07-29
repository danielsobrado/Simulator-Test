import {
  CONSTRUCTION_RECORD_VERSION,
  CUBIC_BEZIER_PATH_VERSION,
} from './ConstructionSchema.js';
import { DEFAULT_CONSTRUCTION_STYLE_KEY } from './masonry/ConstructionStyleCatalog.js';

const WALL_X_POSITIONS = Object.freeze([
  -36, -30, -24, -18, -12, -6,
  6, 12, 18, 24, 30, 36,
]);

function wallRecord(x, index) {
  const id = `construction-ring-wall-${index}`;
  return {
    version: CONSTRUCTION_RECORD_VERSION,
    id,
    revision: 1,
    seed: 8100 + index,
    kind: 'wall',
    label: `Construction ring wall ${index + 1}`,
    style: {
      key: DEFAULT_CONSTRUCTION_STYLE_KEY,
      version: 1,
      materials: {},
    },
    dimensions: {
      height: 4 + (index % 3) * 0.5,
      thickness: 0.9,
    },
    top: {
      style: index % 2 === 0 ? 'flat' : 'crenellated',
      base: 4,
      profile: [],
    },
    path: {
      version: CUBIC_BEZIER_PATH_VERSION,
      type: 'cubicBezier',
      closed: false,
      anchors: [
        { id: `${id}-south`, position: [x, -48] },
        { id: `${id}-north`, position: [x, 48] },
      ],
      segments: [{
        id: `${id}-segment`,
        startAnchorId: `${id}-south`,
        endAnchorId: `${id}-north`,
        startHandle: [0, 32],
        endHandle: [0, -32],
      }],
      features: [],
    },
    features: [],
  };
}

export function ensureConstructionPerfQaFixture(store, search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('qa') !== 'construction-ring') return [];
  return WALL_X_POSITIONS.map((x, index) => (
    store.get(`construction-ring-wall-${index}`)
      ?? store.add(wallRecord(x, index))
  ));
}
