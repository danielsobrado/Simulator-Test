import * as THREE from 'three/webgpu';
import {
  createIdentityComponentTransform,
  isIdentityComponentTransform,
  normalizeComponentTransform,
  serializeComponentTransforms,
  WORKSHOP_COMPONENT_TRANSFORM_LIMITS,
} from './ProceduralWorkshopComponentTransforms.js';
import {
  axesForWorkshopMode,
  describeWorkshopEditPolicy,
  getWorkshopComponentEditPolicy,
  supportsWorkshopTransformMode,
} from './ProceduralWorkshopEditPolicy.js';

const POINTER_SELECT_DISTANCE = 5;
const COMPONENT_POSITION_LIMIT = WORKSHOP_COMPONENT_TRANSFORM_LIMITS.position;
const SELECTION_COLOR = 0xf0d675;
const INFERENCE_COLOR = 0x7de0cf;
const HANDLE_COLOR = 0xf3d879;
const INFERENCE_THRESHOLD = 0.08;
const MAX_HISTORY = 80;
const COMPONENT_KIND_ORDER = Object.freeze({
  structure: 0,
  roof: 1,
  door: 2,
  window: 3,
  opening: 4,
  woodwork: 5,
  metalwork: 6,
  foliage: 7,
});

function normalizeAngle(value) {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function componentTransformFromGroup(group) {
  const basePosition = group.userData.workshopBasePosition;
  return normalizeComponentTransform({
    position: [
      group.position.x - basePosition.x,
      group.position.y - basePosition.y,
      group.position.z - basePosition.z,
    ],
    rotation: [
      normalizeAngle(group.rotation.x),
      normalizeAngle(group.rotation.y),
      normalizeAngle(group.rotation.z),
    ],
    scale: group.scale.toArray(),
  });
}

function combineComponentTransforms(base, delta) {
  return normalizeComponentTransform({
    position: base.position.map((value, index) => THREE.MathUtils.clamp(
      value + delta.position[index],
      -COMPONENT_POSITION_LIMIT,
      COMPONENT_POSITION_LIMIT,
    )),
    rotation: base.rotation.map((value, index) => normalizeAngle(value + delta.rotation[index])),
    scale: base.scale.map((value, index) => THREE.MathUtils.clamp(
      value * delta.scale[index],
      WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMin,
      WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMax,
    )),
  });
}

function applyTransform(group, transform) {
  const basePosition = group.userData.workshopBasePosition;
  group.position.set(
    basePosition.x + transform.position[0],
    basePosition.y + transform.position[1],
    basePosition.z + transform.position[2],
  );
  group.rotation.set(...transform.rotation);
  group.scale.set(...transform.scale);
  group.updateMatrixWorld(true);
}

function componentSort(left, right) {
  const leftOrder = COMPONENT_KIND_ORDER[left.kind] ?? 99;
  const rightOrder = COMPONENT_KIND_ORDER[right.kind] ?? 99;
  return leftOrder - rightOrder || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function createSelectionHelper() {
  const helper = new THREE.Box3Helper(new THREE.Box3(), SELECTION_COLOR);
  helper.name = 'workshop-component-selection';
  helper.visible = false;
  helper.raycast = () => {};
  return helper;
}

function createInferenceHelper() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
  const helper = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: INFERENCE_COLOR,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }),
  );
  helper.name = 'workshop-component-inference';
  helper.visible = false;
  helper.renderOrder = 1000;
  helper.raycast = () => {};
  return helper;
}

function createArchitecturalHandleHelper() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(21), 3));
  geometry.setDrawRange(0, 0);
  const helper = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: HANDLE_COLOR,
      size: 0.18,
      sizeAttenuation: true,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    }),
  );
  helper.name = 'workshop-architectural-handles';
  helper.visible = false;
  helper.renderOrder = 1001;
  return helper;
}

function copyTransformDocument(input = {}) {
  return Object.fromEntries(
    Object.entries(serializeComponentTransforms(input)).map(([componentId, transform]) => [
      componentId,
      {
        position: [...transform.position],
        rotation: [...transform.rotation],
        scale: [...transform.scale],
      },
    ]),
  );
}

function sameTransformDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isOpening2d(component) {
  return component?.transformPolicy === 'opening2d';
}

