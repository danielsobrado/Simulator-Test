"""Regional perimeter formations and landmark structures for non-Stonehold settlement families.

Each regional settlement family (`Frostgard`, `Orc`, `Goblin`, `Nordic`, `Tudor`, `Med`) receives
two distinct perimeter formations placed around the town approaches, lower flanks, and upper
terrace shoulders by `village_generator.py` (`style.formations`).
"""
import math
import random

from mathutils import Matrix

from ..config import detailed
from ..mesh import MeshBuilder
from ..sculpt import sculpt_rock
from .props_regional import _strata, pine


def _at(x, y, z=0.0):
    return Matrix.Translation((x, y, z))


# ---------------------------------------------------------------------------
# 1. FROSTGARD (Glacier Serac Spire & Rime Oath-Cairn)
# ---------------------------------------------------------------------------

def frostgard_glacier_spire(seed=101):
    """Snow-draped granite crag crowned with jagged translucent blue-ice serac spires and a rune stele."""
    b = MeshBuilder()
    rng = random.Random(seed)
    # Stratified granite & snow bluff base
    for k in range(3):
        _strata(b, rng.uniform(-0.25, 0.25), rng.uniform(-0.2, 0.2), k * 0.55 - 0.2, 1.55 - 0.25 * k, 0.65, rng)
    b.blob((0.0, 0.0, 1.45), 1.15, 'snow', subdiv=1, squash=(1.2, 1.0, 0.35), jitter=0.18, seed=seed + 1)

    # 5 angled crystalline glacier ice spires bursting through the snow cap
    spires = (
        (0.0, 0.0, 1.3, 0.48, 3.8, 0.06, -0.04),
        (-0.62, 0.22, 1.1, 0.34, 2.7, -0.16, 0.08),
        (0.65, -0.18, 1.1, 0.36, 2.9, 0.18, -0.06),
        (-0.28, -0.55, 1.0, 0.28, 2.2, -0.08, -0.14),
        (0.32, 0.58, 1.0, 0.26, 2.0, 0.10, 0.12),
    )
    for sx, sy, sz, r, h, tx, ty in spires:
        rot = _at(sx, sy, sz) @ Matrix.Rotation(tx, 4, 'Y') @ Matrix.Rotation(ty, 4, 'X')
        b.lathe([(0.0, 0.0), (r, 0.15), (r * 0.68, h * 0.55), (0.0, h)], 6, 'ice', smooth=False, m=rot)
    return b


def frostgard_rime_cairn(seed=102):
    """Stepped frost-cracked granite watch-cairn with an oath monolith and winter beacon brazier."""
    b = MeshBuilder()
    rng = random.Random(seed)
    for k in range(3):
        _strata(b, 0.0, 0.0, k * 0.52 - 0.2, 1.45 - 0.22 * k, 0.58, rng)
    b.blob((0.0, 0.0, 1.38), 1.05, 'snow', subdiv=1, squash=(1.1, 1.1, 0.32), jitter=0.16, seed=seed + 2)

    # Tall carved granite oath-stone stele & bronze winter fire brazier
    b.box((-0.42, -0.22, 1.25), (0.42, 0.22, 3.85), 'stone_granite', m=Matrix.Rotation(0.04, 4, 'Y'))
    b.box((-0.48, -0.26, 2.65), (0.48, 0.26, 2.82), 'bronze')
    b.lathe([(0.0, 1.35), (0.28, 1.38), (0.46, 1.72), (0.0, 1.62)], 8, 'iron', m=_at(0.75, -0.45, 0.0))
    b.blob((0.75, -0.45, 1.76), 0.26, 'glow', subdiv=1, squash=(1.0, 1.0, 1.2), jitter=0.22, seed=seed + 5)
    return b


# ---------------------------------------------------------------------------
# 2. ORC / GRUKMAR (Fang War-Crag & Skull Altar Mound)
# ---------------------------------------------------------------------------

