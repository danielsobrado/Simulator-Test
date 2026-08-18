import { floorDiv } from '../world/WorldCoordinates.js';

const MATERIAL_REVISION_FIELDS = Object.freeze(['tile', 'height', 'water', 'canopy']);

function keyFor(chunkX, chunkZ) {
  return `${chunkX}:${chunkZ}`;
}

function createMaterialRevisionMaps() {
  return Object.fromEntries(MATERIAL_REVISION_FIELDS.map((field) => [field, new Map()]));
}

export class StylizedChunkRevisionTracker {
  constructor({ worldStore }) {
    this.worldStore = worldStore;
    this.chunkSize = worldStore.chunkSize;
    this.epoch = 0;
    this.revision = 0;
    this.materialClock = 0;
    this.revisions = new Map();
    this.materialRevisionMaps = createMaterialRevisionMaps();
    // Memoized all-zero signatures, one per shape, valid while no chunk is dirty.
    this.zeroSignatures = new Map();
    this.unsubscribe = worldStore.subscribe((change) => this.onWorldChange(change));
  }

  onWorldChange(change) {
    if (change.kind === 'reset') {
      this.epoch += 1;
      this.revision += 1;
      this.materialClock += 1;
      this.revisions.clear();
      for (const revisions of Object.values(this.materialRevisionMaps)) revisions.clear();
      // The memoized strings embed the epoch, so they cannot outlive it.
      this.zeroSignatures.clear();
      return;
    }

    const cellField = MATERIAL_REVISION_FIELDS.includes(change.kind) ? change.kind : null;
    for (const coordinate of change.cells ?? []) {
      this.touch(
        floorDiv(coordinate.x, this.chunkSize),
        floorDiv(coordinate.z, this.chunkSize),
        cellField,
      );
    }

    for (const coordinate of change.vertices ?? []) {
      const primaryX = floorDiv(coordinate.x, this.chunkSize);
      const primaryZ = floorDiv(coordinate.z, this.chunkSize);
      for (let offsetZ = -1; offsetZ <= 0; offsetZ += 1) {
        for (let offsetX = -1; offsetX <= 0; offsetX += 1) {
          const chunkX = primaryX + offsetX;
          const chunkZ = primaryZ + offsetZ;
          const localX = coordinate.x - chunkX * this.chunkSize;
          const localZ = coordinate.z - chunkZ * this.chunkSize;
          if (localX >= 0 && localX <= this.chunkSize
              && localZ >= 0 && localZ <= this.chunkSize) {
            this.touch(chunkX, chunkZ, 'height');
          }
        }
      }
    }
  }

  touch(chunkX, chunkZ, materialField = null) {
    const key = keyFor(chunkX, chunkZ);
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    this.revision += 1;
    if (materialField) this.touchMaterialField(chunkX, chunkZ, materialField);
  }

  touchMaterialField(chunkX, chunkZ, field) {
    const revisions = this.materialRevisionMaps[field];
    if (!revisions) {
      throw new Error(`Unknown terrain material revision field: ${field}.`);
    }
    this.materialClock += 1;
    revisions.set(keyFor(chunkX, chunkZ), this.materialClock);
  }

  materialRevisionAt(field, chunkX, chunkZ, halo = 0) {
    const revisions = this.materialRevisionMaps[field];
    if (!revisions) {
      throw new Error(`Unknown terrain material revision field: ${field}.`);
    }
    let revision = 0;
    for (let offsetZ = -halo; offsetZ <= halo; offsetZ += 1) {
      for (let offsetX = -halo; offsetX <= halo; offsetX += 1) {
        revision = Math.max(
          revision,
          revisions.get(keyFor(chunkX + offsetX, chunkZ + offsetZ)) ?? 0,
        );
      }
    }
    return revision;
  }

  materialRevisionsFor(chunkX, chunkZ, { tileHalo = 0 } = {}) {
    const tile = this.materialRevisionAt('tile', chunkX, chunkZ, tileHalo);
    const height = this.materialRevisionAt('height', chunkX, chunkZ);
    const explicitWater = this.materialRevisionAt('water', chunkX, chunkZ, tileHalo);
    return Object.freeze({
      world: this.epoch,
      tile,
      height,
      water: Math.max(tile, height, explicitWater),
      canopy: this.materialRevisionAt('canopy', chunkX, chunkZ),
    });
  }

  /**
   * All-zero signature for a given shape, byte-identical to what the walk below
   * produces when nothing is dirty — callers compare these strings, so the fast
   * path must not have its own format.
   */
  zeroSignature(cacheKey, entryCount, separator) {
    let cached = this.zeroSignatures.get(cacheKey);
    if (cached === undefined) {
      const values = [`e${this.epoch}`];
      for (let index = 0; index < entryCount; index += 1) values.push(0);
      cached = values.join(separator);
      this.zeroSignatures.set(cacheKey, cached);
    }
    return cached;
  }

  /**
   * Change-detection token for a chunk and its halo. Callers key their caches by
   * chunk coordinate separately, so this only has to distinguish revision state.
   *
   * An unedited world is the common case and leaves `revisions` empty, meaning
   * every chunk reads zero. Taking that shortcut matters because the halo walk
   * builds a string per neighbour, and `windowSignature` runs it for every chunk
   * in the resident window, for trees, rocks and bushes, every frame.
   */
  signature(chunkX, chunkZ, halo = 0) {
    if (this.revisions.size === 0) {
      return this.zeroSignature(`s${halo}`, (halo * 2 + 1) ** 2, ':');
    }
    const values = [`e${this.epoch}`];
    for (let offsetZ = -halo; offsetZ <= halo; offsetZ += 1) {
      for (let offsetX = -halo; offsetX <= halo; offsetX += 1) {
        values.push(this.revisions.get(keyFor(chunkX + offsetX, chunkZ + offsetZ)) ?? 0);
      }
    }
    return values.join(':');
  }

  windowSignature(focus, radius, halo = 0) {
    if (this.revisions.size === 0) {
      const cacheKey = `w${radius}:${halo}`;
      let cached = this.zeroSignatures.get(cacheKey);
      if (cached === undefined) {
        const perChunk = this.signature(0, 0, halo);
        const values = [`e${this.epoch}`];
        const chunkCount = (radius * 2 + 1) ** 2;
        for (let index = 0; index < chunkCount; index += 1) values.push(perChunk);
        cached = values.join('|');
        this.zeroSignatures.set(cacheKey, cached);
      }
      return cached;
    }
    const values = [`e${this.epoch}`];
    for (let chunkZ = focus.chunkZ - radius; chunkZ <= focus.chunkZ + radius; chunkZ += 1) {
      for (let chunkX = focus.chunkX - radius; chunkX <= focus.chunkX + radius; chunkX += 1) {
        values.push(this.signature(chunkX, chunkZ, halo));
      }
    }
    return values.join('|');
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.revisions.clear();
    for (const revisions of Object.values(this.materialRevisionMaps)) revisions.clear();
  }
}
