import { floorDiv } from '../world/WorldCoordinates.js';

function keyFor(chunkX, chunkZ) {
  return `${chunkX}:${chunkZ}`;
}

export class StylizedChunkRevisionTracker {
  constructor({ worldStore }) {
    this.worldStore = worldStore;
    this.chunkSize = worldStore.chunkSize;
    this.epoch = 0;
    this.revisions = new Map();
    // Memoized all-zero signatures, one per shape, valid while no chunk is dirty.
    this.zeroSignatures = new Map();
    this.unsubscribe = worldStore.subscribe((change) => this.onWorldChange(change));
  }

  onWorldChange(change) {
    if (change.kind === 'reset') {
      this.epoch += 1;
      this.revisions.clear();
      // The memoized strings embed the epoch, so they cannot outlive it.
      this.zeroSignatures.clear();
      return;
    }

    for (const coordinate of change.cells ?? []) {
      this.touch(
        floorDiv(coordinate.x, this.chunkSize),
        floorDiv(coordinate.z, this.chunkSize),
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
            this.touch(chunkX, chunkZ);
          }
        }
      }
    }
  }

  touch(chunkX, chunkZ) {
    const key = keyFor(chunkX, chunkZ);
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
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
  }
}
