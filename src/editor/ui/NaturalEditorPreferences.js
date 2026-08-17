import { NATURAL_EDITOR_UI_CONFIG } from './NaturalEditorUiConfig.generated.js';

function safeParseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function uniqueLimited(values, limit) {
  return [...new Set(values)].slice(0, limit);
}

export class NaturalEditorPreferences {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.favorites = new Set(safeParseList(
      storage?.getItem(NATURAL_EDITOR_UI_CONFIG.storage.favoritesKey),
    ));
    this.recent = uniqueLimited(
      safeParseList(storage?.getItem(NATURAL_EDITOR_UI_CONFIG.storage.recentKey)),
      NATURAL_EDITOR_UI_CONFIG.limits.recentObjects,
    );
  }

  isFavorite(key) {
    return this.favorites.has(key);
  }

  toggleFavorite(key) {
    if (!key) return false;
    if (this.favorites.has(key)) this.favorites.delete(key);
    else if (this.favorites.size < NATURAL_EDITOR_UI_CONFIG.limits.favoriteObjects) {
      this.favorites.add(key);
    }
    this.persist();
    return this.favorites.has(key);
  }

  remember(key) {
    if (!key) return;
    this.recent = uniqueLimited(
      [key, ...this.recent],
      NATURAL_EDITOR_UI_CONFIG.limits.recentObjects,
    );
    this.persist();
  }

  favoriteKeys() {
    return [...this.favorites];
  }

  recentKeys() {
    return [...this.recent];
  }

  persist() {
    try {
      this.storage?.setItem(
        NATURAL_EDITOR_UI_CONFIG.storage.favoritesKey,
        JSON.stringify([...this.favorites]),
      );
      this.storage?.setItem(
        NATURAL_EDITOR_UI_CONFIG.storage.recentKey,
        JSON.stringify(this.recent),
      );
    } catch {
      // Storage is optional. The UI remains fully usable in private/restricted contexts.
    }
  }
}
