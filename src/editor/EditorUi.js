import { MINIMAP_SIZE } from './constants.js';
import {
  exportJson,
  exportMap,
  importJson,
  importMap,
  loadFromBrowser,
  loadJsonFromUrl,
  saveToBrowser,
} from './storage.js';
import { normalizeSceneSettings } from './settings/SceneSettings.js';
import { hexToRgbBytes } from './tileCatalog.js';

const TERRAIN_MODE_LABELS = Object.freeze({
  paint: 'Paint',
  raise: 'Raise',
  lower: 'Lower',
  smooth: 'Smooth',
});
const MINIMAP_HEIGHT_SHADE = 0.025;
const MINIMAP_MINIMUM_SHADE = 0.55;
const MINIMAP_MAXIMUM_SHADE = 1.25;
const ALL_CATEGORIES = 'all';
const CATEGORY_LABELS = Object.freeze({
  all: 'All',
  building: 'Buildings',
  defense: 'Defense',
  civic: 'Civic',
  nature: 'Nature',
  workshop: 'Workshop',
});

function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category.replace(/^\w/, (first) => first.toUpperCase());
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * `maps/` and `settings/` are served from the deployment root by the content
 * library plugin, so they follow Vite's configured base rather than assuming `/`.
 */
function contentLibraryUrl(relativePath) {
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}${relativePath}`;
}

/**
 * Manifests are author-maintained files. Entries missing a name or URL are
 * dropped rather than rendered as "undefined" options, and each URL resolves
 * against the manifest itself so authors can write plain relative filenames and
 * the library keeps working under a non-root deployment base.
 */
function manifestEntries(value, manifestUrl) {
  if (!Array.isArray(value)) return [];
  const base = new URL(manifestUrl, globalThis.location?.href ?? 'http://localhost/');
  return value.flatMap((entry) => {
    if (typeof entry?.url !== 'string' || entry.url.length === 0) return [];
    if (typeof entry?.name !== 'string' || entry.name.length === 0) return [];
    try {
      return [{ ...entry, name: entry.name, url: new URL(entry.url, base).href }];
    } catch {
      return [];
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export class EditorUi {
  constructor({ root, config, tileCatalog, tileMap, heightField, objectCatalog, objectMap }) {
    this.root = root;
    this.config = config;
    this.baseTileCatalog = [...tileCatalog];
    this.tileCatalog = [...tileCatalog];
    this.tileMap = tileMap;
    this.heightField = heightField;
    this.baseObjectCatalog = [...objectCatalog];
    this.objectCatalog = [...objectCatalog];
    this.objectMap = objectMap;
    this.objectByKey = new Map(objectCatalog.map((definition) => [definition.key, definition]));
    this.controller = null;
    this.toastTimer = null;
    this.minimapQueued = false;
    this.minimapCenter = { x: 0, z: 0 };
    this.minimapCells = config.world?.minimapCells ?? MINIMAP_SIZE;
    this.workshop = null;
    this.objectQuery = '';
    this.objectCategory = ALL_CATEGORIES;
    this.selectedObjectKey = null;
    this.biomeAssetPalette = null;
    this.sceneSettingsRuntime = null;
    this.sceneSettingsLibrary = [];
    this.sceneMapLibrary = [];
    this.sceneBrowserSettings = [];
    this.selectedBiomeAssetTileId = config.stylizedSurface?.rocks?.tileIds?.[0]
      ?? tileCatalog[0]?.id
      ?? 0;

    root.innerHTML = `
      <div class="editor-shell">
        <aside class="sidebar" aria-label="World editor tools">
          <header class="sidebar-header">
            <span class="sidebar-header__mark" aria-hidden="true">⚔️</span>
            <div class="sidebar-header__text">
              <h1>SimCity DnD</h1>
              <p>Infinite terrain and settlement editor</p>
            </div>
          </header>

          <nav class="panel panel--tools" aria-label="Editor mode">
            <div class="tool-row" data-role="tool-row">
              <button class="tool-button" type="button" data-tool="terrain">
                <span class="tool-button__icon" aria-hidden="true">⛰️</span>Terrain
              </button>
              <button class="tool-button" type="button" data-tool="object">
                <span class="tool-button__icon" aria-hidden="true">🏠</span>Objects
              </button>
              <button class="tool-button" type="button" data-tool="construction">
                <span class="tool-button__icon" aria-hidden="true">🏰</span>Build
              </button>
              <button class="tool-button" type="button" data-tool="select">
                <span class="tool-button__icon" aria-hidden="true">🎯</span>Select
              </button>
              <button class="tool-button" type="button" data-tool="settings">
                <span class="tool-button__icon" aria-hidden="true">⚙️</span>Settings
              </button>
              <button class="tool-button tool-button--workshop" type="button" data-tool="workshop">
                <span class="tool-button__icon" aria-hidden="true">🛠️</span>Workshop
              </button>
            </div>
          </nav>

          <section class="panel tool-panel" data-panel="terrain">
            <div class="panel-head">
              <h2>Terrain operation</h2>
              <span class="panel-count">strength ${config.terrain.sculptStrength}</span>
            </div>
            <div class="terrain-mode-row" data-role="terrain-mode-row">
              <button class="tool-button" type="button" data-terrain-mode="paint">Paint</button>
              <button class="tool-button" type="button" data-terrain-mode="raise">Raise</button>
              <button class="tool-button" type="button" data-terrain-mode="lower">Lower</button>
              <button class="tool-button" type="button" data-terrain-mode="smooth">Smooth</button>
            </div>
            <div data-role="tile-tools">
              <h2 class="panel-subheading">Terrain tiles</h2>
              <div class="tile-palette" data-role="tile-palette"></div>
            </div>
            <h2 class="panel-subheading">Brush size</h2>
            <div class="brush-row" data-role="brush-row"></div>
          </section>

          <section class="panel tool-panel" data-panel="object" hidden>
            <div class="panel-head">
              <h2>Place objects</h2>
              <span class="panel-count" data-role="object-total"></span>
            </div>
            <label class="search-field">
              <span class="search-field__icon" aria-hidden="true">🔍</span>
              <input
                class="search-field__input"
                type="search"
                data-role="object-search"
                placeholder="Search objects"
                aria-label="Search objects"
                autocomplete="off"
              />
            </label>
            <div class="chip-row" data-role="object-categories"></div>
            <div class="object-palette" data-role="object-palette"></div>
            <button class="action-button action-button--wide" type="button" data-action="rotate-placement">
              Rotate preview <kbd>R</kbd>
            </button>
            <p class="panel-note" data-role="placement-info">Rotation 0°</p>
          </section>

          <section class="panel tool-panel" data-panel="construction" hidden>
            <div class="panel-head">
              <h2>Live construction</h2>
              <span class="panel-count" data-role="construction-total">0</span>
            </div>
            <div class="terrain-mode-row" data-role="construction-mode-row">
              <button class="tool-button" type="button" data-construction-mode="draw">Draw curve</button>
              <button class="tool-button" type="button" data-construction-mode="edit">Edit anchors</button>
            </div>
            <label class="panel-note">
              Wall height
              <input data-role="construction-height" type="number" min="0.5" max="30" step="0.25" value="3.5" />
            </label>
            <label class="panel-note">
              Thickness
              <input data-role="construction-thickness" type="number" min="0.1" max="10" step="0.1" value="0.8" />
            </label>
            <p class="panel-note">Draw mode: drag across terrain. Edit mode: select a wall, then drag its gold anchors.</p>
            <div class="selection-card" data-role="selected-construction">No live construction selected.</div>
            <button class="action-button action-button--wide action-button--danger" type="button" data-action="delete-construction">
              Delete construction
            </button>
          </section>

          <section class="panel tool-panel" data-panel="select" hidden>
            <h2>Selected object</h2>
            <div class="selection-card" data-role="selected-object">Click a placed object.</div>
            <div class="action-grid">
              <button class="action-button" type="button" data-action="move-selected">Move</button>
              <button class="action-button" type="button" data-action="rotate-selected">Rotate</button>
              <button class="action-button action-button--danger" type="button" data-action="delete-selected">Delete</button>
            </div>
          </section>

          <section class="panel tool-panel god-rays-settings" data-panel="settings" hidden>
            <div class="settings-group scene-settings">
              <div class="panel-head">
                <h2>World look presets</h2>
                <span class="panel-count">map + visuals</span>
              </div>
              <p>Named presets capture the active map reference, god rays, regional placement, custom GLBs, and every biome asset choice.</p>
              <label class="settings-select">
                <span>Available settings</span>
                <select data-role="scene-settings-preset">
                  <option value="">Loading settings folder…</option>
                </select>
              </label>
              <label class="settings-select">
                <span>Preset name</span>
                <input data-role="scene-settings-name" type="text" maxlength="96" value="My world look" />
              </label>
              <div class="action-grid">
                <button class="action-button" type="button" data-action="load-scene-settings">Load selected</button>
                <button class="action-button" type="button" data-action="save-scene-settings">Save new</button>
                <button class="action-button" type="button" data-action="export-scene-settings">Export JSON</button>
                <button class="action-button" type="button" data-action="import-scene-settings">Local JSON</button>
              </div>
              <label class="settings-select settings-select--stacked">
                <span>Settings URL</span>
                <input data-role="scene-settings-url" type="url" placeholder="https://…/world-look.json" />
              </label>
              <button class="action-button action-button--wide" type="button" data-action="load-scene-settings-url">
                Load settings URL
              </button>
              <input data-role="scene-settings-file-input" type="file" accept="application/json,.json" hidden />
            </div>

            <div class="settings-group scene-settings">
              <h3>Map source</h3>
              <p>Load a bundled map from <code>maps/</code>, a local JSON file, or any CORS-enabled JSON URL.</p>
              <label class="settings-select">
                <span>Maps folder</span>
                <select data-role="scene-map-preset">
                  <option value="">Loading maps folder…</option>
                </select>
              </label>
              <button class="action-button action-button--wide" type="button" data-action="load-scene-map">
                Load selected map
              </button>
              <label class="settings-select settings-select--stacked">
                <span>Map URL</span>
                <input data-role="scene-map-url" type="url" placeholder="https://…/azgaar-full.json" />
              </label>
              <div class="action-grid">
                <button class="action-button" type="button" data-action="load-scene-map-url">Load map URL</button>
                <button class="action-button" type="button" data-action="import">Load local map</button>
              </div>
            </div>

            <div class="settings-group scene-settings">
              <h3>Add GLB asset</h3>
              <p>URL and local GLBs become selectable variants after the one-time scene reload. KTX2/Meshopt assets use the shared renderer-aware loader.</p>
              <label class="settings-select">
                <span>Layer</span>
                <select data-role="scene-asset-layer">
                  <option value="rocks">Rocks</option>
                  <option value="bushes">Bushes</option>
                  <option value="trees">Trees</option>
                  <option value="groundDetails">Ground details</option>
                  <option value="aquaticPlants">Aquatic plants</option>
                </select>
              </label>
              <label class="settings-select settings-select--stacked">
                <span>Display name</span>
                <input data-role="scene-asset-label" type="text" maxlength="96" placeholder="Granite rock" />
              </label>
              <label class="settings-select settings-select--stacked">
                <span>GLB URL</span>
                <input data-role="scene-asset-url" type="url" placeholder="https://…/rock.glb" />
              </label>
              <label class="settings-select">
                <span>Scale</span>
                <input data-role="scene-asset-scale" type="number" min="0.000001" max="10000" step="0.01" value="1" />
              </label>
              <div class="action-grid">
                <button class="action-button" type="button" data-action="add-scene-asset-url">Add URL GLB</button>
                <button class="action-button" type="button" data-action="add-scene-asset-local">Add local GLB</button>
              </div>
              <input data-role="scene-asset-file-input" type="file" accept="model/gltf-binary,.glb" hidden />
            </div>

            <div class="settings-group scene-settings">
              <h3>Grass blades</h3>
              <p>Blade silhouettes baked from the authored grass GLBs. Switching rebuilds resident chunk geometry, so expect one hitch per change, then a steady state to measure.</p>
              <label class="settings-select">
                <span>Profile set</span>
                <select data-role="grass-blade-profile">
                  <option value="">Loading profiles…</option>
                </select>
              </label>
              <p class="settings-readout" data-role="grass-blade-readout">—</p>
            </div>

            <div class="panel-head">
              <h2>God rays</h2>
              <span class="panel-count">live preview</span>
            </div>
            <label class="settings-toggle">
              <span>
                <strong>Enabled</strong>
                <small>Perspective player camera only</small>
              </span>
              <input type="checkbox" data-god-rays-setting="enabled" />
            </label>
            <label class="settings-select">
              <span>Technique</span>
              <select data-god-rays-setting="technique">
                <option value="screen-space">Screen-space radial</option>
                <option value="volumetric">Volumetric shadow</option>
              </select>
            </label>

            <div class="settings-group" data-god-rays-section="screen-space">
              <h3>Screen-space radial</h3>
              <p>Cloud-sensitive shafts around the visible sun. Best for distant canopy and cloud silhouettes.</p>
              ${this.rangeControl('Intensity', 'screenIntensity', 0, 3, 0.05, 2)}
              ${this.rangeControl('Resolution', 'screenResolutionScale', 0.25, 1, 0.05, 2)}
              ${this.rangeControl('Ray length', 'screenDensity', 0.1, 2, 0.02, 2)}
              ${this.rangeControl('Persistence', 'screenDecay', 0, 1, 0.01, 2)}
              ${this.rangeControl('Sample weight', 'screenWeight', 0.01, 1, 0.01, 2)}
              ${this.rangeControl('Exposure', 'screenExposure', 0.01, 2, 0.02, 2)}
              ${this.rangeControl('Dust strength', 'screenDustStrength', 0, 1, 0.01, 2)}
              ${this.rangeControl('Dust scale', 'screenDustScale', 0.1, 12, 0.1, 1)}
              ${this.rangeControl('Dust motion', 'screenDustSpeed', 0, 0.1, 0.001, 3)}
            </div>

            <div class="settings-group" data-god-rays-section="volumetric" hidden>
              <h3>Volumetric shadow</h3>
              <p>Raymarches the directional shadow map and concentrates scattering with exponential height fog.</p>
              ${this.rangeControl('Intensity', 'volumetricIntensity', 0, 3, 0.05, 2)}
              ${this.rangeControl('Resolution', 'volumetricResolutionScale', 0.25, 1, 0.05, 2)}
              ${this.rangeControl('Ray steps', 'volumetricRaymarchSteps', 8, 96, 1, 0)}
              ${this.rangeControl('Air density', 'volumetricDensity', 0.01, 2, 0.01, 2)}
              ${this.rangeControl('Brightness limit', 'volumetricMaxDensity', 0.01, 1, 0.01, 2)}
              ${this.rangeControl('Distance fade', 'volumetricDistanceAttenuation', 0.1, 6, 0.1, 1)}
              ${this.rangeControl('Softness', 'volumetricBlurSoftness', 0, 2.5, 0.05, 2)}
              ${this.rangeControl('Cloud influence', 'volumetricCloudInfluence', 0, 1, 0.01, 2)}
              <h3>Exponential height fog</h3>
              ${this.rangeControl('Fog density', 'heightFogDensity', 0.0001, 0.08, 0.0005, 4)}
              ${this.rangeControl('Base height', 'heightFogBaseHeight', -20, 60, 0.5, 1)}
              ${this.rangeControl('Height falloff', 'heightFogFalloff', 0.001, 0.2, 0.002, 3)}
              ${this.rangeControl('Max distance', 'heightFogMaxDistance', 20, 500, 5, 0)}
            </div>

            <div class="settings-group">
              <h3>Cloud transmission</h3>
              ${this.rangeControl('Cloud occlusion', 'cloudOcclusion', 0, 1, 0.01, 2)}
            </div>

            <div class="settings-group biome-asset-settings">
              <h3>Biome scenery assets</h3>
              <p>Choose one authored look per biome, or keep the deterministic automatic mix.</p>
              <label class="settings-select">
                <span>Biome</span>
                <select data-role="biome-asset-biome"></select>
              </label>
              <div class="biome-asset-controls" data-role="biome-asset-controls"></div>
              <div class="action-grid">
                <button class="action-button" type="button" data-action="save-biome-config">Save config</button>
                <button class="action-button" type="button" data-action="load-biome-config">Load config</button>
                <button class="action-button" type="button" data-action="export-biome-config">Export JSON</button>
                <button class="action-button" type="button" data-action="import-biome-config">Import JSON</button>
              </div>
              <button class="action-button action-button--wide" type="button" data-action="reset-biome-config">
                Restore automatic mixes
              </button>
              <input
                data-role="biome-config-file-input"
                type="file"
                accept="application/json,.json"
                hidden
              />
            </div>
          </section>

          <section class="panel">
            <h2>World actions</h2>
            <div class="action-grid">
              <button class="action-button" type="button" data-action="undo">Undo</button>
              <button class="action-button" type="button" data-action="redo">Redo</button>
              <button class="action-button" type="button" data-action="save">Save</button>
              <button class="action-button" type="button" data-action="load">Load</button>
              <button class="action-button" type="button" data-action="export">Export</button>
              <button class="action-button" type="button" data-action="import">Import</button>
              <button class="action-button" type="button" data-action="new">Clear edits</button>
              <button class="action-button" type="button" data-action="camera">Reset view</button>
            </div>
            <input data-role="file-input" type="file" accept="application/json,.json" hidden />
          </section>

          <section class="panel">
            <h2>Local overview</h2>
            <div class="minimap-frame">
              <canvas data-role="minimap" width="${MINIMAP_SIZE}" height="${MINIMAP_SIZE}"></canvas>
            </div>
            <p class="panel-note">${this.minimapCells} × ${this.minimapCells} cells around the active view.</p>
          </section>

          <details class="panel panel--collapsible" open>
            <summary class="panel-summary"><h2>Controls</h2></summary>
            <ul class="help-list">
              <li><kbd>T / O / V</kbd> Terrain, objects, select</li>
              <li><kbd>P / U</kbd> Paint or raise terrain</li>
              <li><kbd>J / K</kbd> Lower or smooth terrain</li>
              <li><kbd>Left drag</kbd> Apply terrain brush</li>
              <li><kbd>Left click</kbd> Place or select object</li>
              <li><kbd>R</kbd> Rotate preview or selection</li>
              <li><kbd>Delete</kbd> Remove selected object</li>
              <li><kbd>Space drag</kbd> Pan map</li>
              <li><kbd>Right drag</kbd> Rotate view</li>
              <li><kbd>Wheel</kbd> Zoom</li>
              <li><kbd>1–0</kbd> Select terrain tile</li>
            </ul>
          </details>
        </aside>

        <main class="viewport-shell" data-role="viewport">
          <div class="topbar">
            <span>Unbounded world</span>
            <span>${config.world.chunkSize} × ${config.world.chunkSize} cell chunks</span>
            <span data-role="streaming-status">Streaming —</span>
            <span data-role="object-count">0 objects</span>
            <span data-role="construction-count">0 constructions</span>
          </div>
          <div class="toast" data-role="toast" aria-live="polite"></div>
          <div class="statusbar">
            <span data-role="coordinates">Cell —</span>
            <span data-role="hover-height">Height —</span>
            <span data-role="hover-tile">Tile —</span>
            <span data-role="hover-object">Object —</span>
            <span data-role="selection">Terrain —</span>
          </div>
        </main>
      </div>
    `;

    this.viewport = root.querySelector('[data-role="viewport"]');
    this.toolRow = root.querySelector('[data-role="tool-row"]');
    this.terrainModeRow = root.querySelector('[data-role="terrain-mode-row"]');
    this.constructionModeRow = root.querySelector('[data-role="construction-mode-row"]');
    this.tileTools = root.querySelector('[data-role="tile-tools"]');
    this.palette = root.querySelector('[data-role="tile-palette"]');
    this.objectPalette = root.querySelector('[data-role="object-palette"]');
    this.objectSearch = root.querySelector('[data-role="object-search"]');
    this.objectCategories = root.querySelector('[data-role="object-categories"]');
    this.objectTotal = root.querySelector('[data-role="object-total"]');
    this.brushRow = root.querySelector('[data-role="brush-row"]');
    this.minimap = root.querySelector('[data-role="minimap"]');
    this.toast = root.querySelector('[data-role="toast"]');
    this.coordinates = root.querySelector('[data-role="coordinates"]');
    this.hoverHeight = root.querySelector('[data-role="hover-height"]');
    this.hoverTile = root.querySelector('[data-role="hover-tile"]');
    this.hoverObject = root.querySelector('[data-role="hover-object"]');
    this.selection = root.querySelector('[data-role="selection"]');
    this.objectCount = root.querySelector('[data-role="object-count"]');
    this.constructionCount = root.querySelector('[data-role="construction-count"]');
    this.constructionTotal = root.querySelector('[data-role="construction-total"]');
    this.constructionHeight = root.querySelector('[data-role="construction-height"]');
    this.constructionThickness = root.querySelector('[data-role="construction-thickness"]');
    this.selectedConstruction = root.querySelector('[data-role="selected-construction"]');
    this.streamingStatus = root.querySelector('[data-role="streaming-status"]');
    this.selectedObject = root.querySelector('[data-role="selected-object"]');
    this.placementInfo = root.querySelector('[data-role="placement-info"]');
    this.fileInput = root.querySelector('[data-role="file-input"]');
    this.sceneSettingsPreset = root.querySelector('[data-role="scene-settings-preset"]');
    this.sceneSettingsName = root.querySelector('[data-role="scene-settings-name"]');
    this.sceneSettingsUrl = root.querySelector('[data-role="scene-settings-url"]');
    this.sceneSettingsFileInput = root.querySelector('[data-role="scene-settings-file-input"]');
    this.sceneMapPreset = root.querySelector('[data-role="scene-map-preset"]');
    this.sceneMapUrl = root.querySelector('[data-role="scene-map-url"]');
    this.sceneAssetLayer = root.querySelector('[data-role="scene-asset-layer"]');
    this.sceneAssetLabel = root.querySelector('[data-role="scene-asset-label"]');
    this.sceneAssetUrl = root.querySelector('[data-role="scene-asset-url"]');
    this.sceneAssetScale = root.querySelector('[data-role="scene-asset-scale"]');
    this.sceneAssetFileInput = root.querySelector('[data-role="scene-asset-file-input"]');
    this.biomeConfigFileInput = root.querySelector('[data-role="biome-config-file-input"]');
    this.biomeAssetBiome = root.querySelector('[data-role="biome-asset-biome"]');
    this.biomeAssetControls = root.querySelector('[data-role="biome-asset-controls"]');
    this.grassBladeProfileSelect = root.querySelector('[data-role="grass-blade-profile"]');
    this.grassBladeReadout = root.querySelector('[data-role="grass-blade-readout"]');
    this.grassBladeProfiles = null;
    this.godRaysPanel = root.querySelector('[data-panel="settings"]');
    this.godRaysControls = [
      ...root.querySelectorAll('[data-god-rays-setting]'),
    ];
    this.godRaysSections = [
      ...root.querySelectorAll('[data-god-rays-section]'),
    ];
    this.godRaysEffect = null;

    this.renderTileButtons();
    this.renderCategoryChips();
    this.renderObjectButtons();
    this.renderBrushButtons();
  }

  attachWorkshop(workshop) {
    this.workshop = workshop;
  }

  /**
   * Applying a world look reloads the page, because asset variants are resolved
   * into the editor config at boot. Adding a GLB reads like a small additive
   * action, so warn before it takes unsaved terrain, objects and constructions
   * with it.
   */
  confirmSceneReload(action) {
    if (!this.controller?.getState().canUndo) return true;
    return window.confirm(
      `${action} reloads the scene and discards unsaved world edits.`
      + ' Save the world first if you want to keep them. Continue?',
    );
  }

  attachBiomeAssetPalette(palette) {
    this.biomeAssetPalette = palette;
    this.renderBiomeAssetSelector();
    palette.subscribe(() => this.renderBiomeAssetControls());
  }

  async attachSceneSettings(runtime) {
    this.sceneSettingsRuntime = runtime;
    this.sceneSettingsName.value = runtime.document.name;
    await this.refreshSceneLibraries();
  }

  async refreshSceneLibraries() {
    if (!this.sceneSettingsRuntime) return;
    // Each source fails independently: a missing manifest must not hide the
    // browser presets, and blocked IndexedDB must not hide the folder library.
    const settingsManifestUrl = contentLibraryUrl('settings/manifest.json');
    const mapManifestUrl = contentLibraryUrl('maps/manifest.json');
    const [settingsManifest, mapManifest, browserSettings] = await Promise.all([
      loadJsonFromUrl(settingsManifestUrl).catch(() => ({})),
      loadJsonFromUrl(mapManifestUrl).catch(() => ({})),
      this.sceneSettingsRuntime.listBrowserSettings().catch(() => []),
    ]);
    this.sceneSettingsLibrary = manifestEntries(settingsManifest.settings, settingsManifestUrl);
    this.sceneMapLibrary = manifestEntries(mapManifest.maps, mapManifestUrl);
    this.sceneBrowserSettings = browserSettings;
    this.sceneSettingsPreset.innerHTML = [
      '<option value="">Choose settings…</option>',
      ...this.sceneSettingsLibrary.map((entry) => (
        `<option value="url:${escapeHtml(entry.url)}">Folder · ${escapeHtml(entry.name)}</option>`
      )),
      ...browserSettings.map((entry) => (
        `<option value="browser:${escapeHtml(entry.key)}">Browser · ${escapeHtml(entry.name)}</option>`
      )),
    ].join('');
    this.sceneMapPreset.innerHTML = [
      '<option value="">Choose map…</option>',
      ...this.sceneMapLibrary.map((entry) => (
        `<option value="${escapeHtml(entry.url)}">${escapeHtml(entry.name)}</option>`
      )),
    ].join('');
  }

  renderBiomeAssetSelector() {
    if (!this.biomeAssetBiome) return;
    const availableIds = new Set(this.tileCatalog.map(({ id }) => id));
    if (!availableIds.has(this.selectedBiomeAssetTileId)) {
      this.selectedBiomeAssetTileId = this.tileCatalog[0]?.id ?? 0;
    }
    this.biomeAssetBiome.innerHTML = this.tileCatalog.map((tile) => `
      <option value="${tile.id}">
        ${escapeHtml(tile.icon)} ${escapeHtml(tile.label)} · ID ${tile.id}
      </option>
    `).join('');
    this.biomeAssetBiome.value = String(this.selectedBiomeAssetTileId);
    this.renderBiomeAssetControls();
  }

  renderBiomeAssetControls() {
    if (!this.biomeAssetPalette || !this.biomeAssetControls) return;
    const tileId = this.selectedBiomeAssetTileId;
    this.biomeAssetControls.innerHTML = this.biomeAssetPalette.listLayers().map((layer) => {
      const enabled = layer.eligibleTileIds.has(tileId);
      const selected = this.biomeAssetPalette.getSelection(tileId, layer.id);
      return `
        <label class="settings-select">
          <span>
            ${escapeHtml(layer.label)}
            ${enabled ? '' : '<small>Not placed in this biome</small>'}
          </span>
          <select
            data-biome-asset-layer="${escapeHtml(layer.id)}"
            ${enabled ? '' : 'disabled'}
          >
            <option value="" ${selected === '' ? 'selected' : ''}>Automatic mix</option>
            ${layer.options.filter((option) => (
              !option.tileIds || option.tileIds.has(tileId)
            )).map((option) => `
              <option
                value="${escapeHtml(option.key)}"
                ${selected === option.key ? 'selected' : ''}
              >${escapeHtml(option.label)}</option>
            `).join('')}
          </select>
        </label>
      `;
    }).join('');
  }

  biomeConfigStorageKey() {
    return `${this.config.storage.key}:biome-assets`;
  }

  rangeControl(label, setting, minimum, maximum, step, precision) {
    return `
      <label class="settings-range">
        <span>${label}</span>
        <output data-god-rays-output="${setting}">—</output>
        <input
          type="range"
          min="${minimum}"
          max="${maximum}"
          step="${step}"
          data-god-rays-setting="${setting}"
          data-precision="${precision}"
        />
      </label>
    `;
  }

  /**
   * Hands the Settings control the live blade-profile pool.
   *
   * Called after the manifest resolves, so the list reflects what was actually
   * baked: a set naming profiles the manifest does not carry is still offered, but
   * labelled, because a missing build artifact should not look like a missing
   * feature.
   */
  attachGrassBladeProfiles(pool) {
    this.grassBladeProfiles = pool;
    this.renderGrassBladeProfiles();
  }

  renderGrassBladeProfiles() {
    const select = this.grassBladeProfileSelect;
    if (!select || !this.grassBladeProfiles) return;
    const state = this.grassBladeProfiles.describe();
    select.innerHTML = state.sets.map((set) => {
      const suffix = set.complete ? '' : ` (${set.resolved}/${set.requested} baked)`;
      return `<option value="${set.id}">${set.label}${suffix}</option>`;
    }).join('');
    select.value = state.setId;
    this.updateGrassBladeReadout();
  }

  /** Blade shape is baked per vertex, so the cost of a set is its triangle count —
   *  reported next to the switch so a comparison does not need the QA harness. */
  updateGrassBladeReadout(stats = null) {
    const readout = this.grassBladeReadout;
    if (!readout || !this.grassBladeProfiles) return;
    const state = this.grassBladeProfiles.describe();
    const parts = [];
    if (state.manifestError) parts.push(`manifest unavailable (${state.manifestError})`);
    parts.push(`shapes: ${state.activeProfiles.join(', ') || 'none'}`);
    if (stats?.clumps) parts.push(`${stats.clumps.toLocaleString()} clumps/chunk`);
    if (stats?.blades) parts.push(`${stats.blades.toLocaleString()} blades/chunk`);
    if (stats?.triangles) parts.push(`${stats.triangles.toLocaleString()} tris/chunk`);
    if (Number.isFinite(stats?.fps)) parts.push(`${stats.fps.toFixed(1)} fps`);
    readout.textContent = parts.join(' · ');
  }

  attachGodRays(effect) {
    this.godRaysEffect = effect;
    this.syncGodRaysSettings(effect?.getSettings?.());
  }

  syncGodRaysSettings(settings) {
    if (!settings) return;
    for (const control of this.godRaysControls) {
      const value = settings[control.dataset.godRaysSetting];
      if (value === undefined) continue;
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
      this.updateGodRaysOutput(control);
    }
    for (const section of this.godRaysSections) {
      section.hidden = section.dataset.godRaysSection !== settings.technique;
    }
  }

  updateGodRaysOutput(control) {
    const output = this.root.querySelector(
      `[data-god-rays-output="${control.dataset.godRaysSetting}"]`,
    );
    if (!output) return;
    const precision = Number(control.dataset.precision ?? 2);
    output.value = Number(control.value).toFixed(precision);
  }

  setProceduralObjectDefinitions(definitions) {
    this.objectCatalog = [...this.baseObjectCatalog, ...definitions];
    this.objectByKey = new Map(this.objectCatalog.map((definition) => [definition.key, definition]));
    this.renderCategoryChips();
    this.renderObjectButtons();
  }

  bind(controller) {
    this.controller = controller;
    this.toolRow.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tool]');
      if (!button) return;
      if (button.dataset.tool === 'workshop') {
        this.workshop?.open();
        return;
      }
      controller.selectTool(button.dataset.tool);
    });
    this.terrainModeRow.addEventListener('click', (event) => {
      const button = event.target.closest('[data-terrain-mode]');
      if (button) controller.selectTerrainMode(button.dataset.terrainMode);
    });
    this.constructionModeRow.addEventListener('click', (event) => {
      const button = event.target.closest('[data-construction-mode]');
      if (button) controller.selectConstructionMode(button.dataset.constructionMode);
    });
    const updateConstructionDimensions = () => controller.setConstructionDimensions({
      height: Number(this.constructionHeight.value),
      thickness: Number(this.constructionThickness.value),
    });
    this.constructionHeight.addEventListener('change', updateConstructionDimensions);
    this.constructionThickness.addEventListener('change', updateConstructionDimensions);
    this.grassBladeProfileSelect?.addEventListener('change', () => {
      if (!this.grassBladeProfiles?.select(this.grassBladeProfileSelect.value)) return;
      this.updateGrassBladeReadout();
    });
    this.godRaysPanel.addEventListener('input', (event) => {
      const control = event.target.closest('[data-god-rays-setting]');
      if (!control || !this.godRaysEffect) return;
      const value = control.type === 'checkbox'
        ? control.checked
        : control.tagName === 'SELECT'
          ? control.value
          : Number(control.value);
      const settings = this.godRaysEffect.setSettings({
        [control.dataset.godRaysSetting]: value,
      });
      this.updateGodRaysOutput(control);
      if (control.dataset.godRaysSetting === 'technique') {
        this.syncGodRaysSettings(settings);
      }
    });
    this.biomeAssetBiome.addEventListener('change', () => {
      this.selectedBiomeAssetTileId = Number(this.biomeAssetBiome.value);
      this.renderBiomeAssetControls();
    });
    this.biomeAssetControls.addEventListener('change', (event) => {
      const select = event.target.closest('[data-biome-asset-layer]');
      if (!select || !this.biomeAssetPalette) return;
      try {
        this.biomeAssetPalette.setSelection(
          this.selectedBiomeAssetTileId,
          select.dataset.biomeAssetLayer,
          select.value,
        );
        const tile = this.tileCatalog.find(({ id }) => id === this.selectedBiomeAssetTileId);
        this.showToast(`${tile?.label ?? 'Biome'} scenery updated.`);
      } catch (error) {
        this.renderBiomeAssetControls();
        this.showToast(error.message, true);
      }
    });
    this.palette.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tile-id]');
      if (button) controller.selectTile(Number(button.dataset.tileId));
    });
    this.objectPalette.addEventListener('click', (event) => {
      const button = event.target.closest('[data-object-key]');
      if (button) controller.selectObjectDefinition(button.dataset.objectKey);
    });
    this.objectSearch.addEventListener('input', () => {
      this.objectQuery = this.objectSearch.value;
      this.renderObjectButtons();
    });
    this.objectCategories.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-object-category]');
      if (!chip) return;
      this.objectCategory = chip.dataset.objectCategory;
      this.applyCategorySelection();
      this.renderObjectButtons();
    });
    this.brushRow.addEventListener('click', (event) => {
      const button = event.target.closest('[data-brush-size]');
      if (button) controller.selectBrush(Number(button.dataset.brushSize));
    });
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (button) this.handleAction(button.dataset.action);
    });
    this.fileInput.addEventListener('change', async () => {
      const [file] = this.fileInput.files;
      this.fileInput.value = '';
      if (!file) return;
      try {
        const document = this.sceneSettingsRuntime
          ? await this.sceneSettingsRuntime.loadEmbeddedMap(
            await importJson(file),
            file.name,
          )
          : await importMap(file, {
            config: this.config,
            resolveAzgaarOptions: (summary) => this.resolveAzgaarImportOptions(summary),
          });
        if (!this.sceneSettingsRuntime) {
          controller.loadDocument(document);
          this.syncImportedBiomeTiles(document);
          this.minimapCenter = controller.getFocusCell?.() ?? this.minimapCenter;
          this.updateMinimap();
        }
        this.showToast('World imported.');
      } catch (error) {
        this.showToast(error.message, true);
      }
    });
    this.sceneSettingsFileInput.addEventListener('change', async () => {
      const [file] = this.sceneSettingsFileInput.files;
      this.sceneSettingsFileInput.value = '';
      if (!file || !this.sceneSettingsRuntime) return;
      try {
        const document = normalizeSceneSettings(await importJson(file));
        if (!this.confirmSceneReload('Loading a world look')) return;
        this.sceneSettingsRuntime.activate(document);
      } catch (error) {
        this.showToast(error.message, true);
      }
    });
    this.sceneAssetFileInput.addEventListener('change', async () => {
      const [file] = this.sceneAssetFileInput.files;
      this.sceneAssetFileInput.value = '';
      if (!file || !this.sceneSettingsRuntime) return;
      try {
        if (!this.confirmSceneReload('Adding a GLB')) return;
        await this.sceneSettingsRuntime.addLocalAsset({
          layer: this.sceneAssetLayer.value,
          file,
          label: this.sceneAssetLabel.value.trim() || file.name.replace(/\.glb$/i, ''),
          scale: Number(this.sceneAssetScale.value),
          tileIds: [this.selectedBiomeAssetTileId],
        });
      } catch (error) {
        this.showToast(error.message, true);
      }
    });
    this.biomeConfigFileInput.addEventListener('change', async () => {
      const [file] = this.biomeConfigFileInput.files;
      this.biomeConfigFileInput.value = '';
      if (!file || !this.biomeAssetPalette) return;
      try {
        this.biomeAssetPalette.replaceDocument(await importJson(file));
        this.showToast('Biome scenery configuration imported.');
      } catch (error) {
        this.showToast(error.message, true);
      }
    });
    this.minimap.addEventListener('click', (event) => {
      const bounds = this.minimap.getBoundingClientRect();
      const normalizedX = (event.clientX - bounds.left) / bounds.width - 0.5;
      const normalizedZ = (event.clientY - bounds.top) / bounds.height - 0.5;
      controller.focusCell(
        Math.floor(this.minimapCenter.x + normalizedX * this.minimapCells),
        Math.floor(this.minimapCenter.z + normalizedZ * this.minimapCells),
      );
      this.minimapCenter = controller.getFocusCell?.() ?? this.minimapCenter;
      this.queueMinimapUpdate();
    });

    controller.subscribe((state) => this.renderState(state));
    controller.subscribeHover((hover) => this.renderHover(hover));
    controller.subscribeNotice(({ message, isError }) => this.showToast(message, isError));
    controller.subscribeMap(({ final }) => {
      if (final) this.queueMinimapUpdate();
    });
    this.updateMinimap();
  }

  renderTileButtons() {
    this.palette.innerHTML = this.tileCatalog.map((tile) => `
      <button class="tile-button" type="button" data-tile-id="${tile.id}" title="${escapeHtml(tile.label)}">
        <span class="tile-button__swatch" style="background:${tile.color}"></span>
        <span class="tile-button__label">${escapeHtml(tile.icon)} ${escapeHtml(tile.label)}</span>
        <span class="tile-button__shortcut">${escapeHtml(tile.shortcut)}</span>
      </button>
    `).join('');
  }

  syncImportedBiomeTiles(document) {
    const importedTiles = (document.world?.baseTerrain?.biomes ?? []).map((biome) => ({
      id: biome.tileId,
      key: biome.key,
      label: biome.name,
      shortcut: '',
      color: biome.color,
      icon: biome.icon,
      terrainClass: biome.terrainClass,
    }));
    const importedById = new Map(importedTiles.map((tile) => [tile.id, tile]));
    this.tileCatalog = [
      ...this.baseTileCatalog.map((tile) => importedById.get(tile.id) ?? tile),
      ...importedTiles.filter((tile) => !this.baseTileCatalog.some(({ id }) => id === tile.id)),
    ];
    this.renderTileButtons();
    this.renderBiomeAssetSelector();
  }

  resolveAzgaarImportOptions(summary) {
    const defaultWidthKm = Math.round(summary.physicalWidthMeters / 1000);
    const defaultHeightKm = Math.round(summary.physicalHeightMeters / 1000);
    const rawWidth = window.prompt(
      `Azgaar macro atlas: ${summary.atlasWidth} × ${summary.atlasHeight}\n`
        + `Source scale: ${defaultWidthKm.toLocaleString()} × `
        + `${defaultHeightKm.toLocaleString()} km\n`
        + `Biomes: ${summary.standardBiomeCount} standard`
        + `${summary.customBiomeCount ? ` + ${summary.customBiomeCount} custom` : ''}\n`
        + `Estimated raw atlas memory: `
        + `${(summary.estimatedRawBytes / 1024 / 1024).toFixed(1)} MiB\n\n`
        + 'Playable world width in kilometers:',
      String(defaultWidthKm),
    );
    if (rawWidth === null) {
      throw new Error('Azgaar import cancelled.');
    }
    const widthKm = Number(rawWidth);
    if (!Number.isFinite(widthKm) || widthKm <= 0) {
      throw new Error('Azgaar world width must be a positive number of kilometers.');
    }
    return { physicalWidthMeters: widthKm * 1000 };
  }

  matchingObjectDefinitions() {
    const query = this.objectQuery.trim().toLowerCase();
    return this.objectCatalog.filter((definition) => {
      if (this.objectCategory !== ALL_CATEGORIES && definition.category !== this.objectCategory) {
        return false;
      }
      if (query === '') {
        return true;
      }
      return definition.label.toLowerCase().includes(query)
        || definition.key.toLowerCase().includes(query)
        || definition.category.toLowerCase().includes(query);
    });
  }

  renderCategoryChips() {
    const categories = [ALL_CATEGORIES, ...new Set(this.objectCatalog.map(({ category }) => category))];
    if (!categories.includes(this.objectCategory)) {
      this.objectCategory = ALL_CATEGORIES;
    }
    this.objectCategories.innerHTML = categories.map((category) => {
      const count = category === ALL_CATEGORIES
        ? this.objectCatalog.length
        : this.objectCatalog.filter((definition) => definition.category === category).length;
      return `
        <button class="chip" type="button" data-object-category="${escapeHtml(category)}">
          ${escapeHtml(categoryLabel(category))}<span class="chip__count">${count}</span>
        </button>
      `;
    }).join('');
    this.applyCategorySelection();
  }

  applyCategorySelection() {
    for (const chip of this.objectCategories.querySelectorAll('[data-object-category]')) {
      chip.classList.toggle('is-active', chip.dataset.objectCategory === this.objectCategory);
    }
  }

  renderObjectButtons() {
    const matches = this.matchingObjectDefinitions();
    this.objectTotal.textContent = matches.length === this.objectCatalog.length
      ? `${this.objectCatalog.length}`
      : `${matches.length} / ${this.objectCatalog.length}`;

    if (matches.length === 0) {
      this.objectPalette.innerHTML = '<p class="palette-empty">No objects match this filter.</p>';
      return;
    }

    const groups = new Map();
    for (const definition of matches) {
      const group = groups.get(definition.category) ?? [];
      group.push(definition);
      groups.set(definition.category, group);
    }

    this.objectPalette.innerHTML = Array.from(groups, ([category, definitions]) => `
      <div class="object-group">
        <h3 class="object-group__title">${escapeHtml(categoryLabel(category))}</h3>
        <div class="object-grid">
          ${definitions.map((definition) => `
            <button
              class="object-card"
              type="button"
              data-object-key="${escapeHtml(definition.key)}"
              title="${escapeHtml(definition.label)}"
            >
              <span class="object-card__icon" style="--object-color:${escapeHtml(definition.color)}">
                ${escapeHtml(definition.icon)}
              </span>
              <span class="object-card__label">${escapeHtml(definition.label)}</span>
              <span class="object-card__size">${definition.footprint.width}×${definition.footprint.depth}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');
    this.applyObjectSelection();
  }

  applyObjectSelection() {
    for (const button of this.objectPalette.querySelectorAll('[data-object-key]')) {
      button.classList.toggle('is-active', button.dataset.objectKey === this.selectedObjectKey);
    }
  }

  renderBrushButtons() {
    this.brushRow.innerHTML = this.config.brush.sizes.map((size) => `
      <button class="brush-button" type="button" data-brush-size="${size}">${size}</button>
    `).join('');
  }

  renderState(state) {
    for (const button of this.toolRow.querySelectorAll('[data-tool]')) {
      button.classList.toggle('is-active', button.dataset.tool === state.tool);
    }
    for (const panel of this.root.querySelectorAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== state.tool;
    }
    for (const button of this.terrainModeRow.querySelectorAll('[data-terrain-mode]')) {
      button.classList.toggle('is-active', button.dataset.terrainMode === state.terrainMode);
    }
    for (const button of this.constructionModeRow.querySelectorAll('[data-construction-mode]')) {
      button.classList.toggle(
        'is-active',
        button.dataset.constructionMode === state.constructionMode,
      );
    }
    this.tileTools.hidden = state.terrainMode !== 'paint';
    for (const button of this.palette.querySelectorAll('[data-tile-id]')) {
      button.classList.toggle('is-active', Number(button.dataset.tileId) === state.selectedTileId);
    }
    this.selectedObjectKey = state.selectedObjectKey;
    this.applyObjectSelection();
    for (const button of this.brushRow.querySelectorAll('[data-brush-size]')) {
      button.classList.toggle('is-active', Number(button.dataset.brushSize) === state.brushSize);
    }
    this.root.querySelector('[data-action="undo"]').disabled = !state.canUndo;
    this.root.querySelector('[data-action="redo"]').disabled = !state.canRedo;
    this.root.querySelector('[data-action="move-selected"]').disabled = !state.selectedObject;
    this.root.querySelector('[data-action="rotate-selected"]').disabled = !state.selectedObject;
    this.root.querySelector('[data-action="delete-selected"]').disabled = !state.selectedObject;
    this.root.querySelector('[data-action="delete-construction"]').disabled = !state.selectedConstruction;

    this.objectCount.textContent = `${state.objectCount} object${state.objectCount === 1 ? '' : 's'}`;
    this.constructionCount.textContent = `${state.constructionCount} construction${state.constructionCount === 1 ? '' : 's'}`;
    this.constructionTotal.textContent = `${state.constructionCount}`;
    const tile = this.tileMap.getTileDefinition(state.selectedTileId);
    const objectDefinition = this.objectByKey.get(state.selectedObjectKey)
      ?? this.objectCatalog[0];
    const rotatedFootprint = state.objectRotation % 2 === 0
      ? objectDefinition.footprint
      : { width: objectDefinition.footprint.depth, depth: objectDefinition.footprint.width };
    this.placementInfo.textContent = `${objectDefinition.label} · ${state.objectRotation * 90}° · ${rotatedFootprint.width}×${rotatedFootprint.depth}`;

    if (state.tool === 'terrain') {
      const modeLabel = TERRAIN_MODE_LABELS[state.terrainMode];
      this.selection.textContent = state.terrainMode === 'paint'
        ? `${modeLabel} ${tile.label} · ${state.brushSize} × ${state.brushSize}`
        : `${modeLabel} · ${state.brushSize} × ${state.brushSize}`;
    } else if (state.tool === 'object') {
      this.selection.textContent = `${objectDefinition.label} · ${state.objectRotation * 90}°`;
    } else if (state.tool === 'construction') {
      this.selection.textContent = state.isDrawingConstruction
        ? 'Drawing curved wall'
        : state.isMovingConstructionAnchor
          ? 'Moving curve anchor'
          : state.selectedConstruction
            ? `${state.selectedConstruction.label} · revision ${state.selectedConstruction.revision}`
            : state.constructionMode === 'draw'
              ? 'Drag to draw a curved wall'
              : 'Select a wall to edit';
    } else if (state.tool === 'settings') {
      const settings = this.godRaysEffect?.getSettings?.();
      this.selection.textContent = settings?.enabled
        ? `God rays · ${settings.technique === 'volumetric' ? 'volumetric shadow' : 'screen-space'}`
        : 'God rays disabled';
    } else {
      this.selection.textContent = state.selectedObject
        ? `${state.isMovingSelected ? 'Move' : 'Selected'} #${state.selectedObject.id}`
        : 'Select an object';
    }

    if (state.selectedConstruction) {
      const { selectedConstruction } = state;
      this.selectedConstruction.innerHTML = `
        <strong>🏰 ${escapeHtml(selectedConstruction.label)}</strong>
        <span>${escapeHtml(selectedConstruction.id)}</span>
        <span>${selectedConstruction.path.segments.length} curve segment${selectedConstruction.path.segments.length === 1 ? '' : 's'}</span>
        <span>${selectedConstruction.dimensions.height.toFixed(2)} m high · ${selectedConstruction.dimensions.thickness.toFixed(2)} m thick</span>
      `;
    } else {
      this.selectedConstruction.textContent = 'No live construction selected.';
    }

    if (!state.selectedObject) {
      this.selectedObject.textContent = 'Click a placed object.';
      return;
    }
    const selectedDefinition = this.objectByKey.get(state.selectedObject.definitionKey);
    this.selectedObject.innerHTML = `
      <strong>${escapeHtml(selectedDefinition.icon)} ${escapeHtml(selectedDefinition.label)}</strong>
      <span>ID ${state.selectedObject.id}</span>
      <span>Cell ${state.selectedObject.x}, ${state.selectedObject.z}</span>
      <span>Rotation ${state.selectedObject.rotation * 90}°</span>
      ${state.isMovingSelected ? '<span>Click a valid destination cell.</span>' : ''}
    `;
  }

  renderHover(hover) {
    if (!hover) {
      this.coordinates.textContent = 'Cell —';
      this.hoverHeight.textContent = 'Height —';
      this.hoverTile.textContent = 'Tile —';
      this.hoverObject.textContent = 'Object —';
      return;
    }
    this.coordinates.textContent = `Cell ${hover.x}, ${hover.z}`;
    this.hoverHeight.textContent = `Height ${hover.height.toFixed(2)}`;
    this.hoverTile.textContent = hover.tile?.label ?? 'Unknown';
    this.hoverObject.textContent = hover.objectDefinition?.label ?? 'Object —';
  }

  renderStreamingStatus(status) {
    if (!status || !this.streamingStatus) return;
    this.streamingStatus.textContent = `${status.resident}/${status.capacity} terrain chunks · ${status.loading} loading · origin ${Math.round(status.origin.x)},${Math.round(status.origin.z)}`;
    const focus = this.controller?.getFocusCell?.();
    if (focus) {
      const moved = Math.abs(focus.x - this.minimapCenter.x) > this.minimapCells * 0.2
        || Math.abs(focus.z - this.minimapCenter.z) > this.minimapCells * 0.2;
      if (moved) {
        this.minimapCenter = focus;
        this.queueMinimapUpdate();
      }
    }
  }

  async handleAction(action) {
    try {
      switch (action) {
        case 'undo': this.controller.undo(); break;
        case 'redo': this.controller.redo(); break;
        case 'rotate-placement': this.controller.rotatePlacement(); break;
        case 'move-selected': this.controller.startMoveSelected(); break;
        case 'rotate-selected': this.controller.rotateSelected(); break;
        case 'delete-selected': this.controller.deleteSelected(); break;
        case 'delete-construction': this.controller.deleteSelectedConstruction(); break;
        case 'save':
          await saveToBrowser(this.config.storage.key, this.controller.toDocument());
          this.showToast('World saved in this browser.');
          break;
        case 'load': {
          const worldDocument = await loadFromBrowser(this.config.storage.key);
          if (!worldDocument) {
            this.showToast('No browser save exists yet.');
            return;
          }
          this.controller.loadDocument(worldDocument);
          this.syncImportedBiomeTiles(worldDocument);
          this.showToast('Browser save loaded.');
          break;
        }
        case 'export':
          exportMap(this.controller.toDocument());
          this.showToast('Sparse world exported as JSON.');
          break;
        case 'import': this.fileInput.click(); break;
        case 'load-scene-settings': {
          if (!this.sceneSettingsRuntime) break;
          const selected = this.sceneSettingsPreset.value;
          if (!selected) {
            this.showToast('Choose a settings preset first.');
            break;
          }
          if (!this.confirmSceneReload('Loading a world look')) break;
          if (selected.startsWith('url:')) {
            this.sceneSettingsRuntime.activateUrl(selected.slice(4));
          } else if (selected.startsWith('browser:')) {
            const document = await loadFromBrowser(selected.slice(8));
            if (!document) throw new Error('The selected browser settings no longer exist.');
            this.sceneSettingsRuntime.activate(document);
          }
          break;
        }
        case 'save-scene-settings': {
          if (!this.sceneSettingsRuntime) break;
          const name = this.sceneSettingsName.value.trim();
          if (!name) throw new Error('Enter a settings name first.');
          const saved = await this.sceneSettingsRuntime.saveNamed(name);
          const value = `browser:${saved.key}`;
          const existing = [...this.sceneSettingsPreset.options].find(
            (option) => option.value === value,
          );
          if (existing) existing.textContent = `Browser · ${name}`;
          else this.sceneSettingsPreset.add(new Option(`Browser · ${name}`, value));
          this.sceneSettingsPreset.value = value;
          this.showToast(`Saved "${name}" with map and visual settings.`);
          break;
        }
        case 'export-scene-settings': {
          if (!this.sceneSettingsRuntime) break;
          const name = this.sceneSettingsName.value.trim() || 'world-look';
          // A file export is the one place worth inlining a locally imported
          // map, so the JSON stands alone on another machine.
          const document = this.sceneSettingsRuntime.capture(name, { includeMapDocument: true });
          exportJson(
            document,
            `simcity-dnd-settings-${name.toLowerCase().replace(/[^\w-]+/g, '-')}.json`,
          );
          this.showToast(
            document.map && !document.map.url && !document.map.document
              ? 'Scene settings exported. The map is recorded by label only —'
                + ' publish it to a URL to make the preset load it elsewhere.'
              : 'Complete scene settings exported.',
          );
          break;
        }
        case 'import-scene-settings':
          this.sceneSettingsFileInput.click();
          break;
        case 'load-scene-settings-url': {
          if (!this.sceneSettingsRuntime) break;
          const url = this.sceneSettingsUrl.value.trim();
          if (!url) throw new Error('Enter a settings URL first.');
          // Validate before the reload: activateUrl navigates away, so a bad
          // document would otherwise fail during boot with no panel to fix it in.
          normalizeSceneSettings(await loadJsonFromUrl(url));
          if (!this.confirmSceneReload('Loading a world look')) break;
          this.sceneSettingsRuntime.activateUrl(url);
          break;
        }
        case 'load-scene-map': {
          if (!this.sceneSettingsRuntime) break;
          const url = this.sceneMapPreset.value;
          if (!url) throw new Error('Choose a map first.');
          const entry = this.sceneMapLibrary.find((candidate) => candidate.url === url);
          await this.sceneSettingsRuntime.loadMapUrl(url, entry?.name);
          this.showToast(`${entry?.name ?? 'Map'} loaded.`);
          break;
        }
        case 'load-scene-map-url': {
          if (!this.sceneSettingsRuntime) break;
          const url = this.sceneMapUrl.value.trim();
          if (!url) throw new Error('Enter a map URL first.');
          await this.sceneSettingsRuntime.loadMapUrl(url);
          this.showToast('Map URL loaded.');
          break;
        }
        case 'add-scene-asset-url': {
          if (!this.sceneSettingsRuntime) break;
          const url = this.sceneAssetUrl.value.trim();
          if (!url) throw new Error('Enter a GLB URL first.');
          if (!this.confirmSceneReload('Adding a GLB')) break;
          await this.sceneSettingsRuntime.addUrlAsset({
            layer: this.sceneAssetLayer.value,
            url,
            label: this.sceneAssetLabel.value.trim() || 'Custom GLB',
            scale: Number(this.sceneAssetScale.value),
            tileIds: [this.selectedBiomeAssetTileId],
          });
          break;
        }
        case 'add-scene-asset-local':
          this.sceneAssetFileInput.click();
          break;
        case 'save-biome-config':
          if (!this.biomeAssetPalette) break;
          await saveToBrowser(
            this.biomeConfigStorageKey(),
            this.biomeAssetPalette.toDocument(),
          );
          this.showToast('Biome scenery configuration saved in this browser.');
          break;
        case 'load-biome-config': {
          if (!this.biomeAssetPalette) break;
          const document = await loadFromBrowser(this.biomeConfigStorageKey());
          if (!document) {
            this.showToast('No saved biome scenery configuration exists yet.');
            break;
          }
          this.biomeAssetPalette.replaceDocument(document);
          this.showToast('Biome scenery configuration loaded.');
          break;
        }
        case 'export-biome-config':
          if (!this.biomeAssetPalette) break;
          exportJson(
            this.biomeAssetPalette.toDocument(),
            `simcity-dnd-biome-assets-${Date.now()}.json`,
          );
          this.showToast('Biome scenery configuration exported.');
          break;
        case 'import-biome-config':
          this.biomeConfigFileInput.click();
          break;
        case 'reset-biome-config':
          if (this.biomeAssetPalette
              && window.confirm('Restore the automatic asset mix for every biome?')) {
            this.biomeAssetPalette.reset();
            this.showToast('Automatic biome asset mixes restored.');
          }
          break;
        case 'new':
          if (window.confirm('Clear all terrain overrides, voxel stamps, and placed objects?')) {
            this.controller.clearWorld();
            this.showToast('World edits cleared. Procedural terrain remains.');
          }
          break;
        case 'camera': this.controller.resetCamera(); break;
        default: break;
      }
    } catch (error) {
      this.showToast(error.message, true);
    }
  }

  queueMinimapUpdate() {
    if (this.minimapQueued) return;
    this.minimapQueued = true;
    requestAnimationFrame(() => {
      this.minimapQueued = false;
      this.updateMinimap();
    });
  }

  updateMinimap() {
    const context = this.minimap.getContext('2d', { alpha: false });
    const image = context.createImageData(MINIMAP_SIZE, MINIMAP_SIZE);
    const minimumX = this.minimapCenter.x - Math.floor(this.minimapCells / 2);
    const minimumZ = this.minimapCenter.z - Math.floor(this.minimapCells / 2);

    for (let pixelZ = 0; pixelZ < MINIMAP_SIZE; pixelZ += 1) {
      for (let pixelX = 0; pixelX < MINIMAP_SIZE; pixelX += 1) {
        const x = minimumX + Math.floor(pixelX * this.minimapCells / MINIMAP_SIZE);
        const z = minimumZ + Math.floor(pixelZ * this.minimapCells / MINIMAP_SIZE);
        const tile = this.tileMap.getTileDefinition(this.tileMap.get(x, z));
        const [red, green, blue] = hexToRgbBytes(tile.color);
        const height = this.heightField.getCellHeight(x, z) ?? 0;
        const shade = clamp(
          1 + height * MINIMAP_HEIGHT_SHADE,
          MINIMAP_MINIMUM_SHADE,
          MINIMAP_MAXIMUM_SHADE,
        );
        const offset = (pixelZ * MINIMAP_SIZE + pixelX) * 4;
        image.data[offset] = clamp(Math.round(red * shade), 0, 255);
        image.data[offset + 1] = clamp(Math.round(green * shade), 0, 255);
        image.data[offset + 2] = clamp(Math.round(blue * shade), 0, 255);
        image.data[offset + 3] = 255;
      }
    }

    context.putImageData(image, 0, 0);
    const scale = MINIMAP_SIZE / this.minimapCells;
    for (const object of this.objectMap.list()) {
      if (object.x < minimumX || object.z < minimumZ
          || object.x >= minimumX + this.minimapCells
          || object.z >= minimumZ + this.minimapCells) {
        continue;
      }
      const definition = this.objectByKey.get(object.definitionKey);
      context.fillStyle = definition.color;
      context.fillRect(
        Math.floor((object.x - minimumX) * scale) - 1,
        Math.floor((object.z - minimumZ) * scale) - 1,
        Math.max(2, Math.ceil(definition.footprint.width * scale)),
        Math.max(2, Math.ceil(definition.footprint.depth * scale)),
      );
    }
    context.strokeStyle = '#f0cf68';
    context.strokeRect(MINIMAP_SIZE / 2 - 2, MINIMAP_SIZE / 2 - 2, 4, 4);
  }

  showToast(message, isError = false) {
    window.clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.style.borderColor = isError ? '#a95a5a' : '';
    this.toast.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => {
      this.toast.classList.remove('is-visible');
    }, 2600);
  }
}
