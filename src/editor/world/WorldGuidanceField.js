import {
  decodeGuidanceField,
  hasGuidanceField,
} from '../import/AzgaarMacroWorldSource.js';
import { WORLD_GUIDANCE_NO_DISTANCE } from '../import/AzgaarWorldGuidance.js';

const NORMALIZED_FIELDS = Object.freeze([
  'moisture',
  'continentalness',
  'wetness',
  'mountainness',
  'ruggedness',
  'valleyness',
  'snowPotential',
  'forestPotential',
  'agriculturalPotential',
  'harborPotential',
]);

const LEGACY_FIELD_NAMES = Object.freeze({
  elevation: 'heightData',
  biomeId: 'biomeData',
  featureId: 'featureData',
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function fieldPayload(source, name) {
  return source.atlas?.fields?.[name]
    ?? source.terrainGuidance?.fields?.[name]
    ?? source.atlas?.[LEGACY_FIELD_NAMES[name]]
    ?? null;
}

function outsideSample() {
  return {
    inside: false,
    elevation: 0,
    temperature: null,
    precipitation: null,
    waterDistance: null,
    biomeId: 0,
    featureId: 0,
    riverId: 0,
    riverFlux: 0,
    confluenceFlux: 0,
    population: 0,
    settlementScore: 0,
    harborScore: 0,
    havenId: 0,
    coastDistance: null,
    coastDistanceMeters: null,
    riverDistance: null,
    riverDistanceMeters: null,
    moisture: 0,
    continentalness: 0,
    wetness: 1,
    mountainness: 0,
    ruggedness: 0,
    valleyness: 0,
    snowPotential: 0,
    forestPotential: 0,
    agriculturalPotential: 0,
    harborPotential: 0,
  };
}

export class WorldGuidanceField {
  constructor(source, decoded = null) {
    this.source = source;
    this.fields = Object.create(null);
    for (const [name, values] of Object.entries(decoded?.fields ?? {})) {
      this.fields[name] = values;
    }
    this.biomeBySourceId = new Map(
      (source.biomes ?? []).map((definition) => [definition.sourceId, definition]),
    );
    this.metersPerAtlasPixel = source.physical.widthMeters / source.atlas.width;
  }

  decodedFieldNames() {
    return Object.freeze(Object.keys(this.fields).sort());
  }

  field(name) {
    if (this.fields[name]) return this.fields[name];
    if (!hasGuidanceField(this.source, name)) return null;
    const values = decodeGuidanceField(this.source, name);
    if (values) this.fields[name] = values;
    return values;
  }

  isInside(cellX, cellZ) {
    const { bounds } = this.source;
    return cellX >= bounds.minCellX
      && cellZ >= bounds.minCellZ
      && cellX < bounds.minCellX + bounds.widthCells
      && cellZ < bounds.minCellZ + bounds.heightCells;
  }

  toAtlasPosition(cellX, cellZ) {
    const { bounds, atlas } = this.source;
    return {
      x: (cellX - bounds.minCellX) / bounds.widthCells * atlas.width,
      y: (cellZ - bounds.minCellZ) / bounds.heightCells * atlas.height,
    };
  }

  atlasIndex(x, y) {
    const { width, height } = this.source.atlas;
    return clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1);
  }

  fieldScale(name) {
    const scale = Number(fieldPayload(this.source, name)?.scale ?? 1);
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(`Azgaar guidance field ${name} scale must be a positive finite number.`);
    }
    return scale;
  }

  sampleNearest(name, cellX, cellZ) {
    const values = this.field(name);
    if (!values) return null;
    const position = this.toAtlasPosition(cellX + 0.5, cellZ + 0.5);
    const index = this.atlasIndex(Math.floor(position.x), Math.floor(position.y));
    return values[index] * this.fieldScale(name);
  }

  sampleContinuous(name, cellX, cellZ) {
    const values = this.field(name);
    if (!values) return null;
    const { width, height } = this.source.atlas;
    const position = this.toAtlasPosition(cellX + 0.5, cellZ + 0.5);
    const fx = clamp(position.x - 0.5, 0, width - 1);
    const fy = clamp(position.y - 0.5, 0, height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const north = lerp(
      values[this.atlasIndex(x0, y0)],
      values[this.atlasIndex(x1, y0)],
      fx - x0,
    );
    const south = lerp(
      values[this.atlasIndex(x0, y1)],
      values[this.atlasIndex(x1, y1)],
      fx - x0,
    );
    return lerp(north, south, fy - y0) * this.fieldScale(name);
  }

  sample(cellX, cellZ) {
    if (!this.isInside(cellX + 0.5, cellZ + 0.5)) return outsideSample();
    const coastDistance = this.sampleContinuous('coastDistance', cellX, cellZ);
    const riverDistance = this.sampleContinuous('riverDistance', cellX, cellZ);
    const result = {
      inside: true,
      elevation: this.sampleContinuous('elevation', cellX, cellZ),
      temperature: this.sampleContinuous('temperature', cellX, cellZ),
      precipitation: this.sampleContinuous('precipitation', cellX, cellZ),
      waterDistance: this.sampleContinuous('waterDistance', cellX, cellZ),
      biomeId: this.sampleNearest('biomeId', cellX, cellZ),
      featureId: this.sampleNearest('featureId', cellX, cellZ),
      riverId: this.sampleNearest('riverId', cellX, cellZ),
      riverFlux: this.sampleContinuous('riverFlux', cellX, cellZ),
      confluenceFlux: this.sampleContinuous('confluenceFlux', cellX, cellZ),
      population: this.sampleContinuous('population', cellX, cellZ),
      settlementScore: this.sampleContinuous('settlementScore', cellX, cellZ),
      harborScore: this.sampleContinuous('harborScore', cellX, cellZ),
      havenId: this.sampleNearest('havenId', cellX, cellZ),
      coastDistance,
      coastDistanceMeters: coastDistance === null
        ? null
        : coastDistance * this.metersPerAtlasPixel,
      riverDistance,
      riverDistanceMeters: riverDistance === null || riverDistance >= WORLD_GUIDANCE_NO_DISTANCE
        ? null
        : riverDistance * this.metersPerAtlasPixel,
    };
    for (const name of NORMALIZED_FIELDS) {
      result[name] = this.sampleContinuous(name, cellX, cellZ);
    }
    return result;
  }

  sampleBiomeBlend(cellX, cellZ) {
    if (!this.isInside(cellX + 0.5, cellZ + 0.5)) {
      const marine = this.biomeBySourceId.get(0);
      return {
        canonicalSourceId: 0,
        canonicalTileId: marine?.tileId ?? 0,
        weights: [{ sourceId: 0, tileId: marine?.tileId ?? 0, weight: 1 }],
      };
    }
    const values = this.field('biomeId');
    if (!values) {
      throw new Error('Azgaar guidance is missing biomeId.');
    }
    const { width, height } = this.source.atlas;
    const position = this.toAtlasPosition(cellX + 0.5, cellZ + 0.5);
    const fx = clamp(position.x - 0.5, 0, width - 1);
    const fy = clamp(position.y - 0.5, 0, height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const samples = [
      [values[this.atlasIndex(x0, y0)], (1 - tx) * (1 - ty)],
      [values[this.atlasIndex(x1, y0)], tx * (1 - ty)],
      [values[this.atlasIndex(x0, y1)], (1 - tx) * ty],
      [values[this.atlasIndex(x1, y1)], tx * ty],
    ];
    const combined = new Map();
    for (const [sourceId, weight] of samples) {
      combined.set(sourceId, (combined.get(sourceId) ?? 0) + weight);
    }
    const canonicalSourceId = values[this.atlasIndex(
      Math.floor(clamp(position.x, 0, width - 1)),
      Math.floor(clamp(position.y, 0, height - 1)),
    )];
    const canonicalDefinition = this.biomeBySourceId.get(canonicalSourceId);
    return {
      canonicalSourceId,
      canonicalTileId: canonicalDefinition?.tileId ?? canonicalSourceId,
      weights: [...combined.entries()]
        .filter(([, weight]) => weight > 0)
        .map(([sourceId, weight]) => {
          const definition = this.biomeBySourceId.get(sourceId);
          return {
            sourceId,
            tileId: definition?.tileId ?? sourceId,
            weight,
          };
        })
        .sort((left, right) => right.weight - left.weight || left.sourceId - right.sourceId),
    };
  }
}
