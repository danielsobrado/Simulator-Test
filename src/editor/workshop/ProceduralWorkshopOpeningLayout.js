import { getComponentTransform } from './ProceduralWorkshopComponentTransforms.js';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
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
  const radiusRatio = source.radius / Math.max(0.01, source.width);
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

export function resolveWorkshopOpeningLayout(recipe, baseOpenings, hosts) {
  const hostMap = new Map(hosts.map((host) => [host.id, host]));
  const sourceMap = new Map(baseOpenings.map((opening) => [opening.componentId, opening]));
  const result = new Map(hosts.map((host) => [host.id, []]));
  const attachments = recipe.openingAttachments ?? {};

  for (const source of baseOpenings) {
    const attachment = attachments[source.componentId];
    const host = hostMap.get(attachment?.hostId ?? source.hostId);
    if (!host) continue;
    result.get(host.id).push(openingForPlacement(
      recipe,
      source,
      source.componentId,
      host,
      attachment,
    ));
  }

  for (const [componentId, attachment] of Object.entries(attachments)) {
    if (sourceMap.has(componentId)) continue;
    const source = sourceMap.get(attachment.sourceId);
    const host = hostMap.get(attachment.hostId);
    if (!source || !host) continue;
    result.get(host.id).push(openingForPlacement(
      recipe,
      source,
      componentId,
      host,
      attachment,
    ));
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
