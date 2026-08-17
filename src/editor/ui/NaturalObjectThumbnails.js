import './NaturalObjectThumbnails.css';
import * as THREE from 'three';
import { OBJECT_BY_KEY } from '../objectCatalog.js';
import { createObjectModelParts } from '../ObjectModelLibrary.js';

const PREVIEW_WIDTH = 128;
const PREVIEW_HEIGHT = 92;
const PREVIEW_TILE_SIZE = 1;
const CAMERA_FOV = 28;
const CAMERA_PADDING = 1.34;

function idle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(callback, { timeout: 160 });
    return;
  }
  setTimeout(() => callback({ timeRemaining: () => 8 }), 16);
}

function createPreviewRenderer() {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(1.5, globalThis.devicePixelRatio ?? 1));
  renderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

function createPreviewScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf4ead5, 0x58685f, 2.1));
  const key = new THREE.DirectionalLight(0xffe5bb, 2.4);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb9d5e4, 0.72);
  fill.position.set(-4, 2, -3);
  scene.add(fill);
  return scene;
}

function createPreviewGroup(definition) {
  const group = new THREE.Group();
  const geometries = [];
  for (const part of createObjectModelParts(definition, PREVIEW_TILE_SIZE)) {
    geometries.push(part.geometry);
    const mesh = new THREE.Mesh(part.geometry, part.material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(part.matrix);
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const center = bounds.getCenter(new THREE.Vector3());
  group.position.sub(center);
  group.updateMatrixWorld(true);
  return { group, geometries, bounds: new THREE.Box3().setFromObject(group) };
}

function frameCamera(camera, bounds) {
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.25) * 0.5;
  const distance = radius / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5)) * CAMERA_PADDING;
  camera.position.set(distance * 0.82, distance * 0.62, distance);
  camera.near = Math.max(0.01, distance * 0.02);
  camera.far = distance * 6;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

function previewDataUrl(renderer, scene, camera, definition) {
  const { group, geometries, bounds } = createPreviewGroup(definition);
  scene.add(group);
  try {
    frameCamera(camera, bounds);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/webp', 0.86);
  } finally {
    scene.remove(group);
    for (const geometry of geometries) geometry.dispose();
  }
}

class NaturalObjectThumbnails {
  constructor(root) {
    this.root = root;
    this.panel = root.querySelector('[data-panel="object"]');
    this.palette = root.querySelector('[data-role="object-palette"]');
    this.cache = new Map();
    this.pending = [...OBJECT_BY_KEY.keys()];
    this.renderer = null;
    this.scene = null;
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.01, 100);
    this.started = false;
    this.failed = false;

    this.paletteObserver = new MutationObserver(() => this.applyCached());
    this.paletteObserver.observe(this.palette, { childList: true, subtree: true });
    this.panelObserver = new MutationObserver(() => this.startIfVisible());
    this.panelObserver.observe(this.panel, { attributes: true, attributeFilter: ['hidden'] });
    this.startIfVisible();
  }

  startIfVisible() {
    if (this.started || this.failed || this.panel.hidden) return;
    this.started = true;
    idle(() => this.renderNext());
  }

  ensureRenderer() {
    if (this.renderer) return true;
    try {
      this.renderer = createPreviewRenderer();
      this.scene = createPreviewScene();
      return true;
    } catch (error) {
      this.failed = true;
      console.warn('Object thumbnails disabled: preview renderer unavailable.', error);
      return false;
    }
  }

  renderNext() {
    if (!this.ensureRenderer()) return;
    const key = this.pending.shift();
    if (!key) {
      this.disposeRenderer();
      return;
    }
    const definition = OBJECT_BY_KEY.get(key);
    if (definition) {
      try {
        this.cache.set(key, previewDataUrl(this.renderer, this.scene, this.camera, definition));
        this.applyCachedKey(key);
      } catch (error) {
        console.warn(`Object thumbnail failed for ${key}.`, error);
      }
    }
    idle(() => this.renderNext());
  }

  applyCached() {
    for (const key of this.cache.keys()) this.applyCachedKey(key);
  }

  applyCachedKey(key) {
    const url = this.cache.get(key);
    if (!url) return;
    for (const card of this.palette.querySelectorAll(`.object-card[data-object-key="${CSS.escape(key)}"]`)) {
      if (card.querySelector('.natural-object-thumbnail')) continue;
      const image = document.createElement('img');
      image.className = 'natural-object-thumbnail';
      image.alt = '';
      image.decoding = 'async';
      image.draggable = false;
      image.src = url;
      card.prepend(image);
      card.classList.add('has-natural-thumbnail');
    }
  }

  disposeRenderer() {
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
    this.renderer = null;
    this.scene = null;
  }
}

function installWhenReady() {
  const root = document.querySelector('#app');
  const palette = root?.querySelector('[data-panel="object"] [data-role="object-palette"]');
  if (!palette || !root.querySelector('.natural-toolbar')) return false;
  if (root.dataset.naturalObjectThumbnails === 'true') return true;
  root.dataset.naturalObjectThumbnails = 'true';
  new NaturalObjectThumbnails(root);
  return true;
}

if (!installWhenReady()) {
  const observer = new MutationObserver(() => {
    if (installWhenReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
