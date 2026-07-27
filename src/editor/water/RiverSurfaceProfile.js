import { WATER_BODY_ID_RIVER_BASE } from './WaterConstants.js';

const MINIMUM_RIVER_RADIUS_CELLS = 0.75;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function toWorldCell(source, point) {
  if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    return null;
  }
  return {
    x: source.bounds.minCellX + point[0] / source.atlas.width * source.bounds.widthCells,
    z: source.bounds.minCellZ + point[1] / source.atlas.height * source.bounds.heightCells,
  };
}

function deduplicatePoints(points) {
  const result = [];
  for (const point of points) {
    if (!point) continue;
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 1e-6) {
      result.push(point);
    }
  }
  return result;
}

function resolveBodyId(value) {
  const id = Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const bodyId = WATER_BODY_ID_RIVER_BASE + id;
  return Number.isSafeInteger(bodyId) ? bodyId : WATER_BODY_ID_RIVER_BASE;
}

function assertSourceDimensions(source) {
  const values = [
    source?.atlas?.width,
    source?.atlas?.height,
    source?.bounds?.widthCells,
    source?.bounds?.heightCells,
  ];
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('River surface generation requires positive atlas and world dimensions.');
  }
}

export function createRiverSurfaceSegments({
  source,
  sampleBaseHeight,
  seaLevel,
  config,
}) {
  if (!source?.rivers?.length) return [];
  assertSourceDimensions(source);
  const segments = [];
  const cellSizeMeters = config.cellSizeMeters;

  for (const river of source.rivers) {
    let points = deduplicatePoints((river.points ?? []).map((point) => toWorldCell(source, point)));
    if (points.length < 2) continue;
    const firstHeight = sampleBaseHeight(points[0].x, points[0].z);
    const lastHeight = sampleBaseHeight(points[points.length - 1].x, points[points.length - 1].z);
    if (firstHeight < lastHeight) points = points.reverse();

    const widthAtlas = Number(river.widthAtlas);
    const safeWidthAtlas = Number.isFinite(widthAtlas) && widthAtlas > 0 ? widthAtlas : 0;
    const worldWidthCells = Math.max(
      1 / 256,
      safeWidthAtlas / source.atlas.width * source.bounds.widthCells,
    );
    const worldWidthMeters = worldWidthCells * cellSizeMeters;
    const channelDepth = clamp(
      config.river.minimumDepth + worldWidthMeters * config.river.widthDepthRatio,
      config.river.minimumDepth,
      config.river.maximumDepth,
    );
    const radiusCells = Math.max(worldWidthCells * 0.5, MINIMUM_RIVER_RADIUS_CELLS);
    const levels = new Float64Array(points.length);
    const bankInset = Math.min(0.35, channelDepth * 0.2);
    levels[0] = Math.max(seaLevel, sampleBaseHeight(points[0].x, points[0].z) - bankInset);
    for (let index = 1; index < points.length; index += 1) {
      const distanceMeters = Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].z - points[index - 1].z,
      ) * cellSizeMeters;
      const terrainLevel = sampleBaseHeight(points[index].x, points[index].z) - bankInset;
      const descendingLevel = levels[index - 1] - config.river.minimumGradient * distanceMeters;
      levels[index] = Math.max(seaLevel, Math.min(terrainLevel, descendingLevel));
    }

    const bodyId = resolveBodyId(river.id);
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const length = Math.hypot(dx, dz);
      if (length <= 1e-6) continue;
      segments.push(Object.freeze({
        bodyId,
        ax: start.x,
        az: start.z,
        bx: end.x,
        bz: end.z,
        dx,
        dz,
        length,
        flowX: dx / length,
        flowZ: dz / length,
        startSurface: levels[index - 1],
        endSurface: levels[index],
        radiusCells,
        channelDepth,
      }));
    }
  }
  return segments;
}
