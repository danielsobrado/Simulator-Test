import * as THREE from 'three/webgpu';
import { beveledBox, beveledQuadPrism, quarterTurnUv } from '../ProceduralWorkshopGeometry.js';
import { mixSeed } from '../ProceduralRandom.js';

/**
 * A planar wall face and its local frame.
 *
 * Facade space is (u, y, d): `u` runs along the wall from `origin` in the
 * direction a viewer standing outside would call left-to-right, `y` is world
 * height and `d` is the distance out of the face (negative is inside the wall).
 * Every house detail — timber framing, windows, doors, signs — is authored in
 * this space and placed with `facadeMatrix`, so one routine serves all four
 * sides of any rectangular volume.
 */
export function createFacade({ origin, direction, length, y0, y1, thickness, side }) {
  const yaw = Math.atan2(-direction[1], direction[0]);
  return Object.freeze({
    origin: Object.freeze([...origin]),
    direction: Object.freeze([...direction]),
    normal: Object.freeze([Math.sin(yaw), Math.cos(yaw)]),
    yaw,
    length,
    y0,
    y1,
    thickness,
    side,
  });
}

/**
 * The four outer faces of an axis-aligned box, keyed front (+z), back (-z),
 * right (+x) and left (-x).
 */
export function boxFacades({ x0, x1, z0, z1, y0, y1, thickness = 0.3 }) {
  const width = x1 - x0;
  const depth = z1 - z0;
  return Object.freeze({
    front: createFacade({ origin: [x0, z1], direction: [1, 0], length: width, y0, y1, thickness, side: 'front' }),
    back: createFacade({ origin: [x1, z0], direction: [-1, 0], length: width, y0, y1, thickness, side: 'back' }),
    right: createFacade({ origin: [x1, z1], direction: [0, -1], length: depth, y0, y1, thickness, side: 'right' }),
    left: createFacade({ origin: [x0, z0], direction: [0, 1], length: depth, y0, y1, thickness, side: 'left' }),
  });
}

/** A free-standing facade, for gable ends and dormer fronts. */
export function facadeAt(origin, normal, length, y0 = 0, y1 = 0, thickness = 0.2) {
  // The along-direction is the outward normal turned a quarter clockwise.
  return createFacade({
    origin,
    direction: [normal[1], -normal[0]],
    length,
    y0,
    y1,
    thickness,
    side: 'free',
  });
}

/** A free-standing facade of `length`, centred on the world point (x, z). */
export function centredFacade([x, z], normal, length, y0 = 0, y1 = 0, thickness = 0.2) {
  const direction = [normal[1], -normal[0]];
  return facadeAt(
    [x - direction[0] * length / 2, z - direction[1] * length / 2],
    normal,
    length,
    y0,
    y1,
    thickness,
  );
}

export function facadeMatrix(facade) {
  return new THREE.Matrix4()
    .makeTranslation(facade.origin[0], 0, facade.origin[1])
    .multiply(new THREE.Matrix4().makeRotationY(facade.yaw));
}

/** World position of a facade-space point. */
export function facadePoint(facade, u, y, d = 0) {
  return [
    facade.origin[0] + facade.direction[0] * u + facade.normal[0] * d,
    y,
    facade.origin[1] + facade.direction[1] * u + facade.normal[1] * d,
  ];
}

/** Move geometry authored in facade space into the world. */
export function placeOnFacade(geometry, facade) {
  geometry.applyMatrix4(facadeMatrix(facade));
  return geometry;
}

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

function hewnHash(a, b) {
  const q = (v) => Math.round(v * 200);
  const k0 = q(a[0]) ^ Math.imul(q(a[1]), 0x9e3779b1) ^ Math.imul(q(a[2]), 0x85ebca6b);
  const k1 = q(b[0]) ^ Math.imul(q(b[1]), 0xc2b2ae35) ^ Math.imul(q(b[2]), 0x27d4eb2f);
  return mixSeed(0x6c8e9cf5, k0 ^ k1);
}

function laneSigned(hash, shift) {
  return ((((hash >>> shift) & 255) / 255) - 0.5) * 2;
}

/**
 * A squared hand-hewn timber (or stone lintel) between two world points.
 *
 * The long axis runs `a` → `b`. `side` is the direction the beam's width faces;
 * it defaults to horizontal-perpendicular, which keeps posts, rails and braces
 * flat against the facade they are framing.
 */
