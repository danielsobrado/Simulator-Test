import { PhysicalLightingModel } from 'three/webgpu';

/**
 * Standard lighting plus snow's sun-only response (glints, transmitted light).
 * `lightColor` already carries the shadow map and cloud shadow, so neither can
 * glow in shade, the way the same terms added as emission did.
 */
export class SnowLightingModel extends PhysicalLightingModel {
  /** @param {object} sunResponse vec3 per unit of incoming sun light */
  constructor(sunResponse) {
    super();
    this.sunResponse = sunResponse;
  }

  direct(input, builder) {
    super.direct(input, builder);
    if (input.lightNode?.light?.isDirectionalLight) {
      // 1/π, as the Lambert lobe, keeps the old emissive scale against lit snow.
      input.reflectedLight.directSpecular.addAssign(input.lightColor.mul(this.sunResponse).mul(1 / Math.PI));
    }
  }
}

/** Gives `material` snow's sun response on top of its standard lighting. */
export function applySnowLighting(material, sunResponse) {
  material.setupLightingModel = () => new SnowLightingModel(sunResponse);
  return material;
}
