import { createItemDefinitions } from './itemCatalogSchema.js';

/**
 * Immutable lookup table for authored item definitions.
 * Gameplay effects stay outside this layer; the catalogue only resolves data.
 */
export class ItemCatalog {
  #definitions;

  /**
   * @param {Map<string, object>|Iterable<[string, object]>|object} definitions
   */
  constructor(definitions) {
    const map = definitions instanceof Map
      ? definitions
      : definitions && typeof definitions[Symbol.iterator] === 'function'
        ? new Map(definitions)
        : null;
    if (!map) {
      throw new Error('ItemCatalog requires a Map of definitions.');
    }
    this.#definitions = new Map();
    for (const [key, definition] of map) {
      this.#definitions.set(key, Object.freeze({ ...definition, key }));
    }
  }

  static fromDocument(document, options = {}) {
    return new ItemCatalog(createItemDefinitions(document, options));
  }

  has(itemKey) {
    return this.#definitions.has(itemKey);
  }

  get(itemKey) {
    const definition = this.#definitions.get(itemKey);
    return definition ?? null;
  }

  require(itemKey) {
    const definition = this.get(itemKey);
    if (!definition) {
      throw new Error(`Unknown item key "${itemKey}".`);
    }
    return definition;
  }

  list() {
    return [...this.#definitions.values()];
  }

  keys() {
    return [...this.#definitions.keys()];
  }

  /** Returns true when every entry's itemKey is known. */
  validateEntries(entries) {
    if (!Array.isArray(entries)) return false;
    for (const entry of entries) {
      if (!entry || typeof entry.itemKey !== 'string' || !this.has(entry.itemKey)) {
        return false;
      }
    }
    return true;
  }

  canEquipInSlot(itemKey, slotId) {
    const definition = this.get(itemKey);
    if (!definition) return false;
    return definition.equipmentSlots.includes(slotId);
  }

  stackLimit(itemKey) {
    return this.require(itemKey).stackLimit;
  }

  isTwoHanded(itemKey) {
    return this.require(itemKey).hands === 2;
  }
}
