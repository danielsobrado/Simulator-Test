import { createRiverSurfaceSegments } from './RiverSurfaceProfile.js';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function pointSegmentSample(cellX, cellZ, segment) {
  const lengthSquared = segment.length * segment.length;
  const amount = clamp(
    ((cellX - segment.ax) * segment.dx + (cellZ - segment.az) * segment.dz) / lengthSquared,
    0,
    1,
  );
  const nearestX = segment.ax + segment.dx * amount;
  const nearestZ = segment.az + segment.dz * amount;
  return {
    amount,
    distance: Math.hypot(cellX - nearestX, cellZ - nearestZ),
  };
}

function blockCoordinate(value, blockSize) {
  return Math.floor(value / blockSize);
}

export class RiverChannel {
  constructor({
    source,
    sampleBaseHeight,
    seaLevel,
    config,
    blockSize = 64,
  }) {
    if (!Number.isInteger(blockSize) || blockSize < 1) {
      throw new Error('River channel blockSize must be a positive integer.');
    }
    this.config = config;
    this.blockSize = blockSize;
    this.segments = createRiverSurfaceSegments({ source, sampleBaseHeight, seaLevel, config });
    this.index = new Map();
    this.buildIndex();
  }

  buildIndex() {
    for (const segment of this.segments) {
      const margin = segment.radiusCells + 1;
      const minX = blockCoordinate(Math.min(segment.ax, segment.bx) - margin, this.blockSize);
      const maxX = blockCoordinate(Math.max(segment.ax, segment.bx) + margin, this.blockSize);
      const minZ = blockCoordinate(Math.min(segment.az, segment.bz) - margin, this.blockSize);
      const maxZ = blockCoordinate(Math.max(segment.az, segment.bz) + margin, this.blockSize);
      for (let blockZ = minZ; blockZ <= maxZ; blockZ += 1) {
        for (let blockX = minX; blockX <= maxX; blockX += 1) {
          const key = `${blockX}:${blockZ}`;
          const bucket = this.index.get(key) ?? [];
          bucket.push(segment);
          this.index.set(key, bucket);
        }
      }
    }
  }

  candidates(cellX, cellZ) {
    return this.index.get(
      `${blockCoordinate(cellX, this.blockSize)}:${blockCoordinate(cellZ, this.blockSize)}`,
    ) ?? [];
  }

  sample(cellX, cellZ) {
    if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
      throw new Error('River channel coordinates must be finite.');
    }
    let selected = null;
    let bedHeight = Number.POSITIVE_INFINITY;

    for (const segment of this.candidates(cellX, cellZ)) {
      const sample = pointSegmentSample(cellX, cellZ, segment);
      if (sample.distance > segment.radiusCells) continue;
      const radial = clamp(1 - sample.distance / segment.radiusCells, 0, 1);
      const influence = smoothstep(radial);
      if (influence <= 0) continue;
      const localSurface = segment.startSurface
        + (segment.endSurface - segment.startSurface) * sample.amount;
      const localBed = localSurface
        - segment.channelDepth * radial ** this.config.river.bankExponent;
      bedHeight = Math.min(bedHeight, localBed);
      if (!selected || influence > selected.influence
          || (influence === selected.influence && localSurface < selected.surfaceHeight)) {
        selected = {
          segment,
          influence,
          surfaceHeight: localSurface,
          shoreDistance: (segment.radiusCells - sample.distance) * this.config.cellSizeMeters,
        };
      }
    }

    if (!selected) return null;
    return Object.freeze({
      bodyId: selected.segment.bodyId,
      coverage: selected.influence,
      surfaceHeight: selected.surfaceHeight,
      bedHeight,
      shoreDistance: selected.shoreDistance,
      flowX: selected.segment.flowX,
      flowZ: selected.segment.flowZ,
    });
  }

  containsCell(cellX, cellZ) {
    return this.sample(cellX + 0.5, cellZ + 0.5) !== null;
  }
}
