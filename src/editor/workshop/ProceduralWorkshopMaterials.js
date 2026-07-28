import * as THREE from 'three/webgpu';
import { createSurfaceTexturePixels } from '../assets/proceduralTexturePixels.js';
import { mixSeed } from './ProceduralRandom.js';
import { getSurfaceTexture } from './ProceduralWorkshopTextureConfig.js';

/**
 * `base`/`warm`/`color` drive the shared material colour and mortar tint.
 *
 * `ramp` and `outlier` drive per-stone vertex colour. Each ramp is centred on
 * `base` and stays inside one stone family, with a rare desaturated `outlier`
 * so a few blocks read as distinctly different stone. This is the "stable
 * per-stone tint" layer of 05-…md §8, deliberately narrow: the section warns
 * that strong uncoordinated variation makes a wall unreadable.
 */

function hexToRgb(hex) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [
    (value >> 16) & 255,
    (value >> 8) & 255,
    value & 255,
  ];
}

function assertRgbTriple(channels, label) {
  if (!Array.isArray(channels) || channels.length !== 3) {
    throw new Error(`${label} must contain exactly three channels.`);
  }
  for (let index = 0; index < 3; index += 1) {
    const channel = channels[index];
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new Error(`${label}[${index}] must be an integer 0–255, got ${channel}.`);
    }
  }
}

/**
 * Freeze a complete stone palette after validating nested colour data.
 * Exported for unit tests that assert invalid descriptors fail.
 */
export function defineStonePalette(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('Stone palette descriptor is required.');
  }
  assertRgbTriple(input.base, 'base');
  assertRgbTriple(input.warm, 'warm');
  if (!Array.isArray(input.ramp) || input.ramp.length < 2 || input.ramp.length > 8) {
    throw new Error('ramp must contain between 2 and 8 colour stops.');
  }
  for (let index = 0; index < input.ramp.length; index += 1) {
    assertRgbTriple(input.ramp[index], `ramp[${index}]`);
  }
  if (input.outlier != null) assertRgbTriple(input.outlier, 'outlier');
  if (typeof input.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input.color)) {
    throw new Error('color must be a six-digit hex colour.');
  }
  const chance = input.outlierChance ?? 0;
  if (!Number.isFinite(chance) || chance < 0 || chance > 1) {
    throw new Error(`outlierChance must be between 0 and 1, got ${chance}.`);
  }
  const declared = hexToRgb(input.color);
  for (let index = 0; index < 3; index += 1) {
    if (Math.abs(declared[index] - input.base[index]) > 1) {
      throw new Error(
        `color ${input.color} does not match base [${input.base.join(', ')}].`,
      );
    }
  }

  return Object.freeze({
    base: Object.freeze([...input.base]),
    warm: Object.freeze([...input.warm]),
    color: input.color,
    ramp: Object.freeze(input.ramp.map((stop) => Object.freeze([...stop]))),
    outlier: input.outlier ? Object.freeze([...input.outlier]) : null,
    outlierChance: chance,
  });
}

export const STONE_PALETTES = Object.freeze({
  granite: defineStonePalette({
    base: [137, 143, 146],
    warm: [165, 154, 136],
    color: '#91979a',
    ramp: [
      [137, 143, 146], [152, 150, 141], [124, 130, 134], [143, 148, 138],
    ],
    outlier: [110, 116, 112],
    outlierChance: 0.1,
  }),
  limestone: defineStonePalette({
    base: [194, 180, 148],
    warm: [220, 202, 154],
    color: '#c4b794',
    ramp: [
      [194, 180, 148], [214, 198, 156], [178, 166, 140], [196, 188, 160],
    ],
    outlier: [162, 158, 132],
    outlierChance: 0.1,
  }),
  /**
   * Pale, low-saturation limestone for `soft-limestone-rubble`. Kept separate
   * from `limestone` so existing workshop assets and walls stay warm yellow.
   */
  'soft-limestone': defineStonePalette({
    base: [188, 186, 176],
    warm: [198, 194, 181],
    color: '#bcbab0',
    ramp: [
      [188, 186, 176],
      [196, 193, 181],
      [180, 181, 175],
      [191, 189, 180],
    ],
    outlier: [166, 168, 164],
    outlierChance: 0.045,
  }),
  sandstone: defineStonePalette({
    base: [187, 122, 78],
    warm: [220, 159, 98],
    color: '#bd8056',
    ramp: [
      [187, 122, 78], [214, 155, 96], [170, 110, 72], [192, 140, 96],
    ],
    outlier: [150, 132, 96],
    outlierChance: 0.12,
  }),
});

/**
 * Per-tile roof colour ramps. Before 2026-07-25 the roof material carried no
 * vertex colours at all, so every tile was one flat hue and the geometry could
 * not read as separate tiles.
 */
