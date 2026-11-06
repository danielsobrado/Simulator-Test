import { Fn, If, Loop, Break, cameraViewMatrix, float, mix, normalViewGeometry, positionView, positionViewDirection, texture, vec2, vec4 } from 'three/tsl';
import { foliageLight } from './foliageLight.js';
import { frameUniform } from '../../../render/FrameUniforms.js';

/** Offline atlases contain dry, view-independent reflectance. */
export const barkParallaxWeight = frameUniform(1);

/** Derivative frame includes instance scale/rotation and wind deformation.
 * Explicit gradients keep texture LOD valid in the distance branch and loop.
 */
export function barkParallax(map, coords, channel, settings, { authoredTransform = false } = {}) {
  const dx = coords.dFdx(), dy = coords.dFdy();
  const px = positionView.dFdx(), py = positionView.dFdy();
  const n = normalViewGeometry;
  const tx = py.cross(n), ty = n.cross(px);
  const t = tx.mul(dx.x).add(ty.mul(dy.x));
  const b = tx.mul(dx.y).add(ty.mul(dy.y));
  const frameScale = t.dot(t).max(b.dot(b)).max(1e-8).inverseSqrt();
  const tangent = t.mul(frameScale), bitangent = b.mul(frameScale);
  const view = vec2(positionViewDirection.dot(tangent), positionViewDirection.dot(bitangent))
    .div(positionViewDirection.dot(n).abs().max(0.25));
  const fade = positionView.length().smoothstep(settings.near, settings.far).oneMinus().mul(barkParallaxWeight);
  const transformed = authoredTransform ? texture(map).getTransformedUV(coords) : coords;
  const gx = transformed.dFdx(), gy = transformed.dFdy();
  const sample = at => texture(map, at).setUpdateMatrix(authoredTransform).grad(gx, gy)[channel];
  const shifted = Fn(() => {
    const result = coords.toVar();
    If(fade.greaterThan(0), () => {
      const delta = view.mul(settings.scale).mul(fade).div(settings.steps);
      const depth = float(0).toVar(), at = coords.toVar();
      const previousDepth = float(0).toVar(), previousHeight = float(1).toVar();
      const height = sample(at).oneMinus().toVar();
      Loop(settings.steps, () => {
        If(depth.greaterThanEqual(height), () => Break());
        previousDepth.assign(depth); previousHeight.assign(height);
        at.subAssign(delta); depth.addAssign(1 / settings.steps);
        height.assign(sample(at).oneMinus());
      });
      const before = previousHeight.sub(previousDepth);
      const after = height.sub(depth);
      const weight = before.div(before.sub(after).max(1e-5)).clamp(0, 1);
      result.assign(mix(at.add(delta), at, weight));
    });
    return result;
  })();
  const shadow = Fn(() => {
    const visibility = float(1).toVar();
    If(fade.greaterThan(0), () => {
      const light = cameraViewMatrix.mul(vec4(foliageLight.sunDirection, 0)).xyz;
      const cosine = light.dot(n);
      If(cosine.greaterThan(0.05), () => {
        const direction = vec2(light.dot(tangent), light.dot(bitangent)).div(cosine.max(0.25));
        const base = sample(shifted);
        const horizon = float(0).toVar();
        // Three bounded relief-shadow taps, restricted to direct sun by the material.
        for (let i = 1; i <= 3; i++) {
          const distance = i / 3;
          const obstruction = sample(shifted.add(direction.mul(settings.scale * distance)))
            .sub(base).sub(distance * 0.35).max(0);
          horizon.assign(horizon.max(obstruction));
        }
        visibility.assign(horizon.mul(settings.shadowStrength * 4).mul(fade).clamp(0, 0.65).oneMinus());
      });
    });
    return visibility;
  })();
  return { uv: shifted, shadow };
}
