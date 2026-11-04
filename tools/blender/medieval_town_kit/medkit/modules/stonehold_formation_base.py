"""Shared talus and geothermal surface builders."""
import math
import random
from mathutils import Matrix
from ..config import detailed
from .stonehold_parts import crag_block

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


