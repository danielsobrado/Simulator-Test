"""Procedural PBR textures (albedo + normal maps) for all biome understory kits.

Each texture is compact (256x256), crisp, seeded, and packs structural regions
(e.g. left half = woody stem / stone / bark, right half = foliage / blooms) so
each prop uses a single draw call and material while showing rich surface detail.
"""
import math
import os
import numpy as np
from understory_common import fbm, height_to_normal, make_material, save_image


def build_all_materials(tex_dir):
    os.makedirs(tex_dir, exist_ok=True)
    mats = {}

    # 1. Arid: Prickly Pear Cactus (Opuntia pads + desert blooms + spine areoles)
    alb, nrm = _tex_cactus(tex_dir)
    mats['cactus'] = make_material('AridCactus', alb, alpha=False, normal_image=nrm, roughness=0.68)

    # 2. Arid: Agave & Yucca rosette (toothed succulent sword leaves + cream bloom stalk)
    alb, nrm = _tex_agave(tex_dir)
    mats['agave'] = make_material('AridAgave', alb, alpha=True, normal_image=nrm, roughness=0.65)

    # 3. Arid: Desert Sagebrush & Creosote scrub (gnarled wood + silvery olive leaves & yellow blossoms)
    alb = _tex_sagebrush(tex_dir)
    mats['sagebrush'] = make_material('AridSagebrush', alb, alpha=True, roughness=0.84)

    # 4. Arid / Badlands: Sun-bleached juniper deadwood & stratified red/grey sandstone
    alb, nrm = _tex_badlands_deadwood(tex_dir)
    mats['badlands_deadwood'] = make_material('BadlandsDeadwood', alb, alpha=False, normal_image=nrm, roughness=0.86)

    # 5. Savanna: Aloe & Red-Hot Poker (Kniphofia torch lily)
    alb = _tex_savanna_aloe(tex_dir)
    mats['savanna_aloe'] = make_material('SavannaAloe', alb, alpha=True, roughness=0.72)

    # 6. Meadow: Wild Lupine & Foxglove spikes
    alb = _tex_meadow_lupine(tex_dir)
    mats['meadow_lupine'] = make_material('MeadowLupine', alb, alpha=True, roughness=0.74)

    # 7. Meadow: Moorland Purple Heather & Goldenrod Hummock
    alb = _tex_meadow_heather(tex_dir)
    mats['meadow_heather'] = make_material('MeadowHeather', alb, alpha=True, roughness=0.78)

    # 8. Meadow / Rocky: Lichen Fieldstone & Spiky Purple Scotch Thistle
    alb, nrm = _tex_thistle_stone(tex_dir)
    mats['thistle_stone'] = make_material('MeadowThistleStone', alb, alpha=True, normal_image=nrm, roughness=0.80)

    # 9. Temperate Forest: Multi-tiered Lady Fern / Autumn-edged Bracken Crown
    alb = _tex_forest_bracken(tex_dir)
    mats['forest_bracken'] = make_material('ForestBracken', alb, alpha=True, roughness=0.72)

    # 10. Temperate Forest: Mossy Nurse Log with Fly Agaric (Amanita) & Golden Chanterelles
    alb, nrm = _tex_forest_mushrooms(tex_dir)
    mats['forest_mushrooms'] = make_material('ForestMushrooms', alb, alpha=False, normal_image=nrm, roughness=0.68)

    # 11. Temperate Forest: Peeling Silver Birch Log with Moss Coat & Turkey-Tail Shelf Fungi
    alb, nrm = _tex_birch_log(tex_dir)
    mats['birch_log'] = make_material('ForestBirchLog', alb, alpha=False, normal_image=nrm, roughness=0.78)

    # 12. Temperate Forest: Woodland Blackberry & Rosehip Berry Bramble
    alb = _tex_berry_bramble(tex_dir)
    mats['berry_bramble'] = make_material('ForestBerryBramble', alb, alpha=True, roughness=0.74)

    # 13. Tropical: Scarlet & Emerald Bromeliad Rosette on Mossy Root
    alb = _tex_tropical_bromeliad(tex_dir)
    mats['tropical_bromeliad'] = make_material('TropicalBromeliad', alb, alpha=True, roughness=0.55)

    # 14. Tropical: Lobster-Claw Heliconia & Broad Ginger Foliage
    alb = _tex_tropical_heliconia(tex_dir)
    mats['tropical_heliconia'] = make_material('TropicalHeliconia', alb, alpha=True, roughness=0.58)

    # 15. Tropical: Fenestrated Monstera Deliciosa & Mossy Stump
    alb = _tex_tropical_monstera(tex_dir)
    mats['tropical_monstera'] = make_material('TropicalMonstera', alb, alpha=True, roughness=0.54)

    # 16. Boreal Taiga: Reindeer Lichen, Feather Moss & Crimson Lingonberry Hummock
    alb, nrm = _tex_taiga_berry_moss(tex_dir)
    mats['taiga_berry_moss'] = make_material('TaigaBerryMoss', alb, alpha=True, normal_image=nrm, roughness=0.76)

    # 17. Boreal Taiga: Lichen Granite Slab & Frosted Spruce Deadfall
    alb, nrm = _tex_taiga_deadfall(tex_dir)
    mats['taiga_deadfall'] = make_material('TaigaDeadfall', alb, alpha=False, normal_image=nrm, roughness=0.84)

    # 18. Arctic Tundra: Purple Saxifrage & Arctic Poppy Cushion on Slate
    alb, nrm = _tex_tundra_cushion(tex_dir)
    mats['tundra_cushion'] = make_material('TundraCushion', alb, alpha=True, normal_image=nrm, roughness=0.78)

    # 19. Arctic Tundra: Windswept Prostrate Dwarf Willow & Crimson Bearberry Mat
    alb = _tex_tundra_willow(tex_dir)
    mats['tundra_willow'] = make_material('TundraWillow', alb, alpha=True, roughness=0.76)

    # 20. Swamp / Wetland: Carnivorous Sarracenia Pitcher Plants & Sundews
    alb = _tex_swamp_pitcher(tex_dir)
    mats['swamp_pitcher'] = make_material('SwampPitcher', alb, alpha=True, roughness=0.58)

    # 21. Swamp / Wetland: Glossy Marsh Marigold & Skunk Cabbage Bog Cluster
    alb = _tex_swamp_marigold(tex_dir)
    mats['swamp_marigold'] = make_material('SwampMarigold', alb, alpha=True, roughness=0.60)

    return mats


