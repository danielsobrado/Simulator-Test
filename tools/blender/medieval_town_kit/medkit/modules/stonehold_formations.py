"""Vondari Dwarven Stonehold crag-citadel & geothermal formations.

Each formation is an inhabited, engineered Dwarven stronghold outcrop built into
jagged dark mountain crags (`rock`) with sunlit paved flagstone terrace decks
(`stone_dressed`), gold-inlaid basalt cornices, sleek crenellated parapet curbs,
carved staircases, arched viaduct bridges, summit citadels & signal beacons,
recessed firelit portals, hanging navy-and-gold Vondari banners, cliffside
timber scaffolding & ore cranes with suspended buckets, canvas work tents, cargo
clusters, cascading whitewater waterfalls, and miniature alpine conifers.
"""
import math
import random

from mathutils import Matrix

from ..config import detailed
from ..mesh import MeshBuilder
from ..sculpt import sculpt_rock
from .stonehold_parts import (
    STONE_BEVEL,
    cargo_cluster,
    cliff_portal_alcove,
    cliff_scaffolding_crane,
    crag_block,
    dwarven_brazier,
    dwarven_stair_flight,
    dwarven_terrace_deck,
    jagged_cliff_tier,
    mini_pine,
    moss_tuft,
    rock_spire,
    summit_beacon_fort,
    summit_citadel_hall,
    viaduct_bridge,
    vondari_cliff_banner,
    waterfall_cascade,
    work_tent,
)


