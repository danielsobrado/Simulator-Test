"""Chamfered box topology and baked vertex shading for kit geometry.

A chamfered box catches a highlight along every edge, which is what makes a
beam or a dressed stone read as solid timber or masonry at game distances.
Shading is baked into vertex colours: undersides darker, grime rising from the
foot of walls, and a per-piece tone so no two beams or stones match.
"""
import hashlib
import math

from mathutils import Vector

AXES = ((1, 0, 0), (0, 1, 0), (0, 0, 1))
# Default chamfer per material; boxes with skipped faces stay square.
DEFAULT_BEVEL = {'timber': 0.022, 'wood_trim': 0.014, 'stone': 0.03, 'stone_dressed': 0.035, 'brick': 0.012,
                 'timber_dark': 0.03, 'log': 0.05, 'stone_dark': 0.035, 'stone_granite': 0.03,
                 'stone_basalt': 0.03}
TONED = {'timber': (0.82, 1.08), 'wood_trim': (0.88, 1.06), 'carved_wood': (0.9, 1.06),
         'stone': (0.84, 1.08), 'stone_dressed': (0.76, 1.06), 'brick': (0.86, 1.08),
         'planks': (0.86, 1.06), 'roof': (0.92, 1.05), 'roof_terracotta': (0.90, 1.06),
         'clapboard': (0.86, 1.05), 'bark': (0.85, 1.05),
         'thatch': (0.8, 1.08), 'hide': (0.82, 1.1), 'bone': (0.88, 1.04),
         'timber_dark': (0.82, 1.1), 'log': (0.84, 1.08), 'stone_dark': (0.82, 1.1),
         'thatch_reed': (0.84, 1.06), 'sod': (0.86, 1.08), 'stone_granite': (0.88, 1.06),
         'stone_basalt': (0.86, 1.08), 'rock': (0.85, 1.08)}
GRIMED = {'stone', 'stone_dressed', 'brick', 'plaster', 'clapboard', 'timber', 'timber_dark', 'log',
          'stone_dark', 'stone_granite', 'stone_basalt', 'wood_trim', 'carved_wood', 'planks'}
WALL_SOFFIT_AO = {'stone', 'plaster', 'clapboard', 'stone_granite'}


def chamfer_faces(lo, hi, b):
    """Yield (face_key | None, points, outward) for a box chamfered by b."""
    inner = [(lo[i] + b, hi[i] - b) for i in range(3)]
    outer = [(lo[i], hi[i]) for i in range(3)]

    def vert(signs, k):
        return tuple(outer[i][signs[i]] if i == k else inner[i][signs[i]] for i in range(3))

    corners = [(sx, sy, sz) for sx in (0, 1) for sy in (0, 1) for sz in (0, 1)]
    for k in range(3):
        for s in (0, 1):
            cs = [c for c in corners if c[k] == s]
            a, bb = [i for i in range(3) if i != k]
            ring = sorted(cs, key=lambda c: math.atan2(c[bb] - 0.5, c[a] - 0.5))
            out = [0, 0, 0]
            out[k] = 1 if s else -1
            yield f"{'+' if s else '-'}{'xyz'[k]}", [vert(c, k) for c in ring], tuple(out)
    for axis in range(3):
        i, j = [x for x in range(3) if x != axis]
        for si in (0, 1):
            for sj in (0, 1):
                c0 = [0, 0, 0]
                c0[i], c0[j] = si, sj
                c1 = list(c0)
                c1[axis] = 1
                out = [0, 0, 0]
                out[i], out[j] = (1 if si else -1), (1 if sj else -1)
                pts = [vert(c0, i), vert(c0, j), vert(c1, j), vert(c1, i)]
                yield None, pts, tuple(out)
    for c in corners:
        out = tuple(1 if s else -1 for s in c)
        yield None, [vert(c, 0), vert(c, 1), vert(c, 2)], out


def piece_tone(mat, lo, hi):
    span = TONED.get(mat)
    if not span:
        return 1.0
    key = f'{mat}:{[round(v, 3) for v in lo]}:{[round(v, 3) for v in hi]}'.encode()
    unit = int(hashlib.md5(key).hexdigest()[:8], 16) / 0xFFFFFFFF
    return span[0] + (span[1] - span[0]) * unit


def _smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def vertex_shade(p, n, mat):
    """Ambient occlusion and grime for one vertex of a face with normal n (module space)."""
    shade = 1.0
    if n.z < -0.5:
        shade *= 0.70
    elif abs(n.z) < 0.5 and mat in GRIMED:
        # Damp, splash and occlusion at the foot of every face, strongest in the first 30 cm.
        shade *= 0.66 + 0.18 * _smooth(0.0, 0.3, p.z) + 0.16 * _smooth(0.3, 0.6, p.z)
        if mat in WALL_SOFFIT_AO and 2.5 < p.z <= 3.05:
            shade *= 0.80 + 0.20 * _smooth(3.0, 2.55, p.z)
    elif n.z > 0.45 and mat in ('stone_dressed', 'roof', 'roof_terracotta'):
        shade *= 1.03
    return shade


# Heights (module space) where tall grimed faces are cut so the shading can form a
# damp band at the foot and occlusion under the eaves instead of one linear ramp.
GRIME_CUTS = (0.12, 0.3, 0.6, 2.55, 2.85)


def grime_strips(pts, n, mat):
    """Split a vertical axis-aligned quad into horizontal strips at GRIME_CUTS, or None."""
    if mat not in GRIMED or len(pts) != 4 or abs(n.normalized().z) > 0.05:
        return None
    zs = sorted({round(p.z, 5) for p in pts})
    if len(zs) != 2:
        return None
    z0, z1 = zs
    cuts = [z for z in GRIME_CUTS if z0 + 0.05 < z < z1 - 0.05]
    if not cuts:
        return None
    bottom = [p for p in pts if abs(p.z - z0) < 1e-4]
    top = [p for p in pts if abs(p.z - z1) < 1e-4]
    if len(bottom) != 2 or len(top) != 2:
        return None
    # Pair each bottom corner with the top corner above it.
    pairs = [(b, min(top, key=lambda t: (t.x - b.x) ** 2 + (t.y - b.y) ** 2)) for b in bottom]
    levels = [z0, *cuts, z1]
    out = []
    for za, zb in zip(levels, levels[1:]):
        ta, tb = (za - z0) / (z1 - z0), (zb - z0) / (z1 - z0)
        (b0, t0), (b1, t1) = pairs
        out.append([b0.lerp(t0, ta), b1.lerp(t1, ta), b1.lerp(t1, tb), b0.lerp(t0, tb)])
    return out


def unit(v):
    v = Vector(v)
    return v.normalized() if v.length > 0 else v
