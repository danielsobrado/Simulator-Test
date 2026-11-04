"""Authored geothermal, shrine and cavern landmark recipes."""
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


from .stonehold_formation_base import _talus_skirt, _geothermal_pool_surface

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

    # Shadowed triangular throat with a recessed forge, rather than a luminous flat door.
    b.box((-0.54, 0.32, 0.44), (0.54, 1.18, 2.12), 'stone_basalt', skip=('-y', '-z'), bevel=0)
    b.extrude([(-0.44, 1.02, 0.46), (0.44, 1.02, 0.46), (0.0, 1.02, 1.96)],
              (0, 0.10, 0), 'shadow')
    b.box((-0.28, 0.28, 0.46), (0.28, 0.39, 0.56), 'firelight', bevel=0)
    b.box((0.15, 0.25, 0.54), (0.27, 0.28, 0.90), 'firelight', bevel=0)
    b.box((0.18, 0.23, 0.55), (0.23, 0.25, 0.74), 'glow', bevel=0)
    b.extrude([(-0.56, 0.12, 0.46), (-0.38, 0.12, 0.46), (-0.04, 0.12, 2.02), (-0.22, 0.12, 2.10)],
              (0, 0.14, 0), 'firelight')
    b.extrude([(0.38, 0.12, 0.46), (0.56, 0.12, 0.46), (0.22, 0.12, 2.10), (0.04, 0.12, 2.02)],
              (0, 0.14, 0), 'firelight')
    b.box((-0.40, -0.14, 0.45), (0.40, 0.26, 0.50), 'hold_warm_stone', bevel=0)

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
    # Authored aperture volume: the sculpted rock must respect the entrance.
    section = [(-0.44, 0.44), (0.44, 0.44), (0.0, 1.98)]
    b.cutouts.append({
        'vertices': [(x, y, z) for y in (-0.32, 1.04) for x, z in section],
        'faces': [(0, 1, 2), (5, 4, 3), (3, 4, 1, 0), (4, 5, 2, 1), (5, 3, 0, 2)],
    })
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


