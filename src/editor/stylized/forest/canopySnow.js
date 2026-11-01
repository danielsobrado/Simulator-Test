import * as THREE from 'three/webgpu';
import { float, mix, normalize, normalWorld, positionGeometry, smoothstep, uniform, vec3 } from 'three/tsl';
import { foliageLight } from './foliageLight.js';
import { blurTileValueAt } from '../../world/BiomeFieldBlur.js';

/**
 * Snow caps on tree crowns, in the Tiny Glade winter style: white along the
 * upward-facing foliage, the leaf colour still showing on the flanks and
 * underside.
 *
 * How much snow a tree carries is per instance — its biome's `snow.canopy`
 * (config/biome-looks.yaml), or the terrain's snow band at its height — so it
 * rides the existing leaf-tint vector (its w) rather than a vertex buffer of its
 * own; a leaf part is already near WebGPU's eight. The cap itself keys on the
 * world normal, so it costs a smoothstep and a mix per fragment and no texture.
 */
export const canopySnowColor = uniform(new THREE.Color('#eef3f8'));
/** The cool tone snow takes in its own shade: sky fill, not the leaf's. */
const SNOW_SHADE = Object.freeze([0.78, 0.86, 1]);
/** Normal-y band over which a crown face goes from bare to capped. */
const CAP_START = 0.05;
const CAP_FULL = 0.55;
/** How much the crown's overall shape, rather than each card, decides facing. */
const CROWN_SHAPE = 0.65;
/** Frost on every needle, flanks and underside included, as a share of the tree's snow. */
const FROST_SHARE = 0.3;
/** Against foliageLight.strength's 0.12: ice scatters far more sun through than a leaf. */
const SNOW_TRANSMISSION = 7;

/** @param {string} hex */
export function setCanopySnowColor(hex) {
  canopySnowColor.value.set(hex);
}

/**
 * A biome's canopy snow at a cell, blurred over the same ±BIOME_BLUR_CELLS
 * kernel the ground snow uses, so a tree on a biome border carries as much
 * snow as the ground it stands on instead of stepping at the border line.
 *
 * @param {Float32Array|null} byTile `biomeLooks.snow.canopy`
 * @param {(cellX: number, cellZ: number) => number} tileAt
 */
export function biomeCanopySnowAt(byTile, tileAt, cellX, cellZ) {
  if (!byTile) return 0;
  return blurTileValueAt(tileAt, cellX, cellZ, (tileId) => byTile[tileId] ?? 0);
}

/**
 * Per-instance snow for a tree, 0..1: the larger of its biome's canopy snow and
 * the terrain's snow band at its height, drifting a little per tree so a stand
 * is not uniformly white.
 *
 * @param {object} options
 * @param {number} [options.snowLine] metres
 * @param {number} [options.snowFade] metres
 * @returns {(biome: number, height: number, seed: number) => number} `biome`
 *   is biomeCanopySnowAt's value
 */
export function createCanopySnowResolver({ snowLine = Infinity, snowFade = 1 } = {}) {
  const fade = Math.max(1e-3, snowFade);
  return (biome, height, seed = 0.5) => {
    const altitude = Number.isFinite(height)
      ? THREE.MathUtils.smoothstep(height, snowLine, snowLine + fade)
      : 0;
    const snow = Math.max(Number.isFinite(biome) ? biome : 0, altitude);
    if (snow <= 0) return 0;
    return Math.min(1, snow * (0.8 + 0.4 * (Number.isFinite(seed) ? seed : 0.5)));
  };
}

/**
 * Which way a crown fragment faces as part of the whole crown: its card's own
 * normal blended with the direction out from the crown's centre. Leaf cards
 * point every which way, so on its own the normal sprinkled white flecks
 * through a conifer; the crown direction gathers them into a cap on top.
 *
 * @param {{ min: number[], max: number[] }|null} bounds the leaf part's
 *   prototype-space bounds; null keeps the card normal alone
 */
export function crownUpNode(bounds) {
  if (!bounds) return normalWorld.y;
  const center = vec3(...bounds.min.map((low, axis) => (low + bounds.max[axis]) / 2));
  const half = vec3(...bounds.min.map((low, axis) => Math.max(0.05, (bounds.max[axis] - low) / 2)));
  const outward = normalize(positionGeometry.sub(center).div(half));
  return mix(normalWorld.y, outward.y, CROWN_SHAPE);
}

/**
 * The cap, 0..1, for a crown fragment: faces turned up take it, broken by the
 * crown's own geometry so the edge is lumpy rather than a level line.
 *
 * @param {import('three/tsl').Node} snow per-instance amount
 * @param {import('three/tsl').Node} [up] how far the fragment faces up
 *   (crownUpNode; an impostor passes its atlas normal's y)
 */
export function canopySnowCap(snow, up = normalWorld.y) {
  const local = positionGeometry;
  const lumps = local.x.mul(5.3).sin().mul(local.z.mul(4.7).add(local.y.mul(3.1)).sin()).mul(0.18);
  // More snow takes a shallower face: a heavy fall caps the flanks too.
  const start = float(CAP_START + 0.3).sub(snow.mul(0.3));
  return smoothstep(start, start.add(CAP_FULL - CAP_START), up.add(lumps)).mul(snow).max(snow.mul(FROST_SHARE));
}

/** A crown's sun transmission with snow taking over from the leaf, for frost that glows backlit. */
export function canopySnowTransmission(leaf, cap) {
  return mix(leaf, float(SNOW_TRANSMISSION), cap);
}

/**
 * Lays the cap over a crown's lit colour and emission.
 *
 * @returns {{ color: import('three/tsl').Node, emissive: import('three/tsl').Node|null }}
 */
export function applyCanopySnow({ color, emissive = null, cap }) {
  const snow = canopySnowColor;
  const capped = mix(color, snow, cap);
  // The leaf's own sky fill and transmission give way to snow's cool fill, so a
  // cap in the crown's shade reads blue-grey instead of green-lit.
  const fill = snow.mul(vec3(...SNOW_SHADE)).mul(foliageLight.skyColor).mul(foliageLight.fill).mul(0.22).mul(cap);
  const lit = emissive ? emissive.mul(cap.oneMinus()).add(fill) : fill;
  return { color: capped, emissive: lit };
}

/** Share of a fully snowed tree's upward bark faces that whiten. */
const TRUNK_SNOW = 0.85;

/**
 * Snow along the tops of a trunk's limbs and root flares: the same tree's
 * canopy snow on its upward bark faces, broken by the bark's own geometry.
 */
export function trunkSnow(color, snow) {
  const local = positionGeometry;
  const broken = local.y.mul(2.3).add(local.x.mul(4.1)).sin().mul(0.12);
  const faces = smoothstep(0.35, 0.75, normalWorld.y.add(broken));
  return mix(color, canopySnowColor, faces.mul(snow).mul(TRUNK_SNOW));
}
