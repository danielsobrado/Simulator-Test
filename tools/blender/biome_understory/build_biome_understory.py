"""AAA Biome Understory Generator for Drusniel World Builder.

Authors 21 distinct, biome-specific understory props across 6 ecological kits:
  - arid/     (desert-prickly-pear-01, desert-agave-01, desert-sagebrush-01, badlands-deadwood-01)
  - meadow/   (savanna-aloe-01, meadow-lupine-01, meadow-heather-01, meadow-thistle-stone-01)
  - forest/   (forest-bracken-01, forest-mushrooms-01, forest-birch-log-01, forest-berry-bramble-01)
  - tropical/ (tropical-bromeliad-01, tropical-heliconia-01, tropical-monstera-01)
  - boreal/   (taiga-berry-moss-01, taiga-deadfall-01, tundra-cushion-01, tundra-dwarf-willow-01)
  - swamp/    (swamp-pitcher-01, swamp-marigold-01)

Run headless:
  "F:\\Blender 5.2\\blender.exe" -b --factory-startup --python tools/blender/biome_understory/build_biome_understory.py -- [--no-render]
"""
import math
import os
import random
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if THIS_DIR not in sys.path:
    sys.path.insert(0, THIS_DIR)

from understory_common import (
    MAX_TRIANGLES,
    arched_card,
    finish_mesh,
    mushroom_dome,
    place_and_export,
    rock_chunk,
    save_image,
    tube,
)
from textures import build_all_materials
from textures_extra import build_extra_materials
from builders_extra import (
    build_alpine_edelweiss_stone,
    build_bush_arid_ocotillo,
    build_bush_boreal_juniper,
    build_bush_meadow_gorse,
    build_bush_savanna_thorn,
    build_bush_swamp_buttonbush,
    build_bush_tropical_hibiscus,
    build_coastal_dune_oats,
    build_coastal_shipwreck_ribs,
    build_coastal_tidepool_coral,
    build_farmland_poppy_wheat,
    build_glacier_ice_spires,
    build_glacier_moraine_cairn,
    build_savanna_desert_rose,
    build_savanna_sunbleached_ribcage,
    build_savanna_termite_mound,
    build_steppe_feathergrass,
    build_structure_bog_fetish_totem,
    build_structure_dwarven_cairn,
    build_structure_rainforest_idol,
    build_structure_roadside_milestone,
    build_structure_ruined_column,
    build_structure_waystone_shrine,
)

ROOT = os.path.abspath(os.path.join(THIS_DIR, '..', '..', '..'))
OUT_BASE = os.path.join(ROOT, 'assets', 'runtime-sources', 'ground')
OUT_BUSHES = os.path.join(ROOT, 'assets', 'runtime-sources', 'bushes')
PREVIEW_DIR = os.path.join(ROOT, 'tmp', 'understory', 'blender')
TEX_DIR = os.path.join(ROOT, 'tmp', 'understory', 'textures')

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
RENDER = '--no-render' not in argv


# ---------------------------------------------------------------------------
# 1. ARID & BADLANDS KIT
# ---------------------------------------------------------------------------

def build_desert_prickly_pear(mat):
    """Multi-pad Opuntia prickly pear cactus with flattened 3D cladodes and desert blooms."""
    rng = random.Random(201)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # 3 basal pads + 5 upper branching pads + 4 blossoms
    pads = [
        (Vector((0.0, 0.0, 0.0)), Vector((0.08, 0.02, 0.52)), 0.24, 0.2),
        (Vector((-0.22, 0.14, 0.0)), Vector((-0.42, 0.26, 0.46)), 0.21, 0.7),
        (Vector((0.20, -0.15, 0.0)), Vector((0.40, -0.28, 0.44)), 0.20, -0.6),
        (Vector((0.06, 0.02, 0.46)), Vector((0.22, 0.16, 0.92)), 0.19, 0.5),
        (Vector((0.02, 0.01, 0.48)), Vector((-0.18, -0.14, 0.90)), 0.18, -0.4),
        (Vector((-0.38, 0.24, 0.42)), Vector((-0.55, 0.36, 0.82)), 0.16, 0.9),
        (Vector((0.36, -0.25, 0.40)), Vector((0.52, -0.12, 0.78)), 0.16, -0.3),
        (Vector((0.20, 0.15, 0.88)), Vector((0.28, 0.22, 1.18)), 0.13, 0.4),
    ]
    flowers = [
        Vector((0.28, 0.22, 1.20)),
        Vector((-0.18, -0.14, 0.92)),
        Vector((-0.55, 0.36, 0.84)),
        Vector((0.52, -0.12, 0.80)),
    ]
    for p0, p1, w, _ in pads:
        mid = p0.lerp(p1, 0.52)
        tube(bm, uv, [p0, mid, p1], [w * 0.55, w, w * 0.68], sides=6,
             u_range=(0.05, 0.95), v_range=(0.05, 0.68), cap_end=True, scale_y=0.34, rng=rng)
    for fc in flowers:
        tube(bm, uv, [fc - Vector((0, 0, 0.03)), fc + Vector((0, 0, 0.06)), fc + Vector((0, 0, 0.12))],
             [0.03, 0.07, 0.11], sides=5, u_range=(0.1, 0.9), v_range=(0.74, 0.98), cap_end=False)
    return finish_mesh('desert-prickly-pear-01', bm, mat)


