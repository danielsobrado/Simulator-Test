"""Authored watch-crag, fortress and twin-citadel recipes."""
import math
import random

from mathutils import Matrix

from ..config import detailed
from ..mesh import MeshBuilder
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


from .stonehold_formation_base import _talus_skirt

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