export function beamBetween(a, b, size, {
  depth = size,
  side = null,
  bevelRatio = 0.165,
  detail = 2,
  taper = 0,
  hewn = true,
} = {}) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const axis = end.clone().sub(start);
  const length = axis.length();
  if (length < 1e-4) return null;
  axis.normalize();
  const orthogonal = (candidate) => candidate.addScaledVector(axis, -candidate.dot(axis));
  // Fall back when the requested side runs along the beam (a joist projecting
  // along the facade normal), then when the beam is vertical.
  let widthAxis = orthogonal(side ? new THREE.Vector3(...side) : new THREE.Vector3());
  if (widthAxis.lengthSq() < 1e-6) widthAxis = orthogonal(new THREE.Vector3().crossVectors(UP, axis));
  if (widthAxis.lengthSq() < 1e-6) widthAxis = orthogonal(X_AXIS.clone());
  widthAxis.normalize();
  const depthAxis = new THREE.Vector3().crossVectors(widthAxis, axis).normalize();
  const hash = hewnHash(a, b);
  const rollWobble = hewn ? laneSigned(hash, 0) * 0.018 : 0;
  const center = start.add(end).multiplyScalar(0.5);
  let beam;
  if (hewn && (Math.abs(taper) > 1e-4 || length > 0.35)) {
    // Right-handed basis: X (`faceAxis = axis × widthAxis`) in the facade plane,
    // Y (`axis`) along the beam, Z (`widthAxis`) along the outward normal, so
    // `beveledQuadPrism`'s 4-corner silhouette shapes the visible timber face.
    const faceAxis = new THREE.Vector3().crossVectors(axis, widthAxis).normalize();
    const rotation = new THREE.Euler().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(faceAxis, axis, widthAxis),
    );
    const halfW = Math.max(0.025, depth / 2);
    const halfH = Math.max(0.025, length / 2);
    const bottomSpread = halfW * (1 + taper * 0.5 + laneSigned(hash, 8) * 0.055);
    const topSpread = halfW * Math.max(0.55, 1 - taper * 0.5 + laneSigned(hash, 16) * 0.055);
    const swayBottom = laneSigned(hash, 24) * Math.min(0.018, halfW * 0.14);
    const swayTop = -swayBottom * 0.7;
    const endCutBottom = laneSigned(hash, 4) * Math.min(0.014, halfH * 0.04);
    const endCutTop = laneSigned(hash, 12) * Math.min(0.014, halfH * 0.04);
    beam = beveledQuadPrism({
      corners: [
        [-bottomSpread + swayBottom, -halfH - endCutBottom],
        [bottomSpread + swayBottom, -halfH + endCutBottom],
        [topSpread + swayTop, halfH + endCutTop],
        [-topSpread + swayTop, halfH - endCutTop],
      ],
      depth: size * (1 + laneSigned(hash, 20) * 0.045),
      position: center.toArray(),
      rotation: [rotation.x, rotation.y, rotation.z + rollWobble],
      detail,
      bevelRatio,
    });
  } else {
    // beveledBox is width (x) × height (y) × depth (z): y is the long axis.
    const rotation = new THREE.Euler().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(widthAxis, axis, depthAxis),
    );
    beam = beveledBox({
      width: size,
      height: length,
      depth,
      position: center.toArray(),
      rotation: [rotation.x, rotation.y, rotation.z + rollWobble],
      detail,
      bevelRatio,
    });
  }
  // Grain along the member: studs, posts and steep braces turn theirs upright.
  return Math.abs(axis.y) > Math.SQRT1_2 ? quarterTurnUv(beam) : beam;
}

/**
 * A timber between two facade-space points, already placed in the world.
 *
 * `size` is the face width a viewer sees in the wall plane; `proud` is how far
 * the member stands out of it, measured along the facade normal.
 */
export function facadeBeam(facade, [u0, y0, d0], [u1, y1, d1], size, { proud = size * 0.72, ...options } = {}) {
  const [nx, nz] = facade.normal;
  return beamBetween(
    facadePoint(facade, u0, y0, d0),
    facadePoint(facade, u1, y1, d1),
    proud,
    { ...options, depth: size, side: [nx, 0, nz] },
  );
}

/**
 * A protruding wooden joinery peg (trenail) at a timber post/rail or brace joint.
 */
export function facadePeg(facade, u, y, d = 0.05, size = 0.046) {
  return beveledBox({
    width: size,
    height: size,
    depth: size * 1.65,
    position: facadePoint(facade, u, y, d),
    rotation: [0, facade.yaw, Math.PI * 0.25],
    detail: 1,
    bevelRatio: 0.22,
  });
}

/**
 * A heavy, hand-hewn structural timber column standing proud of a facade, with
 * a flared foot plinth/collar, gently tapered adze-hewn shaft, capital collar,
 * and optional projecting top tenon peg (as seen on the doorway and corner
 * columns of the reference cottage).
 */
export function addFacadeColumn(kit, facade, u, y0, y1, {
  size = 0.23,
  proud = 0.13,
  d = 0.03,
  foot = true,
  capital = true,
  tenon = false,
  pegs = true,
} = {}) {
  const height = y1 - y0;
  if (height < 0.25) return;
  if (foot && height > 0.7) {
    const footHeight = Math.min(0.24, height * 0.12);
    kit.add('wood', facadeBeam(
      facade,
      [u, y0, d + 0.012],
      [u, y0 + footHeight, d + 0.012],
      size * 1.18,
      { proud: proud * 1.18, taper: 0.16, bevelRatio: 0.18 },
    ));
  }
  kit.add('wood', facadeBeam(
    facade,
    [u, y0, d],
    [u, y1, d],
    size,
    { proud, taper: 0.08, bevelRatio: 0.18 },
  ));
  if (capital && height > 0.9) {
    const capHeight = Math.min(0.14, height * 0.08);
    kit.add('wood', facadeBeam(
      facade,
      [u, y1 - capHeight, d + 0.01],
      [u, y1, d + 0.01],
      size * 1.14,
      { proud: proud * 1.14, taper: -0.12, bevelRatio: 0.18 },
    ));
  }
  if (tenon) {
    kit.add('wood', facadeBeam(
      facade,
      [u, y1, d - 0.01],
      [u, y1 + 0.11, d - 0.01],
      size * 0.56,
      { proud: proud * 0.75, taper: 0.28, bevelRatio: 0.22 },
    ));
  }
  if (pegs && height > 1.1) {
    kit.add('wood', facadePeg(facade, u, y0 + Math.min(0.32, height * 0.16), d + proud * 0.52));
    kit.add('wood', facadePeg(facade, u, y1 - Math.min(0.24, height * 0.12), d + proud * 0.52));
  }
}
