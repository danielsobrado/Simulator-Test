/**
 * Continuous tunnel spine built from 2+ floor control points with smooth
 * tangential corner fillets and a roll-free horizon-level local frame.
 *
 * Straight legs remain exact lines (preserving rail alignment), while interior
 * bends transition smoothly via quadratic Bezier arcs so adjacent sections have
 * no orientation discontinuities or abrupt profile resets.
 */

const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

function validatePoint(point, index) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
    throw new Error(`Tunnel spine: point ${index} must have finite x, y, z.`);
  }
}

function addSample(samples, p) {
  const prev = samples[samples.length - 1];
  if (prev && Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z) < 1e-4) return;
  samples.push({ x: p.x, y: p.y, z: p.z });
}

function buildStations(points, samplingStep, cornerRadius) {
  const samples = [];
  addSample(samples, points[0]);

  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    const inDx = curr.x - prev.x, inDy = curr.y - prev.y, inDz = curr.z - prev.z;
    const outDx = next.x - curr.x, outDy = next.y - curr.y, outDz = next.z - curr.z;
    const inLen = Math.hypot(inDx, inDy, inDz);
    const outLen = Math.hypot(outDx, outDy, outDz);
    if (inLen < 1e-4 || outLen < 1e-4) continue;

    const cut = Math.min(cornerRadius, inLen * 0.42, outLen * 0.42);
    const ax = curr.x - (inDx / inLen) * cut;
    const ay = curr.y - (inDy / inLen) * cut;
    const az = curr.z - (inDz / inLen) * cut;
    const bx = curr.x + (outDx / outLen) * cut;
    const by = curr.y + (outDy / outLen) * cut;
    const bz = curr.z + (outDz / outLen) * cut;

    const arcSteps = Math.max(3, Math.ceil((cut * 2) / samplingStep));
    for (let k = 0; k <= arcSteps; k += 1) {
      const t = k / arcSteps;
      const omt = 1 - t;
      addSample(samples, {
        x: omt * omt * ax + 2 * omt * t * curr.x + t * t * bx,
        y: omt * omt * ay + 2 * omt * t * curr.y + t * t * by,
        z: omt * omt * az + 2 * omt * t * curr.z + t * t * bz,
      });
    }
  }

  addSample(samples, points[points.length - 1]);
  return samples;
}

/**
 * Builds a queryable spine from `points`.
 *
 * @param {Array<{x: number, y: number, z: number}>} points
 * @param {{ samplingStep?: number, cornerRadius?: number }} [options]
 */
