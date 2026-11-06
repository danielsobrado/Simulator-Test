import { meadowPressRecoveryFactor } from './meadowInteractionBend.js';
import * as THREE from 'three/webgpu';

/**
 * Where the player's body pushes the meadow over, ported from grass-test's
 * `InteractionMap`: a small texture centred on the player, into which the body is
 * stamped as a sphere every frame. Blades read it and fold over; the stamp fades
 * (`recoverySpeed` per frame) so the grass stands back up behind the player.
 *
 * Everything is in render space, like the blades. The floating origin moving is
 * not the player moving: `shiftOrigin` re-bases the centre without scrolling the
 * ink, so a re-centre never smears the trail.
 *
 * The donor's optimisations are kept: recovery and scrolling touch only the
 * rectangle that has ink, and once the peak decays to zero nothing is uploaded.
 *
 * Channels: R is the press (blades fold over); G is how strongly a spell has
 * marked the grass — scorched, frosted, withered — and B which mark it is
 * (`GRASS_MARK`), so the meadow itself carries a spell's aftermath instead of
 * a decal hidden under it. Marks fade on their own, slow clock — one step every
 * few frames, by kind — so a spell stamps a mark while it spreads and then only
 * refreshes it now and then, instead of every frame.
 */
/** Mark kinds in the B channel; the blade shader holds the matching colours. */
export const GRASS_MARK = Object.freeze({
  SCORCH: 0,
  SINGE: 1,
  WITHER: 2,
  FROST: 3,
  ACID: 4,
  MOON: 5,
  BLOOM: 6,
  SICKLY: 7,
});
export const GRASS_MARK_KINDS = 8;

/**
 * Frames per one-step fade of a mark, by kind (255 steps to clear): moonlight
 * leaves within seconds, frost in ~20 s, burnt and withered grass in ~40 s.
 */
const MARK_FADE_FRAMES = Object.freeze([10, 9, 10, 5, 9, 1, 2, 6]);
const MARK_KIND_SHIFT = 5;

