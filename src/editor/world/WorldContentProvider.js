const CONTENT_RETRY_DELAY_MS = 30_000;

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
    this.database = null;
    this.databasePromise = null;
    this.disposed = false;
  }

  async open() {
    if (this.disposed || typeof indexedDB === 'undefined') return null;
    if (this.database) return this.database;
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.addEventListener('upgradeneeded', () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName);
        }
      });
      request.addEventListener('success', () => {
        const database = request.result;
        this.databasePromise = null;
        if (this.disposed) {
          database.close();
          resolve(null);
          return;
        }
        database.addEventListener?.('versionchange', () => {
          database.close();
          if (this.database === database) this.database = null;
        });
        this.database = database;
        resolve(database);
      });
      request.addEventListener('error', () => {
        this.databasePromise = null;
        reject(request.error ?? new Error('IndexedDB world content open failed.'));
      });
    });
    return this.databasePromise;
  }

  async transact(mode, worldId, chunkX, chunkZ, content = null) {
    const database = await this.open();
    if (!database) return null;

    return new Promise((resolve, reject) => {
      let transaction;
      let request;
      let result = null;
      try {
        transaction = database.transaction(this.storeName, mode);
        const store = transaction.objectStore(this.storeName);
        request = mode === 'readonly'
          ? store.get(contentKey(worldId, chunkX, chunkZ))
          : store.put(content, contentKey(worldId, chunkX, chunkZ));
      } catch (error) {
        reject(error);
        return;
      }

      request.addEventListener('success', () => {
        result = request.result ?? null;
      });
      request.addEventListener('error', () => {
        reject(request.error ?? new Error('IndexedDB world content request failed.'));
      });
      transaction.addEventListener('complete', () => resolve(result));
      transaction.addEventListener('abort', () => {
        reject(transaction.error ?? new Error('IndexedDB world content transaction aborted.'));
      });
      transaction.addEventListener('error', () => {
        reject(transaction.error ?? new Error('IndexedDB world content transaction failed.'));
      });
    });
  }

  async getChunk(worldId, chunkX, chunkZ) {
    return this.transact('readonly', worldId, chunkX, chunkZ);
  }

  async putChunk(worldId, chunkX, chunkZ, content) {
    await this.transact('readwrite', worldId, chunkX, chunkZ, structuredClone(content));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.database?.close();
    this.database = null;
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
  constructor({ local, remote = null, retryDelayMs = CONTENT_RETRY_DELAY_MS }) {
    if (!local || typeof local.getChunk !== 'function') {
      throw new Error('Local-first world content requires a local provider.');
    }
    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
      throw new Error('World content retry delay must be a non-negative number.');
    }
    this.local = local;
    this.remote = remote;
    this.retryDelayMs = retryDelayMs;
    this.warnedFailures = new Set();
    this.localRetryAfter = 0;
    this.remoteRetryAfter = 0;
  }

  warnOnce(kind, message, error) {
    if (this.warnedFailures.has(kind)) return;
    this.warnedFailures.add(kind);
    console.warn(message, error);
  }

  async getChunk(worldId, chunkX, chunkZ) {
    let local = null;
    if (Date.now() >= this.localRetryAfter) {
      try {
        local = await this.local.getChunk(worldId, chunkX, chunkZ);
        this.localRetryAfter = 0;
      } catch (error) {
        this.localRetryAfter = Date.now() + this.retryDelayMs;
        this.warnOnce(
          'local-read',
          'Local world content is unavailable; continuing without the local cache.',
          error,
        );
      }
    }
    if (local !== null && local !== undefined) return local;
    if (!this.remote || Date.now() < this.remoteRetryAfter) return null;

    let remote = null;
    try {
      remote = await this.remote.getChunk(worldId, chunkX, chunkZ);
      this.remoteRetryAfter = 0;
    } catch (error) {
      this.remoteRetryAfter = Date.now() + this.retryDelayMs;
      this.warnOnce(
        'remote-read',
        'Remote world content is unavailable; continuing with generated terrain.',
        error,
      );
      return null;
    }

    if (remote !== null && remote !== undefined && Date.now() >= this.localRetryAfter) {
      try {
        await this.local.putChunk?.(worldId, chunkX, chunkZ, remote);
        this.localRetryAfter = 0;
      } catch (error) {
        this.localRetryAfter = Date.now() + this.retryDelayMs;
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
    try {
      await this.local.putChunk?.(worldId, chunkX, chunkZ, content);
      this.localRetryAfter = 0;
    } catch (error) {
      this.localRetryAfter = Date.now() + this.retryDelayMs;
      throw error;
    }
  }

  dispose() {
    this.local.dispose?.();
    this.remote?.dispose?.();
  }
}
