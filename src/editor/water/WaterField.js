const WATER_FIELD_CHANNELS = 4;

function floatToHalf(value) {
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Number.POSITIVE_INFINITY) return 0x7c00;
  if (value === Number.NEGATIVE_INFINITY) return 0xfc00;

  const float = new Float32Array(1);
  const bits = new Uint32Array(float.buffer);
  float[0] = value;
  const raw = bits[0];
  const sign = (raw >>> 16) & 0x8000;
  let exponent = ((raw >>> 23) & 0xff) - 127 + 15;
  let mantissa = raw & 0x7fffff;

  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa = (mantissa | 0x800000) >>> (1 - exponent);
    return sign | ((mantissa + 0x1000) >>> 13);
  }
  if (exponent >= 31) return sign | 0x7c00;
  mantissa += 0x1000;
  if (mantissa & 0x800000) {
    mantissa = 0;
    exponent += 1;
    if (exponent >= 31) return sign | 0x7c00;
  }
  return sign | (exponent << 10) | (mantissa >>> 13);
}

export function halfToFloat(value) {
  const sign = (value & 0x8000) << 16;
  let exponent = (value >>> 10) & 0x1f;
  let mantissa = value & 0x03ff;
  let raw;
  if (exponent === 0) {
    if (mantissa === 0) {
      raw = sign;
    } else {
      exponent = 1;
      while ((mantissa & 0x0400) === 0) {
        mantissa <<= 1;
        exponent -= 1;
      }
      mantissa &= 0x03ff;
      raw = sign | ((exponent + 127 - 15) << 23) | (mantissa << 13);
    }
  } else if (exponent === 31) {
    raw = sign | 0x7f800000 | (mantissa << 13);
  } else {
    raw = sign | ((exponent + 127 - 15) << 23) | (mantissa << 13);
  }
  const bits = new Uint32Array(1);
  bits[0] = raw;
  return new Float32Array(bits.buffer)[0];
}

export function createWaterField({ originX, originZ, chunkSize, sampleWater }) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('Water field chunkSize must be a positive integer.');
  }
  if (typeof sampleWater !== 'function') {
    throw new Error('Water field requires a sampleWater callback.');
  }
  const width = chunkSize + 1;
  const height = chunkSize + 1;
  const pixels = new Uint16Array(width * height * WATER_FIELD_CHANNELS);
  for (let localZ = 0; localZ < height; localZ += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const sample = sampleWater(originX + localX, originZ + localZ);
      const index = (localZ * width + localX) * WATER_FIELD_CHANNELS;
      pixels[index] = floatToHalf(sample.coverage);
      pixels[index + 1] = floatToHalf(sample.surfaceHeight);
      pixels[index + 2] = floatToHalf(sample.depth);
      pixels[index + 3] = floatToHalf(sample.shoreDistance);
    }
  }
  return Object.freeze({ pixels, width, height });
}

export function enrichPageWaterField(page, sampleWater) {
  const chunkSize = page.tiles
    ? Math.round(Math.sqrt(page.tiles.length))
    : Math.round(Math.sqrt(page.heights.length) - 1);
  const field = createWaterField({
    originX: page.originX,
    originZ: page.originZ,
    chunkSize,
    sampleWater,
  });
  page.waterFieldPixels = field.pixels;
  page.waterFieldWidth = field.width;
  page.waterFieldHeight = field.height;
  return page;
}
