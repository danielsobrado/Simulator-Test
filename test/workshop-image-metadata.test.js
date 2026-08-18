import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWorkshopImageDimensions } from '../src/editor/workshop/ProceduralWorkshopImageMetadata.js';

function pngHeader({ ihdrLength = 13, width = 1, height = 1 } = {}) {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(ihdrLength, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpegWithFrame({ segmentLength = 7, width = 1, height = 1 } = {}) {
  const bytes = Buffer.alloc(11);
  bytes.set([0xff, 0xd8, 0xff, 0xc0]);
  bytes.writeUInt16BE(segmentLength, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

test('workshop PNG metadata requires a canonical IHDR chunk length', () => {
  assert.deepEqual(
    parseWorkshopImageDimensions(pngHeader(), 'image/png'),
    { width: 1, height: 1 },
  );
  assert.throws(
    () => parseWorkshopImageDimensions(pngHeader({ ihdrLength: 12 }), 'image/png'),
    /valid PNG/i,
  );
});

test('workshop JPEG metadata rejects truncated frame segments', () => {
  assert.throws(
    () => parseWorkshopImageDimensions(jpegWithFrame({ segmentLength: 6 }), 'image/jpeg'),
    /invalid frame segment/i,
  );
});

test('workshop image metadata reports texture-oriented validation errors', () => {
  assert.throws(
    () => parseWorkshopImageDimensions(pngHeader({ width: 0 }), 'image/png'),
    /texture image has invalid dimensions/i,
  );
  assert.throws(
    () => parseWorkshopImageDimensions(new Uint8Array(), 'image/gif'),
    /PNG, JPEG, or WebP texture image/i,
  );
});
