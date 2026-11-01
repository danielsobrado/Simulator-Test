import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  cameraViewMatrix,
  dot,
  mix,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  vec3,
  vec4,
} from 'three/tsl';

import { assignGrassMaterialData } from '../../../render/postprocessing/PostProcessingMaterialData.js';
import { grassGustSheenUniforms } from '../ambient/GrassGustSheen.js';
import { applyJungleMist } from '../ambient/jungleMistOutput.js';
import { sampleWorldWindCanonical, windWaveCoordinates } from '../../weather/wind/worldWindState.js';
import { applyCloudShadow } from '../CloudShadow.js';
import { spellLightIrradiance, spellWorldEnabled } from '../../vfx/render/SpellWorldLight.js';
import { createMeadowBladePosition, meadowInstance } from './meadowBladeShape.js';
import { applyHandoff, applyPublicationFade } from './meadowFade.js';
import { meadowPigment } from './meadowPigment.js';

/** Rounded ribbon normal in the same XZ frame as createMeadowBladePosition. */
export function meadowBladeWorldNormal(rotation, side, height) {
  // instanceRotation packs (sin, cos). Width points along (cos, sin) and
  // the local forward axis points along (-sin, cos), just like the vertices.
  const widthAxis = vec3(rotation.y, 0, rotation.x);
  const forwardAxis = vec3(rotation.x.negate(), 0, rotation.y);
  const tip = smoothstep(0.15, 1, height);
  const rooted = smoothstep(0, 0.12, height);
  return normalize(vec3(0, 1, 0)
    .add(widthAxis.mul(side).mul(mix(0.6, 0.25, tip)).mul(rooted))
    .add(forwardAxis.mul(tip).mul(0.45)));
}

/**
 * One material for every band's batch.
 *
 * @param {object} options
 * @param {object} options.uniforms createMeadowUniforms()
 * @param {object} options.tuning GrassTuning uniforms
 * @param {object} options.config stylizedSurface
 * @param {object} options.sunDirection live sun direction node
 * @param {number} options.bandCount bands that retire stems
 * @param {boolean} [options.handoff] dissolve into the far cards past uniforms.handoff
 * @param {number} options.tileSize metres
 */
export function createMeadowBladeMaterial({
  uniforms, tuning, config, sunDirection, bandCount = 4, handoff = false, tileSize,
}) {
  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.name = 'meadow-grass-blades';
  // The batch mesh has an identity transform, so the blade position is already
  // render-space world: shadows and fog read it as such.
  const position = createMeadowBladePosition({
    uniforms, tuning, config, bandCount, tileSize, interaction: uniforms.interaction,
  });
  material.positionNode = position;
  material.receivedShadowPositionNode = position;

  const blade = meadowInstance(uniforms.origin);
  const { pigment, bladeValue, color: albedo, height } = meadowPigment({ uniforms, tuning, config, blade, marks: true });

  // Rounded width at walking distance, with only the first 12% rooted to
  // terrain-up. A very weak, tip-only tilt made every stem a flat green strip.
  const side = attribute('bladeSide', 'float').clamp(-1, 1);
  const worldNormal = meadowBladeWorldNormal(blade.rotation, side, height);
  material.normalNode = cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz.normalize();
  const detailReach = cameraPosition.distance(blade.base).smoothstep(6, 14).oneMinus().toVarying('meadowBladeDetailReach');
  const edge = side.abs();
  const rib = blade.shape.greaterThan(.5).select(
    edge.smoothstep(.04, .18).mul(.06).add(.94), edge.mul(.04).add(.98));
  material.colorNode = albedo.mul(mix(1, rib, detailReach));

  // Sun through the thin tip, carrying the blade's own colour, and a small shared
  // fill so roots and terrain stay together without bleaching the field.
  const view = normalize(cameraPosition.sub(positionWorld));
  const transmission = pow(dot(view.negate(), normalize(sunDirection)).max(0), tuning.translucencyPower);
  // Gust fronts crossing the meadow (grass-test's gust sheen): where the travelling
  // wave bends the tips over, their paler side turns up and catches the light.
  // Computed per stem in the vertex stage; the ambient layer sets how much shows.
  const wind = sampleWorldWindCanonical(blade.canonical);
  const wave = sin(windWaveCoordinates(blade.canonical).along.mul(tuning.windFrequency)
    .add(uniforms.time.mul(tuning.windSpeed)).add(blade.phase));
  const gust = smoothstep(0.2, 1, wave.mul(0.5).add(0.5))
    .mul(wind.envelope.clamp(0, 2).mul(0.5)).toVarying('meadowGust');
  const sheen = mix(pigment, vec3(1, 1, 0.86), 0.55)
    .mul(uniforms.sunColor.add(uniforms.skyColor.mul(0.5)))
    .mul(gust).mul(height.mul(height)).mul(grassGustSheenUniforms.weight);
  const emissive = pigment.mul(bladeValue).mul(uniforms.sunColor)
    .mul(transmission).mul(uniforms.appearance.backlight).mul(tuning.translucencyStrength)
    .mul(smoothstep(0.35, 1, height))
    .add(pigment.mul(uniforms.skyColor).mul(uniforms.appearance.fill))
    .add(sheen);
  // A spell's light warming the meadow round it (one uniform light, no scene light).
  // Evaluated per vertex: blades are thin, and the meadow's overdraw makes a
  // per-fragment term cost far more than it shows.
  material.emissiveNode = spellWorldEnabled
    ? emissive.add(albedo.mul(spellLightIrradiance(positionWorld, worldNormal).toVarying('meadowSpellLight')))
    : emissive;

  if (handoff) applyHandoff(material, { base: blade.base, fadeIn: null, fadeOut: uniforms.handoff });
  applyPublicationFade(material, { instance: blade, time: uniforms.time });
  applyCloudShadow(material, config.sky);
  applyJungleMist(material, config.ambientEffects);
  return assignGrassMaterialData(material);
}
