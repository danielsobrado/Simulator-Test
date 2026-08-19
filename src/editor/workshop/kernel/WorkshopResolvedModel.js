import { projectWorkshopComposition } from '../model/composition/WorkshopCompositionProjection.js';
import { WorkshopRelationshipGraph } from '../relationships/WorkshopRelationshipGraph.js';
import { WorkshopSpatialIndex } from '../spatial/WorkshopSpatialIndex.js';
import { normalizeWorkshopDocument } from './WorkshopDocument.js';
import { WorkshopDependencyGraph } from './WorkshopDependencyGraph.js';
import { resolveWorkshopRecipe } from './WorkshopRecipeBridge.js';

export function resolveWorkshopModel(documentInput) {
  const document = normalizeWorkshopDocument(documentInput);
  const graph = new WorkshopDependencyGraph(document);
  const recipe = resolveWorkshopRecipe(document);
  return Object.freeze({
    version: document.version,
    revision: document.revision,
    rootIds: Object.freeze(document.rootIds()),
    entityOrder: graph.topologicalOrder(),
    entities: Object.freeze(document.listEntities()),
    recipe,
    composition: projectWorkshopComposition(document),
    relationships: new WorkshopRelationshipGraph(document),
    spatialIndex: new WorkshopSpatialIndex(document),
    graph,
  });
}
