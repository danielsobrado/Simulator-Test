import { normalizeWorkshopDocument } from './WorkshopDocument.js';
import { WorkshopDependencyGraph } from './WorkshopDependencyGraph.js';
import { resolveWorkshopRecipe } from './WorkshopRecipeBridge.js';

export function resolveWorkshopModel(documentInput) {
  const document = normalizeWorkshopDocument(documentInput);
  const graph = new WorkshopDependencyGraph(document);
  return Object.freeze({
    version: document.version,
    revision: document.revision,
    rootIds: Object.freeze(document.rootIds()),
    entityOrder: graph.topologicalOrder(),
    entities: Object.freeze(document.listEntities()),
    recipe: resolveWorkshopRecipe(document),
    graph,
  });
}
