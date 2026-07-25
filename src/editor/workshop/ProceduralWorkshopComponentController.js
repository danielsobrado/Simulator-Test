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
import {
  isWorkshopArchitecturalOpening,
  solveWorkshopArchitecturalSnap,
  validateWorkshopOpeningPlacement,
} from './ProceduralWorkshopArchitecturalSnapping.js';
import {
  nextOpeningCopyId,
  serializeOpeningAttachments,
} from './ProceduralWorkshopOpeningAttachments.js';

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

function createPlacementHelper() {
  const helper = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x7de0cf,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    }),
  );
  helper.name = 'workshop-opening-placement-preview';
  helper.visible = false;
  helper.renderOrder = 1002;
  helper.raycast = () => {};
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

function sameEditDocument(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isOpening2d(component) {
  return component?.transformPolicy === 'opening2d';
}

function directMeshBounds(group) {
  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  for (const child of group?.children ?? []) {
    if (!child.isMesh || !child.geometry) continue;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (!child.geometry.boundingBox) continue;
    child.updateMatrix();
    bounds.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrix));
  }
  return bounds;
}

function openingDescriptor(group) {
  const bounds = directMeshBounds(group);
  if (bounds.isEmpty()) return null;
  const baseSize = bounds.getSize(new THREE.Vector3());
  const baseCenter = bounds.getCenter(new THREE.Vector3());
  return {
    kind: group.userData.workshopComponent.kind,
    label: group.userData.workshopComponent.label,
    position: {
      x: group.position.x + baseCenter.x * group.scale.x,
      y: group.position.y + baseCenter.y * group.scale.y,
    },
    size: {
      x: baseSize.x * Math.abs(group.scale.x),
      y: baseSize.y * Math.abs(group.scale.y),
    },
    baseSize,
    baseCenter,
  };
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
    this.openingAttachments = {};
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
    this.attachmentMode = false;
    this.attachmentPreview = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.selectionHelper = createSelectionHelper();
    this.inferenceHelper = createInferenceHelper();
    this.handleHelper = createArchitecturalHandleHelper();
    this.placementHelper = createPlacementHelper();
    this.handleMetadata = [];
    this.selectionRoot = previewRoot.parent ?? previewRoot;
    this.selectionRoot.add(this.selectionHelper);
    this.selectionRoot.add(this.inferenceHelper);
    this.selectionRoot.add(this.handleHelper);
    this.selectionRoot.add(this.placementHelper);

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
        <button type="button" data-component-action="attach" title="Place the selected opening on another compatible wall" disabled>Place on wall</button>
        <button type="button" data-component-action="duplicate" title="Duplicate the selected opening beside itself" disabled>Duplicate</button>
        <button type="button" data-component-action="repeat" title="Create a row of three evenly spaced openings" disabled>Repeat ×3</button>
        <button type="button" data-component-action="delete-opening" title="Delete a duplicated opening" disabled>Delete copy</button>
        <label class="workshop-component-snap">
          <input type="checkbox" data-role="workshop-component-snap" checked />
          Smart snap
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
      <span class="workshop-component-snap-feedback" data-role="workshop-component-snap-feedback"></span>
    `;
    this.select = root.querySelector('[data-role="workshop-component-select"]');
    this.spaceSelect = root.querySelector('[data-role="workshop-component-space"]');
    this.axisSelect = root.querySelector('[data-role="workshop-component-axis"]');
    this.snapInput = root.querySelector('[data-role="workshop-component-snap"]');
    this.valueFields = [...root.querySelectorAll('[data-transform-field]')];
    this.undoButton = root.querySelector('[data-component-action="undo"]');
    this.redoButton = root.querySelector('[data-component-action="redo"]');
    this.attachButton = root.querySelector('[data-component-action="attach"]');
    this.openingActionButtons = [...root.querySelectorAll(
      '[data-component-action="attach"], [data-component-action="duplicate"], [data-component-action="repeat"]',
    )];
    this.deleteOpeningButton = root.querySelector('[data-component-action="delete-opening"]');
    this.hint = root.querySelector('[data-role="workshop-component-hint"]');
    this.snapFeedback = root.querySelector('[data-role="workshop-component-snap-feedback"]');

    this.onSelectChange = () => this.selectComponent(this.select.value);
    this.onSpaceChange = () => this.setSpace(this.spaceSelect.value);
    this.onAxisChange = () => this.setAxisConstraint(this.axisSelect.value);
    this.onSnapChange = () => this.setSnapEnabled(this.snapInput.checked);
    this.onRootClick = (event) => {
      const action = event.target.closest('[data-component-action]')?.dataset.componentAction;
      if (action === 'undo') this.undo();
      if (action === 'redo') this.redo();
      if (action === 'mirror') this.mirrorSelected();
      if (action === 'attach') this.beginAttachmentPlacement();
      if (action === 'duplicate') this.duplicateSelectedOpening();
      if (action === 'repeat') this.repeatSelectedOpening();
      if (action === 'delete-opening') this.deleteSelectedOpening();
    };
    this.onValueChange = (event) => {
      if (event.target.matches('[data-transform-field]')) this.commitNumericTransform();
    };
    this.onPointerDown = (event) => this.pointerDown(event);
    this.onPointerMove = (event) => this.pointerMove(event);
    this.onPointerUp = (event) => this.pointerUp(event);
    this.onDraggingChanged = ({ value }) => {
      this.dragging = value;
      this.orbitControls.enabled = !value;
      if (value) {
        this.dragStartTransforms = this.captureEditState();
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
    renderer.domElement.addEventListener('pointermove', this.onPointerMove);
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

  pointerMove(event) {
    if (!this.attachmentMode || !this.setPointerRay(event)) return;
    const structureMeshes = this.meshes.filter((mesh) => {
      const group = this.groups.get(mesh.userData.workshopComponentId);
      return group?.userData?.workshopComponent?.kind === 'structure';
    });
    const hit = this.raycaster.intersectObjects(structureMeshes, false)[0];
    if (!hit) {
      this.attachmentPreview = null;
      this.placementHelper.visible = false;
      this.updateSnapFeedback([{ reason: 'Point at a compatible wall' }]);
      return;
    }
    this.updateAttachmentPreview(hit);
  }

  pointerUp(event) {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || this.dragging || event.button !== 0) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > POINTER_SELECT_DISTANCE) {
      return;
    }

    if (this.attachmentMode) {
      if (this.attachmentPreview?.valid) this.commitAttachmentPlacement();
      return;
    }
    if (!this.setPointerRay(event)) return;
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

  beginAttachmentPlacement() {
    const component = this.selectedComponent();
    if (!isWorkshopArchitecturalOpening(component)) {
      this.hint.textContent = 'Select a door, window, or arch before placing it on a wall.';
      return false;
    }
    this.attachmentMode = !this.attachmentMode;
    this.attachmentPreview = null;
    this.placementHelper.visible = false;
    this.transformControls.enabled = !this.attachmentMode;
    this.attachButton?.classList.toggle('is-active', this.attachmentMode);
    this.hint.textContent = this.attachmentMode
      ? `Place ${component.label} · point at a compatible wall, then click to attach.`
      : `${component.label} placement cancelled.`;
    this.updateSnapFeedback();
    return this.attachmentMode;
  }

  cancelAttachmentPlacement() {
    if (!this.attachmentMode) return false;
    this.attachmentMode = false;
    this.attachmentPreview = null;
    this.placementHelper.visible = false;
    this.transformControls.enabled = true;
    this.attachButton?.classList.remove('is-active');
    this.updateSnapFeedback();
    return true;
  }

  attachmentHostContext(hostGroup, selected) {
    const component = hostGroup.userData.workshopComponent;
    const localBounds = directMeshBounds(hostGroup);
    if (localBounds.isEmpty()) return null;
    const surface = component.attachmentSurface ?? {
      type: 'planar',
      width: localBounds.max.x - localBounds.min.x,
      height: localBounds.max.y - localBounds.min.y,
      radius: 0,
    };
    const wallBounds = surface.type === 'round'
      ? {
        minX: -Math.PI * surface.radius,
        maxX: Math.PI * surface.radius,
        minY: localBounds.min.y,
        maxY: localBounds.max.y,
      }
      : {
        minX: localBounds.min.x,
        maxX: localBounds.max.x,
        minY: localBounds.min.y,
        maxY: localBounds.max.y,
      };
    const siblings = [];
    for (const sibling of hostGroup.children) {
      if (sibling === this.selectedGroup()) continue;
      if (!isWorkshopArchitecturalOpening(sibling.userData?.workshopComponent)) continue;
      const descriptor = openingDescriptor(sibling);
      if (descriptor) siblings.push(descriptor);
    }
    return { component, localBounds, surface, wallBounds, siblings, selected };
  }

  updateAttachmentPreview(hit) {
    const selectedGroup = this.selectedGroup();
    const selected = openingDescriptor(selectedGroup);
    const hostGroup = this.groups.get(hit.object.userData.workshopComponentId);
    const context = selected && hostGroup
      ? this.attachmentHostContext(hostGroup, selected)
      : null;
    if (!context) {
      this.attachmentPreview = null;
      this.placementHelper.visible = false;
      return;
    }
    if (context.surface.type === 'planar' && hit.face?.normal) {
      const worldNormal = hit.face.normal.clone().applyNormalMatrix(
        new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld),
      );
      const hostQuaternion = hostGroup.getWorldQuaternion(new THREE.Quaternion()).invert();
      const hostNormal = worldNormal.applyQuaternion(hostQuaternion);
      if (hostNormal.z < 0.45) {
        this.attachmentPreview = null;
        this.placementHelper.visible = false;
        this.updateSnapFeedback([{ reason: 'Choose the highlighted front façade' }]);
        return;
      }
    }
    const localPoint = hostGroup.worldToLocal(hit.point.clone());
    const surfaceX = context.surface.type === 'round'
      ? Math.atan2(localPoint.x, localPoint.z) * context.surface.radius
      : localPoint.x;
    const result = solveWorkshopArchitecturalSnap({
      kind: selected.kind,
      mode: 'translate',
      position: { x: surfaceX, y: localPoint.y },
      size: selected.size,
      wallBounds: context.wallBounds,
      siblings: context.siblings,
      enabled: this.snapEnabled !== this.snapInverted,
      threshold: Math.max(0.16, this.selectedPolicy().translationSnap * 4),
    });
    const validation = validateWorkshopOpeningPlacement({
      position: result.position,
      size: result.size,
      wallBounds: context.wallBounds,
      siblings: context.siblings,
    });
    const localCenter = context.surface.type === 'round'
      ? new THREE.Vector3(
        Math.sin(result.position.x / context.surface.radius) * (context.surface.radius + 0.12),
        result.position.y,
        Math.cos(result.position.x / context.surface.radius) * (context.surface.radius + 0.12),
      )
      : new THREE.Vector3(
        result.position.x,
        result.position.y,
        context.localBounds.max.z + 0.12,
      );
    const worldCenter = hostGroup.localToWorld(localCenter);
    const orientation = hostGroup.getWorldQuaternion(new THREE.Quaternion());
    if (context.surface.type === 'round') {
      orientation.multiply(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        result.position.x / context.surface.radius,
      ));
    }
    this.placementHelper.position.copy(worldCenter);
    this.placementHelper.quaternion.copy(orientation);
    this.placementHelper.scale.set(result.size.x, result.size.y, 0.24);
    this.placementHelper.material.color.set(validation.valid ? 0x7de0cf : 0xef6f68);
    this.placementHelper.visible = true;
    const existing = this.openingAttachments[this.selectedComponentId];
    const stored = selectedGroup.userData.workshopStoredTransform;
    this.attachmentPreview = {
      valid: validation.valid,
      componentId: this.selectedComponentId,
      attachment: {
        sourceId: existing?.sourceId ?? this.selectedComponentId,
        hostId: context.component.id,
        position: [
          result.position.x,
          result.position.y - result.size.y / 2,
        ],
        scale: existing?.scale
          ? [...existing.scale]
          : [stored.scale[0], stored.scale[1]],
      },
    };
    this.updateSnapFeedback(validation.valid
      ? [...result.guides, { reason: `Ready on ${context.component.label}` }]
      : validation.reasons.map((reason) => ({ reason })));
  }

  commitAttachmentPlacement() {
    const preview = this.attachmentPreview;
    if (!preview?.valid) return false;
    const before = this.captureEditState();
    this.openingAttachments = {
      ...this.openingAttachments,
      [preview.componentId]: preview.attachment,
    };
    delete this.transforms[preview.componentId];
    this.attachmentMode = false;
    this.attachmentPreview = null;
    this.placementHelper.visible = false;
    this.transformControls.enabled = true;
    this.attachButton?.classList.remove('is-active');
    this.recordHistory(before);
    this.onChange?.(null, createIdentityComponentTransform(), { reason: 'attachments' });
    return true;
  }

  isEditorVisible() {
    const overlay = this.root.closest('[data-role="workshop-overlay"]');
    return !overlay?.hidden;
  }

  keyDown(event) {
    if (!this.isEditorVisible()) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    const key = event.key.toLowerCase();
    if (key === 'escape' && this.attachmentMode) {
      this.beginAttachmentPlacement();
      return;
    }
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

  captureEditState() {
    return {
      componentTransforms: copyTransformDocument(this.transforms),
      openingAttachments: serializeOpeningAttachments(this.openingAttachments),
    };
  }

  recordHistory(before) {
    if (!before) return;
    const after = this.captureEditState();
    if (sameEditDocument(before, after)) return;
    this.history.push(before);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.future = [];
    this.updateHistoryButtons();
  }

  restoreTransformDocument(document, notify = true) {
    const state = document?.componentTransforms
      ? document
      : { componentTransforms: document, openingAttachments: {} };
    this.transforms = Object.fromEntries(
      Object.entries(copyTransformDocument(state.componentTransforms)).filter(([componentId]) => (
        this.groups.has(componentId)
      )),
    );
    this.openingAttachments = serializeOpeningAttachments(state.openingAttachments);
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
    this.future.push(this.captureEditState());
    this.restoreTransformDocument(previous);
    this.updateHistoryButtons();
    return true;
  }

  redo() {
    const next = this.future.pop();
    if (!next) return false;
    this.history.push(this.captureEditState());
    this.restoreTransformDocument(next);
    this.updateHistoryButtons();
    return true;
  }

  pruneTransforms(definitions) {
    for (const componentId of Object.keys(this.transforms)) {
      if (!definitions.has(componentId)) delete this.transforms[componentId];
    }
    for (const componentId of Object.keys(this.openingAttachments)) {
      if (componentId.startsWith('copy-') && !definitions.has(componentId)) {
        delete this.openingAttachments[componentId];
      }
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
    this.updateSnapFeedback();
    const component = group.userData.workshopComponent;
    const openingSelected = isWorkshopArchitecturalOpening(component);
    for (const button of this.openingActionButtons) button.disabled = !openingSelected;
    this.deleteOpeningButton.disabled = !(
      openingSelected
      && this.selectedComponentId.startsWith('copy-')
      && this.openingAttachments[this.selectedComponentId]
    );
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
    if (!this.snapEnabled) this.updateSnapFeedback();
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

  architecturalSnapContext(group) {
    const component = group?.userData?.workshopComponent;
    const parent = group?.parent;
    if (
      !component?.editPolicy?.adaptivePlacement
      || !isWorkshopArchitecturalOpening(component)
      || !parent?.userData?.workshopComponent
    ) {
      return null;
    }
    const wallBounds = directMeshBounds(parent);
    const selected = openingDescriptor(group);
    if (wallBounds.isEmpty() || !selected) return null;
    const siblings = [];
    for (const sibling of parent.children) {
      if (sibling === group || !isWorkshopArchitecturalOpening(
        sibling.userData?.workshopComponent,
      )) {
        continue;
      }
      const descriptor = openingDescriptor(sibling);
      if (descriptor) siblings.push(descriptor);
    }
    return {
      selected,
      siblings,
      wallBounds: {
        minX: wallBounds.min.x,
        maxX: wallBounds.max.x,
        minY: wallBounds.min.y,
        maxY: wallBounds.max.y,
      },
    };
  }

  snapSelectedArchitecturally(group, policy) {
    const context = this.architecturalSnapContext(group);
    if (!context) return null;
    const enabled = this.snapEnabled !== this.snapInverted;
    const result = solveWorkshopArchitecturalSnap({
      kind: group.userData.workshopComponent.kind,
      mode: this.mode,
      position: context.selected.position,
      size: context.selected.size,
      wallBounds: context.wallBounds,
      siblings: context.siblings,
      enabled,
      threshold: Math.max(0.14, policy.translationSnap * 4),
      edgeInset: Math.max(0.04, policy.translationSnap),
      neighborGap: Math.max(0.12, policy.translationSnap * 3),
    });
    if (this.mode === 'scale') {
      for (const axis of policy.scaleAxes) {
        const baseSize = context.selected.baseSize[axis];
        if (baseSize > 0) group.scale[axis] = result.size[axis] / baseSize;
      }
    }
    group.position.x = result.position.x - context.selected.baseCenter.x * group.scale.x;
    group.position.y = result.position.y - context.selected.baseCenter.y * group.scale.y;
    return result;
  }

  updateSnapFeedback(guides = []) {
    if (!this.snapFeedback) return;
    const reasons = [...new Set(guides.map((guide) => guide.reason))];
    this.snapFeedback.textContent = reasons.length > 0
      ? `Smart snap · ${reasons.slice(0, 2).join(' · ')}`
      : '';
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
    const architectural = this.snapSelectedArchitecturally(group, policy);
    const snappedAxes = architectural
      ? new Set(architectural.guides.map((guide) => guide.axis))
      : this.snapSelectedToInferences(group, basePosition, policy.translateAxes);
    this.updateSnapFeedback(architectural?.guides);
    this.updateInferenceHelper(snappedAxes);
  }

  commitSelectedTransform(before = this.captureEditState()) {
    const group = this.groups.get(this.selectedComponentId);
    if (!group) return;
    this.constrainSelectedTransform();
    const delta = componentTransformFromGroup(group);
    const topologyDriven = isOpening2d(group.userData.workshopComponent);
    const attachment = this.openingAttachments[this.selectedComponentId];
    const transform = topologyDriven && !attachment
      ? combineComponentTransforms(group.userData.workshopStoredTransform, delta)
      : delta;
    if (attachment) {
      this.openingAttachments = {
        ...this.openingAttachments,
        [this.selectedComponentId]: {
          ...attachment,
          position: [
            THREE.MathUtils.clamp(
              attachment.position[0] + delta.position[0],
              -COMPONENT_POSITION_LIMIT,
              COMPONENT_POSITION_LIMIT,
            ),
            THREE.MathUtils.clamp(
              attachment.position[1] + delta.position[1],
              0,
              COMPONENT_POSITION_LIMIT,
            ),
          ],
          scale: [
            THREE.MathUtils.clamp(
              attachment.scale[0] * delta.scale[0],
              WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMin,
              WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMax,
            ),
            THREE.MathUtils.clamp(
              attachment.scale[1] * delta.scale[1],
              WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMin,
              WORKSHOP_COMPONENT_TRANSFORM_LIMITS.scaleMax,
            ),
          ],
        },
      };
      delete this.transforms[this.selectedComponentId];
    } else if (isIdentityComponentTransform(transform)) {
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
    const attachment = this.openingAttachments[this.selectedComponentId];
    const transform = attachment
      ? {
        position: [attachment.position[0], attachment.position[1], 0],
        rotation: [0, 0, 0],
        scale: [attachment.scale[0], attachment.scale[1], 1],
      }
      : isOpening2d(component)
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
    const before = this.captureEditState();
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
    const attachment = this.openingAttachments[this.selectedComponentId];
    if (attachment) {
      this.openingAttachments = {
        ...this.openingAttachments,
        [this.selectedComponentId]: {
          ...attachment,
          position: [transform.position[0], transform.position[1]],
          scale: [transform.scale[0], transform.scale[1]],
        },
      };
      delete this.transforms[this.selectedComponentId];
      group.userData.workshopStoredTransform = createIdentityComponentTransform();
      applyTransform(group, createIdentityComponentTransform());
      this.updateSelectionHelper();
      this.updateNumericFields();
      this.recordHistory(before);
      this.onChange?.(group.userData.workshopComponent, transform);
      return;
    }
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
    const before = this.captureEditState();
    const component = group.userData.workshopComponent;
    const attachment = this.openingAttachments[this.selectedComponentId];
    if (attachment) {
      this.openingAttachments = {
        ...this.openingAttachments,
        [this.selectedComponentId]: {
          ...attachment,
          position: [-attachment.position[0], attachment.position[1]],
        },
      };
      this.recordHistory(before);
      this.onChange?.(component, createIdentityComponentTransform());
      return;
    }
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

  createOpeningCopies(count) {
    const group = this.selectedGroup();
    const component = group?.userData?.workshopComponent;
    const context = this.architecturalSnapContext(group);
    if (!group || !isWorkshopArchitecturalOpening(component) || !context) {
      this.hint.textContent = 'Select a door, window, or arch with a compatible host wall.';
      return 0;
    }
    const before = this.captureEditState();
    const existing = this.openingAttachments[this.selectedComponentId];
    const sourceId = existing?.sourceId ?? this.selectedComponentId;
    const scale = existing?.scale
      ? [...existing.scale]
      : [
        group.userData.workshopStoredTransform.scale[0],
        group.userData.workshopStoredTransform.scale[1],
      ];
    const siblings = [...context.siblings, context.selected];
    let attachments = { ...this.openingAttachments };
    let created = 0;
    let lastId = null;
    const step = context.selected.size.x + 0.16;
    const rightRoom = context.wallBounds.maxX - context.selected.position.x;
    const leftRoom = context.selected.position.x - context.wallBounds.minX;
    const preferredDirection = rightRoom >= leftRoom ? 1 : -1;
    for (let index = 1; index <= count; index += 1) {
      let placement = null;
      for (const direction of [preferredDirection, -preferredDirection]) {
        const result = solveWorkshopArchitecturalSnap({
          kind: component.kind,
          position: {
            x: context.selected.position.x + direction * step * index,
            y: context.selected.position.y,
          },
          size: context.selected.size,
          wallBounds: context.wallBounds,
          siblings,
          enabled: true,
        });
        const validation = validateWorkshopOpeningPlacement({
          position: result.position,
          size: result.size,
          wallBounds: context.wallBounds,
          siblings,
        });
        if (validation.valid) {
          placement = result;
          break;
        }
      }
      if (!placement) continue;
      const componentId = nextOpeningCopyId(sourceId, attachments);
      attachments[componentId] = {
        sourceId,
        hostId: group.parent.userData.workshopComponent.id,
        position: [
          placement.position.x,
          placement.position.y - placement.size.y / 2,
        ],
        scale: [...scale],
      };
      siblings.push({
        kind: component.kind,
        label: `${component.label} copy`,
        position: placement.position,
        size: placement.size,
      });
      lastId = componentId;
      created += 1;
    }
    if (created === 0) {
      this.updateSnapFeedback([{ reason: 'No collision-free wall space for another opening' }]);
      return 0;
    }
    this.openingAttachments = attachments;
    this.selectedComponentId = lastId;
    this.recordHistory(before);
    this.onChange?.(null, createIdentityComponentTransform(), { reason: 'attachments' });
    return created;
  }

  duplicateSelectedOpening() {
    return this.createOpeningCopies(1);
  }

  repeatSelectedOpening() {
    return this.createOpeningCopies(2);
  }

  deleteSelectedOpening() {
    if (
      !this.selectedComponentId?.startsWith('copy-')
      || !this.openingAttachments[this.selectedComponentId]
    ) {
      return false;
    }
    const before = this.captureEditState();
    const next = { ...this.openingAttachments };
    delete next[this.selectedComponentId];
    this.openingAttachments = next;
    delete this.transforms[this.selectedComponentId];
    this.recordHistory(before);
    this.onChange?.(null, createIdentityComponentTransform(), { reason: 'attachments' });
    return true;
  }

  resetSelected() {
    const group = this.groups.get(this.selectedComponentId);
    if (!group) return;
    const before = this.captureEditState();
    delete this.transforms[this.selectedComponentId];
    if (this.openingAttachments[this.selectedComponentId]) {
      const next = { ...this.openingAttachments };
      delete next[this.selectedComponentId];
      this.openingAttachments = next;
    }
    const identity = createIdentityComponentTransform();
    group.userData.workshopStoredTransform = identity;
    applyTransform(group, identity);
    this.updateSelectionHelper();
    this.updateNumericFields();
    this.recordHistory(before);
    this.onChange?.(group.userData.workshopComponent, identity);
  }

  resetAll() {
    const before = this.captureEditState();
    this.transforms = {};
    this.openingAttachments = {};
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

  toOpeningAttachmentsDocument() {
    return serializeOpeningAttachments(this.openingAttachments);
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
    this.placementHelper.visible = false;
    this.handleMetadata = [];
    this.attachmentMode = false;
    this.attachmentPreview = null;
    this.transformControls.enabled = true;
    this.attachButton?.classList.remove('is-active');
    this.updateSnapFeedback();
  }

  dispose() {
    this.clear();
    this.selectionRoot.remove(this.selectionHelper);
    this.selectionRoot.remove(this.inferenceHelper);
    this.selectionRoot.remove(this.handleHelper);
    this.selectionRoot.remove(this.placementHelper);
    this.selectionHelper.geometry.dispose();
    this.selectionHelper.material.dispose();
    this.inferenceHelper.geometry.dispose();
    this.inferenceHelper.material.dispose();
    this.handleHelper.geometry.dispose();
    this.handleHelper.material.dispose();
    this.placementHelper.geometry.dispose();
    this.placementHelper.material.dispose();
    this.select.removeEventListener('change', this.onSelectChange);
    this.spaceSelect.removeEventListener('change', this.onSpaceChange);
    this.axisSelect.removeEventListener('change', this.onAxisChange);
    this.snapInput.removeEventListener('change', this.onSnapChange);
    this.root.removeEventListener('click', this.onRootClick);
    this.root.removeEventListener('change', this.onValueChange);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.transformControls.removeEventListener('dragging-changed', this.onDraggingChanged);
    this.transformControls.removeEventListener('objectChange', this.onObjectChange);
    window.removeEventListener('keydown', this.onWindowKeyDown);
    window.removeEventListener('keyup', this.onWindowKeyUp);
    this.root.replaceChildren();
  }
}
