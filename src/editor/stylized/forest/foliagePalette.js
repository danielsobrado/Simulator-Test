import * as THREE from 'three';
import { dot, float, max, mix, smoothstep, vec3 } from 'three/tsl';
import { resolveCanopyGrade } from './canopyGrade.js';

/** Brightest channel a petal keeps: hue survives, only its value is lifted. */
const PETAL_MIN_PEAK = .62;

/** Understory bridges the meadow and canopy, using their configured pigments. */
export function resolveFoliagePalette(config = {}, tileId = null) {
  const meadow = config.grass?.meadow?.palette;
  const grass = meadow?.byTileId?.[tileId] ?? meadow;
  const canopy = resolveCanopyGrade(config.trees?.canopyGrade);
  const base = new THREE.Color(grass?.base ?? config.color?.bottom ?? '#50852b');
  const tip = new THREE.Color(grass?.tip ?? config.color?.top ?? '#a6bf65');
  base.lerp(new THREE.Color(canopy?.shadow ?? config.trees?.leafBottom ?? '#286746'), 0.3);
  tip.lerp(new THREE.Color(canopy?.light ?? config.trees?.leafTop ?? '#8cb75a'), 0.55);
  return { base, tip, exposure: config.understory?.paletteExposure ?? 1.25 };
}

export function fallingLeafPalette(config = {}, tileId = null) {
  const { base, tip } = resolveFoliagePalette(config, tileId);
  // Fresh, mature and pale green leaves from one stand; no unrelated white/gold.
  return [base.clone().lerp(tip, 0.35), base.clone().lerp(tip, 0.75), tip];
}

function understoryRamp(sample, palette) {
  const luminance = dot(sample, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(...palette.base.toArray()), vec3(...palette.tip.toArray()),
    smoothstep(0.025, 0.8, luminance.mul(palette.exposure)));
}

/** Keep painted veins, stems and blossoms while grading green foliage. */
export function gradeUnderstory(sample, palette) {
  const green = smoothstep(0.005, 0.06, sample.g.sub(max(sample.r, sample.b)));
  return mix(sample, understoryRamp(sample, palette), green.mul(0.9));
}

/** Explicit parts protect yellow petals from the foliage green-pixel mask. */
export function gradePlantPart(sample, palette, role = 'auto') {
  if (role === 'auto' || role === 'leaf') return gradeUnderstory(sample, palette);
  // A whole plant painted off-green (teal roots) has no pixels worth protecting.
  if (role === 'foliage') return mix(sample, understoryRamp(sample, palette), .9);
  if (role === 'stem') return mix(sample, vec3(...palette.base.toArray()), .65);
  if (role === 'petal' || role === 'center') {
    const luminance = dot(sample, vec3(.2126, .7152, .0722));
    // Petals were painted for unlit rendering; lit, a deep violet reads as black.
    const peak = max(max(sample.r, sample.g), max(sample.b, .001));
    return mix(vec3(luminance), sample, .82).mul(max(float(PETAL_MIN_PEAK).div(peak), 1)).mul(.94);
  }
  throw new Error(`Unknown plant material role: ${role}`);
}
