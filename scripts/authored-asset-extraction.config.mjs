const source = (key, input, outputDir, exports) => ({
  key,
  input,
  outputDir,
  exports,
});

const eachChild = ({
  parent,
  include = null,
  exclude = null,
  prefix,
  scale = 1,
  publishDir = null,
  publishIndices = null,
  textureSize = undefined,
}) => ({
  eachChildOf: parent,
  include,
  exclude,
  prefix,
  scale,
  publishDir,
  publishIndices,
  textureSize,
});

const grouped = ({
  name,
  roots,
  scale = 1,
  publishDir = null,
  simplifyRatio = undefined,
  simplifyError = undefined,
  textureSize = undefined,
}) => ({
  name,
  roots,
  scale,
  publishDir,
  simplifyRatio,
  simplifyError,
  textureSize,
});

/**
 * Offline curation manifest for multi-object source GLBs.
 *
 * `outputDir` is the complete non-runtime library. `publishDir` is optional and
 * receives byte-identical copies only for assets deliberately selected by the
 * runtime. Showroom ground, water, lights, atlas cards and repeated placements
 * are intentionally not exported.
 */
export const AUTHORED_ASSET_EXTRACTIONS = Object.freeze([
  source(
    'low-poly-tree-scene',
    'assets/trees/low_poly_tree_scene_free.glb',
    'assets/extracted/trees/low-poly-tree-scene',
    [
      eachChild({
        parent: 'GLTF_SceneRootNode',
        include: '^Bark',
        prefix: 'tree',
        publishDir: 'public/assets/trees/tree-scene',
        // One dense-crown and one open-crown geometry. Verified by comparing
        // rotation- and scale-invariant shape signatures (surface area / height²
        // plus vertex counts): the other 21 exports are exactly two meshes —
        // tree-02 repeated 14 times and tree-03 repeated 8 times — differing only
        // by node transform, which the scatter already randomises. tree-01 is a
        // third geometry but carries no leaf material, so the tree loader's
        // trunk+leaf contract rejects it.
        publishIndices: [1, 2],
      }),
      // Two 50/80-triangle grass shapes. `grass-dense` covers a 2.9 m footprint
      // for 80 triangles, which is the cheapest broad ground cover in the
      // library; the runtime scales both down to tuft size. They inherit the
      // tree scene's 1024 px atlas, which for a knee-high tuft is 900 KiB of
      // download after KTX2 — hence 256.
      grouped({
        name: 'grass-small',
        roots: ['Grass_B_Low_Small_1'],
        publishDir: 'public/assets/ground/tree-scene',
        textureSize: 256,
      }),
      grouped({
        name: 'grass-dense',
        roots: ['Grass_B_Low_Dense_2'],
        publishDir: 'public/assets/ground/tree-scene',
        textureSize: 256,
      }),
    ],
  ),
  source(
    'low-poly-forest-pack',
    'assets/trees/low_poly_forest_tree_pack.glb',
    'assets/extracted/trees/low-poly-forest-pack',
    [
      eachChild({
        parent: 'RootNode',
        include: '^Rocks(?:\\.\\d+)?$',
        prefix: 'rock',
        publishDir: 'public/assets/rocks/forest-pack',
        publishIndices: [1, 3, 5, 7],
      }),
      grouped({
        name: 'tree-wide-01',
        roots: ['Tree_Branches_01.001', 'Tree_Trunk_01'],
        publishDir: 'public/assets/trees/forest-pack',
      }),
      // Genuinely distinct silhouettes, not transforms of tree-wide-01: their
      // shape signatures are 12.57 and 7.99 against its 8.51. Two more conifer
      // crowns for 630 and 624 triangles.
      grouped({
        name: 'tree-wide-02',
        roots: ['Tree_Branches_01', 'Tree_Trunk_01.001'],
        publishDir: 'public/assets/trees/forest-pack',
      }),
      grouped({
        name: 'tree-wide-03',
        roots: ['Tree_Branches_01.002', 'Tree_Trunk_01.002'],
        publishDir: 'public/assets/trees/forest-pack',
      }),
      grouped({
        name: 'tree-narrow-01',
        roots: ['Tree_Branches_02', 'Tree_Trunk_02'],
        publishDir: 'public/assets/trees/forest-pack',
      }),
    ],
  ),
  source(
    'stylized-oak',
    'assets/trees/stylized_tree.glb',
    'assets/extracted/trees/stylized-oak',
    [
      // 182 154 triangles as authored — 40x the next-heaviest runtime tree, and it
      // scatters into the near band alongside up to 72 accepted trees per chunk
      // over a 3x3 window. So it does need decimating. But the two roots respond to
      // `simplifyRatio` in completely different ways, and a single ratio cannot
      // balance them:
      //
      //   ratio  leaves (`oak 01`)   branches (`oak 01.001`)
      //   0.05    2 982   ( 5.0%)     59 901  (48.9%)
      //   0.15    8 946   (15.0%)     59 888  (48.9%)
      //   0.30   17 894   (30.0%)     64 436  (52.6%)
      //   0.60   35 790   (60.0%)     80 777  (65.9%)
      //
      // The leaves are 29 826 independent quad cards, so they track the ratio
      // exactly — the simplifier just deletes whole cards. The branches are open
      // ended limb cylinders whose every rim is a border edge, and meshopt will not
      // collapse borders, so they floor at ~48.9% until the ratio climbs past 0.55.
      // Neither `simplifyError` (swept 0.02–0.40: moves branches by 456 triangles
      // in total) nor a `weld()` pass shifts that floor.
      //
      // This previously ran at 0.05, on the stated belief that the leaves were what
      // survived decimation worst. The measurements say the reverse: the crown is
      // the only thing that decimates, and at 0.05 it kept 1 491 of 29 826 leaf
      // cards over a 15.6 m canopy, which rendered as a bare branch skeleton with
      // sparse specks. The saving was illusory too — the branches cost ~59 900
      // triangles whatever this is set to, so 0.05 bought almost nothing and paid
      // for it with the entire crown.
      //
      // 0.30 is the knee: 6x the foliage for 31% more triangles than the broken
      // setting. Check `npm run validate:extracted-assets`, which now fails if the
      // two parts diverge like this again.
      grouped({
        name: 'stylized-oak',
        roots: ['oak 01', 'oak 01.001'],
        scale: 14,
        publishDir: 'public/assets/trees',
        simplifyRatio: 0.3,
        simplifyError: 0.02,
      }),
    ],
  ),
  source(
    'ruined-rock-fence',
    'assets/rocks/ruined_rock_fence.glb',
    'assets/extracted/rocks/ruined-rock-fence',
    [
      eachChild({
        parent: 'RootNode',
        include: '^\\d+_lp$',
        prefix: 'stone',
        scale: 0.01,
        publishDir: 'public/assets/rocks/ruined-fence',
        publishIndices: [0, 2, 5, 7],
      }),
    ],
  ),
  source(
    'stylized-grass',
    'assets/grass/stylized_grass.glb',
    'assets/extracted/ground/stylized-grass',
    [
      // The 32- and 96-triangle source shapes the clumps are built from. They
      // are the sparse end of the ground-cover range: a single blade and a
      // three-blade sprig for thin taiga, tundra and desert cover.
      eachChild({
        parent: 'RootNode',
        include: '^Grass:(?:Grass_Master|ShapeVariantGRP)$',
        prefix: 'source',
        scale: 0.04,
        publishDir: 'public/assets/ground/stylized-grass',
      }),
      eachChild({
        parent: 'RootNode',
        include: '^Grass:(?:Clump01GRP|Ckump02GRP|Ckump03GRP)$',
        prefix: 'clump',
        scale: 0.04,
        publishDir: 'public/assets/ground/stylized-grass',
      }),
    ],
  ),
  source(
    'weeds-and-grass',
    'assets/grass/weeds_and_grass.glb',
    'assets/extracted/ground/weeds-and-grass',
    [
      grouped({
        name: 'grass-plant-brown',
        roots: ['Grass plant brown'],
        scale: 2.2,
        publishDir: 'public/assets/ground/aquatic',
      }),
      grouped({
        name: 'grass-plant-green',
        roots: ['Grass Plant green'],
        scale: 2.2,
        publishDir: 'public/assets/ground/aquatic',
      }),
      grouped({
        name: 'weed-01',
        roots: ['weed.001'],
        scale: 2.2,
        publishDir: 'public/assets/ground/aquatic',
      }),
      grouped({
        name: 'weed-02',
        roots: ['weed.000'],
        scale: 2.2,
        publishDir: 'public/assets/ground/aquatic',
      }),
      // Tall 45–115 triangle blades. 01/03 carry Green_Grass and 04/05 the same
      // shapes in Brown_Grass, which is what lets a savanna be dry and a
      // grassland lush without a second geometry. 02 mixes both materials.
      // These already extract at metre scale (1.52 m blades, 0.25 m blossoms),
      // so they keep the default 1 and the runtime `scale` sizes them per biome.
      grouped({
        name: 'grass-blade-01',
        roots: ['Grass Blade'],
        publishDir: 'public/assets/ground/weeds',
      }),
      grouped({
        name: 'grass-blade-02',
        roots: ['Grass Blade.002'],
        publishDir: 'public/assets/ground/weeds',
      }),
      grouped({
        name: 'grass-blade-03',
        roots: ['Grass Blade.003'],
        publishDir: 'public/assets/ground/weeds',
      }),
      grouped({
        name: 'grass-blade-04',
        roots: ['Grass Blade.004'],
        publishDir: 'public/assets/ground/weeds',
      }),
      grouped({
        name: 'grass-blade-05',
        roots: ['Grass Blade.005'],
        publishDir: 'public/assets/ground/weeds',
      }),
      grouped({
        name: 'flower-01',
        roots: ['Flower'],
        publishDir: 'public/assets/ground/weeds',
      }),
      grouped({
        name: 'flower-02',
        roots: ['Flower.001'],
        publishDir: 'public/assets/ground/weeds',
      }),
    ],
  ),
  source(
    'clover',
    'assets/grass/clover_grass.glb',
    'assets/extracted/ground/clover',
    [
      grouped({
        name: 'clover',
        roots: ['foli', 'trunks'],
        scale: 0.004,
      }),
    ],
  ),
  source(
    'lotus',
    'assets/grass/lotus.glb',
    'assets/extracted/ground/lotus',
    [
      eachChild({
        parent: 'GLTF_SceneRootNode',
        include: 'Lotus',
        prefix: 'lotus',
        scale: 4,
        publishDir: 'public/assets/ground/aquatic',
        publishIndices: [3, 10],
      }),
    ],
  ),
  source(
    'simple-grass-chunks',
    'assets/grass/simple_grass_chunks.glb',
    'assets/extracted/ground/simple-grass-chunks',
    [
      // Only the three sub-40-triangle shapes are publishable. chunk-02 (52 188
      // triangles), chunk-08 (18 478), chunk-04 (4 551) and chunk-03 (2 681) are
      // ground patches whose cost was already measured and rejected for ambient
      // streaming; they stay offline for deliberate placed scenery.
      eachChild({
        parent: 'RootNode',
        prefix: 'chunk',
        publishDir: 'public/assets/ground/grass-chunks',
        publishIndices: [0, 4, 5],
        // 7-37 triangle sprigs. At 1024 px their textures dwarfed the geometry
        // by four orders of magnitude — chunk-01 published at 1.2 MiB.
        textureSize: 256,
      }),
    ],
  ),
]);