def _tex_cactus(tex_dir):
    """v < 0.72: waxy Opuntia cactus pad with areoles & spine clusters; v >= 0.72: warm coral/gold cactus flowers."""
    rng = np.random.default_rng(101)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    noise = fbm(w, h, (6, 6), rng, 4)
    ribs = 0.5 + 0.5 * np.cos(u * 2 * math.pi * 6)
    base_green = np.array([0.19, 0.34, 0.16]) + np.array([0.06, 0.09, 0.04]) * (noise[..., None] - 0.5)
    # Waxy glaucous bloom toward pad edges
    wax = np.clip(np.abs(u - 0.5) * 1.8, 0, 1)
    col = base_green * (1 - 0.25 * wax[..., None]) + np.array([0.28, 0.39, 0.26]) * (0.25 * wax[..., None])
    # Areole grid (pale wool dots + radiating spine lines)
    height = noise * 0.4 + ribs * 0.3
    for row in np.linspace(0.12, 0.64, 5):
        for col_u in np.linspace(0.1, 0.9, 6):
            cu = col_u + (0.08 if int(row * 10) % 2 else 0.0)
            dist = np.sqrt((u - cu) ** 2 + (v - row) ** 2)
            areole = np.clip(1.0 - dist / 0.028, 0, 1)
            col = col * (1 - areole[..., None]) + np.array([0.78, 0.72, 0.58]) * areole[..., None]
            height += areole * 0.35
    # Top band (v >= 0.72): desert prickly-pear blossoms (golden-orange petals + ruby center)
    flower_mask = (v >= 0.72).astype(np.float32)
    fu = (u * 4.0) % 1.0 - 0.5
    fv = (v - 0.86) / 0.14
    fr = np.sqrt(fu * fu + fv * fv)
    fang = np.arctan2(fv, fu)
    petal = 0.5 + 0.5 * np.cos(fang * 8)
    f_col = (
        np.array([0.85, 0.22, 0.14]) * np.clip(1.0 - fr * 1.8, 0, 1)[..., None]
        + np.array([0.96, 0.72, 0.16]) * np.clip(fr * 1.5, 0, 1)[..., None] * (0.75 + 0.25 * petal[..., None])
    )
    col = col * (1 - flower_mask[..., None]) + f_col * flower_mask[..., None]
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((h, w, 1))], axis=2)
    alb = save_image('arid_cactus_alb', rgba, os.path.join(tex_dir, 'arid-cactus-alb.png'))
    nrm = save_image('arid_cactus_nrm', height_to_normal(height, 2.5), os.path.join(tex_dir, 'arid-cactus-nrm.png'), non_color=True)
    return alb, nrm


def _tex_agave(tex_dir):
    """u < 0.65: tapering blue-green agave sword blade with marginal teeth; u >= 0.65: woody stalk & cream yucca bells."""
    rng = np.random.default_rng(102)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    noise = fbm(w, h, (4, 12), rng, 4)

    # Left region u in [0, 0.64]: Agave sword leaf
    lu = u / 0.64
    half_w = 0.44 * (1.0 - 0.78 * (v ** 1.15))
    teeth = 0.035 * np.maximum(0, np.sin(v * 24 * math.pi)) * (1.0 - v * 0.5)
    in_leaf = (u < 0.64) & (np.abs(lu - 0.5) <= (half_w + teeth))
    edge_dist = np.abs(lu - 0.5) / np.maximum(half_w + teeth, 1e-4)
    vein = 0.88 + 0.12 * np.cos((lu - 0.5) * 40)
    leaf_col = (
        np.array([0.16, 0.34, 0.25]) * (0.65 + 0.45 * v[..., None]) * vein[..., None]
        + np.array([0.04, 0.06, 0.04]) * (noise[..., None] - 0.5)
    )
    # Marginal cream/reddish teeth & terminal dark spine
    margin = np.clip((edge_dist - 0.82) / 0.18, 0, 1) * (teeth > 0.015)
    leaf_col = leaf_col * (1 - margin[..., None]) + np.array([0.78, 0.62, 0.42]) * margin[..., None]
    tip_spine = np.clip((v - 0.88) / 0.12, 0, 1)
    leaf_col = leaf_col * (1 - tip_spine[..., None]) + np.array([0.28, 0.14, 0.10]) * tip_spine[..., None]
    rgba[in_leaf, :3] = np.clip(leaf_col[in_leaf], 0, 1)
    rgba[in_leaf, 3] = 1.0

    # Right region u in [0.66, 1.0]: Woody stalk (v < 0.45) and creamy-gold yucca flower panicle (v >= 0.45)
    ru = (u - 0.66) / 0.34
    in_stalk = (u >= 0.66) & (v < 0.45)
    stalk_col = np.array([0.42, 0.33, 0.22]) * (0.8 + 0.4 * noise[..., None])
    rgba[in_stalk, :3] = np.clip(stalk_col[in_stalk], 0, 1)
    rgba[in_stalk, 3] = 1.0

    # Panicle blossoms (v >= 0.45, u >= 0.66)
    pv = (v - 0.45) / 0.55
    bell_clusters = np.sin(ru * 5 * math.pi) * np.sin(pv * 9 * math.pi)
    stem_rib = np.abs(ru - 0.5) < 0.08
    in_panicle = (u >= 0.66) & (v >= 0.45) & ((bell_clusters > -0.1) | stem_rib)
    blossom_col = np.where(
        stem_rib[..., None],
        np.array([0.38, 0.30, 0.20]),
        np.array([0.92, 0.88, 0.72]) * (0.8 + 0.25 * bell_clusters[..., None]),
    )
    rgba[in_panicle, :3] = np.clip(blossom_col[in_panicle], 0, 1)
    rgba[in_panicle, 3] = 1.0

    alb = save_image('arid_agave_alb', rgba, os.path.join(tex_dir, 'arid-agave-alb.png'))
    nrm = save_image('arid_agave_nrm', height_to_normal(noise + vein * 0.2, 2.0), os.path.join(tex_dir, 'arid-agave-nrm.png'), non_color=True)
    return alb, nrm


