import * as THREE from 'three/webgpu';

/**
 * The fallen and growing things of a forest floor, built in code: every shape
 * carries its bark, heartwood, moss and leaf colour per vertex, so a kind needs no
 * asset or texture and costs one instanced draw. Deterministic, as with
 * proceduralFlora.js: variation between instances comes from the placement.
 *
 * Budgets: stump ~200 triangles, log ~170, branch 48, litter 2 per leaf, moss 72.
 */
const BARK = new THREE.Color('#5b4733');
const BARK_DARK = new THREE.Color('#3b2e22');
const HEARTWOOD = new THREE.Color('#a98a5e');
const HEARTWOOD_RING = new THREE.Color('#7d6240');
const MOSS = new THREE.Color('#3f5a2a');
const MOSS_LIGHT = new THREE.Color('#5f7a34');
const LEAVES = Object.freeze(['#8a5a2b', '#a8742f', '#6e4a2a', '#94542a', '#b08a3e', '#5c4426'])
  .map((hex) => new THREE.Color(hex));
const SCRATCH = new THREE.Color();
/** What a fallen leaf rots toward: one palette colour per leaf read as flat orange decals. */
const DECAYED = new THREE.Color('#463b2b');

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value in 0..1 for mottling bark and moss. */
function mottle(a, b) {
  return 0.5 + 0.25 * Math.sin(a * 2.3 + b * 1.7) + 0.25 * Math.sin(a * 5.1 - b * 3.3 + 1.2);
}

function smoothstep(low, high, value) {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

class MeshBuilder {
  positions = [];
  colors = [];
  indices = [];

  vertex(x, y, z, color) {
    this.positions.push(x, y, z);
    this.colors.push(color.r, color.g, color.b);
    return this.positions.length / 3 - 1;
  }

  /** Closes `sides` columns of quads between `rows` rings written one after another. */
  grid(first, rows, sides) {
    for (let row = 0; row + 1 < rows; row += 1) {
      for (let side = 0; side < sides; side += 1) {
        const next = (side + 1) % sides;
        const a = first + row * sides + side;
        const b = first + row * sides + next;
        const c = a + sides;
        const d = b + sides;
        this.indices.push(a, c, b, b, c, d);
      }
    }
  }

  fan(centre, first, sides, flip = false) {
    for (let side = 0; side < sides; side += 1) {
      const a = first + side;
      const b = first + (side + 1) % sides;
      if (flip) this.indices.push(centre, b, a);
      else this.indices.push(centre, a, b);
    }
  }

  /** A sawn or broken face: pale heartwood with a darker growth ring. */
  endGrain(ring, sides, centreAt, flip) {
    const inner = this.positions.length / 3;
    for (let side = 0; side < sides; side += 1) {
      const offset = (ring + side) * 3;
      const [x, y, z] = this.positions.slice(offset, offset + 3);
      this.vertex(
        centreAt[0] + (x - centreAt[0]) * 0.62,
        centreAt[1] + (y - centreAt[1]) * 0.62,
        centreAt[2] + (z - centreAt[2]) * 0.62,
        side % 2 ? HEARTWOOD_RING : SCRATCH.copy(HEARTWOOD_RING).lerp(HEARTWOOD, 0.35),
      );
    }
    const centre = this.vertex(centreAt[0], centreAt[1], centreAt[2], HEARTWOOD);
    this.fan(centre, inner, sides, flip);
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      const a = ring + side;
      const b = ring + next;
      const c = inner + side;
      const d = inner + next;
      if (flip) this.indices.push(a, c, b, b, c, d);
      else this.indices.push(a, b, c, b, d, c);
    }
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function barkColor(a, b, moss) {
  SCRATCH.copy(BARK_DARK).lerp(BARK, mottle(a, b));
  if (moss > 0) SCRATCH.lerp(MOSS, moss);
  return SCRATCH;
}

/** Cut stump: buttressed roots running into the soil, tilted saw cut, mossy north side. */
export function createStumpGeometry({ radius = 0.34, height = 0.62, roots = 5 } = {}) {
  const builder = new MeshBuilder();
  const sides = 15;
  const rings = 7;
  const cutTilt = 0.16;
  for (let ring = 0; ring < rings; ring += 1) {
    const t = ring / (rings - 1);
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      const lobe = Math.abs(Math.cos(angle * roots * 0.5 + 0.6)) ** 1.6;
      const uneven = 0.86 + 0.14 * Math.sin(angle * 2 + 1);
      const flare = (1 - t) ** 3;
      const reach = radius * (0.96 + 0.05 * Math.sin(angle * 7)) * (1 + flare * (0.35 + 1.5 * lobe)) * uneven;
      const x = Math.cos(angle) * reach;
      const z = Math.sin(angle) * reach;
      const moss = smoothstep(0.1, 0.8, Math.sin(angle) * 0.7 + 0.45 - t * 0.5 + (mottle(angle * 3, t * 6) - 0.5))
        * (1 - t * 0.5);
      builder.vertex(x, -0.12 + t * (height + 0.12) + (t === 1 ? x * cutTilt : 0), z, barkColor(angle * 4, t * 7, moss));
    }
  }
  builder.grid(0, rings, sides);
  builder.endGrain((rings - 1) * sides, sides, [0, height, 0], true);
  return builder.build();
}

/** Tapered bent trunk lying half in the soil, moss on what faces the sky, snapped ends. */
export function createFallenLogGeometry({ length = 3.6, radius = 0.24 } = {}) {
  const builder = new MeshBuilder();
  const sides = 9;
  const rings = 8;
  const half = length / 2;
  const ringCentre = (t) => [-half + t * length, radius * 0.55 + Math.sin(t * Math.PI) * 0.05, Math.sin(t * 2.6) * 0.22];
  for (let ring = 0; ring < rings; ring += 1) {
    const t = ring / (rings - 1);
    const [cx, cy, cz] = ringCentre(t);
    const reach = radius * (1 - 0.42 * t) * (1 + 0.06 * Math.sin(t * 9));
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      const up = Math.sin(angle);
      const moss = smoothstep(0.1, 0.75, up + (mottle(t * 9, angle * 2) - 0.5) * 0.9) * 0.92;
      builder.vertex(cx, cy + up * reach, cz + Math.cos(angle) * reach, barkColor(t * 10, angle * 3, moss));
    }
  }
  builder.grid(0, rings, sides);
  const foot = ringCentre(0);
  builder.endGrain(0, sides, [foot[0] - 0.05, foot[1], foot[2]], true);
  const tip = ringCentre(1);
  builder.endGrain((rings - 1) * sides, sides, [tip[0] + 0.12, tip[1] + 0.02, tip[2]], false);
  // A snapped limb, so the silhouette is a tree that fell and not a cylinder.
  const stub = builder.positions.length / 3;
  const base = ringCentre(0.62);
  for (let ring = 0; ring < 3; ring += 1) {
    const t = ring / 2;
    for (let side = 0; side < 5; side += 1) {
      const angle = (side / 5) * Math.PI * 2;
      const reach = 0.07 * (1 - t * 0.6);
      builder.vertex(
        base[0] + t * 0.22 + Math.cos(angle) * reach,
        base[1] + t * 0.42 + radius * 0.5,
        base[2] + 0.08 + t * 0.2 + Math.sin(angle) * reach,
        barkColor(t * 4, angle, 0),
      );
    }
  }
  builder.grid(stub, 3, 5);
  return builder.build();
}