def build_desert_agave(mat):
    """Sculpted blue-green desert agave rosette with toothed leaves and central yucca flower stalk."""
    rng = random.Random(202)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Two tiers of succulent sword blades (outer low & wide, inner upright)
    for tier, count, pitch_lo, pitch_hi, length in ((0, 9, 0.25, 0.48, 0.82), (1, 7, 0.55, 0.82, 0.68)):
        for k in range(count):
            yaw = (k + 0.5 * tier) / count * 2 * math.pi + rng.uniform(-0.14, 0.14)
            pitch = rng.uniform(pitch_lo, pitch_hi)
            out = Vector((math.cos(yaw), math.sin(yaw), 0))
            side = Vector((-math.sin(yaw), math.cos(yaw), 0))
            p0 = out * 0.06 + Vector((0, 0, 0.03 + tier * 0.04))
            p1 = out * (length * 0.52 * math.cos(pitch)) + Vector((0, 0, length * 0.55 * math.sin(pitch) + 0.08))
            p2 = out * (length * 0.96 * math.cos(pitch * 0.85)) + Vector((0, 0, length * 0.92 * math.sin(pitch * 0.85)))
            arched_card(bm, uv, p0, p1, p2, 0.16, 0.24, 0.04, side, u_range=(0.0, 0.64), v_range=(0.02, 0.98))

    # Companion offset agave pup rosette for a grounded, natural desert succulent cluster
    pup_center = Vector((0.34, -0.16, 0.0))
    for k in range(7):
        yaw = k / 7 * 2 * math.pi + 0.35
        pitch = rng.uniform(0.32, 0.62)
        length = 0.48
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = pup_center + out * 0.04 + Vector((0, 0, 0.02))
        p1 = pup_center + out * (length * 0.52 * math.cos(pitch)) + Vector((0, 0, length * 0.55 * math.sin(pitch) + 0.05))
        p2 = pup_center + out * (length * 0.96 * math.cos(pitch * 0.85)) + Vector((0, 0, length * 0.92 * math.sin(pitch * 0.85)))
        arched_card(bm, uv, p0, p1, p2, 0.12, 0.18, 0.03, side, u_range=(0.0, 0.64), v_range=(0.02, 0.98))
    return finish_mesh('desert-agave-01', bm, mat)


