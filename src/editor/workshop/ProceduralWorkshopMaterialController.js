import * as THREE from 'three/webgpu';
import {
  BUILTIN_WORKSHOP_MATERIAL_PRESETS,
  createWorkshopMaterialSourceId,
  getWorkshopMaterialPreset,
  normalizeWorkshopMaterialDocument,
  serializeWorkshopMaterialDocument,
} from './ProceduralWorkshopMaterialConfig.js';
import { prepareWorkshopAlbedo } from './ProceduralWorkshopTextureUpload.js';

const POINTER_SELECT_DISTANCE = 6;

function cloneDocument(document) {
  return serializeWorkshopMaterialDocument(document);
}

function hashDescriptor(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function applyPreset(material, preset) {
  const result = material.clone();
  result.color.set(preset.baseColor).multiply(new THREE.Color(preset.tint));
  result.roughness = preset.roughness;
  result.metalness = preset.metalness;
  if (result.normalScale?.setScalar) result.normalScale.setScalar(preset.normalStrength);
  if ('bumpScale' in result) result.bumpScale = preset.heightStrength;
  result.userData = { ...material.userData, workshopMaterialPreview: true };
  return result;
}

export class ProceduralWorkshopMaterialController {
  constructor({
    root,
    canvasHost,
    previewRoot,
    renderer,
    camera,
    componentController,
    onChange,
    onStatus,
    onActiveChange,
  }) {
    this.root = root;
    this.canvasHost = canvasHost;
    this.previewRoot = previewRoot;
    this.renderer = renderer;
    this.camera = camera;
    this.componentController = componentController;
    this.onChange = onChange;
    this.onStatus = onStatus;
    this.onActiveChange = onActiveChange;
    this.document = normalizeWorkshopMaterialDocument();
    this.regions = new Map();
    this.meshes = [];
    this.active = false;
    this.pointerStart = null;
    this.hoverRegionId = null;
    this.selectedRegionId = null;
    this.history = [];
    this.future = [];
    this.clipboard = null;
    this.previewMaterials = new Map();
    this.previewOriginals = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.highlight = new THREE.Box3Helper(new THREE.Box3(), '#8ff2c8');
    this.highlight.visible = false;
    (previewRoot.parent ?? previewRoot).add(this.highlight);

    root.innerHTML = `
      <div class="workshop-material-palette" data-role="material-palette" hidden
        role="menu" aria-label="Material favorites"></div>
      <aside class="workshop-material-inspector" data-role="material-inspector" hidden>
        <header>
          <div><small>Selected material area</small><strong data-role="material-region-name"></strong></div>
          <button type="button" data-material-action="close-inspector" aria-label="Close material inspector">×</button>
        </header>
        <label>Preset
          <select data-material-field="presetId"></select>
        </label>
        <div class="workshop-material-grid">
          <label>Base color<input type="color" data-material-field="baseColor" /></label>
          <label>Tint<input type="color" data-material-field="tint" /></label>
          <label>Mapping<select data-material-field="mapping"><option value="projected">Projected</option><option value="local">Local</option></select></label>
          <label>Repeat<input type="number" min="0.1" max="16" step="0.1" data-material-field="repeat" /></label>
          <label>Rotation<select data-material-field="rotation"><option>0</option><option>90</option><option>180</option><option>270</option></select></label>
          <label>Roughness<input type="number" min="0" max="1" step="0.05" data-material-field="roughness" /></label>
          <label>Metalness<input type="number" min="0" max="1" step="0.05" data-material-field="metalness" /></label>
          <label>Normal<input type="number" min="0" max="4" step="0.1" data-material-field="normalStrength" /></label>
          <label>Height<input type="number" min="0" max="2" step="0.05" data-material-field="heightStrength" /></label>
          <label>Weathering<input type="number" min="0" max="1" step="0.05" data-material-field="weathering" /></label>
        </div>
        <div class="workshop-material-sources" data-role="material-sources">
          ${['albedo', 'normal', 'orm', 'height'].map((kind) => `
            <button type="button" data-material-action="load-map" data-source-kind="${kind}">
              ${kind === 'orm' ? 'ORM' : `${kind[0].toUpperCase()}${kind.slice(1)}`}
              <b>${kind === 'albedo' ? 'sRGB' : 'linear'}</b>
              <small data-source-name="${kind}">Built-in</small>
            </button>
            <input type="file" accept="image/png,image/jpeg,image/webp"
              data-material-source-file="${kind}" hidden />
          `).join('')}
        </div>
        <div class="workshop-material-actions">
          <button type="button" data-material-action="reset">Reset</button>
          <button type="button" data-material-action="copy">Copy</button>
          <button type="button" data-material-action="paste">Paste</button>
          <button type="button" data-material-action="apply-matching">Apply matching</button>
          <button type="button" data-material-action="favorite">Favorite</button>
          <button type="button" data-material-action="undo">Undo</button>
          <button type="button" data-material-action="redo">Redo</button>
        </div>
        <p data-role="material-budget"></p>
      </aside>
      <div class="workshop-material-region-label" data-role="material-region-label" hidden></div>
    `;
    this.palette = root.querySelector('[data-role="material-palette"]');
    this.inspector = root.querySelector('[data-role="material-inspector"]');
    this.regionLabel = root.querySelector('[data-role="material-region-label"]');
    this.regionName = root.querySelector('[data-role="material-region-name"]');
    this.presetSelect = root.querySelector('[data-material-field="presetId"]');
    this.budget = root.querySelector('[data-role="material-budget"]');

    this.onPointerDown = (event) => this.pointerDown(event);
    this.onPointerMove = (event) => this.pointerMove(event);
    this.onPointerUp = (event) => this.pointerUp(event);
    this.onRootClick = (event) => this.rootClick(event);
    this.onRootChange = (event) => this.rootChange(event);
    this.onRootPointerOver = (event) => this.palettePointerOver(event);
    this.onRootPointerOut = (event) => this.palettePointerOut(event);
    this.onKeyDown = (event) => this.keyDown(event);
    this.onSourceFileChange = (event) => this.sourceFileChange(event);
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    root.addEventListener('click', this.onRootClick);
    root.addEventListener('change', this.onRootChange);
    root.addEventListener('pointerover', this.onRootPointerOver);
    root.addEventListener('pointerout', this.onRootPointerOut);
    root.addEventListener('change', this.onSourceFileChange);
    window.addEventListener('keydown', this.onKeyDown);
  }

  toDocument() {
    return cloneDocument(this.document);
  }

  setDocument(input) {
    this.document = normalizeWorkshopMaterialDocument(input);
    this.history = [];
    this.future = [];
    this.refreshInspector();
  }

  replaceParts(parts) {
    this.closePalette();
    this.meshes = this.componentController.meshes.filter(
      (mesh) => mesh.userData.workshopMaterialRegion,
    );
    this.regions = new Map((parts.materialRegions ?? []).map((region) => [region.id, region]));
    if (this.selectedRegionId && !this.regions.has(this.selectedRegionId)) {
      this.selectedRegionId = null;
      this.inspector.hidden = true;
    }
    this.refreshBudget(parts.stats);
    this.updateHighlight(this.hoverRegionId ?? this.selectedRegionId);
  }

  setActive(active) {
    this.active = active === true;
    this.componentController.setExternalInteractionActive(this.active);
    this.canvasHost.classList.toggle('is-material-mode', this.active);
    if (!this.active) {
      this.closePalette();
      this.hoverRegionId = null;
      this.updateHighlight(this.selectedRegionId);
      this.regionLabel.hidden = true;
    }
    this.onActiveChange?.(this.active);
    return this.active;
  }

  toggle() {
    return this.setActive(!this.active);
  }

  setPointerRay(event) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return true;
  }

  hitRegion(event) {
    if (!this.setPointerRay(event)) return null;
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    return hit?.object?.userData?.workshopMaterialRegion ?? null;
  }

  pointerDown(event) {
    if (!this.active || event.button !== 0) return;
    this.pointerStart = { x: event.clientX, y: event.clientY };
  }

  pointerMove(event) {
    if (!this.active || !this.palette.hidden) return;
    const region = this.hitRegion(event);
    this.hoverRegionId = region?.id ?? null;
    this.updateHighlight(this.hoverRegionId ?? this.selectedRegionId);
    if (!region) {
      this.regionLabel.hidden = true;
      return;
    }
    const inherited = !Object.hasOwn(this.document.materialAreaOverrides, region.id);
    this.regionLabel.textContent = `${region.label} · ${inherited ? 'inherited' : 'overridden'}`;
    const bounds = this.canvasHost.getBoundingClientRect();
    this.regionLabel.style.left = `${event.clientX - bounds.left + 14}px`;
    this.regionLabel.style.top = `${event.clientY - bounds.top + 14}px`;
    this.regionLabel.hidden = false;
  }

  pointerUp(event) {
    if (!this.active || event.button !== 0) return;
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y)
      > POINTER_SELECT_DISTANCE) return;
    const region = this.hitRegion(event);
    if (!region) return;
    this.selectedRegionId = region.id;
    this.openPalette(event.clientX, event.clientY);
  }

  regionMeshes(regionId) {
    return this.meshes.filter((mesh) => (
      mesh.userData.workshopMaterialRegion?.id === regionId
    ));
  }

  updateHighlight(regionId) {
    const meshes = regionId ? this.regionMeshes(regionId) : [];
    if (meshes.length === 0) {
      this.highlight.visible = false;
      return;
    }
    const bounds = new THREE.Box3();
    bounds.makeEmpty();
    meshes.forEach((mesh) => bounds.expandByObject(mesh));
    this.highlight.box.copy(bounds);
    this.highlight.visible = true;
  }

  favoritePresets() {
    return this.document.materialFavorites
      .map((presetId) => getWorkshopMaterialPreset(this.document, presetId))
      .filter(Boolean);
  }

  openPalette(clientX, clientY) {
    this.clearMaterialPreview();
    const presets = this.favoritePresets();
    const buttons = presets.map((preset, index) => {
      const angle = -90 + index * (360 / Math.max(1, presets.length));
      return `<button type="button" role="menuitem" data-preset-id="${preset.id}"
        style="--material-angle:${angle}deg;--material-color:${preset.baseColor}"
        aria-label="${preset.label}" title="${preset.label}"><span></span></button>`;
    }).join('');
    this.palette.innerHTML = `
      ${buttons}
      <button type="button" class="workshop-material-reset" data-material-action="reset"
        aria-label="Reset to inherited material" title="Reset to inherited">↺</button>
      <button type="button" class="workshop-material-more" data-material-action="more">More…</button>
    `;
    this.palette.hidden = false;
    const hostBounds = this.canvasHost.getBoundingClientRect();
    const radius = 116;
    const x = Math.min(hostBounds.width - radius, Math.max(radius, clientX - hostBounds.left));
    const y = Math.min(hostBounds.height - radius, Math.max(radius, clientY - hostBounds.top));
    this.palette.style.left = `${x}px`;
    this.palette.style.top = `${y}px`;
    this.palette.querySelector('button')?.focus();
    this.refreshInspector();
  }

  closePalette() {
    this.clearMaterialPreview();
    this.palette.hidden = true;
  }

  previewPreset(presetId) {
    this.clearMaterialPreview();
    const preset = getWorkshopMaterialPreset(this.document, presetId);
    if (!preset || !this.selectedRegionId) return;
    for (const mesh of this.regionMeshes(this.selectedRegionId)) {
      this.previewOriginals.set(mesh, mesh.material);
      const key = `${mesh.material.uuid}|${preset.id}`;
      if (!this.previewMaterials.has(key)) {
        this.previewMaterials.set(key, applyPreset(mesh.material, preset));
      }
      mesh.material = this.previewMaterials.get(key);
    }
  }

  clearMaterialPreview() {
    for (const [mesh, material] of this.previewOriginals) mesh.material = material;
    this.previewOriginals.clear();
    for (const material of this.previewMaterials.values()) material.dispose();
    this.previewMaterials.clear();
  }

  commit(nextInput, message) {
    const before = cloneDocument(this.document);
    const next = normalizeWorkshopMaterialDocument(nextInput);
    if (JSON.stringify(before) === JSON.stringify(cloneDocument(next))) return false;
    this.history.push(before);
    if (this.history.length > 80) this.history.shift();
    this.future = [];
    this.document = next;
    this.closePalette();
    this.refreshInspector();
    this.onChange?.(cloneDocument(this.document));
    this.onStatus?.(message, false);
    return true;
  }

  commitPreset(presetId) {
    if (!this.selectedRegionId) return;
    this.commit({
      ...cloneDocument(this.document),
      materialAreaOverrides: {
        ...this.document.materialAreaOverrides,
        [this.selectedRegionId]: presetId,
      },
    }, `${this.regions.get(this.selectedRegionId)?.label ?? 'Area'} material stored.`);
  }

  resetSelected() {
    if (!this.selectedRegionId) return;
    const overrides = { ...this.document.materialAreaOverrides };
    delete overrides[this.selectedRegionId];
    this.commit({
      ...cloneDocument(this.document),
      materialAreaOverrides: overrides,
    }, 'Area reset to its inherited material.');
  }

  rootClick(event) {
    const presetId = event.target.closest('[data-preset-id]')?.dataset.presetId;
    if (presetId) {
      this.commitPreset(presetId);
      return;
    }
    const action = event.target.closest('[data-material-action]')?.dataset.materialAction;
    if (action === 'reset') this.resetSelected();
    if (action === 'more') {
      this.closePalette();
      this.inspector.hidden = false;
      this.refreshInspector();
    }
    if (action === 'close-inspector') this.inspector.hidden = true;
    if (action === 'copy') this.copySelected();
    if (action === 'paste') this.pasteSelected();
    if (action === 'apply-matching') this.applyMatching();
    if (action === 'favorite') this.addFavorite();
    if (action === 'load-map') {
      this.root.querySelector(`[data-material-source-file="${event.target.closest(
        '[data-source-kind]',
      )?.dataset.sourceKind}"]`)?.click();
    }
    if (action === 'undo') this.undo();
    if (action === 'redo') this.redo();
  }

  palettePointerOver(event) {
    const presetId = event.target.closest('[data-preset-id]')?.dataset.presetId;
    if (presetId) this.previewPreset(presetId);
  }

  palettePointerOut(event) {
    if (event.target.closest('[data-preset-id]')) this.clearMaterialPreview();
  }

  rootChange(event) {
    const field = event.target.dataset.materialField;
    if (!field || !this.selectedRegionId) return;
    if (field === 'presetId') {
      this.commitPreset(event.target.value);
      return;
    }
    const currentRegion = this.regions.get(this.selectedRegionId);
    const currentPresetId = this.document.materialAreaOverrides[this.selectedRegionId]
      ?? this.document.materialDefaults[currentRegion?.family];
    const base = getWorkshopMaterialPreset(this.document, currentPresetId)
      ?? BUILTIN_WORKSHOP_MATERIAL_PRESETS['granite-masonry'];
    const descriptor = {
      ...base,
      [field]: ['repeat', 'rotation', 'roughness', 'metalness', 'normalStrength',
        'heightStrength', 'weathering'].includes(field)
        ? Number(event.target.value)
        : event.target.value,
      id: undefined,
      label: `${base.label} custom`,
      family: currentRegion?.family ?? base.family,
    };
    const customId = `custom-${hashDescriptor(descriptor)}`;
    descriptor.id = customId;
    const next = cloneDocument(this.document);
    next.materialLibrary.presets[customId] = descriptor;
    next.materialAreaOverrides[this.selectedRegionId] = customId;
    this.commit(next, 'Custom full-PBR area preset stored.');
  }

  async sourceFileChange(event) {
    const kind = event.target.dataset.materialSourceFile;
    if (!kind || !this.selectedRegionId) return;
    event.stopPropagation();
    const [file] = event.target.files ?? [];
    event.target.value = '';
    if (!file) return;
    this.onStatus?.(`Preparing ${file.name} as a ${kind.toUpperCase()} source…`, false);
    try {
      const prepared = await prepareWorkshopAlbedo(file);
      const sourceId = createWorkshopMaterialSourceId(kind, prepared.dataUrl);
      const region = this.regions.get(this.selectedRegionId);
      const presetId = this.document.materialAreaOverrides[this.selectedRegionId]
        ?? this.document.materialDefaults[region?.family];
      const base = getWorkshopMaterialPreset(this.document, presetId)
        ?? BUILTIN_WORKSHOP_MATERIAL_PRESETS['granite-masonry'];
      const descriptor = {
        ...base,
        id: undefined,
        label: `${base.label} custom`,
        family: region?.family ?? base.family,
        sources: { ...base.sources, [kind]: sourceId },
      };
      const customId = `custom-${hashDescriptor(descriptor)}`;
      descriptor.id = customId;
      const next = cloneDocument(this.document);
      next.materialLibrary.sources[sourceId] = {
        kind,
        name: prepared.name,
        dataUrl: prepared.dataUrl,
      };
      next.materialLibrary.presets[customId] = descriptor;
      next.materialAreaOverrides[this.selectedRegionId] = customId;
      this.commit(next, `${prepared.name} assigned as ${kind.toUpperCase()} for this area.`);
    } catch (error) {
      this.onStatus?.(error instanceof Error ? error.message : String(error), true);
    }
  }

  copySelected() {
    if (!this.selectedRegionId) return;
    const region = this.regions.get(this.selectedRegionId);
    const presetId = this.document.materialAreaOverrides[this.selectedRegionId]
      ?? this.document.materialDefaults[region?.family];
    const preset = getWorkshopMaterialPreset(this.document, presetId);
    if (preset) {
      this.clipboard = { ...preset, sources: { ...preset.sources } };
      this.onStatus?.(`Copied ${preset.label}.`, false);
    }
  }

  pasteSelected() {
    if (!this.clipboard || !this.selectedRegionId) return;
    const region = this.regions.get(this.selectedRegionId);
    const descriptor = {
      ...this.clipboard,
      family: region?.family ?? this.clipboard.family,
      id: undefined,
      label: `${this.clipboard.label} copy`,
    };
    const customId = `custom-${hashDescriptor(descriptor)}`;
    descriptor.id = customId;
    const next = cloneDocument(this.document);
    next.materialLibrary.presets[customId] = descriptor;
    next.materialAreaOverrides[this.selectedRegionId] = customId;
    this.commit(next, 'Pasted material to selected area.');
  }

  applyMatching() {
    if (!this.selectedRegionId) return;
    const selected = this.regions.get(this.selectedRegionId);
    const presetId = this.document.materialAreaOverrides[this.selectedRegionId]
      ?? this.document.materialDefaults[selected?.family];
    if (!selected || !presetId) return;
    const overrides = { ...this.document.materialAreaOverrides };
    for (const region of this.regions.values()) {
      if (region.family === selected.family) overrides[region.id] = presetId;
    }
    this.commit({
      ...cloneDocument(this.document),
      materialAreaOverrides: overrides,
    }, `Applied material to all ${selected.family} areas.`);
  }

  addFavorite() {
    if (!this.selectedRegionId) return;
    const region = this.regions.get(this.selectedRegionId);
    const presetId = this.document.materialAreaOverrides[this.selectedRegionId]
      ?? this.document.materialDefaults[region?.family];
    if (!presetId) return;
    const favorites = this.document.materialFavorites.filter((id) => id !== presetId);
    favorites.unshift(presetId);
    this.commit({
      ...cloneDocument(this.document),
      materialFavorites: favorites.slice(0, 8),
    }, 'Material added to radial favorites.');
  }

  restore(snapshot, destination, message) {
    if (!snapshot) return;
    destination.push(cloneDocument(this.document));
    this.document = normalizeWorkshopMaterialDocument(snapshot);
    this.closePalette();
    this.refreshInspector();
    this.onChange?.(cloneDocument(this.document));
    this.onStatus?.(message, false);
  }

  undo() {
    this.restore(this.history.pop(), this.future, 'Material edit undone.');
  }

  redo() {
    this.restore(this.future.pop(), this.history, 'Material edit restored.');
  }

  keyDown(event) {
    if (!this.active) return;
    if (!this.palette.hidden && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...this.palette.querySelectorAll('button')];
      const current = Math.max(0, buttons.indexOf(document.activeElement));
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      buttons[(current + delta + buttons.length) % buttons.length]?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!this.palette.hidden) this.closePalette();
      else if (!this.inspector.hidden) this.inspector.hidden = true;
      else this.setActive(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    }
  }

  refreshInspector() {
    const region = this.regions.get(this.selectedRegionId);
    if (!region) return;
    const inheritedPresetId = this.document.materialDefaults[region.family] ?? '';
    const presetId = this.document.materialAreaOverrides[region.id] ?? inheritedPresetId;
    const allPresets = {
      ...BUILTIN_WORKSHOP_MATERIAL_PRESETS,
      ...this.document.materialLibrary.presets,
    };
    this.presetSelect.replaceChildren(...Object.values(allPresets).map((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      option.selected = preset.id === presetId;
      return option;
    }));
    const preset = getWorkshopMaterialPreset(this.document, presetId)
      ?? BUILTIN_WORKSHOP_MATERIAL_PRESETS['granite-masonry'];
    this.regionName.textContent = `${region.label} · ${
      Object.hasOwn(this.document.materialAreaOverrides, region.id) ? 'overridden' : 'inherited'
    }`;
    for (const input of this.root.querySelectorAll('[data-material-field]')) {
      if (input.dataset.materialField === 'presetId') continue;
      input.value = String(preset[input.dataset.materialField] ?? '');
    }
    for (const label of this.root.querySelectorAll('[data-source-name]')) {
      const sourceId = preset.sources[label.dataset.sourceName];
      label.textContent = sourceId
        ? this.document.materialLibrary.sources[sourceId]?.name ?? 'Built-in'
        : 'Built-in';
    }
  }

  refreshBudget(stats) {
    if (!stats) return;
    this.budget.textContent = `${stats.drawParts}/16 draw parts · ${stats.materialCount} materials`
      + ` · ${stats.materialRegions} semantic areas`;
  }

  dispose() {
    this.clearMaterialPreview();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.root.removeEventListener('click', this.onRootClick);
    this.root.removeEventListener('change', this.onRootChange);
    this.root.removeEventListener('pointerover', this.onRootPointerOver);
    this.root.removeEventListener('pointerout', this.onRootPointerOut);
    this.root.removeEventListener('change', this.onSourceFileChange);
    window.removeEventListener('keydown', this.onKeyDown);
    this.highlight.removeFromParent();
    this.highlight.geometry.dispose();
    this.highlight.material.dispose();
    this.root.replaceChildren();
  }
}
