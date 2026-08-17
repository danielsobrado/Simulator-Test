import './NaturalObjectThumbnails.css';
import * as THREE from 'three';
import { OBJECT_BY_KEY } from '../objectCatalog.js';
import { createObjectModelParts } from '../ObjectModelLibrary.js';
import { NATURAL_EDITOR_UI_CONFIG } from './NaturalEditorUiConfig.generated.js';

const CONFIG = NATURAL_EDITOR_UI_CONFIG.thumbnails;
const PREVIEW_TILE_SIZE = 1;
const THUMBNAIL_MIME_TYPE = 'image/webp';

function idle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(callback, { timeout: CONFIG.idleTimeoutMs });
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
  renderer.setSize(CONFIG.width, CONFIG.height, false);
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
  const distance = radius
    / Math.tan(THREE.MathUtils.degToRad(CONFIG.cameraFov * 0.5))
    * CONFIG.cameraPadding;
  camera.position.set(distance * 0.82, distance * 0.62, distance);
  camera.near = Math.max(0.01, distance * 0.02);
  camera.far = distance * 6;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

function canvasImageUrl(canvas) {
  if (typeof canvas.toBlob !== 'function') {
    return Promise.resolve(canvas.toDataURL(THUMBNAIL_MIME_TYPE, CONFIG.quality));
  }
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob
        ? URL.createObjectURL(blob)
        : canvas.toDataURL(THUMBNAIL_MIME_TYPE, CONFIG.quality));
    }, THUMBNAIL_MIME_TYPE, CONFIG.quality);
  });
}

function releaseImageUrl(url) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}

