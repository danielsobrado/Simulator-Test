import * as THREE from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cross, dFdx, dFdy, dot, float, length, max, mix, normalWorldGeometry,
  normalize, positionWorld, pow, reflect, sign, smoothstep, texture, uniform, vec3,
} from 'three/tsl';

/**
 * Lighting shared by every material inside a location.
 *
 * Nothing here is a scene light. Lamps are baked into the vertices
 * (`gen/LightBake.js`), the cavern's bounce is a two-colour ambient, and the
 * walker carries one virtual lamp so normal maps and wet or icy highlights move
 * as they do. One location is active at a time, so the uniforms are module state.
 */
export const MAX_DYNAMIC_LIGHTS = 4;

const createDynamicLightSlot = () => ({
  position: uniform(new THREE.Vector3()),
  color: uniform(new THREE.Color(0x000000)),
  // x: range (metres), y: soft source radius (metres)
  params: uniform(new THREE.Vector3(1, 1, 0)),
});

export const locationLight = {
  ambientUp: uniform(new THREE.Color(0x0a0c10)),
  ambientDown: uniform(new THREE.Color(0x050506)),
  carriedPosition: uniform(new THREE.Vector3()),
  carriedColor: uniform(new THREE.Color(0x000000)),
  carriedRange: uniform(9),
  dynamicLights: Array.from({ length: MAX_DYNAMIC_LIGHTS }, createDynamicLightSlot),
  /** 1 while the walker stands under open sky, 0 under a roof: weather does not fall indoors. */
  outdoors: uniform(1),
};

export const viewDirection = normalize(cameraPosition.sub(positionWorld));
export const geometryNormal = normalize(normalWorldGeometry);
export const bakedLight = attribute('bakeLight', 'vec3');
export const bakedDirection = attribute('bakeDir', 'vec3');
/** x: ambient occlusion, y: metres of solid behind the surface, z: open to the sky (see `gen/LightBake.js`). */
export const bakedShade = attribute('bakeShade', 'vec3');

/** Projection weights for world-space texturing; `sharpness` narrows the seams. */
export function triplanarWeights(normal, sharpness = 5) {
  const weights = pow(abs(normal), vec3(sharpness));
  return weights.div(weights.x.add(weights.y).add(weights.z));
}

export function triplanarSample(map, point, weights, scale) {
  const p = point.mul(scale);
  return texture(map, p.zy).mul(weights.x).add(texture(map, p.xz).mul(weights.y)).add(texture(map, p.xy).mul(weights.z));
}

/** World-space normal from a tangent-space map projected on three axes. */
export function triplanarNormal(map, point, normal, weights, scale, strength) {
  const p = point.mul(scale);
  const tx = texture(map, p.zy).xy.mul(2).sub(1).mul(weights.x);
  const ty = texture(map, p.xz).xy.mul(2).sub(1).mul(weights.y);
  const tz = texture(map, p.xy).xy.mul(2).sub(1).mul(weights.z);
  const bend = vec3(ty.x.add(tz.x), tx.y.add(tz.y), tx.x.add(ty.y));
  return normalize(normal.add(bend.mul(strength)));
}

/** Tilts `normal` by the slope of a procedural `height` field (metres), without a tangent frame. */
export function bumpNormal(normal, height, strength) {
  const dpdx = dFdx(positionWorld), dpdy = dFdy(positionWorld);
  const r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
  const det = dot(dpdx, r1);
  const gradient = r1.mul(dFdx(height)).add(r2.mul(dFdy(height))).mul(sign(det));
  return normalize(normal.mul(abs(det)).sub(gradient.mul(strength)));
}

function highlight(normal, toLight, roughness) {
  const alpha = max(roughness, 0.06);
  const alpha2 = alpha.mul(alpha);
  const shininess = float(2).div(alpha2.mul(alpha2)).sub(2).clamp(2, 900);
  const half = normalize(toLight.add(viewDirection));
  return pow(clamp(dot(normal, half), 0, 1), shininess).mul(shininess.add(8).mul(0.04));
}

/**
 * Final colour of a location surface.
 *
 * @param {object} surface
 * @param {Node} surface.albedo
 * @param {Node} surface.normal detail normal in world space
 * @param {Node} surface.roughness
 * @param {Node|number} [surface.f0] reflectance at normal incidence
 * @param {Node|number} [surface.wrap] how far light wraps past the terminator: ~0.1 stone, ~0.9 ice and snow
 * @param {Node} [surface.emissive]
 * @param {Node|number} [surface.sheen] strength of a second, broad highlight: the wet gloss of ice
 */
