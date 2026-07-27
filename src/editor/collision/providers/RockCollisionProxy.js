import { Vector3 } from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

const MINIMUM_PROXY_POINTS = 8;
const EXTREME_AXES = Object.freeze([
  ['x', -1], ['x', 1],
  ['y', -1], ['y', 1],
  ['z', -1], ['z', 1],
]);

function triangleCount(geometry) {
  const count = geometry.getIndex()?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return Number.isSafeInteger(count) && count % 3 === 0 ? count / 3 : 0;
}

function positionPoints(geometry) {
  const position = geometry?.getAttribute?.('position');
  if (!position || !Number.isSafeInteger(position.count) || position.count < 4) {
    throw new Error('Walkable rock proxy generation requires finite source positions.');
  }
  const points = [];
  for (let index = 0; index < position.count; index += 1) {
    const point = new Vector3(position.getX(index), position.getY(index), position.getZ(index));
    if (![point.x, point.y, point.z].every(Number.isFinite)) {
      throw new Error('Walkable rock proxy generation found non-finite source positions.');
    }
    points.push(point);
  }
  return points;
}

function addUnique(target, seen, point) {
  const key = `${point.x.toFixed(6)}:${point.y.toFixed(6)}:${point.z.toFixed(6)}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push(point.clone());
}

function sampledPoints(points, maximum) {
  const selected = [];
  const seen = new Set();
  for (const [axis, direction] of EXTREME_AXES) {
    let extreme = points[0];
    for (const point of points) {
      if (point[axis] * direction > extreme[axis] * direction) extreme = point;
    }
    addUnique(selected, seen, extreme);
  }
  const remaining = Math.max(0, maximum - selected.length);
  const stride = Math.max(1, Math.floor(points.length / Math.max(1, remaining)));
  for (let index = 0; index < points.length && selected.length < maximum; index += stride) {
    addUnique(selected, seen, points[index]);
  }
  for (let index = 0; index < points.length && selected.length < maximum; index += 1) {
    addUnique(selected, seen, points[index]);
  }
  return selected;
}

function convexFallback(sourceGeometry, maximumTriangles) {
  const points = positionPoints(sourceGeometry);
  let maximumPoints = Math.max(
    MINIMUM_PROXY_POINTS,
    Math.min(points.length, Math.floor((maximumTriangles + 4) / 2)),
  );
  while (maximumPoints >= MINIMUM_PROXY_POINTS) {
    const proxy = new ConvexGeometry(sampledPoints(points, maximumPoints));
    proxy.computeBoundingBox();
    const triangles = triangleCount(proxy);
    if (triangles > 0 && triangles <= maximumTriangles && !proxy.boundingBox?.isEmpty()) {
      return proxy;
    }
    proxy.dispose();
    maximumPoints -= 1;
  }
  throw new Error(`Generated walkable rock proxy cannot fit ${maximumTriangles} triangles.`);
}

function overlapRatio(visual, proxy) {
  visual.computeBoundingBox();
  proxy.computeBoundingBox();
  const a = visual.boundingBox;
  const b = proxy.boundingBox;
  if (!a || !b || a.isEmpty() || b.isEmpty()) return 0;
  const overlapX = Math.max(0, Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x));
  const overlapY = Math.max(0, Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y));
  const overlapZ = Math.max(0, Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z));
  const visualVolume = Math.max(1e-9,
    (a.max.x - a.min.x) * (a.max.y - a.min.y) * (a.max.z - a.min.z));
  return (overlapX * overlapY * overlapZ) / visualVolume;
}

export function createRockCollisionProxy({
  visualGeometry,
  authoredGeometry = null,
  config,
  prototypeId,
  allowGenerated = Boolean(import.meta.env?.DEV),
}) {
  if (!visualGeometry?.clone) throw new Error('Rock collision proxy requires visual geometry.');
  let proxy;
  let generated;
  if (authoredGeometry?.clone) {
    proxy = authoredGeometry.clone();
    generated = false;
  } else {
    if (!allowGenerated || config.requireAuthoredProxy) {
      throw new Error(
        `Walkable rock ${prototypeId} has no authored COLLIDER_WALKABLE proxy.`,
      );
    }
    proxy = convexFallback(visualGeometry, config.maximumProxyTriangles);
    generated = true;
  }

  const overlap = overlapRatio(visualGeometry, proxy);
  if (overlap < config.minimumProxyOverlapRatio) {
    proxy.dispose();
    throw new Error(
      `Walkable rock ${prototypeId} proxy overlap ${overlap.toFixed(3)} is below `
      + `${config.minimumProxyOverlapRatio}.`,
    );
  }
  return Object.freeze({
    geometry: proxy,
    generated,
    overlap,
    triangleCount: triangleCount(proxy),
  });
}
