import { MINIMAP_SIZE } from './constants.js';
import { exportMap, importMap, loadFromBrowser, saveToBrowser } from './storage.js';
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
              <button class="tool-button" type="button" data-tool="select">
                <span class="tool-button__icon" aria-hidden="true">🎯</span>Select
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

          <section class="panel tool-panel" data-panel="select" hidden>
            <h2>Selected object</h2>
            <div class="selection-card" data-role="selected-object">Click a placed object.</div>
            <div class="action-grid">
              <button class="action-button" type="button" data-action="move-selected">Move</button>
              <button class="action-button" type="button" data-action="rotate-selected">Rotate</button>
              <button class="action-button action-button--danger" type="button" data-action="delete-selected">Delete</button>
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
    this.streamingStatus = root.querySelector('[data-role="streaming-status"]');
    this.selectedObject = root.querySelector('[data-role="selected-object"]');
    this.placementInfo = root.querySelector('[data-role="placement-info"]');
    this.fileInput = root.querySelector('[data-role="file-input"]');

    this.renderTileButtons();
    this.renderCategoryChips();
    this.renderObjectButtons();
    this.renderBrushButtons();
  }

  attachWorkshop(workshop) {
    this.workshop = workshop;
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
        const document = await importMap(file, {
          config: this.config,
          resolveAzgaarOptions: (summary) => this.resolveAzgaarImportOptions(summary),
        });
        controller.loadDocument(document);
        this.syncImportedBiomeTiles(document);
        this.minimapCenter = controller.getFocusCell?.() ?? this.minimapCenter;
        this.updateMinimap();
        this.showToast('World imported.');
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

    this.objectCount.textContent = `${state.objectCount} object${state.objectCount === 1 ? '' : 's'}`;
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
    } else {
      this.selection.textContent = state.selectedObject
        ? `${state.isMovingSelected ? 'Move' : 'Selected'} #${state.selectedObject.id}`
        : 'Select an object';
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