async function previewImageUrl(renderer, scene, camera, definition) {
  const { group, geometries, bounds } = createPreviewGroup(definition);
  scene.add(group);
  try {
    frameCamera(camera, bounds);
    renderer.render(scene, camera);
    return await canvasImageUrl(renderer.domElement);
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
    this.queue = [];
    this.queued = new Set();
    this.wanted = new Set();
    this.observedCards = new WeakSet();
    this.renderer = null;
    this.scene = null;
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.cameraFov,
      CONFIG.width / CONFIG.height,
      0.01,
      100,
    );
    this.renderScheduled = false;
    this.rendering = false;
    this.disposeTimer = null;
    this.failed = false;
    this.disposed = false;

    this.intersectionObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
        (entries) => this.onIntersection(entries),
        { rootMargin: `${CONFIG.rootMarginPx}px 0px` },
      )
      : null;
    this.paletteObserver = new MutationObserver(() => this.observeCards());
    this.paletteObserver.observe(this.palette, { childList: true, subtree: true });
    this.panelObserver = new MutationObserver(() => this.onPanelVisibility());
    this.panelObserver.observe(this.panel, { attributes: true, attributeFilter: ['hidden'] });
    this.pagehideHandler = () => this.dispose();
    globalThis.addEventListener?.('pagehide', this.pagehideHandler, { once: true });
    this.observeCards();
    this.onPanelVisibility();
  }

  onPanelVisibility() {
    if (this.disposed) return;
    if (this.panel.hidden) {
      this.scheduleRendererDisposal();
      return;
    }
    this.observeCards();
    if (this.queue.length > 0) this.scheduleRender();
    if (!this.intersectionObserver) {
      const cards = [...this.palette.querySelectorAll('.object-card[data-object-key]')]
        .slice(0, CONFIG.fallbackVisibleCards);
      for (const card of cards) {
        this.wanted.add(card.dataset.objectKey);
        this.enqueue(card.dataset.objectKey);
      }
    }
  }

  observeCards() {
    if (this.disposed) return;
    for (const card of this.palette.querySelectorAll('.object-card[data-object-key]')) {
      const key = card.dataset.objectKey;
      const cached = this.cache.get(key);
      if (cached) this.applyToCard(card, cached);
      if (this.observedCards.has(card)) continue;
      this.observedCards.add(card);
      this.intersectionObserver?.observe(card);
    }
  }

  onIntersection(entries) {
    for (const entry of entries) {
      const key = entry.target.dataset.objectKey;
      if (!key) continue;
      if (!entry.isIntersecting || this.panel.hidden) {
        this.wanted.delete(key);
        continue;
      }
      this.wanted.add(key);
      this.enqueue(key);
    }
  }

  enqueue(key) {
    if (this.disposed || this.failed || !OBJECT_BY_KEY.has(key)) return;
    const cached = this.cache.get(key);
    if (cached) {
      this.touchCache(key, cached);
      this.applyCachedKey(key);
      return;
    }
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push(key);
    if (!this.panel.hidden) this.scheduleRender();
  }

  scheduleRender() {
    if (
      this.renderScheduled
      || this.rendering
      || this.disposed
      || this.failed
      || this.panel.hidden
    ) return;
    this.renderScheduled = true;
    idle(() => {
      this.renderScheduled = false;
      void this.renderNext();
    });
  }

  nextWantedKey() {
    while (this.queue.length > 0) {
      const key = this.queue.shift();
      this.queued.delete(key);
      if (!this.intersectionObserver || this.wanted.has(key)) return key;
    }
    return null;
  }

  ensureRenderer() {
    if (this.renderer) return true;
    if (this.failed || this.disposed) return false;
    let renderer = null;
    try {
      renderer = createPreviewRenderer();
      this.renderer = renderer;
      this.scene = createPreviewScene();
      return true;
    } catch (error) {
      renderer?.dispose();
      renderer?.forceContextLoss?.();
      this.failed = true;
      console.warn('Object thumbnails disabled: preview renderer unavailable.', error);
      return false;
    }
  }

  async renderNext() {
    if (this.rendering || this.disposed || this.panel.hidden) {
      this.scheduleRendererDisposal();
      return;
    }
    const key = this.nextWantedKey();
    if (!key) {
      this.scheduleRendererDisposal();
      return;
    }
    if (!this.ensureRenderer()) return;

    this.rendering = true;
    try {
      const definition = OBJECT_BY_KEY.get(key);
      if (definition && !this.cache.has(key)) {
        const url = await previewImageUrl(this.renderer, this.scene, this.camera, definition);
        const stillWanted = !this.intersectionObserver || this.wanted.has(key);
        if (this.disposed || this.panel.hidden || !stillWanted) {
          releaseImageUrl(url);
        } else {
          this.setCache(key, url);
          this.applyCachedKey(key);
        }
      }
    } catch (error) {
      console.warn(`Object thumbnail failed for ${key}.`, error);
    } finally {
      this.rendering = false;
      if (!this.disposed && !this.panel.hidden && this.queue.length > 0) {
        this.scheduleRender();
      } else {
        this.scheduleRendererDisposal();
      }
    }
  }

  setCache(key, url) {
    const previous = this.cache.get(key);
    if (previous && previous !== url) releaseImageUrl(previous);
    this.cache.delete(key);
    this.cache.set(key, url);
    while (this.cache.size > CONFIG.maxMemoryEntries) {
      const oldest = this.cache.keys().next().value;
      this.evict(oldest);
    }
  }

  touchCache(key, url) {
    this.cache.delete(key);
    this.cache.set(key, url);
  }

  evict(key) {
    const url = this.cache.get(key);
    if (!url) return;
    this.cache.delete(key);
    for (const card of this.palette.querySelectorAll(
      `.object-card[data-object-key="${CSS.escape(key)}"]`,
    )) {
      card.querySelector('.natural-object-thumbnail')?.remove();
      card.classList.remove('has-natural-thumbnail');
    }
    releaseImageUrl(url);
  }

  applyCachedKey(key) {
    const url = this.cache.get(key);
    if (!url) return;
    for (const card of this.palette.querySelectorAll(
      `.object-card[data-object-key="${CSS.escape(key)}"]`,
    )) {
      this.applyToCard(card, url);
    }
  }

  applyToCard(card, url) {
    let image = card.querySelector('.natural-object-thumbnail');
    if (!image) {
      image = document.createElement('img');
      image.className = 'natural-object-thumbnail';
      image.alt = '';
      image.decoding = 'async';
      image.draggable = false;
      card.prepend(image);
    }
    if (image.src !== url) image.src = url;
    card.classList.add('has-natural-thumbnail');
  }

  scheduleRendererDisposal() {
    clearTimeout(this.disposeTimer);
    if (!this.renderer || this.rendering) return;
    this.disposeTimer = setTimeout(() => this.disposeRenderer(), CONFIG.idleDisposeMs);
  }

  disposeRenderer() {
    if (this.rendering) return;
    clearTimeout(this.disposeTimer);
    this.disposeTimer = null;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss?.();
    this.renderer = null;
    this.scene = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.paletteObserver.disconnect();
    this.panelObserver.disconnect();
    this.intersectionObserver?.disconnect();
    this.queue.length = 0;
    this.queued.clear();
    this.wanted.clear();
    for (const url of this.cache.values()) releaseImageUrl(url);
    this.cache.clear();
    this.disposeRenderer();
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
