import { createShapeRoofSurface } from './ShapeRoofSurface.js';
import { shapeBaseTop } from './ShapeProfile.js';
import { clipShapePolygon, convexShapePlanes, convexShapeWallPlanes, interpolateShapeVertex, splitShapeFootprint } from './ShapePolygonClip.js';

const triangles = (polygon) => Array.from({ length: Math.max(0, polygon.length - 2) }, (_, i) => [polygon[0], polygon[i + 1], polygon[i + 2]]);
const positionKey = (p, roofs) => JSON.stringify([p.position, p.rotation, p.elevation, p.height, p.footprint, p.taper, p.thickness, roofs ? p.roof : null]);

function clipRoofHeight(triangle, signed, depth = 0) {
  const values = triangle.map((v) => signed(v.position));
  const middle = triangle.map((v, i) => interpolateShapeVertex(v, triangle[(i + 1) % 3], 0.5));
  const center = interpolateShapeVertex(interpolateShapeVertex(triangle[0], triangle[1], 0.5), triangle[2], 1 / 3);
  const probes = [...values, ...middle.map((v) => signed(v.position)), signed(center.position)];
  if (probes.every((v) => v >= 0)) return [triangle];
  if (probes.every((v) => v < 0)) return [];
  const length = Math.max(...triangle.map((v, i) => Math.hypot(...v.position.map((n, k) => n - triangle[(i + 1) % 3].position[k]))));
  if (depth < 5 && length > 0.12) {
    return [[triangle[0], middle[0], middle[2]], [middle[0], triangle[1], middle[1]],
      [middle[2], middle[1], triangle[2]], [middle[0], middle[1], middle[2]]]
      .flatMap((part) => clipRoofHeight(part, signed, depth + 1));
  }
  const root = (a, b, sa) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const t = (lo + hi) / 2, value = signed(a.map((n, k) => n + (b[k] - n) * t));
      if ((value >= 0) === (sa >= 0)) lo = t;
      else hi = t;
    }
    return (lo + hi) / 2;
  };
  return triangles(clipShapePolygon(triangle, signed, true, root));
}

/** Continuous mask evaluated from semantic roof surfaces, never reconstructed from rendered triangles. */
export function createShapeRoofOcclusion(plan, { roofMargin = 0.001, roofs = true } = {}) {
  const neighbors = (plan.neighbors ?? []).flatMap((n) => {
    // Identical overlapping surfaces have one deterministic owner, without double removal.
    if (positionKey(plan.primitive, roofs) === positionKey(n.primitive, roofs) && plan.id < n.id) return [];
    const surface = createShapeRoofSurface(n), outline = surface.outline;
    const bottom = n.curve.samples.map((s) => surface.wall.point(s.distance, shapeBaseTop(n.primitive), n.primitive.thickness / 2));
    const top = n.curve.samples.map((s) => surface.wall.point(s.distance, n.primitive.height - 1e-4, n.primitive.thickness / 2));
    const bounds = [...bottom, ...outline];
    return [{ ...n, surface, planes: convexShapePlanes(outline), wallPlanes: convexShapeWallPlanes(bottom, top),
      coplanar: positionKey(plan.primitive, roofs) === positionKey(n.primitive, roofs),
      wallTop: n.primitive.elevation + n.primitive.height,
      minX: Math.min(...bounds.map((v) => v[0])), maxX: Math.max(...bounds.map((v) => v[0])),
      minZ: Math.min(...bounds.map((v) => v[2])), maxZ: Math.max(...bounds.map((v) => v[2])) }];
  });
  function clip(triangle) {
    let pieces = [triangle];
    for (const n of neighbors) {
      pieces = pieces.flatMap((part) => {
        const points = part.map((v) => v.position);
        if (points.every((v) => v[0] < n.minX) || points.every((v) => v[0] > n.maxX) ||
          points.every((v) => v[2] < n.minZ) || points.every((v) => v[2] > n.maxZ)) return [part];
        const under = clipShapePolygon(part, (v) => n.primitive.elevation - v[1]);
        const aboveBase = clipShapePolygon(part, (v) => v[1] - n.primitive.elevation);
        const walls = clipShapePolygon(aboveBase, (v) => n.wallTop - v[1] - 1e-8);
        const roof = clipShapePolygon(aboveBase, (v) => v[1] - n.wallTop);
        const wallPieces = n.roofOnly ? [walls] : splitShapeFootprint(walls, n.wallPlanes).outside;
        if (n.roofReplaced || !roofs) return [under, ...wallPieces, roof].flatMap(triangles);
        const { outside, inside } = splitShapeFootprint(roof, n.planes);
        // Duplicate roof relief belongs to one owner; exterior projections remain visible.
        if (n.coplanar) return [under, ...wallPieces, ...outside].flatMap(triangles);
        return [under, ...wallPieces, ...outside].flatMap(triangles).concat(triangles(inside).flatMap((t) =>
          clipRoofHeight(t, (v) => v[1] - n.surface.heightAt(v[0], v[2]) - roofMargin)));
      });
      if (!pieces.length) break;
    }
    return pieces;
  }
  function hidden(points) {
    return neighbors.some((n) => points.every((p) => p[1] >= n.primitive.elevation &&
      (p[1] < n.wallTop ? !n.roofOnly && n.wallPlanes.every((plane) => plane(p) <= 0) :
        roofs && !n.roofReplaced && n.planes.every((plane) => plane(p) <= 0) && p[1] < n.surface.heightAt(p[0], p[2]) + roofMargin)));
  }
  return { clip, hidden, active: neighbors.length > 0 };
}

export function clipShapeMeshSet(meshes, plan, options) {
  const mask = createShapeRoofOcclusion(plan, options);
  return Object.fromEntries(Object.entries(meshes).map(([slot, mesh]) => [slot, clipShapeRoofMesh(mesh, mask)]));
}

export function clipShapeRoofMesh(mesh, mask) {
  if (!mask.active) return mesh;
  const result = Object.create(mesh);
  result.triangle = (a, b, c, color, uvs, normals) => {
    const triangle = [a, b, c].map((position, i) => ({ position, uv: uvs?.[i], normal: normals?.[i] }));
    for (const part of mask.clip(triangle)) mesh.triangle(...part.map((v) => v.position), color,
      uvs && part.map((v) => v.uv), normals && part.map((v) => v.normal));
  };
  return result;
}