def _talus_skirt(b, cx, cy, z0, rx, ry, count, size_lo, size_hi, seed=1,
                 arc=(0.0, 2 * math.pi)):
    """Scatter angular dark mountain crag talus boulders around a perimeter arc."""
    rng = random.Random(seed)
    if not detailed():
        count = max(3, count // 2)
    for i in range(count):
        t = (i + rng.uniform(0.15, 0.85)) / count
        a = arc[0] + t * (arc[1] - arc[0])
        dist = rng.uniform(0.84, 1.08)
        bx = cx + rx * dist * math.cos(a)
        by = cy + ry * dist * math.sin(a)
        brx = rng.uniform(size_lo, size_hi)
        bry = brx * rng.uniform(0.72, 1.25)
        bh = brx * rng.uniform(0.55, 1.15)
        crag_block(b, bx, by, z0, z0 + bh, brx, bry, seed=seed * 31 + i, sides=6,
                   mat='rock_cliff', cap_mat='rock_cliff', batter=0.82, chamfer=0.025,
                   tilt_x=rng.uniform(-0.12, 0.12), tilt_y=rng.uniform(-0.12, 0.12),
                   rot=rng.uniform(0, math.pi), tone=rng.uniform(0.68, 0.94))


def _geothermal_pool_surface(b, cx, cy, z_pool, rx, ry, bubbles, seed=1):
    """Sunken geothermal magma/mineral pool with dark mirror water, glowing ember fissures,
    3D concentric ripple waves, and steaming mineral domes."""
    crag_block(b, cx, cy, max(0.0, z_pool - 0.16), z_pool, rx, ry, seed=seed, sides=10,
               mat='stone_basalt', cap_mat='water', batter=0.98, chamfer=0.01, tone=0.78)

    for idx, (bx, by, br, n_rings) in enumerate(bubbles):
        m = Matrix.Translation((bx, by, z_pool))
        b.box((bx - br * 1.15, by - br * 1.15, z_pool - 0.01),
              (bx + br * 1.15, by + br * 1.15, z_pool + 0.025), 'firelight', bevel=0)
        dome_profile = [
            (0.0, br * 0.82),
            (br * 0.42, br * 0.75),
            (br * 0.78, br * 0.52),
            (br * 0.98, br * 0.20),
            (br * 1.04, -0.01),
        ]
        b.lathe(list(reversed(dome_profile)), 14 if detailed() else 8, 'glow', m=m, smooth=True)

        if detailed():
            for r_idx in range(n_rings):
                r_inner = br * (1.28 + r_idx * 0.68)
                r_crest = r_inner + br * 0.22
                r_outer = r_inner + br * 0.46
                h_crest = max(0.018, 0.042 - r_idx * 0.008)
                ripple_prof = [
                    (r_outer, -0.005),
                    (r_crest, h_crest),
                    (r_inner, -0.005),
                ]
                mat_rip = 'firelight' if r_idx == 0 else 'stone_granite'
                b.lathe(ripple_prof, 16, mat_rip, m=m, smooth=True)


def stonehold_ledge_small():
    """01 — Compact 3-tier Vondari Dwarven Watch-Crag Outpost:
    Jagged dark crag cliff tiers, sunlit paved flagstone decks with gold-inlaid parapet curbs,
    carved stone staircases, recessed glowing cliff doorway, cliffside timber scaffolding
    & ore crane with hanging bucket, navy-and-gold Vondari banner, canvas work tent,
    cascading waterfall, and octagonal summit signal-beacon fort."""
    b = MeshBuilder()
    # Tier 1: Lower fortified cliff terrace (Z = 0.0 .. 0.48)
    dwarven_terrace_deck(b, 0.0, 0.0, 0.0, 0.48, 1.38, 1.24, seed=101, sides=8,
                         open_angles=((-2.1, -1.1), (-0.9, -0.2)), ribs=20)
    # Tier 2: Middle fortified bastion terrace (Z = 0.44 .. 0.98)
    dwarven_terrace_deck(b, -0.06, 0.08, 0.44, 0.98, 0.94, 0.84, seed=102, sides=8,
                         open_angles=((-2.1, -1.1), (-2.9, -2.2)), ribs=16)
    # Tier 3: Summit Octagonal Signal-Beacon Fort (Z = 0.96 .. 1.32)
    summit_beacon_fort(b, 0.04, 0.14, 0.96, height=0.34, radius=0.48, seed=103)

    # Carved flights of stone stairs climbing Tier 0 -> Tier 1 -> Tier 2 -> Summit
    dwarven_stair_flight(b, (-0.16, -1.46, 0.0), (-0.16, -1.06, 0.48),
                         width=0.34, steps=7, braziers_bottom=True)
    dwarven_stair_flight(b, (-0.34, -1.04, 0.48), (-0.24, -0.68, 0.98),
                         width=0.32, steps=7, braziers_top=True)
    dwarven_stair_flight(b, (0.04, -0.64, 0.98), (0.04, -0.32, 1.30),
                         width=0.28, steps=6)

    # Recessed glowing cliff portal on Tier 2 front-right face
    cliff_portal_alcove(b, 0.28, -0.66, 0.48, yaw=-0.25, width=0.34, height=0.42)
    # Hanging navy-and-gold Vondari cliff banners
    vondari_cliff_banner(b, -0.68, -0.62, 0.96, yaw=-0.45, height=0.44, width=0.18)
    vondari_cliff_banner(b, 0.66, -0.56, 0.94, yaw=0.45, height=0.42, width=0.18)

    # Left flank: Cliffside timber scaffolding & raking ore crane with hanging bucket
    cliff_scaffolding_crane(b, -0.90, 0.16, 0.46, 0.98, yaw=-math.pi * 0.5, scale=0.88, has_crane=True)
    # Lower terrace: Canvas work tent & cargo cluster
    work_tent(b, -0.72, -0.58, 0.48, yaw=-0.2, w=0.34, d=0.26, h=0.24)
    cargo_cluster(b, 0.62, -0.52, 0.48, yaw=0.3, seed=110, scale=0.95)
    # Front-right cascading waterfall channel
    waterfall_cascade(b, (0.66, -0.84, 0.46), (0.88, -1.20, 0.0), width=0.22, seed=115)

    # Corner braziers, alpine conifers & moss
    dwarven_brazier(b, 0.80, -0.48, 0.48, scale=0.85, tall=True)
    dwarven_brazier(b, -0.60, 0.52, 0.98, scale=0.80)
    mini_pine(b, 0.98, 0.18, 0.48, height=0.38, seed=120)
    mini_pine(b, -1.00, -0.35, 0.48, height=0.34, seed=121)
    moss_tuft(b, 0.42, -0.88, 0.48, radius=0.12, seed=122)

    _talus_skirt(b, 0.0, 0.0, 0.0, 1.34, 1.20, 10, 0.14, 0.26, seed=130)
    return b


def stonehold_ledge_large():
    """02 — Multi-Tiered Vondari Dwarven Fortress Outcrop:
    Broad multi-peaked crag massif with main & side bastion terraces connected by an
    arched stone viaduct bridge, grand axial staircases, polygonal summit citadel keep,
    two cliffside timber ore cranes, four navy-and-gold Vondari banners, canvas tents,
    cascading waterfall, glowing portals, and alpine conifers."""
    b = MeshBuilder()
    # Tier 1: Wide lower fortress terrace (Z = 0.0 .. 0.52)
    dwarven_terrace_deck(b, 0.0, 0.0, 0.0, 0.52, 1.82, 1.52, seed=201, sides=10,
                         open_angles=((-1.9, -1.2), (-0.7, -0.1)), ribs=24)
    # Tier 2 Left: Main middle bastion terrace (Z = 0.48 .. 1.08)
    dwarven_terrace_deck(b, -0.32, 0.10, 0.48, 1.08, 1.16, 1.00, seed=202, sides=8,
                         open_angles=((-1.9, -1.1), (-0.4, 0.4)), ribs=18)
    # Tier 2 Right: Secondary watch-bastion terrace (Z = 0.48 .. 1.04) linked by bridge
    dwarven_terrace_deck(b, 1.00, -0.12, 0.48, 1.04, 0.68, 0.62, seed=203, sides=7,
                         open_angles=((2.5, 3.5), (-1.9, -1.1)), ribs=14)
    # Arched stone viaduct bridge spanning between Tier 2 Left and Tier 2 Right
    viaduct_bridge(b, (0.35, -0.02), (0.70, -0.08), z_deck=1.06, z_ground=0.50,
                   width=0.42, arches=1, braziers=True)

    # Tier 3 Left: Upper citadel court (Z = 1.04 .. 1.56) & Polygonal Summit Citadel Keep (Z = 1.54 .. 2.16)
    dwarven_terrace_deck(b, -0.36, 0.18, 1.04, 1.56, 0.82, 0.72, seed=204, sides=8,
                         open_angles=((-1.9, -1.1),), ribs=14)
    summit_citadel_hall(b, -0.36, 0.22, 1.54, height=0.60, rx=0.54, ry=0.48, seed=205,
                        door_yaws=(0.0, math.pi * 0.5))
    # Tier 3 Right: Roaring Signal-Beacon turret on the right peak
    summit_beacon_fort(b, 1.00, -0.10, 1.02, height=0.32, radius=0.42, seed=206)

    # Grand staircases
    dwarven_stair_flight(b, (-0.32, -1.66, 0.0), (-0.32, -1.14, 0.52),
                         width=0.40, steps=8, braziers_bottom=True, braziers_top=True)
    dwarven_stair_flight(b, (-0.34, -1.04, 0.52), (-0.34, -0.58, 1.08),
                         width=0.38, steps=8, braziers_top=True)
    dwarven_stair_flight(b, (-0.36, -0.52, 1.08), (-0.36, -0.18, 1.56),
                         width=0.34, steps=7, braziers_top=True)
    dwarven_stair_flight(b, (0.98, -0.82, 0.52), (0.98, -0.46, 1.04),
                         width=0.30, steps=7)

    # Recessed glowing cliff portals
    cliff_portal_alcove(b, 0.32, -1.20, 0.02, yaw=-0.15, width=0.38, height=0.46)
    cliff_portal_alcove(b, -0.90, -0.66, 0.52, yaw=-0.45, width=0.32, height=0.42)

    # Four hanging navy-and-gold Vondari banners across the cliff tiers
    vondari_cliff_banner(b, -0.76, -0.72, 1.06, yaw=-0.25, height=0.50, width=0.20)
    vondari_cliff_banner(b, 0.06, -0.72, 1.06, yaw=0.15, height=0.50, width=0.20)
    vondari_cliff_banner(b, -0.70, -0.40, 1.54, yaw=-0.20, height=0.44, width=0.18)
    vondari_cliff_banner(b, 1.28, -0.58, 1.02, yaw=0.35, height=0.46, width=0.18)

    # Twin cliffside timber scaffolding towers & raking ore cranes
    cliff_scaffolding_crane(b, -1.34, 0.18, 0.50, 1.08, yaw=-math.pi * 0.5, scale=0.95, has_crane=True)
    cliff_scaffolding_crane(b, 1.54, 0.06, 0.50, 1.04, yaw=math.pi * 0.5, scale=0.88, has_crane=True)

    # Work tents, cargo clusters, waterfall & alpine pines
    work_tent(b, -1.16, -0.58, 0.52, yaw=-0.25, w=0.38, d=0.28, h=0.25)
    work_tent(b, 0.54, -0.78, 0.52, yaw=0.20, w=0.34, d=0.26, h=0.24)
    cargo_cluster(b, -0.80, -0.62, 0.52, yaw=0.1, seed=210)
    cargo_cluster(b, 0.18, -0.48, 1.08, yaw=-0.2, seed=211)
    waterfall_cascade(b, (-1.00, -1.14, 0.50), (-1.20, -1.50, 0.0), width=0.24, seed=215)

    for px, py, pz, ph, s in (
        (-1.50, -0.32, 0.52, 0.42, 220),
        (1.40, -0.62, 0.52, 0.38, 221),
        (0.22, 0.68, 1.08, 0.40, 222),
        (-1.05, 0.72, 1.08, 0.36, 223),
    ):
        mini_pine(b, px, py, pz, height=ph, seed=s)
    moss_tuft(b, -0.62, -1.12, 0.52, radius=0.15, seed=225)
    moss_tuft(b, 0.72, -0.68, 1.04, radius=0.13, seed=226)

    _talus_skirt(b, 0.0, 0.0, 0.0, 1.76, 1.48, 14, 0.15, 0.30, seed=230)
    return b


def stonehold_twin_outcrop():
    """03 — Twin-Peaked Vondari Dwarven Citadel Outcrop (matches `stonehold-3.jpg` directly):
    - Left Peak: 3 stepped sunlit flagstone & gold-corniced tiers rising to an octagonal
      Signal-Beacon Fort with a roaring signal fire, flanked by a left timber scaffolding
      & raking ore crane with suspended bucket, 4 hanging navy-and-gold Vondari cliff
      banners, 2 canvas work tents, carved stone stairs, and a left cliff waterfall.
    - Central Saddle & Ravine: Two-tier fortified stone causeway & arched viaduct bridge
      with blazing corner braziers, spanning over a cascading ravine waterfall that plunges
      into a rocky pool beside a sunken cliff-base glowing Dwarven dock/shrine terrace.
    - Right Peak: 3 stepped sunlit flagstone & gold-corniced tiers with a grand axial
      staircase climbing between banner-draped basalt buttresses to a polygonal Vondari
      Dwarven Citadel Hall with glowing portals, flanked by a right timber ore crane,
      right-flank arched viaduct bridges, cargo clusters, and alpine conifers/moss."""
    b = MeshBuilder()

    # =========================================================================
    # 1. LEFT PEAK (X = -1.25, Y = 0.06): 3 Fortified Tiers + Signal-Beacon Fort
    # =========================================================================
    # Left Tier 1 (Z = 0.0 .. 0.48)
    dwarven_terrace_deck(b, -1.26, 0.02, 0.0, 0.48, 1.32, 1.18, seed=301, sides=8,
                         open_angles=((-2.6, -1.8), (-0.4, 0.4)), ribs=20)
    # Left Tier 2 (Z = 0.44 .. 0.96)
    dwarven_terrace_deck(b, -1.22, 0.08, 0.44, 0.96, 0.98, 0.88, seed=302, sides=8,
                         open_angles=((-2.8, -1.9), (-0.4, 0.4)), ribs=18)
    # Left Tier 3 (Z = 0.92 .. 1.46)
    dwarven_terrace_deck(b, -1.16, 0.12, 0.92, 1.46, 0.68, 0.60, seed=303, sides=8,
                         open_angles=((-1.9, -1.1), (-0.4, 0.4)), ribs=14)
    # Left Tier 4 Summit: Octagonal Signal-Beacon Fort with roaring fire (Z = 1.44 .. 1.78)
    summit_beacon_fort(b, -1.14, 0.14, 1.44, height=0.34, radius=0.44, seed=304)

    # Left Peak Staircases (matching the stepped flights on the left of stonehold-3.jpg)
    dwarven_stair_flight(b, (-1.94, -0.60, 0.48), (-1.72, -0.12, 0.96),
                         width=0.32, steps=7, braziers_bottom=True)
    dwarven_stair_flight(b, (-1.68, 0.02, 0.96), (-1.46, 0.28, 1.46),
                         width=0.28, steps=7, braziers_top=True)
    dwarven_stair_flight(b, (-1.14, -0.44, 1.46), (-1.14, -0.18, 1.78),
                         width=0.26, steps=5)

    # Left Peak Vondari Cliff Banners (navy-blue with gold borders & mountain emblem)
    vondari_cliff_banner(b, -1.72, -0.92, 0.46, yaw=-0.18, height=0.44, width=0.18)
    vondari_cliff_banner(b, -1.42, -0.50, 1.44, yaw=-0.22, height=0.48, width=0.19)
    vondari_cliff_banner(b, -0.96, -0.54, 1.44, yaw=0.05, height=0.50, width=0.20)
    vondari_cliff_banner(b, -0.58, -0.26, 1.44, yaw=0.65, height=0.46, width=0.18)

    # Left Peak Scaffolding & Ore Cranes (upper-left crane with hanging bucket + lower-left scaffolding)
    cliff_scaffolding_crane(b, -1.78, 0.22, 0.94, 1.46, yaw=-math.pi * 0.5, scale=0.92, has_crane=True)
    cliff_scaffolding_crane(b, -1.92, -0.80, 0.0, 0.48, yaw=-0.35, scale=0.76, has_crane=False)
    # Left-flank outer viaduct abutment
    viaduct_bridge(b, (-2.46, -0.18), (-2.04, -0.12), z_deck=0.48, z_ground=0.0,
                   width=0.38, arches=1, braziers=True)

    # Left Peak Canvas Work Tents, Cargo & Left Waterfall
    work_tent(b, -1.32, -0.68, 0.48, yaw=-0.12, w=0.36, d=0.26, h=0.24)
    work_tent(b, -1.54, -0.24, 0.96, yaw=-0.20, w=0.32, d=0.24, h=0.22)
    cargo_cluster(b, -1.00, -0.70, 0.48, yaw=0.1, seed=310)
    cargo_cluster(b, -0.74, -0.44, 0.96, yaw=-0.2, seed=311)
    dwarven_brazier(b, -1.14, -0.72, 0.48, scale=0.85, tall=True)
    waterfall_cascade(b, (-0.72, -0.84, 0.46), (-0.68, -1.18, 0.0), width=0.22, seed=315)

    # =========================================================================
    # 2. CENTRAL SADDLE CAUSEWAY, ARCHED VIADUCT & RAVINE WATERFALL
    # =========================================================================
    dwarven_terrace_deck(b, -0.04, -0.02, 0.0, 0.58, 0.68, 0.58, seed=320, sides=8,
                         open_angles=((-3.14, 3.14),), ribs=14)
    viaduct_bridge(b, (-0.62, -0.22), (0.48, -0.18), z_deck=0.62, z_ground=0.0,
                   width=0.48, arches=2, braziers=True)
    viaduct_bridge(b, (-0.54, 0.24), (0.46, 0.26), z_deck=0.86, z_ground=0.42,
                   width=0.42, arches=1, braziers=True)

    # Saddle connecting staircases climbing to Left Peak & Right Peak
    dwarven_stair_flight(b, (-0.42, -0.18, 0.62), (-0.76, -0.12, 0.96),
                         width=0.32, steps=6, braziers_bottom=True)
    dwarven_stair_flight(b, (0.28, -0.08, 0.62), (0.66, -0.04, 1.02),
                         width=0.34, steps=7, braziers_bottom=True, braziers_top=True)

    # Central Ravine Waterfall plunging from beneath the saddle viaduct into the rocky pool
    waterfall_cascade(b, (0.14, -0.36, 0.60), (0.24, -0.98, 0.0), width=0.28, seed=325)

    # Lower Right Cliff-Base Sunken Fortified Dock Terrace & Glowing Cliff Portal (bottom-right of stonehold-3.jpg)
    dwarven_terrace_deck(b, 0.78, -0.88, 0.0, 0.22, 0.46, 0.36, seed=328, sides=6,
                         open_angles=((1.1, 2.1),), ribs=10)
    cliff_portal_alcove(b, 0.78, -0.56, 0.22, yaw=0.0, width=0.30, height=0.38)
    dwarven_brazier(b, 0.62, -0.92, 0.22, scale=0.72)

    # =========================================================================
    # 3. RIGHT PEAK (X = +1.24, Y = +0.12): 3 Tiers + Axial Stair + Citadel Hall
    # =========================================================================
    # Right Tier 1 (Z = 0.0 .. 0.50)
    dwarven_terrace_deck(b, 1.26, 0.06, 0.0, 0.50, 1.36, 1.22, seed=331, sides=8,
                         open_angles=((2.6, 3.5), (-0.5, 0.5)), ribs=20)
    # Right Tier 2 (Z = 0.46 .. 1.02)
    dwarven_terrace_deck(b, 1.22, 0.12, 0.46, 1.02, 1.04, 0.92, seed=332, sides=8,
                         open_angles=((2.6, 3.5), (-1.9, -1.1), (-0.4, 0.4)), ribs=18)
    # Right Tier 3 Upper Citadel Court (Z = 0.98 .. 1.54)
    dwarven_terrace_deck(b, 1.20, 0.18, 0.98, 1.54, 0.78, 0.68, seed=333, sides=8,
                         open_angles=((-1.9, -1.1), (-0.4, 0.4)), ribs=14)
    # Right Tier 4 Summit: Polygonal Vondari Dwarven Citadel Hall (Z = 1.52 .. 2.14)
    summit_citadel_hall(b, 1.18, 0.24, 1.52, height=0.60, rx=0.54, ry=0.48, seed=334,
                        door_yaws=(-0.25, math.pi * 0.5))

    # Grand Axial Staircase climbing the center of the Right Peak to the Citadel Portal
    dwarven_stair_flight(b, (1.06, -0.58, 1.02), (1.10, -0.18, 1.54),
                         width=0.34, steps=8, braziers_bottom=True, braziers_top=True)
    cliff_portal_alcove(b, 1.06, -0.52, 1.02, yaw=0.0, width=0.30, height=0.38)

    # Right Flank Staircase & Twin Arched Viaduct Bridges (far-right of stonehold-3.jpg)
    dwarven_stair_flight(b, (1.84, -0.22, 1.02), (1.68, 0.16, 1.54),
                         width=0.32, steps=7, braziers_bottom=True, braziers_top=True)
    viaduct_bridge(b, (1.78, -0.42), (2.50, -0.58), z_deck=0.98, z_ground=0.0,
                   width=0.40, arches=2, braziers=True)
    viaduct_bridge(b, (1.92, 0.32), (2.52, 0.46), z_deck=1.32, z_ground=0.46,
                   width=0.38, arches=2, braziers=True)

    # Right Peak Vondari Cliff Banners
    vondari_cliff_banner(b, 0.82, -0.34, 1.52, yaw=-0.12, height=0.48, width=0.19)
    vondari_cliff_banner(b, 1.36, -0.70, 1.00, yaw=0.05, height=0.50, width=0.20)
    vondari_cliff_banner(b, 0.52, 0.08, 1.00, yaw=-1.35, height=0.44, width=0.17)

    # Right Peak Cliffside Timber Scaffolding & Raking Ore Crane with suspended bucket
    cliff_scaffolding_crane(b, 1.84, 0.36, 1.00, 1.54, yaw=math.pi * 0.5, scale=0.92, has_crane=True)
    # Lower-right work tent & cargo clusters
    work_tent(b, 2.00, -0.64, 0.50, yaw=0.25, w=0.34, d=0.26, h=0.24)
    cargo_cluster(b, 0.82, -0.54, 1.02, yaw=0.15, seed=340)
    cargo_cluster(b, 1.54, -0.48, 1.02, yaw=-0.25, seed=341)
    dwarven_brazier(b, 1.56, -0.28, 1.54, scale=0.82, tall=True)

    # Alpine Conifers & Moss Clusters tucked into rock crevices across both peaks
    for px, py, pz, ph, s in (
        (-1.86, -0.38, 0.48, 0.38, 350),
        (-1.02, -0.36, 0.96, 0.36, 351),
        (-1.62, -0.82, 0.02, 0.34, 352),
        (0.42, -0.62, 0.48, 0.38, 353),
        (1.50, -0.60, 0.50, 0.40, 354),
        (1.94, -0.18, 0.50, 0.36, 355),
    ):
        mini_pine(b, px, py, pz, height=ph, seed=s)
    for mx, my, mz, mr, s in (
        (-1.08, -0.48, 0.96, 0.14, 360),
        (0.76, -0.58, 0.50, 0.15, 361),
        (1.18, -0.62, 0.50, 0.14, 362),
        (-0.32, -0.52, 0.58, 0.12, 363),
    ):
        moss_tuft(b, mx, my, mz, radius=mr, seed=s)

    _talus_skirt(b, -1.26, 0.02, 0.0, 1.28, 1.14, 10, 0.14, 0.26, seed=370)
    _talus_skirt(b, 1.26, 0.06, 0.0, 1.32, 1.18, 10, 0.14, 0.26, seed=371)
    return b


# Each formation stands on a basalt bluff so its citadel tiers crown a mountain, as in the
# concept art: module -> (height, ellipses (cx, cy, rx, ry, seed), falls (x, y_top, y_foot,
# width)). Ellipses cover the stair feet; falls continue an existing waterfall from its old pool
# down the new cliff. colliders.py builds each formation's collision from the same table.
BLUFFS = {
    'Stonehold_Ledge_Small': (0.70, ((0.0, -0.12, 1.45, 1.50, 180),),
                              ((0.88, -1.20, -1.55, 0.22),)),
    'Stonehold_Ledge_Large': (0.80, ((0.0, -0.12, 1.95, 1.72, 280),),
                              ((-1.20, -1.50, -1.78, 0.24),)),
    'Stonehold_Twin_Outcrop': (0.85, ((-1.30, 0.02, 1.55, 1.36, 380), (1.30, 0.06, 1.60, 1.40, 381),
                                      (-0.02, -0.34, 0.95, 0.92, 382)),
                               ((-0.68, -1.18, -1.50, 0.22), (0.24, -0.98, -1.42, 0.28))),
    'Stonehold_Vent_Crater': (0.60, ((0.0, -0.06, 1.55, 1.62, 480),), ()),
    'Stonehold_Caldera_Basin': (0.70, ((0.0, -0.08, 2.00, 1.86, 580),), ()),
    'Stonehold_Fang_Shrine': (0.60, ((0.0, -0.08, 1.62, 1.62, 680),), ()),
    'Stonehold_Cavern_Maw': (0.50, ((0.0, -0.20, 2.05, 2.12, 780),), ()),
    'Stonehold_Horned_Sanctum': (0.70, ((0.10, -0.05, 2.55, 2.32, 880), (-1.70, 0.35, 1.15, 1.05, 881)),
                                 ((1.42, -1.78, -2.30, 0.28),)),
}

# The original maquette coordinates use 0.42-unit doors: 5 m/unit makes them 2.1 m.
# Scale geometry, texture density and semantic collision together, after sculpting.
FORMATION_SCALE = 5.0


# Mountain pieces sculpted the same way: (wrap-UV centres, rock triangle floor); no bluff.
MOUNTAIN_SCULPT = {
    'Mountain_Cliff_Wall': (((0.0, 0.0),), 12000),
    'Mountain_Gate_Massif': (((-4.5, 0.4), (4.5, 0.4)), 12000),
    'Mountain_Cavern_Vault': (((0.0, 0.0),), 8000),
    'Mine_Vent_Stack': (((0.0, 0.0),), 1500),
}


def _raise_on_bluff(b, h, bluffs, falls=()):
    """Lift everything built so far by `h` onto tall columnar cliffs, so the citadel tiers read
    as crowning a mountain rather than stacked on the ground; `falls` (x, y_top, y_foot, width)
    continue a waterfall from its old pool out over the new cliff edge to the ground."""
    for v in b.verts:
        v.z += h
    for cx, cy, rx, ry, seed in bluffs:
        jagged_cliff_tier(b, cx, cy, 0.0, h, rx, ry, seed=seed, ribs=28)
        _talus_skirt(b, cx, cy, 0.0, rx * 1.02, ry * 1.02, 12, 0.12, 0.30, seed=seed + 7)
    for x, y_top, y_foot, w in falls:
        waterfall_cascade(b, (x, y_top, h), (x + 0.04, y_foot, 0.0), width=w, seed=int(abs(x * 100)) + 400)


def stonehold_vent_crater():
    """04 — Vondari Dwarven Geothermal Magma-Vent & Alchemical Extraction Crater:
    Jagged dark crag crater rim, paved Dwarven stone-and-gold retaining curb,
    glowing molten/mineral geothermal pool, carved stone inspection stairs, cliffside
    timber extraction crane with suspended crucible, Vondari banner, and braziers."""
    b = MeshBuilder()
    dwarven_terrace_deck(b, 0.0, 0.0, 0.0, 0.36, 1.42, 1.32, seed=401, sides=10,
                         open_angles=((-1.9, -1.2),), ribs=20)
    _geothermal_pool_surface(b, 0.0, 0.0, 0.38, 0.94, 0.88,
                             bubbles=[(0.0, 0.02, 0.22, 2)], seed=402)

    # Ring of jagged dark crag spires around the rim
    rng = random.Random(403)
    n_rim = 12 if detailed() else 7
    for i in range(n_rim):
        a = 2 * math.pi * i / n_rim + rng.uniform(-0.06, 0.06)
        if -1.95 <= a <= -1.15 or (2 * math.pi - 1.95) <= a <= (2 * math.pi - 1.15):
            continue
        r_dist = rng.uniform(0.88, 1.02)
        rx_c = 1.10 * r_dist * math.cos(a)
        ry_c = 1.02 * r_dist * math.sin(a)
        h_top = rng.uniform(0.62, 0.96)
        w_b = rng.uniform(0.22, 0.32)
        crag_block(b, rx_c, ry_c, 0.24, h_top, w_b, w_b * 0.82,
                   seed=410 + i, sides=6, mat='rock_cliff', cap_mat='rock_cliff',
                   batter=0.78, chamfer=0.025,
                   tilt_x=-0.14 * math.cos(a), tilt_y=-0.14 * math.sin(a),
                   rot=a, tone=rng.uniform(0.70, 0.92))
        if i % 3 == 0:
            rock_spire(b, (rx_c, ry_c, h_top - 0.12),
                       (rx_c * 0.92, ry_c * 0.92, h_top + 0.36),
                       w_b * 0.55, w_b * 0.45, seed=430 + i,
                       mat='rock_cliff', cap_mat='rock_cliff', sides=5, segs=3)

    # Front carved stone inspection staircase & flanking braziers
    dwarven_stair_flight(b, (0.0, -1.52, 0.0), (0.0, -1.04, 0.38),
                         width=0.38, steps=6, braziers_bottom=True, braziers_top=True)
    # Rear extraction platform with timber crane overhanging the glowing vent
    dwarven_terrace_deck(b, -0.18, 0.98, 0.32, 0.78, 0.52, 0.42, seed=440, sides=6, ribs=12)
    cliff_scaffolding_crane(b, -0.18, 0.86, 0.36, 0.78, yaw=0.0, scale=0.82, has_crane=True)
    vondari_cliff_banner(b, -0.58, 0.72, 0.76, yaw=-0.4, height=0.42, width=0.17)
    cargo_cluster(b, 0.58, -0.82, 0.36, yaw=0.2, seed=445, scale=0.9)
    mini_pine(b, -1.12, -0.48, 0.36, height=0.36, seed=448)

    _talus_skirt(b, 0.0, 0.0, 0.0, 1.36, 1.26, 12, 0.14, 0.26, seed=450)
    return b


def stonehold_caldera_basin():
    """05 — Grand Vondari Geothermal Forge-Caldera & Overlook Bastion:
    Multi-tiered dark crag caldera massif, twin-vent glowing magma/mineral basin
    spanned by an arched Dwarven stone bridge, rear elevated Forge-Overlook Citadel,
    cliffside crucible crane, hanging Vondari banners, stairs, and conifers."""
    b = MeshBuilder()
    dwarven_terrace_deck(b, 0.0, 0.0, 0.0, 0.42, 1.88, 1.68, seed=501, sides=10,
                         open_angles=((-1.9, -1.2),), ribs=22)
    dwarven_terrace_deck(b, 0.0, 0.05, 0.38, 0.74, 1.54, 1.38, seed=502, sides=10,
                         open_angles=((-1.9, -1.2),), ribs=18)

    _geothermal_pool_surface(
        b, 0.05, 0.02, 0.74, 1.16, 1.02,
        bubbles=[(-0.28, 0.18, 0.21, 2), (0.28, -0.18, 0.23, 2)],
        seed=503,
    )

    # Arched stone bridge spanning across the glowing caldera pool
    viaduct_bridge(b, (-0.98, -0.05), (0.98, -0.05), z_deck=0.96, z_ground=0.72,
                   width=0.36, arches=2, braziers=True)

    # Rear elevated Forge-Overlook Bastion & Citadel Keep
    dwarven_terrace_deck(b, -0.48, 0.88, 0.70, 1.32, 0.78, 0.62, seed=504, sides=8,
                         open_angles=((-1.9, -1.1),), ribs=14)
    summit_citadel_hall(b, -0.48, 0.92, 1.30, height=0.54, rx=0.48, ry=0.42, seed=505,
                        door_yaws=(0.0,))
    vondari_cliff_banner(b, -0.88, 0.42, 1.30, yaw=-0.2, height=0.48, width=0.19)
    vondari_cliff_banner(b, -0.08, 0.42, 1.30, yaw=0.2, height=0.48, width=0.19)

    # Right-side cliffside timber crucible crane & work tent
    cliff_scaffolding_crane(b, 1.18, 0.48, 0.72, 1.24, yaw=-math.pi * 0.5, scale=0.88, has_crane=True)
    work_tent(b, 1.12, -0.62, 0.74, yaw=0.3, w=0.34, d=0.26, h=0.24)
    cargo_cluster(b, -1.12, -0.48, 0.74, yaw=-0.2, seed=510)

    # Front grand staircase climbing from ground to Caldera Rim
    dwarven_stair_flight(b, (0.0, -1.82, 0.0), (0.0, -1.36, 0.42),
                         width=0.42, steps=7, braziers_bottom=True)
    dwarven_stair_flight(b, (0.0, -1.32, 0.42), (0.0, -0.96, 0.74),
                         width=0.38, steps=6, braziers_top=True)

    # Perimeter jagged dark crag spires
    rng = random.Random(520)
    for i in range(10 if detailed() else 6):
        a = -math.pi * 0.25 + (math.pi * 1.5) * i / 9.0
        bx = 1.32 * math.cos(a)
        by = 1.18 * math.sin(a)
        bh = rng.uniform(0.98, 1.40)
        bw = rng.uniform(0.24, 0.34)
        crag_block(b, bx, by, 0.38, bh, bw, bw * 0.84, seed=520 + i, sides=6,
                   mat='rock_cliff', cap_mat='rock_cliff', batter=0.80, chamfer=0.03,
                   rot=a, tone=rng.uniform(0.70, 0.90))

    mini_pine(b, -1.42, -0.22, 0.42, height=0.38, seed=540)
    mini_pine(b, 1.44, 0.12, 0.42, height=0.36, seed=541)
    _talus_skirt(b, 0.0, 0.0, 0.0, 1.82, 1.62, 14, 0.18, 0.34, seed=550)
    return b


def stonehold_fang_shrine():
    """06 — Vondari Dragon-Fang Ancestor Shrine (`stonehold-4.jpg`):
    Towering curved dark-rock dragon-fang monoliths framing a recessed horned ancestor
    portal glowing with warm firelight, multi-tiered sunlit flagstone ritual terrace,
    carved stone stairs, octagonal roaring fire-altar, hanging navy-and-gold Vondari
    banners, and alpine conifers."""
    b = MeshBuilder()
    # Stepped paved ritual terraces
    dwarven_terrace_deck(b, 0.0, 0.0, 0.0, 0.36, 1.54, 1.42, seed=601, sides=8,
                         open_angles=((-1.9, -1.2),), ribs=20)
    dwarven_terrace_deck(b, 0.04, 0.06, 0.32, 0.68, 1.12, 1.02, seed=602, sides=8,
                         open_angles=((-1.9, -1.2),), ribs=16)

    # Grand ritual staircase climbing the front approach
    dwarven_stair_flight(b, (0.04, -1.58, 0.0), (0.04, -1.08, 0.36),
                         width=0.40, steps=7, braziers_bottom=True)
    dwarven_stair_flight(b, (0.04, -1.04, 0.36), (0.04, -0.62, 0.68),
                         width=0.36, steps=6, braziers_top=True)

    # Central Octagonal Vondari Runic Fire-Altar Dais
    summit_beacon_fort(b, 0.06, -0.12, 0.66, height=0.30, radius=0.44, seed=610)

    # Rear Horned Ancestor Sanctum Archway & Glowing Shrine Portal
    dwarven_terrace_deck(b, 0.02, 0.56, 0.32, 1.72, 0.88, 0.54, seed=615, sides=8, ribs=14)
    cliff_portal_alcove(b, 0.04, 0.14, 0.68, yaw=0.0, width=0.42, height=0.66)
    vondari_cliff_banner(b, -0.48, 0.10, 1.66, yaw=-0.12, height=0.52, width=0.20)
    vondari_cliff_banner(b, 0.54, 0.10, 1.66, yaw=0.12, height=0.52, width=0.20)

    # Towering curved Dragon-Fang Monolith Spires
    rock_spire(b, (-0.36, 0.54, 0.28), (-0.08, 0.68, 3.18), 0.52, 0.40,
               seed=640, mat='rock_cliff', cap_mat='rock_cliff',
               curve=(-0.22, 0.08, 0.22), sides=6, segs=6)
    rock_spire(b, (-0.88, 0.34, 0.28), (-0.62, 0.44, 2.15), 0.34, 0.26,
               seed=641, mat='rock_cliff', cap_mat='rock_cliff',
               curve=(-0.14, 0.04, 0.14), sides=5, segs=5)
    rock_spire(b, (0.48, 0.54, 0.28), (0.24, 0.64, 2.48), 0.40, 0.32,
               seed=642, mat='rock_cliff', cap_mat='rock_cliff',
               curve=(0.18, 0.06, 0.16), sides=6, segs=5)
    rock_spire(b, (0.92, 0.30, 0.28), (0.72, 0.38, 1.82), 0.30, 0.24,
               seed=643, mat='rock_cliff', cap_mat='rock_cliff',
               curve=(0.12, 0.04, 0.10), sides=5, segs=4)

    # Hanging iron chains between the fang monoliths
    if detailed():
        b.beam((-0.72, 0.38, 1.48), (-0.34, 0.54, 1.72), (0, 0, 1), (-0.015, 0.015), 0.024, 'iron', bevel=0)
        b.beam((0.42, 0.54, 1.62), (0.78, 0.36, 1.38), (0, 0, 1), (-0.015, 0.015), 0.024, 'iron', bevel=0)

    dwarven_brazier(b, -0.68, -0.48, 0.68, scale=0.85, tall=True)
    dwarven_brazier(b, 0.74, -0.48, 0.68, scale=0.85, tall=True)
    mini_pine(b, -1.12, -0.22, 0.36, height=0.38, seed=648)
    mini_pine(b, 1.14, -0.18, 0.36, height=0.36, seed=649)

    _talus_skirt(b, 0.0, 0.0, 0.0, 1.48, 1.36, 12, 0.15, 0.28, seed=650)
    return b


def stonehold_cavern_maw():
    """07 — Subterranean Dwarven Cavern Maw & Magma Gate (`stonehold-6.jpg`):
    Towering twin-horned dark-crag massif with curved stalactite/fang ribs framing
    an unobstructed glowing triangular cavern throat, carved Vondari Dwarven basalt & gold
    portal architrave, an arched stone bridge & stair approach spanning over a glowing
    molten lava fissure channel, hanging Vondari banners, and upper watch-braziers."""
    b = MeshBuilder()
    dwarven_terrace_deck(b, 0.0, -0.58, 0.0, 0.32, 1.96, 1.62, seed=701, sides=10,
                         open_angles=((-1.9, -1.2),), ribs=20)
    dwarven_terrace_deck(b, 0.0, -0.36, 0.28, 0.56, 1.48, 1.18, seed=702, sides=8,
                         open_angles=((-1.9, -1.2),), ribs=16)

    # Molten magma fissure glowing beneath the approach stair & bridge
    b.box((-0.48, -1.18, 0.30), (0.48, 0.15, 0.35), 'firelight', bevel=0)
    b.box((-0.28, -1.12, 0.31), (0.28, 0.15, 0.37), 'glow', bevel=0)

    # Carved approach staircase & arched stone bridge over the magma fissure
    dwarven_stair_flight(b, (0.0, -1.85, 0.0), (0.0, -1.22, 0.34),
                         width=0.44, steps=7, braziers_bottom=True)
    viaduct_bridge(b, (0.0, -1.22), (0.0, -0.22), z_deck=0.58, z_ground=0.28,
                   width=0.48, arches=1, braziers=True)

    # Flanking left & right dark-crag cliff cheeks leaving central portal cleft (x = -0.52..0.52) wide open
    for side, s_idx in ((-1, 710), (1, 711)):
        jagged_cliff_tier(b, side * 0.98, 0.62, 0.32, 1.55, 0.66, 0.78, seed=s_idx, ribs=14)
        jagged_cliff_tier(b, side * 0.90, 0.68, 1.48, 2.65, 0.58, 0.68, seed=s_idx + 2, ribs=14)
        dwarven_brazier(b, side * 0.92, 0.16, 2.65, scale=0.88, tall=True)
        vondari_cliff_banner(b, side * 0.96, -0.06, 2.15, yaw=side * 0.15, height=0.56, width=0.22)

    # Rear cliff massif behind the cavern throat & upper crown bastions
    jagged_cliff_tier(b, 0.0, 1.18, 0.32, 3.65, 1.48, 0.68, seed=714, ribs=18)
    dwarven_terrace_deck(b, 0.0, 0.74, 2.22, 3.38, 1.16, 0.64, seed=715, sides=8, ribs=16)
    summit_beacon_fort(b, 0.0, 0.78, 3.36, height=0.34, radius=0.48, seed=722)

    # Vondari Dwarven basalt jambs, threshold & gold-inlaid corbelled lintel framing the cavern maw
    for side in (-1, 1):
        b.box((side * 0.50 - 0.10, -0.04, 0.42), (side * 0.50 + 0.10, 0.42, 1.85), 'stone_basalt', bevel=STONE_BEVEL)
        if detailed():
            b.box((side * 0.50 - 0.035, -0.06, 0.52), (side * 0.50 + 0.035, -0.02, 1.78), 'hold_bronze', bevel=0)
    b.box((-0.72, -0.08, 1.98), (0.72, 0.46, 2.24), 'stone_basalt', bevel=STONE_BEVEL)
    b.box((-0.54, -0.24, 0.40), (0.54, 0.48, 0.48), 'stone_basalt', bevel=STONE_BEVEL)
    if detailed():
        b.box((-0.58, -0.10, 2.04), (0.58, -0.05, 2.16), 'hold_bronze', bevel=0)
        for rx in (-0.38, -0.19, 0.0, 0.19, 0.38):
            b.box((rx - 0.035, -0.12, 2.06), (rx + 0.035, -0.08, 2.14), 'glow', bevel=0)

    # Glowing triangular cavern portal & warm forge/magma throat inside the cleft (unobstructed!)
    b.box((-0.54, 0.32, 0.44), (0.54, 0.62, 2.12), 'stone_basalt', skip=('-y', '-z'), bevel=0)
    b.extrude([(-0.44, 0.24, 0.46), (0.44, 0.24, 0.46), (0.0, 0.24, 1.96)],
              (0, 0.10, 0), 'glow')
    b.extrude([(-0.56, 0.12, 0.46), (-0.38, 0.12, 0.46), (-0.04, 0.12, 2.02), (-0.22, 0.12, 2.10)],
              (0, 0.14, 0), 'firelight')
    b.extrude([(0.38, 0.12, 0.46), (0.56, 0.12, 0.46), (0.22, 0.12, 2.10), (0.04, 0.12, 2.02)],
              (0, 0.14, 0), 'firelight')
    b.box((-0.40, -0.14, 0.45), (0.40, 0.26, 0.50), 'glow', bevel=0)

    # Twin sweeping dark-rock summit horns
    rock_spire(b, (-0.75, 0.72, 2.25), (-0.98, 0.52, 4.48), 0.58, 0.48,
               seed=720, mat='rock_cliff', cap_mat='rock_cliff',
               curve=(-0.22, -0.10, 0.25), sides=6, segs=5)
    rock_spire(b, (0.75, 0.72, 2.25), (0.98, 0.52, 4.38), 0.58, 0.48,
               seed=721, mat='rock_cliff', cap_mat='rock_cliff',
               curve=(0.22, -0.10, 0.25), sides=6, segs=5)

    # Framing dark-rock fang ribs along both sides of the portal cleft
    for side in (-1, 1):
        for k, (x_bot, y_bot, x_top, z_top, r_w) in enumerate((
            (0.64, -0.10, 0.34, 2.30, 0.20),
            (0.88, -0.02, 0.54, 2.82, 0.23),
            (1.12, 0.14, 0.78, 3.30, 0.26),
            (1.34, 0.32, 1.02, 3.58, 0.24),
        )):
            rock_spire(
                b,
                (side * x_bot, y_bot, 0.36),
                (side * x_top, 0.26 + 0.08 * k, z_top),
                r_w, r_w * 0.82,
                seed=730 + (0 if side < 0 else 10) + k,
                mat='rock_cliff', cap_mat='rock_cliff',
                curve=(side * 0.10, -0.14, 0.15),
                sides=5, segs=4,
            )

    mini_pine(b, -1.48, -0.42, 0.32, height=0.40, seed=745)
    mini_pine(b, 1.48, -0.38, 0.32, height=0.38, seed=746)
    _talus_skirt(b, 0.0, 0.2, 0.0, 1.85, 1.55, 14, 0.16, 0.32, seed=750)
    return b


def stonehold_horned_sanctum():
    """08 — Monumental Horned Crag Sanctum & High Citadel (`stonehold-5.jpg`):
    Multi-tiered dark crag fortress rising to a towering Horned Dwarven Sanctum
    Keep with gold-inlaid pilaster buttresses, glowing forge portals, and giant sweeping
    dark-rock horns; winding carved stone staircase with parapet curbs & braziers;
    side bastion linked by an arched viaduct bridge with timber ore crane, canvas tent,
    hanging navy-and-gold Vondari banners, waterfall, and alpine conifers."""
    b = MeshBuilder()
    # Main stepped fortified terraces
    dwarven_terrace_deck(b, 0.0, 0.0, 0.0, 0.56, 2.45, 2.15, seed=801, sides=10,
                         open_angles=((-1.9, -1.2),), ribs=24)
    dwarven_terrace_deck(b, 0.15, 0.18, 0.52, 1.24, 2.02, 1.75, seed=802, sides=10,
                         open_angles=((-2.4, -1.4), (2.5, 3.4)), ribs=20)
    dwarven_terrace_deck(b, 0.20, 0.28, 1.18, 1.96, 1.62, 1.42, seed=803, sides=8,
                         open_angles=((-2.8, -1.8),), ribs=18)

    # Left-flank secondary bastion crag & arched connecting bridge
    dwarven_terrace_deck(b, -1.68, 0.35, 0.0, 1.22, 1.08, 0.96, seed=804, sides=8, ribs=16)
    dwarven_terrace_deck(b, -1.72, 0.40, 1.18, 1.82, 0.84, 0.74, seed=805, sides=7,
                         open_angles=((-0.4, 0.4),), ribs=14)
    viaduct_bridge(b, (-1.12, 0.36), (-0.68, 0.32), z_deck=1.82, z_ground=1.18,
                   width=0.42, arches=1, braziers=True)
    # Left bastion timber scaffolding & raking ore crane + work tent
    cliff_scaffolding_crane(b, -2.28, 0.42, 1.18, 1.82, yaw=-math.pi * 0.5, scale=0.95, has_crane=True)
    work_tent(b, -1.68, -0.18, 1.22, yaw=-0.2, w=0.38, d=0.28, h=0.26)

    # Winding Vondari Dwarven carved staircase climbing from base forecourt to Upper Sanctum
    dwarven_stair_flight(b, (0.28, -2.18, 0.0), (0.08, -1.58, 0.56),
                         width=0.44, steps=8, braziers_bottom=True, braziers_top=True)
    dwarven_stair_flight(b, (-0.18, -1.48, 0.56), (-0.58, -0.82, 1.24),
                         width=0.42, steps=9, braziers_top=True)
    dwarven_stair_flight(b, (-0.68, -0.58, 1.24), (-0.36, 0.12, 1.96),
                         width=0.38, steps=9, braziers_top=True)

    # Upper Sanctum Court, Horned Citadel Keep & High Watchtower Crown
    dwarven_terrace_deck(b, 0.14, 0.24, 1.92, 2.48, 1.18, 1.02, seed=840, sides=8,
                         open_angles=((-2.4, -1.4),), ribs=16)
    summit_citadel_hall(b, 0.12, 0.22, 2.46, height=0.88, rx=0.74, ry=0.62, seed=841,
                        door_yaws=(-0.35, 0.0))
    # Rear high tower & roaring signal beacon at Z = 3.30..4.25
    dwarven_terrace_deck(b, 0.24, 0.88, 2.42, 3.68, 0.72, 0.58, seed=845, sides=8, ribs=14)
    summit_beacon_fort(b, 0.24, 0.90, 3.66, height=0.42, radius=0.48, seed=846)

    # Giant sweeping dark-rock Sanctum Horns flanking the central keep
    rock_spire(b, (-0.54, 0.06, 2.35), (-0.96, -0.22, 4.18), 0.38, 0.30,
               seed=842, mat='rock_cliff', cap_mat='rock_cliff',
               curve=(-0.22, -0.10, 0.18), sides=6, segs=6)
    rock_spire(b, (0.76, 0.06, 2.35), (1.18, -0.22, 4.18), 0.38, 0.30,
               seed=843, mat='rock_cliff', cap_mat='rock_cliff',
               curve=(0.22, -0.10, 0.18), sides=6, segs=6)

    # Recessed glowing cliff portals, hanging navy-and-gold Vondari banners & waterfall
    cliff_portal_alcove(b, 0.62, -1.28, 0.56, yaw=0.15, width=0.38, height=0.48)
    vondari_cliff_banner(b, -0.42, -0.68, 2.44, yaw=-0.18, height=0.58, width=0.22)
    vondari_cliff_banner(b, 0.68, -0.68, 2.44, yaw=0.18, height=0.58, width=0.22)
    vondari_cliff_banner(b, 1.24, -0.82, 1.22, yaw=0.35, height=0.52, width=0.20)
    vondari_cliff_banner(b, -1.68, -0.36, 1.80, yaw=-0.15, height=0.50, width=0.19)
    waterfall_cascade(b, (1.12, -1.18, 1.20), (1.42, -1.78, 0.0), width=0.28, seed=850)

    cargo_cluster(b, 0.88, -0.92, 0.56, yaw=0.2, seed=852)
    cargo_cluster(b, 0.72, -0.32, 1.24, yaw=-0.2, seed=853)
    for px, py, pz, ph, s in (
        (-1.28, -1.12, 0.56, 0.44, 855),
        (1.58, -0.42, 0.56, 0.42, 856),
        (1.18, 0.68, 1.24, 0.40, 857),
        (-1.12, 0.92, 1.24, 0.38, 858),
    ):
        mini_pine(b, px, py, pz, height=ph, seed=s)

    _talus_skirt(b, 0.0, 0.0, 0.0, 2.38, 2.08, 18, 0.20, 0.42, seed=860)
    return b


def _build_vent_stack_at(b, cx, cy, z0, scale=1.0, seed=900):
    """Helper to embed a Vondari Dwarven mine ventilation stack on ground or mountain peaks."""
    s = scale
    crag_block(b, cx, cy, z0 - 0.15 * s, z0 + 0.85 * s, 0.92 * s, 0.92 * s,
               seed=seed, sides=8, mat='stone_granite', cap_mat='stone_basalt',
               batter=0.92, chamfer=0.03 * s)
    b.box((cx - 0.64 * s, cy - 0.64 * s, z0 + 0.80 * s),
          (cx + 0.64 * s, cy + 0.64 * s, z0 + 2.85 * s), 'stone_granite', skip=('-z',), bevel=0)
    for bz in (1.35 * s, 2.05 * s, 2.82 * s):
        b.box((cx - 0.72 * s, cy - 0.72 * s, z0 + bz),
              (cx + 0.72 * s, cy + 0.72 * s, z0 + bz + 0.16 * s), 'stone_basalt', bevel=STONE_BEVEL)
    # Glowing forge-draft louver vents on all 4 sides
    b.box((cx - 0.48 * s, cy - 0.66 * s, z0 + 2.22 * s),
          (cx + 0.48 * s, cy + 0.66 * s, z0 + 2.76 * s), 'firelight', bevel=0)
    b.box((cx - 0.66 * s, cy - 0.48 * s, z0 + 2.22 * s),
          (cx + 0.66 * s, cy + 0.48 * s, z0 + 2.76 * s), 'firelight', bevel=0)
    if detailed():
        b.box((cx - 0.74 * s, cy - 0.74 * s, z0 + 2.08 * s),
              (cx + 0.74 * s, cy + 0.74 * s, z0 + 2.16 * s), 'hold_bronze', bevel=0)
        for lz in (2.32 * s, 2.50 * s, 2.68 * s):
            b.box((cx - 0.54 * s, cy - 0.70 * s, z0 + lz),
                  (cx + 0.54 * s, cy + 0.70 * s, z0 + lz + 0.05 * s), 'iron', bevel=0)
            b.box((cx - 0.70 * s, cy - 0.54 * s, z0 + lz),
                  (cx + 0.70 * s, cy + 0.54 * s, z0 + lz + 0.05 * s), 'iron', bevel=0)
        b.box((cx - 0.28 * s, cy - 0.68 * s, z0 + 1.58 * s),
              (cx + 0.28 * s, cy - 0.62 * s, z0 + 1.92 * s), 'hold_bronze', bevel=0)
        for lx in (-0.18 * s, 0.18 * s):
            b.box((cx + lx - 0.025 * s, cy - 0.74 * s, z0 + 0.85 * s),
                  (cx + lx + 0.025 * s, cy - 0.64 * s, z0 + 2.80 * s), 'iron', bevel=0)
        for rz in (1.05 * s, 1.30 * s, 1.55 * s, 1.80 * s, 2.05 * s):
            b.box((cx - 0.18 * s, cy - 0.75 * s, z0 + rz),
                  (cx + 0.18 * s, cy - 0.70 * s, z0 + rz + 0.035 * s), 'iron', bevel=0)
    # Twin basalt exhaust flues at top
    for fx in (-0.28 * s, 0.28 * s):
        b.box((cx + fx - 0.20 * s, cy - 0.22 * s, z0 + 2.98 * s),
              (cx + fx + 0.20 * s, cy + 0.22 * s, z0 + 3.48 * s), 'stone_basalt', bevel=STONE_BEVEL)
        b.box((cx + fx - 0.13 * s, cy - 0.15 * s, z0 + 3.42 * s),
              (cx + fx + 0.13 * s, cy + 0.15 * s, z0 + 3.52 * s), 'glow', bevel=0)


def mine_vent_stack():
    """Tall rugged Vondari Dwarven stone & basalt mine exhaust shaft with louver shutters,
    glowing forge-draft interior, gold rune bands, iron bracing, and maintenance ladder."""
    b = MeshBuilder()
    dwarven_terrace_deck(b, 0.0, 0.0, 0.0, 0.32, 1.28, 1.22, seed=901, sides=8, ribs=16)
    _build_vent_stack_at(b, 0.0, 0.0, 0.28, scale=1.0, seed=902)
    _talus_skirt(b, 0.0, 0.0, 0.0, 1.22, 1.16, 8, 0.14, 0.24, seed=905)
    return b


def mountain_cliff_wall():
    """8m-wide x 17.5m-tall stratified mountain crag cliff wall (`rock`) with carved Vondari
    Dwarven basalt & gold buttresses, hanging banners, and glowing rock-cut forge embrasures
    on BOTH exterior (-Y) and interior cavern (+Y) faces."""
    b = MeshBuilder()
    for idx, (cx, cy, z0, z1, rx, ry) in enumerate((
        (-2.8, 0.0, -0.4, 5.8, 1.85, 1.32),
        (0.0, 0.0, -0.4, 6.0, 1.95, 1.36),
        (2.8, 0.0, -0.4, 5.8, 1.85, 1.32),
        (-2.7, 0.0, 5.4, 11.2, 1.82, 1.30),
        (0.0, 0.0, 5.6, 11.5, 1.92, 1.34),
        (2.7, 0.0, 5.4, 11.2, 1.82, 1.30),
    )):
        jagged_cliff_tier(b, cx, cy, z0, z1, rx, ry, seed=910 + idx, ribs=16)

    # Carved Vondari Dwarven basalt & gold buttress piers & cornice bands on BOTH -Y and +Y faces
    for px in (-3.6, -1.2, 1.2, 3.6):
        b.box((px - 0.32, -1.42, -0.2), (px + 0.32, 1.42, 9.6), 'stone_basalt', skip=('-z',), bevel=0)
        b.box((px - 0.42, -1.52, -0.2), (px + 0.42, 1.52, 1.5), 'stone_basalt', skip=('-z',), bevel=0)
        if detailed():
            b.box((px - 0.10, -1.46, 1.6), (px + 0.10, 1.46, 8.8), 'hold_bronze', bevel=0)
    for cz in (4.6, 9.0):
        b.box((-4.15, -1.48, cz), (4.15, 1.48, cz + 0.40), 'stone_basalt', bevel=STONE_BEVEL)
        if detailed():
            b.box((-4.15, -1.52, cz + 0.12), (4.15, 1.52, cz + 0.24), 'hold_bronze', bevel=0)

    # Rock-cut subterranean hall embrasures with shouldered lintels & glowing forge light
    for wx in (-2.4, 0.0, 2.4):
        for wz in (1.8, 5.8):
            b.box((wx - 0.48, -1.40, wz), (wx + 0.48, 1.40, wz + 1.85), 'stone_granite', bevel=STONE_BEVEL)
            b.box((wx - 0.58, -1.50, wz + 1.75), (wx + 0.58, 1.50, wz + 2.12), 'stone_basalt', bevel=STONE_BEVEL)
            for side in (-1, 1):
                y0, y1 = (side * 1.44, side * 1.30) if side < 0 else (side * 1.30, side * 1.44)
                b.box((wx - 0.32, y0, wz + 0.18), (wx + 0.32, y1, wz + 1.68), 'firelight', bevel=0)
                if detailed():
                    yi0, yi1 = (side * 1.47, side * 1.40) if side < 0 else (side * 1.40, side * 1.47)
                    b.box((wx - 0.03, yi0, wz + 0.18), (wx + 0.03, yi1, wz + 1.68), 'iron', bevel=0)
                    b.box((wx - 0.32, yi0, wz + 0.92), (wx + 0.32, yi1, wz + 0.98), 'iron', bevel=0)

    # Continuous dark-rock upper mountain crag crown & spires (Z = 10.6..17.6m)
    for idx, (cx, cy, z0, z1, rx, ry) in enumerate((
        (-2.7, 0.1, 10.6, 15.2, 1.82, 1.42),
        (0.0, 0.15, 10.8, 15.8, 1.95, 1.48),
        (2.7, 0.1, 10.6, 15.0, 1.82, 1.42),
    )):
        jagged_cliff_tier(b, cx, cy, z0, z1, rx, ry, seed=920 + idx, ribs=14)
    rock_spire(b, (-2.0, 0.2, 13.8), (-2.3, 0.0, 17.4), 1.05, 0.90,
               seed=925, mat='rock_cliff', cap_mat='rock_cliff', curve=(-0.15, -0.05, 0.2), sides=6, segs=4)
    rock_spire(b, (1.8, 0.2, 13.6), (2.1, 0.0, 17.8), 1.08, 0.92,
               seed=926, mat='rock_cliff', cap_mat='rock_cliff', curve=(0.15, -0.05, 0.2), sides=6, segs=4)
    return b


def mountain_gate_massif():
    """14m-wide x 20.0m-tall monumental Vondari Dwarven Fortress Mountain Gate carved directly
    into a towering dark-rock mountain massif with gold-inlaid bastions, hanging Vondari
    banners, raised iron portcullis, and smoking Mine_Vent_Stack crown."""
    b = MeshBuilder()
    for side, s_base in ((-1, 930), (1, 940)):
        jagged_cliff_tier(b, side * 4.7, 0.4, -0.4, 7.2, 2.45, 1.85, seed=s_base, ribs=18)
        jagged_cliff_tier(b, side * 4.6, 0.5, 6.8, 13.4, 2.35, 1.75, seed=s_base + 1, ribs=16)
        # Carved granite & basalt bastion face flanking the portal on both -Y and +Y
        b.box((side * 3.55 - 1.15, -1.35, -0.2), (side * 3.55 + 1.15, 2.15, 6.8),
              'stone_granite', skip=('-z',), bevel=0)
        b.box((side * 2.55 - 0.35, -1.55, -0.2), (side * 2.55 + 0.35, 2.35, 7.2),
              'stone_basalt', skip=('-z',), bevel=0)
        b.box((side * 4.55 - 0.35, -1.45, -0.2), (side * 4.55 + 0.35, 2.25, 7.0),
              'stone_basalt', skip=('-z',), bevel=0)
        for bz in (0.9, 3.4, 6.4):
            b.box((side * 3.55 - 1.35, -1.50, bz), (side * 3.55 + 1.35, 2.30, bz + 0.34), 'stone_basalt', bevel=STONE_BEVEL)
            if detailed():
                b.box((side * 3.55 - 1.38, -1.54, bz + 0.10), (side * 3.55 + 1.38, 2.34, bz + 0.22), 'hold_bronze', bevel=0)
        # Glowing bastion guard embrasure & Vondari banner
        b.box((side * 3.55 - 0.36, -1.42, 3.95), (side * 3.55 + 0.36, 2.22, 5.65), 'firelight', bevel=0)
        b.box((side * 3.55 - 0.48, -1.52, 5.60), (side * 3.55 + 0.48, 2.32, 5.92), 'stone_basalt', bevel=STONE_BEVEL)
        vondari_cliff_banner(b, side * 3.55, -1.48, 3.30, yaw=0.0, height=2.20, width=0.68)
        if detailed():
            for y_bronze, y_glow in ((-1.58, -1.60), (2.36, 2.38)):
                b.box((side * 2.55 - 0.12, y_bronze - 0.04, 1.4), (side * 2.55 + 0.12, y_bronze + 0.04, 5.4), 'hold_bronze', bevel=0)
                b.box((side * 2.55 - 0.07, y_glow - 0.04, 1.8), (side * 2.55 + 0.07, y_glow + 0.04, 5.0), 'glow', bevel=0)

    # Monumental squared & corbelled basalt lintel spanning over the central tunnel (Z = 6.2..7.9)
    b.box((-3.2, -1.62, 6.2), (3.2, 2.42, 7.6), 'stone_basalt', bevel=STONE_BEVEL)
    b.box((-3.5, -1.72, 7.4), (3.5, 2.52, 7.95), 'stone_granite', bevel=STONE_BEVEL)
    for side in (-1, 1):
        b.box((side * 2.05 - 0.32, -1.50, 5.35), (side * 2.05 + 0.32, 2.30, 6.22), 'stone_basalt', bevel=STONE_BEVEL)
    if detailed():
        for y_frz, y_glw in ((-1.66, -1.70), (2.44, 2.48)):
            b.box((-2.2, y_frz - 0.06, 6.55), (2.2, y_frz + 0.06, 7.25), 'hold_bronze', bevel=0)
            for rx in (-1.5, -0.75, 0.0, 0.75, 1.5):
                b.box((rx - 0.14, y_glw - 0.05, 6.72), (rx + 0.14, y_glw + 0.05, 7.08), 'glow', bevel=0)
        for px in (-1.8, -1.2, -0.6, 0.0, 0.6, 1.2, 1.8):
            b.box((px - 0.05, -0.65, 5.05), (px + 0.05, -0.52, 6.25), 'iron', bevel=0)
        b.box((-2.2, -0.68, 5.35), (2.2, -0.50, 5.48), 'iron', bevel=0)
        b.box((-0.40, 0.1, 5.85), (0.40, 0.9, 6.20), 'firelight', bevel=0)

    # Towering central dark-rock mountain peak above the gate (Z = 7.5..20.2)
    jagged_cliff_tier(b, 0.0, 0.5, 7.5, 14.2, 3.85, 1.95, seed=950, ribs=18)
    jagged_cliff_tier(b, -3.8, 0.6, 11.0, 16.8, 2.65, 1.85, seed=951, ribs=14)
    jagged_cliff_tier(b, 3.8, 0.6, 11.0, 16.6, 2.65, 1.85, seed=952, ribs=14)
    jagged_cliff_tier(b, 0.0, 0.6, 13.6, 18.2, 2.45, 1.75, seed=953, ribs=14)
    rock_spire(b, (-3.2, 0.6, 14.8), (-3.8, 0.3, 19.8), 1.20, 0.98,
               seed=954, mat='rock_cliff', cap_mat='rock_cliff', curve=(-0.22, -0.08, 0.25), sides=6, segs=5)
    rock_spire(b, (3.2, 0.6, 14.8), (3.8, 0.3, 19.6), 1.20, 0.98,
               seed=955, mat='rock_cliff', cap_mat='rock_cliff', curve=(0.22, -0.08, 0.25), sides=6, segs=5)
    _build_vent_stack_at(b, 0.0, 0.6, 17.9, scale=0.95, seed=956)
    return b


def mountain_cavern_vault():
    """12m x 10m Hollow Mountain Peak & Subterranean Cavern Ceiling module with vaulted
    ribbed cavern ceiling & bronze chandeliers underneath and jagged dark-rock mountain
    crag peaks & smoking vent stacks above."""
    b = MeshBuilder()
    for sx in (-5.5, 5.5):
        for sy in (-4.5, 4.5):
            b.box((sx - 0.42, sy - 0.42, 7.2), (sx + 0.42, sy + 0.42, 8.2), 'stone_basalt', bevel=STONE_BEVEL)
            b.box((sx - 0.58, sy - 0.58, 8.1), (sx + 0.58, sy + 0.58, 9.4), 'stone_granite', bevel=STONE_BEVEL)
            b.box((sx - 0.78, sy - 0.78, 9.3), (sx + 0.78, sy + 0.78, 11.0), 'stone_basalt', bevel=STONE_BEVEL)

    b.box((-6.35, -5.35, 11.0), (6.35, 5.35, 12.8), 'rock_cliff', bevel=0)
    b.box((-6.35, -5.35, 9.6), (-4.2, 5.35, 11.1), 'stone_granite', bevel=STONE_BEVEL)
    b.box((4.2, -5.35, 9.6), (6.35, 5.35, 11.1), 'stone_granite', bevel=STONE_BEVEL)
    b.box((-4.2, -5.35, 9.8), (4.2, -3.6, 11.1), 'stone_granite', bevel=STONE_BEVEL)
    b.box((-4.2, 3.6, 9.8), (4.2, 5.35, 11.1), 'stone_granite', bevel=STONE_BEVEL)

    for ry in (-4.4, 0.0, 4.4):
        b.box((-5.9, ry - 0.38, 9.9), (5.9, ry + 0.38, 11.15), 'stone_basalt', bevel=STONE_BEVEL)
        b.box((-3.8, ry - 0.42, 10.3), (3.8, ry + 0.42, 11.25), 'stone_basalt', bevel=STONE_BEVEL)
    for rx in (-5.4, 0.0, 5.4):
        b.box((rx - 0.38, -4.9, 9.9), (rx + 0.38, 4.9, 11.15), 'stone_basalt', bevel=STONE_BEVEL)

    for cx, cz_base, sc in ((0.0, 6.9, 1.0), (-3.2, 7.6, 0.72), (3.2, 7.6, 0.72)):
        b.box((cx - 0.55 * sc, -0.55 * sc, 9.85), (cx + 0.55 * sc, 0.55 * sc, 10.65), 'hold_bronze', bevel=0)
        b.box((cx - 0.10 * sc, -0.10 * sc, cz_base + 0.55 * sc), (cx + 0.10 * sc, 0.10 * sc, 9.90), 'iron', bevel=0)
        b.box((cx - 0.88 * sc, -0.88 * sc, cz_base + 0.25 * sc), (cx + 0.88 * sc, 0.88 * sc, cz_base + 0.62 * sc), 'hold_bronze', bevel=0)
        b.box((cx - 0.70 * sc, -0.70 * sc, cz_base + 0.05 * sc), (cx + 0.70 * sc, 0.70 * sc, cz_base + 0.32 * sc), 'firelight', bevel=0)
        b.box((cx - 0.50 * sc, -0.50 * sc, cz_base - 0.08 * sc), (cx + 0.50 * sc, 0.50 * sc, cz_base + 0.12 * sc), 'glow', bevel=0)

    # Towering exterior dark-rock mountain peak massif above the cavern roof
    jagged_cliff_tier(b, 0.0, 0.0, 12.2, 15.2, 6.0, 5.0, seed=960, ribs=20)
    jagged_cliff_tier(b, -0.4, 0.3, 14.8, 17.8, 4.5, 3.7, seed=961, ribs=16)
    jagged_cliff_tier(b, 0.2, -0.2, 17.4, 20.0, 2.7, 2.2, seed=962, ribs=12)
    rock_spire(b, (-2.6, -1.2, 14.8), (-3.2, -1.6, 20.8), 1.35, 1.15,
               seed=963, mat='rock_cliff', cap_mat='rock_cliff', curve=(-0.20, -0.12, 0.25), sides=6, segs=4)
    rock_spire(b, (2.4, 1.4, 14.8), (3.0, 1.8, 21.4), 1.40, 1.18,
               seed=964, mat='rock_cliff', cap_mat='rock_cliff', curve=(0.20, 0.12, 0.25), sides=6, segs=4)
    _build_vent_stack_at(b, -0.6, 0.8, 19.6, scale=0.9, seed=965)
    return b


STONEHOLD_MODULES = (
    ('Stonehold_Ledge_Small', stonehold_ledge_small),
    ('Stonehold_Ledge_Large', stonehold_ledge_large),
    ('Stonehold_Twin_Outcrop', stonehold_twin_outcrop),
    ('Stonehold_Vent_Crater', stonehold_vent_crater),
    ('Stonehold_Caldera_Basin', stonehold_caldera_basin),
    ('Stonehold_Fang_Shrine', stonehold_fang_shrine),
    ('Stonehold_Cavern_Maw', stonehold_cavern_maw),
    ('Stonehold_Horned_Sanctum', stonehold_horned_sanctum),
    ('Mine_Vent_Stack', mine_vent_stack),
    ('Mountain_Cliff_Wall', mountain_cliff_wall),
    ('Mountain_Gate_Massif', mountain_gate_massif),
    ('Mountain_Cavern_Vault', mountain_cavern_vault),
)


def define(kit):
    for name, fn in STONEHOLD_MODULES:
        build_module(kit, name, fn)


def build_module(kit, name, fn):
    b = fn()
    if name in BLUFFS:
        _raise_on_bluff(b, *BLUFFS[name])
    obj = kit.define(name, 'nature', b)
    if name in BLUFFS:
        centres = [(cx, cy) for cx, cy, _, _, _ in BLUFFS[name][1]]
        blockout, sculpted = sculpt_rock(obj, seed=len(name) * 131 + sum(map(ord, name)), centres=centres)
        for v in obj.data.vertices:
            v.co *= FORMATION_SCALE
        for poly in obj.data.polygons:
            if obj.data.materials[poly.material_index].name == 'M_hold_mist':
                continue
            for li in poly.loop_indices:
                obj.data.uv_layers.active.data[li].uv *= FORMATION_SCALE
        obj['kit_landmark'] = True
        obj['kit_authoring_metres'] = FORMATION_SCALE
        print(f'[kit] sculpted {name}: rock {blockout} -> {sculpted} tris')
    elif name in MOUNTAIN_SCULPT:
        centres, floor = MOUNTAIN_SCULPT[name]
        blockout, sculpted = sculpt_rock(obj, seed=sum(map(ord, name)), centres=centres, floor=floor)
        print(f'[kit] sculpted {name}: rock {blockout} -> {sculpted} tris')
    return obj
