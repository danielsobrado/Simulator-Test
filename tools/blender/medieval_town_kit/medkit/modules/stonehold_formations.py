"""Stonehold semantic recipes, common world scale and derived sculpt/export assembly."""
from ..sculpt import sculpt_rock
from .stonehold_parts import jagged_cliff_tier, waterfall_cascade
from .stonehold_formation_base import _talus_skirt
from .stonehold_citadels import stonehold_ledge_small, stonehold_ledge_large, stonehold_twin_outcrop
from .stonehold_sanctums import (
    stonehold_vent_crater, stonehold_caldera_basin, stonehold_fang_shrine,
    stonehold_cavern_maw, stonehold_horned_sanctum,
)
from .stonehold_mountains import mine_vent_stack, mountain_cliff_wall, mountain_gate_massif, mountain_cavern_vault

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
            if obj.data.materials[poly.material_index].name in ('M_hold_mist', 'M_hold_flame'):
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
