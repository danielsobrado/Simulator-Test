/**
 * Poly Haven (CC0 1.0) texture maps the tree pipeline is built from
 * (docs/plans/trees-aaa-plan-2026-11-10.md §4.2). Only maps are fetched, never
 * a scan's geometry.
 */

const ATLAS_MAPS = (prefix) => [`${prefix}_diff`, `${prefix}_alpha`, `${prefix}_arm`, `${prefix}_nor_gl`];
const BARK_MAPS = ['Diffuse', 'nor_gl', 'Rough', 'Displacement'];

export const lockFile = 'assets/source-library/polyhaven-trees.lock.json';
export const resolution = '2k';

/** Needle and leaf branch atlases; `preview` adds the scan's own render as a reference image. */
export const atlases = [
  { id: 'fir_tree_01', maps: ATLAS_MAPS('twig'), preview: true },
  { id: 'pine_tree_01', maps: ATLAS_MAPS('twig'), preview: true },
  { id: 'island_tree_02', maps: ATLAS_MAPS('leaves'), preview: true },
  { id: 'jacaranda_tree', maps: ATLAS_MAPS('leaves'), preview: true },
];

/** Tileable bark sets, each feeding one runtime bark profile (scripts/build-bark-scans.mjs). */
export const barks = [
  { id: 'knotted_pine_bark', maps: BARK_MAPS, profile: 'spruce' },
  { id: 'pine_bark', maps: BARK_MAPS, profile: 'pine' },
  { id: 'japanese_zelkova_bark', maps: BARK_MAPS, profile: 'beech' },
  { id: 'bark_brown_02', maps: BARK_MAPS, profile: 'swamp' },
  // The palm scan does not tile along the trunk; its rings mirror invisibly.
  { id: 'palm_tree_bark', maps: BARK_MAPS, profile: 'palm', mirror: true },
];

export const assets = [...atlases, ...barks];