export class ProceduralWorkshopComponentController {
  constructor({
    root,
    previewRoot,
    renderer,
    camera,
    orbitControls,
    transformControls,
    onChange,
    onModeChange,
  }) {
    this.root = root;
    this.previewRoot = previewRoot;
    this.renderer = renderer;
    this.camera = camera;
    this.orbitControls = orbitControls;
    this.transformControls = transformControls;
    this.onChange = onChange;
    this.onModeChange = onModeChange;
    this.transforms = {};
    this.groups = new Map();
    this.meshes = [];
    this.selectedComponentId = null;
    this.mode = 'translate';
    this.space = 'world';
    this.axisConstraint = 'policy';
    this.snapEnabled = true;
    this.snapInverted = false;
    this.history = [];
    this.future = [];
    this.dragStartTransforms = null;
    this.dragging = false;
    this.pointerStart = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selectionHelper = createSelectionHelper();
    this.inferenceHelper = createInferenceHelper();
    this.handleHelper = createArchitecturalHandleHelper();
    this.handleMetadata = [];
    this.selectionRoot = previewRoot.parent ?? previewRoot;
    this.selectionRoot.add(this.selectionHelper);
    this.selectionRoot.add(this.inferenceHelper);
    this.selectionRoot.add(this.handleHelper);

    root.innerHTML = `
      <div class="workshop-component-heading">
        <label class="workshop-component-select">
          Selected area
          <select data-role="workshop-component-select" aria-label="Selected editable component"></select>
        </label>
        <label class="workshop-component-space">
          Space
          <select data-role="workshop-component-space" aria-label="Transform orientation">
            <option value="world">World</option>
            <option value="parent">Parent</option>
            <option value="local">Local</option>
          </select>
        </label>
      </div>
      <div class="workshop-component-actions" role="toolbar" aria-label="Component edit history and constraints">
        <button type="button" data-component-action="undo" title="Undo component edit (Ctrl+Z)">Undo</button>
        <button type="button" data-component-action="redo" title="Redo component edit (Ctrl+Y)">Redo</button>
        <button type="button" data-component-action="mirror" title="Mirror the selected area across the workshop centre">Mirror X</button>
        <label class="workshop-component-snap">
          <input type="checkbox" data-role="workshop-component-snap" checked />
          Snap
        </label>
        <label class="workshop-component-axis">
          Axes
          <select data-role="workshop-component-axis" aria-label="Constrain transform axes">
            <option value="policy">Smart</option>
            <option value="x">X</option>
            <option value="y">Y</option>
            <option value="z">Z</option>
            <option value="xy">XY</option>
            <option value="xz">XZ</option>
            <option value="yz">YZ</option>
          </select>
        </label>
      </div>
      <div class="workshop-component-values" data-role="workshop-component-values">
        <span></span><b>X</b><b>Y</b><b>Z</b>
        <label>Move</label>
        <input type="number" step="0.05" data-transform-field="position-0" aria-label="Move X" />
        <input type="number" step="0.05" data-transform-field="position-1" aria-label="Move Y" />
        <input type="number" step="0.05" data-transform-field="position-2" aria-label="Move Z" />
        <label>Rotate</label>
        <input type="number" step="1" data-transform-field="rotation-0" aria-label="Rotate X degrees" />
        <input type="number" step="1" data-transform-field="rotation-1" aria-label="Rotate Y degrees" />
        <input type="number" step="1" data-transform-field="rotation-2" aria-label="Rotate Z degrees" />
        <label>Scale</label>
        <input type="number" min="0.1" max="4" step="0.025" data-transform-field="scale-0" aria-label="Scale X" />
        <input type="number" min="0.1" max="4" step="0.025" data-transform-field="scale-1" aria-label="Scale Y" />
        <input type="number" min="0.1" max="4" step="0.025" data-transform-field="scale-2" aria-label="Scale Z" />
      </div>
      <span class="workshop-component-hint" data-role="workshop-component-hint">
        Click a wall, roof, door, window, tower, or detail in the preview.
      </span>
    `;
    this.select = root.querySelector('[data-role="workshop-component-select"]');
    this.spaceSelect = root.querySelector('[data-role="workshop-component-space"]');
    this.axisSelect = root.querySelector('[data-role="workshop-component-axis"]');
    this.snapInput = root.querySelector('[data-role="workshop-component-snap"]');
    this.valueFields = [...root.querySelectorAll('[data-transform-field]')];
    this.undoButton = root.querySelector('[data-component-action="undo"]');
    this.redoButton = root.querySelector('[data-component-action="redo"]');
    this.hint = root.querySelector('[data-role="workshop-component-hint"]');

    this.onSelectChange = () => this.selectComponent(this.select.value);
    this.onSpaceChange = () => this.setSpace(this.spaceSelect.value);
    this.onAxisChange = () => this.setAxisConstraint(this.axisSelect.value);
    this.onSnapChange = () => this.setSnapEnabled(this.snapInput.checked);
    this.onRootClick = (event) => {
      const action = event.target.closest('[data-component-action]')?.dataset.componentAction;
      if (action === 'undo') this.undo();
      if (action === 'redo') this.redo();
      if (action === 'mirror') this.mirrorSelected();
    };
    this.onValueChange = (event) => {
      if (event.target.matches('[data-transform-field]')) this.commitNumericTransform();
    };
    this.onPointerDown = (event) => this.pointerDown(event);
    this.onPointerUp = (event) => this.pointerUp(event);
    this.onDraggingChanged = ({ value }) => {
      this.dragging = value;
      this.orbitControls.enabled = !value;
      if (value) {
        this.dragStartTransforms = copyTransformDocument(this.transforms);
      } else {
        this.commitSelectedTransform(this.dragStartTransforms);
        this.dragStartTransforms = null;
      }
    };
    this.onObjectChange = () => {
      this.constrainSelectedTransform();
      this.updateSelectionHelper();
      this.updateNumericFields();
    };
    this.onWindowKeyDown = (event) => this.keyDown(event);
    this.onWindowKeyUp = (event) => this.keyUp(event);

    this.select.addEventListener('change', this.onSelectChange);
    this.spaceSelect.addEventListener('change', this.onSpaceChange);
    this.axisSelect.addEventListener('change', this.onAxisChange);
    this.snapInput.addEventListener('change', this.onSnapChange);
    this.root.addEventListener('click', this.onRootClick);
    this.root.addEventListener('change', this.onValueChange);
    renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    transformControls.addEventListener('dragging-changed', this.onDraggingChanged);
    transformControls.addEventListener('objectChange', this.onObjectChange);
    window.addEventListener('keydown', this.onWindowKeyDown);
    window.addEventListener('keyup', this.onWindowKeyUp);
    this.updateHistoryButtons();
  }

