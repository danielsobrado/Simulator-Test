export const VOXEL_STAMP_OPERATIONS = Object.freeze(['add', 'subtract', 'smooth']);
export const VOXEL_STAMP_OPERATION_CODES = Object.freeze({
  add: 0,
  subtract: 1,
  smooth: 2,
});

function cloneStamp(stamp) {
  return Object.freeze({
    id: stamp.id,
    operation: stamp.operation,
    center: Object.freeze([...stamp.center]),
    radius: stamp.radius,
    strength: stamp.strength,
    smoothness: stamp.smoothness,
  });
}

function assertCellDimensions(value, fieldName, { allowUnboundedXZ = false } = {}) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${fieldName} must contain three dimensions.`);
  }
  for (let axis = 0; axis < value.length; axis += 1) {
    if (allowUnboundedXZ && axis !== 1 && value[axis] === 0) {
      continue;
    }
    if (!Number.isInteger(value[axis]) || value[axis] < 1) {
      throw new Error(`${fieldName} must contain positive integers.`);
    }
  }
}

function assertFinite(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw new Error(`Voxel stamp ${fieldName} must be finite.`);
  }
}

function assertUnitInterval(value, fieldName) {
  assertFinite(value, fieldName);
  if (value < 0 || value > 1) {
    throw new Error(`Voxel stamp ${fieldName} must be within [0, 1].`);
  }
}

export class VoxelStampStore {
  constructor({ cells, maxStamps, unboundedXZ = false }) {
    assertCellDimensions(cells, 'Voxel stamp store cells', { allowUnboundedXZ: unboundedXZ });
    if (!Number.isInteger(maxStamps) || maxStamps < 1) {
      throw new Error('Voxel stamp store maxStamps must be a positive integer.');
    }

    this.unboundedXZ = Boolean(unboundedXZ);
    this.cells = Object.freeze([...cells]);
    this.maxStamps = maxStamps;
    this.stamps = [];
    this.nextId = 1;
    this.listeners = new Set();
  }

  get size() {
    return this.stamps.length;
  }

  list() {
    return this.stamps.map(cloneStamp);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  add(input) {
    if (this.stamps.length >= this.maxStamps) {
      throw new Error(`Voxel stamp capacity is ${this.maxStamps}.`);
    }
    const stamp = this.normalizeStamp({ ...input, id: this.nextId });
    this.nextId += 1;
    this.stamps.push(stamp);
    this.emit();
    return cloneStamp(stamp);
  }

  clear() {
    const before = this.list();
    if (before.length === 0) {
      return before;
    }
    this.stamps = [];
    this.emit();
    return before;
  }

  replaceAll(values) {
    if (!Array.isArray(values)) {
      throw new Error('Voxel stamp document must be an array.');
    }
    if (values.length > this.maxStamps) {
      throw new Error(`Voxel stamp document exceeds capacity ${this.maxStamps}.`);
    }

    const ids = new Set();
    const stamps = values.map((value) => {
      const stamp = this.normalizeStamp(value);
      if (ids.has(stamp.id)) {
        throw new Error(`Voxel stamp ID ${stamp.id} is duplicated.`);
      }
      ids.add(stamp.id);
      return stamp;
    });

    this.stamps = stamps;
    this.nextId = stamps.reduce((maximum, stamp) => Math.max(maximum, stamp.id), 0) + 1;
    this.emit();
  }

  applyChange(change, direction) {
    const target = direction === 'undo' ? change.before : change.after;
    const inverse = direction === 'undo' ? change.after : change.before;
    if (inverse) {
      const index = this.stamps.findIndex((stamp) => stamp.id === inverse.id);
      if (index >= 0) {
        this.stamps.splice(index, 1);
      }
    }
    if (target) {
      const restored = this.normalizeStamp(target);
      if (this.stamps.some((stamp) => stamp.id === restored.id)) {
        throw new Error(`Voxel stamp ID ${restored.id} already exists.`);
      }
      this.stamps.push(restored);
      this.stamps.sort((left, right) => left.id - right.id);
      this.nextId = Math.max(this.nextId, restored.id + 1);
    }
    this.emit();
  }

  toDocument() {
    return this.list().map((stamp) => ({
      id: stamp.id,
      operation: stamp.operation,
      center: [...stamp.center],
      radius: stamp.radius,
      strength: stamp.strength,
      smoothness: stamp.smoothness,
    }));
  }

  toMetadata() {
    return this.unboundedXZ
      ? { unboundedXZ: true, cellsY: this.cells[1] }
      : { cells: [...this.cells] };
  }

  loadDocument(document, { sourceCells = null, sourceUnboundedXZ = false } = {}) {
    let offset = [0, 0, 0];
    if (this.unboundedXZ) {
      if (!sourceUnboundedXZ && Array.isArray(sourceCells) && sourceCells[0] > 0 && sourceCells[2] > 0) {
        offset = [-sourceCells[0] * 0.5, 0, -sourceCells[2] * 0.5];
      }
    } else if (sourceCells) {
      assertCellDimensions(sourceCells, 'Voxel stamp source cells');
      offset = sourceCells.map((size, axis) => {
        if (size > this.cells[axis]) {
          throw new Error('Voxel stamp source volume exceeds the current voxel world.');
        }
        return (this.cells[axis] - size) * 0.5;
      });
    }
    const translated = (document ?? []).map((stamp) => ({
      ...stamp,
      center: stamp.center?.map((coordinate, axis) => coordinate + offset[axis]),
    }));
    this.replaceAll(translated);
  }

  normalizeStamp(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Voxel stamp must be an object.');
    }
    if (!Number.isInteger(value.id) || value.id < 1) {
      throw new Error('Voxel stamp id must be a positive integer.');
    }
    if (!VOXEL_STAMP_OPERATIONS.includes(value.operation)) {
      throw new Error(`Unknown voxel stamp operation: ${value.operation}.`);
    }
    if (!Array.isArray(value.center) || value.center.length !== 3) {
      throw new Error('Voxel stamp center must contain three coordinates.');
    }

    const center = value.center.map((coordinate, axis) => {
      assertFinite(coordinate, `center[${axis}]`);
      if (axis === 1 && (coordinate < 0 || coordinate > this.cells[1])) {
        throw new Error('Voxel stamp center[1] must be within the vertical voxel range.');
      }
      if (!this.unboundedXZ && axis !== 1 && (coordinate < 0 || coordinate > this.cells[axis])) {
        throw new Error(`Voxel stamp center[${axis}] must be within the voxel world.`);
      }
      return coordinate;
    });

    assertFinite(value.radius, 'radius');
    if (value.radius <= 0) {
      throw new Error('Voxel stamp radius must be positive.');
    }
    assertUnitInterval(value.strength, 'strength');
    assertFinite(value.smoothness, 'smoothness');
    if (value.smoothness <= 0) {
      throw new Error('Voxel stamp smoothness must be positive.');
    }

    return {
      id: value.id,
      operation: value.operation,
      center,
      radius: value.radius,
      strength: value.strength,
      smoothness: value.smoothness,
    };
  }

  emit() {
    const snapshot = this.list();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('Voxel stamp listener failed.', error);
      }
    }
  }
}