def _tex_sagebrush(tex_dir):
    """u < 0.35: gnarled desert wood bark; u >= 0.35: branching sagebrush/creosote twigs with silvery-olive leaves & yellow blooms."""
    rng = np.random.default_rng(103)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    noise = fbm(w, h, (8, 8), rng, 4)

    # Bark strip u < 0.35
    bark_mask = u < 0.34
    rgba[bark_mask, :3] = np.clip(np.array([0.34, 0.28, 0.21]) * (0.7 + 0.6 * noise[bark_mask, None]), 0, 1)
    rgba[bark_mask, 3] = 1.0

    # Foliage card u in [0.35, 1.0] with solid central cushion core + feathered sprigs
    fu = (u - 0.35) / 0.65
    cx = 0.5 + 0.06 * np.sin(v * 8.0)
    dist = np.abs(fu - cx)
    max_reach = 0.45 * np.sin(np.clip(v * 1.08, 0, 1) * math.pi) + 0.06
    r_core = np.sqrt(((fu - 0.5) / 0.34) ** 2 + ((v - 0.48) / 0.36) ** 2)
    clump = fbm(w, h, (14, 14), rng, 3)
    in_branch = (u >= 0.35) & (dist < 0.045 * (1 - 0.6 * v))
    in_leaves = (u >= 0.35) & (dist < max_reach) & (
        (r_core <= 0.85) | (clump > 0.34 + 0.28 * (dist / np.maximum(max_reach, 0.05)))
    )
    rgba[in_branch, :3] = np.array([0.46, 0.40, 0.31])
    rgba[in_branch, 3] = 1.0
    # Warm dusty olive-sage green (g > r, b so biome grading works smoothly) with muted ochre desert blooms
    is_bloom = in_leaves & (v > 0.64) & (clump > 0.68)
    leaf_col = np.array([0.36, 0.42, 0.28]) * (0.82 + 0.34 * clump[..., None])
    rgba[in_leaves, :3] = np.clip(leaf_col[in_leaves], 0, 1)
    rgba[in_leaves, 3] = 1.0
    rgba[is_bloom, :3] = np.array([0.78, 0.68, 0.36])
    return save_image('arid_sagebrush_alb', rgba, os.path.join(tex_dir, 'arid-sagebrush-alb.png'))


def _tex_badlands_deadwood(tex_dir):
    """u < 0.52: stratified red-ochre/charcoal Stonehold badlands sandstone; u >= 0.52: sun-bleached twisted juniper deadwood."""
    rng = np.random.default_rng(104)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    noise = fbm(w, h, (6, 10), rng, 4)
    grain = fbm(w, h, (3, 18), rng, 4)

    strata = 0.5 + 0.5 * np.sin((v * 8 + u * 2 + noise * 2.5) * math.pi)
    rock_col = (
        np.array([0.78, 0.66, 0.48]) * strata[..., None]
        + np.array([0.62, 0.54, 0.42]) * (1 - strata[..., None])
    ) * (0.82 + 0.32 * noise[..., None])
    # Warm golden-ochre desert lichen on upper rock faces
    lichen = (noise > 0.64) & (grain > 0.52) & (v > 0.45)
    rock_col[lichen] = np.array([0.82, 0.68, 0.36])

    wood_col = (
        np.array([0.76, 0.70, 0.58]) * (0.80 + 0.32 * grain[..., None])
        - np.array([0.14, 0.12, 0.10]) * np.clip(1.0 - np.abs(grain - 0.5) * 5.0, 0, 1)[..., None]
    )
    col = np.where((u < 0.52)[..., None], rock_col, wood_col)
    height = np.where(u < 0.52, strata * 0.5 + noise * 0.5, grain)
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((h, w, 1))], axis=2)
    alb = save_image('badlands_deadwood_alb', rgba, os.path.join(tex_dir, 'badlands-deadwood-alb.png'))
    nrm = save_image('badlands_deadwood_nrm', height_to_normal(height, 2.6), os.path.join(tex_dir, 'badlands-deadwood-nrm.png'), non_color=True)
    return alb, nrm


def _tex_savanna_aloe(tex_dir):
    """u < 0.55: toothed succulent aloe leaf blade; u >= 0.55: fiery orange-red to yellow Kniphofia (Red-Hot Poker) spike."""
    rng = np.random.default_rng(105)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    spots = fbm(w, h, (10, 16), rng, 3)

    # Aloe leaf u in [0, 0.54]
    lu = u / 0.54
    half_w = 0.42 * (1.0 - 0.82 * (v ** 1.1))
    tooth = 0.04 * np.maximum(0, np.sin(v * 20 * math.pi))
    in_leaf = (u < 0.54) & (np.abs(lu - 0.5) <= half_w + tooth)
    aloe_col = np.array([0.22, 0.36, 0.16]) * (0.7 + 0.45 * v[..., None])
    # Pale aloe maculata speckles & warm orange-red marginal teeth
    speckle = (spots > 0.66).astype(np.float32)
    aloe_col = aloe_col * (1 - 0.35 * speckle[..., None]) + np.array([0.62, 0.68, 0.48]) * (0.35 * speckle[..., None])
    rgba[in_leaf, :3] = np.clip(aloe_col[in_leaf], 0, 1)
    rgba[in_leaf, 3] = 1.0

    # Kniphofia torch-lily spike u in [0.56, 1.0]
    ru = (u - 0.56) / 0.44
    in_stem = (u >= 0.56) & (v < 0.42) & (np.abs(ru - 0.5) < 0.09)
    rgba[in_stem, :3] = np.array([0.26, 0.34, 0.16])
    rgba[in_stem, 3] = 1.0

    sv = np.clip((v - 0.38) / 0.60, 0, 1)
    spike_w = 0.36 * np.maximum(0.0, np.sin(sv * math.pi)) ** 0.75
    florets = 0.5 + 0.5 * np.cos(v * 52 * math.pi) * np.cos(ru * 10 * math.pi)
    in_spike = (u >= 0.56) & (v >= 0.38) & (np.abs(ru - 0.5) <= spike_w * (0.85 + 0.2 * florets))
    # Warm sun-baked terracotta to ochre gradient (harmonized with savanna ground & rocks)
    fire_col = (
        np.array([0.82, 0.68, 0.32]) * np.clip(1.0 - sv * 1.45, 0, 1)[..., None]
        + np.array([0.74, 0.38, 0.22]) * np.clip(sv * 1.45, 0, 1)[..., None]
    ) * (0.82 + 0.24 * florets[..., None])
    rgba[in_spike, :3] = np.clip(fire_col[in_spike], 0, 1)
    rgba[in_spike, 3] = 1.0
    return save_image('savanna_aloe_alb', rgba, os.path.join(tex_dir, 'savanna-aloe-alb.png'))


