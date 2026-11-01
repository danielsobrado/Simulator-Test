import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { frameUniform as uniform, frameUniformArray as uniformArray } from '../../../render/FrameUniforms.js';
import { lodBandVectors, meadowCardFadeRange } from './meadowGrassLayout.js';
import { MEADOW_TUFT_DEFAULTS } from './meadowTuftField.js';


/**
 * The meadow's shared uniforms: one set for every band's batch, written once a
 * frame by the field.
 *
 * @param {object} settings resolveMeadowGrassConfig()
 * @param {object | null} [interaction] MeadowInteractionMap, when the field has one
 * @param {object | null} [spellGround] the spells' press-and-mark MeadowInteractionMap
 */
export function createMeadowUniforms(settings, interaction = null, spellGround = null) {
  const appearance = settings.appearance;
  const growth = settings.growth;
  return {
    growth: {
      dimensions: uniformArray(Array.from({length:16},(_,i)=>{
        const p=growth.profiles[i] ?? growth.profiles[0];
        return new THREE.Vector4(p.shortHeight,p.tallHeight,p.width,p.patchMeters);
      }),'vec4'),
      density: uniformArray(Array.from({length:16},(_,i)=>new THREE.Vector4(...meadowGrowthResponse(growth.profiles[i] ?? growth.profiles[0]))),'vec4'),
      // How much of the area field each biome wears: a rainforest stays lush.
      areaStyle: uniformArray(Array.from({length:16},(_,i)=>(growth.profiles[i] ?? growth.profiles[0]).areaStyle),'float'),
      maxHeight: growth.maxHeight, maxWidth: growth.maxWidth,
    },
    // The player's body stamp and its render-space window. The centre is the
    // map's own Vector2, so the fold reads wherever the map last stamped without
    // a copy per frame.
    interaction: interaction
      ? {
        texture: interaction.texture,
        center: uniform(interaction.center),
        worldSize: uniform(interaction.worldSize),
      }
      : null,
    // Spells: blasts pressing the meadow (R) and the marks they leave (G, B).
    spellGround: spellGround
      ? {
        texture: spellGround.texture,
        center: uniform(spellGround.center),
        worldSize: uniform(spellGround.worldSize),
        /** 1 while a spell has ink in the map; at 0 the blades skip reading it. */
        active: uniform(0),
      }
      : null,
    // Null compiles the area field out of the blades and cards entirely.
    groundStyle: appearance.groundStyle > 0 ? uniform(appearance.groundStyle) : null,
    time: uniform(0),
    origin: uniform(new THREE.Vector2()),
    maxDistance: uniform(settings.maxDistance),
    bladeHeight: uniform(settings.bladeHeight),
    bladeWidth: uniform(settings.bladeWidth),
    heightScale: uniform(new THREE.Vector2(...settings.heightScale)),
    heightNoiseScale: uniform(settings.heightNoiseScale),
    widthScale: uniform(settings.widthScale),
    taper: uniform(settings.taper),
    curve: uniform(settings.curve),
    baseBend: uniform(settings.baseBend),
    stiffness: uniform(settings.stiffness),
    lodBands: uniformArray(
      lodBandVectors(settings).map((vector) => new THREE.Vector4(...vector)),
      'vec4',
    ),
    // Cards arrive during blade thinning; the blades dissolve later.
    cardFadeIn: uniform(new THREE.Vector2(...meadowCardFadeRange(settings))),
    // Where the near blades dissolve out: (start, end) metres.
    handoff: uniform(new THREE.Vector2(settings.maxDistance * (settings.far?.transitionStart ?? 0.8), settings.maxDistance)),
    // Where the far cards dissolve out: (start, end) metres.
    farFade: uniform(new THREE.Vector2(
      (settings.far?.distance ?? 0) * (settings.far?.fadeStart ?? 0.9),
      settings.far?.distance ?? 0,
    )),
    cardWidth: uniform(settings.far?.width ?? 1.2),
    cardHeight: uniform(settings.far?.height ?? 0.72),
    sunColor: uniform(new THREE.Color(1, 1, 1)),
    skyColor: uniform(new THREE.Color(0.5, 0.6, 0.7)),
    appearance: {
      rootBrightness: uniform(appearance.rootBrightness),
      gradientPower: uniform(appearance.gradientPower),
      groundTipMix: uniform(appearance.groundTipMix),
      canopyDepth: uniform(appearance.canopyDepth),
      valueJitter: uniform(appearance.valueJitter),
      backlight: uniform(appearance.backlight),
      fill: uniform(appearance.fill),
      patchScale: uniform(appearance.patchScale),
      lodThinning: uniform(appearance.lodThinning),
      lodCompensation: uniform(appearance.lodCompensation),
      lodWidenMax: uniform(appearance.lodWidenMax),
      canopyTipMix: uniform(appearance.canopyTipMix),
      canopyStrength: uniform(appearance.canopyStrength),
      meltStart: uniform(appearance.meltStart),
      meltEnd: uniform(appearance.meltEnd),
      meltFlatten: uniform(appearance.meltFlatten),
    },
    // The tuft field's shaping (meadowTuftField.js), live.
    tufts: Object.fromEntries(Object.entries(settings.tufts ?? MEADOW_TUFT_DEFAULTS)
      .map(([key, value]) => [key, uniform(value)])),
    // Base and tip per palette index, live, so a look can repaint the meadow
    // without a rebuild.
    palette: settings.palette
      ? {
        base: uniformArray(settings.palette.palettes.map(({ base }) => new THREE.Color(base)), 'color'),
        tip: uniformArray(settings.palette.palettes.map(({ tip }) => new THREE.Color(tip)), 'color'),
        brightness: uniform(settings.palette.brightness),
      }
      : null,
    patchCool: vec3(...appearance.patchCool),
    patchWarm: vec3(...appearance.patchWarm),
  };
}
import { meadowGrowthResponse } from './meadowGrassShapes.js';
