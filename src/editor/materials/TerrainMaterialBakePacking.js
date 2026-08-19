export function encodeTerrainMaterialWeights(target, offset, red, green, blue, alpha) {
  const scaledRed = red * 255;
  const scaledGreen = green * 255;
  const scaledBlue = blue * 255;
  const scaledAlpha = alpha * 255;
  let encodedRed = Math.floor(scaledRed);
  let encodedGreen = Math.floor(scaledGreen);
  let encodedBlue = Math.floor(scaledBlue);
  let encodedAlpha = Math.floor(scaledAlpha);
  let fractionRed = scaledRed - encodedRed;
  let fractionGreen = scaledGreen - encodedGreen;
  let fractionBlue = scaledBlue - encodedBlue;
  let fractionAlpha = scaledAlpha - encodedAlpha;
  let remainder = 255 - encodedRed - encodedGreen - encodedBlue - encodedAlpha;

  while (remainder > 0) {
    if (fractionRed >= fractionGreen && fractionRed >= fractionBlue && fractionRed >= fractionAlpha) {
      encodedRed += 1;
      fractionRed = -1;
    } else if (fractionGreen >= fractionBlue && fractionGreen >= fractionAlpha) {
      encodedGreen += 1;
      fractionGreen = -1;
    } else if (fractionBlue >= fractionAlpha) {
      encodedBlue += 1;
      fractionBlue = -1;
    } else {
      encodedAlpha += 1;
      fractionAlpha = -1;
    }
    remainder -= 1;
  }

  target[offset] = encodedRed;
  target[offset + 1] = encodedGreen;
  target[offset + 2] = encodedBlue;
  target[offset + 3] = encodedAlpha;
}
