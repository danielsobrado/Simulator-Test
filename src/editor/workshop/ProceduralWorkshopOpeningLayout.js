import { getComponentTransform } from './ProceduralWorkshopComponentTransforms.js';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapSurfaceX(value, circumference) {
  if (!(circumference > 0)) return value;
  const half = circumference / 2;
  return ((value + half) % circumference + circumference) % circumference - half;
}

function unwrapSurfaceX(value, anchor, circumference) {
  if (!(circumference > 0)) return value;
  return anchor + wrapSurfaceX(value - anchor, circumference);
}

function openingForPlacement(recipe, source, componentId, host, attachment = null) {
  const transform = attachment
    ? {
      position: [attachment.position[0], attachment.position[1], 0],
      scale: [attachment.scale[0], attachment.scale[1], 1],
    }
    : getComponentTransform(recipe.componentTransforms, componentId);
  const width = clamp(
    source.width * transform.scale[0],
    0.24,
    Math.max(0.24, host.width * 0.42),
  );
  const radiusRatio = Math.max(
    0.5,
    source.radius / Math.max(0.01, source.width),
  );
  const radius = Math.max(0.1, width * radiusRatio);
  const springHeight = clamp(
    source.springHeight * transform.scale[1],
    0.3,
    Math.max(0.3, host.height - radius - 0.2),
  );
  const maximumBottom = Math.max(0, host.height - springHeight - radius - 0.12);
  const bottom = clamp(
    attachment ? transform.position[1] : source.bottom + transform.position[1],
    0,
    maximumBottom,
  );
  const surfaceX = attachment
    ? transform.position[0]
    : (source.surfaceX ?? source.centerX ?? 0) + transform.position[0];
  const maximumSurfaceX = host.type === 'round'
    ? Math.PI * host.radius
    : Math.max(0, host.width / 2 - width / 2 - 0.12);
  const clampedSurfaceX = clamp(surfaceX, -maximumSurfaceX, maximumSurfaceX);
  return {
    ...source,
    componentId,
    componentLabel: componentId === source.componentId
      ? source.componentLabel
      : `${source.componentLabel ?? 'Opening'} copy`,
    hostId: host.id,
    centerX: host.type === 'round' ? 0 : clampedSurfaceX,
    surfaceX: clampedSurfaceX,
    angle: host.type === 'round'
      ? (host.baseAngle ?? 0) + clampedSurfaceX / Math.max(0.1, host.radius)
      : source.angle,
    bottom,
    width,
    radius,
    springHeight,
  };
}

function openingKind(opening) {
  return opening.door ? 'door' : 'window';
}

function assemblyForLayout(assemblyId, assembly, openings, host, attachments) {
  const members = assembly.memberIds.map((memberId) => {
    if (!attachments[memberId]) {
      throw new Error(`Opening assembly ${assemblyId} member ${memberId} has no attachment.`);
    }
    const opening = openings.get(memberId);
    if (!opening) {
      throw new Error(`Opening assembly ${assemblyId} has unknown member ${memberId}.`);
    }
    if (opening.hostId !== assembly.hostId) {
      throw new Error(`Opening assembly ${assemblyId} members must share host ${assembly.hostId}.`);
    }
    if (openingKind(opening) !== assembly.kind) {
      throw new Error(`Opening assembly ${assemblyId} members must all be ${assembly.kind}s.`);
    }
    return opening;
  });
  const circumference = host.type === 'round' ? Math.PI * 2 * host.radius : 0;
  const anchor = members[0].surfaceX;
  const positioned = members.map((member) => ({
    member,
    surfaceX: unwrapSurfaceX(member.surfaceX, anchor, circumference),
  })).sort((left, right) => (
    left.surfaceX - right.surfaceX
    || left.member.componentId.localeCompare(right.member.componentId)
  ));
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  for (const { member, surfaceX } of positioned) {
    left = Math.min(left, surfaceX - member.width / 2);
    right = Math.max(right, surfaceX + member.width / 2);
    bottom = Math.min(bottom, member.bottom);
    top = Math.max(top, member.bottom + member.springHeight + member.radius);
  }
  const rawCenter = (left + right) / 2;
  const surfaceX = wrapSurfaceX(rawCenter, circumference);
  const height = Math.max(0.3, top - bottom);
  const memberOpenings = positioned.map(({ member, surfaceX: unwrappedX }) => Object.freeze({
    ...member,
    assemblySurfaceX: unwrappedX,
  }));
  return Object.freeze({
    ...members[0],
    componentId: assemblyId,
    componentLabel: `${members.length}-panel ${assembly.kind}`,
    hostId: assembly.hostId,
    door: assembly.kind === 'door',
    centerX: host.type === 'round' ? 0 : rawCenter,
    surfaceX,
    angle: host.type === 'round'
      ? (host.baseAngle ?? 0) + surfaceX / Math.max(0.1, host.radius)
      : members[0].angle,
    bottom,
    width: Math.max(0.24, right - left),
    springHeight: height,
    radius: 0,
    rectangular: true,
    assemblyId,
    memberIds: Object.freeze(positioned.map(({ member }) => member.componentId)),
    memberOpenings: Object.freeze(memberOpenings),
    assemblySurfaceStart: left,
    assemblySurfaceEnd: right,
  });
}

export function resolveWorkshopOpeningLayout(recipe, baseOpenings, hosts) {
  const hostMap = new Map(hosts.map((host) => [host.id, host]));
  const sourceMap = new Map(baseOpenings.map((opening) => [opening.componentId, opening]));
  const result = new Map(hosts.map((host) => [host.id, []]));
  const attachments = recipe.openingAttachments ?? {};
  const resolvedById = new Map();

  for (const source of baseOpenings) {
    const attachment = attachments[source.componentId];
    const host = hostMap.get(attachment?.hostId ?? source.hostId);
    if (!host) continue;
    const opening = openingForPlacement(
      recipe,
      source,
      source.componentId,
      host,
      attachment,
    );
    result.get(host.id).push(opening);
    resolvedById.set(opening.componentId, opening);
  }

  for (const [componentId, attachment] of Object.entries(attachments)) {
    if (sourceMap.has(componentId)) continue;
    const source = sourceMap.get(attachment.sourceId);
    const host = hostMap.get(attachment.hostId);
    if (!source || !host) continue;
    const opening = openingForPlacement(
      recipe,
      source,
      componentId,
      host,
      attachment,
    );
    result.get(host.id).push(opening);
    resolvedById.set(opening.componentId, opening);
  }

  const assembledMembers = new Set();
  for (const [assemblyId, assembly] of Object.entries(recipe.openingAssemblies ?? {})) {
    const host = hostMap.get(assembly.hostId);
    if (!host) throw new Error(`Opening assembly ${assemblyId} has unknown host ${assembly.hostId}.`);
    const composite = assemblyForLayout(
      assemblyId,
      assembly,
      resolvedById,
      host,
      attachments,
    );
    assembly.memberIds.forEach((memberId) => assembledMembers.add(memberId));
    result.get(host.id).push(composite);
  }

  if (assembledMembers.size > 0) {
    for (const [hostId, openings] of result) {
      result.set(hostId, openings.filter((opening) => !assembledMembers.has(opening.componentId)));
    }
  }

  for (const openings of result.values()) {
    openings.sort((left, right) => (
      left.bottom - right.bottom
      || left.surfaceX - right.surfaceX
      || left.componentId.localeCompare(right.componentId)
    ));
  }
  return result;
}