def build_desert_sagebrush(mat):
    """Grounded desert sagebrush & creosote hummock with 3D faceted cushion core and wide-skirted dome cards."""
    rng = random.Random(203)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Grounded 3D faceted woody/stone root hummock + central dense foliage dome cushion (matches SM_Rocks facets)
    rock_chunk(bm, uv, Vector((-0.14, 0.08, 0.10)), (0.34, 0.28, 0.16), u_range=(0.04, 0.30), v_range=(0.15, 0.85), subdivisions=1, rng=rng, dome=True)
    rock_chunk(bm, uv, Vector((0.04, -0.02, 0.18)), (0.48, 0.44, 0.26), u_range=(0.54, 0.80), v_range=(0.25, 0.72), subdivisions=1, rng=rng, dome=True)

    # 3 low spreading gnarled woody branches hugging the sand
    for k in range(3):
        yaw = k * 2 * math.pi / 3 + rng.uniform(-0.25, 0.25)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        pts = [
            out * 0.08 + Vector((0, 0, -0.03)),
            out * 0.32 + Vector((0, 0, 0.14)),
            out * 0.52 + Vector((rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06), 0.28)),
        ]
        tube(bm, uv, pts, [0.055, 0.038, 0.018], sides=4, u_range=(0.02, 0.32), v_range=(0.05, 0.90), rough=0.06, rng=rng)

    # 10 wide-skirted inward-arching dome cards (grounded `/\` mound silhouette, never V-shaped `\/`)
    for k in range(10):
        yaw = k / 10 * 2 * math.pi + rng.uniform(-0.18, 0.18)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        r0 = rng.uniform(0.42, 0.56)
        r1 = rng.uniform(0.52, 0.66)
        r2 = rng.uniform(0.16, 0.30)
        p0 = out * r0 + Vector((0, 0, -0.02))
        p1 = out * r1 + Vector((0, 0, rng.uniform(0.20, 0.30)))
        p2 = out * r2 + Vector((0, 0, rng.uniform(0.38, 0.50)))
        w = rng.uniform(0.46, 0.60)
        arched_card(bm, uv, p0, p1, p2, w * 0.85, w, w * 0.68, side, u_range=(0.35, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('desert-sagebrush-01', bm, mat)


def build_badlands_deadwood(mat):
    """Stratified Stonehold sandstone slab & cairn with twisted sun-bleached juniper deadwood."""
    rng = random.Random(204)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Two weathered sandstone slabs
    rock_chunk(bm, uv, Vector((-0.28, 0.12, 0.18)), (0.48, 0.36, 0.26), u_range=(0.02, 0.48), v_range=(0.05, 0.92), subdivisions=2, rng=rng)
    rock_chunk(bm, uv, Vector((0.32, -0.18, 0.12)), (0.34, 0.28, 0.18), u_range=(0.02, 0.48), v_range=(0.05, 0.92), subdivisions=1, rng=rng)

    # Twisted sun-bleached juniper trunk & two forks
    trunk = [
        Vector((-0.10, -0.05, 0.02)),
        Vector((0.08, 0.04, 0.36)),
        Vector((0.28, 0.12, 0.64)),
        Vector((0.55, 0.05, 0.78)),
    ]
    tube(bm, uv, trunk, [0.13, 0.10, 0.075, 0.035], sides=6, u_range=(0.54, 0.98), v_range=(0.05, 0.92), rough=0.10, rng=rng)
    fork1 = [trunk[1], Vector((-0.18, 0.28, 0.62)), Vector((-0.36, 0.42, 0.84))]
    tube(bm, uv, fork1, [0.07, 0.045, 0.02], sides=5, u_range=(0.54, 0.98), v_range=(0.15, 0.90), rough=0.08, rng=rng)
    fork2 = [trunk[2], Vector((0.34, -0.22, 0.86)), Vector((0.42, -0.38, 1.02))]
    tube(bm, uv, fork2, [0.055, 0.035, 0.016], sides=4, u_range=(0.54, 0.98), v_range=(0.20, 0.92), rough=0.08, rng=rng)
    return finish_mesh('badlands-deadwood-01', bm, mat)


# ---------------------------------------------------------------------------
# 2. SAVANNA & MEADOW KIT
# ---------------------------------------------------------------------------

def build_savanna_aloe(mat):
    """Savanna succulent aloe rosette nestled against a weathered stone mound with low warm torch-lily spikes."""
    rng = random.Random(205)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Grounded 3D faceted succulent/stone core cushion
    rock_chunk(bm, uv, Vector((0.0, 0.0, 0.11)), (0.36, 0.34, 0.18), u_range=(0.14, 0.40), v_range=(0.15, 0.72), subdivisions=1, rng=rng, dome=True)

    # 10 arching toothed aloe leaves hugging the ground
    for k in range(10):
        yaw = k / 10 * 2 * math.pi + rng.uniform(-0.18, 0.18)
        length = rng.uniform(0.56, 0.78)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = out * 0.08 + Vector((0, 0, 0.02))
        p1 = out * (length * 0.54) + Vector((0, 0, length * 0.34))
        p2 = out * (length * 0.96) + Vector((0, 0, length * 0.12))
        arched_card(bm, uv, p0, p1, p2, 0.16, 0.24, 0.05, side, u_range=(0.0, 0.54), v_range=(0.02, 0.98))

    # 4 compact crossed-card torch-lily flower spikes (8 cards, low 0.58..0.76m profile)
    spikes = [
        (Vector((0.0, 0.0, 0.04)), Vector((0.02, 0.01, 0.76)), 0.20),
        (Vector((0.12, 0.08, 0.04)), Vector((0.20, 0.14, 0.68)), 0.18),
        (Vector((-0.12, 0.07, 0.04)), Vector((-0.20, 0.12, 0.64)), 0.18),
        (Vector((0.05, -0.13, 0.04)), Vector((0.10, -0.22, 0.58)), 0.17),
    ]
    for b0, b2, w in spikes:
        b1 = b0.lerp(b2, 0.48)
        for cross in (0.0, 0.5 * math.pi):
            yaw = math.atan2(b2.y - b0.y, b2.x - b0.x) + cross
            side = Vector((math.cos(yaw), math.sin(yaw), 0))
            arched_card(bm, uv, b0, b1, b2, w * 0.48, w, w * 0.72, side, u_range=(0.56, 1.0), v_range=(0.02, 0.98), v_mid=0.42)
    return finish_mesh('savanna-aloe-01', bm, mat)


def build_meadow_lupine(mat):
    """Compact wild lupine & foxglove cluster with grounded 3D basal foliage cushion."""
    rng = random.Random(206)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Grounded 3D faceted foliage cushion core
    rock_chunk(bm, uv, Vector((0.0, 0.0, 0.12)), (0.38, 0.36, 0.18), u_range=(0.12, 0.36), v_range=(0.24, 0.68), subdivisions=1, rng=rng, dome=True)

    # 8 wide basal palmate leaf cards
    for k in range(8):
        yaw = k / 8 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = out * 0.08 + Vector((0, 0, 0.02))
        p1 = out * 0.36 + Vector((0, 0, 0.24))
        p2 = out * 0.64 + Vector((0, 0, 0.16))
        arched_card(bm, uv, p0, p1, p2, 0.20, 0.38, 0.28, side, u_range=(0.0, 0.48), v_range=(0.04, 0.96))

    # 5 compact crossed-plane lupine floral spikes (10 cards, 0.56..0.76m profile)
    for k in range(5):
        yaw = k / 5 * 2 * math.pi + rng.uniform(-0.18, 0.18)
        rad = 0.04 if k == 0 else rng.uniform(0.12, 0.24)
        height = 0.76 if k == 0 else rng.uniform(0.56, 0.70)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        b0 = out * (rad * 0.5) + Vector((0, 0, 0.04))
        b1 = out * (rad * 0.85) + Vector((0, 0, height * 0.46))
        b2 = out * rad + Vector((0, 0, height))
        for cross in (0.0, 0.5 * math.pi):
            side = Vector((math.cos(yaw + cross), math.sin(yaw + cross), 0))
            arched_card(bm, uv, b0, b1, b2, 0.14, 0.24, 0.15, side, u_range=(0.50, 1.0), v_range=(0.02, 0.98), v_mid=0.38)
    return finish_mesh('meadow-lupine-01', bm, mat)


def build_meadow_heather(mat):
    """Dense sunlit hummock of moorland heather and goldenrod with a 3D faceted cushion core."""
    rng = random.Random(207)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Two grounded 3D faceted hummock cushions at the core
    rock_chunk(bm, uv, Vector((-0.08, 0.04, 0.14)), (0.44, 0.38, 0.22), u_range=(0.14, 0.36), v_range=(0.24, 0.72), subdivisions=1, rng=rng, dome=True)
    rock_chunk(bm, uv, Vector((0.18, -0.10, 0.10)), (0.32, 0.28, 0.16), u_range=(0.64, 0.86), v_range=(0.24, 0.72), subdivisions=1, rng=rng, dome=True)

    # 12 wide-skirted inward-arching sprig cards hugging the hummock
    for k in range(12):
        yaw = k / 12 * 2 * math.pi + rng.uniform(-0.20, 0.20)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        r0 = rng.uniform(0.38, 0.52)
        r1 = rng.uniform(0.46, 0.62)
        r2 = rng.uniform(0.16, 0.30)
        h_top = rng.uniform(0.34, 0.48)
        p0 = out * r0 + Vector((0, 0, -0.02))
        p1 = out * r1 + Vector((0, 0, h_top * 0.58))
        p2 = out * r2 + Vector((0, 0, h_top))
        u_rng = (0.0, 0.5) if (k % 3 != 0) else (0.5, 1.0)
        w = rng.uniform(0.36, 0.48)
        arched_card(bm, uv, p0, p1, p2, w * 0.82, w, w * 0.68, side, u_range=u_rng, v_range=(0.02, 0.98))
    return finish_mesh('meadow-heather-01', bm, mat)


def build_meadow_thistle_stone(mat):
    """Moss-and-lichen crusted fieldstone flanked by spiky purple Scotch thistles."""
    rng = random.Random(208)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Weathered fieldstone boulder + smaller companion stone
    rock_chunk(bm, uv, Vector((-0.18, 0.06, 0.20)), (0.44, 0.36, 0.28), u_range=(0.02, 0.46), v_range=(0.04, 0.94), subdivisions=1, rng=rng)
    rock_chunk(bm, uv, Vector((0.24, -0.18, 0.11)), (0.25, 0.22, 0.15), u_range=(0.02, 0.46), v_range=(0.04, 0.94), subdivisions=1, rng=rng)

    # 5 crossed Scotch thistle stems (10 cards) emerging behind and beside the stones
    thistles = [
        (Vector((0.12, 0.16, 0.02)), Vector((0.22, 0.26, 0.96)), 0.28),
        (Vector((0.28, 0.04, 0.02)), Vector((0.44, 0.08, 0.82)), 0.25),
        (Vector((-0.04, -0.22, 0.02)), Vector((-0.08, -0.36, 0.76)), 0.24),
        (Vector((-0.34, -0.16, 0.02)), Vector((-0.48, -0.26, 0.68)), 0.22),
        (Vector((0.02, 0.28, 0.02)), Vector((0.04, 0.44, 0.72)), 0.22),
    ]
    for b0, b2, w in thistles:
        b1 = b0.lerp(b2, 0.52)
        for cross in (0.0, 0.5 * math.pi):
            side = Vector((math.cos(cross + 0.4), math.sin(cross + 0.4), 0))
            arched_card(bm, uv, b0, b1, b2, w * 0.65, w, w * 0.75, side, u_range=(0.50, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('meadow-thistle-stone-01', bm, mat)


# ---------------------------------------------------------------------------
# 3. TEMPERATE FOREST & RAINFOREST KIT
# ---------------------------------------------------------------------------

def build_forest_bracken(mat):
    """Multi-tiered woodland lady-fern / autumn-edged bracken crown."""
    rng = random.Random(209)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    for tier, count, pitch_boost, len_scale in ((0, 9, 0.0, 1.0), (1, 6, 0.24, 0.74)):
        for k in range(count):
            yaw = (k + 0.4 * tier) / count * 2 * math.pi + rng.uniform(-0.2, 0.2)
            length = rng.uniform(0.78, 1.12) * len_scale
            width = length * 0.34
            out = Vector((math.cos(yaw), math.sin(yaw), 0))
            side = Vector((-math.sin(yaw), math.cos(yaw), 0))
            p0 = out * 0.04 + Vector((0, 0, 0.03 + tier * 0.04))
            p1 = out * (length * 0.46) + Vector((0, 0, length * (0.54 + pitch_boost)))
            p2 = out * (length * 0.96) + Vector((0, 0, length * (0.22 + pitch_boost * 0.8)))
            arched_card(bm, uv, p0, p1, p2, width * 0.32, width, width * 0.42, side, u_range=(0.0, 1.0), v_range=(0.0, 1.0))
    return finish_mesh('forest-bracken-01', bm, mat)


def build_forest_mushrooms(mat):
    """Mossy decaying nurse-log chunk with 3D Fly Agaric (Amanita) and golden Chanterelle clusters."""
    rng = random.Random(210)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Mossy nurse log base
    log_pts = [
        Vector((-0.65, -0.06, 0.14)),
        Vector((-0.20, 0.04, 0.18)),
        Vector((0.25, 0.02, 0.16)),
        Vector((0.68, -0.05, 0.12)),
    ]
    tube(bm, uv, log_pts, [0.22, 0.24, 0.21, 0.17], sides=7, u_range=(0.04, 0.46), v_range=(0.04, 0.60), rough=0.08, rng=rng)

    # 5 scarlet Fly Agaric (Amanita muscaria) mushrooms (stipe + 3D spotted cap)
    amanitas = [
        (Vector((-0.12, 0.02, 0.32)), 0.26, 0.16, 0.08),
        (Vector((0.14, 0.06, 0.30)), 0.21, 0.13, 0.065),
        (Vector((-0.34, -0.04, 0.28)), 0.16, 0.10, 0.05),
        (Vector((0.04, -0.26, 0.0)), 0.22, 0.12, 0.06),
        (Vector((-0.22, 0.28, 0.0)), 0.17, 0.09, 0.045),
    ]
    for base, h, rad, ch in amanitas:
        lean = Vector((rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), h))
        top = base + lean
        tube(bm, uv, [base, base + lean * 0.55, top], [rad * 0.24, rad * 0.18, rad * 0.15],
             sides=4, u_range=(0.08, 0.42), v_range=(0.68, 0.96), cap_end=False)
        mushroom_dome(bm, uv, top, rad, ch, sides=6, u_range=(0.52, 0.98), v_range=(0.52, 0.98), tilt=lean)

    # 4 golden Chanterelles around the mossy foot
    chanterelles = [
        (Vector((0.32, 0.22, 0.0)), 0.14, 0.085),
        (Vector((0.44, 0.14, 0.0)), 0.11, 0.070),
        (Vector((-0.42, -0.24, 0.0)), 0.13, 0.080),
        (Vector((0.22, -0.22, 0.0)), 0.10, 0.065),
    ]
    for base, h, rad in chanterelles:
        top = base + Vector((0, 0, h))
        tube(bm, uv, [base, top], [rad * 0.25, rad * 0.42], sides=4, u_range=(0.55, 0.95), v_range=(0.05, 0.45), cap_end=False)
        mushroom_dome(bm, uv, top, rad, 0.025, sides=5, u_range=(0.52, 0.98), v_range=(0.02, 0.48))
    return finish_mesh('forest-mushrooms-01', bm, mat)


def build_forest_birch_log(mat):
    """Fallen peeling white silver-birch log with mossy top coat and turkey-tail shelf fungi."""
    rng = random.Random(211)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    length = 4.2
    pts, radii = [], []
    for i in range(6):
        t = i / 5
        pts.append(Vector((t * length - length * 0.5, 0.07 * math.sin(t * 4.5), 0.26 - 0.08 * t + 0.03 * math.sin(t * 6))))
        radii.append(0.30 * (1.0 - 0.26 * t))
    tube(bm, uv, pts, radii, sides=8, u_range=(0.0, 1.0), v_range=(0.02, 0.78), rough=0.06, rng=rng)

    # Two snapped silver-birch limbs
    for t, ang in ((0.30, 0.9), (0.68, -1.1)):
        base = pts[0].lerp(pts[-1], t) + Vector((0, 0, 0.12))
        d = Vector((0.28, math.cos(ang), 0.55)).normalized()
        tube(bm, uv, [base, base + d * 0.42, base + d * 0.78], [0.085, 0.065, 0.045],
             sides=5, u_range=(0.0, 1.0), v_range=(0.05, 0.75), rough=0.04, rng=rng)

    # 6 zoned turkey-tail bracket fungus shelves along the log flanks
    for t, side_y, z_off in ((0.22, 0.24, 0.22), (0.26, 0.25, 0.27), (0.48, -0.22, 0.20),
                             (0.52, -0.23, 0.25), (0.74, 0.20, 0.18), (0.78, 0.21, 0.22)):
        pos = pts[0].lerp(pts[-1], t) + Vector((0, side_y, z_off - 0.12))
        mushroom_dome(bm, uv, pos, 0.11, 0.025, sides=5, u_range=(0.15, 0.85), v_range=(0.82, 0.98))
    return finish_mesh('forest-birch-log-01', bm, mat)


def build_forest_berry_bramble(mat):
    """Arching thorny woodland blackberry & rosehip bramble thicket."""
    rng = random.Random(212)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # 4 arching woody canes
    for k in range(4):
        yaw = k * 0.5 * math.pi + rng.uniform(-0.25, 0.25)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        pts = [
            out * 0.08 + Vector((0, 0, 0.02)),
            out * 0.45 + Vector((0, 0, 0.52)),
            out * 0.88 + Vector((0, 0, 0.22)),
        ]
        tube(bm, uv, pts, [0.028, 0.022, 0.014], sides=4, u_range=(0.47, 0.53), v_range=(0.05, 0.90))

    # 12 arching foliage-and-berry cards
    for k in range(12):
        yaw = k / 12 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        length = rng.uniform(0.68, 0.98)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = out * 0.08 + Vector((0, 0, 0.05))
        p1 = out * (length * 0.52) + Vector((0, 0, length * rng.uniform(0.48, 0.68)))
        p2 = out * (length * 0.96) + Vector((0, 0, length * rng.uniform(0.18, 0.36)))
        arched_card(bm, uv, p0, p1, p2, 0.22, 0.42, 0.28, side, u_range=(0.0, 1.0), v_range=(0.0, 1.0))
    return finish_mesh('forest-berry-bramble-01', bm, mat)


# ---------------------------------------------------------------------------
# 4. TROPICAL KIT
# ---------------------------------------------------------------------------

def build_tropical_bromeliad(mat):
    """Vibrant scarlet-and-emerald rainforest bromeliad epiphyte rosette."""
    rng = random.Random(213)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Outer emerald-to-crimson strap leaves (10 leaves)
    for k in range(10):
        yaw = k / 10 * 2 * math.pi + rng.uniform(-0.14, 0.14)
        length = rng.uniform(0.68, 0.88)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = out * 0.05 + Vector((0, 0, 0.04))
        p1 = out * (length * 0.50) + Vector((0, 0, length * 0.42))
        p2 = out * (length * 0.95) + Vector((0, 0, length * 0.16))
        arched_card(bm, uv, p0, p1, p2, 0.16, 0.26, 0.10, side, u_range=(0.0, 0.55), v_range=(0.02, 0.98))

    # Inner scarlet-and-gold bromeliad rosette & tall central inflorescence (10 bracts)
    for k in range(10):
        yaw = (k + 0.5) / 10 * 2 * math.pi + rng.uniform(-0.12, 0.12)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        if k < 6:
            p0 = out * 0.04 + Vector((0, 0, 0.10))
            p1 = out * 0.26 + Vector((0, 0, 0.44))
            p2 = out * 0.50 + Vector((0, 0, 0.36))
            arched_card(bm, uv, p0, p1, p2, 0.16, 0.26, 0.10, side, u_range=(0.55, 1.0), v_range=(0.02, 0.98))
        else:
            p0 = out * 0.02 + Vector((0, 0, 0.12))
            p1 = out * 0.12 + Vector((0, 0, 0.52))
            p2 = out * 0.20 + Vector((0, 0, 0.76))
            arched_card(bm, uv, p0, p1, p2, 0.14, 0.22, 0.10, side, u_range=(0.55, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('tropical-bromeliad-01', bm, mat)


def build_tropical_heliconia(mat):
    """Broad tropical ginger/banana paddle leaves with scarlet-and-gold lobster-claw Heliconia bracts."""
    rng = random.Random(214)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # 9 tall paddle leaves
    for k in range(9):
        yaw = k / 9 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        length = rng.uniform(0.95, 1.35)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = out * 0.06 + Vector((0, 0, 0.04))
        p1 = out * (length * 0.42) + Vector((0, 0, length * 0.68))
        p2 = out * (length * 0.88) + Vector((0, 0, length * 0.52))
        arched_card(bm, uv, p0, p1, p2, 0.14, 0.38, 0.22, side, u_range=(0.0, 0.54), v_range=(0.02, 0.98))

    # 4 crossed Heliconia lobster-claw flower stalks (8 cards)
    for k in range(4):
        yaw = k * 0.5 * math.pi + 0.35
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        b0 = out * 0.08 + Vector((0, 0, 0.12))
        b1 = out * 0.26 + Vector((0, 0, 0.72))
        b2 = out * 0.44 + Vector((0, 0, 1.18))
        for cross in (0.0, 0.45 * math.pi):
            side = Vector((math.cos(yaw + cross), math.sin(yaw + cross), 0))
            arched_card(bm, uv, b0, b1, b2, 0.18, 0.32, 0.26, side, u_range=(0.56, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('tropical-heliconia-01', bm, mat)


def build_tropical_monstera(mat):
    """Fenestrated Monstera deliciosa / split-leaf philodendron cluster."""
    rng = random.Random(215)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # 14 broad heart-shaped fenestrated leaves on petioles at 2 tiers
    for k in range(14):
        tier = 0 if k < 8 else 1
        yaw = (k / (8 if tier == 0 else 6)) * 2 * math.pi + rng.uniform(-0.22, 0.22)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        reach = rng.uniform(0.75, 1.05) if tier == 0 else rng.uniform(0.48, 0.72)
        h_mid = rng.uniform(0.42, 0.62) if tier == 0 else rng.uniform(0.65, 0.88)
        p0 = out * 0.08 + Vector((0, 0, 0.06 + tier * 0.14))
        p1 = out * (reach * 0.52) + Vector((0, 0, h_mid))
        p2 = out * reach + Vector((0, 0, h_mid - 0.12))
        w = rng.uniform(0.46, 0.64)
        arched_card(bm, uv, p0, p1, p2, w * 0.35, w, w * 0.65, side, u_range=(0.0, 1.0), v_range=(0.0, 1.0))
    return finish_mesh('tropical-monstera-01', bm, mat)


# ---------------------------------------------------------------------------
# 5. BOREAL TAIGA & ARCTIC TUNDRA KIT
# ---------------------------------------------------------------------------

def build_taiga_berry_moss(mat):
    """Boreal cushion of pale reindeer lichen (Cladonia) and feather moss topped with crimson lingonberries."""
    rng = random.Random(216)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Two soft reindeer-lichen & moss hummock cushions
    rock_chunk(bm, uv, Vector((-0.12, 0.04, 0.11)), (0.48, 0.42, 0.18), u_range=(0.02, 0.50), v_range=(0.05, 0.95), subdivisions=2, rng=rng, dome=True)
    rock_chunk(bm, uv, Vector((0.24, -0.14, 0.08)), (0.34, 0.30, 0.14), u_range=(0.02, 0.50), v_range=(0.05, 0.95), subdivisions=1, rng=rng, dome=True)

    # 10 crimson-berried lingonberry/bilberry sprigs emerging across the hummock
    for k in range(10):
        yaw = k / 10 * 2 * math.pi + rng.uniform(-0.25, 0.25)
        r = rng.uniform(0.06, 0.34)
        base = Vector((math.cos(yaw) * r, math.sin(yaw) * r, 0.14))
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p1 = base + out * 0.16 + Vector((0, 0, 0.22))
        p2 = base + out * 0.32 + Vector((0, 0, 0.36))
        arched_card(bm, uv, base, p1, p2, 0.18, 0.30, 0.22, side, u_range=(0.52, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('taiga-berry-moss-01', bm, mat)


def build_taiga_deadfall(mat):
    """Frost-shattered lichen granite boulder & fallen boreal spruce branch."""
    rng = random.Random(217)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    rock_chunk(bm, uv, Vector((-0.24, 0.10, 0.20)), (0.50, 0.38, 0.28), u_range=(0.02, 0.50), v_range=(0.04, 0.96), subdivisions=2, rng=rng)
    rock_chunk(bm, uv, Vector((0.26, -0.20, 0.13)), (0.32, 0.26, 0.18), u_range=(0.02, 0.50), v_range=(0.04, 0.96), subdivisions=1, rng=rng)

    # Fallen frosted spruce limb resting across the boulder
    limb = [
        Vector((-0.72, -0.18, 0.06)),
        Vector((-0.18, -0.02, 0.34)),
        Vector((0.32, 0.14, 0.24)),
        Vector((0.78, 0.26, 0.08)),
    ]
    tube(bm, uv, limb, [0.12, 0.10, 0.08, 0.05], sides=6, u_range=(0.54, 0.98), v_range=(0.04, 0.94), rough=0.08, rng=rng)
    for t, ang in ((0.35, 1.1), (0.68, -0.9)):
        b0 = limb[0].lerp(limb[-1], t) + Vector((0, 0, 0.08))
        d = Vector((0.25, math.cos(ang), 0.55)).normalized()
        tube(bm, uv, [b0, b0 + d * 0.36, b0 + d * 0.65], [0.05, 0.035, 0.018],
             sides=4, u_range=(0.54, 0.98), v_range=(0.10, 0.90), rough=0.06, rng=rng)
    return finish_mesh('taiga-deadfall-01', bm, mat)


def build_tundra_cushion(mat):
    """Arctic tundra purple saxifrage cushion on frost-shattered slate with golden arctic poppies."""
    rng = random.Random(218)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Purple saxifrage cushion dome + frost-shattered alpine slate
    rock_chunk(bm, uv, Vector((0.0, 0.02, 0.11)), (0.48, 0.42, 0.18), u_range=(0.02, 0.53), v_range=(0.38, 0.98), subdivisions=2, rng=rng, dome=True)
    rock_chunk(bm, uv, Vector((-0.34, -0.18, 0.07)), (0.32, 0.24, 0.11), u_range=(0.02, 0.53), v_range=(0.02, 0.33), subdivisions=1, rng=rng)

    # 8 golden arctic poppy stems rising from the cushion
    for k in range(8):
        yaw = k / 8 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        r = rng.uniform(0.08, 0.28)
        base = Vector((math.cos(yaw) * r, math.sin(yaw) * r, 0.16))
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        h = rng.uniform(0.32, 0.48)
        p1 = base + out * 0.10 + Vector((0, 0, h * 0.55))
        p2 = base + out * 0.18 + Vector((0, 0, h))
        arched_card(bm, uv, base, p1, p2, 0.14, 0.24, 0.22, side, u_range=(0.55, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('tundra-cushion-01', bm, mat)


def build_tundra_dwarf_willow(mat):
    """Windswept prostrate arctic dwarf willow & crimson alpine bearberry mat with 3D cushion core."""
    rng = random.Random(219)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Grounded 3D faceted cushion core
    rock_chunk(bm, uv, Vector((0.06, 0.0, 0.10)), (0.46, 0.40, 0.16), u_range=(0.24, 0.76), v_range=(0.24, 0.76), subdivisions=1, rng=rng, dome=True)

    # 3 creeping woody krummholz stems hugging the ground
    for k in range(3):
        yaw = k * 2 * math.pi / 3 + 0.3
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        pts = [
            Vector((0, 0, 0.02)),
            out * 0.35 + Vector((0, 0, 0.10)),
            out * 0.72 + Vector((0, 0, 0.06)),
        ]
        tube(bm, uv, pts, [0.045, 0.032, 0.018], sides=4, u_range=(0.46, 0.54), v_range=(0.05, 0.85))

    # 11 low windswept foliage cards (biased slightly along +X wind direction)
    for k in range(11):
        yaw = k / 11 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        out = Vector((math.cos(yaw) + 0.25, math.sin(yaw), 0)).normalized()
        side = Vector((-out.y, out.x, 0))
        reach = rng.uniform(0.55, 0.85)
        h = rng.uniform(0.16, 0.30)
        p0 = out * 0.18 + Vector((0, 0, 0.01))
        p1 = out * (reach * 0.58) + Vector((0, 0, h))
        p2 = out * reach + Vector((0, 0, h * 0.45))
        w = rng.uniform(0.36, 0.48)
        arched_card(bm, uv, p0, p1, p2, w * 0.75, w, w * 0.68, side, u_range=(0.0, 1.0), v_range=(0.0, 1.0))
    return finish_mesh('tundra-dwarf-willow-01', bm, mat)


# ---------------------------------------------------------------------------
# 6. SWAMP / WETLAND KIT
# ---------------------------------------------------------------------------

def build_swamp_pitcher(mat):
    """Carnivorous Sarracenia pitcher plant trumpets with ruffled hoods and basal ruby sundews."""
    rng = random.Random(220)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # 7 tall flaring 3D pitcher trumpets curving outward from the crown
    for k in range(7):
        yaw = k / 7 * 2 * math.pi + rng.uniform(-0.18, 0.18)
        reach = 0.14 if k == 0 else rng.uniform(0.28, 0.44)
        h = 0.88 if k == 0 else rng.uniform(0.58, 0.84)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        p0 = out * 0.05 + Vector((0, 0, 0.02))
        p1 = out * (reach * 0.48) + Vector((0, 0, h * 0.50))
        p2 = out * (reach * 0.96) + Vector((0, 0, h * 0.86))
        p3 = out * (reach * 0.78) + Vector((0, 0, h))
        tube(bm, uv, [p0, p1, p2, p3], [0.024, 0.052, 0.088, 0.042],
             sides=6, u_range=(0.02, 0.52), v_range=(0.04, 0.96), cap_end=True, rng=rng)

    # 8 basal ruby sundew (Drosera) spoon-leaf cards
    for k in range(8):
        yaw = (k + 0.5) / 8 * 2 * math.pi
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = out * 0.06 + Vector((0, 0, 0.02))
        p1 = out * 0.28 + Vector((0, 0, 0.14))
        p2 = out * 0.50 + Vector((0, 0, 0.08))
        arched_card(bm, uv, p0, p1, p2, 0.10, 0.22, 0.16, side, u_range=(0.55, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('swamp-pitcher-01', bm, mat)


def build_swamp_marigold(mat):
    """Glossy marsh marigold & skunk cabbage leaves with butter-gold bog blossoms."""
    rng = random.Random(221)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # 10 broad kidney-shaped marsh leaves
    for k in range(10):
        yaw = k / 10 * 2 * math.pi + rng.uniform(-0.18, 0.18)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        reach = rng.uniform(0.48, 0.72)
        p0 = out * 0.06 + Vector((0, 0, 0.03))
        p1 = out * (reach * 0.55) + Vector((0, 0, rng.uniform(0.24, 0.38)))
        p2 = out * reach + Vector((0, 0, rng.uniform(0.14, 0.26)))
        arched_card(bm, uv, p0, p1, p2, 0.18, 0.38, 0.30, side, u_range=(0.0, 0.54), v_range=(0.02, 0.98))

    # 7 butter-gold marsh marigold flower cards rising above the foliage
    for k in range(7):
        yaw = (k + 0.3) / 7 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        r = rng.uniform(0.08, 0.32)
        h = rng.uniform(0.44, 0.66)
        p0 = out * (r * 0.5) + Vector((0, 0, 0.04))
        p1 = out * (r * 0.85) + Vector((0, 0, h * 0.65))
        p2 = out * r + Vector((0, 0, h))
        arched_card(bm, uv, p0, p1, p2, 0.16, 0.28, 0.26, side, u_range=(0.55, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('swamp-marigold-01', bm, mat)


# ---------------------------------------------------------------------------
# SCENE SETUP, EXPORT & PREVIEW GALLERY
# ---------------------------------------------------------------------------

def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 480, 360
    world = bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.36, 0.42, 0.46, 1.0)

    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.4
    sun.rotation_euler = (0.72, 0.22, 0.62)
    scene.collection.objects.link(sun)

    fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'SUN'))
    fill.data.energy = 1.1
    fill.rotation_euler = (0.95, -0.45, -2.1)
    scene.collection.objects.link(fill)

    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    scene.collection.objects.link(cam)
    scene.camera = cam

    ground = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=12)
    bm.to_mesh(ground)
    bm.free()
    g = bpy.data.objects.new('Ground', ground)
    gm = bpy.data.materials.new('ground_mat')
    gm.use_nodes = True
    bsdf = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (0.09, 0.085, 0.075, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.92
    ground.materials.append(gm)
    scene.collection.objects.link(g)


def render_preview(root, path, distance, look_z=0.35):
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = not (o == root or o.parent == root or o.type in {'CAMERA', 'LIGHT'} or o.name == 'Ground')
    cam = scene.camera
    cam.location = Vector((distance, -distance, distance * 0.62))
    cam.rotation_euler = (Vector((0, 0, look_z)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def save_contact_sheet(preview_paths, out_path, cols=5):
    """Assemble rendered previews into a single contact sheet PNG."""
    imgs = []
    for p in preview_paths:
        if os.path.exists(p):
            img = bpy.data.images.load(p)
            w, h = img.size
            arr = np.array(img.pixels[:], dtype=np.float32).reshape((h, w, 4))
            imgs.append(np.flipud(arr))
            bpy.data.images.remove(img)
    if not imgs:
        return
    h, w, _ = imgs[0].shape
    rows = math.ceil(len(imgs) / cols)
    sheet = np.zeros((rows * h, cols * w, 4), dtype=np.float32)
    sheet[:, :, 3] = 1.0
    for idx, arr in enumerate(imgs):
        r, c = divmod(idx, cols)
        sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] = arr
    save_image('understory_contact_sheet', sheet, out_path)


def main():
    for d in (OUT_BASE, OUT_BUSHES, PREVIEW_DIR, TEX_DIR):
        os.makedirs(d, exist_ok=True)
    setup_scene()
    only_extra = '--only-extra' in argv
    mats = {}
    if not only_extra:
        mats.update(build_all_materials(TEX_DIR))
    mats.update(build_extra_materials(TEX_DIR))

    base_specs = [
        # (out_dir, subdir, builder_fn, mat_key, cam_dist, look_z)
        (OUT_BASE, 'arid', build_desert_prickly_pear, 'cactus', 2.2, 0.45),
        (OUT_BASE, 'arid', build_desert_agave, 'agave', 2.3, 0.45),
        (OUT_BASE, 'arid', build_desert_sagebrush, 'sagebrush', 2.0, 0.35),
        (OUT_BASE, 'arid', build_badlands_deadwood, 'badlands_deadwood', 2.3, 0.35),

        (OUT_BASE, 'meadow', build_savanna_aloe, 'savanna_aloe', 2.2, 0.45),
        (OUT_BASE, 'meadow', build_meadow_lupine, 'meadow_lupine', 2.1, 0.45),
        (OUT_BASE, 'meadow', build_meadow_heather, 'meadow_heather', 1.9, 0.30),
        (OUT_BASE, 'meadow', build_meadow_thistle_stone, 'thistle_stone', 2.0, 0.35),

        (OUT_BASE, 'forest', build_forest_bracken, 'forest_bracken', 2.2, 0.32),
        (OUT_BASE, 'forest', build_forest_mushrooms, 'forest_mushrooms', 1.8, 0.22),
        (OUT_BASE, 'forest', build_forest_birch_log, 'birch_log', 4.2, 0.25),
        (OUT_BASE, 'forest', build_forest_berry_bramble, 'berry_bramble', 2.1, 0.32),

        (OUT_BASE, 'tropical', build_tropical_bromeliad, 'tropical_bromeliad', 1.9, 0.28),
        (OUT_BASE, 'tropical', build_tropical_heliconia, 'tropical_heliconia', 2.4, 0.50),
        (OUT_BASE, 'tropical', build_tropical_monstera, 'tropical_monstera', 2.2, 0.35),

        (OUT_BASE, 'boreal', build_taiga_berry_moss, 'taiga_berry_moss', 1.7, 0.20),
        (OUT_BASE, 'boreal', build_taiga_deadfall, 'taiga_deadfall', 2.2, 0.25),
        (OUT_BASE, 'boreal', build_tundra_cushion, 'tundra_cushion', 1.7, 0.20),
        (OUT_BASE, 'boreal', build_tundra_dwarf_willow, 'tundra_willow', 1.9, 0.18),

        (OUT_BASE, 'swamp', build_swamp_pitcher, 'swamp_pitcher', 1.9, 0.35),
        (OUT_BASE, 'swamp', build_swamp_marigold, 'swamp_marigold', 1.9, 0.26),
    ]

    extra_specs = [
        # Coastal & Shoreline Kit (Biome 0, 12)
        (OUT_BASE, 'coastal', build_coastal_dune_oats, 'coastal_oats', 2.1, 0.38),
        (OUT_BASE, 'coastal', build_coastal_tidepool_coral, 'coastal_tidepool', 1.9, 0.22),
        (OUT_BASE, 'coastal', build_coastal_shipwreck_ribs, 'coastal_shipwreck', 2.4, 0.35),

        # Glacier, High Alpine & Cold Steppe Kit (Biomes 11, 2, 10)
        (OUT_BASE, 'alpine', build_glacier_ice_spires, 'glacier_ice', 2.3, 0.48),
        (OUT_BASE, 'alpine', build_glacier_moraine_cairn, 'glacier_moraine', 2.0, 0.32),
        (OUT_BASE, 'alpine', build_steppe_feathergrass, 'steppe_feathergrass', 2.1, 0.35),
        (OUT_BASE, 'alpine', build_alpine_edelweiss_stone, 'alpine_edelweiss', 1.8, 0.24),

        # Savanna & Farmland Kit (Biomes 3, 5, 4, 14)
        (OUT_BASE, 'savanna', build_savanna_termite_mound, 'savanna_termite', 2.5, 0.55),
        (OUT_BASE, 'savanna', build_savanna_desert_rose, 'savanna_desert_rose', 2.1, 0.42),
        (OUT_BASE, 'savanna', build_savanna_sunbleached_ribcage, 'savanna_ribcage', 2.2, 0.28),
        (OUT_BASE, 'savanna', build_farmland_poppy_wheat, 'farmland_poppy', 2.0, 0.42),

        # Biome Micro-Structures, Shrines & Ruins Kit (`ground/structures/`)
        (OUT_BASE, 'structures', build_structure_waystone_shrine, 'structure_waystone', 2.6, 0.65),
        (OUT_BASE, 'structures', build_structure_ruined_column, 'structure_column', 2.2, 0.30),
        (OUT_BASE, 'structures', build_structure_roadside_milestone, 'structure_milestone', 2.4, 0.55),
        (OUT_BASE, 'structures', build_structure_dwarven_cairn, 'structure_dwarven', 2.4, 0.55),
        (OUT_BASE, 'structures', build_structure_bog_fetish_totem, 'structure_bog_totem', 2.5, 0.60),
        (OUT_BASE, 'structures', build_structure_rainforest_idol, 'structure_idol', 2.4, 0.55),

        # Authored Biome Shrubs (`bushes/`)
        (OUT_BUSHES, '', build_bush_arid_ocotillo, 'bush_ocotillo', 2.8, 0.65),
        (OUT_BUSHES, '', build_bush_savanna_thorn, 'bush_savanna', 2.8, 0.65),
        (OUT_BUSHES, '', build_bush_meadow_gorse, 'bush_gorse', 2.6, 0.58),
        (OUT_BUSHES, '', build_bush_boreal_juniper, 'bush_juniper', 2.5, 0.50),
        (OUT_BUSHES, '', build_bush_tropical_hibiscus, 'bush_hibiscus', 2.9, 0.68),
        (OUT_BUSHES, '', build_bush_swamp_buttonbush, 'bush_buttonbush', 2.6, 0.58),
    ]

    specs = extra_specs if only_extra else (base_specs + extra_specs)
    preview_paths = []
    extra_preview_paths = []
    extra_set = {s[2] for s in extra_specs}
    for out_root, subdir, build_fn, mat_key, dist, look_z in specs:
        mesh, tris = build_fn(mats[mat_key])
        name = mesh.name
        assert tris <= MAX_TRIANGLES, f'{name} has {tris} triangles > {MAX_TRIANGLES}'
        glb_path = os.path.join(out_root, subdir, f'{name}.glb') if subdir else os.path.join(out_root, f'{name}.glb')
        root = place_and_export(name, mesh, glb_path)
        tag = subdir if subdir else 'bushes'
        print(f'[{tag}] {name}: {tris} tris -> {glb_path}')
        if RENDER:
            png_path = os.path.join(PREVIEW_DIR, f'{name}.png')
            render_preview(root, png_path, dist, look_z)
            preview_paths.append(png_path)
            if build_fn in extra_set:
                extra_preview_paths.append(png_path)

    if RENDER and extra_preview_paths:
        extra_sheet = os.path.join(PREVIEW_DIR, 'biome-structures-and-bushes-contact-sheet.png')
        save_contact_sheet(extra_preview_paths, extra_sheet, cols=5)
        print(f'Saved extra contact sheet -> {extra_sheet}')
    if RENDER and not only_extra and preview_paths:
        sheet_path = os.path.join(PREVIEW_DIR, 'biome-understory-contact-sheet.png')
        save_contact_sheet(preview_paths, sheet_path, cols=6)
        print(f'Saved full contact sheet -> {sheet_path}')


if __name__ == '__main__':
    main()