def _tex_meadow_lupine(tex_dir):
    """u < 0.5: palmate lupine basal foliage; u >= 0.5: muted dusty lavender & cream lupine flower raceme."""
    rng = np.random.default_rng(106)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    noise = fbm(w, h, (10, 10), rng, 3)

    # Palmate leaf fan in u < 0.48 with solid core for 3D cushion
    lu = (u - 0.24) / 0.24
    lv = (v - 0.42) / 0.48
    r = np.sqrt(lu * lu + lv * lv)
    ang = np.arctan2(lv, lu)
    lobe = np.abs(np.cos(ang * 4.5)) ** 0.65 * 0.88
    in_leaf = (u < 0.48) & ((r <= 0.62) | ((r < lobe) & (v > 0.15)) | ((np.abs(lu) < 0.07) & (v <= 0.45)))
    leaf_col = np.array([0.24, 0.36, 0.18]) * (0.78 + 0.32 * (1.0 - r[..., None]))
    rgba[in_leaf, :3] = np.clip(leaf_col[in_leaf], 0, 1)
    rgba[in_leaf, 3] = 1.0

    # Lupine floral spike in u >= 0.50
    ru = (u - 0.50) / 0.50
    in_stem = (u >= 0.50) & (v < 0.92) & (np.abs(ru - 0.5) < 0.065)
    rgba[in_stem, :3] = np.array([0.24, 0.34, 0.18])
    rgba[in_stem, 3] = 1.0

    sv = np.clip((v - 0.25) / 0.72, 0, 1)
    cone_w = 0.38 * (1.0 - 0.65 * sv) * np.clip(sv * 4.0, 0, 1)
    whorl = 0.5 + 0.5 * np.sin(v * 38 * math.pi)
    in_raceme = (u >= 0.50) & (v >= 0.25) & (np.abs(ru - 0.5) <= cone_w * (0.75 + 0.35 * whorl))
    # Muted dusty lavender-slate with warm cream banner tips
    banner = (whorl > 0.68).astype(np.float32)
    petal_col = (
        np.array([0.48, 0.38, 0.58]) * (1 - 0.4 * sv[..., None])
        + np.array([0.60, 0.42, 0.56]) * (0.4 * sv[..., None])
    ) * (1 - 0.55 * banner[..., None]) + np.array([0.86, 0.82, 0.76]) * (0.55 * banner[..., None])
    rgba[in_raceme, :3] = np.clip(petal_col[in_raceme] * (0.85 + 0.25 * noise[in_raceme, None]), 0, 1)
    rgba[in_raceme, 3] = 1.0
    return save_image('meadow_lupine_alb', rgba, os.path.join(tex_dir, 'meadow-lupine-alb.png'))


def _tex_meadow_heather(tex_dir):
    """u < 0.5: muted heather sprigs; u >= 0.5: warm ochre goldenrod & moorland foliage sprigs."""
    rng = np.random.default_rng(107)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    clump = fbm(w, h, (16, 16), rng, 3)

    for side, u0, bloom_rgb in ((0, 0.0, np.array([0.58, 0.38, 0.52])), (1, 0.5, np.array([0.78, 0.66, 0.32]))):
        su = (u - u0) / 0.5
        mask_half = (u >= u0) & (u < u0 + 0.5)
        cx = 0.5 + 0.06 * np.sin(v * 9.0 + side * 2.0)
        dist = np.abs(su - cx)
        env = 0.42 * np.sin(np.clip(v * 1.08, 0, 1) * math.pi) + 0.05
        r_core = np.sqrt(((su - 0.5) / 0.34) ** 2 + ((v - 0.48) / 0.36) ** 2)
        in_stem = mask_half & (dist < 0.045 * (1 - 0.5 * v))
        in_sprig = mask_half & (dist < env) & (
            (r_core <= 0.85) | (clump > 0.34 + 0.26 * (dist / np.maximum(env, 0.05)))
        )
        rgba[in_stem, :3] = np.array([0.36, 0.30, 0.22])
        rgba[in_stem, 3] = 1.0
        is_flower = in_sprig & (v > 0.42) & (clump > 0.56)
        fol_col = np.array([0.26, 0.36, 0.18]) * (0.80 + 0.34 * clump[..., None])
        rgba[in_sprig, :3] = np.clip(fol_col[in_sprig], 0, 1)
        rgba[in_sprig, 3] = 1.0
        rgba[is_flower, :3] = np.clip(bloom_rgb * (0.82 + 0.28 * clump[is_flower, None]), 0, 1)
    return save_image('meadow_heather_alb', rgba, os.path.join(tex_dir, 'meadow-heather-alb.png'))


def _tex_thistle_stone(tex_dir):
    """u < 0.48: mossy lichen-crusted fieldstone; u >= 0.48: spiny Scotch thistle stem, jagged leaves & purple flower crown."""
    rng = np.random.default_rng(108)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    noise = fbm(w, h, (8, 8), rng, 4)
    fine = fbm(w, h, (16, 16), rng, 3)

    # Stone region u < 0.48
    in_stone = u < 0.48
    stone_col = np.array([0.36, 0.35, 0.33]) * (0.68 + 0.55 * noise[..., None])
    # Xanthoria orange lichen & green moss patches
    moss = (noise > 0.58) & (v > 0.45)
    stone_col[moss] = np.array([0.20, 0.32, 0.12]) * (0.8 + 0.35 * fine[moss, None])
    orange_lichen = (fine > 0.72) & (noise < 0.55)
    stone_col[orange_lichen] = np.array([0.78, 0.46, 0.14])
    rgba[in_stone, :3] = np.clip(stone_col[in_stone], 0, 1)
    rgba[in_stone, 3] = 1.0

    # Spiny Scotch Thistle in u >= 0.50
    ru = (u - 0.50) / 0.50
    lobe_w = (0.36 * (1 - 0.55 * v) + 0.10 * np.sin(v * 18 * math.pi)) * (v < 0.74)
    head_r = np.sqrt(((ru - 0.5) / 0.28) ** 2 + ((v - 0.82) / 0.15) ** 2)
    in_leaf = (u >= 0.50) & (v < 0.74) & (np.abs(ru - 0.5) <= np.maximum(0.06, lobe_w))
    in_head = (u >= 0.50) & (head_r <= 1.0)
    rgba[in_leaf, :3] = np.clip(np.array([0.17, 0.31, 0.15]) * (0.75 + 0.4 * fine[in_leaf, None]), 0, 1)
    rgba[in_leaf, 3] = 1.0
    # Spiny involucre base (v < 0.80) and royal purple thistle plume (v >= 0.80)
    is_plume = in_head & (v >= 0.80)
    rgba[in_head & ~is_plume, :3] = np.array([0.24, 0.34, 0.18])
    rgba[is_plume, :3] = np.clip(np.array([0.66, 0.20, 0.68]) * (0.8 + 0.35 * fine[is_plume, None]), 0, 1)
    rgba[in_head, 3] = 1.0

    alb = save_image('meadow_thistle_stone_alb', rgba, os.path.join(tex_dir, 'meadow-thistle-stone-alb.png'))
    nrm = save_image('meadow_thistle_stone_nrm', height_to_normal(noise * 0.7 + fine * 0.3, 2.4), os.path.join(tex_dir, 'meadow-thistle-stone-nrm.png'), non_color=True)
    return alb, nrm


