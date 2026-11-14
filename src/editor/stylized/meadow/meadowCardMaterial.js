import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  cameraPosition,
  cameraViewMatrix,
  cos,
  dot,
  float,
  floor,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  sqrt,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

import { assignGrassMaterialData } from '../../../render/postprocessing/PostProcessingMaterialData.js';
import { applyJungleMist } from '../ambient/jungleMistOutput.js';
import { applyCloudShadow } from '../CloudShadow.js';
import { spellLightIrradiance, spellWorldEnabled } from '../../vfx/render/SpellWorldLight.js';
import { sampleWorldWindCanonical, windWaveCoordinates, worldWindUniforms } from '../../weather/wind/worldWindState.js';
import { grassGustSheenUniforms } from '../ambient/GrassGustSheen.js';
import { meadowInstance } from './meadowBladeShape.js';
import { applyHandoff, applyPublicationFade } from './meadowFade.js';
import { meadowGrowthNodes } from './meadowGrowthNodes.js';
import { meadowPigment } from './meadowPigment.js';
import { meadowPlantNodes } from './meadowPlantNodes.js';

/** The card atlas: three silhouettes side by side, each a 2 × 2 block of clumps. */
const ATLAS_COLUMNS = 6;
const ATLAS_ROWS = 2;
/** Atlas-uv inset per cell so mip filtering never bleeds a neighbour in. */
const ATLAS_PADDING = vec2(0.01, 0.03);
const ALPHA_TEST = 0.5;
const HIDDEN = 1e9;

/**
 * The far meadow, ported from grass-test's far billboards (`FarGrassField` with
 * `GrassBladeMaterial`'s `farBillboard` path): each card stands for a clump of
 * ~180 stems, turned about its own vertical to face the camera, so the meadow
 * reaches the far distance at two triangles a clump.
 *
 * @param {object} options
 * @param {object} options.uniforms createMeadowUniforms()
 * @param {object} options.tuning GrassTuning uniforms
 * @param {object} options.config stylizedSurface
 * @param {object} options.sunDirection
 * @param {THREE.Texture} options.atlas meadow-grass-cards.webp
 */
