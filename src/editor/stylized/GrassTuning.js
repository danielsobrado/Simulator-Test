import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

/**
 * Live-tunable grass parameters, held as uniforms shared by every grass slot.
 *
 * One `GrassTuning` backs all 49 chunk materials, because a uniform node is a
 * shared object: writing it once reaches the whole field with no geometry rebuild,
 * no scatter regeneration and no chunk re-upload. That is the whole point — the
 * blade-profile switch already demonstrates what the alternative costs, since it
 * rebuilds resident chunk geometry and hitches once per change.
 *
 * What is deliberately NOT here:
 *
 * - `tiltMax`, `clumpRadius`, `bladesPerClump` are baked into the clump mesh.
 * - `minWidth`/`maxWidth`, `bladesPerCell`, `residentRadius` are baked into the
 *   worker scatter, and the scatter is cached on the page — editing them live
 *   would not even take effect until the chunk re-paged.
 *
 * Exposing those as sliders would produce controls that silently do nothing, which
 * is worse than not having them. `widthScale` is the live stand-in for the baked
 * width range: it multiplies the per-blade width in the shader, so the gauge can be
 * dialled in here and then folded back into `minWidth`/`maxWidth` once it is right.
 *
 * `clumpRadius` in particular must stay out: `validateEditorConfig` checks it
 * against the carpet invariant at load, and a live slider would let the field be
 * broken into tufts with no guard firing.
 */

/** Scalar settings, as `key` → where the value comes from in `stylizedSurface`. */
const SCALAR_SETTINGS = Object.freeze([
  // Shape.
  { key: 'minLength', path: ['grass', 'minLength'], fallback: 0.1 },
  { key: 'maxLength', path: ['grass', 'maxLength'], fallback: 0.32 },
  { key: 'lengthSkew', path: ['grass', 'lengthSkew'], fallback: 1 },
  { key: 'widthScale', path: null, fallback: 1 },
  { key: 'bladeWidthSpread', path: ['grass', 'bladeWidthSpread'], fallback: 0 },
  { key: 'widthLengthCorrelation', path: ['grass', 'widthLengthCorrelation'], fallback: 0 },
  // Lighting.
  { key: 'brightness', path: ['color', 'brightness'], fallback: 0.8 },
  { key: 'bladeVariationStrength', path: ['color', 'bladeVariation', 'strength'], fallback: 0 },
  { key: 'bladeVariationShade', path: ['color', 'bladeVariation', 'shade'], fallback: 0 },
  { key: 'rootShadeStrength', path: ['color', 'rootShade', 'strength'], fallback: 0 },
  { key: 'rootShadeHeight', path: ['color', 'rootShade', 'height'], fallback: 0.35 },
  { key: 'patchStrength', path: ['patch', 'strength'], fallback: 0 },
  { key: 'translucencyStrength', path: ['translucency', 'strength'], fallback: 1 },
  { key: 'translucencyPower', path: ['translucency', 'power'], fallback: 6.4 },
  { key: 'translucencyTipBias', path: ['translucency', 'tipBias'], fallback: 1 },
  { key: 'bladeNormalStrength', path: ['bladeNormal', 'strength'], fallback: 0 },
  { key: 'bladeNormalFadeStart', path: ['bladeNormal', 'fadeStart'], fallback: 30 },
  { key: 'bladeNormalFadeEnd', path: ['bladeNormal', 'fadeEnd'], fallback: 60 },
  // Wind.
  { key: 'windStrength', path: ['wind', 'strength'], fallback: 0.1 },
  { key: 'windSpeed', path: ['wind', 'speed'], fallback: 1.3 },
  { key: 'windFrequency', path: ['wind', 'frequency'], fallback: 0.47 },
  { key: 'windTurbulence', path: ['wind', 'turbulence'], fallback: 0.04 },
  { key: 'windLean', path: ['wind', 'lean'], fallback: 0.05 },
  { key: 'windStiffnessRange', path: ['wind', 'stiffnessRange'], fallback: 0 },
  { key: 'flutterStrength', path: ['wind', 'flutter', 'strength'], fallback: 0 },
  { key: 'flutterHeightStart', path: ['wind', 'flutter', 'heightStart'], fallback: 0.62 },
  { key: 'flutterFadeStart', path: ['wind', 'flutter', 'fadeStart'], fallback: 22 },
  { key: 'flutterFadeEnd', path: ['wind', 'flutter', 'fadeEnd'], fallback: 38 },
]);

