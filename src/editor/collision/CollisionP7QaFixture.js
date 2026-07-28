import { CONSTRUCTION_RECORD_VERSION, CUBIC_BEZIER_PATH_VERSION } from '../construction/ConstructionSchema.js';
import { DEFAULT_CONSTRUCTION_STYLE_KEY } from '../construction/masonry/ConstructionStyleCatalog.js';

const FIXTURE_ID = 'collision-p7-wall';

function fixtureRecord() {
  return {
    version: CONSTRUCTION_RECORD_VERSION,
    id: FIXTURE_ID,
    revision: 1,
    seed: 7007,
    kind: 'wall',
    label: 'Collision P7 wall',
    style: {
      key: DEFAULT_CONSTRUCTION_STYLE_KEY,
      version: 1,
      materials: {},
    },
    dimensions: {
      height: 3.5,
      thickness: 0.8,
    },
    top: {
      style: 'flat',
      base: 3.5,
      profile: [],
    },
    path: {
      version: CUBIC_BEZIER_PATH_VERSION,
      type: 'cubicBezier',
      closed: false,
      anchors: [
        { id: 'anchor-west', position: [-8, 0] },
        { id: 'anchor-east', position: [8, 0] },
      ],
      segments: [{
        id: 'segment-west-east',
        startAnchorId: 'anchor-west',
        endAnchorId: 'anchor-east',
        startHandle: [16 / 3, 0],
        endHandle: [-16 / 3, 0],
      }],
      features: [],
    },
    features: [],
  };
}

export function ensureCollisionP7QaFixture(store, search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('qa') !== 'collision-p7') return null;
  const existing = store.get(FIXTURE_ID);
  if (existing) return existing;
  return store.add(fixtureRecord());
}
