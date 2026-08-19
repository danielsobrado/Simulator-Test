import { normalizeProceduralRecipe } from '../ProceduralAssetStore.js';
import {
  serializeComponentTransforms,
} from '../ProceduralWorkshopComponentTransforms.js';
import {
  serializeOpeningAssemblies,
} from '../ProceduralWorkshopOpeningAssemblies.js';
import {
  serializeOpeningAttachments,
} from '../ProceduralWorkshopOpeningAttachments.js';
import {
  serializeWorkshopComposition,
} from '../ProceduralWorkshopComposition.js';
import {
  serializeWorkshopMaterialDocument,
} from '../ProceduralWorkshopMaterialConfig.js';
import {
  serializeSurfaceTextures,
} from '../ProceduralWorkshopTextureConfig.js';
import { WorkshopDocument, normalizeWorkshopDocument } from './WorkshopDocument.js';
import {
  WORKSHOP_RECIPE_ENTITY_ID,
  WORKSHOP_RECIPE_ENTITY_TYPE,
} from './WorkshopKernelConstants.js';

const STRUCTURED_FIELDS = new Set([
  'composition',
  'componentTransforms',
  'openingAttachments',
  'openingAssemblies',
]);

function serializedRecipe(input) {
  const recipe = normalizeProceduralRecipe(input);
  return {
    ...recipe,
    surfaceTextures: serializeSurfaceTextures(recipe.surfaceTextures),
    composition: serializeWorkshopComposition(recipe.composition),
    ...serializeWorkshopMaterialDocument(recipe, { surfaceTextures: recipe.surfaceTextures }),
    componentTransforms: serializeComponentTransforms(recipe.componentTransforms),
    openingAttachments: serializeOpeningAttachments(recipe.openingAttachments),
    openingAssemblies: serializeOpeningAssemblies(recipe.openingAssemblies),
  };
}

function rootProperties(recipe) {
  return Object.fromEntries(Object.entries(recipe).filter(([key]) => !STRUCTURED_FIELDS.has(key)));
}

function childEntity(id, type, properties, dependsOn = []) {
  return {
    id,
    type,
    parentId: WORKSHOP_RECIPE_ENTITY_ID,
    properties,
    dependsOn,
  };
}

export function createWorkshopDocumentFromRecipe(input) {
  const recipe = serializedRecipe(input);
  const entities = [{
    id: WORKSHOP_RECIPE_ENTITY_ID,
    type: WORKSHOP_RECIPE_ENTITY_TYPE,
    parentId: null,
    properties: rootProperties(recipe),
    dependsOn: [],
  }];

  for (const primitive of recipe.composition.primitives) {
    entities.push(childEntity(
      `composition:${primitive.id}`,
      `composition-${primitive.kind}`,
      { primitive },
    ));
  }
  for (const [componentId, transform] of Object.entries(recipe.componentTransforms)) {
    entities.push(childEntity(
      `component-transform:${componentId}`,
      'component-transform',
      { componentId, transform },
    ));
  }
  for (const [componentId, attachment] of Object.entries(recipe.openingAttachments)) {
    entities.push(childEntity(
      `opening-attachment:${componentId}`,
      'opening-attachment',
      { componentId, attachment },
    ));
  }
  for (const [assemblyId, assembly] of Object.entries(recipe.openingAssemblies)) {
    const dependencies = assembly.memberIds
      .map((memberId) => `opening-attachment:${memberId}`)
      .filter((id) => entities.some((entity) => entity.id === id));
    entities.push(childEntity(
      `opening-assembly:${assemblyId}`,
      'opening-assembly',
      { assemblyId, assembly },
      dependencies,
    ));
  }

  return new WorkshopDocument({ version: 1, revision: 0, entities });
}

function rootRecipeEntity(document) {
  const root = document.getEntity(WORKSHOP_RECIPE_ENTITY_ID);
  if (!root || root.type !== WORKSHOP_RECIPE_ENTITY_TYPE || root.parentId !== null) {
    throw new Error('Workshop document has no canonical recipe root.');
  }
  return root;
}

export function resolveWorkshopRecipe(documentInput) {
  const document = normalizeWorkshopDocument(documentInput);
  const root = rootRecipeEntity(document);
  const composition = [];
  const componentTransforms = {};
  const openingAttachments = {};
  const openingAssemblies = {};

  for (const entity of document.listEntities()) {
    if (entity.id === root.id) continue;
    if (entity.parentId !== root.id) continue;
    if (entity.type.startsWith('composition-')) {
      composition.push(entity.properties.primitive);
    } else if (entity.type === 'component-transform') {
      componentTransforms[entity.properties.componentId] = entity.properties.transform;
    } else if (entity.type === 'opening-attachment') {
      openingAttachments[entity.properties.componentId] = entity.properties.attachment;
    } else if (entity.type === 'opening-assembly') {
      openingAssemblies[entity.properties.assemblyId] = entity.properties.assembly;
    }
  }

  return normalizeProceduralRecipe({
    ...root.properties,
    composition: { version: 1, primitives: composition },
    componentTransforms,
    openingAttachments,
    openingAssemblies,
  });
}