/** Colour settings. Stored as hex so the YAML export round-trips what was typed. */
const COLOR_SETTINGS = Object.freeze([
  { key: 'colorBottom', path: ['color', 'bottom'], fallback: '#4f7c13' },
  { key: 'colorTop', path: ['color', 'top'], fallback: '#79a01c' },
  { key: 'variationCool', path: ['color', 'bladeVariation', 'cool'], fallback: '#3c6a1c' },
  { key: 'variationWarm', path: ['color', 'bladeVariation', 'warm'], fallback: '#a8c63e' },
  { key: 'patchLush', path: ['patch', 'lush'], fallback: '#6f9a2a' },
  { key: 'patchDry', path: ['patch', 'dry'], fallback: '#b8a94e' },
  { key: 'translucencyColor', path: ['translucency', 'color'], fallback: '#c1e54d' },
]);

export const GRASS_SCALAR_SETTINGS = SCALAR_SETTINGS;
export const GRASS_COLOR_SETTINGS = COLOR_SETTINGS;

function readPath(source, path) {
  if (!path) return undefined;
  let value = source;
  for (const key of path) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }
  return value;
}

function assignPath(target, path, value) {
  let node = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (!node[key]) node[key] = {};
    node = node[key];
  }
  node[path[path.length - 1]] = value;
}

function emitYaml(node, indent) {
  const pad = '  '.repeat(indent);
  return Object.entries(node)
    .map(([key, value]) => (typeof value === 'object' && value !== null
      ? `${pad}${key}:\n${emitYaml(value, indent + 1)}`
      : `${pad}${key}: ${typeof value === 'string' ? `'${value}'` : value}`))
    .join('\n');
}

export class GrassTuning {
  constructor(surfaceConfig) {
    this.uniforms = {};
    this.values = {};
    for (const { key, path, fallback } of SCALAR_SETTINGS) {
      const configured = readPath(surfaceConfig, path);
      const value = Number.isFinite(configured) ? configured : fallback;
      this.values[key] = value;
      this.uniforms[key] = uniform(value);
    }
    for (const { key, path, fallback } of COLOR_SETTINGS) {
      const value = readPath(surfaceConfig, path) ?? fallback;
      this.values[key] = value;
      // `THREE.Color` converts the sRGB hex into the linear working space on
      // construction, which is what the material's old inline colour nodes did.
      this.uniforms[key] = uniform(new THREE.Color(value));
    }
    this.defaults = { ...this.values };
  }

  getSettings() {
    return { ...this.values };
  }

  /** Applies a partial update and returns the full settings afterwards. */
  setSettings(patch) {
    for (const [key, value] of Object.entries(patch ?? {})) {
      const uniformNode = this.uniforms[key];
      if (!uniformNode) continue;
      if (uniformNode.value instanceof THREE.Color) {
        if (typeof value !== 'string') continue;
        this.values[key] = value;
        uniformNode.value.set(value);
        continue;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      this.values[key] = numeric;
      uniformNode.value = numeric;
    }
    return this.getSettings();
  }

  reset() {
    return this.setSettings(this.defaults);
  }

  /**
   * The tuned values as a `stylizedSurface` YAML fragment, so a session at the
   * sliders can be folded back into editor.config.yaml instead of being lost when
   * the page reloads. `widthScale` has no config home — it is the live stand-in for
   * the baked width range — so it is emitted as a comment telling you what to
   * multiply `minWidth`/`maxWidth` by.
   */
  toYaml() {
    const tree = {};
    for (const { key, path } of SCALAR_SETTINGS) {
      if (!path) continue;
      assignPath(tree, path, Number(this.values[key].toFixed(4)));
    }
    for (const { key, path } of COLOR_SETTINGS) {
      assignPath(tree, path, this.values[key]);
    }
    const widthScale = this.values.widthScale;
    const widthNote = widthScale === 1
      ? ''
      : `\n# widthScale ${widthScale.toFixed(3)} — multiply grass.minWidth/maxWidth by this.`;
    return `stylizedSurface:\n${emitYaml(tree, 1)}${widthNote}`;
  }
}
