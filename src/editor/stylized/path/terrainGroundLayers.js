import * as THREE from 'three/webgpu';

const SIZE = 1024;
/** In GROUND_LAYERS order (groundLayerIds.js). */
const FILES = Object.freeze([
  'assets/ground/path/ground_0109_color_roughness_1k.webp',
  'assets/ground/layers/grit.webp',
  'assets/ground/layers/grass.webp',
  'assets/ground/layers/mossy.webp',
  'assets/ground/layers/litter.webp',
  'assets/ground/layers/cracked.webp',
  'assets/textures/settlement/stone-rock-color.webp',
]);

async function loadLayer(url, data, layer) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, SIZE, SIZE);
  bitmap.close();
  data.set(context.getImageData(0, 0, SIZE, SIZE).data, layer * SIZE * SIZE * 4);
}

let shared = null;

/**
 * One array texture is one binding: the terrain's fragment stage has no sampler
 * to spare (WebGPU allows 16), so every ground scan shares this one. It starts
 * neutral and fills in behind the first frame.
 */
export function acquireGroundLayers(baseUrl = import.meta.env?.BASE_URL ?? '/') {
  if (shared) return shared;
  const data = new Uint8Array(SIZE * SIZE * 4 * FILES.length).fill(148);
  const map = new THREE.DataArrayTexture(data, SIZE, SIZE, FILES.length);
  map.name = 'terrain-ground-layers';
  map.format = THREE.RGBAFormat;
  map.type = THREE.UnsignedByteType;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  // sRGB decodes the colour; alpha (the dirt's roughness) stays linear.
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;
  Promise.all(FILES.map((file, layer) => loadLayer(`${baseUrl}${file}`, data, layer)))
    .then(() => { map.needsUpdate = true; })
    .catch((error) => console.error('Ground layers failed to load.', error));
  shared = { colorRoughness: map };
  return shared;
}
