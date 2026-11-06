import { Group } from 'three/webgpu';
import { authoredCollisionProxyForGeometry, releaseAuthoredCollisionProxy } from './StylizedPrototypeBake.js';

const ARRAYS = ['prototypes', 'proxyPrototypes', 'meshes', 'proxyMeshes',
  'prototypeBiomeRules', 'prototypeHeights', 'prototypeFootprints', 'prototypeConform',
  'prototypeHeightOffsets', 'prototypePlacementRules', 'prototypeWaterRules',
  'prototypeStrandRules', 'prototypeShoreRules'];
const VALUES = ['prototypeIndexForRoll', 'prototypeBiomeRulesSignature', 'prototypeHeight',
  'prototypeRevision', 'clusterField', 'pathClearance'];

/** Build against detached renderers and private registry arrays; publish together. */
export function* installVariants(view, variants) {
  const stage = Object.create(view);
  const lengths = new Map();
  for (const key of ARRAYS) {
    if (!Array.isArray(view[key])) continue;
    lengths.set(key, view[key].length);
    stage[key] = view[key].slice();
  }
  stage.root = new Group();
  stage.prototypeIndicesByAsset = new Map(view.prototypeIndicesByAsset);
  const geometries = new Set(), materials = new Set();
  const job = stage.appendVariantsJob(variants);
  let published = false;
  try {
    for (;;) {
      const step = job.next();
      if (step.done) break;
      if (step.value?.isBufferGeometry) geometries.add(step.value);
      if (step.value?.isMaterial) materials.add(step.value);
      yield;
    }
    yield;
    if (view.disposed) return [];
    for (const [key, length] of lengths) view[key].push(...stage[key].slice(length));
    for (const key of VALUES) if (Object.hasOwn(stage, key)) view[key] = stage[key];
    for (const [key, indices] of stage.prototypeIndicesByAsset) view.prototypeIndicesByAsset.set(key, indices);
    const roots = stage.root.children.slice();
    if (roots.length) view.root.add(...roots);
    published = true;
    return roots;
  } finally {
    job.return();
    if (!published) {
      stage.root.traverse(mesh => {
        if (!mesh.isMesh) return;
        geometries.add(mesh.geometry);
        materials.add(mesh.material);
        mesh.dispose?.();
      });
      for (const geometry of geometries) {
        const proxy = authoredCollisionProxyForGeometry(geometry);
        if (proxy) geometries.delete(proxy.geometry);
        releaseAuthoredCollisionProxy(geometry);
        geometry.dispose();
      }
      for (const material of materials) material.dispose();
      stage.root.clear();
    }
  }
}
