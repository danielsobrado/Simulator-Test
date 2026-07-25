import { disposeModelParts } from '../assets/modelParts.js';

function disposeRenderer(objectView, renderer) {
  for (const mesh of renderer.meshes) {
    objectView.root.remove(mesh);
    mesh.dispose?.();
  }
  if (renderer.foundationMesh) {
    objectView.root.remove(renderer.foundationMesh);
    renderer.foundationMesh.dispose?.();
  }
  renderer.foundationGeometry?.dispose();
  renderer.foundationMaterial?.dispose();
  disposeModelParts(renderer.parts);
}

function disposePreviewMaterial(material) {
  for (const candidate of Array.isArray(material) ? material : [material]) {
    candidate?.dispose?.();
  }
}

function clearPreview(objectView, definitionKeys) {
  if (!definitionKeys.has(objectView.previewDefinitionKey)) return;
  for (const child of objectView.previewGroup.children) {
    disposePreviewMaterial(child.material);
  }
  objectView.previewGroup.clear();
  objectView.previewGroup.visible = false;
  objectView.previewDefinitionKey = null;
  objectView.previewFoundation.visible = false;
  objectView.footprintPreview.visible = false;
}

function requireProceduralDefinition(key, definition) {
  if (definition && definition.procedural !== true) {
    throw new Error(`Cannot unregister non-procedural object definition: ${key}.`);
  }
}

function allProceduralDefinitionKeys(objectMap, objectView) {
  const keys = new Set();
  for (const [key, definition] of objectMap.definitionByKey) {
    if (definition.procedural === true) keys.add(key);
  }
  for (const [key, definition] of objectView.definitionByKey) {
    if (definition.procedural === true) keys.add(key);
  }
  for (const [key, renderer] of objectView.renderers) {
    if (renderer.definition?.procedural === true) keys.add(key);
  }
  return keys;
}

export function collectProceduralDefinitionKeys({
  objectMap,
  objectView,
  definitionKeys = null,
}) {
  return definitionKeys == null
    ? allProceduralDefinitionKeys(objectMap, objectView)
    : new Set(definitionKeys);
}

export function unregisterProceduralDefinitions({
  objectMap,
  objectView,
  definitionKeys = null,
}) {
  const keys = collectProceduralDefinitionKeys({ objectMap, objectView, definitionKeys });
  if (keys.size === 0) return;

  for (const key of keys) {
    requireProceduralDefinition(key, objectMap.definitionByKey.get(key));
    requireProceduralDefinition(key, objectView.definitionByKey.get(key));
    requireProceduralDefinition(key, objectView.renderers.get(key)?.definition);
  }

  clearPreview(objectView, keys);
  for (const key of keys) {
    const renderer = objectView.renderers.get(key);
    if (renderer) disposeRenderer(objectView, renderer);
    objectView.renderers.delete(key);
    objectView.definitionByKey.delete(key);
    objectMap.definitionByKey.delete(key);
  }

  objectView.selectionOverlay.visible = false;
  objectView.refreshAll();
}
