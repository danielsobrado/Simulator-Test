import { Color } from 'three/webgpu';
import { cameraPosition, mix, positionWorld, smoothstep, vec3 } from 'three/tsl';
import { resolveSeaOptics } from '../water/SeaOptics.js';
import { seaStateUniforms } from '../water/seaState.js';

function colorNode(value) {
  const color = new Color(value);
  return vec3(color.r, color.g, color.b);
}

/** Palette and transmission share the sea mask; inland optics keep their own response. */
export function createSeaOpticsNodes(waterDepth, source) {
  const settings = resolveSeaOptics(source);
  const palette = name => mix(colorNode(settings.sunny[name]), colorNode(settings.storm[name]), seaStateUniforms.storm);
  const shallow = mix(palette('lagoon'), palette('shallow'), smoothstep(settings.lagoonStart, settings.lagoonEnd, waterDepth));
  const byDepth = mix(shallow, palette('deep'), smoothstep(settings.deepStart, settings.deepEnd, waterDepth));
  // Aerial depth: the open sea darkens and blues toward the horizon, so a
  // lagoon-shallow coast does not stay one turquoise all the way out.
  const far = smoothstep(60, 450, positionWorld.xz.distance(cameraPosition.xz));
  return {
    settings,
    color: mix(byDepth, palette('deep').mul(0.85), far.mul(0.6)),
    absorption: vec3(...settings.absorptionCoefficients),
  };
}
