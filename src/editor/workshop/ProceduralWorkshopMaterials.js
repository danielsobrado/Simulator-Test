import * as THREE from 'three/webgpu';
import { createSurfaceTexturePixels } from '../assets/proceduralTexturePixels.js';
import { mixSeed } from './ProceduralRandom.js';
import { getSurfaceTexture } from './ProceduralWorkshopTextureConfig.js';

export const STONE_PALETTES = Object.freeze({
  granite: Object.freeze({ base: [137, 143, 146], warm: [165, 154, 136], color: '#91979a' }),
  limestone: Object.freeze({ base: [194, 180, 148], warm: [220, 202, 154], color: '#c4b794' }),
  sandstone: Object.freeze({ base: [187, 122, 78], warm: [220, 159, 98], color: '#bd8056' }),
});

export const PLASTER_PALETTES = Object.freeze({
  masonry: Object.freeze({ base: [134, 132, 121], shadow: [96, 99, 91] }),
  ochre: Object.freeze({ base: [218, 161, 61], shadow: [173, 112, 39] }),
  limewash: Object.freeze({ base: [218, 209, 177], shadow: [166, 157, 130] }),
  rose: Object.freeze({ base: [190, 116, 99], shadow: [145, 78, 70] }),
});

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function createTexture(size, pixel, { colorSpace = THREE.SRGBColorSpace } = {}) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const color = pixel(x, y);
      data[index] = clampByte(color[0]);
      data[index + 1] = clampByte(color[1]);
      data[index + 2] = clampByte(color[2]);
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function createByteTexture(data, size, colorSpace = THREE.NoColorSpace) {
  const texture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function proceduralNormalTexture(kind, seed) {
  const pixels = createSurfaceTexturePixels(kind, { size: 128, seed });
  return createByteTexture(pixels.normal, pixels.size);
}

function stoneTexture(recipe) {
  const palette = STONE_PALETTES[recipe.style];
  return createTexture(256, (x, y) => {
    const broad = (mixSeed(recipe.seed + Math.floor(y / 18), Math.floor(x / 18)) & 255) / 255;
    const grain = (mixSeed(recipe.seed + y * 131, x * 17) & 255) / 255;
    const damp = recipe.weathering * Math.max(0, 1 - y / 72);
    const value = (broad - 0.5) * 15 + (grain - 0.5) * 8 - damp * 14;
    return palette.base.map((channel, index) => (
      channel + value + (index === 1 ? damp * 4 : 0)
    ));
  });
}

function surfaceBumpTexture(seed, scale = 1) {
  return createTexture(128, (x, y) => {
    const fine = mixSeed(seed + y * 719, x * 313) & 255;
    const broad = mixSeed(seed + Math.floor(y / 5), Math.floor(x / 5)) & 255;
    const value = 112 + (fine - 127) * 0.16 * scale + (broad - 127) * 0.13 * scale;
    return [value, value, value];
  }, { colorSpace: THREE.NoColorSpace });
}

function surfaceRoughnessTexture(seed, {
  base = 220,
  variation = 24,
  broadScale = 9,
} = {}) {
  return createTexture(128, (x, y) => {
    const fine = (mixSeed(seed + y * 433, x * 271) & 255) / 255 - 0.5;
    const broad = (
      (mixSeed(
        seed + Math.floor(y / broadScale) * 97,
        Math.floor(x / broadScale) * 53,
      ) & 255) / 255 - 0.5
    );
    const value = base + fine * variation * 0.45 + broad * variation;
    return [value, value, value];
  }, { colorSpace: THREE.NoColorSpace });
}

function roofTexture(topStyle, seed) {
  const slate = topStyle === 'slate';
  const base = slate ? [86, 101, 91] : [177, 87, 51];
  return createTexture(256, (x, y) => {
    const rowHeight = 20;
    const tileWidth = 30;
    const row = Math.floor(y / rowHeight);
    const tileX = (x + (row % 2) * tileWidth / 2) % tileWidth;
    const localY = y % rowHeight;
    const seam = tileX < 2 || localY < 2;
    const lowerShade = Math.max(0, (localY - rowHeight * 0.68) / (rowHeight * 0.32)) * 10;
    const noise = ((mixSeed(seed + row, Math.floor((x + row * 11) / tileWidth)) & 255) / 255 - 0.5) * 22;
    return base.map((channel, index) => (
      channel + noise - (seam ? 30 : 0) - lowerShade + (index === 1 && slate ? 4 : 0)
    ));
  });
}

function roofBumpTexture(seed) {
  return createTexture(256, (x, y) => {
    const rowHeight = 20;
    const tileWidth = 30;
    const row = Math.floor(y / rowHeight);
    const tileX = (x + (row % 2) * tileWidth / 2) % tileWidth;
    const localY = y % rowHeight;
    const seam = tileX < 2 || localY < 2;
    const grain = (mixSeed(seed + y * 37, x * 19) & 31) - 15;
    const value = seam ? 54 : 160 + grain;
    return [value, value, value];
  }, { colorSpace: THREE.NoColorSpace });
}

function plasterTexture(recipe) {
  const palette = PLASTER_PALETTES[recipe.finish];
  return createTexture(256, (x, y) => {
    const coarse = (mixSeed(recipe.seed + Math.floor(y / 10), Math.floor(x / 10)) & 255) / 255;
    const fine = (mixSeed(recipe.seed + y * 97, x * 61) & 255) / 255;
    const age = recipe.weathering * Math.max(0, 1 - y / 100);
    const mottling = (coarse - 0.5) * 12 + (fine - 0.5) * 5;
    return palette.base.map((channel, index) => (
      channel + mottling - age * (index === 1 ? 12 : 20)
    ));
  });
}

function woodTexture(seed) {
  return createTexture(128, (x, y) => {
    const grain = Math.sin((x + Math.sin(y * 0.18) * 7) * 0.23) * 8;
    const noise = ((mixSeed(seed + y * 11, x * 5) & 255) / 255 - 0.5) * 9;
    return [105 + grain + noise, 65 + grain * 0.55 + noise, 35 + noise * 0.5];
  });
}

function configureImportedTexture(texture, selection) {
  const wrapping = selection.slot.mapping === 'mirror'
    ? THREE.MirroredRepeatWrapping
    : selection.slot.mapping === 'clamp'
      ? THREE.ClampToEdgeWrapping
      : THREE.RepeatWrapping;
  const repeat = selection.slot.mapping === 'clamp' ? 1 : selection.slot.repeat;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = wrapping;
  texture.wrapT = wrapping;
  texture.center.set(0.5, 0.5);
  texture.repeat.set(repeat, repeat);
  texture.rotation = THREE.MathUtils.degToRad(selection.slot.rotation);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createImportedAlbedoResolver(recipe) {
  if (typeof Image === 'undefined') {
    return () => null;
  }
  const loader = new THREE.TextureLoader();
  const sourceTextures = new Map();
  const sourceUses = new Map();
  return (slotKey) => {
    const selection = getSurfaceTexture(recipe.surfaceTextures, slotKey);
    if (!selection) return null;

    let baseTexture = sourceTextures.get(selection.slot.sourceId);
    if (!baseTexture) {
      baseTexture = loader.load(selection.source.dataUrl);
      baseTexture.name = `workshop-${selection.slot.sourceId}`;
      sourceTextures.set(selection.slot.sourceId, baseTexture);
    }
    const useCount = sourceUses.get(selection.slot.sourceId) ?? 0;
    const texture = useCount === 0 ? baseTexture : baseTexture.clone();
    sourceUses.set(selection.slot.sourceId, useCount + 1);
    configureImportedTexture(texture, selection);
    return Object.freeze({
      texture,
      tint: selection.slot.tint,
    });
  };
}

function tagWorkshopMaterial(material, slot) {
  material.userData.workshopSlot = slot;
  return material;
}

export function applyStoneColor(geometry, recipe, stableIndex, heightRatio = 0.5) {
  const palette = STONE_PALETTES[recipe.style];
  const tint = (mixSeed(recipe.seed, stableIndex) & 255) / 255;
  const weather = recipe.weathering * (1 - heightRatio) * 0.14;
  const colors = new Float32Array(geometry.getAttribute('position').count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    for (let channel = 0; channel < 3; channel += 1) {
      const base = palette.base[channel] / 255;
      const warm = palette.warm[channel] / 255;
      colors[index + channel] = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(base, warm, tint * 0.24) * (0.9 + tint * 0.16) - weather,
        0,
        1,
      );
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function createWorkshopMaterials(recipe) {
  const importedAlbedo = createImportedAlbedoResolver(recipe);
  const wallAlbedo = importedAlbedo('walls');
  const explicitStoneAlbedo = importedAlbedo('stone');
  const wallsAreStone = recipe.archetype !== 'manor' || recipe.finish === 'masonry';
  const stoneAlbedo = explicitStoneAlbedo ?? (wallsAreStone ? importedAlbedo('walls') : null);
  const roofAlbedo = importedAlbedo('roof');
  const woodAlbedo = importedAlbedo('wood');

  const stoneBump = surfaceBumpTexture(recipe.seed, 1);
  const roofBump = roofBumpTexture(recipe.seed);
  const plasterBump = surfaceBumpTexture(recipe.seed + 913, 0.72);
  const stoneRoughness = surfaceRoughnessTexture(recipe.seed + 101, {
    base: 226,
    variation: 26,
  });
  const mortarRoughness = surfaceRoughnessTexture(recipe.seed + 211, {
    base: 242,
    variation: 15,
    broadScale: 13,
  });
  const woodRoughness = surfaceRoughnessTexture(recipe.seed + 307, {
    base: 208,
    variation: 32,
    broadScale: 6,
  });
  const roofRoughness = surfaceRoughnessTexture(recipe.seed + 401, {
    base: recipe.topStyle === 'slate' ? 210 : 194,
    variation: 36,
    broadScale: 10,
  });
  const highQuality = recipe.detail >= 2;
  const stoneNormal = highQuality
    ? proceduralNormalTexture(
      recipe.style === 'granite' ? 'granite' : 'stoneBlock',
      recipe.seed + 503,
    )
    : null;
  const plasterNormal = highQuality
    ? proceduralNormalTexture(
      recipe.finish === 'masonry' ? 'rubble' : 'plaster',
      recipe.seed + 601,
    )
    : null;
  const woodNormal = highQuality
    ? proceduralNormalTexture('timber', recipe.seed + 701)
    : null;
  const roofNormal = highQuality
    ? proceduralNormalTexture(
      recipe.topStyle === 'terracotta' ? 'roofTile' : 'shingle',
      recipe.seed + 809,
    )
    : null;
  const stone = tagWorkshopMaterial(new THREE.MeshStandardMaterial({
    color: stoneAlbedo?.tint ?? (recipe.albedo ? '#ffffff' : STONE_PALETTES[recipe.style].color),
    map: stoneAlbedo?.texture ?? (recipe.albedo ? stoneTexture(recipe) : null),
    bumpMap: stoneBump,
    bumpScale: 0.055,
    normalMap: stoneNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: stoneRoughness,
    vertexColors: !stoneAlbedo,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.72,
  }), 'stone');
  const roof = tagWorkshopMaterial(new THREE.MeshStandardMaterial({
    color: roofAlbedo?.tint ?? '#ffffff',
    map: roofAlbedo?.texture ?? roofTexture(recipe.topStyle, recipe.seed),
    bumpMap: roofBump,
    bumpScale: 0.095,
    normalMap: roofNormal,
    normalScale: new THREE.Vector2(0.68, 0.68),
    roughnessMap: roofRoughness,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.82,
  }), 'roof');
  return Object.freeze({
    stone,
    mortar: tagWorkshopMaterial(new THREE.MeshStandardMaterial({
      color: wallAlbedo?.tint ?? (recipe.finish === 'masonry'
        ? new THREE.Color(
          STONE_PALETTES[recipe.style].base[0] / 255 * 0.66,
          STONE_PALETTES[recipe.style].base[1] / 255 * 0.66,
          STONE_PALETTES[recipe.style].base[2] / 255 * 0.66,
        )
        : '#ffffff'),
      map: wallAlbedo?.texture ?? (recipe.finish === 'masonry' ? null : plasterTexture(recipe)),
      bumpMap: plasterBump,
      bumpScale: recipe.finish === 'masonry' ? 0.025 : 0.075,
      normalMap: plasterNormal,
      normalScale: new THREE.Vector2(0.48, 0.48),
      roughnessMap: mortarRoughness,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.66,
    }), 'mortar'),
    wood: tagWorkshopMaterial(new THREE.MeshStandardMaterial({
      color: woodAlbedo?.tint ?? '#ffffff',
      map: woodAlbedo?.texture ?? woodTexture(recipe.seed),
      bumpMap: surfaceBumpTexture(recipe.seed + 317, 0.5),
      bumpScale: 0.035,
      normalMap: woodNormal,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: woodRoughness,
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.78,
    }), 'wood'),
    roof,
    metal: tagWorkshopMaterial(new THREE.MeshStandardMaterial({
      color: '#b38a35',
      roughness: 0.48,
      metalness: 0.55,
      side: THREE.DoubleSide,
    }), 'metal'),
    foliage: tagWorkshopMaterial(new THREE.MeshStandardMaterial({
      color: '#4c8a37',
      roughness: 0.9,
      metalness: 0,
    }), 'foliage'),
    recess: tagWorkshopMaterial(new THREE.MeshStandardMaterial({
      color: '#233b43',
      roughness: 0.62,
      metalness: 0.05,
      emissive: '#071216',
      emissiveIntensity: 0.18,
    }), 'recess'),
  });
}
