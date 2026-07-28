import {
  CONSTRUCTION_RECORD_VERSION,
  CUBIC_BEZIER_PATH_VERSION,
  normalizeConstructionRecord,
} from '../../src/editor/construction/ConstructionSchema.js';
import { DEFAULT_CONSTRUCTION_STYLE_KEY } from '../../src/editor/construction/masonry/ConstructionStyleCatalog.js';

const DEFAULT_TOP = Object.freeze({
  style: 'flat',
  base: 3.5,
  profile: Object.freeze([]),
});

function baseRecord({ id, revision, path, features, top = DEFAULT_TOP }) {
  return normalizeConstructionRecord({
    version: CONSTRUCTION_RECORD_VERSION,
    id,
    revision,
    seed: 1701,
    kind: 'wall',
    label: id,
    style: {
      key: DEFAULT_CONSTRUCTION_STYLE_KEY,
      version: 1,
      materials: {},
    },
    dimensions: {
      height: 3.5,
      thickness: 0.8,
    },
    top,
    path: {
      version: CUBIC_BEZIER_PATH_VERSION,
      type: 'cubicBezier',
      closed: false,
      ...path,
      features,
    },
    features,
  });
}

export function straightConstruction({
  id = 'construction-test',
  revision = 1,
  start = [-8, 0],
  end = [8, 0],
  features = [],
  top = DEFAULT_TOP,
} = {}) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  return baseRecord({
    id,
    revision,
    features,
    top,
    path: {
      anchors: [
        { id: 'anchor-start', position: start },
        { id: 'anchor-end', position: end },
      ],
      segments: [{
        id: 'segment-main',
        startAnchorId: 'anchor-start',
        endAnchorId: 'anchor-end',
        startHandle: [dx / 3, dz / 3],
        endHandle: [-dx / 3, -dz / 3],
      }],
    },
  });
}

export function curvedConstruction({
  id = 'construction-curve',
  revision = 1,
} = {}) {
  return baseRecord({
    id,
    revision,
    features: [],
    path: {
      anchors: [
        { id: 'anchor-west', position: [-6, 0] },
        { id: 'anchor-north', position: [0, 4] },
        { id: 'anchor-east', position: [6, 0] },
      ],
      segments: [
        {
          id: 'segment-west-north',
          startAnchorId: 'anchor-west',
          endAnchorId: 'anchor-north',
          startHandle: [2.5, 0],
          endHandle: [-2.5, 0],
        },
        {
          id: 'segment-north-east',
          startAnchorId: 'anchor-north',
          endAnchorId: 'anchor-east',
          startHandle: [2.5, 0],
          endHandle: [-2.5, 0],
        },
      ],
    },
  });
}

export function closedConstruction({
  id = 'construction-closed',
  revision = 1,
} = {}) {
  return baseRecord({
    id,
    revision,
    features: [],
    path: {
      closed: true,
      anchors: [
        { id: 'anchor-nw', position: [-4, -4] },
        { id: 'anchor-ne', position: [4, -4] },
        { id: 'anchor-se', position: [4, 4] },
        { id: 'anchor-sw', position: [-4, 4] },
      ],
      segments: [
        {
          id: 'segment-north',
          startAnchorId: 'anchor-nw',
          endAnchorId: 'anchor-ne',
          startHandle: [8 / 3, 0],
          endHandle: [-8 / 3, 0],
        },
        {
          id: 'segment-east',
          startAnchorId: 'anchor-ne',
          endAnchorId: 'anchor-se',
          startHandle: [0, 8 / 3],
          endHandle: [0, -8 / 3],
        },
        {
          id: 'segment-south',
          startAnchorId: 'anchor-se',
          endAnchorId: 'anchor-sw',
          startHandle: [-8 / 3, 0],
          endHandle: [8 / 3, 0],
        },
        {
          id: 'segment-west',
          startAnchorId: 'anchor-sw',
          endAnchorId: 'anchor-nw',
          startHandle: [0, -8 / 3],
          endHandle: [0, 8 / 3],
        },
      ],
    },
  });
}

export function doorFeature(overrides = {}) {
  return {
    id: 'door-main',
    kind: 'door',
    segmentId: 'segment-main',
    arcFraction: 0.5,
    width: 2,
    height: 2.2,
    sill: 0,
    profile: 'round',
    dressed: true,
    group: null,
    ...overrides,
  };
}
