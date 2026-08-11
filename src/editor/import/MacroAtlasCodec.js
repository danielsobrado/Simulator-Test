const TYPE_DEFINITIONS = Object.freeze({
  u8: Object.freeze({
    bytes: 1,
    Values: Uint8Array,
    rawEncoding: 'base64-u8-v1',
    rleEncoding: 'base64-rle-u8-v1',
    read: (view, offset) => view.getUint8(offset),
    write: (view, offset, value) => view.setUint8(offset, value),
  }),
  i8: Object.freeze({
    bytes: 1,
    Values: Int8Array,
    rawEncoding: 'base64-i8-v1',
    rleEncoding: 'base64-rle-i8-v1',
    read: (view, offset) => view.getInt8(offset),
    write: (view, offset, value) => view.setInt8(offset, value),
  }),
  u16: Object.freeze({
    bytes: 2,
    Values: Uint16Array,
    rawEncoding: 'base64-le-u16-v1',
    rleEncoding: 'base64-rle-u16-v1',
    read: (view, offset) => view.getUint16(offset, true),
    write: (view, offset, value) => view.setUint16(offset, value, true),
  }),
  u32: Object.freeze({
    bytes: 4,
    Values: Uint32Array,
    rawEncoding: 'base64-le-u32-v1',
    rleEncoding: 'base64-rle-u32-v1',
    read: (view, offset) => view.getUint32(offset, true),
    write: (view, offset, value) => view.setUint32(offset, value, true),
  }),
  i16: Object.freeze({
    bytes: 2,
    Values: Int16Array,
    rawEncoding: 'base64-le-i16-v1',
    rleEncoding: 'base64-rle-i16-v1',
    read: (view, offset) => view.getInt16(offset, true),
    write: (view, offset, value) => view.setInt16(offset, value, true),
  }),
});

function typeDefinition(type) {
  const definition = TYPE_DEFINITIONS[type];
  if (!definition) throw new Error(`Unsupported macro atlas value type: ${type}.`);
  return definition;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== 'string') {
    throw new Error('Macro atlas data must be a base64 string.');
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function countRuns(values) {
  let runs = 0;
  for (let offset = 0; offset < values.length;) {
    const value = values[offset];
    let count = 1;
    while (offset + count < values.length
        && values[offset + count] === value
        && count < 0xffff) {
      count += 1;
    }
    runs += 1;
    offset += count;
  }
  return runs;
}

function encodeRaw(values, definition) {
  const bytes = new Uint8Array(values.length * definition.bytes);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    definition.write(view, index * definition.bytes, values[index]);
  }
  return bytes;
}

function encodeRuns(values, definition, runCount) {
  const recordBytes = 2 + definition.bytes;
  const bytes = new Uint8Array(runCount * recordBytes);
  const view = new DataView(bytes.buffer);
  let target = 0;
  for (let offset = 0; offset < values.length;) {
    const value = values[offset];
    let count = 1;
    while (offset + count < values.length
        && values[offset + count] === value
        && count < 0xffff) {
      count += 1;
    }
    view.setUint16(target, count, true);
    definition.write(view, target + 2, value);
    target += recordBytes;
    offset += count;
  }
  return bytes;
}

export function encodeMacroField(values, type, metadata = {}) {
  const definition = typeDefinition(type);
  if (!(values instanceof definition.Values)) {
    throw new Error(`Macro atlas field ${type} requires ${definition.Values.name} values.`);
  }
  const runCount = countRuns(values);
  const useRuns = runCount * (2 + definition.bytes) < values.length * definition.bytes;
  const bytes = useRuns
    ? encodeRuns(values, definition, runCount)
    : encodeRaw(values, definition);
  return {
    type,
    encoding: useRuns ? definition.rleEncoding : definition.rawEncoding,
    data: bytesToBase64(bytes),
    length: values.length,
    ...metadata,
  };
}

export function decodeMacroField(payload, expectedType = payload?.type) {
  if (!payload || !Number.isInteger(payload.length) || payload.length < 0) {
    throw new Error('Macro atlas payload length is invalid.');
  }
  const type = expectedType ?? payload.type;
  const definition = typeDefinition(type);
  if (payload.type !== undefined && payload.type !== type) {
    throw new Error(`Macro atlas field type ${payload.type} does not match ${type}.`);
  }
  const bytes = base64ToBytes(payload.data);
  const result = new definition.Values(payload.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (payload.encoding === definition.rawEncoding) {
    if (bytes.byteLength !== payload.length * definition.bytes) {
      throw new Error('Macro atlas raw payload has an invalid size.');
    }
    for (let index = 0; index < result.length; index += 1) {
      result[index] = definition.read(view, index * definition.bytes);
    }
    return result;
  }

  const recordBytes = 2 + definition.bytes;
  if (payload.encoding !== definition.rleEncoding || bytes.byteLength % recordBytes !== 0) {
    throw new Error(`Unsupported macro atlas encoding: ${payload.encoding}.`);
  }
  let target = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += recordBytes) {
    const count = view.getUint16(offset, true);
    const value = definition.read(view, offset + 2);
    if (count < 1 || target + count > result.length) {
      throw new Error('Macro atlas RLE payload is invalid.');
    }
    result.fill(value, target, target + count);
    target += count;
  }
  if (target !== result.length) {
    throw new Error('Macro atlas RLE payload is incomplete.');
  }
  return result;
}

export const MACRO_ATLAS_FIELD_TYPES = Object.freeze(Object.keys(TYPE_DEFINITIONS));
