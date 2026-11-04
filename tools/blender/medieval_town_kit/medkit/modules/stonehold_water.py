"""Gravity-aligned cascades and splash detail, merged into each landmark mesh."""
import math
import random

from mathutils import Vector

from ..config import detailed
from .stonehold_rock import crag_block


def _ribbon(b, pts, side, widths, mat, offset=Vector((0, 0, 0))):
    """Flow UVs follow arc length, independent of the cascade's world orientation."""
    distance = 0.0
    for i, (p, q) in enumerate(zip(pts, pts[1:])):
        length = (q - p).length
        quad = [p - side * widths[i] + offset, p + side * widths[i] + offset,
                q + side * widths[i + 1] + offset, q - side * widths[i + 1] + offset]
        uvs = [(0, distance), (1, distance), (1, distance + length), (0, distance + length)]
        b.poly(quad, mat, uvs=uvs, smooth=True)
        b.poly(list(reversed(quad)), mat, uvs=list(reversed(uvs)), smooth=True)
        distance += length


def waterfall_cascade(b, p_top, p_bot, width=0.26, seed=1):
    """An accelerating sheet with broken foam, a wet chute and a recessed splash pool."""
    p0, p1 = Vector(p_top), Vector(p_bot)
    run = Vector((p1.x - p0.x, p1.y - p0.y, 0))
    out = run.normalized() if run.length > 1e-6 else Vector((0, -1, 0))
    side = Vector((-out.y, out.x, 0))
    segs = 18 if detailed() else 6
    rng = random.Random(seed + 7)
    phase = rng.uniform(0, math.tau)
    pts, widths = [], []
    for k in range(segs + 1):
        t = k / segs
        horizontal = p0 + run * t + out * math.sin(math.pi * t) * width * 0.35
        horizontal.z = p0.z + (p1.z - p0.z) * (t * 0.25 + t * t * 0.75)
        horizontal += side * math.sin(t * math.pi * 3 + phase) * width * 0.04
        pts.append(horizontal)
        widths.append(width * (0.44 - 0.10 * t + math.sin(t * 19 + phase) * 0.025))
    _ribbon(b, pts, side, [w * 1.35 for w in widths], 'hold_wet_rock', -out * 0.012)
    _ribbon(b, pts, side, widths, 'hold_water')
    if detailed():
        for lane in range(5):
            stream = random.Random(seed * 101 + lane)
            lateral = (lane - 2) * width * 0.15
            first = stream.randrange(0, segs // 2)
            last = min(segs, first + stream.randrange(5, 12))
            streak = [pts[j] + side * (lateral + math.sin(j * 1.7 + lane) * width * 0.025)
                      for j in range(first, last + 1)]
            widths_foam = [width * stream.uniform(0.015, 0.045) * math.sin(math.pi * j / (last - first))
                           for j in range(last - first + 1)]
            _ribbon(b, streak, side, widths_foam, 'hold_foam', out * 0.006)
    pool_z = p1.z + 0.018
    crag_block(b, p1.x, p1.y, p1.z - 0.018, pool_z, width * 1.65, width * 1.30,
               seed=seed + 80, sides=10, mat='hold_wet_rock', cap_mat='hold_water',
               batter=0.98, chamfer=0, tone=0.92)
    if not detailed():
        return
    for i in range(14):
        spray = random.Random(seed * 311 + i)
        a = spray.uniform(0, math.tau)
        r = width * spray.uniform(0.25, 1.1)
        x, y = p1.x + math.cos(a) * r, p1.y + math.sin(a) * r * 0.7
        b.blob((x, y, pool_z + spray.uniform(0.004, 0.055)), width * spray.uniform(0.018, 0.065),
               'hold_foam', subdiv=1, squash=(1.6, 1.2, 0.3), jitter=0.4, seed=seed + i)
    for i in range(5):
        a = math.pi * (0.2 + i * 0.37)
        crag_block(b, p1.x + math.cos(a) * width * 1.5, p1.y + math.sin(a) * width,
                   p1.z - 0.02, p1.z + width * (0.25 + 0.05 * (i % 3)),
                   width * 0.30, width * 0.23, seed=seed + 100 + i, sides=5,
                   mat='hold_wet_rock', cap_mat='hold_wet_rock', chamfer=0, tone=0.9)
    # Sparse crossed spray sheets, part of the same batch; no scene-depth/refraction pass.
    for axis in (side, out):
        centre = p1 + Vector((0, 0, width * 0.32))
        r = width * 0.75
        quad = [centre - axis * r - Vector((0, 0, r * 0.3)),
                centre + axis * r - Vector((0, 0, r * 0.3)),
                centre + axis * r + Vector((0, 0, r * 0.8)),
                centre - axis * r + Vector((0, 0, r * 0.8))]
        b.poly(quad, 'hold_mist', uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
