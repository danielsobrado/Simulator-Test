import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { disposeModelParts } from '../assets/modelParts.js';
import { icon } from '../ui/icons.js';
import './ProceduralWorkshopComponentController.css';
import { ProceduralWorkshopComponentController } from './ProceduralWorkshopComponentController.js';
import { ProceduralWorkshopMaterialController } from './ProceduralWorkshopMaterialController.js';
import { ProceduralWorkshopPlannerClient } from './ProceduralWorkshopPlannerClient.js';
import { createWorkshopStage } from './ProceduralWorkshopStage.js';
import { ProceduralWorkshopSurfaceEditor } from './ProceduralWorkshopSurfaceEditor.js';
import { ProceduralWorkshopVariantFields } from './ProceduralWorkshopVariantFields.js';
import { WorkshopAmbientOcclusion } from './WorkshopAmbientOcclusion.js';
import { WorkshopShapeUiBridge } from './shapes/WorkshopShapeUiBridge.js';

function randomSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] & 0x7fffffff;
}

function actionForTransformMode(mode) {
  return mode === 'rotate' ? 'rotate' : mode === 'scale' ? 'scale' : 'move';
}

/**
 * The preview's transform toolbar.
 *
 * Icons rather than words, so it matches the construction tool's gizmo cluster
 * and stops costing a third of the preview's top edge. The `data-workshop-action`
 * values are unchanged — every existing handler and the `is-active` sync in
 * `actionForTransformMode` key off those, not off the label.
 */
const WORKSHOP_GIZMO_TOOLS = Object.freeze([
  { action: 'move', label: 'Move', iconName: 'move', active: true },
  { action: 'rotate', label: 'Rotate', iconName: 'rotate' },
  { action: 'scale', label: 'Scale', iconName: 'scale' },
  { action: 'material', label: 'Material', iconName: 'material' },
  { action: 'reset-component', label: 'Reset part', iconName: 'reset' },
  { action: 'reset-all-components', label: 'Reset all', iconName: 'reset-all' },
  { action: 'center', label: 'Center scene', iconName: 'center' },
  { action: 'frame', label: 'Frame', iconName: 'frame' },
]);

function workshopGizmoToolsMarkup() {
  return WORKSHOP_GIZMO_TOOLS
    .map(({ action, label, iconName, active }) => (
      `<button type="button"${active ? ' class="is-active"' : ''}`
      + ` data-workshop-action="${action}"`
      // The label moves to the accessible name; losing it entirely would leave
      // eight unlabelled buttons.
      + ` aria-label="${label}" title="${label}">${icon(iconName, { size: 17 })}</button>`
    ))
    .join('');
}

