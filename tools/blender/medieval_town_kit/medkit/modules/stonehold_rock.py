"""Deterministic cliff masses and local loft geometry."""
import math
import random

from mathutils import Matrix, Vector

from ..config import detailed
from ..mesh import MeshBuilder
from .. import materials

STONE_BEVEL = 0.008


def ring_pts(cx, cy, z, rx, ry, angles, radii_mult, tilt_x=0.0, tilt_y=0.0, rot=0.0):
    c_rot, s_rot = math.cos(rot), math.sin(rot)
    pts = []
    for a, rm in zip(angles, radii_mult):
        lx = rx * rm * math.cos(a)
        ly = ry * rm * math.sin(a)
        wx = cx + lx * c_rot - ly * s_rot
        wy = cy + lx * s_rot + ly * c_rot
        wz = z + lx * tilt_x + ly * tilt_y
        pts.append(Vector((wx, wy, wz)))
    return pts


def _ring_u(pts, scale, u0):
    """Arc length round a ring in texture units, so a wrapped texture flows across edges."""
    us = [u0]
    for i in range(len(pts)):
        us.append(us[-1] + (pts[(i + 1) % len(pts)] - pts[i]).length / scale)
    return us


def loft_rings(b, bot_pts, top_pts, mat, cap_bot=False, cap_top=True, cap_mat=None, tone=1.0, us=None):
    n = len(bot_pts)
    centre = sum(bot_pts, Vector()) / n
    # Rock wraps its texture round the block (u = arc length, v = height); per-face planar UVs
    # restart at every edge and make the texture jump between facets. u is measured once (on the
    # block's foot ring) and shared by every ring, or a battered top shears the columns diagonal.
    wrap = mat == 'rock_cliff'
    if wrap:
        scale = materials.SPEC[mat].scale
        ub = ut = us or _ring_u(bot_pts, scale, 0.0)
    for i in range(n):
        p0, p1 = bot_pts[i], bot_pts[(i + 1) % n]
        q1, q0 = top_pts[(i + 1) % n], top_pts[i]
        mid = (p0 + p1 + q0 + q1) * 0.25
        out = Vector((mid.x - centre.x, mid.y - centre.y, 0.15))
        uvs = None
        if wrap:
            uvs = [(ub[i], p0.z / scale), (ub[i + 1], p1.z / scale),
                   (ut[i + 1], q1.z / scale), (ut[i], q0.z / scale)]
        b.poly([p0, p1, q1, q0], mat, outward=out, tone=tone, uvs=uvs)
    if cap_bot:
        b.poly(list(reversed(bot_pts)), mat, outward=(0, 0, -1), tone=tone * 0.75)
    if cap_top:
        b.poly(top_pts, cap_mat or mat, outward=(0, 0, 1), tone=tone * 0.98)


def _kinked_loft(b, bot, end, mat, rng, rx, tone, us, cap_top, cap_mat):
    """Loft bot -> end through jittered intermediate rings, so a rock face's long edges kink
    and bulge like fractured stone instead of running ruler-straight."""
    h = end[0].z - bot[0].z
    n_mid = 0 if not detailed() else min(2, int(h / 0.18))
    bulge = min(rx, 0.18)  # big massifs get the same few-cm kinks as ribs, not terraces
    centre = sum(bot, Vector()) / len(bot)
    rings = [bot]
    for k in range(1, n_mid + 1):
        t = k / (n_mid + 1) + rng.uniform(-0.08, 0.08) / (n_mid + 1)
        ring = []
        for p, q in zip(bot, end):
            v = p.lerp(q, t)
            radial = Vector((v.x - centre.x, v.y - centre.y, 0.0))
            if radial.length > 1e-6:
                v = v + radial.normalized() * bulge * rng.uniform(-0.05, 0.07)
            ring.append(v + Vector((0, 0, rng.uniform(-0.12, 0.12) * h / (n_mid + 1))))
        rings.append(ring)
    rings.append(end)
    for k in range(len(rings) - 1):
        last = k == len(rings) - 2
        loft_rings(b, rings[k], rings[k + 1], mat, cap_bot=False, cap_top=cap_top and last,
                   cap_mat=cap_mat, tone=tone, us=us)