export function shadeSurface({
  albedo, normal, roughness, f0 = 0.04, metalness = 0, wrap = 0.12, emissive = vec3(0), sheen = 0,
}) {
  const wrapped = (n, l) => clamp(dot(n, l).add(wrap).div(float(1).add(wrap)), 0, 1);
  const directionality = length(bakedDirection);
  const toLight = normalize(bakedDirection.add(vec3(0, 1e-4, 0)));
  // The bake shaded the vertex normal; move that to the detail normal where the light had a direction.
  const relight = mix(float(1), clamp(wrapped(normal, toLight).div(max(wrapped(geometryNormal, toLight), 0.22)), 0.35, 1.28),
    directionality);
  const occlusion = clamp(bakedShade.x, 0, 1);
  // Keep soft bounced fill & cool ambient legible in recessed corners while grounding timber, rails, and crevices.
  const diffuseAO = mix(float(0.40), float(1), occlusion);
  const localAO = mix(float(0.45), float(1), occlusion);
  const ambientAO = mix(float(0.48), float(1), occlusion);
  const specAO = occlusion.mul(occlusion);
  const ambient = mix(locationLight.ambientDown, locationLight.ambientUp, normal.y.mul(0.5).add(0.5)).mul(ambientAO);

  const toCarried = locationLight.carriedPosition.sub(positionWorld);
  const carriedDistance = length(toCarried);
  const carriedDirection = toCarried.div(carriedDistance.max(1e-3));
  const carriedFade = clamp(float(1).sub(pow(carriedDistance.div(max(locationLight.carriedRange, 1e-3)), 2)), 0, 1);
  const carried = locationLight.carriedColor
    .mul(carriedFade.mul(carriedFade))
    .div(carriedDistance.mul(carriedDistance).mul(0.18).add(1))
    .mul(localAO);

  const metallic = float(metalness);
  const gloss = clamp(float(1).sub(roughness), 0, 1);
  const fresnelBase = mix(vec3(f0), vec3(0.95), metallic);
  const ndotv = clamp(dot(normal, viewDirection), 0, 1);
  const grazing = pow(max(float(1).sub(ndotv), 1e-4), 5);
  // Rough dry stone and timber scatter grazing light instead of producing wet Fresnel streaks.
  const fresnelRoughScale = mix(gloss.mul(gloss), float(1), metallic);
  const fresnelMax = mix(fresnelBase, vec3(1), fresnelRoughScale);
  const fresnel = fresnelBase.add(max(fresnelMax.sub(fresnelBase), vec3(0)).mul(grazing));
  const dielectricSpec = gloss.mul(gloss).mul(mix(float(0.28), float(1), gloss));
  const specResponse = mix(dielectricSpec, gloss, metallic);
  const specTint = mix(vec3(1), albedo, metallic);
  const diffuseAlbedo = albedo.mul(float(1).sub(metallic.mul(0.54)));
  const mirrored = reflect(viewDirection.negate(), normal);
  const reflection = mix(locationLight.ambientDown, locationLight.ambientUp, mirrored.y.mul(0.5).add(0.5))
    .mul(fresnel).mul(specTint).mul(specResponse).mul(specAO).mul(mix(float(0.45), float(2.8), metallic));
  // Kept below 1: past it the lobe's exponent turns negative and a glancing highlight is infinite.
  const broad = clamp(float(roughness).mul(3), 0.4, 0.9);
  const lobes = (toSource) => highlight(normal, toSource, roughness).add(highlight(normal, toSource, broad).mul(sheen));

  let dynDiffuse = vec3(0);
  let dynSpecular = vec3(0);
  for (const slot of locationLight.dynamicLights) {
    const toDyn = slot.position.sub(positionWorld);
    const dynDist = length(toDyn);
    const dynDir = toDyn.div(dynDist.max(1e-3));
    const dynRange = max(slot.params.x, 1e-3);
    const dynRadius = max(slot.params.y, 0.75);
    const dynFade = clamp(float(1).sub(pow(dynDist.div(dynRange), 2)), 0, 1);
    const dynAtten = dynFade.mul(dynFade).div(float(1).add(pow(dynDist.div(dynRadius), 2)));
    const dynIrrad = slot.color.mul(dynAtten).mul(localAO);
    const dynSpecFace = clamp(dot(normal, dynDir).add(0.1), 0, 1);
    dynDiffuse = dynDiffuse.add(dynIrrad.mul(wrapped(normal, dynDir)));
    dynSpecular = dynSpecular.add(dynIrrad.mul(dynSpecFace).mul(lobes(dynDir)));
  }

  const bakedSpecFace = clamp(dot(normal, toLight).add(0.1), 0, 1);
  const carriedSpecFace = clamp(dot(normal, carriedDirection).add(0.1), 0, 1);
  const rawSpecular = bakedLight.mul(directionality).mul(bakedSpecFace).mul(lobes(toLight)).mul(specAO)
    .add(carried.mul(carriedSpecFace).mul(lobes(carriedDirection)).mul(specAO))
    .add(dynSpecular.mul(specAO))
    .mul(fresnel.mul(mix(float(1), float(1.35), metallic)).min(1))
    .mul(specTint)
    .mul(specResponse);
  const specLuma = dot(rawSpecular, vec3(0.2126, 0.7152, 0.0722));
  const specular = rawSpecular.div(specLuma.mul(0.25).add(1));

  // Soft highlight knee + ACES-friendly desaturation toward warm ivory-amber in bright warm pools.
  const rawDirect = bakedLight.mul(relight).mul(diffuseAO)
    .add(carried.mul(wrapped(normal, carriedDirection)))
    .add(dynDiffuse);
  const directLuma = dot(rawDirect, vec3(0.2126, 0.7152, 0.0722));
  const compressedLuma = directLuma.div(directLuma.mul(0.16).add(1));
  const softDirect = rawDirect.mul(compressedLuma.div(max(directLuma, 1e-4)));
  const warmRatio = clamp(rawDirect.r.sub(rawDirect.b).div(max(directLuma, 0.05)), 0, 1);
  const highlightTarget = mix(vec3(compressedLuma), vec3(compressedLuma).mul(vec3(1.04, 0.99, 0.90)), warmRatio);
  const desatShare = smoothstep(0.65, 3.2, directLuma).mul(0.42);
  const totalDiffuse = ambient.add(mix(softDirect, highlightTarget, desatShare));

  return diffuseAlbedo.mul(totalDiffuse).add(specular).add(reflection).add(emissive);
}

/** The node material every location surface uses: unlit by the scene, fogged by it. */
export function createLocationMaterial(name, colorNode) {
  const material = new THREE.MeshBasicNodeMaterial({ name, fog: true });
  material.colorNode = colorNode;
  return material;
}
