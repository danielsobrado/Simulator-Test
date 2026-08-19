export const TERRAIN_MATERIAL_FAMILIES = Object.freeze([
  'grass',
  'dirt',
  'rock',
  'snow',
]);

export const TERRAIN_MATERIAL_FAMILY_INDEX = Object.freeze(
  Object.fromEntries(TERRAIN_MATERIAL_FAMILIES.map((name, index) => [name, index])),
);
