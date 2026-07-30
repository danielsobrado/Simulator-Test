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
import { selectMinimapBurgs } from './map/minimapBurgs.js';
import { normalizeSceneSettings } from './settings/SceneSettings.js';
import { createPostProcessingSettingsPanel } from './settings/PostProcessingSettingsPanel.js';
import { assetFileName, formatBytes, trackStreamingSettle } from './ui/loadingSources.js';
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
// About a quarter degree — below this a re-styled transform is wasted work.
const MINIMAP_HEADING_EPSILON = 0.004;
const ALL_CATEGORIES = 'all';
const CATEGORY_LABELS = Object.freeze({
  all: 'All',
  building: 'Buildings',
  defense: 'Defense',
  civic: 'Civic',
  nature: 'Nature',
  workshop: 'Workshop',
});

function formatDistance(meters) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`
    : `${Math.round(meters)} m`;
}

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
    this.minimapHeading = 0;
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
              <h1>Drusniel World</h1>
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
              <h2>Grass tuning</h2>
              <span class="panel-count">live preview</span>
            </div>
            <p>
              Shared uniforms, so every chunk updates without a rebuild. Values baked
              into the clump mesh or the worker scatter — tilt, clump radius, blades
              per cell, the blade width range — are not here, because they cannot
              change without re-paging. Use <strong>Width scale</strong> to find a
              gauge, then fold it into <code>minWidth</code>/<code>maxWidth</code>.
            </p>

            <div class="settings-group" data-grass-section="shape">
              <h3>Shape</h3>
              ${this.grassRange('Min length', 'minLength', 0.02, 0.6, 0.005, 3)}
              ${this.grassRange('Max length', 'maxLength', 0.02, 1.2, 0.005, 3)}
              ${this.grassRange('Length skew', 'lengthSkew', 1, 10, 0.1, 2)}
              ${this.grassRange('Width scale', 'widthScale', 0.2, 3, 0.02, 2)}
              ${this.grassRange('Width spread', 'bladeWidthSpread', 0, 1, 0.01, 2)}
              ${this.grassRange('Width vs length', 'widthLengthCorrelation', 0, 1, 0.01, 2)}
            </div>

            <div class="settings-group" data-grass-section="lighting">
              <h3>Lighting</h3>
              ${this.grassRange('Brightness', 'brightness', 0.1, 2, 0.01, 2)}
              ${this.grassRange('Blade normal', 'bladeNormalStrength', 0, 1, 0.01, 2)}
              ${this.grassRange('Normal fade start', 'bladeNormalFadeStart', 1, 200, 1, 0)}
              ${this.grassRange('Normal fade end', 'bladeNormalFadeEnd', 2, 400, 1, 0)}
              ${this.grassRange('Root shade', 'rootShadeStrength', 0, 1, 0.01, 2)}
              ${this.grassRange('Root shade height', 'rootShadeHeight', 0.02, 1, 0.01, 2)}
              ${this.grassRange('Blade variation', 'bladeVariationStrength', 0, 1, 0.01, 2)}
              ${this.grassRange('Blade shade spread', 'bladeVariationShade', 0, 1, 0.01, 2)}
              ${this.grassRange('Patch strength', 'patchStrength', 0, 1, 0.01, 2)}
              ${this.grassRange('Backlight', 'translucencyStrength', 0, 4, 0.02, 2)}
              ${this.grassRange('Backlight focus', 'translucencyPower', 0.5, 16, 0.1, 1)}
              ${this.grassRange('Backlight tip bias', 'translucencyTipBias', 0, 1, 0.01, 2)}
            </div>

            <div class="settings-group" data-grass-section="colors">
              <h3>Colours</h3>
              ${this.grassColor('Base', 'colorBottom')}
              ${this.grassColor('Tip', 'colorTop')}
              ${this.grassColor('Variation cool', 'variationCool')}
              ${this.grassColor('Variation warm', 'variationWarm')}
              ${this.grassColor('Patch lush', 'patchLush')}
              ${this.grassColor('Patch dry', 'patchDry')}
              ${this.grassColor('Backlight', 'translucencyColor')}
            </div>

            <div class="settings-group" data-grass-section="wind">
              <h3>Wind</h3>
              ${this.grassRange('Strength', 'windStrength', 0, 0.6, 0.005, 3)}
              ${this.grassRange('Speed', 'windSpeed', 0, 5, 0.05, 2)}
              ${this.grassRange('Frequency', 'windFrequency', 0.02, 2, 0.01, 2)}
              ${this.grassRange('Turbulence', 'windTurbulence', 0, 0.5, 0.005, 3)}
              ${this.grassRange('Lean', 'windLean', 0, 0.5, 0.005, 3)}
              ${this.grassRange('Stiffness spread', 'windStiffnessRange', 0, 1, 0.01, 2)}
              ${this.grassRange('Tip flutter', 'flutterStrength', 0, 0.2, 0.001, 3)}
              ${this.grassRange('Flutter height', 'flutterHeightStart', 0, 1, 0.01, 2)}
              ${this.grassRange('Flutter fade start', 'flutterFadeStart', 1, 150, 1, 0)}
              ${this.grassRange('Flutter fade end', 'flutterFadeEnd', 2, 300, 1, 0)}
            </div>

            <div class="action-grid">
              <button class="action-button" type="button" data-action="copy-grass-tuning">Copy YAML</button>
              <button class="action-button" type="button" data-action="reset-grass-tuning">Reset</button>
            </div>

            <div class="panel-head">
              <h2>Post-processing</h2>
              <span class="panel-count">Phase 1 settings</span>
            </div>
            <div data-role="post-processing-settings"></div>

            <div class="panel-head">
              <h2>God rays</h2>
              <span class="panel-count">live preview</span>
            </div>
            <label class="settings-select">
              <span>Technique</span>
              <select data-god-rays-setting="technique">
                <option value="off">Off</option>
                <option value="volumetric">Volumetric</option>
                <option value="screen-space">Screen-space</option>
              </select>
            </label>

            <div class="settings-group" data-god-rays-section="screen-space">
              <h3>Screen-space shafts</h3>
              <p>Depth-driven HDR shafts composited before reflections and temporal anti-aliasing.</p>
              ${this.rangeControl('Intensity', 'shaftIntensity', 0, 2, 0.01, 2)}
              <label class="settings-select">
                <span>Quality</span>
                <select data-god-rays-setting="shaftQuality">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
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

          <section class="panel panel--minimap">
            <h2>Local overview</h2>
            <div class="minimap-frame">
              <canvas data-role="minimap" width="${MINIMAP_SIZE}" height="${MINIMAP_SIZE}"></canvas>
              <div class="minimap-burgs" data-role="minimap-burgs" aria-hidden="true"></div>
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
    this.minimapFrame = root.querySelector('.minimap-frame');
    this.minimapBurgs = root.querySelector('[data-role="minimap-burgs"]');
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
    this.postProcessingPanelRoot = root.querySelector('[data-role="post-processing-settings"]');
    this.postProcessingPanel = null;
    this.godRaysControls = [
      ...root.querySelectorAll('[data-god-rays-setting]'),
    ];
    this.godRaysSections = [
      ...root.querySelectorAll('[data-god-rays-section]'),
    ];
    this.godRaysEffect = null;
    this.godRaysTechnique = 'off';
    this.postProcessingStore = null;
    this.unsubscribeGodRaysPostProcessing = null;
    this.grassControls = [...root.querySelectorAll('[data-grass-setting]')];
    this.grassTuning = null;

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

  grassRange(label, setting, minimum, maximum, step, precision) {
    return `
      <label class="settings-range">
        <span>${label}</span>
        <output data-grass-output="${setting}">—</output>
        <input
          type="range"
          min="${minimum}"
          max="${maximum}"
          step="${step}"
          data-grass-setting="${setting}"
          data-precision="${precision}"
        />
      </label>
    `;
  }

  grassColor(label, setting) {
    return `
      <label class="settings-select">
        <span>${label}</span>
        <input type="color" data-grass-setting="${setting}" data-grass-color="1" />
      </label>
    `;
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
    const settings = effect?.getSettings?.();
    this.godRaysTechnique = settings?.enabled ? settings.technique : 'off';
    this.applyGodRaysTechnique(this.godRaysTechnique, { markCustom: false });
    this.renderGodRaysSettings();
  }

  attachPostProcessing(store) {
    this.postProcessingPanel?.dispose();
    this.unsubscribeGodRaysPostProcessing?.();
    this.postProcessingStore = store;
    this.postProcessingPanel = createPostProcessingSettingsPanel({
      root: this.postProcessingPanelRoot,
      store,
      defaults: this.config.stylizedSurface.postProcessing,
    });
    this.unsubscribeGodRaysPostProcessing = store.subscribe((settings) => {
      const shaftsEnabled = settings.screenSpaceShafts.enabled === true;
      if (shaftsEnabled !== (this.godRaysTechnique === 'screen-space')) {
        const effect = this.godRaysEffect?.getSettings?.();
        this.godRaysTechnique = shaftsEnabled
          ? 'screen-space'
          : effect?.enabled && effect.technique === 'volumetric'
            ? 'volumetric'
            : 'off';
      }
      this.syncGodRaysRuntimeForPostSettings(settings);
      this.renderGodRaysSettings();
    });
  }

  syncGodRaysSettings(settings) {
    if (!settings) return;
    const shaftsEnabled = this.postProcessingStore?.get()?.screenSpaceShafts?.enabled === true;
    this.godRaysTechnique = settings.enabled && settings.technique === 'volumetric'
      ? 'volumetric'
      : shaftsEnabled || (settings.enabled && settings.technique === 'screen-space')
        ? 'screen-space'
        : 'off';
    this.applyGodRaysTechnique(this.godRaysTechnique, { markCustom: false });
    this.renderGodRaysSettings();
  }

  resolveShaftQuality(settings = this.postProcessingStore?.get()?.screenSpaceShafts) {
    if (!settings) return 'medium';
    if (settings.samples >= 36 || settings.resolutionScale >= 0.7) return 'high';
    if (settings.samples <= 16 && settings.resolutionScale <= 0.4) return 'low';
    return 'medium';
  }

  unifiedGodRaysSettings() {
    const effect = this.godRaysEffect?.getSettings?.() ?? {};
    const shafts = this.postProcessingStore?.get()?.screenSpaceShafts ?? {};
    return {
      ...effect,
      technique: this.godRaysTechnique,
      shaftIntensity: shafts.intensity,
      shaftQuality: this.resolveShaftQuality(shafts),
    };
  }

  renderGodRaysSettings() {
    const settings = this.unifiedGodRaysSettings();
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

  syncGodRaysRuntimeForPostSettings(settings = this.postProcessingStore?.get()) {
    if (!this.godRaysEffect || !settings) return;
    if (this.godRaysTechnique === 'screen-space') {
      this.godRaysEffect.setSettings({
        technique: 'screen-space',
        enabled: settings.enabled !== true,
      });
    } else if (this.godRaysTechnique === 'volumetric') {
      this.godRaysEffect.setSettings({ technique: 'volumetric', enabled: true });
    } else {
      this.godRaysEffect.setSettings({ enabled: false });
    }
  }

  applyGodRaysTechnique(technique, { markCustom = true } = {}) {
    if (!['off', 'volumetric', 'screen-space'].includes(technique)) return;
    this.godRaysTechnique = technique;
    this.syncGodRaysRuntimeForPostSettings();
    const shaftsEnabled = technique === 'screen-space';
    const currentShaftsEnabled = this.postProcessingStore
      ?.get()
      ?.screenSpaceShafts
      ?.enabled;
    if (
      this.postProcessingStore
      && currentShaftsEnabled !== shaftsEnabled
    ) {
      this.postProcessingStore.set(
        { screenSpaceShafts: { enabled: shaftsEnabled } },
        { markCustom },
      );
    }
  }

  setShaftQuality(quality) {
    const levels = {
      low: { resolutionScale: 0.35, samples: 12 },
      medium: { resolutionScale: 0.5, samples: 24 },
      high: { resolutionScale: 0.75, samples: 40 },
    };
    if (!levels[quality]) return;
    this.postProcessingStore?.set({ screenSpaceShafts: levels[quality] });
  }

  attachLoading(tracker) {
    this.loading = tracker;
  }

  /**
   * Lets map loads wait on chunk streaming after the import returns.
   *
   * `loadMapUrl` resolving does not mean the world is ready — it means the document
   * is applied and residency has been re-centred. The chunks themselves arrive over
   * the following seconds, which is the window that previously looked like the
   * overlay being stuck on nothing.
   */
  attachStreamingProbe(probe) {
    this.streamingProbe = probe;
  }

  async settleStreaming(session, stepId) {
    if (!this.streamingProbe || !session) return;
    session.start(stepId);
    await trackStreamingSettle({ session, ...this.streamingProbe });
  }

  /**
   * Runs work behind the loading overlay, handing the session to the callback so
   * it can advance its own steps.
   *
   * On failure the session is left on screen for a moment rather than closed
   * immediately: the toast that follows is transient, and the panel is the only
   * place that names *which* step died.
   */
  async withLoading({ title, steps, detail = '' }, run) {
    if (!this.loading) return run(null);
    const session = this.loading.begin({ title, steps, detail });
    try {
      const result = await run(session);
      session.finish();
      return result;
    } catch (error) {
      session.fail(error);
      setTimeout(() => session.finish(), 2600);
      throw error;
    }
  }

  /**
   * Opens a terminal notice for the flows that end by navigating away.
   *
   * These sessions are never finished on purpose: the page is about to reload, and
   * closing the panel first would leave the window blank and unexplained for the
   * whole navigation. Whatever replaces it is a fresh boot with its own overlay.
   */
  showSceneReload(label, detail = '') {
    this.loading?.begin({
      title: label,
      steps: [{ id: 'reload', label: 'Reloading the scene' }],
      detail,
    }).start('reload');
  }

  /**
   * A map load whose stages are not individually observable — `loadMapUrl`
   * fetches, imports and rebuilds inside one call.
   *
   * Rather than fake granularity, the download is given a real head start and the
   * rest is reported as one step with the file named. A bar that lies about which
   * stage it is in is worse than a coarse one that does not. Flows whose stages we
   * *do* control call `withLoading` directly and advance the steps for real.
   */
  async withMapLoading(label, url, run) {
    return this.withLoading(
      {
        title: `Loading ${label}`,
        steps: [
          { id: 'fetch', label: 'Downloading map' },
          { id: 'import', label: 'Importing world and rebuilding terrain' },
          { id: 'stream', label: 'Streaming chunks into view' },
        ],
        detail: assetFileName(url),
      },
      async (session) => {
        if (!session) return run();
        session.start('fetch');
        const toImport = setTimeout(() => session.start('import'), 400);
        let result;
        try {
          result = await run();
        } finally {
          clearTimeout(toImport);
        }
        await this.settleStreaming(session, 'stream');
        return result;
      },
    );
  }

  attachGrassTuning(tuning) {
    this.grassTuning = tuning;
    this.syncGrassTuning(tuning?.getSettings?.());
  }

  syncGrassTuning(settings) {
    if (!settings) return;
    for (const control of this.grassControls) {
      const value = settings[control.dataset.grassSetting];
      if (value === undefined) continue;
      control.value = String(value);
      this.updateGrassOutput(control);
    }
  }

  updateGrassOutput(control) {
    const output = this.root.querySelector(
      `[data-grass-output="${control.dataset.grassSetting}"]`,
    );
    if (!output) return;
    output.value = Number(control.value).toFixed(Number(control.dataset.precision ?? 2));
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
      const control = event.target.closest('[data-grass-setting]');
      if (control && this.grassTuning) {
        this.grassTuning.setSettings({
          [control.dataset.grassSetting]: control.dataset.grassColor
            ? control.value
            : Number(control.value),
        });
        if (!control.dataset.grassColor) this.updateGrassOutput(control);
      }
    });
    this.godRaysPanel.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action="copy-grass-tuning"], [data-action="reset-grass-tuning"]');
      if (!button || !this.grassTuning) return;
      if (button.dataset.action === 'reset-grass-tuning') {
        this.syncGrassTuning(this.grassTuning.reset());
        this.showToast('Grass tuning reset to the config values.');
        return;
      }
      // Tuning lives in uniforms, so it is gone on reload. The YAML fragment is how
      // a session at the sliders becomes a config change rather than a lost hour.
      navigator.clipboard?.writeText(this.grassTuning.toYaml()).then(
        () => this.showToast('Grass tuning YAML copied.'),
        () => this.showToast('Could not reach the clipboard.', true),
      );
    });
    // Separate listener rather than a branch: the god-rays selector simply does not
    // match a grass control, so each ignores the other's events.
    this.godRaysPanel.addEventListener('input', (event) => {
      const control = event.target.closest('[data-god-rays-setting]');
      if (!control || !this.godRaysEffect) return;
      const key = control.dataset.godRaysSetting;
      const value = control.tagName === 'SELECT'
        ? control.value
        : Number(control.value);
      if (key === 'technique') {
        this.applyGodRaysTechnique(value);
      } else if (key === 'shaftIntensity') {
        this.postProcessingStore?.set({
          screenSpaceShafts: { intensity: value },
        }, { coalesce: true });
      } else if (key === 'shaftQuality') {
        this.setShaftQuality(value);
      } else {
        this.godRaysEffect.setSettings({ [key]: value });
      }
      this.updateGodRaysOutput(control);
      this.renderGodRaysSettings();
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
        // Unlike a URL load this path owns each stage, so the steps are reported as
        // they actually happen. Reading and parsing a multi-megabyte Azgaar export
        // is a real wait of its own before the import even starts.
        await this.withLoading(
          {
            title: 'Importing world',
            steps: [
              { id: 'read', label: 'Reading and parsing the file' },
              { id: 'import', label: 'Importing world and rebuilding terrain' },
              { id: 'apply', label: 'Updating tiles and minimap' },
              { id: 'stream', label: 'Streaming chunks into view' },
            ],
            detail: `${file.name} · ${formatBytes(file.size)}`,
          },
          async (session) => {
            session?.start('read');
            const parsed = this.sceneSettingsRuntime ? await importJson(file) : null;
            session?.start('import');
            const document = this.sceneSettingsRuntime
              ? await this.sceneSettingsRuntime.loadEmbeddedMap(parsed, file.name)
              : await importMap(file, {
                config: this.config,
                resolveAzgaarOptions: (summary) => this.resolveAzgaarImportOptions(summary),
              });
            session?.start('apply');
            if (!this.sceneSettingsRuntime) {
              controller.loadDocument(document, {
                preserveInventory: true,
                loadReason: 'WORLD_IMPORTED',
              });
              this.syncImportedBiomeTiles(document);
              this.minimapCenter = controller.getFocusCell?.() ?? this.minimapCenter;
              this.updateMinimap();
            }
            await this.settleStreaming(session, 'stream');
          },
        );
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
        this.showSceneReload('Loading world look', file.name);
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
        // This one ends in a page reload, so the overlay is the last thing on
        // screen. Without it a large GLB looks like the button did nothing.
        await this.withLoading(
          {
            title: 'Adding GLB asset',
            steps: [
              { id: 'store', label: 'Storing the GLB for this browser' },
              { id: 'reload', label: 'Reloading the scene' },
            ],
            detail: `${file.name} · ${formatBytes(file.size)}`,
          },
          async (session) => {
            session?.start('store');
            await this.sceneSettingsRuntime.addLocalAsset({
              layer: this.sceneAssetLayer.value,
              file,
              label: this.sceneAssetLabel.value.trim() || file.name.replace(/\.glb$/i, ''),
              scale: Number(this.sceneAssetScale.value),
              tileIds: [this.selectedBiomeAssetTileId],
            });
            session?.start('reload');
          },
        );
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
      this.selection.textContent = this.godRaysTechnique !== 'off'
        ? `God rays · ${this.godRaysTechnique === 'volumetric' ? 'volumetric shadow' : 'screen-space'}`
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
          const worldDocument = await this.withLoading(
            {
              title: 'Loading browser save',
              steps: [
                { id: 'read', label: 'Reading the browser save' },
                { id: 'apply', label: 'Rebuilding terrain' },
              ],
            },
            async (session) => {
              session?.start('read');
              const saved = await loadFromBrowser(this.config.storage.key);
              if (!saved) return null;
              session?.start('apply');
              this.controller.loadDocument(saved, { loadReason: 'SAVE_RESTORED' });
              this.syncImportedBiomeTiles(saved);
              return saved;
            },
          );
          if (!worldDocument) {
            this.showToast('No browser save exists yet.');
            return;
          }
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
            this.showSceneReload('Loading world look', assetFileName(selected.slice(4)));
            this.sceneSettingsRuntime.activateUrl(selected.slice(4));
          } else if (selected.startsWith('browser:')) {
            const document = await loadFromBrowser(selected.slice(8));
            if (!document) throw new Error('The selected browser settings no longer exist.');
            this.showSceneReload('Loading world look', document.name ?? '');
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
          this.showSceneReload('Loading world look', assetFileName(url));
          this.sceneSettingsRuntime.activateUrl(url);
          break;
        }
        case 'load-scene-map': {
          if (!this.sceneSettingsRuntime) break;
          const url = this.sceneMapPreset.value;
          if (!url) throw new Error('Choose a map first.');
          const entry = this.sceneMapLibrary.find((candidate) => candidate.url === url);
          await this.withMapLoading(
            entry?.name ?? 'map',
            url,
            () => this.sceneSettingsRuntime.loadMapUrl(url, entry?.name),
          );
          this.showToast(`${entry?.name ?? 'Map'} loaded.`);
          break;
        }
        case 'load-scene-map-url': {
          if (!this.sceneSettingsRuntime) break;
          const url = this.sceneMapUrl.value.trim();
          if (!url) throw new Error('Enter a map URL first.');
          await this.withMapLoading(
            'map URL',
            url,
            () => this.sceneSettingsRuntime.loadMapUrl(url),
          );
          this.showToast('Map URL loaded.');
          break;
        }
        case 'add-scene-asset-url': {
          if (!this.sceneSettingsRuntime) break;
          const url = this.sceneAssetUrl.value.trim();
          if (!url) throw new Error('Enter a GLB URL first.');
          if (!this.confirmSceneReload('Adding a GLB')) break;
          this.showSceneReload('Adding GLB asset', assetFileName(url));
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

  /**
   * Points the minimap at the camera's heading. The canvas is always drawn
   * north-up; turning it is a CSS rotation of that same bitmap, so this can run
   * every frame. A square covers its own inscribed circle at any angle, so the
   * round player-mode frame never shows a gap.
   *
   * Three's `YXZ` camera yaw sends the view direction to `(-sin yaw, -cos yaw)`
   * in world XZ, which is `yaw` counter-clockwise from canvas up — so rotating
   * the bitmap clockwise by the same yaw puts the player's front at the top.
   */
  setMinimapHeading(heading) {
    if (!Number.isFinite(heading)) return;
    if (Math.abs(heading - this.minimapHeading) < MINIMAP_HEADING_EPSILON) return;
    this.minimapHeading = heading;
    // Set on the frame, not the canvas: the burg markers ride the same rotation
    // and counter-rotate their labels from this one inherited value.
    this.minimapFrame.style.setProperty('--minimap-heading', `${heading}rad`);
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
    this.renderMinimapBurgs();
  }

  /**
   * Names the Azgaar settlements around the view. Markers are DOM, not canvas
   * pixels, so the labels can counter-rotate and stay upright while the map
   * turns; worlds without an Azgaar campaign simply get none.
   */
  renderMinimapBurgs() {
    if (!this.minimapBurgs) return;
    const markers = selectMinimapBurgs({
      campaign: this.controller?.campaign ?? null,
      center: this.minimapCenter,
      cells: this.minimapCells,
    });
    const tileSize = this.tileMap?.tileSize ?? 1;
    this.minimapBurgs.replaceChildren(...markers.map((marker) => {
      const element = document.createElement('span');
      element.className = 'minimap-burg';
      element.classList.toggle('is-capital', marker.capital);
      element.classList.toggle('is-offscreen', marker.offscreen);
      element.style.left = `${marker.u * 100}%`;
      element.style.top = `${marker.v * 100}%`;

      const dot = document.createElement('span');
      dot.className = 'minimap-burg__dot';
      dot.style.background = marker.color;

      const name = document.createElement('span');
      name.className = 'minimap-burg__name';
      // Burg names come from the imported map, so they are set as text.
      name.textContent = marker.offscreen
        ? `${marker.name} · ${formatDistance(marker.distanceCells * tileSize)}`
        : marker.name;

      element.append(dot, name);
      return element;
    }));
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
