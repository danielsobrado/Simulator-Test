import { normalizeProceduralRecipe } from './ProceduralAssetStore.js';
import {
  createProceduralCastleWallParts,
  getProceduralCastleWallStats,
} from './ProceduralCastleWallGenerator.js';
import {
  createProceduralMedievalWorkshopParts,
  getProceduralMedievalWorkshopStats,
} from './ProceduralMedievalWorkshopGenerator.js';

function usesCastleWallGenerator(recipe) {
  return recipe.archetype === 'wall' && recipe.shape !== 'classic';
}

export function createProceduralWorkshopParts(input) {
  const recipe = normalizeProceduralRecipe(input);
  return usesCastleWallGenerator(recipe)
    ? createProceduralCastleWallParts(recipe)
    : createProceduralMedievalWorkshopParts(recipe);
}

export function getProceduralWorkshopStats(input) {
  const recipe = normalizeProceduralRecipe(input);
  return usesCastleWallGenerator(recipe)
    ? getProceduralCastleWallStats(recipe)
    : getProceduralMedievalWorkshopStats(recipe);
}