def _tex_forest_bracken(tex_dir):
    """Lush woodland lady-fern / bracken frond with serrated pinnae and warm russet spore margins."""
    w, h = 256, 512
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    t = 1.0 - ys / h
    cx = w * 0.5 + 8.0 * np.sin(t * 2.6)
    rib = np.abs(xs - cx) < 1.8 + (1.0 - t) * 1.8
    rgba[rib] = (0.18, 0.26, 0.10, 1.0)
    pinnae = 38
    for k in range(pinnae):
        tk = 0.06 + (k / pinnae) * 0.91
        y0 = h * (1.0 - tk)
        length = (w * 0.46) * math.sin(math.pi * min(1.0, tk * 1.12)) * (1.0 - tk * 0.32)
        for side in (-1, 1):
            for s in np.linspace(0, 1, 48):
                px = w * 0.5 + 8.0 * math.sin(tk * 2.6) + side * s * length
                py = y0 - s * length * 0.32
                lobe = 1.0 + 0.32 * math.sin(s * 9 * math.pi)
                half = (4.8 * ((1.0 - s) ** 0.55) + 0.7) * lobe
                yy0, yy1 = int(max(0, py - half)), int(min(h - 1, py + half))
                x = int(px)
                if 0 <= x < w:
                    shade = 0.72 + 0.38 * s
                    # Warm copper-russet tip accent on outermost pinnae (r > g on very tips)
                    if s > 0.84 and tk > 0.65:
                        rgba[yy0:yy1 + 1, x] = (0.48 * shade, 0.28 * shade, 0.12 * shade, 1.0)
                    else:
                        rgba[yy0:yy1 + 1, x] = (0.16 * shade, 0.29 * shade, 0.09 * shade, 1.0)
    return save_image('forest_bracken_alb', rgba, os.path.join(tex_dir, 'forest-bracken-alb.png'))


def _tex_forest_mushrooms(tex_dir):
    """u < 0.5: mossy decaying nurse-log bark + cream mushroom stipe; u >= 0.5: scarlet Amanita cap with white warts (top) & golden chanterelle (bottom)."""
    rng = np.random.default_rng(110)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    noise = fbm(w, h, (6, 12), rng, 4)

    # Left half: rotting wood (v < 0.65) + cream mushroom stem (v >= 0.65)
    bark = np.array([0.16, 0.11, 0.07]) * (0.7 + 0.6 * noise[..., None])
    moss_mask = (v > 0.28) & (v < 0.62) & (noise > 0.44)
    bark[moss_mask] = np.array([0.17, 0.31, 0.09]) * (0.8 + 0.4 * noise[moss_mask, None])
    stem_col = np.array([0.88, 0.84, 0.74]) * (0.85 + 0.2 * noise[..., None])
    left_col = np.where((v < 0.65)[..., None], bark, stem_col)

    # Right half: v >= 0.50 -> Fly Agaric scarlet cap with radial ivory velum warts; v < 0.50 -> Golden Chanterelle
    cu = (u - 0.75) / 0.24
    cv = (v - 0.75) / 0.24
    cr = np.sqrt(cu * cu + cv * cv)
    amanita = np.array([0.82, 0.11, 0.08]) * (0.75 + 0.3 * (1.0 - np.clip(cr, 0, 1))[..., None])
    for rad in (0.28, 0.55, 0.80):
        n_dots = int(rad * 14)
        for k in range(n_dots):
            ang = k * 2 * math.pi / n_dots + rad * 2.1
            du = cu - rad * math.cos(ang)
            dv = cv - rad * math.sin(ang)
            if_dot = (du * du + dv * dv) < 0.0065
            amanita[if_dot] = np.array([0.95, 0.92, 0.84])

    chant_ang = np.arctan2(v - 0.25, u - 0.75)
    gills = 0.5 + 0.5 * np.cos(chant_ang * 18)
    chanterelle = np.array([0.92, 0.62, 0.12]) * (0.78 + 0.28 * gills[..., None])
    right_col = np.where((v >= 0.50)[..., None], amanita, chanterelle)

    col = np.where((u < 0.50)[..., None], left_col, right_col)
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((h, w, 1))], axis=2)
    alb = save_image('forest_mushrooms_alb', rgba, os.path.join(tex_dir, 'forest-mushrooms-alb.png'))
    nrm = save_image('forest_mushrooms_nrm', height_to_normal(noise, 2.2), os.path.join(tex_dir, 'forest-mushrooms-nrm.png'), non_color=True)
    return alb, nrm


def _tex_birch_log(tex_dir):
    """Peeling white silver-birch bark with horizontal dark lenticels, mossy top band, and zoned turkey-tail bracket fungi."""
    rng = np.random.default_rng(111)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    noise = fbm(w, h, (8, 8), rng, 4)
    # u wraps around log circumference, v runs along log length -> lenticels are wide in u, thin in v
    lenticels = fbm(w, h, (4, 32), rng, 3)

    birch = np.array([0.86, 0.83, 0.78]) * (0.86 + 0.18 * noise[..., None])
    # Dark circumferential lenticel slits & amber inner bark where peeling
    slit = (lenticels > 0.68).astype(np.float32)
    peel = ((lenticels > 0.59) & (lenticels <= 0.68)).astype(np.float32)
    birch = birch * (1 - slit[..., None]) + np.array([0.14, 0.12, 0.10]) * slit[..., None]
    birch = birch * (1 - peel[..., None]) + np.array([0.62, 0.38, 0.20]) * peel[..., None]

    # Top band around u in [0.22, 0.66], v < 0.82: irregular woodland moss coat with noisy borders
    band = np.clip(1.0 - np.abs(u - 0.44 + (noise - 0.5) * 0.26) / 0.22, 0, 1) * (v < 0.82)
    moss = np.clip(band * 1.45 + (noise - 0.5) * 1.3 - 0.20, 0, 1)
    moss_col = np.array([0.16, 0.31, 0.08]) * (0.72 + 0.50 * noise[..., None])
    col = birch * (1 - moss[..., None]) + moss_col * moss[..., None]

    # Top strip v >= 0.82: concentric turkey-tail bracket fungus (Trametes versicolor) & heartwood cut rings
    ring_r = np.sqrt(((u - 0.5) / 0.45) ** 2 + ((v - 0.91) / 0.09) ** 2)
    zoned = 0.5 + 0.5 * np.cos(ring_r * 7 * math.pi)
    shelf_col = (
        np.array([0.48, 0.24, 0.12]) * zoned[..., None]
        + np.array([0.84, 0.76, 0.62]) * (1 - zoned[..., None])
    )
    col = np.where((v >= 0.82)[..., None], shelf_col, col)
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((h, w, 1))], axis=2)
    alb = save_image('forest_birch_log_alb', rgba, os.path.join(tex_dir, 'forest-birch-log-alb.png'))
    nrm = save_image('forest_birch_log_nrm', height_to_normal(noise * 0.6 + lenticels * 0.4, 2.3), os.path.join(tex_dir, 'forest-birch-log-nrm.png'), non_color=True)
    return alb, nrm


