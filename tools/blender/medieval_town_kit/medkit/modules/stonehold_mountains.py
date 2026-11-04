"""Authored mountain gate, vault, cliff and ventilation recipes."""
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


