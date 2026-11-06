/** Detached masonry only. Growth stays with the live module so LOD changes can
 * retain the exact same ivy; materials are owned by the construction, not this cache. */
export class ConstructionLodCache {
  constructor({ maxBytes = 32 * 1024 * 1024, maxEntries = 128 } = {}) {
    this.maxBytes = Math.max(0, maxBytes);
    this.maxEntries = Math.max(0, maxEntries);
    this.entries = new Map();
    this.bytes = 0;
  }

  take(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key); this.bytes -= entry.bytes;
    return entry.product;
  }

  /** Transfers ownership even when the product exceeds the allowance. */
  put(key, constructionId, moduleId, product) {
    this.remove(key);
    const arrays = new Set();
    for (const mesh of product.meshes) {
      mesh.removeFromParent();
      for (const attribute of Object.values(mesh.geometry.attributes)) arrays.add(attribute.data?.array ?? attribute.array);
      if (mesh.geometry.index) arrays.add(mesh.geometry.index.array);
    }
    const bytes = [...arrays].reduce((sum, array) => sum + (array?.byteLength ?? 0), 0);
    this.entries.set(key, { constructionId, moduleId, product, bytes }); this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value);
  }

  remove(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.bytes -= entry.bytes;
    for (const geometry of new Set(entry.product.meshes.map(mesh => mesh.geometry))) geometry.dispose();
  }

  invalidate(constructionId, moduleId = null) {
    for (const [key, entry] of this.entries) {
      if (entry.constructionId === constructionId && (moduleId === null || entry.moduleId === moduleId)) this.remove(key);
    }
  }

  clear() { for (const key of this.entries.keys()) this.remove(key); }
}

/** Growth counters describe the live decoration, never the detached masonry. */
export function masonryStats(stats = {}) {
  const totalTriangles = (stats.totalTriangles ?? 0) - (stats.growthTriangles ?? 0);
  return { ...stats, growthLeaves: 0, groundDetails: 0, growthTriangles: 0,
    totalTriangles, triangles: totalTriangles };
}