def _tex_berry_bramble(tex_dir):
    """Arching thorny woodland bramble card with serrated green leaves and glossy red/blackberry clusters."""
    rng = np.random.default_rng(112)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    noise = fbm(w, h, (10, 10), rng, 3)

    # Central thorny reddish cane
    cx = 0.5 + 0.06 * np.sin(v * 3 * math.pi)
    cane = np.abs(u - cx) < 0.032 * (1 - 0.35 * v)
    rgba[cane] = (0.36, 0.14, 0.16, 1.0)

    # Paired leaflets along cane
    for vt, side in ((0.22, -1), (0.26, 1), (0.48, -1), (0.52, 1), (0.74, -1), (0.78, 1)):
        lu = (u - (0.5 + side * 0.22)) / 0.22
        lv = (v - vt) / 0.15
        r = np.sqrt(lu * lu + lv * lv)
        serr = 0.88 + 0.12 * np.sin(np.arctan2(lv, lu) * 14)
        in_leaf = r <= serr
        vein = 0.85 + 0.15 * np.cos(lv * 16)
        lcol = np.array([0.15, 0.29, 0.10]) * (0.75 + 0.35 * (1 - r[..., None])) * vein[..., None]
        rgba[in_leaf, :3] = np.clip(lcol[in_leaf], 0, 1)
        rgba[in_leaf, 3] = 1.0

    # Berry clusters (ruby red rosehips/raspberries & deep purple-black blackberries)
    for bu, bv, is_ripe in ((0.34, 0.38, False), (0.66, 0.64, True), (0.42, 0.88, False), (0.58, 0.86, True)):
        br = np.sqrt((u - bu) ** 2 + (v - bv) ** 2)
        in_berry = br < 0.065
        drupe = 0.75 + 0.35 * np.cos((u - bu) * 90) * np.cos((v - bv) * 90)
        bcol = np.array([0.28, 0.08, 0.26]) if is_ripe else np.array([0.84, 0.12, 0.16])
        rgba[in_berry, :3] = np.clip(bcol * drupe[in_berry, None] * (0.85 + 0.2 * noise[in_berry, None]), 0, 1)
        rgba[in_berry, 3] = 1.0
    return save_image('forest_berry_bramble_alb', rgba, os.path.join(tex_dir, 'forest-berry-bramble-alb.png'))


def _tex_tropical_bromeliad(tex_dir):
    """Strap-shaped glossy bromeliad leaf: deep emerald outer half, electric scarlet-magenta inner bract base."""
    rng = np.random.default_rng(113)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    noise = fbm(w, h, (6, 12), rng, 3)

    # Left half u < 0.55: emerald outer strap leaf with subtle cross-banding
    lu = u / 0.55
    hw = 0.44 * np.maximum(0.0, np.sin(np.clip(v * 0.95 + 0.05, 0, 1) * math.pi)) ** 0.55
    in_outer = (u < 0.55) & (np.abs(lu - 0.5) <= hw)
    bands = 0.85 + 0.15 * np.sin(v * 22 * math.pi + noise * 2.0)
    outer_col = (
        np.array([0.72, 0.12, 0.18]) * np.clip(1.0 - v * 3.2, 0, 1)[..., None]
        + np.array([0.12, 0.36, 0.11]) * np.clip(v * 3.2, 0, 1)[..., None]
    ) * bands[..., None]
    rgba[in_outer, :3] = np.clip(outer_col[in_outer], 0, 1)
    rgba[in_outer, 3] = 1.0

    # Right half u >= 0.55: vivid scarlet-carmine inner bract & golden-tipped inflorescence
    ru = (u - 0.55) / 0.45
    hw_in = 0.42 * (1.0 - 0.65 * (v ** 1.3))
    in_bract = (u >= 0.55) & (np.abs(ru - 0.5) <= hw_in)
    bract_col = (
        np.array([0.88, 0.10, 0.20]) * (1 - 0.35 * (v > 0.78)[..., None])
        + np.array([0.96, 0.76, 0.14]) * (0.35 * (v > 0.78)[..., None])
    ) * (0.82 + 0.25 * bands[..., None])
    rgba[in_bract, :3] = np.clip(bract_col[in_bract], 0, 1)
    rgba[in_bract, 3] = 1.0
    return save_image('tropical_bromeliad_alb', rgba, os.path.join(tex_dir, 'tropical-bromeliad-alb.png'))


def _tex_tropical_heliconia(tex_dir):
    """u < 0.55: ribbed broad tropical ginger/banana leaf; u >= 0.55: scarlet & gold lobster-claw Heliconia bracts."""
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)

    # Broad tropical paddle leaf in u < 0.54
    lu = u / 0.54
    hw = 0.44 * np.sin(np.clip(v, 0.02, 0.98) * math.pi) ** 0.58
    in_leaf = (u < 0.54) & (np.abs(lu - 0.5) <= hw)
    midrib = np.abs(lu - 0.5) < 0.035
    veins = 0.86 + 0.14 * np.cos((v - np.abs(lu - 0.5) * 0.55) * 42 * math.pi)
    lcol = np.where(
        midrib[..., None],
        np.array([0.34, 0.50, 0.16]),
        np.array([0.14, 0.35, 0.10]) * veins[..., None],
    )
    rgba[in_leaf, :3] = np.clip(lcol[in_leaf], 0, 1)
    rgba[in_leaf, 3] = 1.0

    # Hanging Heliconia lobster-claw bracts in u >= 0.56
    ru = (u - 0.56) / 0.44
    rachis = (u >= 0.56) & (np.abs(ru - 0.5 + 0.06 * np.sin(v * 6 * math.pi)) < 0.05)
    rgba[rachis] = (0.82, 0.14, 0.12, 1.0)
    for k in range(6):
        bv = 0.16 + k * 0.14
        side = 1 if k % 2 == 0 else -1
        bu = (ru - 0.5) * side
        dv = v - bv - bu * 0.22
        in_claw = (u >= 0.56) & (bu > -0.04) & (bu < 0.42) & (np.abs(dv) < 0.065 * (1.0 - bu * 1.9))
        tip_dist = bu / 0.40
        claw_col = (
            np.array([0.88, 0.12, 0.10]) * np.clip(1.0 - tip_dist * 1.4, 0, 1)[..., None]
            + np.array([0.96, 0.80, 0.12]) * np.clip(tip_dist * 1.4, 0, 1)[..., None]
        )
        rgba[in_claw, :3] = np.clip(claw_col[in_claw], 0, 1)
        rgba[in_claw, 3] = 1.0
    return save_image('tropical_heliconia_alb', rgba, os.path.join(tex_dir, 'tropical-heliconia-alb.png'))