export const ROOF_PALETTES = Object.freeze({
  terracotta: Object.freeze({
    ramp: Object.freeze([
      [188, 96, 58], [208, 120, 68], [166, 82, 52], [198, 142, 88],
    ]),
    outlier: [128, 132, 88],
    outlierChance: 0.14,
  }),
  slate: Object.freeze({
    ramp: Object.freeze([
      [92, 104, 96], [78, 88, 86], [108, 116, 104], [86, 96, 110],
    ]),
    outlier: [120, 112, 96],
    outlierChance: 0.12,
  }),
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

// Exported so live constructions can build the same stone surface rather than
// approximating it. A wall and a workshop building of nominally the same stone
// have to match, and the cheapest way to guarantee that is one implementation.
export function proceduralNormalTexture(kind, seed) {
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

export function surfaceBumpTexture(seed, scale = 1) {
  return createTexture(128, (x, y) => {
    const fine = mixSeed(seed + y * 719, x * 313) & 255;
    const broad = mixSeed(seed + Math.floor(y / 5), Math.floor(x / 5)) & 255;
    const value = 112 + (fine - 127) * 0.16 * scale + (broad - 127) * 0.13 * scale;
    return [value, value, value];
  }, { colorSpace: THREE.NoColorSpace });
}

export function surfaceRoughnessTexture(seed, {
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

const IMPORTED_ALBEDO_CACHE = new WeakMap();

/**
 * Whether a material family will be painted by an imported albedo image.
 *
 * Mirrors the slot resolution inside `createWorkshopMaterials` exactly,
 * including its `typeof Image` guard, so a generator writing vertex colours and
 * the material consuming them can never disagree — in headless runs neither
 * sees an import.
 *
 * Memoized per recipe: recipes are frozen and stable for one generation pass,
 * and this is consulted once per masonry unit.
 */
export function hasImportedAlbedoFamily(recipe, family) {
  if (typeof Image === 'undefined') return false;
  let byFamily = IMPORTED_ALBEDO_CACHE.get(recipe);
  if (!byFamily) {
    byFamily = new Map();
    IMPORTED_ALBEDO_CACHE.set(recipe, byFamily);
  }
  const cached = byFamily.get(family);
  if (cached !== undefined) return cached;

  const slot = (key) => Boolean(getSurfaceTexture(recipe.surfaceTextures, key));
  let resolved = false;
  if (family === 'roof') {
    resolved = slot('roof');
  } else {
    const wallsAreStone = recipe.archetype !== 'manor' || recipe.finish === 'masonry';
    resolved = slot('stone') || (wallsAreStone && slot('walls'));
  }
  byFamily.set(family, resolved);
  return resolved;
}

/**
 * Baked crevice occlusion strengths.
 *
 * Implements the "AO-like joint emphasis" of
 * docs/plans/procedural-medieval-construction/05-geometry-materials-and-stylized-realism.md
 * §9, and the per-stone "local AO strength" attribute of 04-…md §13, without a
 * screen-space pass. Layers combine multiplicatively so the total stays bounded
 * and no single term can crush the albedo — 05-…md §8 ("limit each layer").
 */
const OCCLUSION = Object.freeze({
  /** Darkening at a unit's own underside. Draws the line beneath every brick. */
  down: 0.34,
  /** Downward-facing surfaces sit in their neighbour's shadow. */
  face: 0.22,
  /** Sky contribution on upward-facing surfaces. */
  sky: 0.07,
  /** Lower courses receive less bounce light. */
  base: 0.16,
  /** Units pushed back behind the wall plane lose more light. */
  recess: 0.18,
  /** Metres over which the ground-contact gradient fades out. */
  baseHeight: 1.2,
});

function paletteStop(stops, index) {
  return stops[index % stops.length];
}

/**
 * Pick a per-unit base colour from a curated ramp.
 *
 * A ramp plus a rare outlier keeps variation coherent; sampling raw RGB noise
 * instead is what 05-…md §8 warns makes a wall unreadable.
 */
function rampColor(palette, tintLane, outlierLane, channel) {
  if (palette.outlier && outlierLane < palette.outlierChance) {
    return palette.outlier[channel] / 255;
  }
  const stops = palette.ramp;
  const scaled = tintLane * stops.length;
  const index = Math.min(stops.length - 1, Math.floor(scaled));
  const next = Math.min(stops.length - 1, index + 1);
  return THREE.MathUtils.lerp(
    paletteStop(stops, index)[channel] / 255,
    paletteStop(stops, next)[channel] / 255,
    scaled - index,
  );
}

function unitPalette(recipe, family) {
  if (family === 'roof') {
    return ROOF_PALETTES[recipe.topStyle] ?? ROOF_PALETTES.terracotta;
  }
  return STONE_PALETTES[recipe.style] ?? STONE_PALETTES.granite;
}

/**
 * Write per-unit vertex colours: curated hue variation plus baked crevice
 * occlusion.
 *
 * @param {THREE.BufferGeometry} geometry a single already-transformed unit
 * @param {object} recipe normalized workshop recipe
 * @param {object} options
 * @param {number} options.stableIndex seed-local identity of this unit (04-…md §14)
 * @param {number} [options.heightRatio] 0..1 position up the structure, for weathering
 * @param {'stone'|'roof'} [options.family] which palette to sample
 * @param {number} [options.protrusion] signed out-of-plane offset; negative recesses
 * @param {number} [options.depth] unit depth, to normalize `protrusion`
 * @param {boolean} [options.neutral] write occlusion only, preserving an imported
 *   albedo's hue. Defaults to whether this family actually has an import, which
 *   is what lets vertex variation survive an imported image (15-…md line 89).
 */
export function applyUnitShading(geometry, recipe, {
  stableIndex,
  heightRatio = 0.5,
  family = 'stone',
  protrusion = 0,
  depth = 0.3,
  neutral = hasImportedAlbedoFamily(recipe, family),
} = {}) {
  const palette = unitPalette(recipe, family);
  const hash = mixSeed(recipe.seed, stableIndex);
  const tintLane = (hash & 255) / 255;
  const outlierLane = ((hash >>> 8) & 255) / 255;
  const weather = recipe.weathering * (1 - heightRatio) * 0.14;

  const position = geometry.getAttribute('position');
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');

  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const spanY = Math.max(1e-4, bounds.max.y - bounds.min.y);

  // Uniform across the unit: a recessed stone is evenly deeper in shadow.
  const recessShade = OCCLUSION.recess
    * THREE.MathUtils.clamp(-protrusion / Math.max(1e-4, depth), 0, 1);

  const unit = new Float32Array(3);
  if (!neutral) {
    for (let channel = 0; channel < 3; channel += 1) {
      // Narrower than the pre-ramp 0.9..1.06 brightness spread, because the
      // ramp now carries most of the per-unit variation.
      unit[channel] = rampColor(palette, tintLane, outlierLane, channel)
        * (0.94 + tintLane * 0.1);
    }
  }

  const colors = new Float32Array(position.count * 3);
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const localY = (position.getY(vertex) - bounds.min.y) / spanY;
    const normalY = normal.getY(vertex);

    // Cubed so only a thin slice of each unit darkens, giving a crisp joint line
    // rather than a gradient washing over the whole face.
    //
    // Masonry darkens at its underside, where the course below shades it. A roof
    // tile is the other way up: its high edge is the one tucked under the course
    // above, and its low edge is the exposed lip that catches light.
    const occludedEnd = family === 'roof' ? localY : 1 - localY;
    const downShade = OCCLUSION.down * (occludedEnd ** 3);
    const faceShade = OCCLUSION.face * Math.max(0, -normalY);
    const skyLift = OCCLUSION.sky * Math.max(0, normalY);
    const baseShade = OCCLUSION.base * THREE.MathUtils.clamp(
      1 - position.getY(vertex) / OCCLUSION.baseHeight,
      0,
      1,
    );

    const shade = (1 - downShade)
      * (1 - faceShade)
      * (1 - baseShade)
      * (1 - recessShade)
      * (1 + skyLift);

    const offset = vertex * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const albedo = neutral ? 1 : unit[channel];
      colors[offset + channel] = THREE.MathUtils.clamp(
        albedo * shade - weather,
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
  const stone = tagWorkshopMaterial(new THREE.MeshStandardNodeMaterial({
    color: stoneAlbedo?.tint ?? (recipe.albedo ? '#ffffff' : STONE_PALETTES[recipe.style].color),
    map: stoneAlbedo?.texture ?? (recipe.albedo ? stoneTexture(recipe) : null),
    bumpMap: stoneBump,
    bumpScale: 0.055,
    normalMap: stoneNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: stoneRoughness,
    // Always on. Before 2026-07-25 an imported albedo disabled vertex colours
    // entirely, which contradicted 15-…md line 89 and threw away the baked
    // crevice occlusion. `applyUnitShading` switches to a neutral grey
    // occlusion-only term when an import is present, so the imported hue
    // survives while joints stay dark.
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.72,
  }), 'stone');
  const roof = tagWorkshopMaterial(new THREE.MeshStandardNodeMaterial({
    color: roofAlbedo?.tint ?? '#ffffff',
    map: roofAlbedo?.texture ?? roofTexture(recipe.topStyle, recipe.seed),
    bumpMap: roofBump,
    bumpScale: 0.095,
    normalMap: roofNormal,
    normalScale: new THREE.Vector2(0.68, 0.68),
    roughnessMap: roofRoughness,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.82,
  }), 'roof');
  return Object.freeze({
    stone,
    mortar: tagWorkshopMaterial(new THREE.MeshStandardNodeMaterial({
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
    wood: tagWorkshopMaterial(new THREE.MeshStandardNodeMaterial({
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
    metal: tagWorkshopMaterial(new THREE.MeshStandardNodeMaterial({
      color: '#b38a35',
      roughness: 0.48,
      metalness: 0.55,
      side: THREE.DoubleSide,
    }), 'metal'),
    foliage: tagWorkshopMaterial(new THREE.MeshStandardNodeMaterial({
      color: '#4c8a37',
      // Per-leaf tint and a base-to-tip gradient, baked by `leaf()`. Vines carry
      // no colour of their own and are filled white at merge time.
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    }), 'foliage'),
    recess: tagWorkshopMaterial(new THREE.MeshStandardNodeMaterial({
      color: '#233b43',
      roughness: 0.62,
      metalness: 0.05,
      emissive: '#071216',
      emissiveIntensity: 0.18,
    }), 'recess'),
  });
}
