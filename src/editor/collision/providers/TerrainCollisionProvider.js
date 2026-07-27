const MINIMUM_SAMPLE_DISTANCE = 1e-3;
const NORMAL_EPSILON = 1e-9;

function assertFinite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`Terrain collision ${name} must be finite.`);
}

function cleanZero(value) {
  return Math.abs(value) <= NORMAL_EPSILON ? 0 : value;
}

function normalise3(x, y, z) {
  const length = Math.hypot(x, y, z);
  if (length <= NORMAL_EPSILON) return Object.freeze({ x: 0, y: 1, z: 0 });
  return Object.freeze({
    x: cleanZero(x / length),
    y: cleanZero(y / length),
    z: cleanZero(z / length),
  });
}

export class TerrainCollisionProvider {
  constructor({ getHeight, sampleDistance = 0.35 }) {
    if (typeof getHeight !== 'function') {
      throw new Error('Terrain collision provider requires getHeight.');
    }
    if (!Number.isFinite(sampleDistance) || sampleDistance < MINIMUM_SAMPLE_DISTANCE) {
      throw new Error('Terrain collision sampleDistance must be positive.');
    }
    this.getHeight = getHeight;
    this.sampleDistance = sampleDistance;
  }

  sample(x, z, radius = this.sampleDistance) {
    assertFinite(x, 'x');
    assertFinite(z, 'z');
    const distance = Math.max(
      MINIMUM_SAMPLE_DISTANCE,
      Number.isFinite(radius) ? radius : this.sampleDistance,
    );
    const height = this.getHeight(x, z);
    const left = this.getHeight(x - distance, z);
    const right = this.getHeight(x + distance, z);
    const near = this.getHeight(x, z - distance);
    const far = this.getHeight(x, z + distance);
    for (const [name, value] of Object.entries({ height, left, right, near, far })) {
      assertFinite(value, name);
    }
    const gradientX = (right - left) / (distance * 2);
    const gradientZ = (far - near) / (distance * 2);
    const normal = normalise3(-gradientX, 1, -gradientZ);
    return Object.freeze({
      sourceId: 'terrain',
      height,
      normal,
      walkable: true,
    });
  }

  constrainMovement({
    startX,
    startZ,
    endX,
    endZ,
    radius,
    maximumSlopeCosine,
  }) {
    const support = this.sample(endX, endZ, radius);
    if (support.normal.y >= maximumSlopeCosine) {
      return Object.freeze({ x: endX, z: endZ, support, constrained: false });
    }

    const displacementX = endX - startX;
    const displacementZ = endZ - startZ;
    const gradientX = -support.normal.x / Math.max(NORMAL_EPSILON, support.normal.y);
    const gradientZ = -support.normal.z / Math.max(NORMAL_EPSILON, support.normal.y);
    const gradientLength = Math.hypot(gradientX, gradientZ);
    if (gradientLength <= NORMAL_EPSILON) {
      return Object.freeze({ x: endX, z: endZ, support, constrained: false });
    }

    const uphillX = gradientX / gradientLength;
    const uphillZ = gradientZ / gradientLength;
    const uphillAmount = displacementX * uphillX + displacementZ * uphillZ;
    if (uphillAmount <= 0) {
      return Object.freeze({ x: endX, z: endZ, support, constrained: false });
    }

    const x = startX + displacementX - uphillX * uphillAmount;
    const z = startZ + displacementZ - uphillZ * uphillAmount;
    return Object.freeze({
      x,
      z,
      support: this.sample(x, z, radius),
      constrained: true,
    });
  }
}