export function buildTunnelSpine(points, { samplingStep = 0.75, cornerRadius = 4.5 } = {}) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('Tunnel spine: requires at least 2 points.');
  }
  points.forEach(validatePoint);

  const stations = points.length === 2
    ? [{ ...points[0] }, { ...points[1] }]
    : buildStations(points, samplingStep, cornerRadius);

  const segments = [];
  let totalLength = 0;
  let totalPlanLength = 0;
  let lastDirX = 0, lastDirZ = -1;

  for (let i = 0; i < stations.length - 1; i += 1) {
    const a = stations[i], b = stations[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const planLen = Math.hypot(dx, dz);
    const len3d = Math.hypot(dx, dy, dz) || 1e-6;
    const dirX = planLen > 1e-6 ? dx / planLen : lastDirX;
    const dirZ = planLen > 1e-6 ? dz / planLen : lastDirZ;
    lastDirX = dirX;
    lastDirZ = dirZ;
    // Right-hand horizontal vector looking from a toward b (world up is +Y).
    const rightX = -dirZ;
    const rightZ = dirX;
    segments.push({
      ax: a.x, ay: a.y, az: a.z,
      bx: b.x, by: b.y, bz: b.z,
      dx, dy, dz,
      planLen: planLen || 1e-6,
      planLenSq: (planLen * planLen) || 1e-12,
      len3d,
      dirX, dirZ,
      rightX, rightZ,
      sStart: totalLength,
      sEnd: totalLength + len3d,
      planStart: totalPlanLength,
      planEnd: totalPlanLength + planLen,
      curvature: 0,
    });
    totalLength += len3d;
    totalPlanLength += planLen;
  }

  // Compute smooth turn rate (rad/m) at each segment midpoint so bends can widen naturally.
  for (let i = 0; i < segments.length; i += 1) {
    const prev = segments[Math.max(0, i - 1)];
    const next = segments[Math.min(segments.length - 1, i + 1)];
    const dot = clamp(prev.dirX * next.dirX + prev.dirZ * next.dirZ, -1, 1);
    const span = (prev.len3d + next.len3d) * 0.5 || 1;
    segments[i].curvature = Math.acos(dot) / span;
  }

  const first = segments[0];
  const last = segments[segments.length - 1];

  // Fast-path for straight 2-point tunnels (single segment).
  if (segments.length === 1) {
    return {
      stations,
      segments,
      totalLength,
      boundsMin: {
        x: Math.min(first.ax, first.bx),
        y: Math.min(first.ay, first.by),
        z: Math.min(first.az, first.bz),
      },
      boundsMax: {
        x: Math.max(first.ax, first.bx),
        y: Math.max(first.ay, first.by),
        z: Math.max(first.az, first.bz),
      },
      project(x, y, z) {
        const rx = x - first.ax, rz = z - first.az;
        const along = rx * first.dirX + rz * first.dirZ;
        const clamped = clamp(along, 0, first.planLen);
        const t = clamped / first.planLen;
        const qx = first.ax + first.dx * t;
        const qz = first.az + first.dz * t;
        const floorY = first.ay + first.dy * t;
        const across = (x - qx) * first.rightX + (z - qz) * first.rightZ;
        const endOverflow = along < 0 ? -along : (along > first.planLen ? along - first.planLen : 0);
        return {
          s: t * totalLength,
          across,
          above: y - floorY,
          floorY,
          endOverflow,
          curvature: 0,
          dirX: first.dirX,
          dirZ: first.dirZ,
          rightX: first.rightX,
          rightZ: first.rightZ,
        };
      },
    };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const st of stations) {
    if (st.x < minX) minX = st.x;
    if (st.y < minY) minY = st.y;
    if (st.z < minZ) minZ = st.z;
    if (st.x > maxX) maxX = st.x;
    if (st.y > maxY) maxY = st.y;
    if (st.z > maxZ) maxZ = st.z;
  }

  return {
    stations,
    segments,
    totalLength,
    boundsMin: { x: minX, y: minY, z: minZ },
    boundsMax: { x: maxX, y: maxY, z: maxZ },
    project(x, y, z) {
      let bestDistSq = Infinity;
      let bestSeg = first;
      let bestT = 0;
      let bestQx = first.ax;
      let bestQz = first.az;

      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        const t = clamp(((x - seg.ax) * seg.dx + (z - seg.az) * seg.dz) / seg.planLenSq, 0, 1);
        const qx = seg.ax + seg.dx * t;
        const qz = seg.az + seg.dz * t;
        const distSq = (x - qx) * (x - qx) + (z - qz) * (z - qz);
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestSeg = seg;
          bestT = t;
          bestQx = qx;
          bestQz = qz;
        }
      }

      const floorY = bestSeg.ay + bestSeg.dy * bestT;
      const s = bestSeg.sStart + bestSeg.len3d * bestT;
      const dx = x - bestQx, dz = z - bestQz;
      const signed = dx * bestSeg.rightX + dz * bestSeg.rightZ;
      const dist = Math.sqrt(bestDistSq);

      let endOverflow = 0;
      let across = signed >= 0 ? dist : -dist;
      if (bestSeg === first && bestT === 0) {
        const along = (x - first.ax) * first.dirX + (z - first.az) * first.dirZ;
        if (along < 0) {
          endOverflow = -along;
          across = (x - first.ax) * first.rightX + (z - first.az) * first.rightZ;
        }
      } else if (bestSeg === last && bestT === 1) {
        const along = (x - last.bx) * last.dirX + (z - last.bz) * last.dirZ;
        if (along > 0) {
          endOverflow = along;
          across = (x - last.bx) * last.rightX + (z - last.bz) * last.rightZ;
        }
      }

      return {
        s,
        across,
        above: y - floorY,
        floorY,
        endOverflow,
        curvature: bestSeg.curvature,
        dirX: bestSeg.dirX,
        dirZ: bestSeg.dirZ,
        rightX: bestSeg.rightX,
        rightZ: bestSeg.rightZ,
      };
    },
  };
}