export class ProceduralWorkshopUi {
  constructor({ root, manager, onBaked }) {
    this.root = root;
    this.manager = manager;
    this.onBaked = onBaked;
    this.previewParts = [];
    this.previewRoot = new THREE.Group();
    this.renderer = null;
    this.rendererPromise = null;
    this.camera = null;
    this.controls = null;
    this.transformControls = null;
    this.componentController = null;
    this.materialController = null;
    this.planner = new ProceduralWorkshopPlannerClient();
    this.planRevision = 0;
    this.stage = null;
    this.ambientOcclusion = null;
    this.surfaceEditor = null;
    this.resizeObserver = null;
    this.animationFrame = 0;
    this.previewTimer = 0;
    this.openRevision = 0;
    this.disposed = false;
    this.finalPreviewTimer = 0;
    this.hasFramedPreview = false;
    this.onWindowKeyDown = (event) => {
      if (
        event.key === 'Escape'
        && !this.overlay.hidden
        && !this.componentController?.attachmentMode
        && !this.materialController?.active
      ) {
        this.close();
      }
    };

    root.insertAdjacentHTML('beforeend', `
      <div class="workshop-overlay" data-role="workshop-overlay" hidden>
        <section class="workshop-dialog" role="dialog" aria-modal="true" aria-labelledby="workshop-title">
          <header class="workshop-header">
            <div>
              <p class="workshop-eyebrow">Procedural object workshop</p>
              <h2 id="workshop-title">Sunlit medieval atelier</h2>
              <p>Sculpt the silhouette, edit every semantic component, assign materials by area, then bake it into Objects.</p>
            </div>
            <button class="workshop-close" type="button" data-workshop-action="close" aria-label="Close workshop">×</button>
          </header>
          <div class="workshop-body">
            <form class="workshop-controls" data-role="workshop-form">
              <label>Game-object name
                <input name="label" value="Sunlit Tower House" maxlength="48" required />
              </label>
              <label>Build
                <select name="archetype">
                  <option value="manor" selected>Tower house</option>
                  <option value="wall">Wall</option>
                  <option value="gatehouse">Gatehouse</option>
                  <option value="tower">Round tower</option>
                  <option value="square-tower">Square keep tower</option>
                  <option value="house">Village house</option>
                  <option value="prop">Village prop</option>
                  <option value="composition">Freeform shapes</option>
                </select>
              </label>
              <label data-workshop-field="variant" hidden>Design
                <select name="variant"></select>
              </label>
              <div class="workshop-field-grid">
                <label data-workshop-field="finish">Wall finish
                  <select name="finish">
                    <option value="masonry">Exposed masonry</option>
                    <option value="ochre" selected>Sun-washed ochre</option>
                    <option value="limewash">Warm limewash</option>
                    <option value="rose">Faded rose plaster</option>
                  </select>
                </label>
                <label data-workshop-field="style">Trim stone
                  <select name="style">
                    <option value="granite">Grey granite</option>
                    <option value="limestone" selected>Warm limestone</option>
                    <option value="sandstone">Red sandstone</option>
                  </select>
                </label>
                <label data-workshop-field="topStyle">Roof / top
                  <select name="topStyle">
                    <option value="battlements">Battlements</option>
                    <option value="slate" selected>Mossy slate</option>
                    <option value="terracotta">Terracotta tile</option>
                  </select>
                </label>
                <label data-workshop-field="shape">Silhouette
                  <select name="shape">
                    <option value="classic">Classic</option>
                    <option value="stepped" selected>Stepped gables</option>
                    <option value="tapered">Tapered tower</option>
                  </select>
                </label>
              </div>
              <div data-role="workshop-surface-editor"></div>
              <div class="workshop-field-grid">
                <label data-workshop-field="width">Width (m)<input name="width" type="number" min="2" max="16" step="0.5" value="8" /></label>
                <label data-workshop-field="depth"><span data-workshop-label="depth">Depth factor</span><input name="depth" type="number" min="1" max="12" step="0.5" value="2.5" /></label>
                <label data-workshop-field="height"><span data-workshop-label="height">Wall height (m)</span><input name="height" type="number" min="2" max="14" step="0.5" value="5.5" /></label>
                <label>Detail
                  <select name="detail">
                    <option value="1">Draft</option>
                    <option value="2" selected>High</option>
                    <option value="3">Ultra</option>
                  </select>
                </label>
              </div>
              <div class="workshop-field-grid">
                <label data-workshop-field="towerSide">Tower wing
                  <select name="towerSide">
                    <option value="left" selected>Left</option>
                    <option value="right">Right</option>
                    <option value="none">None</option>
                  </select>
                </label>
                <span class="workshop-range" data-workshop-field="roofScale">
                  <label for="workshop-roof-height">Roof height <output data-output-for="roofScale">1.15×</output></label>
                  <input id="workshop-roof-height" name="roofScale" type="range" min="0.55" max="2" step="0.05" value="1.15" />
                </span>
                <span class="workshop-range workshop-range--wide" data-workshop-field="roofOverhang">
                  <label for="workshop-roof-overhang">Roof overhang <output data-output-for="roofOverhang">0.45 m</output></label>
                  <input id="workshop-roof-overhang" name="roofOverhang" type="range" min="0.1" max="0.9" step="0.05" value="0.45" />
                </span>
              </div>
              <label>Deterministic seed
                <span class="workshop-inline">
                  <input name="seed" type="number" min="0" max="2147483647" step="1" value="1848" />
                  <button type="button" class="action-button" data-workshop-action="reroll">Reroll</button>
                </span>
              </label>
              <span class="workshop-range">
                <label for="workshop-weathering">Age and weathering <output data-output-for="weathering">35%</output></label>
                <input id="workshop-weathering" name="weathering" type="range" min="0" max="1" step="0.05" value="0.35" />
              </span>
              <span class="workshop-range">
                <label for="workshop-irregularity">Hand-built irregularity <output data-output-for="irregularity">45%</output></label>
                <input id="workshop-irregularity" name="irregularity" type="range" min="0" max="1" step="0.05" value="0.45" />
              </span>
              <div class="workshop-option-grid">
                <label class="workshop-check" data-workshop-field="windows">
                  <input name="windows" type="checkbox" checked />
                  Doors and windows
                </label>
                <label class="workshop-check" data-workshop-field="ivy">
                  <input name="ivy" type="checkbox" checked />
                  Procedural ivy
                </label>
              </div>
              <label class="workshop-check">
                <input name="remesh" type="checkbox" checked />
                Remesh into draw-call-efficient merged geometry
              </label>
              <label class="workshop-check">
                <input name="albedo" type="checkbox" checked />
                Generate procedural stone albedo when no wall or trim image is assigned
              </label>
              <p class="workshop-status" data-role="workshop-status">Ready to generate.</p>
              <div class="workshop-actions">
                <button type="button" class="action-button" data-workshop-action="preview">Regenerate preview</button>
                <button type="submit" class="action-button workshop-bake">Bake game object</button>
              </div>
            </form>
            <div class="workshop-preview">
              <div class="workshop-preview__badge">16 × 16 m sunlit work garden</div>
              <div class="workshop-gizmo-tools" role="toolbar" aria-label="Selected component transform tools">
                ${workshopGizmoToolsMarkup()}
              </div>
              <div class="workshop-canvas" data-role="workshop-canvas"></div>
              <div class="workshop-material-ui" data-role="workshop-material-ui"></div>
              <div class="workshop-component-editor" data-role="workshop-component-editor"></div>
              <p data-role="workshop-preview-hint">Select an area, then pull its gold edge arrows to reshape it · openings can be placed, duplicated, or repeated · drag empty space to orbit.</p>
            </div>
          </div>
        </section>
      </div>
    `);

    this.overlay = root.querySelector('[data-role="workshop-overlay"]');
    this.form = root.querySelector('[data-role="workshop-form"]');
    this.canvasHost = root.querySelector('[data-role="workshop-canvas"]');
    this.componentEditorHost = root.querySelector('[data-role="workshop-component-editor"]');
    this.materialUiHost = root.querySelector('[data-role="workshop-material-ui"]');
    this.status = root.querySelector('[data-role="workshop-status"]');
    this.surfaceEditor = new ProceduralWorkshopSurfaceEditor({
      root: root.querySelector('[data-role="workshop-surface-editor"]'),
      onChange: () => this.schedulePreview(70),
      onStatus: (message, isError) => {
        this.status.textContent = message;
        this.status.classList.toggle('is-error', isError);
      },
    });
    this.variantFields = new ProceduralWorkshopVariantFields(this.form);
    this.shapeBridge = new WorkshopShapeUiBridge(this);
    this.bind();
  }

