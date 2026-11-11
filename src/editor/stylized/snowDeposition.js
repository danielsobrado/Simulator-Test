import * as THREE from 'three/webgpu';
import { attribute, dot, float, max, normalize, normalLocal, normalWorld, positionGeometry, varying, vec2, vec3 } from 'three/tsl';
import { PREVAILING_WIND } from '../materials/SnowAccumulation.js';

/**
 * Where snow lies on a scattered object (a boulder, a crag, a shrub), 0..1, so
 * it reads as buried in the snowfield rather than set down on it:
 *
 *   cap     faces turned up take it; a heavier fall reaches shallower faces;
 *   faces   vertical faces shed it unless sheltered;
 *   cavity  recesses (a face turned in from the object's centre) hold more;
 *   lee     faces turned downwind of the bake's PREVAILING_WIND carry a drift
 *           banked up their lower half, as the terrain's own lee slopes do;
 *   scour   the windward foot is scooped out, the skirt sitting lower there;
 *   skirt   a band above the ground line, deepest in the lee, in the terrain's
 *           snow colour so the object's foot runs into the baked snow.
 *
 * The snow amount moves the edges, not the opacity: a light fall leaves only
 * the flattest tops and a low skirt white, rather than a grey film over the
 * whole stone. Edges are narrow and torn by the breakup noise, as settled snow
 * meets rock in a line, not a gradient.
 *
 * Pure normal and object-space arithmetic: no texture, no light.
 */
/** The terrain bake's snow (terrain-material-bake.yaml render.snowColor), for the skirt. */
export const SNOW_GROUND_COLOR = '#e8eef2';
const WIND = vec2(...PREVAILING_WIND).normalize();
/** Up-facing value where a full fall starts to cap a face, and how much higher a trace of snow starts. */
const CAP_START = 0.58;
const CAP_LIGHT = 0.4;
const CAP_WIDTH = 0.1;
/** Skirt height as a share of the object's height above the ground line, under a full fall. */
const SKIRT = 0.13;
/** How much higher the skirt climbs a lee face, and how much lower it sits on the windward one. */
const SKIRT_LEE = 0.08;
const SKIRT_SCOUR = 0.04;
/** Drift up a lee face, as a share of the object's height. */
const LEE_DRIFT = 0.22;
/** Softness of the skirt's top edge, in the same share. */
const SKIRT_EDGE = 0.025;

/**
 * Welds a faceted stone's normals into one smooth normal per position, as the
 * `snowNormal` attribute. Snow decided from the flat face normal fills a facet
 * edge to edge and stops at its border, drawing white triangles and straight
 * lines; from the welded normal the snow line runs across facets instead.
 * Object space: valid for the cap only while instances turn about y alone.
 */
export function bakeSnowNormal(geometry) {
  if (geometry.getAttribute('snowNormal')) return geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const vertexAt = (i) => (index ? index.getX(i) : i);
  const key = (v) => `${Math.round(position.getX(v) * 1e4)},${Math.round(position.getY(v) * 1e4)},${Math.round(position.getZ(v) * 1e4)}`;
  const sums = new Map();
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  for (let i = 0; i + 2 < count; i += 3) {
    const v = [vertexAt(i), vertexAt(i + 1), vertexAt(i + 2)];
    a.fromBufferAttribute(position, v[0]);
    b.fromBufferAttribute(position, v[1]).sub(a);
    c.fromBufferAttribute(position, v[2]).sub(a);
    // Area-weighted: the cross product's length is twice the triangle's area.
    const face = b.clone().cross(c);
    for (const vertex of v) {
      const k = key(vertex);
      sums.set(k, (sums.get(k) ?? new THREE.Vector3()).add(face));
    }
  }
  const normals = new Float32Array(position.count * 3);
  const n = new THREE.Vector3();
  for (let v = 0; v < position.count; v += 1) {
    n.copy(sums.get(key(v)) ?? UP_VECTOR);
    if (n.lengthSq() < 1e-12) n.copy(UP_VECTOR);
    n.normalize().toArray(normals, v * 3);
  }
  geometry.setAttribute('snowNormal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}
const UP_VECTOR = new THREE.Vector3(0, 1, 0);

/**
 * @param {object} options
 * @param {object} options.snow per-instance snow amount node, 0..1
 * @param {object} [options.breakup] noise node in about -0.5..0.5 that tears the edges
 * @param {number[]} [options.centre] object-space centre, for cavities; omitted skips them
 * @param {number} [options.groundY] object-space y of the ground line; omitted skips the skirt and drift
 * @param {number} [options.height] object-space height above the ground line
 * @param {boolean} [options.smoothNormal] read the cap and cavities from `snowNormal` (bakeSnowNormal)
 * @returns {{ cover: object, skirt: object }} cover includes the skirt; skirt alone picks the terrain snow colour
 */
export function snowDeposition({ snow, breakup = float(0), centre = null, groundY = null, height = 1, smoothNormal = false }) {
  const welded = smoothNormal ? varying(attribute('snowNormal', 'vec3')) : null;
  const up = welded ? welded.y : normalWorld.y;
  const surfaceLocal = welded ?? normalLocal;
  const facing = dot(normalWorld.xz, WIND);
  const lee = facing.clamp(0, 1);
  const depth = snow.clamp(0, 1);
  // A trace switches it off, and taiga's 0.1 is a trace: at smoothstep(0.02, 0.12) its
  // boulders stood capped white on green ground. Any real fall is drawn at full white.
  const present = depth.smoothstep(0.08, 0.3);
  const cavity = centre
    // A convex stone's faces sit well out along their radius; only faces turned in from it are recesses.
    // Per vertex: it varies smoothly over a stone, and the fragment pass is the expensive one.
    ? varying(float(0.35).sub(dot(surfaceLocal, normalize(positionGeometry.sub(vec3(...centre))))).mul(1.5).clamp(0, 1))
    : float(0);
  const start = float(CAP_START).add(depth.oneMinus().mul(CAP_LIGHT)).sub(cavity.mul(0.25));
  const cap = up.add(breakup.mul(0.45)).smoothstep(start, start.add(CAP_WIDTH));
  if (groundY === null) return { cover: cap.mul(present), skirt: float(0) };

  const level = varying(positionGeometry.y.sub(groundY).div(Math.max(1e-3, height)));
  // Deeper snow buries more of the foot; the root keeps a light fall from sitting as high as a heavy one.
  const fill = depth.sqrt();
  // Banked against the lee face, tallest straight downwind and tapering round the
  // sides like a drift tail; not under an overhang. Crisp-topped, like the skirt.
  // WGSL leaves smoothstep undefined for reversed edges, so falling ramps are oneMinus.
  // Gentle in lee: these stones are faceted, and a steep lee term stepped the snow
  // line at every facet edge, drawing it as straight vertical cuts.
  const driftTop = facing.smoothstep(-0.3, 1).mul(fill).mul(LEE_DRIFT).mul(breakup.mul(0.6).add(1)).max(0.01);
  const drift = level.smoothstep(driftTop.sub(SKIRT_EDGE), driftTop).oneMinus().mul(up.smoothstep(-0.45, 0.1));
  const scour = facing.negate().clamp(0, 1);
  const skirtTop = float(SKIRT).add(lee.mul(SKIRT_LEE)).sub(scour.mul(SKIRT_SCOUR))
    .add(breakup.mul(0.22)).mul(fill).max(0.02);
  const skirt = level.smoothstep(skirtTop.sub(SKIRT_EDGE), skirtTop).oneMinus();
  return { cover: max(max(cap, drift), skirt).mul(present), skirt: skirt.mul(present) };
}
