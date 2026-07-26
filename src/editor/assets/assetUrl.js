/**
 * Shared asset URL + GLTF scene disposal helpers.
 * Keeps loaders / scatter views from re-implementing the same boilerplate.
 */

export function normalizeBaseUrl(baseUrl) {
  const value = typeof baseUrl === 'string' && baseUrl.length > 0 ? baseUrl : '/';
  return value.endsWith('/') ? value : `${value}/`;
}

export function resolveAssetUrl(baseUrl, assetPath) {
  const value = String(assetPath);
  if (/^(?:https?:|blob:|data:)/i.test(value)) return value;
  return `${normalizeBaseUrl(baseUrl)}${value.replace(/^\/+/, '')}`;
}

export function materialList(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

export function disposeScene(scene) {
  if (!scene) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  scene.traverse((node) => {
    if (!node.isMesh) return;
    if (node.geometry) geometries.add(node.geometry);
    for (const material of materialList(node)) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) textures.add(value);
      }
    }
  });

  textures.forEach((texture) => texture.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
