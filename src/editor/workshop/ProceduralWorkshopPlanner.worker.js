import { planWorkshopComposition } from './ProceduralWorkshopComposition.js';

self.onmessage = ({ data }) => {
  const { revision, recipe, dirtyIds } = data;
  try {
    self.postMessage({
      revision,
      plan: planWorkshopComposition(recipe, dirtyIds),
    });
  } catch (error) {
    self.postMessage({
      revision,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
