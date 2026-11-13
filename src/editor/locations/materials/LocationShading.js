import * as THREE from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cross, dFdx, dFdy, dot, float, length, max, mix, normalWorldGeometry,
  normalize, positionWorld, pow, reflect, sign, texture, uniform, vec3,
} from 'three/tsl';

/**
 * Lighting shared by every material inside a location.
 *
 * Nothing here is a scene light. Lamps are baked into the vertices
 * (`gen/LightBake.js`), the cavern's bounce is a two-colour ambient, and the
 * walker carries one virtual lamp so normal maps and wet or icy highlights move
 * as they do. One location is active at a time, so the uniforms are module state.
 */
export const locationLight = {
  ambientUp: uniform(new THREE.Color(0x0a0c10)),
  ambientDown: uniform(new THREE.Color(0x050506)),
  carriedPosition: uniform(new THREE.Vector3()),
  carriedColor: uniform(new THREE.Color(0x000000)),
  carriedRange: uniform(9),
};

export const viewDirection = normalize(cameraPosition.sub(positionWorld));
export const geometryNormal = normalize(normalWorldGeometry);
export const bakedLight = attribute('bakeLight', 'vec3');
export const bakedDirection = attribute('bakeDir', 'vec3');
/** x: ambient occlusion, y: metres of solid behind the surface. */
export const bakedShade = attribute('bakeShade', 'vec2');

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
  const shininess = float(2).div(pow(max(roughness, 0.06), 4)).sub(2).min(900);
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
 */
export function shadeSurface({ albedo, normal, roughness, f0 = 0.04, metalness = 0, wrap = 0.12, emissive = vec3(0) }) {
  const wrapped = (n, l) => clamp(dot(n, l).add(wrap).div(float(1).add(wrap)), 0, 1);
  const directionality = length(bakedDirection);
  const toLight = normalize(bakedDirection.add(vec3(0, 1e-4, 0)));
  // The bake shaded the vertex normal; move that to the detail normal where the light had a direction.
  const relight = mix(float(1), clamp(wrapped(normal, toLight).div(max(wrapped(geometryNormal, toLight), 0.2)), 0, 2.4),
    directionality);
  const occlusion = bakedShade.x;
  const ambient = mix(locationLight.ambientDown, locationLight.ambientUp, normal.y.mul(0.5).add(0.5)).mul(occlusion);

  const toCarried = locationLight.carriedPosition.sub(positionWorld);
  const carriedDistance = length(toCarried);
  const carriedDirection = toCarried.div(carriedDistance.max(1e-3));
  const carried = locationLight.carriedColor
    .mul(pow(clamp(float(1).sub(carriedDistance.div(locationLight.carriedRange)), 0, 1), 2))
    .div(carriedDistance.mul(carriedDistance).mul(0.06).add(1)).mul(occlusion.mul(0.5).add(0.5));

  const metallic = float(metalness);
  const fresnelBase = mix(vec3(f0), vec3(0.95), metallic);
  const fresnel = fresnelBase.add(vec3(1).sub(fresnelBase).mul(pow(float(1).sub(clamp(dot(normal, viewDirection), 0, 1)), 5)));
  const gloss = float(1).sub(roughness);
  const specTint = mix(vec3(1), albedo, metallic);
  const diffuseAlbedo = albedo.mul(float(1).sub(metallic.mul(0.62)));
  const mirrored = reflect(viewDirection.negate(), normal);
  const reflection = mix(locationLight.ambientDown, locationLight.ambientUp, mirrored.y.mul(0.5).add(0.5))
    .mul(fresnel).mul(specTint).mul(gloss.mul(gloss)).mul(occlusion).mul(mix(float(2.4), float(5.2), metallic));
  const specular = bakedLight.mul(directionality).mul(highlight(normal, toLight, roughness))
    .add(carried.mul(highlight(normal, carriedDirection, roughness)))
    .mul(fresnel.mul(3.5).min(1)).mul(specTint).mul(gloss);

  return diffuseAlbedo.mul(ambient.add(bakedLight.mul(relight)).add(carried.mul(wrapped(normal, carriedDirection))))
    .add(specular).add(reflection).add(emissive);
}

/** The node material every location surface uses: unlit by the scene, fogged by it. */
export function createLocationMaterial(name, colorNode) {
  const material = new THREE.MeshBasicNodeMaterial({ name, fog: true });
  material.colorNode = colorNode;
  return material;
}
