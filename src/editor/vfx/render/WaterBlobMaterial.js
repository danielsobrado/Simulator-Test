import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Break, Discard, Fn, If, Loop, abs, cameraPosition, clamp, dot, float, length, max, min, mix, normalize, positionWorld,
  pow, reflect, refract, sin, smoothstep, uniform, uniformArray, vec3, vec4,
} from 'three/tsl';
import * as THREE from 'three';

/** Spheres merged into one blob: a body and the lobes that orbit it. */
export const WATER_BLOB_LOBES = 5;
const MARCH_STEPS = 40;
const HIT_EPSILON = 0.004;

const WATER = vec3(0.05, 0.42, 0.85);
const GLOW = vec3(0.1, 0.62, 1);
const SKY_LOW = vec3(0.62, 0.78, 0.9);
const SKY_HIGH = vec3(0.24, 0.45, 0.7);

/** Polynomial smooth minimum: the lobes flow into one another. */
function smin(a, b, k) {
  const h = clamp(float(0.5).add(b.sub(a).mul(0.5).div(k)), 0, 1);
  return mix(b, a, h).sub(k.mul(h).mul(float(1).sub(h)));
}

/**
 * A floating mass of water drawn by raymarching a signed distance field inside
 * its bounding box: smoothly merged spheres whose surface ripples. Shaded by
 * hand from the VFX sun and sky uniforms (no scene lights, no viewport
 * textures), so it costs only the pixels of its box while a spell holds it.
 *
 * @param {object} lighting createVfxLightingUniforms
 */
export function createWaterBlobMaterial(lighting) {
  const lobes = uniformArray(Array.from({ length: WATER_BLOB_LOBES }, () => new THREE.Vector4(0, -1e5, 0, 0)), 'vec4');
  const blend = uniform(0.4);
  const wobble = uniform(0.05);
  const time = uniform(0);
  /** 0..1 fade for the rise and the collapse. */
  const presence = uniform(0);

  const field = Fn(([p]) => {
    let d = length(p.sub(lobes.element(0).xyz)).sub(lobes.element(0).w);
    for (let index = 1; index < WATER_BLOB_LOBES; index += 1) {
      const lobe = lobes.element(index);
      d = smin(d, length(p.sub(lobe.xyz)).sub(lobe.w), blend);
    }
    const ripple = sin(p.x.mul(7).add(time.mul(3.1))).mul(sin(p.y.mul(6).sub(time.mul(2.3))))
      .mul(sin(p.z.mul(7).add(time.mul(2.7))));
    return d.add(ripple.mul(wobble));
  });

  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  // One vec4: its alpha is the material's opacity, and the march is built once.
  material.colorNode = Fn(() => {
    const direction = normalize(positionWorld.sub(cameraPosition));
    // The box's front face is where the ray enters; march on through it.
    const t = length(positionWorld.sub(cameraPosition)).toVar();
    const limit = t.add(lobes.element(0).w.mul(6)).toVar();
    const hit = float(0).toVar();
    Loop(MARCH_STEPS, () => {
      const distance = field(cameraPosition.add(direction.mul(t)));
      If(distance.lessThan(HIT_EPSILON), () => { hit.assign(1); Break(); });
      t.addAssign(max(distance, HIT_EPSILON));
      If(t.greaterThan(limit), () => { Break(); });
    });
    Discard(hit.lessThan(0.5));
    const point = cameraPosition.add(direction.mul(t));
    // Tetrahedral gradient: four field reads for the normal.
    const e = 0.01;
    const n = normalize(
      vec3(1, -1, -1).mul(field(point.add(vec3(e, -e, -e))))
        .add(vec3(-1, -1, 1).mul(field(point.add(vec3(-e, -e, e)))))
        .add(vec3(-1, 1, -1).mul(field(point.add(vec3(-e, e, -e)))))
        .add(vec3(1, 1, 1).mul(field(point.add(vec3(e, e, e))))),
    );
    const view = direction.negate();
    const facing = clamp(dot(n, view), 0, 1);
    const fresnel = pow(float(1).sub(facing), 5).mul(0.96).add(0.04);
    const skyLight = lighting.ambientSky.mul(2.2).add(0.15);
    const skyAlong = (ray) => mix(SKY_LOW, SKY_HIGH, smoothstep(-0.1, 0.8, ray.y)).mul(skyLight);
    const sky = skyAlong(reflect(direction, n));
    const sun = normalize(lighting.sunDirection);
    const diffuse = lighting.ambientSky.add(lighting.sunColor.mul(max(dot(n, sun), 0)));
    // What the bent ray sees behind the body: sky above the horizon, sunlit
    // ground below it. The flipped horizon inside the globe reads as a water
    // lens without sampling the screen (a viewport texture costs every frame).
    const refracted = refract(direction, n, 1 / 1.33);
    const groundTone = lighting.ambientGround.mul(1.6).add(lighting.sunColor.mul(0.35));
    const behind = mix(groundTone, skyAlong(refracted), smoothstep(-0.08, 0.08, refracted.y));
    // Light focused through the body: two warped wave families crossing into a
    // caustic net, not parallel bands.
    const local = point.sub(lobes.element(0).xyz).add(n.mul(0.35));
    const warp = sin(dot(local, vec3(2.3, -4.1, 1.7)).add(time.mul(0.9))).mul(1.3);
    const waveA = sin(dot(local, vec3(5.1, 3.7, 4.3)).add(time.mul(1.4)).add(warp));
    const waveB = sin(dot(local, vec3(-3.9, 4.6, 2.2)).sub(time.mul(1.1)).sub(warp.mul(0.7)));
    const veins = pow(float(1).sub(min(abs(waveA), abs(waveB))), 9);
    const body = mix(behind, WATER.mul(diffuse.mul(0.45).add(0.3)), 0.55)
      .add(GLOW.mul(0.15)).add(GLOW.mul(veins).mul(0.4));
    const specular = pow(max(dot(reflect(sun.negate(), n), view), 0), 90).mul(lighting.sunColor).mul(2.5);
    // The reflection never drowns the body: a magic water reads saturated even edge-on.
    const color = mix(body, sky, fresnel.mul(0.4)).add(specular);
    return vec4(color, mix(float(0.62), float(0.96), fresnel).mul(presence));
  })();
  return { material, lobes, blend, wobble, time, presence };
}
