function contentKey(worldId, chunkX, chunkZ) {
  return `${worldId}:${chunkX}:${chunkZ}`;
}

export class MemoryWorldContentProvider {
  constructor() {
    this.chunks = new Map();
  }

  async getChunk(worldId, chunkX, chunkZ) {
    return structuredClone(this.chunks.get(contentKey(worldId, chunkX, chunkZ)) ?? null);
  }

  async putChunk(worldId, chunkX, chunkZ, content) {
    this.chunks.set(contentKey(worldId, chunkX, chunkZ), structuredClone(content));
  }
}

export class IndexedDbWorldContentProvider {
  constructor({
    databaseName = 'simcity-dnd-world-content',
    storeName = 'chunks',
  } = {}) {
    this.databaseName = databaseName;
    this.storeName = storeName;
  }

  async open() {
    if (typeof indexedDB === 'undefined') return null;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.addEventListener('upgradeneeded', () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName);
        }
      });
      request.addEventListener('success', () => resolve(request.result));
      request.addEventListener('error', () => reject(request.error));
    });
  }

  async transact(mode, worldId, chunkX, chunkZ, content = null) {
    const database = await this.open();
    if (!database) return null;
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(this.storeName, mode);
        const store = transaction.objectStore(this.storeName);
        const request = mode === 'readonly'
          ? store.get(contentKey(worldId, chunkX, chunkZ))
          : store.put(content, contentKey(worldId, chunkX, chunkZ));
        request.addEventListener('success', () => resolve(request.result ?? null));
        request.addEventListener('error', () => reject(request.error));
      });
    } finally {
      database.close();
    }
  }

  async getChunk(worldId, chunkX, chunkZ) {
    return this.transact('readonly', worldId, chunkX, chunkZ);
  }

  async putChunk(worldId, chunkX, chunkZ, content) {
    await this.transact('readwrite', worldId, chunkX, chunkZ, structuredClone(content));
  }
}

export class UrlWorldContentProvider {
  constructor({ baseUrl, fetchImpl = null } = {}) {
    if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
      throw new Error('World content URL provider requires a base URL.');
    }
    // Bound to the global: called as `this.fetchImpl(...)`, an unbound `fetch`
    // would get this provider as its receiver and throw "Illegal invocation".
    const resolved = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof resolved !== 'function') {
      throw new Error('World content URL provider requires fetch.');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = resolved;
  }

  async getChunk(worldId, chunkX, chunkZ) {
    const url = `${this.baseUrl}/${encodeURIComponent(worldId)}/chunks/${chunkX}/${chunkZ}.json`;
    const response = await this.fetchImpl(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`World content request failed with status ${response.status}.`);
    }
    return response.json();
  }
}

export class LocalFirstWorldContentProvider {
  constructor({ local, remote = null }) {
    if (!local || typeof local.getChunk !== 'function') {
      throw new Error('Local-first world content requires a local provider.');
    }
    this.local = local;
    this.remote = remote;
    this.warnedFailures = new Set();
  }

  warnOnce(kind, message, error) {
    if (this.warnedFailures.has(kind)) return;
    this.warnedFailures.add(kind);
    console.warn(message, error);
  }

  async getChunk(worldId, chunkX, chunkZ) {
    let local = null;
    try {
      local = await this.local.getChunk(worldId, chunkX, chunkZ);
    } catch (error) {
      this.warnOnce(
        'local-read',
        'Local world content is unavailable; continuing without the local cache.',
        error,
      );
    }
    if (local !== null && local !== undefined) return local;
    if (!this.remote) return null;

    let remote = null;
    try {
      remote = await this.remote.getChunk(worldId, chunkX, chunkZ);
    } catch (error) {
      this.warnOnce(
        'remote-read',
        'Remote world content is unavailable; continuing with generated terrain.',
        error,
      );
      return null;
    }

    if (remote !== null && remote !== undefined) {
      try {
        await this.local.putChunk?.(worldId, chunkX, chunkZ, remote);
      } catch (error) {
        this.warnOnce(
          'local-write',
          'Remote world content loaded, but caching it locally failed.',
          error,
        );
      }
    }
    return remote ?? null;
  }

  async putChunk(worldId, chunkX, chunkZ, content) {
    await this.local.putChunk?.(worldId, chunkX, chunkZ, content);
  }
}
