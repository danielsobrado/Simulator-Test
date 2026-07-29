import * as THREE from 'three';

const BINARY_REFINEMENT_STEPS = 8;
const HEIGHT_LIMIT_M = 10000;
const MAX_RAYCAST_STEPS = 128;
const MIN_RAYCAST_STEP_M = 0.25;
const RAYCAST_HIT_EPSILON_M = 0.04;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function validateRay(ray, maxDistance) {
  return ray instanceof THREE.Ray
    && Number.isFinite(maxDistance)
    && maxDistance > 0
    && ray.direction.lengthSq() > 1e-10;
}

function sampleHeightError(terrainView, ray, distance, point) {
  point.copy(ray.origin).addScaledVector(ray.direction, distance);
  return point.y - terrainView.getWorldHeight(point.x, point.z);
}

function terrainNormalAt(terrainView, point, target) {
  const sampleOffset = Math.max(
    MIN_RAYCAST_STEP_M,
    (terrainView.worldStore?.tileSize ?? 1) * 0.35,
  );
  const left = terrainView.getWorldHeight(point.x - sampleOffset, point.z);
  const right = terrainView.getWorldHeight(point.x + sampleOffset, point.z);
  const down = terrainView.getWorldHeight(point.x, point.z - sampleOffset);
  const up = terrainView.getWorldHeight(point.x, point.z + sampleOffset);
  return target
    .set(
      -(right - left) / (2 * sampleOffset),
      1,
      -(up - down) / (2 * sampleOffset),
    )
    .normalize();
}

export function applyEarthTerrainEdit(terrainView, renderPoint, config) {
  if (!terrainView?.heightField || !terrainView?.floatingOrigin || !config?.enabled) {
    return Object.freeze({ ok: false, changed: false, reason: 'terrain-edit-unavailable' });
  }
  if (config.shape !== 'sphere' && config.shape !== 'cube') {
    return Object.freeze({ ok: false, changed: false, reason: 'unsupported-earth-shape' });
  }

  const tileSize = terrainView.worldStore.tileSize;
  const canonical = terrainView.floatingOrigin.toCanonical(renderPoint.x, renderPoint.z);
  const centerX = Math.floor(canonical.x / tileSize);
  const centerZ = Math.floor(-canonical.z / tileSize);
  const radiusCells = Math.max(0.5, config.radiusM / tileSize);
  const brushSize = Math.max(1, Math.round(radiusCells * 2 - 1));
  const operation = config.operation === 'add' ? 'raise' : 'lower';
  const strength = Math.max(0.01, config.heightM * config.strength);

  const patch = terrainView.heightField.sculpt({
    centerX,
    centerZ,
    brushSize,
    shape: config.shape,
    operation,
    strength,
    smoothFactor: clamp(1 - config.falloff, 0, 1),
    minHeight: -HEIGHT_LIMIT_M,
    maxHeight: HEIGHT_LIMIT_M,
  });
  const changed = patch.indices.length > 0;
  return Object.freeze({
    ok: true,
    changed,
    revision: terrainView.worldStore.revision,
    patch,
  });
}

function createHit(terrainView, ray, distance, point, normal) {
  point.copy(ray.origin).addScaledVector(ray.direction, distance);
  point.y = terrainView.getWorldHeight(point.x, point.z);
  terrainNormalAt(terrainView, point, normal);
  const hitPoint = point.clone();
  const hitNormal = normal.clone();
  return Object.freeze({
    point: hitPoint,
    normal: hitNormal,
    distance,
    commitEarthEdit: (config) => applyEarthTerrainEdit(terrainView, hitPoint, config),
  });
}

/**
 * Heightfield raycast that remains stable for shallow camera angles.
 *
 * The previous Newton-style step used only ray Y and could jump behind the
 * camera on the first iteration. This scans a bounded interval, then refines
 * the first terrain crossing. Fireball segments stay cheap because their
 * maxDistance is short.
 */
export function raycastTerrainHeightfield(terrainView, ray, maxDistance = 40) {
  if (!validateRay(ray, maxDistance)) return null;

  const normalizedRay = new THREE.Ray(ray.origin.clone(), ray.direction.clone().normalize());
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3(0, 1, 0);
  const tileSize = terrainView.worldStore?.tileSize ?? 1;
  const stepSize = clamp(tileSize * 0.25, MIN_RAYCAST_STEP_M, 1);
  const stepCount = Math.min(MAX_RAYCAST_STEPS, Math.max(1, Math.ceil(maxDistance / stepSize)));
  const actualStep = maxDistance / stepCount;

  let previousDistance = 0;
  const initialError = sampleHeightError(terrainView, normalizedRay, 0, point);
  if (initialError <= RAYCAST_HIT_EPSILON_M) {
    return createHit(terrainView, normalizedRay, 0, point, normal);
  }

  for (let index = 1; index <= stepCount; index += 1) {
    const distance = index * actualStep;
    const error = sampleHeightError(terrainView, normalizedRay, distance, point);
    if (error <= 0) {
      let low = previousDistance;
      let high = distance;
      for (let refinement = 0; refinement < BINARY_REFINEMENT_STEPS; refinement += 1) {
        const middle = (low + high) * 0.5;
        const middleError = sampleHeightError(terrainView, normalizedRay, middle, point);
        if (middleError > 0) low = middle;
        else high = middle;
      }
      return createHit(terrainView, normalizedRay, high, point, normal);
    }
    previousDistance = distance;
  }

  return null;
}
