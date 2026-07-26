import * as THREE from 'three/webgpu';
import {
  clamp,
  dot,
  max,
  mix,
  normalView,
  normalWorld,
  oneMinus,
  positionLocal,
  positionView,
  positionViewDirection,
  pow,
  saturate,
  sin,
  texture,
  triplanarTexture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { stylizedFbm } from './StylizedNoiseNodes.js';

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

/**
 * Per-species colour overrides. Generated broadleaf prototypes each own their
 * materials, so a palette here reads as a distinct species without needing a
 * second material pipeline.
 */
function paletteValue(palette, config, key) {
  return palette?.[key] ?? config.trees[key];
}

/**
 * View-angle rim on the canopy edge — the "fluffy" term from the CC0 Godot
 * foliage shader (godotshaders.com/shader/stylized-fluffy-tree-leaves), which
 * mixes toward a rim colour by `pow(1 - dot(N, V), power)`.
 *
 * It matters more here than it would on a card-based canopy: our crowns are solid
 * lobes, so without a rim their edge is a hard lit-surface boundary against the
 * sky. Lifting the grazing angles pushes that edge back toward light and gives the
 * mass a soft outline. Zero strength leaves the colour untouched.
 */
function applyCanopyRim(baseColor, config, palette) {
  const strength = paletteValue(palette, config, 'rimStrength');
  if (!(strength > 0)) return baseColor;
  const facing = saturate(dot(normalWorld, positionViewDirection));
  const rim = pow(oneMinus(facing), paletteValue(palette, config, 'rimPower'));
  return mix(
    baseColor,
    colorNode(paletteValue(palette, config, 'rimColor')),
    rim.mul(strength),
  );
}

export function createStylizedLeafMaterial({
  source,
  leafMap,
  bounds,
  time,
  config,
  palette = null,
  alphaTest = 0,
  preserveSourceColor = false,
}) {
  const normalizedHeight = clamp(
    positionLocal.y.sub(bounds.minY).div(Math.max(0.001, bounds.maxY - bounds.minY)),
    0,
    1,
  );
  const heightMask = normalizedHeight.mul(normalizedHeight);
  const localXZ = positionLocal.xz;
  const windDirection = vec2(config.wind.direction[0], config.wind.direction[1]);
  const windPerpendicular = vec2(windDirection.y.negate(), windDirection.x);
  const primary = sin(dot(localXZ, windDirection).mul(config.wind.frequency)
    .add(time.mul(config.wind.speed)));
  const flutter = sin(time.mul(config.wind.speed * config.trees.flutterSpeed)
    .add(positionLocal.y.mul(2.3))
    .add(positionLocal.x))
    .mul(config.trees.flutterAmplitude);
  const turbulence = sin(dot(localXZ, windPerpendicular).mul(config.wind.frequency * 1.9)
    .add(time.mul(config.wind.speed * 0.7)))
    .mul(config.wind.turbulence * 0.25);
  const wave = primary.add(flutter).add(turbulence);
  const sway = windDirection.mul(wave.mul(config.trees.windStrength).mul(heightMask));
  const dip = wave.abs().mul(config.trees.windStrength).mul(config.trees.dip).mul(heightMask);
  const finalPosition = positionLocal.add(vec3(sway.x, dip.negate(), sway.y));

  const gradient = pow(normalizedHeight, config.trees.gradientPower);
  const map = leafMap ?? source?.map ?? null;
  const paletteColor = mix(
    colorNode(paletteValue(palette, config, 'leafBottom')),
    colorNode(paletteValue(palette, config, 'leafTop')),
    gradient,
  );
  // Authored variants keep their embedded diffuse texture. The normal stylized
  // prototypes continue to use the per-species gradient and only read map alpha.
  const baseColor = preserveSourceColor && map
    ? texture(map, uv()).rgb.mul(colorNode(source?.color ?? '#ffffff'))
    : paletteColor;
  const variation = stylizedFbm(
    positionLocal.xz.add(positionLocal.y).mul(config.trees.variationScale),
  ).sub(0.5);
  const leafColor = max(
    baseColor.add(
      colorNode(paletteValue(palette, config, 'variationColor'))
        .sub(baseColor)
        .mul(variation)
        .mul(config.trees.variationStrength),
    ),
    vec3(0),
  ).mul(paletteValue(palette, config, 'brightness'));

  const material = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  material.positionNode = finalPosition;
  material.colorNode = applyCanopyRim(leafColor, config, palette);
  if (map) {
    material.opacityNode = texture(map, uv()).a;
    // Cards pass a lower cut than the GLB prototypes: the CC0 foliage alpha is
    // antialiased and a 0.5 cut eats its soft edges. This governs the base
    // material only — `createDitheredMaterial` turns opacity into a binary step
    // for the LOD bands and floors the cut at 0.5, which is correct for a 0/1
    // value. So what this actually decides is what the impostor baker sees.
    material.alphaTest = alphaTest > 0
      ? alphaTest
      : (source?.alphaTest > 0 ? source.alphaTest : 0.5);
  }
  material.transparent = false;
  return material;
}

/**
 * Close-range material for an authored trunk/branch mesh. Variants can keep
 * their source appearance or opt into the packed procedural bark texture pair.
 */
function bumpNormal(height) {
  const positionDerivativeX = positionView.dFdx();
  const positionDerivativeY = positionView.dFdy();
  const tangentX = positionDerivativeY.cross(normalView);
  const tangentY = normalView.cross(positionDerivativeX);
  const determinant = positionDerivativeX.dot(tangentX);
  const gradient = determinant.sign().mul(
    height.dFdx().mul(tangentX).add(height.dFdy().mul(tangentY)),
  );
  return determinant.abs().mul(normalView).sub(gradient).normalize();
}

export function createAuthoredTrunkMaterial({
  source,
  sourceMap = null,
  barkTextures = null,
  barkScale = 0.8,
}) {
  if (!barkTextures) {
    const material = new THREE.MeshLambertNodeMaterial({
      side: source?.side ?? THREE.FrontSide,
    });
    const baseColor = colorNode(source?.color ?? '#ffffff');
    material.colorNode = sourceMap
      ? texture(sourceMap, uv()).rgb.mul(baseColor)
      : baseColor;
    return material;
  }

  const albedoHeight = triplanarTexture(
    texture(barkTextures.albedoHeight),
    null,
    null,
    barkScale,
  );
  const normalRoughness = triplanarTexture(
    texture(barkTextures.normalRoughness),
    null,
    null,
    barkScale,
  );
  const decodedAlbedo = albedoHeight.rgb.mul(albedoHeight.rgb);
  const sourceColor = colorNode(source?.color ?? '#6b4a30');
  const barkColor = mix(sourceColor, decodedAlbedo.mul(1.35), 0.72)
    .mul(albedoHeight.a.mul(0.45).add(0.68));

  const material = new THREE.MeshStandardNodeMaterial({
    side: source?.side ?? THREE.FrontSide,
  });
  material.colorNode = barkColor;
  material.normalNode = bumpNormal(albedoHeight.a.mul(0.045));
  material.roughnessNode = normalRoughness.b;
  material.metalness = 0;
  return material;
}

export function createStylizedTrunkMaterial({ textures, config, palette = null }) {
  const bark = texture(textures.color, uv().mul(config.trees.barkScale)).rgb;
  const ao = texture(textures.ao, uv().mul(config.trees.barkScale)).r;
  const relief = texture(textures.height, uv().mul(config.trees.barkScale)).r;
  const tint = colorNode(paletteValue(palette, config, 'barkTint'));
  const barkColor = mix(bark, tint, paletteValue(palette, config, 'barkTintStrength'))
    .mul(mix(1, ao, config.trees.barkAoStrength))
    .mul(mix(0.82, 1.18, relief.mul(config.trees.barkRelief)))
    .mul(paletteValue(palette, config, 'barkBrightness'));
  const material = new THREE.MeshLambertNodeMaterial();
  material.colorNode = barkColor;
  return material;
}
