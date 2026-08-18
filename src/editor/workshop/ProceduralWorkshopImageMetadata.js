const MAX_SOURCE_DIMENSION = 4096;
const MAX_SOURCE_PIXELS = 4096 * 4096;
const PNG_IHDR_LENGTH = 13;
const JPEG_FRAME_BASE_LENGTH = 8;
const JPEG_COMPONENT_DESCRIPTOR_LENGTH = 3;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function requireBytes(bytes, offset, length, format) {
  if (offset < 0 || offset + length > bytes.length) {
    throw new Error(`The selected ${format} image header is incomplete.`);
  }
}

function ascii(bytes, offset, length) {
  requireBytes(bytes, offset, length, 'image');
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readUint16BigEndian(bytes, offset, format) {
  requireBytes(bytes, offset, 2, format);
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16LittleEndian(bytes, offset, format) {
  requireBytes(bytes, offset, 2, format);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24LittleEndian(bytes, offset, format) {
  requireBytes(bytes, offset, 3, format);
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BigEndian(bytes, offset, format) {
  requireBytes(bytes, offset, 4, format);
  return (
    bytes[offset] * 0x1000000
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  );
}

function parsePng(bytes) {
  requireBytes(bytes, 0, 24, 'PNG');
  if (
    ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value)
    || readUint32BigEndian(bytes, 8, 'PNG') !== PNG_IHDR_LENGTH
    || ascii(bytes, 12, 4) !== 'IHDR'
  ) {
    throw new Error('The selected file is not a valid PNG image.');
  }
  return {
    width: readUint32BigEndian(bytes, 16, 'PNG'),
    height: readUint32BigEndian(bytes, 20, 'PNG'),
  };
}

function parseJpeg(bytes) {
  requireBytes(bytes, 0, 4, 'JPEG');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('The selected file is not a valid JPEG image.');
  }

  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    const segmentLength = readUint16BigEndian(bytes, offset, 'JPEG');
    if (segmentLength < 2) {
      throw new Error('The selected JPEG image contains an invalid segment.');
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < JPEG_FRAME_BASE_LENGTH + JPEG_COMPONENT_DESCRIPTOR_LENGTH) {
        throw new Error('The selected JPEG image contains an invalid frame segment.');
      }
      requireBytes(bytes, offset, segmentLength, 'JPEG');
      const componentCount = bytes[offset + 7];
      if (
        componentCount <= 0
        || segmentLength !== JPEG_FRAME_BASE_LENGTH
          + componentCount * JPEG_COMPONENT_DESCRIPTOR_LENGTH
      ) {
        throw new Error('The selected JPEG image contains invalid frame components.');
      }
      return {
        height: readUint16BigEndian(bytes, offset + 3, 'JPEG'),
        width: readUint16BigEndian(bytes, offset + 5, 'JPEG'),
      };
    }
    requireBytes(bytes, offset, segmentLength, 'JPEG');
    offset += segmentLength;
  }
  throw new Error('The selected JPEG image has no readable dimensions.');
}

function parseWebp(bytes) {
  requireBytes(bytes, 0, 30, 'WebP');
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    throw new Error('The selected file is not a valid WebP image.');
  }

  const chunkType = ascii(bytes, 12, 4);
  if (chunkType === 'VP8X') {
    return {
      width: readUint24LittleEndian(bytes, 24, 'WebP') + 1,
      height: readUint24LittleEndian(bytes, 27, 'WebP') + 1,
    };
  }
  if (chunkType === 'VP8L') {
    requireBytes(bytes, 20, 5, 'WebP');
    if (bytes[20] !== 0x2f) {
      throw new Error('The selected lossless WebP image has an invalid header.');
    }
    return {
      width: 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)),
      height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)),
    };
  }
  if (chunkType === 'VP8 ') {
    requireBytes(bytes, 20, 10, 'WebP');
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      throw new Error('The selected WebP image has an invalid frame header.');
    }
    return {
      width: readUint16LittleEndian(bytes, 26, 'WebP') & 0x3fff,
      height: readUint16LittleEndian(bytes, 28, 'WebP') & 0x3fff,
    };
  }
  throw new Error(`Unsupported WebP image chunk: ${chunkType}.`);
}

function validateDimensions({ width, height }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('The selected texture image has invalid dimensions.');
  }
  if (
    width > MAX_SOURCE_DIMENSION
    || height > MAX_SOURCE_DIMENSION
    || width * height > MAX_SOURCE_PIXELS
  ) {
    throw new Error(`The selected texture image must be no larger than ${MAX_SOURCE_DIMENSION} × ${MAX_SOURCE_DIMENSION}.`);
  }
  return Object.freeze({ width, height });
}

export function parseWorkshopImageDimensions(input, mimeType) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dimensions = mimeType === 'image/png'
    ? parsePng(bytes)
    : mimeType === 'image/jpeg'
      ? parseJpeg(bytes)
      : mimeType === 'image/webp'
        ? parseWebp(bytes)
        : null;
  if (!dimensions) {
    throw new Error('Use a PNG, JPEG, or WebP texture image.');
  }
  return validateDimensions(dimensions);
}