  pointerDown(event) {
    if (event.button !== 0) return;
    this.pointerStart = { x: event.clientX, y: event.clientY };
  }

  pointerUp(event) {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || this.dragging || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > POINTER_SELECT_DISTANCE) {
      return;
    }

    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Points.threshold = 0.24;
    const handleHit = this.raycaster.intersectObject(this.handleHelper, false)[0];
    if (handleHit && this.handleMetadata[handleHit.index]) {
      const handle = this.handleMetadata[handleHit.index];
      this.setMode(handle.mode);
      this.setAxisConstraint(handle.axes);
      this.hint.textContent = `${handle.label} handle armed · drag the highlighted gizmo axis or type an exact value.`;
      return;
    }
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    const componentId = hit?.object?.userData?.workshopComponentId;
    if (componentId) this.selectComponent(componentId);
  }

  isEditorVisible() {
    const overlay = this.root.closest('[data-role="workshop-overlay"]');
    return !overlay?.hidden;
  }

  keyDown(event) {
    if (!this.isEditorVisible()) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (event.key === 'Shift' && !event.repeat) {
      this.snapInverted = true;
      this.applySnapSettings();
      return;
    }
    if (key === 'w' || key === 'g') this.setMode('translate');
    if (key === 'e') this.setMode('rotate');
    if (key === 'r') this.setMode('scale');
    if (['x', 'y', 'z'].includes(key)) this.setAxisConstraint(key);
    if (key === '.') this.setAxisConstraint('policy');
  }

  keyUp(event) {
    if (event.key !== 'Shift' || !this.snapInverted) return;
    this.snapInverted = false;
    this.applySnapSettings();
  }

  selectedGroup() {
    return this.groups.get(this.selectedComponentId) ?? null;
  }

  selectedComponent() {
    return this.selectedGroup()?.userData.workshopComponent ?? null;
  }

  selectedPolicy() {
    const component = this.selectedComponent();
    return component?.editPolicy ?? getWorkshopComponentEditPolicy(component);
  }

  supportsMode(mode) {
    return supportsWorkshopTransformMode(this.selectedPolicy(), mode);
  }

  updateHistoryButtons() {
    if (this.undoButton) this.undoButton.disabled = this.history.length === 0;
    if (this.redoButton) this.redoButton.disabled = this.future.length === 0;
  }

  recordHistory(before) {
    if (!before) return;
    const after = copyTransformDocument(this.transforms);
    if (sameTransformDocument(before, after)) return;
    this.history.push(before);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.future = [];
    this.updateHistoryButtons();
  }

  restoreTransformDocument(document, notify = true) {
    this.transforms = Object.fromEntries(
      Object.entries(copyTransformDocument(document)).filter(([componentId]) => (
        this.groups.has(componentId)
      )),
    );
    const identity = createIdentityComponentTransform();
    for (const [componentId, group] of this.groups) {
      const transform = this.transforms[componentId] ?? identity;
      group.userData.workshopStoredTransform = transform;
      applyTransform(group, isOpening2d(group.userData.workshopComponent) ? identity : transform);
    }
    this.updateSelectionHelper();
    this.updateNumericFields();
    if (notify) {
      this.onChange?.(
        null,
        this.transforms[this.selectedComponentId] ?? identity,
        { reason: 'history' },
      );
    }
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    this.future.push(copyTransformDocument(this.transforms));
    this.restoreTransformDocument(previous);
    this.updateHistoryButtons();
    return true;
  }

  redo() {
    const next = this.future.pop();
    if (!next) return false;
    this.history.push(copyTransformDocument(this.transforms));
    this.restoreTransformDocument(next);
    this.updateHistoryButtons();
    return true;
  }

  pruneTransforms(definitions) {
    for (const componentId of Object.keys(this.transforms)) {
      if (!definitions.has(componentId)) delete this.transforms[componentId];
    }
  }

  createGroups(definitions) {
    for (const component of definitions.values()) {
      const group = new THREE.Group();
      group.name = `workshop-component-${component.id}`;
      group.userData.workshopComponent = component;
      group.userData.workshopPivot = new THREE.Vector3(...component.pivot);
      this.groups.set(component.id, group);
    }

    for (const component of definitions.values()) {
      const group = this.groups.get(component.id);
      const parent = component.parentId ? this.groups.get(component.parentId) : null;
      const parentPivot = parent?.userData.workshopPivot ?? new THREE.Vector3();
      group.userData.workshopBasePosition = group.userData.workshopPivot.clone().sub(parentPivot);
      if (parent) parent.add(group);
      else this.previewRoot.add(group);

      const storedTransform = this.transforms[component.id]
        ?? component.storedTransform
        ?? component.transform;
      group.userData.workshopStoredTransform = storedTransform;
      if (!isIdentityComponentTransform(storedTransform)) {
        this.transforms[component.id] = storedTransform;
      }
      applyTransform(
        group,
        isOpening2d(component) ? createIdentityComponentTransform() : storedTransform,
      );
    }
  }

  replaceParts(parts) {
    this.clear();
    const definitions = new Map();
    for (const part of parts) {
      const identity = createIdentityComponentTransform();
      const component = part.component ?? Object.freeze({
        id: 'structure-main',
        label: 'Main structure',
        kind: 'structure',
        parentId: null,
        pivot: Object.freeze([0, 0, 0]),
        transform: identity,
        storedTransform: identity,
        transformPolicy: 'free',
      });
      definitions.set(component.id, component);
    }
    this.pruneTransforms(definitions);
    this.createGroups(definitions);

    for (const part of parts) {
      const componentId = part.component?.id ?? 'structure-main';
      const group = this.groups.get(componentId);
      const mesh = new THREE.Mesh(part.geometry, part.material);
      part.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.workshopComponentId = componentId;
      group.add(mesh);
      this.meshes.push(mesh);
    }

    const ordered = [...definitions.values()].sort(componentSort);
    const groups = new Map();
    for (const component of ordered) {
      const label = component.kind === 'structure'
        ? 'Structures'
        : component.kind === 'roof'
          ? 'Roofs'
          : ['door', 'window', 'opening'].includes(component.kind)
            ? 'Openings'
            : 'Attached details';
      const optgroup = groups.get(label) ?? document.createElement('optgroup');
      optgroup.label = label;
      const option = document.createElement('option');
      option.value = component.id;
      option.textContent = component.label;
      optgroup.append(option);
      groups.set(label, optgroup);
    }
    this.select.replaceChildren(...groups.values());
    const preferred = this.selectedComponentId && this.groups.has(this.selectedComponentId)
      ? this.selectedComponentId
      : this.groups.has('structure-main') ? 'structure-main' : ordered[0]?.id;
    if (preferred) this.selectComponent(preferred);
  }

  updateSelectionHelper() {
    const group = this.groups.get(this.selectedComponentId);
    if (!group) {
      this.selectionHelper.visible = false;
      this.handleHelper.visible = false;
      return;
    }
    group.updateWorldMatrix(true, true);
    this.selectionHelper.box.setFromObject(group);
    this.selectionHelper.visible = !this.selectionHelper.box.isEmpty();
    this.updateArchitecturalHandles();
  }

  updateArchitecturalHandles() {
    const group = this.selectedGroup();
    const bounds = this.selectionHelper.box;
    if (!group || bounds.isEmpty()) {
      this.handleHelper.visible = false;
      return;
    }
    const policy = this.selectedPolicy();
    const center = bounds.getCenter(new THREE.Vector3());
    const points = [];
    const metadata = [];
    const add = (position, mode, axes, label) => {
      points.push(...position.toArray());
      metadata.push({ mode, axes, label });
    };
    add(center, 'translate', 'policy', 'Move');
    if (policy.scaleAxes.includes('x')) {
      add(new THREE.Vector3(bounds.min.x, center.y, center.z), 'scale', 'x', 'Left boundary');
      add(new THREE.Vector3(bounds.max.x, center.y, center.z), 'scale', 'x', 'Right boundary');
    }
    if (policy.scaleAxes.includes('y')) {
      add(new THREE.Vector3(center.x, bounds.min.y, center.z), 'scale', 'y', 'Lower boundary');
      add(new THREE.Vector3(center.x, bounds.max.y, center.z), 'scale', 'y', 'Upper boundary');
    }
    if (policy.scaleAxes.includes('z')) {
      add(new THREE.Vector3(center.x, center.y, bounds.min.z), 'scale', 'z', 'Rear boundary');
      add(new THREE.Vector3(center.x, center.y, bounds.max.z), 'scale', 'z', 'Front boundary');
    }
    const attribute = this.handleHelper.geometry.getAttribute('position');
    attribute.array.fill(0);
    attribute.array.set(points);
    attribute.needsUpdate = true;
    this.handleHelper.geometry.setDrawRange(0, metadata.length);
    this.handleHelper.geometry.computeBoundingSphere();
    this.handleMetadata = metadata;
    this.handleHelper.visible = metadata.length > 0;
  }

  selectComponent(componentId) {
    const group = this.groups.get(componentId);
    if (!group) return;
    this.selectedComponentId = componentId;
    this.select.value = componentId;
    this.transformControls.attach(group);
    const policy = group.userData.workshopComponent.editPolicy
      ?? getWorkshopComponentEditPolicy(group.userData.workshopComponent);
    this.space = policy.defaultSpace;
    this.spaceSelect.value = this.space;
    if (!supportsWorkshopTransformMode(policy, this.mode)) {
      this.mode = policy.translateAxes ? 'translate' : 'scale';
    }
    this.setMode(this.mode);
    this.updateSelectionHelper();
    this.updateNumericFields();
    const component = group.userData.workshopComponent;
    this.hint.textContent = `${component.label} · ${describeWorkshopEditPolicy(policy)} · Shift temporarily inverts snapping.`;
  }

  setMode(requestedMode) {
    if (!['translate', 'rotate', 'scale'].includes(requestedMode)) return this.mode;
    const policy = this.selectedPolicy();
    const mode = supportsWorkshopTransformMode(policy, requestedMode)
      ? requestedMode
      : supportsWorkshopTransformMode(policy, 'translate')
        ? 'translate'
        : 'scale';
    this.mode = mode;
    this.transformControls.setMode(mode);
    this.applyTransformSpace();
    this.applyAxisVisibility();
    this.applySnapSettings();
    this.onModeChange?.(mode);
    return mode;
  }

  setSpace(space) {
    if (!['world', 'parent', 'local'].includes(space)) return this.space;
    this.space = space;
    this.spaceSelect.value = space;
    this.applyTransformSpace();
    return this.space;
  }

  applyTransformSpace() {
    this.transformControls.setSpace(this.space === 'world' ? 'world' : 'local');
  }

  setAxisConstraint(constraint) {
    if (!['policy', 'x', 'y', 'z', 'xy', 'xz', 'yz'].includes(constraint)) {
      return this.axisConstraint;
    }
    this.axisConstraint = constraint;
    this.axisSelect.value = constraint;
    this.applyAxisVisibility();
    return this.axisConstraint;
  }

  applyAxisVisibility() {
    const policyAxes = axesForWorkshopMode(this.selectedPolicy(), this.mode);
    const requestedAxes = this.axisConstraint === 'policy' ? policyAxes : this.axisConstraint;
    const axes = [...requestedAxes].filter((axis) => policyAxes.includes(axis)).join('');
    this.transformControls.showX = axes.includes('x');
    this.transformControls.showY = axes.includes('y');
    this.transformControls.showZ = axes.includes('z');
  }

  setSnapEnabled(enabled) {
    this.snapEnabled = Boolean(enabled);
    this.snapInput.checked = this.snapEnabled;
    this.applySnapSettings();
  }

  applySnapSettings() {
    const policy = this.selectedPolicy();
    const enabled = this.snapEnabled !== this.snapInverted;
    this.transformControls.setTranslationSnap(enabled ? policy.translationSnap : null);
    this.transformControls.setRotationSnap(
      enabled ? THREE.MathUtils.degToRad(policy.rotationSnapDegrees) : null,
    );
    this.transformControls.setScaleSnap(enabled ? policy.scaleSnap : null);
  }

  snapSelectedToInferences(group, basePosition, allowedAxes) {
    const snappedAxes = new Set();
    if (this.mode !== 'translate' || this.snapEnabled === this.snapInverted) return snappedAxes;
    const parent = group.parent;
    for (const axis of allowedAxes) {
      const candidates = [basePosition[axis]];
      for (const sibling of this.groups.values()) {
        if (sibling !== group && sibling.parent === parent) candidates.push(sibling.position[axis]);
      }
      let best = null;
      let bestDistance = INFERENCE_THRESHOLD;
      for (const candidate of candidates) {
        const distance = Math.abs(group.position[axis] - candidate);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
      if (best != null) {
        group.position[axis] = best;
        snappedAxes.add(axis);
      }
    }
    return snappedAxes;
  }

  updateInferenceHelper(snappedAxes = new Set()) {
    const group = this.selectedGroup();
    if (!group || snappedAxes.size === 0) {
      this.inferenceHelper.visible = false;
      return;
    }
    const bounds = new THREE.Box3().setFromObject(group);
    if (bounds.isEmpty()) {
      this.inferenceHelper.visible = false;
      return;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const size = Math.max(3, bounds.getSize(new THREE.Vector3()).length() * 1.2);
    const positions = this.inferenceHelper.geometry.getAttribute('position');
    const lines = [];
    for (const axis of ['x', 'y', 'z']) {
      const from = center.clone();
      const to = center.clone();
      if (snappedAxes.has(axis)) {
        from[axis] -= size;
        to[axis] += size;
      }
      lines.push(...from.toArray(), ...to.toArray());
    }
    positions.array.set(lines);
    positions.needsUpdate = true;
    this.inferenceHelper.geometry.computeBoundingSphere();
    this.inferenceHelper.visible = true;
  }

  constrainSelectedTransform() {
    const group = this.groups.get(this.selectedComponentId);
    if (!group || this.transformControls.object !== group) return;
    const basePosition = group.userData.workshopBasePosition;
    const policy = this.selectedPolicy();
    group.position.x = THREE.MathUtils.clamp(
      group.position.x,
      basePosition.x - COMPONENT_POSITION_LIMIT,
      basePosition.x + COMPONENT_POSITION_LIMIT,
    );
    group.position.y = THREE.MathUtils.clamp(
      group.position.y,
      basePosition.y - COMPONENT_POSITION_LIMIT,
      basePosition.y + COMPONENT_POSITION_LIMIT,
    );
    group.position.z = THREE.MathUtils.clamp(
      group.position.z,
      basePosition.z - COMPONENT_POSITION_LIMIT,
      basePosition.z + COMPONENT_POSITION_LIMIT,
    );
    group.scale.x = THREE.MathUtils.clamp(
      Math.abs(group.scale.x),
      WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMin,
      WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMax,
    );
    group.scale.y = THREE.MathUtils.clamp(
      Math.abs(group.scale.y),
      WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMin,
      WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMax,
    );
    group.scale.z = THREE.MathUtils.clamp(
      Math.abs(group.scale.z),
      WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMin,
      WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMax,
    );

    for (const axis of ['x', 'y', 'z']) {
      if (!policy.translateAxes.includes(axis)) group.position[axis] = basePosition[axis];
      if (!policy.rotateAxes.includes(axis)) group.rotation[axis] = 0;
      if (!policy.scaleAxes.includes(axis)) group.scale[axis] = 1;
    }
    const snappedAxes = this.snapSelectedToInferences(group, basePosition, policy.translateAxes);
    this.updateInferenceHelper(snappedAxes);
  }

  commitSelectedTransform(before = copyTransformDocument(this.transforms)) {
    const group = this.groups.get(this.selectedComponentId);
    if (!group) return;
    this.constrainSelectedTransform();
    const delta = componentTransformFromGroup(group);
    const topologyDriven = isOpening2d(group.userData.workshopComponent);
    const transform = topologyDriven
      ? combineComponentTransforms(group.userData.workshopStoredTransform, delta)
      : delta;
    if (isIdentityComponentTransform(transform)) {
      delete this.transforms[this.selectedComponentId];
    } else {
      this.transforms[this.selectedComponentId] = transform;
    }
    group.userData.workshopStoredTransform = transform;
    if (topologyDriven) applyTransform(group, createIdentityComponentTransform());
    this.updateSelectionHelper();
    this.updateInferenceHelper();
    this.updateNumericFields();
    this.recordHistory(before);
    this.onChange?.(group.userData.workshopComponent, transform);
  }

  updateNumericFields() {
    const group = this.selectedGroup();
    if (!group) return;
    const component = group.userData.workshopComponent;
    const transform = isOpening2d(component)
      ? group.userData.workshopStoredTransform
      : componentTransformFromGroup(group);
    const policy = this.selectedPolicy();
    for (const field of this.valueFields) {
      const [kind, indexText] = field.dataset.transformField.split('-');
      const index = Number(indexText);
      const axis = 'xyz'[index];
      const value = kind === 'rotation'
        ? THREE.MathUtils.radToDeg(transform.rotation[index])
        : transform[kind][index];
      field.value = Number(value.toFixed(kind === 'rotation' ? 1 : 3));
      const allowedAxes = kind === 'position'
        ? policy.translateAxes
        : kind === 'rotation'
          ? policy.rotateAxes
          : policy.scaleAxes;
      field.disabled = !allowedAxes.includes(axis);
    }
  }

  commitNumericTransform() {
    const group = this.selectedGroup();
    if (!group) return;
    const before = copyTransformDocument(this.transforms);
    const values = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
    for (const field of this.valueFields) {
      const [kind, indexText] = field.dataset.transformField.split('-');
      const index = Number(indexText);
      const number = Number(field.value);
      if (!Number.isFinite(number)) {
        this.updateNumericFields();
        return;
      }
      values[kind][index] = kind === 'rotation' ? THREE.MathUtils.degToRad(number) : number;
    }
    const policy = this.selectedPolicy();
    for (let index = 0; index < 3; index += 1) {
      const axis = 'xyz'[index];
      if (!policy.translateAxes.includes(axis)) values.position[index] = 0;
      if (!policy.rotateAxes.includes(axis)) values.rotation[index] = 0;
      if (!policy.scaleAxes.includes(axis)) values.scale[index] = 1;
      values.position[index] = THREE.MathUtils.clamp(
        values.position[index],
        -COMPONENT_POSITION_LIMIT,
        COMPONENT_POSITION_LIMIT,
      );
      values.scale[index] = THREE.MathUtils.clamp(
        Math.abs(values.scale[index]),
        WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMin,
        WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMax,
      );
    }
    const transform = normalizeComponentTransform(values);
    if (isIdentityComponentTransform(transform)) delete this.transforms[this.selectedComponentId];
    else this.transforms[this.selectedComponentId] = transform;
    group.userData.workshopStoredTransform = transform;
    applyTransform(
      group,
      isOpening2d(group.userData.workshopComponent)
        ? createIdentityComponentTransform()
        : transform,
    );
    this.updateSelectionHelper();
    this.updateNumericFields();
    this.recordHistory(before);
    this.onChange?.(group.userData.workshopComponent, transform);
  }

  mirrorSelected() {
    const group = this.selectedGroup();
    if (!group) return;
    const before = copyTransformDocument(this.transforms);
    const component = group.userData.workshopComponent;
    const source = isOpening2d(component)
      ? group.userData.workshopStoredTransform
      : componentTransformFromGroup(group);
    const transform = normalizeComponentTransform({
      position: [-source.position[0], source.position[1], source.position[2]],
      rotation: [source.rotation[0], -source.rotation[1], -source.rotation[2]],
      scale: source.scale,
    });
    if (isIdentityComponentTransform(transform)) delete this.transforms[this.selectedComponentId];
    else this.transforms[this.selectedComponentId] = transform;
    group.userData.workshopStoredTransform = transform;
    applyTransform(group, isOpening2d(component) ? createIdentityComponentTransform() : transform);
    this.updateSelectionHelper();
    this.updateNumericFields();
    this.recordHistory(before);
    this.onChange?.(component, transform);
  }

  resetSelected() {
    const group = this.groups.get(this.selectedComponentId);
    if (!group) return;
    const before = copyTransformDocument(this.transforms);
    delete this.transforms[this.selectedComponentId];
    const identity = createIdentityComponentTransform();
    group.userData.workshopStoredTransform = identity;
    applyTransform(group, identity);
    this.updateSelectionHelper();
    this.updateNumericFields();
    this.recordHistory(before);
    this.onChange?.(group.userData.workshopComponent, identity);
  }

  resetAll() {
    const before = copyTransformDocument(this.transforms);
    this.transforms = {};
    const identity = createIdentityComponentTransform();
    for (const group of this.groups.values()) {
      group.userData.workshopStoredTransform = identity;
      applyTransform(group, identity);
    }
    this.updateSelectionHelper();
    this.updateNumericFields();
    this.recordHistory(before);
    this.onChange?.(null, identity, { reason: 'reset-all' });
  }

  toDocument() {
    return serializeComponentTransforms(this.transforms);
  }

  clear() {
    const attachedId = this.transformControls.object?.userData?.workshopComponent?.id;
    if (attachedId && this.groups.has(attachedId)) this.transformControls.detach();
    for (const group of this.groups.values()) {
      if (!group.userData.workshopComponent.parentId) this.previewRoot.remove(group);
    }
    this.groups.clear();
    this.meshes = [];
    this.select.replaceChildren();
    this.selectionHelper.visible = false;
    this.inferenceHelper.visible = false;
    this.handleHelper.visible = false;
    this.handleMetadata = [];
  }

  dispose() {
    this.clear();
    this.selectionRoot.remove(this.selectionHelper);
    this.selectionRoot.remove(this.inferenceHelper);
    this.selectionRoot.remove(this.handleHelper);
    this.selectionHelper.geometry.dispose();
    this.selectionHelper.material.dispose();
    this.inferenceHelper.geometry.dispose();
    this.inferenceHelper.material.dispose();
    this.handleHelper.geometry.dispose();
    this.handleHelper.material.dispose();
    this.select.removeEventListener('change', this.onSelectChange);
    this.spaceSelect.removeEventListener('change', this.onSpaceChange);
    this.axisSelect.removeEventListener('change', this.onAxisChange);
    this.snapInput.removeEventListener('change', this.onSnapChange);
    this.root.removeEventListener('click', this.onRootClick);
    this.root.removeEventListener('change', this.onValueChange);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.transformControls.removeEventListener('dragging-changed', this.onDraggingChanged);
    this.transformControls.removeEventListener('objectChange', this.onObjectChange);
    window.removeEventListener('keydown', this.onWindowKeyDown);
    window.removeEventListener('keyup', this.onWindowKeyUp);
    this.root.replaceChildren();
  }
}
