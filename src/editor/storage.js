import { AzgaarImportWorkerClient } from './import/AzgaarImportWorkerClient.js';
import { isAzgaarFullJson } from './import/AzgaarJsonImporter.js';
import { buildAzgaarImportSummary } from './import/AzgaarMacroWorldSource.js';

const DATABASE_NAME = 'simcity-dnd-worlds';
const DATABASE_VERSION = 1;
const STORE_NAME = 'worlds';

export function parseDocument(serialized) {
  const document = JSON.parse(serialized);
  if (!document || typeof document !== 'object') {
    throw new Error('The selected file is not a valid map document.');
  }
  return document;
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB failed to open.')));
  });
}

async function withStore(mode, action) {
  const database = await openDatabase();
  if (!database) {
    return action(null);
  }
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try {
        result = action(store);
      } catch (error) {
        reject(error);
        return;
      }
      transaction.addEventListener('complete', () => resolve(result?.result));
      transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')));
      transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')));
    });
  } finally {
    database.close();
  }
}

export async function saveToBrowser(storageKey, document) {
  if (typeof indexedDB !== 'undefined') {
    await withStore('readwrite', (store) => store.put(document, storageKey));
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // IndexedDB is authoritative; stale localStorage cleanup is best effort.
    }
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(document));
}

export async function loadFromBrowser(storageKey) {
  if (typeof indexedDB !== 'undefined') {
    const document = await withStore('readonly', (store) => store.get(storageKey));
    if (document) {
      return document;
    }
  }
  const serialized = localStorage.getItem(storageKey);
  return serialized ? parseDocument(serialized) : null;
}

export async function listBrowserDocuments(prefix) {
  if (typeof prefix !== 'string') {
    throw new Error('Browser document prefixes must be strings.');
  }
  if (typeof indexedDB !== 'undefined') {
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, false);
    const keys = await withStore('readonly', (store) => store.getAllKeys(range));
    const matches = [];
    for (const key of keys ?? []) {
      if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
      matches.push({
        key,
        document: await loadFromBrowser(key),
      });
    }
    return matches;
  }
  const matches = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    matches.push({ key, document: await loadFromBrowser(key) });
  }
  return matches;
}

export async function loadJsonFromUrl(url, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('URL loading is unavailable in this browser.');
  }
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Unable to load ${url}: HTTP ${response.status}.`);
  }
  return parseDocument(await response.text());
}

export function exportJson(documentValue, fileName) {
  const blob = new Blob([JSON.stringify(documentValue)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportMap(worldDocument) {
  exportJson(worldDocument, `simcity-dnd-world-${Date.now()}.json`);
}

export async function importJson(file) {
  return parseDocument(await file.text());
}

export async function importMap(file, {
  config = null,
  resolveAzgaarOptions = null,
} = {}) {
  return importMapDocument(await importJson(file), {
    config,
    resolveAzgaarOptions,
  });
}

export async function importMapUrl(url, options = {}) {
  return importMapDocument(await loadJsonFromUrl(url, options), options);
}

export async function importMapDocument(document, {
  config = null,
  resolveAzgaarOptions = null,
} = {}) {
  if (!isAzgaarFullJson(document)) {
    return document;
  }
  // The caller owns the config. Loading it here would pull editor.config.yaml
  // onto this module's graph, which only resolves under Vite and would make
  // storage.js — and the scene settings runtime layered on it — untestable
  // under plain Node.
  if (!config) {
    throw new Error('Importing an Azgaar map requires the editor configuration.');
  }
  const summary = buildAzgaarImportSummary(document, config);
  const options = await resolveAzgaarOptions?.(summary) ?? {};
  const worker = new AzgaarImportWorkerClient();
  try {
    return await worker.convert(document, config, options);
  } finally {
    worker.dispose();
  }
}
