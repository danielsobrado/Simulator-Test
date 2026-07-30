/**
 * The fabric surface — shared by the skinned body and the simulated garments.
 *
 * A plain PBR dielectric is the wrong model for cloth and looks it. What carries
 * the difference here:
 *
 *   sheen        A retroreflective lobe from fibres standing proud of the
 *                surface. It is why wool has a bright *rim* rather than a bright
 *                highlight, and on this figure it is doing double duty: the
 *                piwafwi's violet sheen is what makes a near-black cloak read as
 *                a drow cloak rather than as a dark coat. Supplied through
 *                `MeshPhysicalNodeMaterial.sheenNode`, so it is three.js's own
 *                Charlie lobe and sits in the same lighting as everything else.
 *   weave        A procedural thread lattice far below the geometry's scale,
 *                faded out by pixel footprint so it never aliases. It supplies a
 *                cavity and a roughness break-up everywhere, and on the garments
 *                — where the vertex program hands us real surface tangents — a
 *                normal perturbation as well. The body has no tangent frame, so
 *                it gets the cavity and not the bump; at the distance a forearm
 *                is read that difference is invisible, and inventing a tangent
 *                frame for it would cost a seventh vertex attribute.
 *   streak       An anisotropic highlight along the hair's flow. Computed
 *                explicitly against the scene sun rather than through three.js's
 *                `anisotropy` input, which needs a tangent frame the material
 *                system would have to derive from a `position` attribute that is
 *                a parameter triple rather than a location.
 *   sigil        The house web on the trim. Procedural, masked to one slot.
 */

import * as THREE from 'three';
import {
  abs, atan, attribute, clamp, cos, dot, float, fract, fwidth, int, length,
  max, mix, normalize, pow, sin, smoothstep, sqrt, uniform, uniformArray, uv, vec3,
  cameraPosition, positionWorld,
} from 'three/tsl';
import { M_TRIM } from '../materialSlots.js';

const TWO_PI = Math.PI * 2;

function toVector4Array(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 4) {
    out.push(new THREE.Vector4(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]));
  }
  return out;
}

/**
 * @param {object} options
 * @param {ReturnType<import('./DrowPalette.js').createDrowPalette>} options.palette
 * @param {THREE.Vector3} options.sunDirection shared, live vector from the sky
 * @param {number} options.weaveDensity threads per metre
 * @param {{ tangentU: Node, tangentV: Node } | null} [options.tangents]
 */
