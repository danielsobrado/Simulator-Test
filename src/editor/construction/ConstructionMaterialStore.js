import {
  getWorkshopMaterialPreset,
  normalizeWorkshopMaterialDocument,
  serializeWorkshopMaterialDocument,
} from '../workshop/ProceduralWorkshopMaterialConfig.js';

/**
 * Material presets and imported images for live constructions.
 *
 * Construction records hold **preset ids only** — the schema rejects anything
 * that is not an id, so a data URL can never land in a record that the store
 * `structuredClone`s on every `get()` and `list()`. The images live here, in a
 * separate world-document key, reusing the workshop's normalizer for its caps
 * (48 presets, 16 sources, 800 KB per source, 2.4 MB total) and its canonical
 * sorted serialization.
 */

const MATERIAL_FAMILIES = Object.freeze(['stone', 'mortar', 'roof']);
const MAX_LOCAL_HISTORY = 80;

/** Region key a construction's family material is recorded under. */
export function constructionRegionId(constructionId, family) {
  return `${constructionId}:${family}`;
}

/**
 * Retention key so a custom library preset survives save GC before it is
 * painted onto a wall. Without this, `normalizeWorkshopMaterialDocument`
 * drops any preset not listed in defaults, overrides, or favorites.
 */
export function libraryRetentionRegionId(presetId) {
  return `library:${presetId}`;
}

export class ConstructionMaterialStore {
  constructor(document = undefined) {
    this.document = normalizeWorkshopMaterialDocument(document);
    this.history = [];
    this.future = [];
  }

  getPreset(presetId) {
    return getWorkshopMaterialPreset(this.document, presetId);
  }

  listPresets() {
    return Object.values(this.document.materialLibrary.presets);
  }

  /**
   * Commit a library edit — importing an albedo, adding a preset.
   *
   * These get their own bounded history rather than entering world history:
   * undoing a wall move should not un-import an image. `set_material` is the
   * part that belongs to world history, and that lives on the record.
   */
  commit(next) {
    const before = serializeWorkshopMaterialDocument(this.document);
    const candidate = normalizeWorkshopMaterialDocument(next);
    if (JSON.stringify(before) === JSON.stringify(serializeWorkshopMaterialDocument(candidate))) {
      return false;
    }
    this.history.push(before);
    if (this.history.length > MAX_LOCAL_HISTORY) this.history.shift();
    this.future = [];
    this.document = candidate;
    return true;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    this.future.push(serializeWorkshopMaterialDocument(this.document));
    this.document = normalizeWorkshopMaterialDocument(previous);
    return true;
  }

  redo() {
    const next = this.future.pop();
    if (!next) return false;
    this.history.push(serializeWorkshopMaterialDocument(this.document));
    this.document = normalizeWorkshopMaterialDocument(next);
    return true;
  }

  /**
   * Project every record's material choices into `materialAreaOverrides`, and
   * pin every custom library preset with a `library:<id>` retention key.
   *
   * `normalizeWorkshopMaterialDocument` garbage-collects any preset that its
   * *own* document does not reference, then drops the sources those presets
   * used. A construction record is not part of that document, so a preset used
   * only by a wall is invisible to the GC and would be collected on the next
   * normalize — taking the user's imported image with it. Recording each
   * record's choice under `${recordId}:${family}` makes the reference visible.
   * Library retention covers the other case: an imported preset the user has
   * not painted onto a wall yet must still survive world save.
   */
  gc(records = []) {
    const overrides = {};
    // Pin every custom library preset so an import waiting to be painted is not
    // deleted on the first world save.
    for (const presetId of Object.keys(this.document.materialLibrary.presets)) {
      overrides[libraryRetentionRegionId(presetId)] = presetId;
    }
    for (const record of records) {
      for (const family of MATERIAL_FAMILIES) {
        const presetId = record.style?.materials?.[family];
        if (!presetId) continue;
        if (!getWorkshopMaterialPreset(this.document, presetId)) continue;
        overrides[constructionRegionId(record.id, family)] = presetId;
      }
    }
    this.document = normalizeWorkshopMaterialDocument({
      ...serializeWorkshopMaterialDocument(this.document),
      materialAreaOverrides: overrides,
    });
    return this.document;
  }

  /** Serialize for the world document. Run `gc(records)` first. */
  toDocument() {
    return serializeWorkshopMaterialDocument(this.document);
  }

  loadDocument(input) {
    this.document = normalizeWorkshopMaterialDocument(input ?? undefined);
    this.history = [];
    this.future = [];
  }

  /** Remaining data-URL budget, so a user hitting the cap understands why. */
  sourceBudget() {
    const sources = Object.values(this.document.materialLibrary.sources);
    const used = sources.reduce((total, source) => total + source.dataUrl.length, 0);
    return { used, count: sources.length, limit: 2_400_000, maxCount: 16 };
  }
}
