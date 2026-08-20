import { WORKSHOP_GEOMETRY_TOLERANCE } from '../../curves/GeometryTolerancePolicy.js';
import { DEFAULT_WALL_MAX_MITER_RATIO } from './WallConstants.js';

function unit(vector, fallback) {
  const length = Math.hypot(vector[0], vector[1]);
  if (length <= WORKSHOP_GEOMETRY_TOLERANCE.angle) return [...fallback];
  return [vector[0] / length, vector[1] / length];
}

function normalForTangent(tangent) {
  return [-tangent[1], tangent[0]];
}

function miterJoin(currentTangent, nextTangent, halfThickness, maxMiterRatio) {
  const currentNormal = normalForTangent(currentTangent);
  const nextNormal = normalForTangent(nextTangent);
  const blended = unit([
    currentNormal[0] + nextNormal[0],
    currentNormal[1] + nextNormal[1],
  ], currentNormal);
  const alignment = Math.abs(blended[0] * currentNormal[0] + blended[1] * currentNormal[1]);
  const rawRatio = alignment <= WORKSHOP_GEOMETRY_TOLERANCE.angle ? maxMiterRatio : 1 / alignment;
  const miterRatio = Math.min(maxMiterRatio, Math.max(1, rawRatio));
  return { normal: blended, offset: halfThickness * miterRatio, miterRatio };
}

function sectionJoin(samples, index, halfThickness, maxMiterRatio) {
  const sample = samples[index];
  const previous = index > 0 ? samples[index - 1] : null;
  const next = index + 1 < samples.length ? samples[index + 1] : null;
  if (!previous || !next) {
    return { normal: normalForTangent(sample.tangent), offset: halfThickness, miterRatio: 1 };
  }
  return miterJoin(previous.tangent, next.tangent, halfThickness, maxMiterRatio);
}

export function resolveWallSectionOffsets(samples, thickness, {
  maxMiterRatio = DEFAULT_WALL_MAX_MITER_RATIO,
} = {}) {
  if (!Array.isArray(samples) || samples.length < 2) throw new Error('Wall joins require at least two samples.');
  if (!Number.isFinite(thickness) || thickness <= 0) throw new Error('Wall join thickness must be positive.');
  if (!Number.isFinite(maxMiterRatio) || maxMiterRatio < 1) throw new Error('Wall max miter ratio must be at least one.');
  const halfThickness = thickness / 2;
  return Object.freeze(samples.map((sample, index) => {
    const join = sectionJoin(samples, index, halfThickness, maxMiterRatio);
    return Object.freeze({
      ...sample,
      normal: Object.freeze(join.normal),
      miterRatio: join.miterRatio,
      left: Object.freeze([
        sample.point[0] + join.normal[0] * join.offset,
        sample.point[1] + join.normal[1] * join.offset,
      ]),
      right: Object.freeze([
        sample.point[0] - join.normal[0] * join.offset,
        sample.point[1] - join.normal[1] * join.offset,
      ]),
    });
  }));
}

function socketsNear(left, right, tolerance) {
  return Math.hypot(
    left.point[0] - right.point[0],
    left.point[1] - right.point[1],
  ) <= tolerance;
}

export function resolveWallEndpointJoins(
  plans,
  tolerance = WORKSHOP_GEOMETRY_TOLERANCE.position,
) {
  if (!Array.isArray(plans)) throw new Error('Wall endpoint joins require wall plans.');
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Wall endpoint join tolerance must be positive.');
  const sockets = plans
    .flatMap((plan) => plan.endpointSockets ?? [])
    .sort((left, right) => left.id.localeCompare(right.id));
  const consumed = new Set();
  const joins = [];

  for (const socket of sockets) {
    if (consumed.has(socket.id)) continue;
    const members = [];
    const pending = [socket];
    consumed.add(socket.id);
    while (pending.length > 0) {
      const member = pending.shift();
      members.push(member);
      for (const candidate of sockets) {
        if (consumed.has(candidate.id) || !socketsNear(member, candidate, tolerance)) continue;
        consumed.add(candidate.id);
        pending.push(candidate);
      }
    }
    if (members.length < 2) continue;
    const socketIds = members.map(({ id }) => id).sort();
    joins.push(Object.freeze({
      id: `join:${socketIds.join('+')}`,
      socketIds: Object.freeze(socketIds),
      point: Object.freeze([
        members.reduce((sum, member) => sum + member.point[0], 0) / members.length,
        members.reduce((sum, member) => sum + member.point[1], 0) / members.length,
      ]),
    }));
  }
  return Object.freeze(joins.sort((left, right) => left.id.localeCompare(right.id)));
}