def crag_block(b, cx, cy, z0, z1, rx, ry, seed=1, sides=7, mat='rock_cliff',
               cap_mat='rock_cliff', batter=0.88, chamfer=0.035,
               tilt_x=0.0, tilt_y=0.0, rot=0.0, tone=None):
    """Faceted natural crag rock block with battered cliff sides (never mortared masonry)."""
    rng = random.Random(seed)
    if not detailed():
        sides = max(5, sides - 2)
    angles = [2 * math.pi * i / sides + rng.uniform(-0.18, 0.18) / sides for i in range(sides)]
    rm_bot = [rng.uniform(0.84, 1.14) for _ in range(sides)]
    rm_mid = [r * batter * rng.uniform(0.95, 1.04) for r in rm_bot]
    tone_val = rng.uniform(0.70, 0.96) if tone is None else tone

    bot = ring_pts(cx, cy, z0, rx, ry, angles, rm_bot, rot=rot)
    us = _ring_u(bot, materials.SPEC[mat].scale, rng.uniform(0.0, 1.0)) if mat == 'rock_cliff' else None
    if detailed() and chamfer > 0.005 and (z1 - z0) > chamfer * 2.5 and min(rx, ry) > chamfer * 3.0:
        z_ch = z1 - chamfer
        mid = ring_pts(cx, cy, z_ch, rx, ry, angles, rm_mid, tilt_x=tilt_x, tilt_y=tilt_y, rot=rot)
        ch_scale = max(0.65, 1.0 - chamfer / max(0.20, min(rx, ry)))
        rm_top = [r * ch_scale for r in rm_mid]
        top = ring_pts(cx, cy, z1, rx, ry, angles, rm_top, tilt_x=tilt_x, tilt_y=tilt_y, rot=rot)
        _kinked_loft(b, bot, mid, mat, rng, min(rx, ry), tone_val, us, False, None)
        loft_rings(b, mid, top, cap_mat or mat, cap_bot=False, cap_top=True,
                   cap_mat=cap_mat or mat, tone=tone_val * 0.96,
                   us=us if (cap_mat or mat) == mat else None)
    else:
        top = ring_pts(cx, cy, z1, rx, ry, angles, rm_mid, tilt_x=tilt_x, tilt_y=tilt_y, rot=rot)
        _kinked_loft(b, bot, top, mat, rng, min(rx, ry), tone_val, us, True, cap_mat or mat)