export class MeadowInteractionMap {
  /**
   * @param {object} options
   * @param {number} [options.resolution] texels per side
   * @param {number} [options.worldSize] metres across (the donor's 75 units)
   * @param {number} [options.recoverySpeed] share of the stamp kept each frame
   * @param {number} [options.strength]
   * @param {number} [options.bodyRadius] metres (the donor's 0.72 units)
   * @param {(x: number, z: number) => number} options.getHeight render-space ground
   */
  constructor({
    resolution = 256, worldSize = 27, recoverySpeed = 0.94, strength = 1, bodyRadius = 0.26,
    uploadIntervalFrames = 1, getHeight,
  }) {
    this.resolution = resolution;
    this.worldSize = worldSize;
    this.recoverySpeed = recoverySpeed;
    this.markFrame = 0;
    this.strength = strength;
    this.bodyRadius = bodyRadius;
    this.uploadIntervalFrames = Math.max(1, Math.round(uploadIntervalFrames));
    this.uploadFrame = 0;
    this.textureDirty = false;
    this.getHeight = getHeight;
    this.center = new THREE.Vector2();
    this.lastCenter = new THREE.Vector2();
    this.started = false;
    this.peak = 0;
    this.markPeak = 0;
    this.ink = { minX: 0, minY: 0, maxX: -1, maxY: -1 };
    this.pixels = new Uint8Array(resolution * resolution * 4);
    this.scratch = new Uint8Array(resolution * resolution * 3);
    this.press = new Float32Array(resolution * resolution);
    this.pressScratch = new Float32Array(resolution * resolution);
    this.clearPixels();
    this.texture = new THREE.DataTexture(this.pixels, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;
  }

  clearPixels() {
    this.pixels.fill(0);
    this.press.fill(0);
    this.pressScratch.fill(0);
    for (let index = 3; index < this.pixels.length; index += 4) this.pixels[index] = 255;
  }

  hasInk() {
    return this.ink.maxX >= this.ink.minX && this.ink.maxY >= this.ink.minY;
  }

  clearInk() {
    Object.assign(this.ink, { minX: 0, minY: 0, maxX: -1, maxY: -1 });
  }

  addInk(minX, minY, maxX, maxY) {
    const ink = this.ink;
    if (!this.hasInk()) {
      Object.assign(ink, { minX, minY, maxX, maxY });
      return;
    }
    ink.minX = Math.min(ink.minX, minX);
    ink.minY = Math.min(ink.minY, minY);
    ink.maxX = Math.max(ink.maxX, maxX);
    ink.maxY = Math.max(ink.maxY, maxY);
  }

  /** The floating origin moved by (dx, dz): render coordinates shift by −(dx, dz). */
  shiftOrigin(dx, dz) {
    this.center.x -= dx;
    this.center.y -= dz;
    this.lastCenter.x -= dx;
    this.lastCenter.y -= dz;
  }

  /**
   * @param {{ x: number, y: number, z: number } | null} body render-space point to
   *   stamp (the player's feet), or null to only let the meadow recover
   * @param {{ stamp?: boolean }} [options] `stamp: false` only follows the point:
   *   the spell map keeps its window round the player without pressing a body in
   */
  update(body, { stamp = true, dtSeconds = 1/60 } = {}) {
    if (body) {
      if (!this.started) {
        this.lastCenter.set(body.x, body.z);
        this.started = true;
      }
      if (this.hasMarksOrPress()) this.scroll(body.x - this.lastCenter.x, body.z - this.lastCenter.y);
      this.lastCenter.set(body.x, body.z);
      this.center.set(body.x, body.z);
    }
    this.recover(dtSeconds);
    if (body && stamp) this.paintSphere(body.x, body.y, body.z, this.bodyRadius, this.strength);
    this.uploadFrame += 1;
    if (
      this.textureDirty
      && (
        this.uploadFrame % this.uploadIntervalFrames === 0
        || !this.hasMarksOrPress()
      )
    ) {
      this.texture.needsUpdate = true;
      this.textureDirty = false;
    }
  }

  hasMarksOrPress() {
    return this.peak > 0 || this.markPeak > 0;
  }

  recover(dtSeconds = 1/60) {
    if (!this.hasMarksOrPress()) return;
    const { minX, minY, maxX, maxY } = this.ink;
    const stride = this.resolution * 4;
    const pressing = this.peak > 0;
    const marking = this.markPeak > 0;
    const frame = this.markFrame;
    this.markFrame += 1;
    const factor = meadowPressRecoveryFactor(dtSeconds,this.recoverySpeed);
    let pressPeak = 0;
    let markPeak = 0;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const index = y * stride + x * 4;
        if (pressing) {
          const cell=y*this.resolution+x;
          const value=this.press[cell]*factor;
          this.press[cell]=value;
          const byte = Math.round(value);
          if (this.pixels[index] !== byte) this.textureDirty = true;
          this.pixels[index]=byte;
          pressPeak=Math.max(pressPeak,this.pixels[index]);
        }
        if (marking) {
          let mark = this.pixels[index + 1];
          if (mark > 0 && frame % MARK_FADE_FRAMES[this.pixels[index + 2] >> MARK_KIND_SHIFT] === 0) {
            mark -= 1;
            this.pixels[index + 1] = mark;
            this.textureDirty = true;
          }
          if (mark > markPeak) markPeak = mark;
        }
      }
    }
    this.peak = pressPeak;
    if (pressing && pressPeak === 0) this.press.fill(0);
    this.markPeak = markPeak;
    if (!this.hasMarksOrPress()) this.clearInk();
  }

  /** Scrolls the ink so it stays put in the world as the window follows the player. */
  scroll(deltaX, deltaZ) {
    const perMetre = this.resolution / this.worldSize;
    const shiftX = Math.trunc(deltaX * perMetre);
    const shiftY = Math.trunc(deltaZ * perMetre);
    if ((shiftX === 0 && shiftY === 0) || !this.hasInk()) return;
    this.textureDirty = true;
    const { minX: oldMinX, minY: oldMinY, maxX: oldMaxX, maxY: oldMaxY } = this.ink;
    const width = oldMaxX - oldMinX + 1;
    for (let y = oldMinY; y <= oldMaxY; y += 1) {
      for (let x = oldMinX; x <= oldMaxX; x += 1) {
        const offset = (y * this.resolution + x) * 4;
        const cell = ((y - oldMinY) * width + (x - oldMinX)) * 3;
        this.pressScratch[cell/3]=this.press[y*this.resolution+x];
        this.press[y*this.resolution+x]=0;
        for (let channel = 0; channel < 3; channel += 1) {
          this.scratch[cell + channel] = this.pixels[offset + channel];
          this.pixels[offset + channel] = 0;
        }
      }
    }
    const last = this.resolution - 1;
    const minX = Math.max(0, oldMinX - shiftX);
    const maxX = Math.min(last, oldMaxX - shiftX);
    const minY = Math.max(0, oldMinY - shiftY);
    const maxY = Math.min(last, oldMaxY - shiftY);
    if (maxX < minX || maxY < minY) {
      this.clearInk();
      this.peak = 0;
      this.markPeak = 0;
      return;
    }
    Object.assign(this.ink, { minX, minY, maxX, maxY });
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const offset = (y * this.resolution + x) * 4;
        const cell = ((y + shiftY - oldMinY) * width + (x + shiftX - oldMinX)) * 3;
        for (let channel = 0; channel < 3; channel += 1) this.pixels[offset + channel] = this.scratch[cell + channel];
        this.press[y*this.resolution+x]=this.pressScratch[cell/3];
      }
    }
  }

  /** Stamps a sphere; only where it reaches the ground does it press the grass. */
  paintSphere(x, y, z, radius, strength = 1) {
    const perMetre = this.resolution / this.worldSize;
    const centerX = ((x - this.center.x) / this.worldSize + 0.5) * this.resolution;
    const centerY = ((z - this.center.y) / this.worldSize + 0.5) * this.resolution;
    const pixelRadius = radius * perMetre;
    if (pixelRadius < 0.5) return;
    const minX = Math.max(0, Math.floor(centerX - pixelRadius));
    const maxX = Math.min(this.resolution - 1, Math.ceil(centerX + pixelRadius));
    const minY = Math.max(0, Math.floor(centerY - pixelRadius));
    const maxY = Math.min(this.resolution - 1, Math.ceil(centerY + pixelRadius));
    if (maxX < minX || maxY < minY) return;
    this.addInk(minX, minY, maxX, maxY);
    const radiusSquared = radius * radius;
    for (let py = minY; py <= maxY; py += 1) {
      const worldZ = this.center.y + ((py + 0.5) / this.resolution - 0.5) * this.worldSize;
      for (let px = minX; px <= maxX; px += 1) {
        const worldX = this.center.x + ((px + 0.5) / this.resolution - 0.5) * this.worldSize;
        const distanceSquared = (worldX - x) ** 2 + (worldZ - z) ** 2;
        if (distanceSquared > radiusSquared) continue;
        const ground = this.getHeight?.(worldX, worldZ);
        const reach = Math.sqrt(Math.max(0, radiusSquared - distanceSquared));
        if (Number.isFinite(ground) && y - reach > ground + 0.3) continue;
        const value = 255 * Math.min(1,strength) * (1 - Math.sqrt(distanceSquared) / radius);
        const offset = (py * this.resolution + px) * 4;
        const cell=py*this.resolution+px;
        const next=Math.max(this.press[cell],value);
        const byte = Math.round(next);
        if (this.pixels[offset] !== byte) this.textureDirty = true;
        this.press[cell]=next;this.pixels[offset]=byte;
        this.peak=Math.max(this.peak,this.pixels[offset]);
      }
    }
  }

  /**
   * Presses the grass flat over a ground disc — a blast, a scorch, a puddle.
   * Unlike `paintSphere` it does not ask the terrain per texel, so a spell can
   * hold a several-metre patch down every frame for next to nothing. Full
   * strength inside `innerFraction` of the radius, fading to the rim.
   *
   * @param {number} x render-space metres
   * @param {number} z render-space metres
   * @param {number} radius metres
   * @param {number} [strength] 0..1
   * @param {number} [innerFraction] 0..1
   */
  pressDisc(x, z, radius, strength = 1, innerFraction = 0.6) {
    const rect = this.discRect(x, z, radius);
    if (!rect || !(strength > 0)) return;
    const { centerX, centerY, pixelRadius, minX, minY, maxX, maxY } = rect;
    this.addInk(minX, minY, maxX, maxY);
    const inner = Math.min(0.99, Math.max(0, innerFraction));
    const peak = 255 * Math.min(1, strength);
    for (let py = minY; py <= maxY; py += 1) {
      const dy = (py + 0.5 - centerY) / pixelRadius;
      for (let px = minX; px <= maxX; px += 1) {
        const dx = (px + 0.5 - centerX) / pixelRadius;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 1) continue;
        const falloff = distance <= inner ? 1 : 1 - (distance - inner) / (1 - inner);
        const offset = (py * this.resolution + px) * 4;
        const cell=py*this.resolution+px;
        const next=Math.max(this.press[cell],peak*falloff);
        const byte = Math.round(next);
        if (this.pixels[offset] !== byte) this.textureDirty = true;
        this.press[cell]=next;this.pixels[offset]=byte;
        this.peak=Math.max(this.peak,this.pixels[offset]);
      }
    }
  }

  /**
   * Marks the grass over a ground disc — scorched, frosted, withered — at full
   * strength inside `innerFraction` of the radius, easing out to the rim. Like
   * the press, a mark that must last is restamped every frame and recovers once
   * the spell stops. Where marks overlap, the clearly stronger one sets the kind.
   *
   * @param {number} x render-space metres
   * @param {number} z render-space metres
   * @param {number} radius metres
   * @param {number} kind GRASS_MARK
   * @param {number} [strength] 0..1
   * @param {number} [innerFraction] 0..1
   */
  markDisc(x, z, radius, kind, strength = 1, innerFraction = 0.5) {
    const rect = this.discRect(x, z, radius);
    if (!rect || !(strength > 0)) return;
    const { centerX, centerY, pixelRadius, minX, minY, maxX, maxY } = rect;
    this.addInk(minX, minY, maxX, maxY);
    const inner = Math.min(0.99, Math.max(0, innerFraction));
    const peak = 255 * Math.min(1, strength);
    const code = grassMarkCode(kind);
    for (let py = minY; py <= maxY; py += 1) {
      const dy = (py + 0.5 - centerY) / pixelRadius;
      for (let px = minX; px <= maxX; px += 1) {
        const dx = (px + 0.5 - centerX) / pixelRadius;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 1) continue;
        const edge = distance <= inner ? 1 : 1 - (distance - inner) / (1 - inner);
        const value = Math.floor(peak * edge * edge * (3 - 2 * edge));
        const offset = (py * this.resolution + px) * 4;
        const current = this.pixels[offset + 1];
        if (value <= current) continue;
        if (current < 24 || value >= current * 1.5) this.pixels[offset + 2] = code;
        this.pixels[offset + 1] = value;
        this.textureDirty = true;
        if (value > this.markPeak) this.markPeak = value;
      }
    }
  }

  /** Texel rectangle of a render-space disc, or null when it misses the window. */
  discRect(x, z, radius) {
    const perMetre = this.resolution / this.worldSize;
    const centerX = ((x - this.center.x) / this.worldSize + 0.5) * this.resolution;
    const centerY = ((z - this.center.y) / this.worldSize + 0.5) * this.resolution;
    const pixelRadius = radius * perMetre;
    if (pixelRadius < 0.5) return null;
    const minX = Math.max(0, Math.floor(centerX - pixelRadius));
    const maxX = Math.min(this.resolution - 1, Math.ceil(centerX + pixelRadius));
    const minY = Math.max(0, Math.floor(centerY - pixelRadius));
    const maxY = Math.min(this.resolution - 1, Math.ceil(centerY + pixelRadius));
    if (maxX < minX || maxY < minY) return null;
    return { centerX, centerY, pixelRadius, minX, minY, maxX, maxY };
  }

  clearPress() {
    this.press.fill(0);this.pressScratch.fill(0);this.peak=0;
    let changed = this.textureDirty;
    for(let i=0;i<this.pixels.length;i+=4) {
      changed ||= this.pixels[i] !== 0;
      this.pixels[i]=0;
    }
    if(!this.markPeak)this.clearInk();
    this.textureDirty=false;
    if (changed) this.texture.needsUpdate=true;
  }

  dispose() {
    this.texture.dispose();
  }
}

/** B-channel byte for a mark kind: the middle of its band, so filtering stays inside it. */
export function grassMarkCode(kind) {
  const clamped = Math.max(0, Math.min(GRASS_MARK_KINDS - 1, Math.round(kind)));
  return Math.round((clamped + 0.5) * (255 / GRASS_MARK_KINDS));
}
