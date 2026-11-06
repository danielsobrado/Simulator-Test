import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  attribute,
  clamp,
  dot,
  float,
  instanceColor,
  int,
  mix,
  modelWorldMatrix,
  mx_noise_float,
  normalMap,
  normalWorld,
  parallaxDirection,
  positionGeometry,
  positionLocal,
  screenCoordinate,
  sin,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

import { WEATHER_FAMILIES, treadPaving, weatherTownSurface } from '../../render/materials/townWeathering.js';
import { TOWN_WET_FAMILIES, wetTownSurface } from '../../render/materials/townWetness.js';
import { filterSpecularRoughness } from '../../render/materials/specularAntialiasing.js';
import { buildingShadeEmission } from '../stylized/forest/foliageLight.js';
import { sampleWorldWind } from '../weather/wind/worldWindState.js';
import { KIT_DATA_ATTRIBUTE } from './TownKitGeometry.js';
import { RENDER_PALETTE, ROLE, surfaceOf } from './TownKitSurfaces.js';

/**
 * The one material every opaque town surface draws with.
 *
 * Harmonised with the stylized rock and terrain pipeline: restrained relief,
 * muted painterly saturation, warm limestone dust weathering, and shared
 * sky-fill + ground-bounce + distance air in-scatter (`buildingShadeEmission`).
 */

const SNOW = vec3(0.9, 0.93, 0.98);

export const townKitShared = Object.freeze({
  /** Sun elevation in radians, written each frame by the town runtime. */
  sunElevation: uniform(0.7),
  /** Albedo grade over the scans: brightness lift, saturation, crevice depth, relief. */
  albedoLift: uniform(1.18),
  // Neutral: a town's own render, timber and roof colours are its character.
  saturation: uniform(1),
  creviceDepth: uniform(0.32),
  reliefScale: uniform(0.92),
});

/** Decodes TownModuleInstances.seedColour; `grounded` is 1 on a ground-floor piece. */
function seedChannels() {
  const channels = clamp(instanceColor.sub(0.9).mul(10), 0, 1);
  const steps = instanceColor.x.sub(0.9).mul(80).add(0.1);
  return {
    x: steps.floor().div(7).clamp(0, 1),
    y: channels.y,
    z: channels.z,
    grounded: step(0.3, steps.fract()),
  };
}

/**
 * Smooth, non-repeating-looking warp from a few incommensurate sines: far
 * cheaper than gradient noise, which matters here because it runs per vertex in
 * every shadow cascade too.
 */
function wobble(position) {
  const a = sin(position.x.mul(0.31).add(position.z.mul(0.17)).add(sin(position.z.mul(0.23)).mul(1.7)));
  const b = sin(position.z.mul(0.29).sub(position.x.mul(0.13)).add(sin(position.x.mul(0.19)).mul(1.9)));
  const c = sin(position.y.mul(0.37).add(position.x.mul(0.11)));
  return vec3(a.mul(0.04), a.mul(c).mul(0.012), b.mul(0.04));
}

/** Cloth in the world wind; only vertices with a sway weight pay for the wind fetch. */
const swayOffset = Fn(([weight]) => {
  const offset = vec3(0).toVar();
  If(weight.greaterThan(0.001), () => {
    // The wind field is in render space; positionLocal here is town space (after instancing).
    const world = sampleWorldWind(modelWorldMatrix.mul(vec4(positionLocal, 1)).xz);
    const phase = positionGeometry.y.mul(2.3).add(positionLocal.x.mul(0.7)).add(positionLocal.z.mul(0.5));
    const flutter = sin(time.mul(2.6).add(phase)).mul(0.6).add(sin(time.mul(4.1).add(phase.mul(1.7))).mul(0.25));
    const strength = world.envelope.clamp(0.4, 3).mul(0.07).mul(weight);
    offset.assign(vec3(world.direction.x, 0, world.direction.y).mul(strength.mul(flutter.add(0.8))));
  });
  return offset;
});

/**
 * @param {import('./TownKitAtlas.js').TownKitAtlas} atlas
 * @param {object} look resolved look (TownMaterialPalette.resolveLook)
 */
