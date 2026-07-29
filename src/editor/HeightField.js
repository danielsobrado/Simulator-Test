const HEIGHT_EPSILON = 1e-4;
const VALID_OPERATIONS = new Set(['raise', 'lower', 'smooth']);
const VALID_SHAPES = new Set(['sphere', 'cube']);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothFalloff(distance, radius) {
  const normalized = clamp(1 - distance / radius, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function brushDistance(shape, x, z, centerX, centerZ) {
  const offsetX = Math.abs(x - centerX);
  const offsetZ = Math.abs(z - centerZ);
  return shape === 'cube' ? Math.max(offsetX, offsetZ) : Math.hypot(offsetX, offsetZ);
}

export class HeightField {
  constructor({ width, height }) {
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error('Heightfield dimensions must be positive integers.');
    }

    this.width = width;
    this.height = height;
    this.vertexWidth = width + 1;
    this.vertexHeight = height + 1;
    this.heights = new Float32Array(this.vertexWidth * this.vertexHeight);
  }

  get vertexCount() {
    return this.heights.length;
  }

  inBoundsVertex(x, z) {
    return x >= 0 && z >= 0 && x < this.vertexWidth && z < this.vertexHeight;
  }

  indexOf(x, z) {
    return z * this.vertexWidth + x;
  }

  coordinatesOf(index) {
    return { x: index % this.vertexWidth, z: Math.floor(index / this.vertexWidth) };
  }

  getVertex(x, z) {
    return this.inBoundsVertex(x, z) ? this.heights[this.indexOf(x, z)] : null;
  }

  sample(cellX, cellZ) {
    const x = clamp(cellX, 0, this.width);
    const z = clamp(cellZ, 0, this.height);
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = Math.min(this.width, x0 + 1);
    const z1 = Math.min(this.height, z0 + 1);
    const tx = x - x0;
    const tz = z - z0;

    const northWest = this.heights[this.indexOf(x0, z0)];
    const northEast = this.heights[this.indexOf(x1, z0)];
    const southWest = this.heights[this.indexOf(x0, z1)];
    const southEast = this.heights[this.indexOf(x1, z1)];
    const north = northWest + (northEast - northWest) * tx;
    const south = southWest + (southEast - southWest) * tx;
    return north + (south - north) * tz;
  }

  getCellHeight(x, z) {
    if (x < 0 || z < 0 || x >= this.width || z >= this.height) {
      return null;
    }
    return this.sample(x + 0.5, z + 0.5);
  }

  sculpt({
    centerX,
    centerZ,
    brushSize,
    shape = 'sphere',
    operation,
    strength,
    smoothFactor,
    minHeight,
    maxHeight,
    canEdit = null,
  }) {
    if (!VALID_OPERATIONS.has(operation)) {
      throw new Error(`Unknown heightfield operation: ${operation}.`);
    }
    if (!VALID_SHAPES.has(shape)) {
      throw new Error(`Unknown heightfield brush shape: ${shape}.`);
    }

    const radius = Math.max(1, (brushSize + 1) / 2);
    const centerVertexX = centerX + 0.5;
    const centerVertexZ = centerZ + 0.5;
    const minimumX = Math.max(0, Math.floor(centerVertexX - radius));
    const maximumX = Math.min(this.width, Math.ceil(centerVertexX + radius));
    const minimumZ = Math.max(0, Math.floor(centerVertexZ - radius));
    const maximumZ = Math.min(this.height, Math.ceil(centerVertexZ + radius));
    const source = operation === 'smooth' ? new Float32Array(this.heights) : this.heights;
    const patch = { indices: [], before: [], after: [] };

    for (let z = minimumZ; z <= maximumZ; z += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const distance = brushDistance(shape, x, z, centerVertexX, centerVertexZ);
        if (distance > radius) {
          continue;
        }

        const index = this.indexOf(x, z);
        if (canEdit && !canEdit(x, z, index)) {
          continue;
        }

        const before = this.heights[index];
        const falloff = smoothFalloff(distance, radius);
        let after = before;

        if (operation === 'raise') {
          after = clamp(before + strength * falloff, minHeight, maxHeight);
        } else if (operation === 'lower') {
          after = clamp(before - strength * falloff, minHeight, maxHeight);
        } else {
          const average = this.averageNeighbors(source, x, z);
          after = clamp(
            before + (average - before) * smoothFactor * falloff,
            minHeight,
            maxHeight,
          );
        }

        if (Math.abs(after - before) <= HEIGHT_EPSILON) {
          continue;
        }

        this.heights[index] = after;
        patch.indices.push(index);
        patch.before.push(before);
        patch.after.push(after);
      }
    }

    return patch;
  }

  averageNeighbors(source, centerX, centerZ) {
    let total = 0;
    let count = 0;
    for (let z = Math.max(0, centerZ - 1); z <= Math.min(this.height, centerZ + 1); z += 1) {
      for (let x = Math.max(0, centerX - 1); x <= Math.min(this.width, centerX + 1); x += 1) {
        total += source[this.indexOf(x, z)];
        count += 1;
      }
    }
    return total / count;
  }

  applyPatch(patch, direction) {
    const values = direction === 'undo' ? patch.before : patch.after;
    for (let offset = 0; offset < patch.indices.length; offset += 1) {
      this.heights[patch.indices[offset]] = values[offset];
    }
  }

  fill(value = 0) {
    const patch = { indices: [], before: [], after: [] };
    for (let index = 0; index < this.heights.length; index += 1) {
      const before = this.heights[index];
      if (Math.abs(before - value) <= HEIGHT_EPSILON) {
        continue;
      }
      this.heights[index] = value;
      patch.indices.push(index);
      patch.before.push(before);
      patch.after.push(value);
    }
    return patch;
  }

  replaceHeights(values) {
    if (!(values instanceof Float32Array) || values.length !== this.vertexCount) {
      throw new Error('Heightfield payload has an invalid size.');
    }
    this.heights.set(values);
  }

  toDocument() {
    const values = [];
    for (let index = 0; index < this.heights.length; index += 1) {
      const value = this.heights[index];
      if (Math.abs(value) > HEIGHT_EPSILON) {
        values.push([index, value]);
      }
    }
    return {
      width: this.width,
      height: this.height,
      values,
    };
  }

  loadDocument(document) {
    if (document === null || document === undefined) {
      this.heights.fill(0);
      return;
    }
    if (document.width !== this.width || document.height !== this.height) {
      throw new Error(`Heightfield dimensions must be ${this.width} × ${this.height}.`);
    }
    if (!Array.isArray(document.values)) {
      throw new Error('Heightfield values must be an array.');
    }

    const next = new Float32Array(this.vertexCount);
    for (const entry of document.values) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new Error('Heightfield entries must contain an index and value.');
      }
      const [index, value] = entry;
      if (!Number.isInteger(index) || index < 0 || index >= this.vertexCount) {
        throw new Error(`Heightfield index is out of bounds: ${index}.`);
      }
      if (!Number.isFinite(value)) {
        throw new Error(`Heightfield value must be finite at index ${index}.`);
      }
      next[index] = value;
    }
    this.heights.set(next);
  }
}
