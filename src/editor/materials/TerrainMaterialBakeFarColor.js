const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const SRGB_TO_LINEAR = new Float32Array(256);

for (let index = 0; index < SRGB_TO_LINEAR.length; index += 1) {
  const value = index / 255;
  SRGB_TO_LINEAR[index] = value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function linearToSrgbByte(value) {
  const linear = clamp01(value);
  const srgb = linear <= 0.0031308
    ? linear * 12.92
    : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.round(clamp01(srgb) * 255);
}

function hexToLinearRgb(value, field) {
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
    throw new Error(`Terrain material bake ${field} must be a six-digit hexadecimal color.`);
  }
  const packed = Number.parseInt(value.slice(1), 16);
  return Object.freeze([
    SRGB_TO_LINEAR[(packed >>> 16) & 0xff],
    SRGB_TO_LINEAR[(packed >>> 8) & 0xff],
    SRGB_TO_LINEAR[packed & 0xff],
  ]);
}

export function createTerrainMaterialFarStyle(materialStyle, render) {
  if (!materialStyle) return null;
  const grassBrightness = Number(materialStyle.grassBrightness);
  if (!Number.isFinite(grassBrightness) || grassBrightness < 0) {
    throw new Error('Terrain material bake grass brightness must be non-negative and finite.');
  }
  return Object.freeze({
    grassBottom: hexToLinearRgb(materialStyle.grassBottomColor, 'grassBottomColor'),
    grassBrightness,
    dirt: hexToLinearRgb(materialStyle.dirtColor, 'dirtColor'),
    forest: hexToLinearRgb(materialStyle.forestColor, 'forestColor'),
    rock: hexToLinearRgb(render.rockColor, 'render.rockColor'),
    snow: hexToLinearRgb(render.snowColor, 'render.snowColor'),
    shoreline: hexToLinearRgb(render.shorelineColor, 'render.shorelineColor'),
    grassTintStrength: render.grassTintStrength,
    wetDarkening: render.wetDarkening,
    shorelineStrength: render.shorelineStrength,
    canopyStrength: render.canopyStrength,
  });
}

export function encodeTerrainMaterialFarColor(
  target,
  offset,
  sourcePixels,
  sourceOffset,
  style,
  grassWeight,
  dirtWeight,
  rockWeight,
  snowWeight,
  macroRed,
  macroGreen,
  macroBlue,
  shoreline,
  wetness,
  canopy,
  heightShade,
) {
  const tileRed = SRGB_TO_LINEAR[sourcePixels[sourceOffset]];
  const tileGreen = SRGB_TO_LINEAR[sourcePixels[sourceOffset + 1]];
  const tileBlue = SRGB_TO_LINEAR[sourcePixels[sourceOffset + 2]];
  const grassRed = lerp(
    tileRed,
    style.grassBottom[0] * style.grassBrightness,
    style.grassTintStrength,
  );
  const grassGreen = lerp(
    tileGreen,
    style.grassBottom[1] * style.grassBrightness,
    style.grassTintStrength,
  );
  const grassBlue = lerp(
    tileBlue,
    style.grassBottom[2] * style.grassBrightness,
    style.grassTintStrength,
  );
  let red = grassRed * grassWeight
    + style.dirt[0] * dirtWeight
    + style.rock[0] * rockWeight
    + style.snow[0] * snowWeight;
  let green = grassGreen * grassWeight
    + style.dirt[1] * dirtWeight
    + style.rock[1] * rockWeight
    + style.snow[1] * snowWeight;
  let blue = grassBlue * grassWeight
    + style.dirt[2] * dirtWeight
    + style.rock[2] * rockWeight
    + style.snow[2] * snowWeight;
  red *= macroRed;
  green *= macroGreen;
  blue *= macroBlue;

  const shorelineBlend = shoreline * style.shorelineStrength;
  red = lerp(red, style.shoreline[0], shorelineBlend);
  green = lerp(green, style.shoreline[1], shorelineBlend);
  blue = lerp(blue, style.shoreline[2], shorelineBlend);
  const canopyBlend = canopy * style.canopyStrength * (1 - dirtWeight);
  red = lerp(red, style.forest[0], canopyBlend);
  green = lerp(green, style.forest[1], canopyBlend);
  blue = lerp(blue, style.forest[2], canopyBlend);
  const shade = (1 - wetness * style.wetDarkening) * heightShade;

  target[offset] = linearToSrgbByte(red * shade);
  target[offset + 1] = linearToSrgbByte(green * shade);
  target[offset + 2] = linearToSrgbByte(blue * shade);
  target[offset + 3] = 255;
}
