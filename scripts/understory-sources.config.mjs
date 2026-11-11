/**
 * Poly Haven (CC0 1.0) scans the understory is built from
 * (docs/plans/understory-aaa-plan-2026-11-10.md §4.2). `kind` is the plan's
 * class. A scan is built as a cutout when it ships an alpha map. A null
 * `targetHeight` keeps the scan's own metric size.
 *
 * Options: a scan lays several plants out in a row, and `plants` says what to
 * do with them: 'largest' keeps one, so it gets the whole triangle budget;
 * 'clump' slides them together into one patch. `groundCrop` is the fraction of
 * the scan's height below which the scanned ground disc is cut away.
 */

export const lockFile = 'assets/source-library/polyhaven.lock.json';
export const resolution = '2k';

const scan = (id, name, layer, kind, targetTriangles, targetHeight, options = {}) => (
  { id, name, layer, kind, targetTriangles, targetHeight, plants: null, groundCrop: 0, ...options, model: true }
);
const ONE = { plants: 'largest' };
const CLUMP = { plants: 'clump' };

export const assets = [
  scan('fern_02', 'forest-fern-02', 'ground', 'herb', 2000, 0.75, CLUMP),
  scan('shrub_sorrel_01', 'forest-sorrel-01', 'ground', 'floor', 1500, 0.16, CLUMP),
  scan('periwinkle_plant', 'forest-periwinkle-01', 'ground', 'floor', 2400, 0.22, CLUMP),
  scan('nettle_plant', 'forest-nettle-01', 'ground', 'herb', 2000, 0.85, ONE),
  scan('weed_plant_02', 'meadow-weed-02', 'ground', 'herb', 1200, null, ONE),
  // Pot plants: the scan's soil mound showed as a green disc. Cropped at the next build;
  // drop the `heightOffset` on their editor.config.yaml rows once the GLBs are rebuilt.
  scan('calathea_orbifolia_01', 'tropical-calathea-01', 'ground', 'herb', 1500, 0.7, { ...ONE, groundCrop: 0.12 }),
  scan('anthurium_botany_01', 'tropical-anthurium-01', 'ground', 'herb', 1500, 0.8, { ...ONE, groundCrop: 0.12 }),
  // The glTF is one 204-triangle tuft of cards (the dense mesh ships only as .blend). Built, not placed.
  scan('moss_01', 'forest-moss-01', 'ground', 'floor', 400, 0.12),
  scan('tree_stump_01', 'forest-stump-01', 'ground', 'wood', 2500, 0.7, { groundCrop: 0.3 }),
  scan('dry_branches_medium_01', 'forest-deadfall-02', 'ground', 'wood', 2000, 0.35, { groundCrop: 0.1 }),
  scan('root_cluster_01', 'forest-roots-01', 'ground', 'wood', 2500, 0.45, { groundCrop: 0.1 }),
  scan('shrub_03', 'bush-forest-scan-01', 'bush', 'shrub', 2500, 1.5, ONE),
  scan('shrub_02', 'bush-meadow-scan-01', 'bush', 'shrub', 2500, 1.2, ONE),
  scan('wild_rooibos_bush', 'bush-arid-rooibos-01', 'bush', 'shrub', 4000, 1.1, ONE),
  // Needle cards do not survive collapse decimation. Built, not placed.
  scan('pine_sapling_small', 'bush-taiga-sapling-01', 'bush', 'shrub', 6000, 1.9, ONE),

  // Second batch: natural replacements for the painted biome props, at the scans' own size.
  scan('dead_tree_trunk', 'forest-log-01', 'ground', 'wood', 2500, null, { groundCrop: 0.1 }),
  scan('dead_tree_trunk_02', 'forest-log-02', 'ground', 'wood', 2500, null, { groundCrop: 0.1 }),
  scan('dandelion_01', 'meadow-dandelion-01', 'ground', 'floor', 1500, null, CLUMP),
  scan('celandine_01', 'meadow-celandine-01', 'ground', 'floor', 2500, null, CLUMP),
  scan('shrub_01', 'meadow-flower-01', 'ground', 'herb', 2500, null, CLUMP),
  scan('cheiridopsis_succulent', 'desert-succulent-01', 'ground', 'herb', 2000, null),
  scan('crystalline_iceplant', 'desert-iceplant-01', 'ground', 'floor', 1200, null, CLUMP),
  scan('flower_gazania', 'savanna-gazania-01', 'ground', 'floor', 1800, null, CLUMP),
  scan('flower_ursinia', 'steppe-ursinia-01', 'ground', 'herb', 2000, null, CLUMP),
  scan('flower_empodium', 'savanna-empodium-01', 'ground', 'floor', 800, null, CLUMP),
  scan('dead_quiver_trunk', 'badlands-trunk-01', 'ground', 'wood', 2000, null),
  scan('pachira_aquatica_01', 'bush-tropical-pachira-01', 'bush', 'shrub', 3000, null, ONE),
];
