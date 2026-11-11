/**
 * Poly Haven (CC0 1.0) scans the understory is built from
 * (docs/plans/understory-aaa-plan-2026-11-10.md §4.2). `kind` is the plan's
 * class; `cutout` assets carry alpha-tested leaves.
 */

export const lockFile = 'assets/source-library/polyhaven.lock.json';
export const resolution = '2k';

const scan = (id, name, layer, kind, targetTriangles, targetHeight, cutout = true) => (
  { id, name, layer, kind, targetTriangles, targetHeight, cutout, model: true }
);

export const assets = [
  scan('fern_02', 'forest-fern-02', 'ground', 'herb', 1200, 0.75),
  scan('shrub_sorrel_01', 'forest-sorrel-01', 'ground', 'floor', 500, 0.16),
  scan('periwinkle_plant', 'forest-periwinkle-01', 'ground', 'floor', 800, 0.22),
  scan('nettle_plant', 'forest-nettle-01', 'ground', 'herb', 900, 0.85),
  scan('weed_plant_02', 'meadow-weed-02', 'ground', 'herb', 700, 0.55),
  scan('calathea_orbifolia_01', 'tropical-calathea-01', 'ground', 'herb', 1200, 0.7),
  scan('anthurium_botany_01', 'tropical-anthurium-01', 'ground', 'herb', 900, 0.8),
  scan('moss_01', 'forest-moss-01', 'ground', 'floor', 400, 0.12, false),
  scan('tree_stump_01', 'forest-stump-01', 'ground', 'wood', 800, 0.7, false),
  scan('dry_branches_medium_01', 'forest-deadfall-02', 'ground', 'wood', 700, 0.35, false),
  scan('root_cluster_01', 'forest-roots-01', 'ground', 'wood', 800, 0.45, false),
  scan('shrub_03', 'bush-forest-scan-01', 'bush', 'shrub', 1800, 1.5),
  scan('shrub_02', 'bush-meadow-scan-01', 'bush', 'shrub', 2000, 1.2),
  scan('wild_rooibos_bush', 'bush-arid-rooibos-01', 'bush', 'shrub', 1600, 1.1),
  scan('pine_sapling_small', 'bush-taiga-sapling-01', 'bush', 'shrub', 2200, 1.9),
];
