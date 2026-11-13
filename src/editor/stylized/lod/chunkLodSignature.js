import { quantizeFade } from './projectedLod.js';

// LOD plans are rebuilt every few frames for a whole window of chunks; these caches
// stop each rebuild from minting the same key and signature strings as garbage.

const KEY_SPAN = 64; // any window up to 64 chunks wide fills distinct slots
const keyX = new Array(KEY_SPAN * KEY_SPAN).fill(NaN);
const keyZ = new Array(KEY_SPAN * KEY_SPAN).fill(NaN);
const keyText = new Array(KEY_SPAN * KEY_SPAN).fill('');
const entryTexts = new WeakMap();

/** `${chunkX}:${chunkZ}`, the key every LOD state map shares. */
export function chunkKey(chunkX, chunkZ) {
  const slot = (chunkX & (KEY_SPAN - 1)) * KEY_SPAN + (chunkZ & (KEY_SPAN - 1));
  if (keyX[slot] !== chunkX || keyZ[slot] !== chunkZ) {
    keyX[slot] = chunkX;
    keyZ[slot] = chunkZ;
    keyText[slot] = `${chunkX}:${chunkZ}`;
  }
  return keyText[slot];
}

/** One chunk's part of a plan signature; an unchanged (frozen) state reuses its text. */
export function chunkEntrySignature(key, target, ready, representations, fadeSteps) {
  const cached = entryTexts.get(representations);
  if (cached?.key === key && cached.target === target && cached.ready === ready
    && cached.fadeSteps === fadeSteps) return cached.text;
  let text = `${key}:${target}:${ready ? 'ready' : 'waiting'}`;
  let frozen = Object.isFrozen(representations);
  for (const representation of representations) {
    frozen &&= Object.isFrozen(representation);
    text += `:${representation.band}:${
      quantizeFade(representation.fade, fadeSteps)
    }:${representation.ditherDirection}`;
  }
  if (frozen) entryTexts.set(representations, { key, target, ready, fadeSteps, text });
  return text;
}