export function createTownKitMaterial(atlas, look) {
  const count = Math.max(1, atlas.rows.length);
  const table = () => uniformArray(new Array(count).fill(0).map(() => new THREE.Vector4()), 'vec4');
  const layers = table();
  const tints = table();
  const kinds = table();
  const relief = table();
  const snow = uniform(0);
  const material = new THREE.MeshStandardNodeMaterial({ name: `TownKit ${look.key}` });
  // The kit has open panes (lunettes, oriel facets, roof cheeks) authored one-sided.
  material.side = THREE.DoubleSide;
  material.alphaToCoverage = true;
  material.userData.townKit = { layers, tints, kinds, relief, snow };
  writeLook(material, atlas, look);

  const data = attribute(KIT_DATA_ATTRIBUTE, 'vec4');
  const id = int(data.z.add(0.5));
  const row = layers.element(id);
  const tint = tints.element(id);
  const kind = kinds.element(id);
  const surface = relief.element(id);
  const role = kind.x;
  const isRole = (value) => float(1).sub(clamp(role.sub(value).abs(), 0, 1));
  const seed = seedChannels();
  const place = positionLocal;
  const mistEdge = float(1).sub(uv().sub(vec2(0.5)).length().mul(2)).clamp(0, 1);
  const mistDrift = sin(time.mul(1.2).add(place.x.mul(2)).add(place.y)).mul(0.25).add(0.75);

  material.positionNode = positionLocal.add(wobble(positionLocal)).add(swayOffset(data.y));
  // Shadow cascades re-run the vertex stage for every town vertex: they get the
  // plain position (a few centimetres of wobble never shows in a shadow).
  material.castShadowPositionNode = positionLocal;

  // Parallax: lift pale faces (stones, slates) above dark joints.
  // Cobbles run continuously over the ground: each 2 m paving tile mapping the 1 m
  // scan in its own space repeated it as a visible grid.
  const isCobble = isRole(ROLE.cobble);
  const base = mix(uv(), place.xz, isCobble);
  const reliefHeight = dot(texture(atlas.albedo, base).depth(row.x).rgb, vec3(0.3, 0.55, 0.15));
  const flow = isRole(ROLE.water).add(isRole(ROLE.foam));
  const st = base.sub(parallaxDirection.xy.mul(reliefHeight.sub(0.45).mul(surface.z).mul(townKitShared.reliefScale)))
    .add(vec2(0, time.mul(-0.6)).mul(flow));
  const albedoSample = texture(atlas.albedo, st).depth(row.x);
  const laid = albedoSample.rgb;
  const flame = isRole(ROLE.flame);
  const flicker = sin(time.mul(7).add(place.x.mul(3)).add(place.y.mul(2))).mul(0.12).add(0.88);
  // Only spray pixels pay for dithering. Opaque town walls avoid a global alpha-hash pass.
  material.opacityNode = Fn(() => {
    If(role.equal(ROLE.mist), () => {
      const threshold = sin(screenCoordinate.x.mul(12.9898).add(screenCoordinate.y.mul(78.233))).mul(43758.5453).fract();
      mistEdge.mul(mistEdge).mul(mistDrift).mul(0.16).lessThan(threshold).discard();
    });
    If(role.equal(ROLE.flame), () => { albedoSample.a.lessThan(0.12).discard(); });
    return mix(float(1), albedoSample.a, flame);
  })();
  // A second tap of the same stones, turned and rescaled, blended by noise (as
  // SettlementPavingMaterial): no two stretches of a street are alike.
  const turned = vec2(st.x.mul(0.8).sub(st.y.mul(0.6)), st.x.mul(0.6).add(st.y.mul(0.8))).mul(0.73).add(vec2(0.37, 0.71));
  // A wall takes the same stones shifted along their course, so the joints still
  // line up but the same block never comes round again every tile.
  const isStone = isRole(ROLE.stone);
  const secondTap = mix(turned, st.add(vec2(0.37, 0)), isStone);
  const stoneMix = smoothstep(-0.28, 0.28, mx_noise_float(place.mul(0.31))).mul(isCobble.add(isStone));
  const sample = mix(laid, texture(atlas.albedo, secondTap).depth(row.x).rgb, stoneMix);
  const surfaceSample = texture(atlas.normal, st).depth(row.y);
  const normalSample = surfaceSample.rgb;
  // Crevices from the normal map: the further a texel tilts, the deeper the joint.
  const crevice = smoothstep(0.97, 0.72, normalSample.z).mul(surface.y);
  const luma = dot(sample, vec3(0.3, 0.55, 0.15));
  // Slightly richer than the scans' flat daylight albedo, and lifted a touch.
  const rich = mix(vec3(luma), sample, townKitShared.saturation).mul(townKitShared.albedoLift).mul(surface.w).max(0);
  const authored = rich.mul(tint.rgb).mul(float(1).sub(crevice.mul(townKitShared.creviceDepth)));

  // Render worn back to the stone beneath, in irregular town-space patches.
  const wearNoise = mx_noise_float(place.mul(0.55));
  const wearMask = isRole(ROLE.plaster).mul(kind.w);
  const wear = smoothstep(0.44, 0.5, wearNoise).mul(wearMask);
  const rim = smoothstep(0.38, 0.44, wearNoise).mul(wearMask);
  const stoneBeneath = texture(atlas.albedo, st.mul(1.3)).depth(kind.z).rgb.mul(0.9);
  let colour = mix(authored, authored.mul(0.8), rim.sub(wear).clamp(0, 1));
  colour = mix(colour, stoneBeneath, wear);

  // Per building: render palette, timber and roof tone.
  const pick = seed.x.mul(RENDER_PALETTE.length - 0.001).floor();
  let renderTint = vec3(...RENDER_PALETTE[0]);
  for (let i = 1; i < RENDER_PALETTE.length; i += 1) {
    renderTint = mix(renderTint, vec3(...RENDER_PALETTE[i]), float(1).sub(clamp(pick.sub(i).abs(), 0, 1)));
  }
  const houseTint = mix(vec3(1), renderTint, isRole(ROLE.plaster))
    .mul(mix(float(1), mix(float(0.86), float(1.08), seed.y), isRole(ROLE.timber)))
    .mul(mix(float(1), mix(float(0.92), float(1.08), seed.z), isRole(ROLE.roof)))
    // Masons' stone came from more than one bed: each building its own tone.
    .mul(mix(vec3(1), mix(vec3(0.88, 0.86, 0.82), vec3(1.08, 1.05, 1.0), seed.y), isStone));
  // Broad drift so long walls and roofs are never one flat tone.
  const drift = mx_noise_float(place.mul(0.09)).mul(0.08).add(1);
  colour = colour.mul(houseTint).mul(drift).mul(data.x);

  const up = normalWorld.y;
  // The same weather as SettlementView's houses: moss on ledges and slates, rain runs down faces, warm dust on tops.
  const amount = (key) => [[ROLE.stone, 'stone'], [ROLE.plaster, 'plaster'], [ROLE.timber, 'timber'], [ROLE.roof, 'roof']]
    .reduce((sum, [value, family]) => sum.add(isRole(value).mul(WEATHER_FAMILIES[family][key])), float(0));
  // A ground-floor piece's own origin is its foot, so its height is the wall's;
  // the band is for walls, not the floors and steps at the same height.
  const wall = smoothstep(0.7, 0.3, up.abs());
  const height = mix(float(99), positionGeometry.y, seed.grounded.mul(wall));
  colour = weatherTownSurface(colour, {
    place,
    up,
    height,
    family: { moss: amount('moss'), streaks: amount('streaks'), damp: amount('damp'), dust: amount('dust') },
  });
  // Setts as SettlementView's streets are: trodden grime that also hides the tile repeat.
  colour = mix(colour, treadPaving(colour, place.xz), isRole(ROLE.paving).add(isCobble));
  const wetAmount = (key) => [[ROLE.stone, 'stone'], [ROLE.plaster, 'plaster'], [ROLE.timber, 'timber'],
    [ROLE.roof, 'roof'], [ROLE.paving, 'stone'], [ROLE.cobble, 'stone']]
    .reduce((sum, [value, family]) => sum.add(isRole(value).mul(TOWN_WET_FAMILIES[family][key])), float(0));
  const wet = wetTownSurface(colour, row.z.mul(surfaceSample.a), up, {
    wetness: wetAmount('wetness'), darkening: wetAmount('darkening'), roughness: wetAmount('roughness'),
  });
  colour = wet.color;
  const snowCover = smoothstep(0.38, 0.72, up).mul(snow).mul(kind.y);
  colour = mix(colour, SNOW.mul(data.x.mul(0.3).add(0.7)), snowCover);

  material.colorNode = vec4(colour, 1);
  const strength = surface.x.mul(townKitShared.reliefScale).mul(float(1).sub(snowCover.mul(0.7)));
  material.normalNode = normalMap(normalSample, vec2(strength));
  const roughness = mix(wet.roughness, float(0.62), snowCover).add(wear.mul(0.05)).add(crevice.mul(0.08));
  material.roughnessNode = filterSpecularRoughness(roughness, normalSample.mul(2).sub(1).mul(vec3(strength, strength, 1)));
  material.metalnessNode = mix(row.w, float(0), snowCover);
  const selfEmissive = sample.mul(tint.rgb).mul(tint.w).mul(mix(float(1), flicker, flame));
  const shadeEmissive = buildingShadeEmission(colour).mul(float(1).sub(flame));
  material.emissiveNode = selfEmissive.add(shadeEmissive);
  return material;
}

/** Writes a look's table values into a town material (no recompilation). */
export function writeLook(material, atlas, look) {
  const { layers, tints, kinds, relief, snow } = material.userData.townKit;
  const stoneLayer = atlas.albedoLayer('M_stone');
  for (const row of atlas.rows) {
    const surface = surfaceOf(row.name);
    const role = surface.role;
    const swap = look.swaps[row.name] ? atlas.row(look.swaps[row.name]) : null;
    const source = swap ?? row;
    const tint = look.tints[row.name] ?? [1, 1, 1];
    const base = role === ROLE.banner ? [1, 1, 1] : source.color;
    layers.array[row.index].set(source.albedoLayer, source.normalLayer, source.roughness, source.metalness);
    tints.array[row.index].set(base[0] * tint[0], base[1] * tint[1], base[2] * tint[2], row.emissive);
    const snowy = role === ROLE.stone || role === ROLE.timber || role === ROLE.roof ? 1 : 0;
    kinds.array[row.index].set(role, snowy, stoneLayer, role === ROLE.plaster ? look.wear : 0);
    const shaped = surfaceOf(source.name);
    relief.array[row.index].set(shaped.normal, shaped.cavity, shaped.parallax, shaped.gain);
  }
  snow.value = look.snow;
}
