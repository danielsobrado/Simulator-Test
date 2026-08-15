import { AzgaarImportWorkerClient } from './import/AzgaarImportWorkerClient.js';
import { isAzgaarFullJson } from './import/AzgaarJsonImporter.js';
import { buildAzgaarImportSummary } from './import/AzgaarMacroWorldSource.js';

const DATABASE_NAME = 'simcity-dnd-worlds';
const DATABASE_VERSION = 1;
const STORE_NAME = 'worlds';

function storageFailure(message, primaryError, fallbackError) {
  const error = typeof AggregateError === 'function'
    ? new AggregateError([primaryError, fallbackError].filter(Boolean), message)
    : new Error(message);
  if (!(error instanceof Error)) return error;
  error.cause ??= fallbackError ?? primaryError;
  error.storageFailure = true;
  return error;
}

function warnIndexedDbFallback(operation, error) {
  console.warn(`IndexedDB ${operation} failed; using localStorage fallback.`, error);
}

export function parseDocument(serialized) {
  const document = JSON.parse(serialized);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('The selected file is not a valid map document.');
  }
  return document;
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
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

async function listIndexedDbDocuments(prefix) {
  const database = await openDatabase();
  if (!database) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`, false, false);
      const matches = [];
      const request = store.openCursor(range);
      request.addEventListener('success', () => {
        const cursor = request.result;
        if (!cursor) return;
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          matches.push({ key: cursor.key, document: cursor.value });
        }
        cursor.continue();
      });
      request.addEventListener('error', () => {
        reject(request.error ?? new Error('IndexedDB document listing failed.'));
      });
      transaction.addEventListener('complete', () => resolve(matches));
      transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')));
      transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')));
    });
  } finally {
    database.close();
  }
}

function saveToLocalStorage(storageKey, document) {
  localStorage.setItem(storageKey, JSON.stringify(document));
}

function loadFromLocalStorage(storageKey) {
  const serialized = localStorage.getItem(storageKey);
  return serialized ? parseDocument(serialized) : null;
}

async function listLocalStorageDocuments(prefix) {
  const matches = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(prefix)) continue;
    try {
      const document = loadFromLocalStorage(key);
      if (document !== null) matches.push({ key, document });
    } catch (error) {
      console.warn(`Ignoring invalid legacy browser document "${key}".`, error);
    }
  }
  return matches;
}

function mergeDocumentLists(primary, legacy) {
  const byKey = new Map(legacy.map((entry) => [entry.key, entry]));
  for (const entry of primary) byKey.set(entry.key, entry);
  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export async function saveToBrowser(storageKey, document) {
  let indexedDbError = null;
  if (typeof indexedDB !== 'undefined') {
    try {
      await withStore('readwrite', (store) => store.put(document, storageKey));
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // IndexedDB is authoritative; stale localStorage cleanup is best effort.
      }
      return;
    } catch (error) {
      indexedDbError = error;
      warnIndexedDbFallback('save', error);
    }
  }
  try {
    saveToLocalStorage(storageKey, document);
  } catch (fallbackError) {
    if (indexedDbError) {
      throw storageFailure('Unable to save the browser document.', indexedDbError, fallbackError);
    }
    throw fallbackError;
  }
}

export async function loadFromBrowser(storageKey) {
  let indexedDbError = null;
  if (typeof indexedDB !== 'undefined') {
    try {
      const document = await withStore('readonly', (store) => store.get(storageKey));
      if (document) return document;
    } catch (error) {
      indexedDbError = error;
      warnIndexedDbFallback('load', error);
    }
  }
  try {
    const document = loadFromLocalStorage(storageKey);
    if (document !== null || !indexedDbError) return document;
    throw storageFailure('Unable to load the browser document.', indexedDbError, null);
  } catch (fallbackError) {
    if (fallbackError?.storageFailure && indexedDbError) throw fallbackError;
    if (indexedDbError) {
      throw storageFailure('Unable to load the browser document.', indexedDbError, fallbackError);
    }
    throw fallbackError;
  }
}

export async function deleteFromBrowser(storageKey) {
  let indexedDbError = null;
  if (typeof indexedDB !== 'undefined') {
    try {
      await withStore('readwrite', (store) => store.delete(storageKey));
    } catch (error) {
      indexedDbError = error;
      console.warn('IndexedDB delete failed; attempting localStorage cleanup.', error);
    }
  }

  let localStorageError = null;
  try {
    localStorage.removeItem(storageKey);
  } catch (error) {
    localStorageError = error;
  }

  if (indexedDbError || localStorageError) {
    throw storageFailure(
      'Unable to delete the browser document.',
      indexedDbError,
      localStorageError,
    );
  }
}

export async function listBrowserDocuments(prefix) {
  if (typeof prefix !== 'string') {
    throw new Error('Browser document prefixes must be strings.');
  }
  let indexedDbError = null;
  if (typeof indexedDB !== 'undefined') {
    try {
      const documents = await listIndexedDbDocuments(prefix);
      if (documents) {
        try {
          return mergeDocumentLists(documents, await listLocalStorageDocuments(prefix));
        } catch {
          return documents;
        }
      }
    } catch (error) {
      indexedDbError = error;
      warnIndexedDbFallback('listing', error);
    }
  }
  try {
    const documents = await listLocalStorageDocuments(prefix);
    if (documents.length > 0 || !indexedDbError) return documents;
    throw storageFailure('Unable to list browser documents.', indexedDbError, null);
  } catch (fallbackError) {
    if (fallbackError?.storageFailure && indexedDbError) throw fallbackError;
    if (indexedDbError) {
      throw storageFailure('Unable to list browser documents.', indexedDbError, fallbackError);
    }
    throw fallbackError;
  }
}

export async function loadJsonFromUrl(url, { fetchImpl = null } = {}) {
  const resolvedFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (typeof resolvedFetch !== 'function') {
    throw new Error('URL loading is unavailable in this browser.');
  }
  const response = await resolvedFetch(url);
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
