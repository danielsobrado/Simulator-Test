import { createShapeCurveSampler } from './ShapeCurveSampler.js';
import { placeShapePoint } from './ShapePaths.js';
import { pointInShape, shapeEnvelopeAtHeight } from './ShapeEnvelope.js';
import { WORKSHOP_GEOMETRY_TOLERANCE as tolerance } from '../curves/GeometryTolerancePolicy.js';
import { addShapeWallBevel } from './ShapeWallBevel.js';
import { shapeProfileOut } from './ShapeProfile.js';
import { shapeOpeningTop } from './ShapeOpenings.js';

export function createShapeWallSurface(plan) {
  const p = plan.primitive,
    length = plan.curve.length;
  const sampler = createShapeCurveSampler(plan.curve.path),
    samples = new Map();
  const clockwise =
    plan.curve.closed &&
    plan.boundary.reduce((sum, point, i) => {
      const next = plan.boundary[(i + 1) % plan.boundary.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0) < 0;
  function sample(distance) {
    const d = plan.curve.closed
      ? ((distance % length) + length) % length
      : Math.max(0, Math.min(length, distance));
    if (!samples.has(d)) {
      samples.set(d, sampler.point(d));
    }
    return samples.get(d);
  }
  function point(distance, y, offset = 0) {
    const s = sample(distance),
      scale = p.kind === 'curved-volume' ? 1 + ((p.taper - 1) * y) / p.height : 1;
    if (p.kind === 'curved-wall') offset *= 1 + ((p.taper - 1) * y) / p.height;
    // The vertical profile moves both faces of a shell, and each face of a freestanding wall.
    const out = shapeProfileOut(p, y);
    if (out) offset += p.kind === 'curved-wall' ? Math.sign(offset) * out : out;
    const sign = clockwise ? -1 : 1;
    const local = [
      s.point[0] * scale + s.tangent[1] * offset * sign,
      s.point[1] * scale - s.tangent[0] * offset * sign,
    ];
    const world = placeShapePoint(p, local);
    return [world[0], p.elevation + y, world[1]];
  }
  function gaps(distance) {
    return (plan.openings ?? p.openings ?? []).flatMap((o) => {
      let dx = distance - o.at * length;
      if (plan.curve.closed) dx = ((((dx + length / 2) % length) + length) % length) - length / 2;
      if (Math.abs(dx) > o.width / 2 + tolerance.length) return [];
      const top = shapeOpeningTop(o, dx);
      return [{ bottom: o.bottom, top: Math.min(p.height, top), opening: o }];
    });
  }
  function neighborExcluded(distance, y) {
    const position = point(distance, y);
    return (plan.neighbors ?? []).some((n) => {
      if (n.roofOnly) return false;
      const t = (position[1] - n.primitive.elevation) / n.primitive.height;
      if (t < 0 || t > 1) return false;
      const boundary = shapeEnvelopeAtHeight(n, position[1]);
      return pointInShape([position[0], position[2]], boundary);
    });
  }
  function excluded(distance, y) {
    return gaps(distance).some((gap) => y >= gap.bottom && y <= gap.top) || neighborExcluded(distance, y);
  }
  return {
    point,
    gaps,
    excluded,
    neighborExcluded,
    length,
    clockwise,
    closed: plan.curve.closed,
  };
}

/** Clip each material layer against the same continuous opening envelope. */
export function wallSolidBands(surface, u0, u1, y0, y1, neighborCuts = true) {
  const center = (u0 + u1) / 2;
  const gaps = surface.gaps(center).sort((a, b) => a.bottom - b.bottom);
  const at = (distance) => new Map(surface.gaps(distance).map((gap) => [gap.opening.id, gap.top]));
  const left = at(u0),
    right = at(u1),
    bands = [];
  let bottom = [y0, y0];
  for (const gap of [...gaps, { bottom: y1, top: y1 }]) {
    const top = Math.min(y1, gap.bottom);
    if (
      top > Math.max(...bottom) + tolerance.length &&
      (!neighborCuts || !surface.neighborExcluded(center, (Math.max(...bottom) + top) / 2))
    ) {
      bands.push({ bottom: [...bottom], top: [top, top] });
    }
    bottom = bottom.map((value, i) =>
      Math.min(
        y1,
        Math.max(
          value,
          gap.opening ? ((i ? right : left).get(gap.opening.id) ?? gap.top) : gap.top,
        ),
      ),
    );
  }
  return bands;
}

export function addWallPatch(mesh, surface, u0, u1, y0, y1, offset, thickness, color, caps = {}) {
  const low = Array.isArray(y0) ? y0 : [y0, y0];
  const high = Array.isArray(y1) ? y1 : [y1, y1];
  const a = surface.point(u0, low[0], offset),
    b = surface.point(u1, low[1], offset);
  const c = surface.point(u1, high[1], offset),
    d = surface.point(u0, high[0], offset);
  // Reveals, soffits and ends may belong to a different slot than the face (stone jambs in mortar).
  const textureUv = uv => caps.grainAlong === 'u' ? uv.map(([u, v]) => [v, u]) : uv;
  const face = (a, b, c, d, target = mesh, tone = color, uv) => {
    if (uv) uv = textureUv(uv);
    return surface.clockwise !== thickness < 0
      ? target.quad(a, b, c, d, tone, uv)
      : target.quad(d, c, b, a, tone, uv?.toReversed());
  };
  const side = (a, b, c, d, uv) => face(a, b, c, d, caps.sideMesh ?? mesh, caps.sideColor ?? color, uv);
  if (caps.bevel) addShapeWallBevel(mesh, surface, { u0, u1, low, high, offset, thickness, color, caps });
  else {
    const uv = textureUv([[u0, low[0]], [u1, low[1]], [u1, high[1]], [u0, high[0]]]);
    if (surface.clockwise !== thickness < 0) mesh.quad(a, b, c, d, color, uv);
    else mesh.quad(d, c, b, a, color, uv.toReversed());
  }
  if (Math.abs(thickness) > 0) {
    const ai = surface.point(u0, low[0], offset - thickness),
      bi = surface.point(u1, low[1], offset - thickness);
    const ci = surface.point(u1, high[1], offset - thickness),
      di = surface.point(u0, high[0], offset - thickness);
    const inner = offset - thickness;
    if (caps.back !== false) face(bi, ai, di, ci, mesh, color, [[u1, low[1]], [u0, low[0]], [u0, high[0]], [u1, high[1]]]);
    side(a, ai, bi, b, [[u0, offset], [u0, inner], [u1, inner], [u1, offset]]);
    side(d, c, ci, di, [[u0, offset], [u1, offset], [u1, inner], [u0, inner]]);
    if (caps.start !== false) side(a, d, di, ai, [[offset, low[0]], [offset, high[0]], [inner, high[0]], [inner, low[0]]]);
    if (caps.end !== false) side(b, bi, ci, c, [[offset, low[1]], [inner, low[1]], [inner, high[1]], [offset, high[1]]]);
  }
}