def _tex_tropical_monstera(tex_dir):
    """Iconic fenestrated Monstera deliciosa heart-shaped leaf with midrib and lateral cutouts."""
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)

    # Heart/ovate blade envelope
    du = np.abs(u - 0.5) * 2.0
    env = np.sin(np.clip(v, 0.03, 0.98) * math.pi) ** 0.52 * 0.92
    # Sinus notch at base
    notch = (v < 0.16) & (du < (0.16 - v) * 1.4)
    # Lateral fenestration slots
    slot_phase = np.cos((v - du * 0.22) * 15 * math.pi)
    is_slot = (du > 0.14) & (slot_phase > 0.48) & (du > env * 0.42)
    in_leaf = (du <= env) & (~notch) & (~is_slot)
    midrib = du < 0.055 * (1 - 0.5 * v)
    col = np.where(
        midrib[..., None],
        np.array([0.26, 0.44, 0.16]),
        np.array([0.12, 0.33, 0.10]) * (0.82 + 0.18 * (1 - du[..., None])),
    )
    rgba[in_leaf, :3] = np.clip(col[in_leaf], 0, 1)
    rgba[in_leaf, 3] = 1.0
    return save_image('tropical_monstera_alb', rgba, os.path.join(tex_dir, 'tropical-monstera-alb.png'))


def _tex_taiga_berry_moss(tex_dir):
    """u < 0.52: creamy reindeer lichen (Cladonia) & feather moss cushion; u >= 0.52: lingonberry/bilberry sprigs with crimson berries."""
    rng = np.random.default_rng(116)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    noise = fbm(w, h, (10, 10), rng, 4)
    fine = fbm(w, h, (20, 20), rng, 3)

    # Hummock base u < 0.52: creamy reindeer lichen tufts over boreal moss
    in_hummock = u < 0.52
    is_lichen = (fine > 0.52) & (v > 0.25)
    hum_col = np.where(
        is_lichen[..., None],
        np.array([0.78, 0.80, 0.72]) * (0.82 + 0.25 * fine[..., None]),
        np.array([0.17, 0.28, 0.11]) * (0.75 + 0.4 * noise[..., None]),
    )
    rgba[in_hummock, :3] = np.clip(hum_col[in_hummock], 0, 1)
    rgba[in_hummock, 3] = 1.0

    # Lingonberry sprig card u >= 0.52
    ru = (u - 0.52) / 0.48
    cx = 0.5 + 0.05 * np.sin(v * 8.0)
    dist = np.abs(ru - cx)
    env = 0.40 * np.sin(np.clip(v * 1.05, 0, 1) * math.pi) + 0.05
    in_sprig = (u >= 0.52) & (dist < env) & (fine > 0.32 + 0.25 * (dist / np.maximum(env, 0.05)))
    rgba[in_sprig, :3] = np.clip(np.array([0.15, 0.27, 0.11]) * (0.8 + 0.35 * fine[in_sprig, None]), 0, 1)
    rgba[in_sprig, 3] = 1.0
    # Glossy crimson lingonberries
    for bu, bv in ((0.68, 0.55), (0.82, 0.64), (0.74, 0.78), (0.78, 0.84)):
        br = np.sqrt((u - bu) ** 2 + (v - bv) ** 2)
        berry = br < 0.048
        rgba[berry, :3] = np.array([0.84, 0.12, 0.14]) * (1.1 - br[berry, None] * 6.0)
        rgba[berry, 3] = 1.0

    alb = save_image('taiga_berry_moss_alb', rgba, os.path.join(tex_dir, 'taiga-berry-moss-alb.png'))
    nrm = save_image('taiga_berry_moss_nrm', height_to_normal(fine * 0.6 + noise * 0.4, 2.2), os.path.join(tex_dir, 'taiga-berry-moss-nrm.png'), non_color=True)
    return alb, nrm


def _tex_taiga_deadfall(tex_dir):
    """u < 0.52: frost-shattered boreal granite with chartreuse map-lichen; u >= 0.52: flaky spruce deadfall bark with snow/frost."""
    rng = np.random.default_rng(117)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    noise = fbm(w, h, (12, 12), rng, 4)
    scales = fbm(w, h, (6, 20), rng, 4)

    granite = np.array([0.28, 0.30, 0.33]) * (0.68 + 0.58 * noise[..., None])
    lichen = (noise > 0.58) & (scales > 0.52)
    granite[lichen] = np.array([0.46, 0.54, 0.20]) * (0.85 + 0.25 * scales[lichen, None])
    frost = (v > 0.62) & (noise > 0.62) & (scales > 0.50)
    granite[frost] = np.array([0.78, 0.84, 0.89])

    spruce = np.array([0.26, 0.18, 0.14]) * (0.68 + 0.55 * scales[..., None])
    wood_frost = (v > 0.68) & (scales > 0.60)
    spruce[wood_frost] = np.array([0.76, 0.80, 0.85])

    col = np.where((u < 0.52)[..., None], granite, spruce)
    rgba = np.concatenate([np.clip(col, 0, 1), np.ones((h, w, 1))], axis=2)
    alb = save_image('taiga_deadfall_alb', rgba, os.path.join(tex_dir, 'taiga-deadfall-alb.png'))
    nrm = save_image('taiga_deadfall_nrm', height_to_normal(np.where(u < 0.52, noise, scales), 2.5), os.path.join(tex_dir, 'taiga-deadfall-nrm.png'), non_color=True)
    return alb, nrm


def _tex_tundra_cushion(tex_dir):
    """u < 0.55: purple saxifrage & moss campion cushion on dark slate; u >= 0.55: golden arctic poppy & alpine tuft."""
    rng = np.random.default_rng(118)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    noise = fbm(w, h, (14, 14), rng, 4)
    stars = fbm(w, h, (28, 28), rng, 3)

    # Left half: slate & purple saxifrage cushion studded with tiny 5-petal magenta blossoms
    in_left = u < 0.55
    is_slate = v < 0.35
    cushion = np.array([0.17, 0.28, 0.12]) * (0.72 + 0.45 * noise[..., None])
    blossom_grid = np.cos(u * 42 * math.pi) * np.cos(v * 28 * math.pi)
    saxifrage = ((stars > 0.56) & (blossom_grid > 0.15)) & (v >= 0.35)
    cushion[saxifrage] = np.array([0.78, 0.26, 0.72]) * (0.82 + 0.30 * blossom_grid[saxifrage, None])
    slate = np.array([0.24, 0.26, 0.29]) * (0.68 + 0.55 * noise[..., None])
    rgba[in_left, :3] = np.clip(np.where(is_slate[in_left, None], slate[in_left], cushion[in_left]), 0, 1)
    rgba[in_left, 3] = 1.0

    # Right half: Arctic poppy stem & golden cup blossom
    ru = (u - 0.55) / 0.45
    in_stem = (u >= 0.55) & (v < 0.62) & (np.abs(ru - 0.5) < 0.08 + 0.18 * (v < 0.32))
    rgba[in_stem, :3] = np.array([0.20, 0.29, 0.14])
    rgba[in_stem, 3] = 1.0
    pr = np.sqrt(((ru - 0.5) / 0.38) ** 2 + ((v - 0.74) / 0.22) ** 2)
    in_poppy = (u >= 0.55) & (pr <= 1.0)
    poppy_col = np.where(
        (pr < 0.24)[..., None],
        np.array([0.88, 0.48, 0.10]),
        np.array([0.96, 0.84, 0.18]) * (0.85 + 0.18 * (1 - pr[..., None])),
    )
    rgba[in_poppy, :3] = np.clip(poppy_col[in_poppy], 0, 1)
    rgba[in_poppy, 3] = 1.0

    alb = save_image('tundra_cushion_alb', rgba, os.path.join(tex_dir, 'tundra-cushion-alb.png'))
    nrm = save_image('tundra_cushion_nrm', height_to_normal(noise * 0.6 + stars * 0.4, 2.2), os.path.join(tex_dir, 'tundra-cushion-nrm.png'), non_color=True)
    return alb, nrm