def orc_fang_crag(seed=201):
    """Jagged dark upland slate crag bristling with iron-shod war stakes and a clan war-banner."""
    b = MeshBuilder()
    rng = random.Random(seed)
    for k in range(4):
        _strata(b, rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), k * 0.62 - 0.2, 1.60 - 0.22 * k, 0.72, rng)

    # Ring of angled sharpened timber war-stakes with iron bindings
    for i in range(6):
        ang = 2 * math.pi * i / 6 + 0.3
        sx, sy = 1.05 * math.cos(ang), 1.05 * math.sin(ang)
        tip = (1.85 * math.cos(ang), 1.85 * math.sin(ang), 2.35 + (i % 2) * 0.35)
        b.beam((sx * 0.6, sy * 0.6, 0.65), tip, (0, 0, 1), (-0.09, 0.09), 0.18, 'timber_dark')
        b.box((tip[0] - 0.08, tip[1] - 0.08, tip[2] - 0.22), (tip[0] + 0.08, tip[1] + 0.08, tip[2] + 0.08), 'iron')

    # High clan banner mast crowning the crag
    b.lathe([(0.08, 1.8), (0.06, 5.4)], 6, 'timber_dark')
    b.box((-0.65, -0.05, 4.95), (0.65, 0.05, 5.08), 'timber_dark')
    tail = [(-0.58, -0.02, 4.98), (0.58, -0.02, 4.98), (0.52, -0.02, 2.85), (0.0, -0.02, 3.35), (-0.52, -0.02, 2.75)]
    b.extrude(tail[:3] + [tail[3]], (0, 0.04, 0), 'cloth_red')
    b.extrude([tail[0], tail[3], tail[4]], (0, 0.04, 0), 'cloth_red')
    return b


def orc_skull_altar_mound(seed=202):
    """Stepped dark-stone war cairn with bone tusks, sacrificial slab, and roaring clan fire-bowl."""
    b = MeshBuilder()
    rng = random.Random(seed)
    for k in range(2):
        _strata(b, 0.0, 0.0, k * 0.55 - 0.2, 1.55 - 0.25 * k, 0.62, rng)
    b.box((-0.85, -0.65, 0.95), (0.85, 0.65, 1.45), 'stone_dark')

    # Four curving ivory war-tusks framing the altar corners
    for sx in (-0.78, 0.78):
        for sy in (-0.58, 0.58):
            tip = (sx * 1.45, sy * 1.45, 2.65)
            b.beam((sx, sy, 1.25), tip, (0, 0, 1), (-0.08, 0.08), 0.16, 'bone')

    # Central iron fire cauldron & roaring flame
    b.lathe([(0.0, 1.45), (0.42, 1.48), (0.56, 1.92), (0.0, 1.80)], 8, 'iron')
    b.blob((0.0, 0.0, 2.02), 0.36, 'glow', subdiv=1, squash=(1.0, 1.0, 1.35), jitter=0.25, seed=seed + 9)
    return b


# ---------------------------------------------------------------------------
# 3. GOBLIN (Bog Idol Mound & Stilt Watch Roost)
# ---------------------------------------------------------------------------

def goblin_bog_idol_mound(seed=301):
    """Mossy swamp mud-and-root hummock topped with a crooked goblin totem idol and bog cauldron."""
    b = MeshBuilder()
    b.blob((0.0, 0.0, 0.35), 1.45, 'earth', subdiv=2, squash=(1.15, 1.05, 0.45), jitter=0.22, seed=seed)
    b.blob((0.2, -0.15, 0.65), 0.95, 'foliage', subdiv=1, squash=(1.2, 1.1, 0.35), jitter=0.20, seed=seed + 1)

    # Crooked stacked totem pole with carved wood tiers, bone horns, and glowing torches
    b.lathe([(0.24, 0.6), (0.20, 2.2), (0.26, 2.8), (0.16, 3.8)], 7, 'carved_wood')
    b.beam((-0.95, 0.0, 2.55), (0.95, 0.0, 2.65), (0, 1, 0), (-0.07, 0.07), 0.14, 'timber_dark')
    b.beam((-0.55, -0.1, 3.25), (-1.05, -0.2, 3.75), (0, 0, 1), (-0.06, 0.06), 0.12, 'bone')
    b.beam((0.55, -0.1, 3.25), (1.05, -0.2, 3.75), (0, 0, 1), (-0.06, 0.06), 0.12, 'bone')
    for sx in (-0.88, 0.88):
        b.blob((sx, 0.0, 2.78), 0.18, 'glow', subdiv=1, squash=(1.0, 1.0, 1.3), jitter=0.2, seed=seed + int(sx * 10))
    return b


def goblin_stilt_watch_roost(seed=302):
    """Lashed swamp-timber stilt lookout platform rising from a mud bank with hide awning & torches."""
    b = MeshBuilder()
    b.blob((0.0, 0.0, 0.25), 1.35, 'earth', subdiv=1, squash=(1.1, 1.1, 0.35), jitter=0.2, seed=seed)
    for sx in (-0.65, 0.65):
        for sy in (-0.65, 0.65):
            b.beam((sx * 1.15, sy * 1.15, 0.0), (sx, sy, 3.40), (1, 0, 0), (-0.07, 0.07), 0.14, 'bark')
    b.box((-0.88, -0.88, 2.15), (0.88, 0.88, 2.32), 'planks')
    # Pitched hide sun/rain canopy supported by the 4 corner stilt poles
    b.extrude([(-0.95, -0.95, 3.35), (0.95, -0.95, 3.35), (0.0, 0.0, 3.95)], (0, 1.9, 0), 'hide')
    b.blob((0.0, -0.82, 2.55), 0.20, 'glow', subdiv=1, squash=(1.0, 1.0, 1.25), jitter=0.2, seed=seed + 4)
    return b


