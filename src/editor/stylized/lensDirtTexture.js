import * as THREE from 'three/webgpu';
import { createSeededRng } from '../../sim/util/seededRng.js';

const WIDTH = 512;
const HEIGHT = 288;

/**
 * Fills an RGBA8 buffer with lens grime: soft smudges, sharper dust specks and
 * a few faint streaks, slightly warm so bloom through it reads as dirty glass.
 * Deterministic for a seed.
 */
export function paintLensDirt(width = WIDTH, height = HEIGHT, seed = 0x1e5d) {
  const random = createSeededRng(seed);
  const rng = () => random.nextFloat();
  const value = new Float32Array(width * height);
  const stamp = (cx, cy, radius, strength, stretch = 1, angle = 0) => {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const reach = Math.ceil(radius * Math.max(1, stretch));
    for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(height - 1, cy + reach); y++) {
      for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(width - 1, cx + reach); x++) {
        const dx = x - cx, dy = y - cy;
        const u = (dx * cos + dy * sin) / stretch, v = -dx * sin + dy * cos;
        const d = Math.sqrt(u * u + v * v) / radius;
        if (d < 1) value[y * width + x] += strength * (1 - d * d) * (1 - d * d);
      }
    }
  };
  for (let i = 0; i < 70; i++) stamp(rng() * width, rng() * height, 12 + rng() * 40, 0.12 + rng() * 0.25);
  for (let i = 0; i < 260; i++) stamp(rng() * width, rng() * height, 1.2 + rng() * 3.5, 0.35 + rng() * 0.6);
  for (let i = 0; i < 6; i++) stamp(rng() * width, rng() * height, 3 + rng() * 4, 0.12, 8 + rng() * 10, rng() * Math.PI);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < value.length; i++) {
    const v = Math.min(1, value[i]) * 255;
    data.set([v, v * 0.94, v * 0.85, 255], i * 4);
  }
  return data;
}

let shared = null;

/** One dirt texture for every finish; built on first use, never at startup. */
export function getLensDirtTexture() {
  if (shared) return shared;
  shared = new THREE.DataTexture(paintLensDirt(), WIDTH, HEIGHT);
  shared.name = 'lens-dirt';
  shared.minFilter = THREE.LinearMipmapLinearFilter;
  shared.magFilter = THREE.LinearFilter;
  shared.generateMipmaps = true;
  shared.needsUpdate = true;
  return shared;
}