  bind() {
    this.overlay.addEventListener('click', (event) => {
      const action = event.target.closest('[data-workshop-action]')?.dataset.workshopAction;
      if (action === 'close') this.close();
      if (action === 'preview') this.generatePreview();
      if (action === 'move' || action === 'rotate' || action === 'scale') {
        this.setTransformMode(action);
      }
      if (action === 'material') this.toggleMaterialMode();
      if (action === 'reset-component' || action === 'reset-all-components') {
        if (this.shapeBridge.active) {
          if (action === 'reset-component') this.shapeBridge.editor.session.undo();
          else this.shapeBridge.editor.session.redo();
          this.shapeBridge.editor.changed();
        } else if (action === 'reset-component') this.componentController?.resetSelected();
        else this.componentController?.resetAll();
      }
      if (action === 'center') this.centerPreview();
      if (action === 'frame') this.framePreview();
      if (action === 'reroll') {
        this.form.elements.seed.value = String(randomSeed());
        this.generatePreview();
      }
    });
    this.overlay.addEventListener('pointerdown', (event) => {
      if (event.target === this.overlay) this.close();
    });
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.bake();
    });
    this.form.addEventListener('change', (event) => {
      if (event.target.name === 'archetype' || event.target.name === 'variant') {
        this.componentController?.resetAll();
        this.hasFramedPreview = false;
        if (event.target.name === 'archetype') this.variantFields.onArchetypeChanged();
        else this.variantFields.onVariantChanged();
        this.shapeBridge.sync();
      }
      this.schedulePreview(50);
    });
    this.form.addEventListener('input', (event) => {
      if (event.target.matches('input[type="range"]')) {
        this.syncRangeOutputs();
        this.schedulePreview(32, { draft: true });
      }
    });
    window.addEventListener('keydown', this.onWindowKeyDown);
    this.syncRangeOutputs();
  }

  syncRangeOutputs() {
    const values = {
      roofScale: `${Number(this.form.elements.roofScale.value).toFixed(2)}×`,
      roofOverhang: `${Number(this.form.elements.roofOverhang.value).toFixed(2)} m`,
      weathering: `${Math.round(Number(this.form.elements.weathering.value) * 100)}%`,
      irregularity: `${Math.round(Number(this.form.elements.irregularity.value) * 100)}%`,
    };
    for (const [name, value] of Object.entries(values)) {
      const output = this.form.querySelector(`[data-output-for="${name}"]`);
      if (output) output.textContent = value;
    }
  }

  schedulePreview(delay = 60, { draft = false } = {}) {
    if (this.disposed) return;
    window.clearTimeout(this.previewTimer);
    if (!draft) window.clearTimeout(this.finalPreviewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = 0;
      if (!this.disposed && !this.overlay.hidden) this.generatePreview({ draft });
    }, delay);
    if (draft) {
      window.clearTimeout(this.finalPreviewTimer);
      this.finalPreviewTimer = window.setTimeout(() => {
        this.finalPreviewTimer = 0;
        if (!this.disposed && !this.overlay.hidden) this.generatePreview();
      }, Math.max(260, delay + 180));
    }
  }

  syncTransformModeButtons(mode) {
    const materialActive = this.materialController?.active === true;
    const activeAction = actionForTransformMode(mode);
    for (const button of this.overlay.querySelectorAll(
      '[data-workshop-action="move"], [data-workshop-action="rotate"], [data-workshop-action="scale"]',
    )) {
      const requestedMode = button.dataset.workshopAction === 'move'
        ? 'translate'
        : button.dataset.workshopAction;
      button.disabled = materialActive
        || this.shapeBridge?.active
        || !(this.componentController?.supportsMode(requestedMode) ?? true);
      button.classList.toggle(
        'is-active',
        button.dataset.workshopAction === activeAction && !button.disabled,
      );
    }
  }

  syncMaterialModeButtons(active = this.materialController?.active === true) {
    this.overlay.querySelector('[data-workshop-action="material"]')
      ?.classList.toggle('is-active', active);
    for (const action of ['reset-component', 'reset-all-components']) {
      const button = this.overlay.querySelector(`[data-workshop-action="${action}"]`);
      if (button) button.disabled = active;
    }
    this.syncTransformModeButtons(this.componentController?.mode ?? 'translate');
    this.shapeBridge.syncHistoryToolbar();
  }

  setTransformMode(action) {
    if (!this.transformControls) return;
    if (this.materialController?.active) this.toggleMaterialMode(false);
    const requestedMode = action === 'rotate' ? 'rotate' : action === 'scale' ? 'scale' : 'translate';
    const activeMode = this.componentController?.setMode(requestedMode) ?? requestedMode;
    this.syncTransformModeButtons(activeMode);
  }

  toggleMaterialMode(force) {
    if (!this.materialController) return false;
    const active = this.materialController.setActive(
      force === undefined ? !this.materialController.active : force,
    );
    this.syncMaterialModeButtons(active);
    this.status.textContent = active
      ? 'Material mode · hover a semantic area, then click for full-PBR favorites.'
      : 'Transform mode restored.';
    this.status.classList.remove('is-error');
    return active;
  }

  centerPreview() {
    this.previewRoot.position.set(0, 0, 0);
    this.previewRoot.rotation.set(0, 0, 0);
    this.previewRoot.scale.set(1, 1, 1);
    this.framePreview();
  }

  readInput() {
    const values = new FormData(this.form);
    return {
      label: values.get('label'),
      recipe: {
        archetype: values.get('archetype'),
        ...this.variantFields.readVariant(),
        style: values.get('style'),
        topStyle: values.get('topStyle'),
        finish: values.get('finish'),
        shape: values.get('shape'),
        towerSide: values.get('towerSide'),
        width: Number(values.get('width')),
        depth: Number(values.get('depth')),
        height: Number(values.get('height')),
        roofScale: Number(values.get('roofScale')),
        roofOverhang: Number(values.get('roofOverhang')),
        detail: Number(values.get('detail')),
        seed: Number(values.get('seed')),
        weathering: Number(values.get('weathering')),
        irregularity: Number(values.get('irregularity')),
        windows: values.get('windows') === 'on',
        ivy: values.get('ivy') === 'on',
        remesh: values.get('remesh') === 'on',
        albedo: values.get('albedo') === 'on',
        surfaceTextures: this.surfaceEditor.toDocument(),
        ...(this.materialController?.toDocument() ?? {}),
        componentTransforms: this.componentController?.toDocument() ?? {},
        openingAttachments: this.componentController?.toOpeningAttachmentsDocument() ?? {},
        openingAssemblies: this.componentController?.toOpeningAssembliesDocument() ?? {},
        ...this.shapeBridge.recipeFields(),
      },
    };
  }

  captureRuntimeState() {
    const shapeState = this.shapeBridge.captureRuntimeState();
    const input = this.readInput();
    if (this.shapeBridge.active) input.recipe.composition = shapeState.session.composition;
    return {
      open: !this.overlay.hidden,
      fields: [...this.form.elements].filter(element => element.name).map(element => ({
        name: element.name, value: element.value, checked: element.checked,
      })),
      input,
      shapeState,
      componentSession: this.componentController?.semanticEditSession?.captureRuntimeState(),
      materialHistory: this.materialController ? {
        history: [...this.materialController.history], future: [...this.materialController.future],
      } : null,
    };
  }

  async restoreRuntimeState(state) {
    const applyFields = () => {
      for (const field of state.fields) {
        const element = this.form.elements.namedItem(field.name);
        if (!element) continue;
        element.value = field.value;
        if (element.type === 'checkbox') element.checked = field.checked;
      }
    };
    applyFields(); this.variantFields.onArchetypeChanged(); applyFields(); this.syncRangeOutputs();
    this.shapeBridge.restoreRuntimeState(state.shapeState);
    this.surfaceEditor.commit(state.input.recipe.surfaceTextures);
    if (!state.componentSession && !state.open) return;
    await this.ensureRenderer();
    this.materialController.setDocument(state.input.recipe);
    // Restore semantic authoring before deriving the new renderer's preview.
    this.componentController.transforms = structuredClone(state.input.recipe.componentTransforms);
    this.componentController.openingAttachments = structuredClone(state.input.recipe.openingAttachments);
    this.componentController.openingAssemblies = structuredClone(state.input.recipe.openingAssemblies);
    await this.generatePreview({ frame: true, allowHidden: true });
    if (state.componentSession) this.componentController.semanticEditSession.restoreRuntimeState(state.componentSession);
    this.componentController.updateHistoryButtons();
    if (state.materialHistory) Object.assign(this.materialController, state.materialHistory);
    if (state.open) {
      this.root.classList.add('is-workshop-open'); this.overlay.hidden = false;
      if (!this.animationFrame) this.renderLoop();
    }
  }

  async open() {
    if (this.disposed) return;
    const revision = ++this.openRevision;
    this.root.classList.add('is-workshop-open');
    this.overlay.hidden = false;
    try {
      await this.ensureRenderer();
      if (this.disposed || this.overlay.hidden || revision !== this.openRevision) return;
      this.hasFramedPreview = false;
      this.generatePreview({ frame: true });
      if (this.animationFrame === 0) this.renderLoop();
    } catch (error) {
      if (revision !== this.openRevision || this.disposed) return;
      this.status.textContent = error instanceof Error ? error.message : String(error);
      this.status.classList.add('is-error');
    }
  }

  close() {
    this.shapeBridge.close();
    this.openRevision += 1;
    this.planRevision += 1;
    this.planner.cancel();
    this.overlay.hidden = true;
    this.root.classList.remove('is-workshop-open');
    this.componentController?.cancelAttachmentPlacement();
    this.materialController?.setActive(false);
    window.clearTimeout(this.previewTimer);
    window.clearTimeout(this.finalPreviewTimer);
    this.previewTimer = 0;
    this.finalPreviewTimer = 0;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  async ensureRenderer() {
    if (this.componentController) return;
    if (this.rendererPromise) return this.rendererPromise;
    this.rendererPromise = this.initializeRenderer();
    try {
      await this.rendererPromise;
    } finally {
      this.rendererPromise = null;
    }
  }

  async initializeRenderer() {
    const renderer = new THREE.WebGPURenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(this.canvasHost.clientWidth, this.canvasHost.clientHeight);
    renderer.setClearColor('#9bc8ec', 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    try {
      await renderer.init();
      if (this.disposed) {
        renderer.dispose();
        return;
      }
      this.renderer = renderer;
      this.canvasHost.append(renderer.domElement);

      this.scene = new THREE.Scene();
      this.scene.add(this.previewRoot);
      this.camera = new THREE.PerspectiveCamera(
        36,
        this.canvasHost.clientWidth / this.canvasHost.clientHeight,
        0.1,
        100,
      );
      this.camera.position.set(13, 10, 16);
      this.controls = new OrbitControls(this.camera, renderer.domElement);
      this.controls.target.set(0, 3, 0);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.075;
      this.controls.screenSpacePanning = false;
      this.controls.minDistance = 5;
      this.controls.maxDistance = 52;
      this.controls.maxPolarAngle = Math.PI * 0.475;

      this.stage = createWorkshopStage(this.scene);
      this.transformControls = new TransformControls(this.camera, renderer.domElement);
      this.transformControls.setTranslationSnap(0.1);
      this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
      this.transformControls.setScaleSnap(0.05);
      this.transformControls.setSize(0.68);
      this.scene.add(this.transformControls.getHelper());

      this.componentController = new ProceduralWorkshopComponentController({
        root: this.componentEditorHost,
        previewRoot: this.previewRoot,
        renderer,
        camera: this.camera,
        orbitControls: this.controls,
        transformControls: this.transformControls,
        onModeChange: (mode) => this.syncTransformModeButtons(mode),
        onChange: (component, _transform, meta) => {
          this.status.textContent = component
            ? `${component.label} edit stored in the object recipe.`
            : meta?.reason === 'history'
              ? 'Component edit history restored.'
              : meta?.reason === 'attachments'
                ? 'Opening layout regenerated from its wall attachments.'
                : 'All component edits were reset.';
          this.status.classList.remove('is-error');
          if (!component || component.transformPolicy === 'opening2d') {
            this.schedulePreview(0);
          }
        },
      });
      this.materialController = new ProceduralWorkshopMaterialController({
        root: this.materialUiHost,
        canvasHost: this.canvasHost,
        previewRoot: this.previewRoot,
        renderer,
        camera: this.camera,
        componentController: this.componentController,
        onChange: () => this.schedulePreview(0),
        onStatus: (message, isError) => {
          this.status.textContent = message;
          this.status.classList.toggle('is-error', isError);
        },
        onActiveChange: (active) => this.syncMaterialModeButtons(active),
      });
      this.shapeBridge.initializeRenderer();
      this.ambientOcclusion = new WorkshopAmbientOcclusion({
        renderer,
        scene: this.scene,
        camera: this.camera,
      });

      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvasHost);
    } catch (error) {
      const rendererWasOwned = this.renderer === renderer;
      this.releaseRendererState();
      if (!rendererWasOwned) renderer.dispose();
      throw error;
    }
  }

  releaseRendererState() {
    this.shapeBridge.releaseRenderer();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.componentController?.dispose();
    this.componentController = null;
    this.materialController?.dispose();
    this.materialController = null;
    this.transformControls?.dispose();
    this.transformControls = null;
    this.controls?.dispose();
    this.controls = null;
    this.stage?.dispose();
    this.stage = null;
    this.ambientOcclusion?.dispose();
    this.ambientOcclusion = null;
    this.previewRoot.removeFromParent();
    this.renderer?.domElement.remove();
    this.renderer?.dispose();
    this.renderer = null;
    this.camera = null;
    this.scene = null;
  }

  resize() {
    if (
      !this.renderer
      || !this.camera
      || this.canvasHost.clientWidth === 0
      || this.canvasHost.clientHeight === 0
    ) {
      return;
    }
    this.renderer.setSize(this.canvasHost.clientWidth, this.canvasHost.clientHeight);
    this.camera.aspect = this.canvasHost.clientWidth / this.canvasHost.clientHeight;
    this.camera.updateProjectionMatrix();
  }

  async generatePreview({ draft = false, frame = false, allowHidden = false } = {}) {
    const revision = ++this.planRevision;
    try {
      if (!this.componentController) {
        throw new Error('The workshop component editor is not ready.');
      }
      const { recipe } = this.readInput();
      const previewRecipe = draft && !this.shapeBridge.active
        ? {
          ...recipe,
          detail: 1,
          remesh: true,
        }
        : recipe;
      const plan = await this.planner.plan(previewRecipe);
      if (revision !== this.planRevision || (this.overlay.hidden && !allowHidden)) return;
      if (this.shapeBridge.active) {
        const parts = this.shapeBridge.update(previewRecipe, plan, { interactive: draft });
        this.previewParts = parts;
        if (frame || !this.hasFramedPreview) { this.framePreview(); this.hasFramedPreview = true; }
        const stats = parts.stats;
        this.status.textContent = `${draft ? 'Interactive preview' : 'Final preview'} · ${stats.components} shapes · drag the gold handles or choose a roof and wall finish.`;
        this.status.classList.remove('is-error');
        this.completedPlanRevision = revision;
        return;
      }
      const nextParts = this.manager.createPreviewParts(previewRecipe);
      this.clearPreview();
      this.previewParts = nextParts;
      try {
        this.componentController.replaceParts(nextParts);
        this.materialController?.replaceParts(nextParts);
      } catch (error) {
        this.componentController.clear();
        disposeModelParts(nextParts);
        this.previewParts = [];
        throw error;
      }
      this.syncTransformModeButtons(this.componentController.mode);
      if (frame || !this.hasFramedPreview) {
        this.framePreview();
        this.hasFramedPreview = true;
      }
      const stats = nextParts.stats;
      const quality = draft ? 'Interactive proxy' : 'Final preview';
      this.status.textContent = `${quality} · ${stats.components} editable components · ${stats.materialRegions} semantic material areas · ${stats.materialCount} materials · ${stats.stones} stones · ${stats.features} semantic details · ${stats.sourceVertices.toLocaleString()} source vertices · ${stats.drawParts}/16 preview parts.`;
      this.status.classList.remove('is-error');
      this.completedPlanRevision = revision;
    } catch (error) {
      if (error?.name === 'AbortError') return;
      this.status.textContent = error instanceof Error ? error.message : String(error);
      this.status.classList.add('is-error');
    }
  }

  framePreview() {
    if (!this.camera || !this.controls || (this.shapeBridge.active
      ? this.shapeBridge.preview?.groups.size === 0 : this.componentController?.groups.size === 0)) return;
    const bounds = new THREE.Box3().setFromObject(this.previewRoot);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const distance = Math.max(size.x, size.y, size.z) * 2.85;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, Math.max(6, distance));
    this.camera.near = Math.max(0.05, distance / 100);
    this.camera.far = Math.max(100, distance * 8);
    // Garden haze is tuned for cottages; a castle framed from further away must not sit inside it.
    if (this.scene.fog?.isFog) {
      this.scene.fog.near = Math.max(30, distance * 1.3);
      this.scene.fog.far = Math.max(72, distance * 3.2);
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  bake() {
    try {
      if (this.shapeBridge.active) {
        this.shapeBridge.preview?.handles.finish(true);
        this.shapeBridge.editor.session.commit();
      }
      const record = this.manager.create(this.readInput());
      this.status.textContent = `${record.label} baked and added to Objects.`;
      this.status.classList.remove('is-error');
      this.onBaked?.(record);
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : String(error);
      this.status.classList.add('is-error');
    }
  }

  clearPreview() {
    this.materialController?.replaceParts([]);
    if (this.componentController) this.componentController.clear();
    else this.previewRoot.clear();
    if (this.previewPartsOwnedByShape) this.shapeBridge.clear();
    else disposeModelParts(this.previewParts);
    this.previewPartsOwnedByShape = false;
    this.previewParts = [];
  }

  renderLoop() {
    if (this.overlay.hidden || !this.renderer || !this.controls || !this.scene || !this.camera) {
      this.animationFrame = 0;
      return;
    }
    this.controls.update();
    if (this.ambientOcclusion) this.ambientOcclusion.render();
    else this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(() => this.renderLoop());
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.close();
    window.removeEventListener('keydown', this.onWindowKeyDown);
    this.clearPreview();
    this.releaseRendererState();
    this.shapeBridge.dispose();
    this.surfaceEditor?.dispose();
    this.surfaceEditor = null;
    this.planner.dispose();
    this.overlay.remove();
  }
}
