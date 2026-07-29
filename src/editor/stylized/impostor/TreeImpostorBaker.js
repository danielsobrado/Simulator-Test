import * as THREE from 'three/webgpu';
import {
  float,
  normalView,
} from 'three/tsl';
import { authoredTexture } from '../AuthoredTextureNode.js';
import { createDilatedAtlasTile } from './TreeImpostorAtlasPixels.js';
import { createCaptureDirections } from './impostorFrame.js';
import { TREE_IMPOSTOR_NORMAL_ENCODING } from './TreeImpostorManifest.js';

export { createDilatedAtlasTile as createDilatedTile } from './TreeImpostorAtlasPixels.js';

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function unionBounds(parts) {
  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox);
  }
  return bounds;
}

export function createTreeImpostorBakeMaterial(part, normalPass) {
  const sourceMap = part.sourceMap ?? null;
  if (normalPass) {
    const material = new THREE.MeshBasicNodeMaterial({
      side: part.kind === 'leaf' ? THREE.DoubleSide : THREE.FrontSide,
    });
    const foliageMask = float(part.kind === 'leaf' ? 1 : 0);
    material.colorNode = normalView.mul(0.5).add(0.5);
    material.opacityNode = foliageMask;
    // NodeMaterial forces alpha to 1 for opaque NormalBlending materials.
    // NoBlending keeps depth writes and RGB normals intact while preserving
    // opacityNode as the foliage classification in render-target alpha.
    material.blending = THREE.NoBlending;
    if (sourceMap) {
      // Leave the UV node implicit so TextureNode applies KHR_texture_transform.
      // gltfpack rescales foliage UVs and stores the inverse transform on the
      // texture; sampling raw `uv()` makes the entire leaf card transparent.
      const alphaCutoff = part.material.alphaTest > 0
        ? part.material.alphaTest
        : 0.5;
      material.maskNode = authoredTexture(sourceMap).a.greaterThan(alphaCutoff);
    }
    material.transparent = false;
    material.depthWrite = true;
    return material;
  }

  const material = new THREE.MeshBasicNodeMaterial({
    side: part.kind === 'leaf' ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.colorNode = part.material.colorNode;
  material.opacityNode = part.material.opacityNode ?? null;
  material.alphaTest = part.material.alphaTest ?? (sourceMap ? 0.5 : 0);
  material.transparent = false;
  material.depthWrite = true;
  return material;
}

function createBakeGeometry(sourceGeometry) {
  const cloned = sourceGeometry.clone();
  if (!cloned.index) return cloned;
  const nonIndexed = cloned.toNonIndexed();
  cloned.dispose();
  nonIndexed.computeBoundingBox();
  nonIndexed.computeBoundingSphere();
  return nonIndexed;
}

function createPrototypeScene(parts, normalPass) {
  const scene = new THREE.Scene();
  for (const part of parts) {
    const mesh = new THREE.Mesh(
      createBakeGeometry(part.geometry),
      createTreeImpostorBakeMaterial(part, normalPass),
    );
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  return scene;
}

function disposeSceneResources(scene) {
  scene.traverse((node) => {
    node.geometry?.dispose?.();
    node.material?.dispose?.();
  });
}

async function renderScene(renderer, scene, camera) {
  if (typeof renderer.renderAsync === 'function') {
    await renderer.renderAsync(scene, camera);
    return;
  }
  const result = renderer.render(scene, camera);
  if (result && typeof result.then === 'function') await result;
}

function writeTile(context, data, tileSize, column, row) {
  context.putImageData(new ImageData(data, tileSize, tileSize), column * tileSize, row * tileSize);
}

function configureAtlasTexture(canvas, colorSpace) {
  const textureValue = new THREE.CanvasTexture(canvas);
  textureValue.colorSpace = colorSpace;
  textureValue.magFilter = THREE.LinearFilter;
  textureValue.minFilter = THREE.LinearMipmapLinearFilter;
  textureValue.generateMipmaps = true;
  textureValue.wrapS = THREE.ClampToEdgeWrapping;
  textureValue.wrapT = THREE.ClampToEdgeWrapping;
  textureValue.needsUpdate = true;
  return textureValue;
}

export class TreeImpostorBaker {
  constructor({ renderer, config, rendererFactory = null }) {
    this.sourceRenderer = renderer;
    this.config = config;
    this.rendererFactory = rendererFactory;
  }

  async createBakeRenderer() {
    if (this.rendererFactory) return this.rendererFactory();
    const renderer = new THREE.WebGPURenderer({
      antialias: false,
      forceWebGL: Boolean(
        this.sourceRenderer?.backend
        && !this.sourceRenderer.backend.isWebGPUBackend,
      ),
    });
    await renderer.init();
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return renderer;
  }

  async bake(prototypes) {
    const settings = this.config.lod.impostor;
    const renderer = await this.createBakeRenderer();
    const atlases = [];
    try {
      for (let prototypeIndex = 0; prototypeIndex < prototypes.length; prototypeIndex += 1) {
        console.info(`[tree-impostor-bake] Baking prototype ${prototypeIndex + 1}/${prototypes.length}.`);
        atlases.push(await this.bakePrototype(
          prototypes[prototypeIndex],
          prototypeIndex,
          settings,
          renderer,
        ));
      }
      return Object.freeze(atlases);
    } finally {
      renderer.dispose();
    }
  }

  async bakePrototype(parts, prototypeIndex, settings, renderer) {
    const bounds = unionBounds(parts);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(0.1, size.length() * 0.5);
    const gutter = settings.gutter ?? 4;
    const renderSize = settings.tileSize - gutter * 2;
    const atlasWidth = settings.columns * settings.tileSize;
    const atlasHeight = settings.rows * settings.tileSize;
    const albedoCanvas = createCanvas(atlasWidth, atlasHeight);
    const normalCanvas = createCanvas(atlasWidth, atlasHeight);
    const albedoContext = albedoCanvas.getContext('2d', { alpha: true });
    const normalContext = normalCanvas.getContext('2d', { alpha: true });
    if (!albedoContext || !normalContext) {
      throw new Error('Tree impostor baking requires a 2D canvas context.');
    }
    albedoContext.clearRect(0, 0, atlasWidth, atlasHeight);
    normalContext.clearRect(0, 0, atlasWidth, atlasHeight);

    const target = new THREE.RenderTarget(renderSize, renderSize, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 6);
    const directions = createCaptureDirections(settings);
    const albedoScene = createPrototypeScene(parts, false);
    const normalScene = createPrototypeScene(parts, true);
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = new THREE.Color();
    renderer.getClearColor?.(previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha?.() ?? 1;

    try {
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);
      for (let directionIndex = 0; directionIndex < directions.length; directionIndex += 1) {
        const direction = directions[directionIndex];
        console.info(
          `[tree-impostor-bake] Prototype ${prototypeIndex + 1}, frame ${directionIndex + 1}/${directions.length}.`,
        );
        camera.position.set(
          center.x + direction.x * radius * 2.5,
          center.y + direction.y * radius * 2.5,
          center.z + direction.z * radius * 2.5,
        );
        camera.lookAt(center);
        camera.updateMatrixWorld(true);

        renderer.setRenderTarget(target);
        renderer.clear();
        await renderScene(renderer, albedoScene, camera);
        const albedoPixels = await renderer.readRenderTargetPixelsAsync(
          target,
          0,
          0,
          renderSize,
          renderSize,
        );
        writeTile(
          albedoContext,
          createDilatedAtlasTile(
            albedoPixels,
            renderSize,
            settings.tileSize,
            gutter,
          ),
          settings.tileSize,
          direction.column,
          direction.row,
        );

        renderer.setRenderTarget(target);
        renderer.clear();
        await renderScene(renderer, normalScene, camera);
        const normalPixels = await renderer.readRenderTargetPixelsAsync(
          target,
          0,
          0,
          renderSize,
          renderSize,
        );
        writeTile(
          normalContext,
          createDilatedAtlasTile(
            normalPixels,
            renderSize,
            settings.tileSize,
            gutter,
            {
              coveragePixels: albedoPixels,
              alphaPixels: normalPixels,
            },
          ),
          settings.tileSize,
          direction.column,
          direction.row,
        );
      }
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      target.dispose();
      disposeSceneResources(albedoScene);
      disposeSceneResources(normalScene);
    }

    return Object.freeze({
      prototypeIndex,
      columns: settings.columns,
      rows: settings.rows,
      tileSize: settings.tileSize,
      gutter,
      lowElevationDegrees: settings.lowElevationDegrees,
      highElevationDegrees: settings.highElevationDegrees,
      width: radius * 2,
      height: radius * 2,
      depth: Math.max(0.1, size.z),
      centerY: center.y,
      radius,
      normalEncoding: TREE_IMPOSTOR_NORMAL_ENCODING,
      albedoCanvas,
      normalCanvas,
      albedo: configureAtlasTexture(albedoCanvas, THREE.SRGBColorSpace),
      normal: configureAtlasTexture(normalCanvas, THREE.NoColorSpace),
      source: 'runtime-bake',
    });
  }
}
