/**
 * Explicit material slots on construction resident meshes.
 *
 * Do not infer the slot from mesh names — assignment and selection logic must
 * read `mesh.userData.constructionMaterialSlot`.
 */
export const CONSTRUCTION_MATERIAL_SLOT = Object.freeze({
  STONE: 'stone',
  MORTAR: 'mortar',
});