export function createMeadowCardMaterial({ uniforms, tuning, config, sunDirection, atlas }) {
  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.name = 'meadow-grass-cards';
  const position = Fn(() => {
    const card = meadowInstance(uniforms.origin, { cards: true });
    const r = uv().y.clamp(0, 1);
    const local = vec3(0).toVar();
    If(card.strength.lessThanEqual(0), () => {
      local.assign(vec3(HIDDEN));
    });
    If(card.strength.greaterThan(0), () => {
      const toward = cameraPosition.xz.sub(card.base.xz).normalize();
      // Clumps stand patchier than single blades (the donor's 0.5..1.25).
      const profile = meadowGrowthNodes(uniforms,card,true);
      // The clump is whichever plant grows at its foot (the blades' accents).
      const height = profile.height.mul(card.strength).mul(meadowPlantNodes(uniforms, card).height);
      const width = uniforms.cardWidth.mul(sqrt(card.strength));
      local.x.assign(positionLocal.x.mul(toward.y).mul(width));
      local.z.assign(positionLocal.x.mul(toward.x.negate()).mul(width));
      local.y.assign(positionLocal.y.mul(height));
      // A standing lean with the prevailing wind only. A card is a few pixels of
      // alpha-cut edges, so any per-frame motion flips those pixels across the cut
      // and the far meadow sparkles; gusts show through the sheen below instead.
      const { prevailing, prevailingStrength, referenceStrength } = worldWindUniforms;
      const angle = tuning.windLean.mul(prevailingStrength.div(referenceStrength.max(1e-4)).clamp(0.35, 3.5))
        .mul(profile.wind).mul(2).clamp(-1.2, 1.2).mul(pow(r, 3));
      const reach = height.mul(sin(angle));
      local.x.addAssign(prevailing.x.mul(reach));
      local.z.addAssign(prevailing.y.mul(reach));
      local.y.subAssign(abs(height.mul(cos(angle).sub(1)).mul(r)));
      local.assign(local.add(card.base));
    });
    return local;
  })();
  material.positionNode = position;
  material.receivedShadowPositionNode = position;

  const card = meadowInstance(uniforms.origin, { cards: true });
  const variant = card.cell.sub(floor(card.cell.div(4)).mul(4));
  // The atlas has art for the three stand silhouettes only: a strap clump
  // borrows the reed's, a lance clump the broadleaf's. Chosen per card in the
  // vertex stage, so the fragment stage reads no growth tables.
  const plantShape = meadowPlantNodes(uniforms, card).shape;
  const shape = plantShape.greaterThan(3.5).select(float(1), plantShape.min(2)).toVarying('meadowCardPlant').round();
  const column = shape.mul(2).add(variant.mod(2));
  const row = floor(variant.div(2));
  const cell = vec2(1 / ATLAS_COLUMNS, 1 / ATLAS_ROWS);
  const atlasUv = uv().mul(cell.sub(ATLAS_PADDING.mul(2)))
    .add(vec2(column.mul(cell.x), row.mul(cell.y)).add(ATLAS_PADDING));
  material.opacityNode = texture(atlas, atlasUv).a;
  material.alphaTest = ALPHA_TEST;
  material.transparent = false;

  const { pigment, color: albedo, height } = meadowPigment({ uniforms, tuning, config, blade: card, melted: true });
  material.colorNode = albedo;
  material.normalNode = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz.normalize();
  const view = normalize(cameraPosition.sub(positionWorld));
  const transmission = pow(dot(view.negate(), normalize(sunDirection)).max(0), tuning.translucencyPower);
  // Gust fronts rolling across the far meadow, as the blades' sheen: shading moves,
  // the alpha cut does not.
  const wind = sampleWorldWindCanonical(card.canonical);
  const wave = sin(windWaveCoordinates(card.canonical).along.mul(tuning.windFrequency)
    .add(uniforms.time.mul(tuning.windSpeed)).add(card.phase));
  const gust = smoothstep(0.2, 1, wave.mul(0.5).add(0.5))
    .mul(wind.envelope.clamp(0, 2).mul(0.5)).toVarying('meadowCardGust');
  const sheen = mix(pigment, vec3(1, 1, 0.86), 0.55)
    .mul(uniforms.sunColor.add(uniforms.skyColor.mul(0.5)))
    .mul(gust).mul(height.mul(height)).mul(grassGustSheenUniforms.weight);
  const emissive = pigment.mul(uniforms.sunColor).mul(transmission)
    .mul(uniforms.appearance.backlight).mul(tuning.translucencyStrength).mul(0.6).mul(height)
    .add(pigment.mul(uniforms.skyColor).mul(uniforms.appearance.fill))
    .add(sheen);
  material.emissiveNode = spellWorldEnabled
    ? emissive.add(albedo.mul(spellLightIrradiance(positionWorld, vec3(0, 1, 0))))
    : emissive;

  applyHandoff(material, { base: card.base, fadeIn: uniforms.cardFadeIn, fadeOut: uniforms.farFade });
  applyPublicationFade(material, { instance: card, time: uniforms.time });
  applyCloudShadow(material, config.sky);
  applyJungleMist(material, config.ambientEffects);
  return assignGrassMaterialData(material);
}

/** The card atlas, configured as the donor's `GrassAtlas`. */
export function loadMeadowCardAtlas(url) {
  const atlas = new THREE.TextureLoader().load(url);
  atlas.colorSpace = THREE.NoColorSpace;
  atlas.flipY = true;
  atlas.wrapS = THREE.ClampToEdgeWrapping;
  atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.magFilter = THREE.LinearFilter;
  return atlas;
}