# ---------------------------------------------------------------------------
# 4. NORDIC / ZURALDI (Runestone Barrow Mound & Highland Pine Crag)
# ---------------------------------------------------------------------------

def nordic_runestone_mound(seed=401):
    """Turf-and-granite barrow mound crowned by standing Nordic monoliths and a carved high-cross."""
    b = MeshBuilder()
    rng = random.Random(seed)
    _strata(b, 0.0, 0.0, -0.2, 1.65, 0.68, rng)
    b.blob((0.0, 0.0, 0.65), 1.35, 'sod', subdiv=2, squash=(1.15, 1.15, 0.42), jitter=0.16, seed=seed + 1)

    # Central carved Nordic high-cross stele + 3 flanking standing stones
    b.box((-0.26, -0.18, 0.85), (0.26, 0.18, 3.45), 'stone_granite')
    b.box((-0.68, -0.16, 2.55), (0.68, 0.16, 2.92), 'stone_granite')
    for ang in (0.8, 2.35, 4.5):
        sx, sy = 1.05 * math.cos(ang), 1.05 * math.sin(ang)
        b.box((-0.22, -0.14, 0.45), (0.22, 0.14, 2.15), 'stone_dark', m=_at(sx, sy, 0.0) @ Matrix.Rotation(ang, 4, 'Z'))
    return b


def nordic_pine_crag(seed=402):
    """Stratified highland granite crag with a wind-braced mountain pine and stone lantern pillar."""
    b = MeshBuilder()
    rng = random.Random(seed)
    for k in range(3):
        _strata(b, rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18), k * 0.58 - 0.2, 1.50 - 0.22 * k, 0.65, rng)
    t_pos = _at(-0.35, 0.25, 1.35)
    b.lathe([(0.18, 0.0), (0.12, 2.0), (0.04, 4.4)], 7, 'bark', m=t_pos)
    for k in range(4):
        t = k / 3.0
        base = 5.0 * (0.22 + 0.58 * t)
        r = 1.35 * (1 - 0.68 * t)
        tall = 1.45 * (1 - 0.32 * t)
        b.lathe([(0.0, base + tall), (r * 0.85, base - 0.20), (r, base - 0.12), (0.0, base + 0.20)],
                8 if detailed() else 6, 'foliage_pine', smooth=False, m=t_pos)
    b.box((0.42, -0.48, 1.15), (0.82, -0.08, 2.25), 'stone_granite')
    b.blob((0.62, -0.28, 2.38), 0.16, 'glow', subdiv=1, squash=(1.0, 1.0, 1.1), jitter=0.15, seed=seed + 7)
    return b


# ---------------------------------------------------------------------------
# 5. TUDOR / LUMESHIRE (Gothic Wayside Ruin & Hedgerow Standing Stone)
# ---------------------------------------------------------------------------

def tudor_wayside_ruins(seed=501):
    """Mossy Gothic ashlar ruin fragment with a stepped plinth, broken lancet arch piers, and ivy."""
    b = MeshBuilder()
    b.box((-1.35, -0.75, -0.2), (1.35, 0.75, 0.45), 'stone_ashlar', skip=('-z',))
    # Two Gothic buttressed piers and broken arch lintel
    b.box((-1.15, -0.32, 0.45), (-0.55, 0.32, 3.25), 'stone_ashlar')
    b.box((0.55, -0.32, 0.45), (1.15, 0.32, 2.45), 'stone_ashlar')
    b.beam((-0.85, 0.0, 3.05), (0.15, 0.0, 3.65), (0, 1, 0), (-0.26, 0.26), 0.38, 'stone_dressed')
    # Moss & flowering briar cushions
    b.blob((-0.85, 0.35, 0.68), 0.55, 'foliage', subdiv=1, squash=(1.2, 0.9, 0.6), jitter=0.22, seed=seed)
    b.blob((0.85, -0.25, 2.52), 0.48, 'foliage', subdiv=1, squash=(1.1, 1.0, 0.55), jitter=0.22, seed=seed + 2)
    return b


