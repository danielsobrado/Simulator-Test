const conversionBuffer = new ArrayBuffer(4);
const conversionFloat = new Float32Array(conversionBuffer);
const conversionBits = new Uint32Array(conversionBuffer);

export function floatToHalf(value) {
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Number.POSITIVE_INFINITY) return 0x7c00;
  if (value === Number.NEGATIVE_INFINITY) return 0xfc00;

  conversionFloat[0] = value;
  const raw = conversionBits[0];
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