/** A forked dead branch resting on the ground. */
export function createFallenBranchGeometry({ length = 2.2, radius = 0.045 } = {}) {
  const builder = new MeshBuilder();
  const limb = (from, to, startRadius) => {
    const first = builder.positions.length / 3;
    const rows = 4;
    for (let ring = 0; ring < rows; ring += 1) {
      const t = ring / (rows - 1);
      const reach = startRadius * (1 - t * 0.7);
      const kink = Math.sin(t * 5 + from[0]) * 0.04;
      for (let side = 0; side < 4; side += 1) {
        const angle = (side / 4) * Math.PI * 2;
        builder.vertex(
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t + Math.sin(angle) * reach,
          from[2] + (to[2] - from[2]) * t + kink + Math.cos(angle) * reach,
          barkColor(t * 6, angle, 0),
        );
      }
    }
    builder.grid(first, rows, 4);
  };
  const half = length / 2;
  limb([-half, 0.05, 0], [half, 0.03, 0.1], radius);
  limb([-half * 0.1, 0.05, 0.03], [half * 0.5, 0.12, 0.5], radius * 0.6);
  return builder.build();
}

/** A drift of fallen leaves: flat bent diamonds, denser toward the middle. */
export function createLeafLitterGeometry({ radius = 1.7, leaves = 72, seed = 0x51ea } = {}) {
  const builder = new MeshBuilder();
  const random = createRandom(seed);
  for (let index = 0; index < leaves; index += 1) {
    const distance = radius * Math.sqrt(random()) * (0.5 + random() * 0.5);
    const place = random() * Math.PI * 2;
    const yaw = random() * Math.PI * 2;
    const size = 0.05 + random() * 0.05;
    const x = Math.cos(place) * distance;
    const z = Math.sin(place) * distance;
    const y = 0.015 + random() * 0.03;
    // Each leaf its own value and a random share of decay, so a drift settles
    // into the litter instead of lying on it as one bright tone.
    const color = LEAVES[Math.floor(random() * LEAVES.length)].clone()
      .lerp(DECAYED, random() * 0.65).multiplyScalar(0.8 + random() * 0.35);
    const along = [Math.cos(yaw) * size, Math.sin(yaw) * size];
    const across = [-along[1] * 0.55, along[0] * 0.55];
    const first = builder.positions.length / 3;
    builder.vertex(x + along[0], y + 0.012, z + along[1], color);
    builder.vertex(x + across[0], y, z + across[1], color);
    builder.vertex(x - along[0], y + 0.012, z - along[1], color);
    builder.vertex(x - across[0], y, z - across[1], color);
    builder.indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
  }
  const geometry = builder.build();
  // Lying flat: lit as the ground they rest on, not as tilted cards.
  const normals = geometry.getAttribute('normal');
  for (let index = 0; index < normals.count; index += 1) normals.setXYZ(index, 0, 1, 0);
  return geometry;
}

/** A soft cushion of moss, lobed so it does not read as half a ball. */
export function createMossMoundGeometry({ radius = 0.85, height = 0.24 } = {}) {
  const builder = new MeshBuilder();
  const sides = 12;
  const rings = 4;
  for (let ring = 0; ring < rings; ring += 1) {
    const t = ring / (rings - 1);
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      const lobe = 1 + 0.2 * Math.sin(angle * 3 + 0.4) + 0.1 * Math.sin(angle * 5);
      const reach = radius * lobe * Math.cos(t * Math.PI * 0.46);
      SCRATCH.copy(MOSS).lerp(MOSS_LIGHT, mottle(angle * 3, t * 5) * (0.35 + t * 0.65));
      builder.vertex(Math.cos(angle) * reach, -0.03 + Math.sin(t * Math.PI * 0.5) * height, Math.sin(angle) * reach, SCRATCH);
    }
  }
  builder.grid(0, rings, sides);
  const top = builder.vertex(0, height, 0, MOSS_LIGHT);
  builder.fan(top, (rings - 1) * sides, sides, true);
  return builder.build();
}