def tudor_hedgerow_standing_stone(seed=502):
    """Ancient mossy meadow menhir & dry-stone field wall flanked by flowering hawthorn bushes."""
    b = MeshBuilder()
    b.box((-1.40, -0.28, -0.2), (1.40, 0.28, 0.85), 'stone', skip=('-z',))
    b.box((-0.38, -0.26, 0.65), (0.38, 0.26, 3.35), 'stone_dressed', m=Matrix.Rotation(-0.04, 4, 'Y'))
    b.blob((-0.95, 0.25, 0.95), 0.68, 'foliage', subdiv=2 if detailed() else 1, jitter=0.22, seed=seed)
    b.blob((0.92, -0.22, 0.85), 0.58, 'flowers', subdiv=1, jitter=0.22, seed=seed + 3)
    return b


# ---------------------------------------------------------------------------
# 6. MED / CONTIA (Classical Marble Colonnade Ruin & Cypress Terrace Shrine)
# ---------------------------------------------------------------------------

def med_classical_ruins(seed=601):
    """Sun-bleached classical colonnade ruin with two fluted columns, entablature lintel & fallen drum."""
    b = MeshBuilder()
    b.box((-1.45, -0.85, -0.2), (1.45, 0.85, 0.42), 'stone_dressed', skip=('-z',))
    for sx in (-0.88, 0.88):
        b.box((sx - 0.32, -0.32, 0.42), (sx + 0.32, 0.32, 0.68), 'stone_dressed')
        b.lathe([(0.24, 0.68), (0.21, 3.25), (0.28, 3.45)], 10 if detailed() else 8, 'plaster', m=_at(sx, 0.0, 0.0))
    b.box((-1.22, -0.36, 3.45), (1.22, 0.36, 3.88), 'stone_dressed')
    # Fallen column drum & Mediterranean bush
    b.lathe([(0.23, -0.45), (0.23, 0.45)], 8, 'plaster', m=_at(0.15, -0.55, 0.62) @ Matrix.Rotation(1.4, 4, 'Y'))
    b.blob((-0.95, 0.48, 0.65), 0.52, 'foliage', subdiv=1, jitter=0.2, seed=seed)
    return b


def med_cypress_terrace_shrine(seed=602):
    """Stepped travertine roadside shrine with terracotta gable roof, golden amphora & twin cypresses."""
    b = MeshBuilder()
    b.box((-1.25, -0.75, -0.2), (1.25, 0.75, 0.48), 'stone_dressed', skip=('-z',))
    b.box((-0.58, -0.42, 0.48), (0.58, 0.42, 2.35), 'plaster')
    b.extrude([(-0.72, -0.52, 2.35), (0.72, -0.52, 2.35), (0.0, -0.52, 2.95)], (0, 1.04, 0), 'roof_terracotta')
    b.lathe([(0.0, 1.05), (0.18, 1.25), (0.10, 1.55), (0.14, 1.65)], 8, 'gold', m=_at(0.0, -0.46, 0.0))
    # Flanking slender Mediterranean cypresses
    for sx in (-0.98, 0.98):
        b.lathe([(0.10, 0.48), (0.08, 1.25)], 6, 'bark', m=_at(sx, 0.15, 0.0))
        b.lathe([(0.0, 1.15), (0.38, 1.65), (0.32, 3.25), (0.0, 4.45)], 7, 'foliage', m=_at(sx, 0.15, 0.0))
    return b


REGIONAL_FORMATIONS = (
    ('Frostgard_Glacier_Spire', frostgard_glacier_spire, True),
    ('Frostgard_Rime_Cairn', frostgard_rime_cairn, True),
    ('Orc_Fang_Crag', orc_fang_crag, True),
    ('Orc_Skull_Altar_Mound', orc_skull_altar_mound, True),
    ('Goblin_Bog_Idol_Mound', goblin_bog_idol_mound, False),
    ('Goblin_Stilt_Watch_Roost', goblin_stilt_watch_roost, False),
    ('Nordic_Runestone_Mound', nordic_runestone_mound, True),
    ('Nordic_Pine_Crag', nordic_pine_crag, True),
    ('Tudor_Wayside_Ruins', tudor_wayside_ruins, False),
    ('Tudor_Hedgerow_Standing_Stone', tudor_hedgerow_standing_stone, False),
    ('Med_Classical_Ruins', med_classical_ruins, False),
    ('Med_Cypress_Terrace_Shrine', med_cypress_terrace_shrine, False),
)


def define(kit):
    for name, fn, has_rock in REGIONAL_FORMATIONS:
        obj = kit.define(name, 'nature', fn())
        if has_rock:
            sculpt_rock(obj, seed=sum(map(ord, name)), floor=1800, mat='rock')
        obj['kit_landmark'] = True
