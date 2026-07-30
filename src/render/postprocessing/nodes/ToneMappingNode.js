import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  max,
  pow,
  renderOutput,
  screenUV,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';

const EPSILON = 1e-5;
const MIDDLE_GREY = 0.18;
const LUMINANCE_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722]);

const TONE_MAPPING_MODES = Object.freeze({
  agx: THREE.AgXToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  neutral: THREE.NeutralToneMapping,
  none: THREE.NoToneMapping,
});

export function toneMappingConstantForMode(mode) {
  return TONE_MAPPING_MODES[mode] ?? THREE.NoToneMapping;
}

export function toneMappingAdjustmentsReference(
  colour,
  {
    exposure = 1,
    bloom = [0, 0, 0],
    bloomIntensity = 0,
    contrast = 1,
    saturation = 1,
    epsilon = EPSILON,
  } = {},
) {
  const exposed = colour.map(
    (channel, index) => channel * exposure + bloom[index] * bloomIntensity,
  );
  const contrasted = exposed.map(
    (channel) => MIDDLE_GREY
      * Math.pow(Math.max(channel / MIDDLE_GREY, epsilon), contrast),
  );
  const luminance = contrasted[0] * LUMINANCE_WEIGHTS[0]
    + contrasted[1] * LUMINANCE_WEIGHTS[1]
    + contrasted[2] * LUMINANCE_WEIGHTS[2];
  return contrasted.map(
    (channel) => luminance + (channel - luminance) * saturation,
  );
}

/**
 * Owns the linear HDR composite, artistic grading, tone mapping, and output
 * colour-space conversion while the post-processing graph is active.
 */
export class ToneMappingNode {
  constructor({
    sourceNode,
    bloomNode = null,
    settings,
    bloomIntensity = 0,
    outputColorSpace = THREE.SRGBColorSpace,
  }) {
    this.exposure = uniform(settings.exposure);
    this.contrast = uniform(settings.contrast);
    this.saturation = uniform(settings.saturation);
    this.bloomIntensity = uniform(bloomIntensity);

    const adjustedHdr = Fn(() => {
      const colour = sourceNode
        .sample(screenUV)
        .rgb
        .mul(this.exposure)
        .toVar();
      if (bloomNode) {
        colour.addAssign(
          bloomNode.sample(screenUV).rgb.mul(this.bloomIntensity),
        );
      }

      colour.assign(
        pow(
          max(colour.div(MIDDLE_GREY), vec3(EPSILON)),
          this.contrast,
        ).mul(MIDDLE_GREY),
      );
      const luminance = colour.dot(vec3(...LUMINANCE_WEIGHTS));
      colour.assign(
        vec3(luminance).add(
          colour.sub(vec3(luminance)).mul(this.saturation),
        ),
      );
      return vec4(colour, float(1));
    })();

    const toneMapping = settings.enabled === false
      ? THREE.NoToneMapping
      : toneMappingConstantForMode(settings.mode);
    this.outputNode = renderOutput(
      adjustedHdr,
      toneMapping,
      outputColorSpace,
    );
  }

  updateUniforms(settings, bloomIntensity = 0) {
    this.exposure.value = settings.exposure;
    this.contrast.value = settings.contrast;
    this.saturation.value = settings.saturation;
    this.bloomIntensity.value = bloomIntensity;
  }
}
