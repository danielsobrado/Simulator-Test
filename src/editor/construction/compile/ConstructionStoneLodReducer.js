/**
 * Reduce an authoritative stone appearance for a construction LOD band.
 *
 * Near preserves identity and topology flags from the style profile.
 * Coarse keeps dominant tilt / worn corner while lowering amplitude and
 * stripping micro-topology (saddle, midpoints, corner flattening).
 */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function reduceCornerValues(values, average, scale) {
  return values.map((value) => average + (value - average) * scale);
}

function reduceFaceSide(side, scale) {
  if (!side?.enabled) {
    return Object.freeze({
      fullness: 1,
      tiltU: 0,
      tiltV: 0,
      saddle: 0,
      edgeRecession: 0,
      columns: 0,
      rows: 0,
      edgeFalloffPower: 1,
      enabled: false,
    });
  }
  return Object.freeze({
    ...side,
    fullness: 1 - (1 - side.fullness) * scale,
    tiltU: side.tiltU * scale,
    tiltV: side.tiltV * scale,
    saddle: 0,
    edgeRecession: side.edgeRecession * scale,
  });
}

function reduceFaceAppearance(face, scale) {
  return Object.freeze({
    front: reduceFaceSide(face.front, scale),
    back: reduceFaceSide(face.back, scale),
  });
}

function reduceEdgeSide(side, scale) {
  if (!side?.enabled) {
    return Object.freeze({
      enabled: false,
      cornerWidth: Object.freeze([0, 0, 0, 0]),
      cornerDepth: Object.freeze([0, 0, 0, 0]),
      edgeMidpointScale: Object.freeze([1, 1, 1, 1]),
      cornerFlattening: Object.freeze([0, 0, 0, 0]),
      baseWidth: 0,
      baseDepth: 0,
      clamped: false,
      safeguards: null,
    });
  }
  const averageWidth = mean(side.cornerWidth);
  const averageDepth = mean(side.cornerDepth);
  return Object.freeze({
    ...side,
    cornerWidth: Object.freeze(reduceCornerValues(side.cornerWidth, averageWidth, scale)),
    cornerDepth: Object.freeze(reduceCornerValues(side.cornerDepth, averageDepth, scale)),
    edgeMidpointScale: Object.freeze([1, 1, 1, 1]),
    cornerFlattening: Object.freeze([0, 0, 0, 0]),
    // Base stays near the reduced mean so bevel safety clamps stay coherent.
    baseWidth: averageWidth + (side.baseWidth - averageWidth) * scale,
    baseDepth: averageDepth + (side.baseDepth - averageDepth) * scale,
  });
}

function reduceEdgeAppearance(edges, scale) {
  return Object.freeze({
    front: reduceEdgeSide(edges.front, scale),
    back: reduceEdgeSide(edges.back, scale),
  });
}

function applyFaceGrid(face, faceGrid) {
  const patch = (side) => {
    if (!side?.enabled) return side;
    return Object.freeze({
      ...side,
      columns: faceGrid.columns,
      rows: faceGrid.rows,
    });
  };
  return Object.freeze({
    front: patch(face.front),
    back: patch(face.back),
  });
}

/**
 * @param {'near'|'coarse'} lodBand
 */
export function reduceStoneAppearanceForLod({
  appearance,
  lodProfile,
  lodBand,
}) {
  if (!appearance) {
    throw new Error('reduceStoneAppearanceForLod: appearance is required.');
  }
  if (!lodProfile?.near || !lodProfile?.coarse) {
    throw new Error('reduceStoneAppearanceForLod: lodProfile is incomplete.');
  }

  if (lodBand === 'near') {
    const band = lodProfile.near;
    const face = applyFaceGrid(appearance.face, band.faceGrid);
    const edges = band.cornerFlattening
      ? appearance.edges
      : Object.freeze({
        front: Object.freeze({
          ...appearance.edges.front,
          cornerFlattening: Object.freeze([0, 0, 0, 0]),
        }),
        back: Object.freeze({
          ...appearance.edges.back,
          cornerFlattening: Object.freeze([0, 0, 0, 0]),
        }),
      });
    return deepFreeze({
      ...appearance,
      face,
      edges,
      faceGrid: Object.freeze({ ...band.faceGrid }),
      bevelRings: band.bevelRings,
      edgeMidpoints: band.edgeMidpoints,
      cornerFlattening: band.cornerFlattening
        ? appearance.edges.front.cornerFlattening
        : Object.freeze([0, 0, 0, 0]),
      geometryTier: 'near',
      mode: band.mode,
      reliefAmplitudeScale: band.reliefAmplitudeScale,
      edgeVariationScale: band.edgeVariationScale,
    });
  }

  if (lodBand === 'coarse') {
    const band = lodProfile.coarse;
    const face = applyFaceGrid(
      reduceFaceAppearance(appearance.face, band.reliefAmplitudeScale),
      band.faceGrid,
    );
    const edges = reduceEdgeAppearance(appearance.edges, band.edgeVariationScale);
    return deepFreeze({
      ...appearance,
      face,
      edges,
      dominant: appearance.dominant,
      faceGrid: Object.freeze({ ...band.faceGrid }),
      bevelRings: band.bevelRings,
      edgeMidpoints: false,
      cornerFlattening: Object.freeze([0, 0, 0, 0]),
      geometryTier: 'coarse',
      mode: band.mode,
      reliefAmplitudeScale: band.reliefAmplitudeScale,
      edgeVariationScale: band.edgeVariationScale,
    });
  }

  throw new Error(`reduceStoneAppearanceForLod: unknown lodBand "${lodBand}".`);
}

export {
  reduceCornerValues,
  reduceFaceSide,
};
