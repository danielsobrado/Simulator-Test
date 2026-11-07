/**
 * Stores a runtime-only value (a TSL node, a texture) on `material.userData`.
 *
 * Three's NodeMaterial.copy deep-copies userData with
 * JSON.parse(JSON.stringify(...)), so every clone() serializes an enumerable
 * node graph (and the textures it samples) and hands the clone a plain JSON
 * object where the node was. A non-enumerable entry is skipped by
 * JSON.stringify: readers are unchanged, and clones simply do not carry it.
 */
export function setRuntimeUserData(material, key, value) {
  Object.defineProperty(material.userData, key, {
    value, writable: true, configurable: true, enumerable: false,
  });
  return value;
}