def rock_spire(b, base_pt, tip_pt, rx, ry, seed=1, mat='rock_cliff',
               cap_mat='rock_cliff', curve=(0.0, 0.0, 0.0), sides=6, segs=5):
    """Curved, multi-segment faceted dark crag horn / monolith spire tapering to a sharp point."""
    rng = random.Random(seed)
    p0 = Vector(base_pt)
    p2 = Vector(tip_pt)
    p1 = (p0 + p2) * 0.5 + Vector(curve)
    if not detailed():
        segs = max(2, segs // 2)
        sides = max(4, sides - 1)

    axis = (p2 - p0).normalized()
    up_ref = Vector((1, 0, 0)) if abs(axis.z) > 0.9 else Vector((0, 0, 1))
    u_vec = axis.cross(up_ref).normalized()
    v_vec = axis.cross(u_vec).normalized()

    base_angles = [2 * math.pi * i / sides + rng.uniform(-0.12, 0.12) for i in range(sides)]
    ridge_shape = [1.18 if i % 2 == 0 else 0.82 for i in range(sides)]

    rings = []
    for k in range(segs + 1):
        t = k / segs
        pos = (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2
        scale = max(0.03, (1.0 - t) ** 0.82)
        twist = 0.18 * t
        ring = []
        for a, rs in zip(base_angles, ridge_shape):
            jit = 1.0 + (rng.uniform(-0.08, 0.08) if 0 < k < segs else 0.0)
            lx = rx * scale * rs * jit * math.cos(a + twist)
            ly = ry * scale * rs * jit * math.sin(a + twist)
            ring.append(pos + u_vec * lx + v_vec * ly)
        rings.append(ring)

    tone_val = rng.uniform(0.72, 0.94)
    for k in range(segs):
        use_mat = cap_mat if k >= segs - 1 else mat
        loft_rings(b, rings[k], rings[k + 1], use_mat,
                   cap_bot=(k == 0), cap_top=(k == segs - 1),
                   cap_mat=cap_mat, tone=tone_val * (0.88 + 0.04 * k))


def jagged_cliff_tier(b, cx, cy, z0, z1, rx, ry, seed=1, ribs=20,
                      under_terrace=False, open_angles=()):
    """Deeply fissured vertical mountain crag massif (`rock` material, zero brick joints)
    with sharp angular vertical dihedral ribs and stepped rocky ledges."""
    rng = random.Random(seed)
    top_trim = 0.055 if under_terrace else 0.02
    # Solid dark core massif
    crag_block(b, cx, cy, z0, z1 - top_trim, rx * 0.80, ry * 0.80,
               seed=seed + 50, sides=max(8, ribs // 2),
               mat='rock_cliff', cap_mat='rock_cliff',
               batter=0.92, chamfer=0.02, tone=0.68)

    n_ribs = ribs if detailed() else max(8, ribs // 2)
    for i in range(n_ribs):
        a = 2 * math.pi * i / n_ribs + rng.uniform(-0.06, 0.06)
        in_open = _angle_in_ranges(math.atan2(math.sin(a), math.cos(a)), open_angles)
        # Keep ribs recessed inside stair/portal open_angles so they never clip stairs
        if in_open:
            dist = rng.uniform(0.64, 0.72)
        elif under_terrace:
            dist = rng.uniform(0.74, 0.86)
        else:
            dist = rng.uniform(0.80, 0.98)
        bx = cx + rx * dist * math.cos(a)
        by = cy + ry * dist * math.sin(a)
        rib_w = (2 * math.pi * max(rx, ry) / n_ribs) * rng.uniform(0.48, 0.92)
        rib_d = rib_w * rng.uniform(0.72, 1.08)
        if under_terrace:
            rib_z1 = z1 - rng.uniform(0.060, 0.100)
        else:
            rib_z1 = z1 - rng.uniform(0.01, 0.14 * (z1 - z0))
        tone_choice = rng.uniform(0.80, 0.94)
        # Break each column into 1-3 stacked blocks, wider and further out toward the foot,
        # so the face reads as fractured crag with ledges rather than a palisade of posts.
        n_seg = 1 if in_open or not detailed() or (rib_z1 - z0) < 0.26 else rng.choice((2, 2, 3))
        cuts = sorted(rng.uniform(0.25, 0.8) for _ in range(n_seg - 1))
        bounds = [z0] + [z0 + (rib_z1 - z0) * c for c in cuts] + [rib_z1]
        for k in range(n_seg):
            below = n_seg - 1 - k
            seg_dist = dist + below * rng.uniform(0.02, 0.05)
            grow = 1.0 + below * rng.uniform(0.10, 0.28)
            top_seg = k == n_seg - 1
            tilt = 0.0 if (under_terrace and top_seg) else rng.uniform(-0.07, 0.07)
            crag_block(b, cx + rx * seg_dist * math.cos(a), cy + ry * seg_dist * math.sin(a),
                       bounds[k], bounds[k + 1], rib_w * grow, rib_d * grow,
                       seed=seed * 17 + i * 5 + k, sides=5 if (i + k) % 2 == 0 else 6,
                       mat='rock_cliff', cap_mat='rock_cliff',
                       batter=rng.uniform(0.82, 0.93), chamfer=0.0 if top_seg else 0.014,
                       tilt_x=tilt * math.cos(a), tilt_y=tilt * math.sin(a),
                       rot=a + rng.uniform(-0.3, 0.3), tone=tone_choice * rng.uniform(0.96, 1.03))
            if not top_seg and rng.random() < 0.22:
                from .stonehold_parts import moss_tuft
                moss_tuft(b, cx + rx * (seg_dist + 0.02) * math.cos(a),
                          cy + ry * (seg_dist + 0.02) * math.sin(a), bounds[k + 1],
                          radius=rib_w * 0.55, seed=seed * 7 + i)


def _angle_in_ranges(ang, open_angles):
    """Check if angle `ang` (radians) falls inside any `(a_start, a_end)` opening interval."""
    a = ang % (2 * math.pi)
    for a0, a1 in open_angles:
        s = a0 % (2 * math.pi)
        e = a1 % (2 * math.pi)
        if s <= e:
            if s <= a <= e:
                return True
        else:
            if a >= s or a <= e:
                return True
    return False


