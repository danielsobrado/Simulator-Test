export function writeImpostorAttribute(attribute, index, x, y, z, w, range) {
  const array = attribute.array;
  const offset = index * 4;
  // Compare the values the GPU receives, so float rounding never dirties an unchanged record.
  x = Math.fround(x);
  y = Math.fround(y);
  z = Math.fround(z);
  w = Math.fround(w);
  if (array[offset] === x && array[offset + 1] === y
      && array[offset + 2] === z && array[offset + 3] === w) return false;
  array[offset] = x;
  array[offset + 1] = y;
  array[offset + 2] = z;
  array[offset + 3] = w;
  range.min = Math.min(range.min, index);
  range.max = Math.max(range.max, index);
  return true;
}
