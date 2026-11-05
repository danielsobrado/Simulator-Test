"""3D BMesh builders for coastal, glacier/alpine, savanna, biome micro-structures,
and authored biome shrubs (`bushVariants`).
"""
import math
import random
import bmesh
from mathutils import Vector
from understory_common import arched_card, finish_mesh, mushroom_dome, rock_chunk, tube


# ---------------------------------------------------------------------------
# 1. COASTAL & SHORELINE KIT (Biome 0, 12)
# ---------------------------------------------------------------------------

def build_coastal_dune_oats(mat):
    """Wind-bent golden sea-oats & marram dune grass on a sand hummock with bleached driftwood."""
    rng = random.Random(301)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Half-buried sun-bleached driftwood log
    drift_pts = [Vector((-0.48, -0.14, 0.04)), Vector((0.02, 0.02, 0.14)), Vector((0.52, 0.16, 0.06))]
    tube(bm, uv, drift_pts, [0.11, 0.13, 0.08], sides=5, u_range=(0.04, 0.42), v_range=(0.05, 0.92), rough=0.07, rng=rng)

    # 12 wind-bent sea-oats & marram grass cards (arching gracefully along +X sea breeze)
    for k in range(12):
        yaw = k / 12 * 2 * math.pi + rng.uniform(-0.18, 0.18)
        r = rng.uniform(0.06, 0.34)
        base = Vector((math.cos(yaw) * r, math.sin(yaw) * r, 0.02))
        out = Vector((math.cos(yaw) * 0.65 + 0.48, math.sin(yaw) * 0.65, 0)).normalized()
        side = Vector((-out.y, out.x, 0))
        h = rng.uniform(0.68, 1.08)
        reach = rng.uniform(0.45, 0.78)
        p1 = base + out * (reach * 0.45) + Vector((0, 0, h * 0.68))
        p2 = base + out * reach + Vector((0, 0, h * 0.88))
        arched_card(bm, uv, base, p1, p2, 0.18, 0.34, 0.28, side, u_range=(0.45, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('coastal-dune-oats-01', bm, mat)


def build_coastal_tidepool_coral(mat):
    """Barnacle-encrusted coastal basalt tidepool rock with sea anemones, starfish, and fan coral."""
    rng = random.Random(302)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Two wet basalt tidepool rocks
    rock_chunk(bm, uv, Vector((-0.18, 0.08, 0.18)), (0.48, 0.40, 0.25), u_range=(0.02, 0.50), v_range=(0.04, 0.94), subdivisions=2, rng=rng)
    rock_chunk(bm, uv, Vector((0.28, -0.14, 0.12)), (0.36, 0.30, 0.18), u_range=(0.02, 0.50), v_range=(0.04, 0.94), subdivisions=1, rng=rng)

    # 4 crimson sea-anemone crowns in the tidepool hollow & rock ledges
    for pos, rad, h in (
        (Vector((0.04, -0.02, 0.26)), 0.14, 0.06),
        (Vector((-0.12, 0.18, 0.34)), 0.11, 0.05),
        (Vector((0.22, -0.08, 0.24)), 0.12, 0.05),
        (Vector((-0.32, -0.12, 0.20)), 0.10, 0.045),
    ):
        mushroom_dome(bm, uv, pos, rad, h, sides=6, u_range=(0.54, 0.98), v_range=(0.52, 0.98))

    # 3 orange starfish / coral fans clinging to the rock flanks
    for pos, tilt in (
        (Vector((-0.06, -0.26, 0.18)), Vector((0.1, -0.6, 0.8))),
        (Vector((0.36, 0.08, 0.16)), Vector((0.6, 0.2, 0.8))),
        (Vector((-0.38, 0.16, 0.22)), Vector((-0.5, 0.3, 0.8))),
    ):
        mushroom_dome(bm, uv, pos, 0.13, 0.025, sides=5, u_range=(0.54, 0.98), v_range=(0.02, 0.48), tilt=tilt)
    return finish_mesh('coastal-tidepool-coral-01', bm, mat)


def build_coastal_shipwreck_ribs(mat):
    """Weathered shipwreck keel timber and curved hull ribs half-buried in coastal sand."""
    rng = random.Random(303)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Sand & kelp wrack mound base
    rock_chunk(bm, uv, Vector((0.0, 0.0, 0.08)), (0.68, 0.48, 0.14), u_range=(0.56, 0.98), v_range=(0.04, 0.96), subdivisions=1, rng=rng, dome=True)

    # Heavy weathered keel beam along X
    keel = [Vector((-0.82, -0.04, 0.06)), Vector((0.0, 0.0, 0.14)), Vector((0.84, 0.05, 0.10))]
    tube(bm, uv, keel, [0.11, 0.13, 0.10], sides=5, u_range=(0.04, 0.52), v_range=(0.04, 0.94), rough=0.05, rng=rng)

    # 5 curved oak hull ribs rising from the keel on alternating sides
    for x_off, side_y, h_top in ((-0.52, 1, 0.72), (-0.24, -1, 0.84), (0.04, 1, 0.92), (0.32, -1, 0.78), (0.58, 1, 0.62)):
        p0 = Vector((x_off, side_y * 0.06, 0.10))
        p1 = Vector((x_off + 0.04, side_y * 0.42, h_top * 0.52))
        p2 = Vector((x_off + 0.08, side_y * 0.34, h_top))
        tube(bm, uv, [p0, p1, p2], [0.075, 0.062, 0.042], sides=4, u_range=(0.04, 0.52), v_range=(0.08, 0.92), rough=0.04, rng=rng)
    return finish_mesh('coastal-shipwreck-ribs-01', bm, mat)


# ---------------------------------------------------------------------------
# 2. GLACIER, ALPINE & COLD STEPPE KIT (Biomes 11, 2, 10)
# ---------------------------------------------------------------------------

def build_glacier_ice_spires(mat):
    """Translucent azure-and-white fractured glacial serac spires rising from a snowdrift."""
    rng = random.Random(304)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Sastrugi snow-drift base
    rock_chunk(bm, uv, Vector((0.0, 0.0, 0.10)), (0.58, 0.46, 0.16), u_range=(0.02, 0.42), v_range=(0.55, 0.98), subdivisions=1, rng=rng, dome=True)

    # 6 tilted hexagonal/faceted glacial ice spires
    spires = [
        (Vector((0.0, 0.0, 0.04)), Vector((0.12, 0.06, 1.32)), 0.24),
        (Vector((-0.24, 0.12, 0.04)), Vector((-0.42, 0.22, 1.02)), 0.19),
        (Vector((0.26, -0.10, 0.04)), Vector((0.46, -0.18, 0.94)), 0.18),
        (Vector((-0.14, -0.22, 0.04)), Vector((-0.26, -0.38, 0.78)), 0.16),
        (Vector((0.16, 0.24, 0.04)), Vector((0.28, 0.40, 0.72)), 0.15),
        (Vector((0.36, 0.10, 0.02)), Vector((0.56, 0.18, 0.54)), 0.13),
    ]
    for p0, p2, w in spires:
        p1 = p0.lerp(p2, 0.55)
        tube(bm, uv, [p0, p1, p2], [w, w * 0.74, 0.02], sides=5, u_range=(0.45, 0.98), v_range=(0.04, 0.96), cap_end=True)
    return finish_mesh('glacier-ice-spires-01', bm, mat)


def build_glacier_moraine_cairn(mat):
    """Frost-shattered dark moraine slate slabs with wind-packed snow caps and cairn stones."""
    rng = random.Random(305)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    slabs = [
        (Vector((-0.16, 0.04, 0.22)), (0.52, 0.38, 0.28), 2),
        (Vector((0.28, -0.14, 0.16)), (0.38, 0.30, 0.22), 1),
        (Vector((-0.08, 0.06, 0.50)), (0.28, 0.22, 0.16), 1),
        (Vector((-0.06, 0.06, 0.68)), (0.16, 0.14, 0.12), 1),
    ]
    for center, radii, subdiv in slabs:
        rock_chunk(bm, uv, center, radii, u_range=(0.02, 0.98), v_range=(0.04, 0.96), subdivisions=subdiv, rng=rng)
    return finish_mesh('glacier-moraine-cairn-01', bm, mat)


def build_steppe_feathergrass(mat):
    """Silvery-gold Eurasian/cold-steppe feathergrass (Stipa) plumes & wormwood tussock."""
    rng = random.Random(306)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # 15 graceful arching feathergrass plume cards fanning outward
    for k in range(15):
        tier = 0 if k < 9 else 1
        yaw = (k / (9 if tier == 0 else 6)) * 2 * math.pi + rng.uniform(-0.2, 0.2)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        reach = rng.uniform(0.65, 0.96) if tier == 0 else rng.uniform(0.38, 0.58)
        h_mid = rng.uniform(0.45, 0.64) if tier == 0 else rng.uniform(0.68, 0.88)
        p0 = out * 0.05 + Vector((0, 0, 0.02))
        p1 = out * (reach * 0.48) + Vector((0, 0, h_mid))
        p2 = out * reach + Vector((0, 0, h_mid * 0.72))
        w = rng.uniform(0.32, 0.46)
        arched_card(bm, uv, p0, p1, p2, w * 0.35, w, w * 0.85, side, u_range=(0.0, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('steppe-feathergrass-01', bm, mat)


def build_alpine_edelweiss_stone(mat):
    """High-alpine frost-cracked limestone outcrop with woolly white Edelweiss & blue gentians."""
    rng = random.Random(307)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    rock_chunk(bm, uv, Vector((-0.14, 0.06, 0.16)), (0.46, 0.36, 0.22), u_range=(0.02, 0.46), v_range=(0.04, 0.96), subdivisions=2, rng=rng)
    rock_chunk(bm, uv, Vector((0.24, -0.14, 0.10)), (0.30, 0.24, 0.14), u_range=(0.02, 0.46), v_range=(0.04, 0.96), subdivisions=1, rng=rng)

    # 9 Edelweiss & blue gentian flower cards nestled in the rock crevices
    for k in range(9):
        yaw = k / 9 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        r = rng.uniform(0.10, 0.34)
        base = Vector((math.cos(yaw) * r, math.sin(yaw) * r, 0.12))
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        h = rng.uniform(0.32, 0.50)
        p1 = base + out * 0.10 + Vector((0, 0, h * 0.58))
        p2 = base + out * 0.20 + Vector((0, 0, h))
        arched_card(bm, uv, base, p1, p2, 0.18, 0.28, 0.26, side, u_range=(0.50, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('alpine-edelweiss-stone-01', bm, mat)


# ---------------------------------------------------------------------------
# 3. SAVANNA & FARMLAND KIT (Biomes 3, 5, 4, 14)
# ---------------------------------------------------------------------------

def build_savanna_termite_mound(mat):
    """Sculpted red-ochre cathedral termite mound with chimney buttresses and dry savanna grass."""
    rng = random.Random(308)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Central cathedral spire + 4 buttress chimneys
    spires = [
        (Vector((0.0, 0.0, -0.05)), Vector((0.04, 0.02, 1.48)), (0.42, 0.30, 0.12), 7),
        (Vector((0.24, 0.10, -0.04)), Vector((0.28, 0.14, 0.96)), (0.22, 0.16, 0.07), 5),
        (Vector((-0.22, 0.14, -0.04)), Vector((-0.26, 0.18, 0.84)), (0.20, 0.15, 0.06), 5),
        (Vector((0.08, -0.24, -0.04)), Vector((0.12, -0.28, 0.76)), (0.19, 0.14, 0.06), 5),
        (Vector((-0.18, -0.18, -0.04)), Vector((-0.22, -0.22, 0.64)), (0.18, 0.13, 0.05), 5),
    ]
    for p0, p2, radii, sides in spires:
        p1 = p0.lerp(p2, 0.52)
        tube(bm, uv, [p0, p1, p2], radii, sides=sides, u_range=(0.02, 0.56), v_range=(0.04, 0.95), rough=0.10, rng=rng)

    # 8 golden elephant-grass tuft cards around the mound foot
    for k in range(8):
        yaw = k / 8 * 2 * math.pi + 0.2
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = out * 0.34 + Vector((0, 0, 0.02))
        p1 = out * 0.56 + Vector((0, 0, 0.38))
        p2 = out * 0.78 + Vector((0, 0, 0.58))
        arched_card(bm, uv, p0, p1, p2, 0.22, 0.34, 0.24, side, u_range=(0.60, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('savanna-termite-mound-01', bm, mat)


def build_savanna_desert_rose(mat):
    """Swollen bottle-shaped Adenium obesum (Desert Rose) caudex with crimson-pink blossoms."""
    rng = random.Random(309)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Swollen bottle caudex + 3 thick succulent limbs
    caudex = [Vector((0, 0, -0.04)), Vector((0.02, 0.01, 0.26)), Vector((0.0, -0.01, 0.54))]
    tube(bm, uv, caudex, [0.24, 0.28, 0.14], sides=7, u_range=(0.02, 0.44), v_range=(0.04, 0.92), rough=0.08, rng=rng)
    for yaw, h_end in ((0.4, 0.86), (2.5, 0.80), (4.6, 0.76)):
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        b0 = Vector((0, 0, 0.44)) + out * 0.08
        b1 = b0 + out * 0.24 + Vector((0, 0, (h_end - 0.44) * 0.55))
        b2 = b0 + out * 0.44 + Vector((0, 0, h_end - 0.44))
        tube(bm, uv, [b0, b1, b2], [0.09, 0.065, 0.035], sides=5, u_range=(0.04, 0.44), v_range=(0.10, 0.90), rough=0.06, rng=rng)

    # 9 blossom-and-leaf crown cards atop the branches
    for k in range(9):
        yaw = k / 9 * 2 * math.pi + rng.uniform(-0.18, 0.18)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = out * 0.18 + Vector((0, 0, 0.52))
        p1 = out * 0.44 + Vector((0, 0, 0.84))
        p2 = out * 0.68 + Vector((0, 0, 0.96))
        arched_card(bm, uv, p0, p1, p2, 0.22, 0.38, 0.30, side, u_range=(0.48, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('savanna-desert-rose-01', bm, mat)


def build_savanna_sunbleached_ribcage(mat):
    """Sun-bleached savanna beast ribcage, spine, and horned skull on dusty earth."""
    rng = random.Random(310)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Dusty earth & stone mound under the skeleton
    rock_chunk(bm, uv, Vector((0.0, 0.0, 0.06)), (0.64, 0.44, 0.12), u_range=(0.56, 0.98), v_range=(0.05, 0.95), subdivisions=1, rng=rng, dome=True)

    # Vertebral spine column along X
    spine = [Vector((-0.62, 0.0, 0.14)), Vector((-0.10, 0.02, 0.24)), Vector((0.42, 0.0, 0.18))]
    tube(bm, uv, spine, [0.055, 0.070, 0.060], sides=5, u_range=(0.04, 0.50), v_range=(0.05, 0.72), rough=0.06, rng=rng)

    # 4 pairs of curved ivory ribs arching over the sand
    for x_pos, rib_w, rib_h in ((-0.46, 0.34, 0.44), (-0.22, 0.44, 0.54), (0.02, 0.46, 0.56), (0.26, 0.38, 0.46)):
        for side_y in (-1, 1):
            r0 = Vector((x_pos, side_y * 0.04, 0.20))
            r1 = Vector((x_pos + 0.03, side_y * rib_w, rib_h))
            r2 = Vector((x_pos + 0.06, side_y * (rib_w * 0.78), 0.06))
            tube(bm, uv, [r0, r1, r2], [0.036, 0.032, 0.020], sides=4, u_range=(0.04, 0.50), v_range=(0.10, 0.75))

    # Horned skull at +X end with two sweeping dark-tipped horns
    skull_pts = [Vector((0.44, 0.0, 0.20)), Vector((0.64, 0.0, 0.24)), Vector((0.86, 0.0, 0.10))]
    tube(bm, uv, skull_pts, [0.11, 0.14, 0.055], sides=5, u_range=(0.04, 0.50), v_range=(0.15, 0.75), scale_y=0.68)
    for side_y in (-1, 1):
        h0 = Vector((0.56, side_y * 0.10, 0.24))
        h1 = Vector((0.50, side_y * 0.38, 0.42))
        h2 = Vector((0.64, side_y * 0.52, 0.62))
        tube(bm, uv, [h0, h1, h2], [0.052, 0.036, 0.014], sides=4, u_range=(0.04, 0.50), v_range=(0.55, 0.98))
    return finish_mesh('savanna-sunbleached-ribcage-01', bm, mat)


def build_farmland_poppy_wheat(mat):
    """Golden wheat-ear verge clump with scarlet corn-poppies and blue cornflowers."""
    rng = random.Random(311)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # 9 tall golden wheat-ear cards + 7 scarlet poppy & cornflower cards
    for k in range(16):
        is_wheat = k < 9
        yaw = k / 16 * 2 * math.pi + rng.uniform(-0.2, 0.2)
        r = rng.uniform(0.05, 0.28)
        base = Vector((math.cos(yaw) * r, math.sin(yaw) * r, 0.02))
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        h = rng.uniform(0.78, 1.08) if is_wheat else rng.uniform(0.56, 0.82)
        reach = rng.uniform(0.28, 0.46) if is_wheat else rng.uniform(0.36, 0.58)
        p1 = base + out * (reach * 0.48) + Vector((0, 0, h * 0.58))
        p2 = base + out * reach + Vector((0, 0, h))
        u_rng = (0.0, 0.52) if is_wheat else (0.52, 1.0)
        w = 0.28 if is_wheat else 0.34
        arched_card(bm, uv, base, p1, p2, w * 0.5, w, w * 0.75, side, u_range=u_rng, v_range=(0.02, 0.98))
    return finish_mesh('farmland-poppy-wheat-01', bm, mat)


# ---------------------------------------------------------------------------
# 4. BIOME MICRO-STRUCTURES, SHRINES & RUINS KIT (`ground/structures/`)
# ---------------------------------------------------------------------------

def build_structure_waystone_shrine(mat):
    """Moss-draped carved runic waystone obelisk on a stepped stone plinth."""
    rng = random.Random(312)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Stepped octagonal/square plinth + tapered carved runic obelisk
    plinth = [Vector((0, 0, -0.04)), Vector((0, 0, 0.18)), Vector((0, 0, 0.34))]
    tube(bm, uv, plinth, [0.54, 0.48, 0.36], sides=4, u_range=(0.0, 1.0), v_range=(0.02, 0.28), cap_end=False)
    obelisk = [Vector((0, 0, 0.30)), Vector((0.02, 0.01, 0.95)), Vector((0.03, 0.01, 1.52)), Vector((0.03, 0.01, 1.74))]
    tube(bm, uv, obelisk, [0.28, 0.23, 0.18, 0.02], sides=4, u_range=(0.0, 1.0), v_range=(0.25, 0.96), cap_end=True)

    # Two mossy offering stones at the foot
    rock_chunk(bm, uv, Vector((0.42, -0.24, 0.10)), (0.24, 0.20, 0.14), u_range=(0.05, 0.45), v_range=(0.02, 0.32), subdivisions=1, rng=rng)
    rock_chunk(bm, uv, Vector((-0.38, 0.26, 0.08)), (0.20, 0.18, 0.12), u_range=(0.05, 0.45), v_range=(0.02, 0.32), subdivisions=1, rng=rng)
    return finish_mesh('structure-waystone-shrine-01', bm, mat)


def build_structure_ruined_column(mat):
    """Toppled fluted marble/limestone temple column drums overgrown with trailing ivy."""
    rng = random.Random(313)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Standing broken column base drum
    base_drum = [Vector((-0.36, 0.12, -0.04)), Vector((-0.36, 0.12, 0.14)), Vector((-0.34, 0.12, 0.68))]
    tube(bm, uv, base_drum, [0.38, 0.32, 0.30], sides=8, u_range=(0.0, 0.60), v_range=(0.04, 0.88), rough=0.03, rng=rng)

    # Fallen fluted column drum lying diagonally on the ground
    fallen = [Vector((0.02, -0.18, 0.22)), Vector((0.68, -0.04, 0.18))]
    tube(bm, uv, fallen, [0.28, 0.27], sides=8, u_range=(0.0, 0.60), v_range=(0.08, 0.90), rough=0.03, rng=rng)

    # 6 trailing ivy cards draped over the standing and fallen drums
    for k in range(6):
        yaw = k / 6 * 2 * math.pi + 0.3
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        center = Vector((-0.34, 0.12, 0.58)) if k < 3 else Vector((0.35, -0.10, 0.38))
        p0 = center + out * 0.12 + Vector((0, 0, 0.06))
        p1 = center + out * 0.34 - Vector((0, 0, 0.12))
        p2 = center + out * 0.48 - Vector((0, 0, 0.34))
        arched_card(bm, uv, p0, p1, p2, 0.18, 0.28, 0.20, side, u_range=(0.64, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('structure-ruined-column-01', bm, mat)


def build_structure_roadside_milestone(mat):
    """Weathered carved stone distance milestone & wooden signpost with basal wildflowers."""
    rng = random.Random(314)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Carved arched stone milestone
    mile_pts = [Vector((-0.18, 0.0, -0.04)), Vector((-0.18, 0.0, 0.68)), Vector((-0.18, 0.0, 0.88))]
    tube(bm, uv, mile_pts, [0.22, 0.20, 0.10], sides=6, u_range=(0.02, 0.46), v_range=(0.04, 0.94), scale_y=0.62)

    # Wooden signpost mast & two directional fingerboards
    post_pts = [Vector((0.22, 0.06, -0.04)), Vector((0.24, 0.06, 1.48))]
    tube(bm, uv, post_pts, [0.065, 0.052], sides=5, u_range=(0.50, 0.74), v_range=(0.04, 0.94))
    arm1 = [Vector((0.18, 0.06, 1.32)), Vector((0.76, 0.06, 1.32))]
    tube(bm, uv, arm1, [0.075, 0.045], sides=4, u_range=(0.50, 0.74), v_range=(0.20, 0.85), scale_y=0.25)
    arm2 = [Vector((0.24, 0.02, 1.16)), Vector((0.24, -0.52, 1.16))]
    tube(bm, uv, arm2, [0.075, 0.045], sides=4, u_range=(0.50, 0.74), v_range=(0.20, 0.85), scale_y=0.25)

    # 6 basal wildflower tufts around the milestone foot
    for k in range(6):
        yaw = k / 6 * 2 * math.pi + 0.4
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        p0 = out * 0.24 + Vector((0, 0, 0.02))
        p1 = out * 0.40 + Vector((0, 0, 0.26))
        p2 = out * 0.56 + Vector((0, 0, 0.40))
        arched_card(bm, uv, p0, p1, p2, 0.16, 0.26, 0.22, side, u_range=(0.78, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('structure-roadside-milestone-01', bm, mat)


def build_structure_dwarven_cairn(mat):
    """Vondari / Stonehold banded basalt & bronze boundary marker pillar with glowing brazier cap."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Stepped hexagonal basalt & bronze pillar crowned with a flared ember brazier
    pts = [
        Vector((0, 0, -0.04)),
        Vector((0, 0, 0.28)),
        Vector((0, 0, 0.34)),
        Vector((0, 0, 1.02)),
        Vector((0, 0, 1.16)),
        Vector((0, 0, 1.32)),
    ]
    radii = [0.44, 0.38, 0.26, 0.22, 0.38, 0.32]
    tube(bm, uv, pts, radii, sides=6, u_range=(0.56, 0.98), v_range=(0.04, 0.94), cap_end=True)

    # Two flanked carved basalt ward stones at the base
    for side_x in (-1, 1):
        w_pts = [Vector((side_x * 0.48, 0.0, -0.02)), Vector((side_x * 0.52, 0.0, 0.56)), Vector((side_x * 0.52, 0.0, 0.72))]
        tube(bm, uv, w_pts, [0.18, 0.15, 0.03], sides=4, u_range=(0.04, 0.52), v_range=(0.08, 0.88))
    return finish_mesh('structure-dwarven-cairn-01', bm, mat)


def build_structure_bog_fetish_totem(mat):
    """Grukmar wetland lashed driftwood & skull fetish totem with glowing bog-gourd lantern."""
    rng = random.Random(316)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Tripod of crooked driftwood stakes lashed together
    for k in range(3):
        yaw = k * 2 * math.pi / 3 + 0.2
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        pts = [out * 0.38 + Vector((0, 0, -0.04)), out * 0.08 + Vector((0, 0, 0.92)), -out * 0.16 + Vector((0, 0, 1.56))]
        tube(bm, uv, pts, [0.065, 0.052, 0.032], sides=5, u_range=(0.04, 0.46), v_range=(0.04, 0.92), rough=0.06, rng=rng)

    # Lashed crossbar
    cross = [Vector((-0.44, 0.0, 1.18)), Vector((0.48, 0.0, 1.24))]
    tube(bm, uv, cross, [0.045, 0.040], sides=4, u_range=(0.04, 0.46), v_range=(0.35, 0.65))

    # Horned beast skull mounted at the central lashing
    skull = [Vector((0.0, -0.08, 0.82)), Vector((0.0, -0.22, 0.96)), Vector((0.0, -0.34, 0.84))]
    tube(bm, uv, skull, [0.12, 0.15, 0.06], sides=5, u_range=(0.54, 0.96), v_range=(0.06, 0.52))

    # Hanging bioluminescent bog-gourd lantern on +X arm
    gourd = [Vector((0.38, 0.0, 1.18)), Vector((0.38, 0.0, 0.96)), Vector((0.38, 0.0, 0.78))]
    tube(bm, uv, gourd, [0.02, 0.12, 0.04], sides=6, u_range=(0.54, 0.96), v_range=(0.62, 0.96))
    return finish_mesh('structure-bog-fetish-totem-01', bm, mat)


def build_structure_rainforest_idol(mat):
    """Ancient moss-covered carved jungle monolith / stepped stone idol entwined with vines."""
    rng = random.Random(317)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    # Stepped carved jungle monolith with brow ridge & crown tier
    idol_pts = [
        Vector((0, 0, -0.04)),
        Vector((0, 0, 0.36)),
        Vector((0, 0, 0.88)),
        Vector((0, 0, 1.18)),
        Vector((0, 0, 1.48)),
    ]
    idol_radii = [0.46, 0.36, 0.34, 0.40, 0.28]
    tube(bm, uv, idol_pts, idol_radii, sides=6, u_range=(0.02, 0.56), v_range=(0.04, 0.96), scale_y=0.78, rough=0.05, rng=rng)

    # 8 jungle fern & monstera vine cards embracing the monolith base and shoulders
    for k in range(8):
        yaw = k / 8 * 2 * math.pi + 0.25
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        z0 = 0.08 if k < 5 else 0.72
        p0 = out * 0.26 + Vector((0, 0, z0))
        p1 = out * 0.52 + Vector((0, 0, z0 + 0.28))
        p2 = out * 0.74 + Vector((0, 0, z0 + 0.14))
        arched_card(bm, uv, p0, p1, p2, 0.18, 0.34, 0.24, side, u_range=(0.60, 1.0), v_range=(0.02, 0.98))
    return finish_mesh('structure-rainforest-idol-01', bm, mat)


# ---------------------------------------------------------------------------
# 5. AUTHORED BIOME SHRUBS (`bushVariants`, height 1.15 - 1.65 m)
# ---------------------------------------------------------------------------

def _build_shrub_archetype(name, mat, seed, height=1.45, spread=1.15, n_branches=5, n_cards=16, flat_top=False):
    """Sculpted woody 3D branch skeleton + multi-tiered organic dome/canopy cards."""
    rng = random.Random(seed)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')

    for k in range(n_branches):
        yaw = k / n_branches * 2 * math.pi + rng.uniform(-0.22, 0.22)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        p0 = Vector((0, 0, 0.0))
        p1 = out * (spread * 0.28) + Vector((0, 0, height * 0.38))
        p2 = out * (spread * 0.58) + Vector((0, 0, height * (0.74 if flat_top else 0.64)))
        tube(bm, uv, [p0, p1, p2], [0.085, 0.055, 0.028], sides=4, u_range=(0.02, 0.28), v_range=(0.05, 0.92), rough=0.06, rng=rng)

    n_outer = n_cards // 2
    n_mid = n_cards - n_outer - 3
    # Outer skirt tier + mid dome tier + 3 central crown dome cards
    for k in range(n_cards):
        yaw = (k * 2.39996) + rng.uniform(-0.18, 0.18)  # golden-angle distribution
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        side = Vector((-math.sin(yaw), math.cos(yaw), 0))
        if k < n_outer:
            r0, r1, r2 = spread * 0.14, spread * 0.56, spread * 0.92
            z0 = height * (0.18 if flat_top else 0.08)
            z1 = height * (0.62 if flat_top else 0.52)
            z2 = height * (0.76 if flat_top else 0.42)
        elif k < n_outer + n_mid:
            r0, r1, r2 = spread * 0.08, spread * 0.42, spread * 0.68
            z0 = height * 0.26
            z1 = height * (0.86 if flat_top else 0.80)
            z2 = height * (0.94 if flat_top else 0.72)
        else:
            # Central crown dome cards overarching the top
            r0, r1, r2 = -spread * 0.18, spread * 0.06, spread * 0.36
            z0 = height * 0.32
            z1 = height * 0.98
            z2 = height * (0.92 if flat_top else 0.82)
        p0 = out * r0 + Vector((0, 0, z0))
        p1 = out * r1 + Vector((0, 0, z1))
        p2 = out * r2 + Vector((0, 0, z2))
        w = spread * rng.uniform(0.56, 0.72)
        arched_card(bm, uv, p0, p1, p2, w * 0.52, w, w * 0.76, side, u_range=(0.30, 1.0), v_range=(0.02, 0.98))
    return finish_mesh(name, bm, mat)


def build_bush_arid_ocotillo(mat):
    return _build_shrub_archetype('bush-arid-ocotillo-01', mat, 321, height=1.55, spread=1.10, n_branches=6, n_cards=14)


def build_bush_savanna_thorn(mat):
    return _build_shrub_archetype('bush-savanna-thorn-01', mat, 322, height=1.45, spread=1.35, n_branches=5, n_cards=16, flat_top=True)


def build_bush_meadow_gorse(mat):
    return _build_shrub_archetype('bush-meadow-gorse-01', mat, 323, height=1.35, spread=1.18, n_branches=5, n_cards=16)


def build_bush_boreal_juniper(mat):
    return _build_shrub_archetype('bush-boreal-juniper-01', mat, 324, height=1.15, spread=1.25, n_branches=5, n_cards=16)


def build_bush_tropical_hibiscus(mat):
    return _build_shrub_archetype('bush-tropical-hibiscus-01', mat, 325, height=1.62, spread=1.28, n_branches=5, n_cards=16)


def build_bush_swamp_buttonbush(mat):
    return _build_shrub_archetype('bush-swamp-buttonbush-01', mat, 326, height=1.38, spread=1.22, n_branches=6, n_cards=16)