export function createDrowFabricNodes({
  palette, sunDirection, weaveDensity, tangents = null,
}) {
  const albedoArray = uniformArray(toVector4Array(palette.albedo), 'vec4');
  const paramsArray = uniformArray(toVector4Array(palette.params), 'vec4');
  const sheenArray = uniformArray(toVector4Array(palette.sheenTint), 'vec4');

  // Live uniforms the view drives each frame.
  const sun = uniform(sunDirection);
  const eyeGlow = uniform(1);
  const density = uniform(weaveDensity);

  const aux = attribute('aux', 'vec2');
  // The slot is constant across every triangle — no loft spans two materials —
  // so the interpolated float is exact. Rounded rather than truncated anyway,
  // because "exact" and "exact after a rasteriser has been at it" differ.
  const slot = int(aux.x.add(0.5));
  /** Baked cavity occlusion; on the eyes it is the almond's falloff instead. */
  const baked = aux.y;

  const albedoSlot = albedoArray.element(slot);
  const paramsSlot = paramsArray.element(slot);
  const sheenSlot = sheenArray.element(slot);

  // ---- weave ------------------------------------------------------------
  // UVs arrive in metres of surface, so this is the only place the physical
  // scale of the cloth is decided.
  const weaveUv = uv().mul(density);
  const warp = sin(weaveUv.x.mul(TWO_PI));
  const weft = sin(weaveUv.y.mul(TWO_PI));
  const weaveHeight = warp.mul(weft);
  // Faded by pixel footprint: once a pixel covers more than about one thread the
  // lattice is pure aliasing, so it is gone before it can shimmer.
  const footprint = length(fwidth(weaveUv));
  const weaveFade = clamp(float(1).sub(footprint), 0, 1);
  const weaveDepth = paramsSlot.w.mul(weaveFade);
  // The crevice between threads is darker and rougher than the thread crown.
  const weaveCavity = float(1).sub(weaveHeight.mul(-0.5).add(0.5).mul(0.30).mul(weaveDepth));

  // ---- house sigil ------------------------------------------------------
  // A spider web, tiled across the trim and nothing else. Drow heraldry is the
  // one place on this figure that is allowed to be legible.
  const sigilUv = uv().mul(6.0);
  const cell = fract(sigilUv).sub(0.5);
  const radius = length(cell);
  const angle = atan(cell.y, cell.x);
  const spokes = pow(abs(sin(angle.mul(4))), 24);
  const rings = pow(abs(sin(radius.mul(Math.PI * 5))), 16);
  const web = max(spokes, rings)
    .mul(smoothstep(0.44, 0.34, radius))
    .mul(weaveFade);
  const isTrim = float(1).sub(abs(float(slot).sub(M_TRIM))).max(0);
  const sigil = web.mul(isTrim);

  // ---- colour -----------------------------------------------------------
  const baseAlbedo = albedoSlot.xyz.mul(baked).mul(weaveCavity);
  // The web lifts the trim toward silver rather than recolouring it, so the
  // sigil reads at distance without turning the band into a decal.
  const colorNode = mix(baseAlbedo, baseAlbedo.mul(1.9).add(vec3(0.10, 0.09, 0.14)), sigil);

  const roughnessNode = clamp(
    albedoSlot.w.add(weaveHeight.mul(0.12).mul(weaveDepth)).sub(sigil.mul(0.20)),
    0.05, 1.0,
  );

  const sheenNode = sheenSlot.xyz.mul(paramsSlot.x);

  // ---- emissive ---------------------------------------------------------
  // Only the eyes emit. `baked` is the almond's falloff, so the centre burns and
  // the rim feathers instead of cutting a hard ellipse out of the face.
  const emissiveNode = sheenSlot.xyz
    .mul(sheenSlot.w)
    .mul(baked)
    .mul(eyeGlow);

  /**
   * Anisotropic hair highlight, Kajiya-Kay.
   *
   * Only meaningful where a flow direction exists, so it is gated on the palette
   * `streak` channel and returns nothing at all without tangents.
   */
  function hairStreak() {
    if (!tangents) return vec3(0);
    const flow = normalize(tangents.tangentV);
    const view = normalize(cameraPosition.sub(positionWorld));
    const half = normalize(normalize(sun).add(view));
    const tdoth = dot(flow, half);
    const sinTh = sqrt(clamp(float(1).sub(tdoth.mul(tdoth)), 0, 1));
    // Two lobes: a tight primary along the flow and a broad secondary, which is
    // what gives real hair its double band rather than one hard line.
    const primary = pow(sinTh, 90).mul(0.65);
    const secondary = pow(sinTh, 14).mul(0.18);
    return sheenSlot.xyz.mul(primary.add(secondary)).mul(paramsSlot.y).mul(baked);
  }

  /**
   * Perturb a normal by the weave. Needs the surface tangents, so garments only.
   */
  function weaveNormal(base) {
    if (!tangents) return base;
    const t = normalize(tangents.tangentU);
    const b = normalize(tangents.tangentV);
    const dU = cos(weaveUv.x.mul(TWO_PI)).mul(weft);
    const dV = sin(weaveUv.x.mul(TWO_PI)).mul(cos(weaveUv.y.mul(TWO_PI)));
    const bump = t.mul(dU).add(b.mul(dV)).mul(weaveDepth.mul(0.06));
    return normalize(base.sub(bump));
  }

  return {
    slot,
    baked,
    colorNode,
    roughnessNode,
    sheenNode,
    emissiveNode,
    hairStreak,
    weaveNormal,
    /** Live handles the view writes each frame. */
    uniforms: { sun, eyeGlow, density },
    /** Transmission is per-slot; the caller decides whether to use it. */
    transmissionNode: paramsSlot.z,
  };
}
