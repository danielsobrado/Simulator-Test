import { Vector3 } from 'three/webgpu';
import { prototypeRootSeat } from '../../stylized/forest/treeRootSeat.js';

const LAYERS = Object.freeze({ grass: 'meadowGrass', trees: 'treeView', rocks: 'rockView',
  bushes: 'bushView', flowers: 'flowerView', details: 'groundDetailView', tropical: 'tropicalKitView',
  crags: 'alpineRockView' });

function renderRoots(view) {
  if (!view) return [];
  if (view.root) return [view.root];
  return [...(view.meshes ?? []), ...(view.slots ?? []).map(slot => slot.mesh)].flat(Infinity).filter(Boolean);
}

/** Development layer isolation persists across ordinary visibility updates.
 * Capture only after settling; call restore before movement/performance QA.
 */
export class WorldVisualLayerControls {
  constructor(editor) { this.editor = editor; this.originalMasks = new Map(); }
  set(values = {}) {
    this.restore();
    const layers = Object.keys(values);
    for (const name of layers) if (!(name in LAYERS)) throw new Error(`Unknown visual layer: ${name}`);
    for (const [name, visible] of Object.entries(values)) {
      if (typeof visible !== 'boolean') throw new Error(`Visual layer ${name} must be boolean`);
      if (visible) continue;
      for (const root of renderRoots(this.editor.stylizedSurface[LAYERS[name]])) {
        root.traverse(node => {
          if (this.originalMasks.has(node)) return;
          this.originalMasks.set(node, node.layers.mask);
          node.layers.disableAll();
        });
      }
    }
    return { hidden: Object.keys(values).filter(name => values[name] === false), objects: this.originalMasks.size };
  }
  restore() {
    for (const [node, mask] of this.originalMasks) node.layers.mask = mask;
    this.originalMasks.clear();
  }
}

/** Identifies the actual prototype after palette overrides, without mutating it. */
export function worldVisualVegetation(editor, { radius = 160, limit = 96 } = {}) {
  const e = editor, origin = e.terrainView.floatingOrigin, camera = e.viewModeController.camera;
  const center = origin.toCanonical(camera.position.x, camera.position.z), tree = e.stylizedSurface.treeView;
  const inverse = new Map();
  for (const [asset, indices] of tree?.prototypeIndicesByAsset ?? []) {
    for (const index of indices) inverse.set(index, asset);
  }
  const project = new Vector3();
  const trees = [...(tree?.manifestStore?.cache.values() ?? [])].flatMap(entry => entry.placements ?? [])
    .map(p => ({ placement: p, distance: Math.hypot(p.x - center.x, p.z - center.z) }))
    .filter(p => p.distance <= Math.max(0, radius)).sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(0, Math.min(256, limit))).map(({ placement: p, distance }) => {
      const prototype = tree.resolvePalettePrototypeIndex(p), render = origin.toRender(p.x, p.z);
      project.set(render.x, p.height + 3 * (p.heightScale ?? p.scale), render.z).project(camera);
      return { stableId: p.stableId, x: p.x, z: p.z, distance, prototype,
        asset: inverse.get(prototype) ?? 'primary-scene', tileId: tree.tileIdAt(p.x, p.z),
        height: p.height, heightScale: p.heightScale ?? p.scale, rootFit: p.rootFit ?? null,
        speciesId: p.speciesId, ageClass: p.ageClass, crownScale: p.crownScale,
        crownAspect: p.crownAspect, crownAspectScale: p.crownAspectScale, foliageDensity: p.foliageDensity,
        screen: { x: project.x * .5 + .5, y: .5 - project.y * .5,
          visible: Math.abs(project.x) <= 1 && Math.abs(project.y) <= 1 && Math.abs(project.z) <= 1 } };
    });
  const materials = {};
  for (const [layer, key] of Object.entries(LAYERS)) {
    const found = new Set(); materials[layer] = [];
    for (const root of renderRoots(e.stylizedSurface[key])) root.traverse(node => {
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (!material || found.has(material)) continue;
        found.add(material);
        materials[layer].push({ name: material.name, type: material.type,
          motion: material.userData?.plantMotionProfile ?? null,
          anchored: !!node.geometry?.getAttribute('instancePlantRoot'), alphaTest: material.alphaTest });
      }
    });
  }
  const rootFeet = tree?.prototypes?.map((parts, prototype) => ({ prototype, ...prototypeRootSeat(parts) })) ?? [];
  return { center, trees, materials, rootFeet };
}