def _tex_tundra_willow(tex_dir):
    """Windswept prostrate arctic willow & autumn-crimson bearberry mat with silvery catkins."""
    rng = np.random.default_rng(119)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    clump = fbm(w, h, (14, 14), rng, 3)

    cx = 0.5 + 0.09 * np.sin(v * 6.0)
    dist = np.abs(u - cx)
    env = 0.44 * np.sin(np.clip(v * 1.06, 0, 1) * math.pi) + 0.06
    in_branch = dist < 0.048 * (1 - 0.4 * v)
    in_mat = (dist < env) & (clump > 0.33 + 0.26 * (dist / np.maximum(env, 0.05)))
    rgba[in_branch] = (0.30, 0.20, 0.15, 1.0)
    # Mix of boreal willow green and russet-crimson alpine bearberry leaves + pale catkins
    crimson = in_mat & (clump > 0.58) & (u > 0.48)
    catkin = in_mat & (v > 0.68) & (clump > 0.68) & (u <= 0.48)
    rgba[in_mat, :3] = np.clip(np.array([0.20, 0.30, 0.14]) * (0.78 + 0.35 * clump[in_mat, None]), 0, 1)
    rgba[in_mat, 3] = 1.0
    rgba[crimson, :3] = np.clip(np.array([0.68, 0.18, 0.14]) * (0.8 + 0.3 * clump[crimson, None]), 0, 1)
    rgba[catkin, :3] = np.array([0.86, 0.84, 0.76])
    return save_image('tundra_willow_alb', rgba, os.path.join(tex_dir, 'tundra-willow-alb.png'))


def _tex_swamp_pitcher(tex_dir):
    """u < 0.55: crimson-veined Sarracenia pitcher tube wall & hood; u >= 0.55: ruby sundew rosette & sphagnum moss."""
    rng = np.random.default_rng(120)
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)
    veins = fbm(w, h, (16, 6), rng, 3)

    # Left half: Sarracenia pitcher tube (yellow-green base grading to crimson-veined upper pitcher & hood)
    in_tube = u < 0.55
    vein_net = np.clip((veins - 0.46) * 3.2, 0, 1) * np.clip(v * 1.4, 0, 1)
    pitcher_col = (
        np.array([0.22, 0.38, 0.12]) * (1.0 - 0.55 * v[..., None])
        + np.array([0.32, 0.46, 0.14]) * (0.55 * v[..., None])
    )
    pitcher_col = pitcher_col * (1 - vein_net[..., None]) + np.array([0.68, 0.10, 0.16]) * vein_net[..., None]
    rgba[in_tube, :3] = np.clip(pitcher_col[in_tube], 0, 1)
    rgba[in_tube, 3] = 1.0

    # Right half: ruby sundew spoon leaves & sphagnum base
    ru = (u - 0.55) / 0.45
    hw = 0.38 * np.sin(np.clip(v, 0.04, 0.96) * math.pi) ** 0.65
    in_sundew = (u >= 0.55) & (np.abs(ru - 0.5) <= hw)
    tentacles = np.abs(ru - 0.5) > hw * 0.65
    s_col = np.where(
        tentacles[..., None] | (v > 0.55)[..., None],
        np.array([0.78, 0.14, 0.18]),
        np.array([0.22, 0.34, 0.12]),
    )
    rgba[in_sundew, :3] = np.clip(s_col[in_sundew], 0, 1)
    rgba[in_sundew, 3] = 1.0
    return save_image('swamp_pitcher_alb', rgba, os.path.join(tex_dir, 'swamp-pitcher-alb.png'))


def _tex_swamp_marigold(tex_dir):
    """u < 0.55: glossy marsh marigold / skunk cabbage leaf; u >= 0.55: bright butter-gold bog blossoms."""
    w = h = 256
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = xs / w, 1.0 - ys / h
    rgba = np.zeros((h, w, 4), dtype=np.float32)

    # Broad marsh leaf in u < 0.55
    lu = (u - 0.275) / 0.25
    lv = (v - 0.50) / 0.45
    r = np.sqrt(lu * lu + lv * lv)
    notch = (v < 0.24) & (np.abs(lu) < (0.24 - v) * 1.3)
    in_leaf = (u < 0.55) & (r <= 0.95) & (~notch)
    vein = 0.85 + 0.15 * np.cos(r * 18)
    rgba[in_leaf, :3] = np.clip(np.array([0.15, 0.34, 0.10]) * vein[in_leaf, None], 0, 1)
    rgba[in_leaf, 3] = 1.0

    # Butter-gold 5-petal bog flower & waxy stem in u >= 0.55
    ru = (u - 0.55) / 0.45
    in_stem = (u >= 0.55) & (v < 0.55) & (np.abs(ru - 0.5) < 0.08)
    rgba[in_stem] = (0.20, 0.34, 0.11, 1.0)
    fu = (ru - 0.5) / 0.38
    fv = (v - 0.72) / 0.24
    fr = np.sqrt(fu * fu + fv * fv)
    fang = np.arctan2(fv, fu)
    petal_env = 0.75 + 0.25 * np.cos(fang * 5)
    in_flower = (u >= 0.55) & (fr <= petal_env)
    fcol = np.where(
        (fr < 0.26)[..., None],
        np.array([0.92, 0.56, 0.08]),
        np.array([0.98, 0.84, 0.12]) * (0.85 + 0.15 * (1 - fr[..., None])),
    )
    rgba[in_flower, :3] = np.clip(fcol[in_flower], 0, 1)
    rgba[in_flower, 3] = 1.0
    return save_image('swamp_marigold_alb', rgba, os.path.join(tex_dir, 'swamp-marigold-alb.png'))
