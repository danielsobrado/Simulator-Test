import * as THREE from 'three';
import { dot, float, max, mix, normalWorld, positionGeometry, smoothstep, vec3 } from 'three/tsl';
import { resolveCanopyGrade } from './canopyGrade.js';

/** Brightest channel a petal keeps: hue survives, only its value is lifted. */
const PETAL_MIN_PEAK = .56;
const FALLBACK_PALETTE_TILE = Object.freeze({ 0: 3, 1: 10, 2: 10, 11: 10, 32: 10 });
const OPEN_DRY_BIOMES = new Set([0, 1, 2, 3, 10, 11, 32]);
const MEADOW_BIOMES = new Set([4, 14]);
/**
 * Sun-bleached dust and dry earth are each plant's own colour lifted toward pale,
 * as on the town's walls (townWeathering): the rocks' style, not their colour.
 * Pulled to the rocks' one limestone dust, every biome's understory came out alike.
 */
function bleached(color, lift = 0.42, hueKeep = 0.7) {
  const luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), color, hueKeep).mul(1 - lift).add(lift * 0.62);
}

/** Understory bridges the meadow and canopy, using their configured pigments. */
export function resolveFoliagePalette(config = {}, tileId = null) {
  const meadow = config.grass?.meadow?.palette;
  const grass = meadow?.byTileId?.[tileId] ?? meadow?.byTileId?.[FALLBACK_PALETTE_TILE[tileId]] ?? meadow;
  const canopy = resolveCanopyGrade(config.trees?.canopyGrade);
  const base = new THREE.Color(grass?.base ?? config.color?.bottom ?? '#50852b');
  const tip = new THREE.Color(grass?.tip ?? config.color?.top ?? '#a6bf65');
  const shadowColor = new THREE.Color(canopy?.shadow ?? config.trees?.leafBottom ?? '#286746');
  const lightColor = new THREE.Color(canopy?.light ?? config.trees?.leafTop ?? '#8cb75a');
  // Open country keeps its own ground's pigment; only woods lean to the canopy's.
  // Each biome's own understory look (biome-looks `understory`) does the rest.
  if (tileId !== null && OPEN_DRY_BIOMES.has(tileId)) {
    base.lerp(shadowColor, 0.06);
    tip.lerp(lightColor, 0.12);
  } else if (tileId !== null && MEADOW_BIOMES.has(tileId)) {
    base.lerp(shadowColor, 0.18);
    tip.lerp(lightColor, 0.36);
  } else {
    base.lerp(shadowColor, 0.3);
    tip.lerp(lightColor, 0.55);
  }
  return { base, tip, exposure: config.understory?.paletteExposure ?? 1.15 };
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

/**
 * The rocks' surface finish on plants: dust on what faces the sky and a little
 * contact shade at the foot, so they sit into the ground as the stones do.
 */
function applyUnderstoryWeathering(color) {
  const skyFacing = smoothstep(0.15, 0.88, normalWorld.y);
  const foot = smoothstep(0, 0.32, positionGeometry.y);
  const grounded = color.mul(mix(float(0.84), float(1), foot));
  return mix(grounded, bleached(color), skyFacing.mul(0.15));
}

/** Keep painted veins, stems and blossoms while harmonising them with the biome palette. */
export function gradeUnderstory(sample, palette) {
  const luminance = dot(sample, vec3(0.2126, 0.7152, 0.0722));
  const green = smoothstep(0.005, 0.06, sample.g.sub(max(sample.r, sample.b)));
  const earth = bleached(vec3(...palette.base.toArray()), 0.3, 0.6);
  const mutedAccent = mix(
    mix(vec3(luminance), sample, 0.62),
    earth.mul(luminance.mul(1.25).add(0.28)),
    0.26,
  );
  const graded = mix(mutedAccent, understoryRamp(sample, palette), green.mul(0.9));
  return applyUnderstoryWeathering(graded);
}

/** Explicit parts protect yellow petals from the foliage green-pixel mask. */
export function gradePlantPart(sample, palette, role = 'auto') {
  if (role === 'auto' || role === 'leaf') return gradeUnderstory(sample, palette);
  // A whole plant painted off-green (teal roots) has no pixels worth protecting.
  if (role === 'foliage') return applyUnderstoryWeathering(mix(sample, understoryRamp(sample, palette), .9));
  if (role === 'stem') return applyUnderstoryWeathering(mix(sample, vec3(...palette.base.toArray()), .68));
  if (role === 'petal' || role === 'center') {
    const luminance = dot(sample, vec3(.2126, .7152, .0722));
    // Petals were painted for unlit rendering; lit, a deep violet reads as black.
    // A little desaturated, so blossoms never read as neon confetti; each keeps its own hue.
    const peak = max(max(sample.r, sample.g), max(sample.b, .001));
    return mix(vec3(luminance), sample, .68).mul(max(float(PETAL_MIN_PEAK).div(peak), 1)).mul(.88);
  }
  throw new Error(`Unknown plant material role: ${role}`);
}
