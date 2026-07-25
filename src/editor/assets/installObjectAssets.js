import { disposeModelParts } from './modelParts.js';
import { ObjectAssetRepository } from './ObjectAssetRepository.js';

function clearPreview(objectView, definitionKey) {
  if (objectView.previewDefinitionKey !== definitionKey) {
    return false;
  }
  for (const child of objectView.previewGroup.children) {
    child.material.dispose();
  }
  objectView.previewGroup.clear();
  objectView.previewDefinitionKey = null;
  return true;
}

function replaceRendererParts(objectView, definitionKey, parts) {
  const renderer = objectView.renderers.get(definitionKey);
  if (!renderer) {
    disposeModelParts(parts);
    throw new Error(`Unknown object renderer: ${definitionKey}.`);
  }

  const rebuildPreview = clearPreview(objectView, definitionKey);
  for (const mesh of renderer.meshes) {
    objectView.root.remove(mesh);
    mesh.dispose();
  }
  renderer.meshes = [];
  renderer.capacity = 0;
  disposeModelParts(renderer.parts);
  renderer.parts = parts;
  renderer.source = 'glb';

  objectView.refreshAll();
  if (rebuildPreview) {
    objectView.rebuildPreview(definitionKey);
  }
}

export function installObjectAssets({ objectView, catalog, tileSize, ui, baseUrl }) {
  const repository = new ObjectAssetRepository({ catalog, tileSize, baseUrl });
  let active = true;

  const ready = repository.loadAll({
    onLoaded: ({ definitionKey, parts }) => {
      if (!active) {
        disposeModelParts(parts);
        return;
      }
      replaceRendererParts(objectView, definitionKey, parts);
    },
  }).then((report) => {
    repository.dispose();
    if (!active) {
      return report;
    }
    if (report.total === 0) {
      return report;
    }
    if (report.failures.length > 0) {
      console.warn('Some GLB assets failed; procedural fallbacks remain active.', report.failures);
      ui.showToast(
        `${report.loaded}/${report.total} GLB assets loaded; fallbacks remain active.`,
        true,
      );
    } else {
      ui.showToast(`${report.loaded} GLB assets loaded.`);
    }
    return report;
  }).catch((error) => {
    repository.dispose();
    console.error('Failed to initialize the GLB asset pipeline.', error);
    if (active) {
      ui.showToast('GLB loading failed; procedural fallbacks remain active.', true);
    }
    return Object.freeze({
      total: catalog.length,
      completed: catalog.length,
      loaded: 0,
      fallback: catalog.length,
      failures: Object.freeze([Object.freeze({
        definitionKey: 'pipeline',
        message: error instanceof Error ? error.message : String(error),
      })]),
    });
  });

  return {
    ready,
    dispose() {
      active = false;
      repository.dispose();
    },
  };
}
